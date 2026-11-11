package id.ac.unklab.asrama.attendance;

import id.ac.unklab.asrama.ai.AiDtos.AiAttendanceScanRequest;
import id.ac.unklab.asrama.ai.AiDtos.AiAttendanceScanResponse;
import id.ac.unklab.asrama.ai.FastApiAiClient;
import id.ac.unklab.asrama.attendance.AttendanceDtos.*;
import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.*;
import id.ac.unklab.asrama.config.AppProperties;
import id.ac.unklab.asrama.resident.ResidentDtos.ResidentProfileDto;
import id.ac.unklab.asrama.resident.ResidentRepository;
import id.ac.unklab.asrama.schedule.ScheduleDtos.SessionDto;
import id.ac.unklab.asrama.schedule.ScheduleRepository;
import id.ac.unklab.asrama.security.SecurityUtils;
import id.ac.unklab.asrama.storage.SupabaseStorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AttendanceService {

    private static final Logger log = LoggerFactory.getLogger(AttendanceService.class);

    private final AttendanceRepository attendanceRepository;
    private final ResidentRepository residentRepository;
    private final ScheduleRepository scheduleRepository;
    private final SupabaseStorageService storageService;
    private final FastApiAiClient aiClient;
    private final AppProperties appProperties;
    private final SecurityUtils securityUtils;

    // Idempotency cache untuk mencegah duplikasi request ketika jaringan terputus/retry
    private final Map<String, CachedScanResult> idempotencyCache = new ConcurrentHashMap<>();

    public AttendanceService(
            AttendanceRepository attendanceRepository,
            ResidentRepository residentRepository,
            ScheduleRepository scheduleRepository,
            SupabaseStorageService storageService,
            FastApiAiClient aiClient,
            AppProperties appProperties,
            SecurityUtils securityUtils
    ) {
        this.attendanceRepository = attendanceRepository;
        this.residentRepository = residentRepository;
        this.scheduleRepository = scheduleRepository;
        this.storageService = storageService;
        this.aiClient = aiClient;
        this.appProperties = appProperties;
        this.securityUtils = securityUtils;
    }

    /**
     * Scan wajah mandiri oleh PENGHUNI (P-07, P-09, J-07, S-03, S-04, S-06).
     */
    @Transactional(noRollbackFor = BusinessException.class)
    public AttendanceScanResultResponse scanSelfAttendance(
            UUID sessionId,
            MultipartFile imageFile,
            Double latitude,
            Double longitude,
            Double accuracyM,
            String idempotencyKey
    ) {
        UUID myResidentId = securityUtils.getCurrentResidentId();
        if (myResidentId == null) {
            throw BusinessException.forbidden("ONLY_RESIDENT_SELF_SCAN",
                    "Scan mandiri hanya dapat dilakukan oleh akun PENGHUNI. Gunakan endpoint /scan/guard-assisted untuk bantuan penjaga.");
        }
        return processFaceScanAttendance(
                sessionId,
                myResidentId,
                AttendanceMethod.SCAN,
                null,
                imageFile,
                latitude,
                longitude,
                accuracyM,
                idempotencyKey
        );
    }

    /**
     * Scan wajah dengan bantuan penjaga/MONITOR (J-05):
     * Wajib mencocokkan wajah terhadap penghuni yang dipilih penjaga (selectedResidentId),
     * bukan sekadar cocok dengan penghuni lain.
     */
    @Transactional(noRollbackFor = BusinessException.class)
    public AttendanceScanResultResponse scanGuardAssistedAttendance(
            UUID sessionId,
            UUID selectedResidentId,
            String reason,
            MultipartFile imageFile,
            Double latitude,
            Double longitude,
            Double accuracyM,
            String idempotencyKey
    ) {
        if (selectedResidentId == null) {
            throw BusinessException.badRequest("RESIDENT_ID_REQUIRED",
                    "Penjaga wajib memilih penghuni yang akan dibantu scan wajah (J-05)");
        }
        return processFaceScanAttendance(
                sessionId,
                selectedResidentId,
                AttendanceMethod.DIBANTU_PENJAGA,
                reason != null && !reason.isBlank() ? reason.trim() : "Dibantu scan oleh penjaga",
                imageFile,
                latitude,
                longitude,
                accuracyM,
                idempotencyKey
        );
    }

    private AttendanceScanResultResponse processFaceScanAttendance(
            UUID requestedSessionId,
            UUID targetResidentId,
            AttendanceMethod method,
            String reason,
            MultipartFile imageFile,
            Double latitude,
            Double longitude,
            Double accuracyM,
            String idempotencyKey
    ) {
        long totalStartNs = System.nanoTime();
        Map<String, Long> stageLatencies = new LinkedHashMap<>();

        // 0. Periksa Idempotency-Key jika ada (menangani retry jaringan terputus)
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            String scopedKey = securityUtils.getCurrentUserId() + ":" + idempotencyKey.trim();
            CachedScanResult cached = idempotencyCache.get(scopedKey);
            if (cached != null && cached.expiresAt().isAfter(Instant.now())) {
                return cached.response();
            }
        }

        // 1. Validasi sesi presensi aktif (J-07)
        long stageStartNs = System.nanoTime();
        SessionDto session = resolveAndValidateActiveSession(requestedSessionId);
        UUID sessionId = session.id();

        // 2. Validasi status penghuni aktif & profil wajah aktif (P-07, A-02)
        ResidentProfileDto resident = residentRepository.findById(targetResidentId)
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Penghuni tidak ditemukan"));

        if (resident.status() != ResidentStatus.AKTIF) {
            throw BusinessException.badRequest("RESIDENT_INACTIVE", "Penghuni tidak berstatus aktif");
        }
        if (!resident.hasActiveFaceProfile()) {
            throw BusinessException.badRequest("FACE_PROFILE_NOT_ENROLLED",
                    "Penghuni belum memiliki profil wajah aktif. Silakan lakukan pendaftaran wajah terlebih dahulu.");
        }

        // Periksa apakah sudah presensi di sesi ini (P-09)
        Optional<AttendanceRecordDto> existingRecord = attendanceRepository.findBySessionAndResident(sessionId, targetResidentId);
        if (existingRecord.isPresent()) {
            throw BusinessException.conflict("ALREADY_ATTENDED", "Anda sudah melakukan presensi pada sesi ini");
        }
        stageLatencies.put("dbPrecheckMs", (System.nanoTime() - stageStartNs) / 1_000_000L);

        // 3. Validasi lokasi Geofence sisi server SEBELUM memicu proses AI (P-11, K-06, S-04)
        stageStartNs = System.nanoTime();
        Boolean locationValid = true;
        Double distanceM = null;
        String locationReason = "BEBAS_RADIUS";
        Double safeAccuracyM = accuracyM != null ? Math.max(0.0, accuracyM) : null;

        boolean isGeoActive = session.isGeoEnabled() || attendanceRepository.hasSessionGeofenceConfigured(sessionId);
        if (isGeoActive) {
            if (latitude == null || longitude == null) {
                attendanceRepository.insertValidationLog(
                        sessionId, targetResidentId, method, ValidationResult.REJECTED,
                        null, null, null, null, false, null, safeAccuracyM, null, null,
                        "LOKASI_WAJIB", "Presensi ditolak: Koordinat GPS wajib diaktifkan untuk sesi presensi ini (P-11)"
                );
                throw BusinessException.badRequest("GPS_LOCATION_REQUIRED",
                        "Presensi ditolak: Koordinat GPS wajib diaktifkan untuk sesi presensi ini");
            }

            // Validasi kewajaran koordinat dan akurasi GPS untuk memitigasi fake GPS / sinyal tidak valid
            id.ac.unklab.asrama.common.GeoUtils.validateGps(latitude, longitude, safeAccuracyM, true);

            if (session.geofence() != null && session.geofence().isEnabled()) {
                double centerLat = session.geofence().latitude();
                double centerLon = session.geofence().longitude();
                int maxRadius = session.geofence().radiusM();

                double haversineDist = id.ac.unklab.asrama.common.GeoUtils.haversineDistanceMeters(
                        centerLat, centerLon, latitude, longitude
                );
                distanceM = haversineDist;

                if (haversineDist > maxRadius) {
                    locationValid = false;
                    String rejMsg = String.format("Presensi ditolak: Anda berada di luar radius presensi (Jarak: %.1fm, Maks: %dm)",
                            haversineDist, maxRadius);
                    attendanceRepository.insertValidationLog(
                            sessionId, targetResidentId, method, ValidationResult.REJECTED,
                            null, null, null, null, false, distanceM, safeAccuracyM, latitude, longitude,
                            "OUTSIDE_RADIUS", rejMsg
                    );
                    throw BusinessException.badRequest("OUTSIDE_GEOFENCE", rejMsg);
                }
                locationValid = true;
                locationReason = "DALAM_RADIUS";
            } else {
                GeofenceCheckResult geo = attendanceRepository.checkGeofence(sessionId, latitude, longitude, safeAccuracyM);
                locationValid = geo.isValid();
                distanceM = geo.distanceM() != null ? Math.max(0.0, geo.distanceM()) : null;
                locationReason = geo.reason();
                if (!geo.isValid()) {
                    String rejMsg = String.format("Presensi ditolak: Anda berada di luar radius presensi (Jarak: %.1fm, %s)",
                            distanceM != null ? distanceM : 0.0, locationReason);
                    attendanceRepository.insertValidationLog(
                            sessionId, targetResidentId, method, ValidationResult.REJECTED,
                            null, null, null, null, false, distanceM, safeAccuracyM, latitude, longitude,
                            locationReason, rejMsg
                    );
                    throw BusinessException.badRequest("OUTSIDE_GEOFENCE", rejMsg);
                }
            }
        } else {
            validateGpsCoordinatesIfPresent(latitude, longitude, accuracyM);
            if (latitude != null && longitude != null && session.geofence() != null) {
                distanceM = id.ac.unklab.asrama.common.GeoUtils.haversineDistanceMeters(
                        session.geofence().latitude(), session.geofence().longitude(), latitude, longitude
                );
            }
        }
        stageLatencies.put("geofenceCheckMs", (System.nanoTime() - stageStartNs) / 1_000_000L);

        // 4. Validasi file gambar & panggil AI FastAPI (Deteksi Wajah -> Liveness terlebih dahulu -> Embedding)
        stageStartNs = System.nanoTime();
        byte[] imageBytes;
        try {
            imageBytes = imageFile != null ? imageFile.getBytes() : new byte[0];
        } catch (IOException e) {
            throw BusinessException.badRequest("FILE_READ_ERROR", "Gagal membaca gambar hasil tangkapan kamera");
        }
        storageService.validateImageFile(imageBytes, imageFile != null ? imageFile.getContentType() : null);
        String base64Image = Base64.getEncoder().encodeToString(imageBytes);
        stageLatencies.put("imageValidationMs", (System.nanoTime() - stageStartNs) / 1_000_000L);

        stageStartNs = System.nanoTime();
        AiAttendanceScanResponse aiScan = aiClient.analyzeAttendanceFrame(
                new AiAttendanceScanRequest(sessionId, targetResidentId, base64Image)
        );
        stageLatencies.put("aiInferenceMs", (System.nanoTime() - stageStartNs) / 1_000_000L);

        double clampedLivenessScore = clampUnitScore(aiScan.livenessScore());

        // 5. Evaluasi Deteksi Wajah & Liveness TERLEBIH DAHULU sebelum pencocokan wajah (S-06, Kontrak AI Bagian 4)
        if (!aiScan.faceDetected() || aiScan.faceCount() != 1) {
            String rej = !aiScan.faceDetected() ? "Wajah tidak terdeteksi" : "Terdeteksi lebih dari satu wajah";
            attendanceRepository.insertValidationLog(
                    sessionId, targetResidentId, method, ValidationResult.REJECTED,
                    null, clampedLivenessScore, false, false, locationValid, distanceM, safeAccuracyM, latitude, longitude,
                    locationReason, rej
            );
            throw BusinessException.badRequest("FACE_DETECTION_FAILED", rej);
        }

        boolean livenessPassed = aiScan.livenessPassed()
                && clampedLivenessScore >= appProperties.face().livenessThreshold();
        if (!livenessPassed) {
            String rej = aiScan.rejectionReason() != null && !aiScan.rejectionReason().isBlank()
                    ? aiScan.rejectionReason()
                    : "Pemeriksaan keaslian wajah (liveness/PAD) tidak lolos";
            attendanceRepository.insertValidationLog(
                    sessionId, targetResidentId, method, ValidationResult.REJECTED,
                    null, clampedLivenessScore, false, false, locationValid, distanceM, safeAccuracyM, latitude, longitude,
                    locationReason, rej
            );
            throw BusinessException.badRequest("LIVENESS_FAILED", rej);
        }

        // 6. Jika liveness lolos, lakukan pencocokan wajah 1:1 terhadap targetResidentId menggunakan pgvector public.face_similarity()
        //    Untuk scan oleh penjaga (J-05), targetResidentId adalah penghuni yang dipilih penjaga, sehingga wajib cocok dengan penghuni tersebut!
        stageStartNs = System.nanoTime();
        String vectorLiteral = FastApiAiClient.toPgVectorLiteral(aiScan.embedding512());
        Double similarity = attendanceRepository.computeFaceSimilarity(targetResidentId, vectorLiteral);
        double rawSimScore = similarity != null ? similarity : 0.0;
        double clampedSimScore = clampUnitScore(rawSimScore);
        boolean faceMatched = rawSimScore >= appProperties.face().similarityThreshold();
        stageLatencies.put("vectorMatchMs", (System.nanoTime() - stageStartNs) / 1_000_000L);

        if (!faceMatched) {
            String rej = method == AttendanceMethod.DIBANTU_PENJAGA
                    ? "Wajah tidak cocok dengan identitas penghuni yang dipilih penjaga"
                    : "Wajah tidak cocok dengan profil wajah Anda";
            attendanceRepository.insertValidationLog(
                    sessionId, targetResidentId, method, ValidationResult.REJECTED,
                    clampedSimScore, clampedLivenessScore, false, true, locationValid, distanceM, safeAccuracyM, latitude, longitude,
                    locationReason, rej
            );
            throw BusinessException.badRequest("FACE_MISMATCH", rej);
        }

        // 7. Simpan log validasi sukses & catat presensi secara transaksional (anti-race-condition via unique_resident_session)
        stageStartNs = System.nanoTime();
        attendanceRepository.insertValidationLog(
                sessionId, targetResidentId, method, ValidationResult.SUCCESS,
                clampedSimScore, clampedLivenessScore, true, true, locationValid, distanceM, safeAccuracyM, latitude, longitude,
                locationReason, null
        );

        UUID actorUserId = securityUtils.getCurrentUserId();
        UUID recordId = attendanceRepository.insertAttendanceRecord(
                sessionId,
                targetResidentId,
                resident.nim(),
                resident.fullName(),
                AttendanceStatus.HADIR,
                method,
                reason,
                actorUserId,
                true,
                true,
                latitude,
                longitude,
                safeAccuracyM,
                distanceM,
                locationValid
        );
        AttendanceRecordDto savedRecord = attendanceRepository.findById(recordId).orElseThrow();
        stageLatencies.put("dbCommitPrepMs", (System.nanoTime() - stageStartNs) / 1_000_000L);
        long totalLatencyMs = (System.nanoTime() - totalStartNs) / 1_000_000L;
        stageLatencies.put("totalLatencyMs", totalLatencyMs);

        log.info("Attendance scan recorded: recordId={}, sessionId={}, residentNim={}, method={}, similarity={}, totalLatencyMs={}",
                recordId, sessionId, resident.nim(), method, String.format("%.4f", clampedSimScore), totalLatencyMs);

        AttendanceScanResultResponse response = new AttendanceScanResultResponse(
                recordId,
                sessionId,
                targetResidentId,
                resident.nim(),
                resident.fullName(),
                savedRecord.status(),
                method,
                true,
                Math.round(clampedSimScore * 10000.0) / 10000.0,
                true,
                clampedLivenessScore,
                locationValid,
                distanceM,
                savedRecord.recordedAt(),
                stageLatencies
        );

        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            String scopedKey = actorUserId + ":" + idempotencyKey.trim();
            idempotencyCache.put(scopedKey, new CachedScanResult(response, Instant.now().plusSeconds(300)));
        }

        return response;
    }

    /**
     * Presensi manual oleh MONITOR atau ADMIN dengan alasan wajib (J-03, J-04).
     */
    @Transactional
    public AttendanceRecordDto recordManualAttendance(ManualAttendanceRequest request) {
        if (request.reason() == null || request.reason().trim().isEmpty()) {
            throw BusinessException.badRequest("REASON_REQUIRED", "Alasan wajib diisi untuk presensi manual (J-03)");
        }
        scheduleRepository.findSessionById(request.sessionId())
                .orElseThrow(() -> BusinessException.notFound("SESSION_NOT_FOUND", "Sesi presensi tidak ditemukan"));

        ResidentProfileDto resident = residentRepository.findById(request.residentId())
                .orElseThrow(() -> BusinessException.notFound("RESIDENT_NOT_FOUND", "Penghuni tidak ditemukan"));

        if (resident.status() != ResidentStatus.AKTIF) {
            throw BusinessException.badRequest("RESIDENT_INACTIVE", "Penghuni tidak berstatus aktif");
        }

        Optional<AttendanceRecordDto> existing = attendanceRepository.findBySessionAndResident(request.sessionId(), request.residentId());
        if (existing.isPresent()) {
            throw BusinessException.conflict("ALREADY_ATTENDED",
                    "Penghuni ini sudah memiliki catatan presensi pada sesi tersebut. Gunakan fitur koreksi jika ingin mengubah status.");
        }

        UUID recordId = attendanceRepository.insertAttendanceRecord(
                request.sessionId(),
                resident.id(),
                resident.nim(),
                resident.fullName(),
                request.status(),
                AttendanceMethod.MANUAL,
                request.reason().trim(),
                securityUtils.getCurrentUserId(),
                null,
                null,
                null,
                null,
                null,
                null,
                null
        );
        return attendanceRepository.findById(recordId).orElseThrow();
    }

    /**
     * Koreksi status presensi oleh MONITOR, ADMIN, atau VILLAGE_DEAN dengan riwayat perubahan (K-03).
     */
    @Transactional
    public AttendanceRecordDto correctAttendance(UUID recordId, CorrectAttendanceRequest request) {
        attendanceRepository.findById(recordId)
                .orElseThrow(() -> BusinessException.notFound("RECORD_NOT_FOUND", "Catatan presensi tidak ditemukan"));
        attendanceRepository.updateAttendanceRecord(
                recordId,
                request.status(),
                request.correctionReason(),
                securityUtils.getCurrentUserId()
        );
        return attendanceRepository.findById(recordId).orElseThrow();
    }

    @Transactional(readOnly = true)
    public SessionRecapDto getSessionRecap(UUID sessionId) {
        SessionDto session = scheduleRepository.findSessionById(sessionId)
                .orElseThrow(() -> BusinessException.notFound("SESSION_NOT_FOUND", "Sesi presensi tidak ditemukan"));

        List<AttendanceRecordDto> records = attendanceRepository.findBySession(sessionId);
        int totalRequired = attendanceRepository.countRequiredActiveResidentsForSession(sessionId);
        int hadir = (int) records.stream().filter(r -> r.status() == AttendanceStatus.HADIR).count();
        int tidakHadir = (int) records.stream().filter(r -> r.status() == AttendanceStatus.TIDAK_HADIR).count();
        int belum = Math.max(0, totalRequired - (hadir + tidakHadir));

        int scanCount = (int) records.stream().filter(r -> r.method() == AttendanceMethod.SCAN).count();
        int guardCount = (int) records.stream().filter(r -> r.method() == AttendanceMethod.DIBANTU_PENJAGA).count();
        int manualCount = (int) records.stream().filter(r -> r.method() == AttendanceMethod.MANUAL).count();

        return new SessionRecapDto(
                session.id(),
                session.scheduleName(),
                session.startsAt(),
                session.endsAt(),
                totalRequired,
                hadir,
                tidakHadir,
                belum,
                scanCount,
                guardCount,
                manualCount,
                records
        );
    }

    @Transactional(readOnly = true)
    public List<AttendanceRecordDto> getResidentAttendanceHistory(UUID residentId, OffsetDateTime from, OffsetDateTime to, Integer limit, Integer offset) {
        securityUtils.assertResidentOwnershipOrStaff(residentId);
        return attendanceRepository.findByResident(residentId, from, to, limit, offset);
    }

    @Transactional(readOnly = true)
    public List<AttendanceRecordDto> getResidentAttendanceHistory(UUID residentId, OffsetDateTime from, OffsetDateTime to) {
        return getResidentAttendanceHistory(residentId, from, to, null, null);
    }

    public boolean isAiServiceHealthy() {
        return aiClient.checkHealth();
    }

    @Transactional(readOnly = true)
    public DashboardStatsDto getDashboardStats() {
        return attendanceRepository.computeDashboardStats();
    }

    private SessionDto resolveAndValidateActiveSession(UUID requestedSessionId) {
        SessionDto session;
        if (requestedSessionId != null) {
            session = scheduleRepository.findSessionById(requestedSessionId)
                    .orElseThrow(() -> BusinessException.badRequest("NO_ACTIVE_SESSION", "Tidak ada sesi presensi aktif"));
        } else {
            session = scheduleRepository.findCurrentActiveOpenSession()
                    .orElseThrow(() -> BusinessException.badRequest("NO_ACTIVE_SESSION", "Tidak ada sesi presensi aktif"));
        }

        OffsetDateTime now = OffsetDateTime.now();
        if (session.status() != SessionStatus.OPEN || now.isBefore(session.startsAt()) || !now.isBefore(session.endsAt())) {
            throw BusinessException.badRequest("NO_ACTIVE_SESSION", "Tidak ada sesi presensi aktif");
        }
        return session;
    }

    private void validateGpsCoordinatesIfPresent(Double latitude, Double longitude, Double accuracyM) {
        if (latitude != null && (Double.isNaN(latitude) || latitude < -90.0 || latitude > 90.0)) {
            throw BusinessException.badRequest("INVALID_GPS_COORDINATES", "Nilai latitude GPS wajib berada pada rentang -90 hingga 90");
        }
        if (longitude != null && (Double.isNaN(longitude) || longitude < -180.0 || longitude > 180.0)) {
            throw BusinessException.badRequest("INVALID_GPS_COORDINATES", "Nilai longitude GPS wajib berada pada rentang -180 hingga 180");
        }
        if (accuracyM != null && (Double.isNaN(accuracyM) || accuracyM < 0.0)) {
            throw BusinessException.badRequest("INVALID_GPS_ACCURACY", "Nilai akurasi GPS (accuracyM) tidak boleh negatif");
        }
    }

    private static double clampUnitScore(double score) {
        if (Double.isNaN(score) || score < 0.0) {
            return 0.0;
        }
        return Math.min(1.0, score);
    }

    private record CachedScanResult(AttendanceScanResultResponse response, Instant expiresAt) {}
}
