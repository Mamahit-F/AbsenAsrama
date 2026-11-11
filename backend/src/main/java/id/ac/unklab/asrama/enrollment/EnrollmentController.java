package id.ac.unklab.asrama.enrollment;

import id.ac.unklab.asrama.common.ApiResponse;
import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.FacePose;
import id.ac.unklab.asrama.enrollment.EnrollmentDtos.*;
import id.ac.unklab.asrama.resident.ResidentDtos.ConsentDto;
import id.ac.unklab.asrama.resident.ResidentDtos.ConsentRequest;
import id.ac.unklab.asrama.resident.ResidentService;
import id.ac.unklab.asrama.security.SecurityUtils;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping({"/api/v1/enrollments", "/api/v1/enrollment"})
@Tag(name = "03. Face Enrollment (5 Poses & Re-Enrollment)", description = "Pendaftaran 5 pose wajah (P-02..P-06), liveness/PAD (S-06), deteksi wajah ganda (S-05), re-enrollment atomik (P-10), tanpa pernah mengekspos embedding ke frontend (K-01)")
public class EnrollmentController {

    private final EnrollmentService enrollmentService;
    private final ResidentService residentService;
    private final SecurityUtils securityUtils;

    public EnrollmentController(
            EnrollmentService enrollmentService,
            ResidentService residentService,
            SecurityUtils securityUtils
    ) {
        this.enrollmentService = enrollmentService;
        this.residentService = residentService;
        this.securityUtils = securityUtils;
    }

    @PostMapping({"/start", "/initiate"})
    @PreAuthorize("hasAnyRole('PENGHUNI', 'ADMIN')")
    @Operation(summary = "Memulai atau melanjutkan sesi pendaftaran wajah (memerlukan consent aktif P-05)")
    public ResponseEntity<ApiResponse<EnrollmentDetailDto>> startEnrollment(
            @RequestBody(required = false) StartEnrollmentRequest request
    ) {
        StartEnrollmentRequest safeReq = request != null ? request : new StartEnrollmentRequest(null, null);
        EnrollmentDetailDto detail = enrollmentService.startOrResumeEnrollment(safeReq);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Sesi pendaftaran wajah siap digunakan", detail));
    }

