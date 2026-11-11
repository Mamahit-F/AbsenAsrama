package id.ac.unklab.asrama.enrollment;

import id.ac.unklab.asrama.ai.AiDtos.*;
import id.ac.unklab.asrama.ai.FastApiAiClient;
import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.EnrollmentStatus;
import id.ac.unklab.asrama.common.DomainEnums.FacePose;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.config.AppProperties;
import id.ac.unklab.asrama.enrollment.EnrollmentDtos.*;
import id.ac.unklab.asrama.resident.ResidentDtos.ConsentDto;
import id.ac.unklab.asrama.resident.ResidentDtos.ResidentProfileDto;
import id.ac.unklab.asrama.resident.ResidentRepository;
import id.ac.unklab.asrama.security.SecurityUtils;
import id.ac.unklab.asrama.storage.SupabaseStorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class EnrollmentService {

    private static final Logger log = LoggerFactory.getLogger(EnrollmentService.class);

    private final EnrollmentRepository enrollmentRepository;
    private final ResidentRepository residentRepository;
    private final SupabaseStorageService storageService;
    private final FastApiAiClient aiClient;
    private final AppProperties appProperties;
    private final SecurityUtils securityUtils;

    // Menyimpan sementara base64 pose yang lolos selama sesi enrollment aktif agar AI dapat mengekstrak embedding gabungan 5 pose
    private final Map<UUID, Map<FacePose, String>> inMemoryEnrollmentFrames = new ConcurrentHashMap<>();

    public EnrollmentService(
            EnrollmentRepository enrollmentRepository,
            ResidentRepository residentRepository,
            SupabaseStorageService storageService,
            FastApiAiClient aiClient,
            AppProperties appProperties,
            SecurityUtils securityUtils
    ) {
        this.enrollmentRepository = enrollmentRepository;
        this.residentRepository = residentRepository;
        this.storageService = storageService;
        this.aiClient = aiClient;
        this.appProperties = appProperties;
        this.securityUtils = securityUtils;
    }

    @Transactional
    public EnrollmentDetailDto startOrResumeEnrollment(StartEnrollmentRequest request) {
        UUID targetResidentId = request.residentId() != null ? request.residentId() : securityUtils.getCurrentResidentId();
        if (targetResidentId == null) {
            throw BusinessException.badRequest("RESIDENT_ID_REQUIRED", "residentId wajib diisi");
        }
        securityUtils.assertResidentOwnershipOrStaff(targetResidentId);

        ResidentProfileDto resident = residentRepository.findById(targetResidentId)
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Penghuni tidak ditemukan"));

        if (resident.status() != ResidentStatus.AKTIF) {
            throw BusinessException.badRequest("RESIDENT_INACTIVE", "Penghuni tidak berstatus aktif");
        }

        ConsentDto activeConsent = residentRepository.findActiveConsentByResident(targetResidentId)
                .orElseThrow(() -> BusinessException.badRequest("CONSENT_REQUIRED",
                        "Persetujuan pengumpulan data biometrik wajah (P-05) wajib diberikan sebelum memulai enrollment"));

        Optional<UUID> existingId = enrollmentRepository.findInProgressEnrollmentId(targetResidentId);
        if (existingId.isPresent()) {
            return enrollmentRepository.findEnrollmentById(existingId.get()).orElseThrow();
        }

        UUID consentIdToUse = request.consentId() != null ? request.consentId() : activeConsent.id();
        UUID newEnrollmentId = enrollmentRepository.createEnrollment(targetResidentId, consentIdToUse);
        log.info("Started new face enrollment session: enrollmentId={}, residentId={}", newEnrollmentId, targetResidentId);

        return enrollmentRepository.findEnrollmentById(newEnrollmentId).orElseThrow();
    }

    @Transactional
    public PoseUploadResponse uploadAndValidatePose(UUID enrollmentId, FacePose pose, MultipartFile file) {
        long startNs = System.nanoTime();
        EnrollmentDetailDto enrollment = enrollmentRepository.findEnrollmentById(enrollmentId)
                .orElseThrow(() -> BusinessException.notFound("ENROLLMENT_NOT_FOUND", "Sesi enrollment tidak ditemukan"));

        securityUtils.assertResidentOwnershipOrStaff(enrollment.residentId());

        if (enrollment.status() != EnrollmentStatus.PENDING && enrollment.status() != EnrollmentStatus.PROCESSING) {
            throw BusinessException.badRequest("ENROLLMENT_NOT_EDITABLE",
                    "Enrollment sudah selesai atau gagal; foto tidak dapat diubah");
        }

        byte[] imageBytes;
        try {
            imageBytes = file != null ? file.getBytes() : new byte[0];
        } catch (IOException e) {
            throw BusinessException.badRequest("FILE_READ_ERROR", "Gagal membaca file foto wajah");
        }

        String contentType = file != null ? file.getContentType() : null;
        storageService.validateImageFile(imageBytes, contentType);

        String base64Image = Base64.getEncoder().encodeToString(imageBytes);

        // 1. Kirim ke FastAPI AI untuk pemeriksaan kualitas, pose, dan liveness/PAD (P-03, P-04, S-06)
        AiPoseCheckResponse aiResult = aiClient.validateEnrollmentPose(new AiPoseCheckRequest(
                enrollment.residentId(),
                enrollmentId,
                pose,
                base64Image
        ));

        double clampedQualityScore = clampUnitScore(aiResult.qualityScore());
        double clampedLivenessScore = clampUnitScore(aiResult.livenessScore());

        boolean qualityPassed = aiResult.faceDetected()
                && aiResult.faceCount() == 1
                && aiResult.poseMatched()
                && aiResult.qualityPassed()
                && clampedQualityScore >= appProperties.face().qualityThreshold();

        boolean livenessPassed = aiResult.livenessPassed()
                && clampedLivenessScore >= appProperties.face().livenessThreshold();

        String rejectionReason = aiResult.rejectionReason();
        if ((!qualityPassed || !livenessPassed) && (rejectionReason == null || rejectionReason.isBlank())) {
            if (!aiResult.faceDetected()) {
                rejectionReason = "Wajah tidak terdeteksi pada kamera";
            } else if (aiResult.faceCount() > 1) {
                rejectionReason = "Terdeteksi lebih dari satu wajah dalam frame";
            } else if (!aiResult.poseMatched()) {
                rejectionReason = "Arah pose wajah belum sesuai dengan instruksi (" + pose.name() + ")";
            } else if (!livenessPassed) {
                rejectionReason = "Pemeriksaan keaslian wajah (liveness/PAD) gagal";
            } else {
                rejectionReason = "Kualitas foto belum memenuhi standar pencahayaan/ketajaman";
            }
        }

        // 2. Unggah ke Supabase Storage privat dengan path {resident_id}/{enrollment_id}/{front|left|right|up|down}.jpg
        String storagePath = storageService.uploadEnrollmentPhoto(
                enrollment.residentId(),
                enrollmentId,
                pose,
                imageBytes,
                contentType
        );

        // 3. Simpan metadata hasil ke public.enrollment_photos (mendukung retry pose individual P-04)
        enrollmentRepository.upsertEnrollmentPhoto(
                enrollmentId,
                pose,
                appProperties.storage().bucket(),
                storagePath,
                clampedQualityScore,
                clampedLivenessScore,
                qualityPassed,
                livenessPassed,
                aiResult.qualityDetails(),
                rejectionReason,
                imageBytes.length
        );

        if (qualityPassed && livenessPassed) {
            inMemoryEnrollmentFrames
                    .computeIfAbsent(enrollmentId, k -> new ConcurrentHashMap<>())
                    .put(pose, base64Image);
        }

        int totalValidPoses = enrollmentRepository.countValidPoses(enrollmentId);
        long latencyMs = (System.nanoTime() - startNs) / 1_000_000L;

        return new PoseUploadResponse(
                enrollmentId,
                pose,
                qualityPassed && livenessPassed,
                clampedQualityScore,
                qualityPassed,
                clampedLivenessScore,
                livenessPassed,
                rejectionReason,
                totalValidPoses,
                totalValidPoses == 5,
                latencyMs
        );
    }

    @Transactional
    public CompleteEnrollmentResponse completeAndActivateEnrollment(UUID enrollmentId) {
        long startNs = System.nanoTime();
        EnrollmentDetailDto enrollment = enrollmentRepository.findEnrollmentById(enrollmentId)
                .orElseThrow(() -> BusinessException.notFound("ENROLLMENT_NOT_FOUND", "Sesi enrollment tidak ditemukan"));

        securityUtils.assertResidentOwnershipOrStaff(enrollment.residentId());

        if (enrollment.status() == EnrollmentStatus.COMPLETED) {
            throw BusinessException.conflict("ENROLLMENT_ALREADY_COMPLETED", "Sesi enrollment ini sudah diaktifkan");
        }

        int validPoses = enrollmentRepository.countValidPoses(enrollmentId);
        if (validPoses != 5) {
            throw BusinessException.badRequest("INCOMPLETE_POSES",
                    "Enrollment membutuhkan tepat 5 pose wajah yang lolos kualitas dan liveness (saat ini: " + validPoses + "/5)");
        }

        Map<FacePose, String> frames = inMemoryEnrollmentFrames.getOrDefault(enrollmentId, Map.of());
        AiEnrollmentEmbeddingResponse embeddingResponse = aiClient.extractEnrollmentEmbedding(
                new AiEnrollmentEmbeddingRequest(enrollment.residentId(), enrollmentId, frames)
        );

        if (!embeddingResponse.success() || embeddingResponse.embedding512() == null || embeddingResponse.embedding512().size() != 512) {
            String reason = embeddingResponse.failureReason() != null
                    ? embeddingResponse.failureReason()
                    : "Gagal membentuk vektor embedding wajah 512-dimensi";
            enrollmentRepository.markEnrollmentFailed(enrollmentId, reason);
            throw BusinessException.badRequest("EMBEDDING_EXTRACTION_FAILED", reason);
        }

        String vectorLiteral = FastApiAiClient.toPgVectorLiteral(embeddingResponse.embedding512());
        String modelVersion = embeddingResponse.modelVersion() != null
                ? embeddingResponse.modelVersion()
                : appProperties.face().modelVersion();

        // Pemeriksaan wajah ganda terhadap penghuni aktif lain (S-05)
        List<SimilarFaceMatchDto> duplicates = enrollmentRepository.findSimilarFaces(
                vectorLiteral,
                appProperties.face().duplicateThreshold(),
                enrollment.residentId(),
                1
        );
        if (!duplicates.isEmpty()) {
            throw BusinessException.conflict("DUPLICATE_FACE", "Wajah sudah terdaftar");
        }

        // Update face_enrollments ke COMPLETED (trigger database trg_validate_enrollment juga memverifikasi 5 pose, consent, dan anti-duplikat)
        enrollmentRepository.markEnrollmentCompleted(
                enrollmentId,
                vectorLiteral,
                modelVersion,
                embeddingResponse.qualitySummary()
        );

        // Promosikan secara atomik ke face_profiles & arsipkan profil lama ke face_profile_history (P-06, P-10)
        enrollmentRepository.promoteEnrollment(enrollmentId, appProperties.face().retentionDays());
        inMemoryEnrollmentFrames.remove(enrollmentId);

        EnrollmentDetailDto updated = enrollmentRepository.findEnrollmentById(enrollmentId).orElseThrow();
        long latencyMs = (System.nanoTime() - startNs) / 1_000_000L;
        log.info("Face enrollment completed and promoted atomically: enrollmentId={}, residentId={}, latencyMs={}",
                enrollmentId, enrollment.residentId(), latencyMs);

        return new CompleteEnrollmentResponse(
                enrollmentId,
                enrollment.residentId(),
                updated.status(),
                modelVersion,
                true,
                updated.completedAt(),
                latencyMs
        );
    }

    @Transactional(readOnly = true)
    public EnrollmentDetailDto getEnrollmentDetail(UUID enrollmentId) {
        EnrollmentDetailDto detail = enrollmentRepository.findEnrollmentById(enrollmentId)
                .orElseThrow(() -> BusinessException.notFound("ENROLLMENT_NOT_FOUND", "Data enrollment tidak ditemukan"));
        securityUtils.assertResidentOwnershipOrStaff(detail.residentId());
        return detail;
    }

    @Transactional(readOnly = true)
    public ActiveFaceProfileMetadataDto getActiveFaceProfileMetadata(UUID residentId) {
        securityUtils.assertResidentOwnershipOrStaff(residentId);
        return enrollmentRepository.findActiveFaceProfileMetadata(residentId)
                .orElseThrow(() -> BusinessException.notFound("FACE_PROFILE_NOT_FOUND",
                        "Penghuni belum memiliki profil wajah aktif"));
    }

    private static double clampUnitScore(double score) {
        if (Double.isNaN(score) || score < 0.0) {
            return 0.0;
        }
        return Math.min(1.0, score);
    }
}