    @PostMapping(value = "/{enrollmentId}/poses/{pose}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('PENGHUNI', 'ADMIN')")
    @Operation(summary = "Mengunggah dan memvalidasi 1 pose wajah (LURUS, KIRI, KANAN, ATAS, BAWAH) via FastAPI AI & Supabase Storage (P-02, P-03, P-04)")
    public ResponseEntity<ApiResponse<PoseUploadResponse>> uploadPose(
            @PathVariable UUID enrollmentId,
            @PathVariable FacePose pose,
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "photo", required = false) MultipartFile photo
    ) {
        MultipartFile target = file != null ? file : photo;
        if (target == null || target.isEmpty()) {
            throw BusinessException.badRequest("FILE_REQUIRED", "File foto pose wajah wajib diunggah (field 'file' atau 'photo')");
        }
        PoseUploadResponse response = enrollmentService.uploadAndValidatePose(enrollmentId, pose, target);
        String msg = response.accepted()
                ? "Pose " + pose.name() + " lolos pemeriksaan kualitas dan liveness"
                : "Pose " + pose.name() + " belum lolos: " + response.rejectionReason();
        return ResponseEntity.ok(ApiResponse.ok(msg, response));
    }

    @PostMapping(value = "/poses", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('PENGHUNI', 'ADMIN')")
    @Operation(summary = "Mengunggah dan memvalidasi 1 pose wajah via query/form multipart")
    public ResponseEntity<ApiResponse<PoseUploadResponse>> uploadPoseForm(
            @RequestParam("enrollmentId") UUID enrollmentId,
            @RequestParam("pose") FacePose pose,
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "photo", required = false) MultipartFile photo
    ) {
        return uploadPose(enrollmentId, pose, file, photo);
    }

    @PostMapping({"/{enrollmentId}/complete", "/{enrollmentId}/finalize"})
    @PreAuthorize("hasAnyRole('PENGHUNI', 'ADMIN')")
    @Operation(summary = "Memproses embedding ArcFace setelah 5 pose lolos, memeriksa wajah ganda (S-05), dan mengaktifkan profil wajah (P-06, P-10)")
    public ResponseEntity<ApiResponse<CompleteEnrollmentResponse>> completeEnrollment(
            @PathVariable UUID enrollmentId
    ) {
        CompleteEnrollmentResponse completed = enrollmentService.completeAndActivateEnrollment(enrollmentId);
        return ResponseEntity.ok(ApiResponse.ok("Pendaftaran wajah berhasil diselesaikan dan diaktifkan", completed));
    }

    @PostMapping("/finalize")
    @PreAuthorize("hasAnyRole('PENGHUNI', 'ADMIN')")
    @Operation(summary = "Finalisasi enrollment via request body JSON { enrollmentId }")
    public ResponseEntity<ApiResponse<CompleteEnrollmentResponse>> finalizeEnrollment(
            @RequestBody FinalizeEnrollmentRequest request
    ) {
        CompleteEnrollmentResponse completed = enrollmentService.completeAndActivateEnrollment(request.enrollmentId());
        return ResponseEntity.ok(ApiResponse.ok("Pendaftaran wajah berhasil diselesaikan dan diaktifkan", completed));
    }

    @GetMapping("/{enrollmentId}")
    @Operation(summary = "Detail status sesi enrollment dan daftar 5 pose (tanpa vektor embedding)")
    public ResponseEntity<ApiResponse<EnrollmentDetailDto>> getEnrollmentDetail(@PathVariable UUID enrollmentId) {
        return ResponseEntity.ok(ApiResponse.ok("Detail sesi enrollment", enrollmentService.getEnrollmentDetail(enrollmentId)));
    }

    @GetMapping("/residents/{residentId}/active-profile")
    @Operation(summary = "Metadata profil wajah aktif penghuni (tanpa mengembalikan vektor embedding K-01)")
    public ResponseEntity<ApiResponse<ActiveFaceProfileMetadataDto>> getActiveProfileMetadata(@PathVariable UUID residentId) {
        return ResponseEntity.ok(ApiResponse.ok(
                "Metadata profil wajah aktif",
                enrollmentService.getActiveFaceProfileMetadata(residentId)
        ));
    }

    @GetMapping("/consent")
    @PreAuthorize("hasRole('PENGHUNI')")
    @Operation(summary = "Memeriksa status persetujuan biometrik pengguna saat ini")
    public ResponseEntity<ApiResponse<List<ConsentDto>>> getMyConsent() {
        UUID residentId = securityUtils.getCurrentResidentId();
        return ResponseEntity.ok(ApiResponse.ok("Status persetujuan biometrik", residentService.getConsents(residentId)));
    }

    @PostMapping("/consent")
    @PreAuthorize("hasRole('PENGHUNI')")
    @Operation(summary = "Menandatangani persetujuan biometrik pengguna saat ini")
    public ResponseEntity<ApiResponse<ConsentDto>> giveMyConsent(@Valid @RequestBody ConsentRequest request) {
        UUID residentId = securityUtils.getCurrentResidentId();
        ConsentDto consent = residentService.recordConsent(residentId, request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Persetujuan biometrik berhasil disimpan", consent));
    }

    @GetMapping("/status")
    @PreAuthorize("hasRole('PENGHUNI')")
    @Operation(summary = "Memeriksa status profil biometrik pengguna saat ini")
    public ResponseEntity<ApiResponse<ActiveFaceProfileMetadataDto>> getMyEnrollmentStatus() {
        UUID residentId = securityUtils.getCurrentResidentId();
        return ResponseEntity.ok(ApiResponse.ok("Status profil biometrik", enrollmentService.getActiveFaceProfileMetadata(residentId)));
    }
}
