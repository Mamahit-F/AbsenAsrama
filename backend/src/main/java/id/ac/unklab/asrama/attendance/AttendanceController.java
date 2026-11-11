package id.ac.unklab.asrama.attendance;

import id.ac.unklab.asrama.attendance.AttendanceDtos.*;
import id.ac.unklab.asrama.common.ApiResponse;
import id.ac.unklab.asrama.security.SecurityUtils;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/attendance")
@Tag(name = "05. Attendance Management (Scan, Guard-Assisted, Manual & Dashboard)",
        description = "Scan wajah mandiri (P-07), scan dibantu penjaga (J-05), presensi manual wajib alasan (J-03), pencegahan presensi ganda concurrent (P-09), rekap sesi, dan statistik dashboard")
public class AttendanceController {

    private final AttendanceService attendanceService;
    private final SecurityUtils securityUtils;

    public AttendanceController(AttendanceService attendanceService, SecurityUtils securityUtils) {
        this.attendanceService = attendanceService;
        this.securityUtils = securityUtils;
    }

    @PostMapping(value = {"/scan", "/verify"}, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('PENGHUNI')")
    @Operation(summary = "Scan wajah mandiri oleh PENGHUNI pada sesi aktif dengan validasi liveness, kecocokan wajah, dan geofence (P-07, P-09, J-07)")
    public ResponseEntity<ApiResponse<AttendanceScanResultResponse>> scanSelf(
            @RequestParam(value = "sessionId", required = false) UUID sessionId,
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "photo", required = false) MultipartFile photo,
            @RequestParam(value = "latitude", required = false) Double latitude,
            @RequestParam(value = "longitude", required = false) Double longitude,
            @RequestParam(value = "accuracyM", required = false) Double accuracyM,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey
    ) {
        MultipartFile targetFile = file != null ? file : photo;
        if (targetFile == null || targetFile.isEmpty()) {
            throw id.ac.unklab.asrama.common.BusinessException.badRequest("FILE_REQUIRED", "File foto presensi wajib diunggah (field 'file' atau 'photo')");
        }
        AttendanceScanResultResponse result = attendanceService.scanSelfAttendance(
                sessionId, targetFile, latitude, longitude, accuracyM, idempotencyKey
        );
        Long totalMs = result.stageLatenciesMs() != null ? result.stageLatenciesMs().get("totalLatencyMs") : null;
        var builder = ResponseEntity.ok();
        if (totalMs != null) {
            builder.header("X-Latency-Ms", String.valueOf(totalMs));
        }
        return builder.body(ApiResponse.ok("Presensi wajah berhasil dicatat", result));
    }

    @PostMapping(value = {"/scan/guard-assisted", "/guard-assisted"}, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAnyRole('MONITOR', 'ADMIN')")
    @Operation(summary = "Scan wajah dengan bantuan penjaga (J-05): memverifikasi wajah wajib cocok dengan penghuni yang dipilih")
    public ResponseEntity<ApiResponse<AttendanceScanResultResponse>> scanGuardAssisted(
            @RequestParam(value = "sessionId", required = false) UUID sessionId,
            @RequestParam("residentId") UUID residentId,
            @RequestParam(value = "reason", required = false) String reason,
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "photo", required = false) MultipartFile photo,
            @RequestParam(value = "latitude", required = false) Double latitude,
            @RequestParam(value = "longitude", required = false) Double longitude,
            @RequestParam(value = "accuracyM", required = false) Double accuracyM,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey
    ) {
        MultipartFile targetFile = file != null ? file : photo;
        if (targetFile == null || targetFile.isEmpty()) {
            throw id.ac.unklab.asrama.common.BusinessException.badRequest("FILE_REQUIRED", "File foto presensi wajib diunggah (field 'file' atau 'photo')");
        }
        AttendanceScanResultResponse result = attendanceService.scanGuardAssistedAttendance(
                sessionId, residentId, reason, targetFile, latitude, longitude, accuracyM, idempotencyKey
        );
        Long totalMs = result.stageLatenciesMs() != null ? result.stageLatenciesMs().get("totalLatencyMs") : null;
        var builder = ResponseEntity.ok();
        if (totalMs != null) {
            builder.header("X-Latency-Ms", String.valueOf(totalMs));
        }
        return builder.body(ApiResponse.ok("Presensi bantuan penjaga berhasil dicatat", result));
    }

    @PostMapping({"/manual", "/manual-verify"})
    @PreAuthorize("hasAnyRole('MONITOR', 'ADMIN')")
    @Operation(summary = "Presensi manual oleh penjaga/monitor dengan alasan wajib (J-03, J-04)")
    public ResponseEntity<ApiResponse<AttendanceRecordDto>> recordManual(
            @Valid @RequestBody ManualAttendanceRequest request
    ) {
        AttendanceRecordDto created = attendanceService.recordManualAttendance(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Presensi manual berhasil dicatat", created));
    }

    @PatchMapping("/{recordId}/correct")
    @PreAuthorize("hasAnyRole('MONITOR', 'ADMIN', 'VILLAGE_DEAN')")
    @Operation(summary = "Mengoreksi status presensi dengan alasan koreksi wajib dan pencatatan riwayat perubahan otomatis")
    public ResponseEntity<ApiResponse<AttendanceRecordDto>> correctAttendance(
            @PathVariable UUID recordId,
            @Valid @RequestBody CorrectAttendanceRequest request
    ) {
        AttendanceRecordDto updated = attendanceService.correctAttendance(recordId, request);
        return ResponseEntity.ok(ApiResponse.ok("Status presensi berhasil dikoreksi", updated));
    }

    @GetMapping("/sessions/{sessionId}/recap")
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR', 'VILLAGE_DEAN')")
    @Operation(summary = "Rekapitulasi hadir, tidak hadir, dan belum presensi pada suatu sesi")
    public ResponseEntity<ApiResponse<SessionRecapDto>> getSessionRecap(@PathVariable UUID sessionId) {
        return ResponseEntity.ok(ApiResponse.ok("Rekap sesi presensi", attendanceService.getSessionRecap(sessionId)));
    }

    @GetMapping({"/me", "/my-history"})
    @PreAuthorize("hasRole('PENGHUNI')")
    @Operation(summary = "Riwayat kehadiran milik penghuni yang sedang login (dengan filter tanggal & paginasi)")
    public ResponseEntity<ApiResponse<List<AttendanceRecordDto>>> getMyAttendanceHistory(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        UUID myResidentId = securityUtils.getCurrentResidentId();
        return ResponseEntity.ok(ApiResponse.ok(
                "Riwayat kehadiran Anda",
                attendanceService.getResidentAttendanceHistory(myResidentId, from, to, limit, offset)
        ));
    }

    @GetMapping({"/residents/{residentId}", "/history/{residentId}"})
    @Operation(summary = "Riwayat kehadiran penghuni berdasarkan ID (dilindungi kepemilikan data, RLS & paginasi)")
    public ResponseEntity<ApiResponse<List<AttendanceRecordDto>>> getResidentAttendanceHistory(
            @PathVariable UUID residentId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        return ResponseEntity.ok(ApiResponse.ok(
                "Riwayat kehadiran penghuni",
                attendanceService.getResidentAttendanceHistory(residentId, from, to, limit, offset)
        ));
    }

    @GetMapping("/dashboard")
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR', 'VILLAGE_DEAN')")
    @Operation(summary = "Statistik ringkas dashboard presensi asrama")
    public ResponseEntity<ApiResponse<DashboardStatsDto>> getDashboardStats() {
        return ResponseEntity.ok(ApiResponse.ok("Statistik dashboard presensi", attendanceService.getDashboardStats()));
    }

    @GetMapping("/ai-status")
    @Operation(summary = "Mengecek status ketersediaan layanan AI FastAPI pengenalan wajah")
    public ResponseEntity<ApiResponse<java.util.Map<String, Object>>> getAiStatus() {
        boolean healthy = attendanceService.isAiServiceHealthy();
        java.util.Map<String, Object> data = java.util.Map.of(
                "available", healthy,
                "healthy", healthy,
                "service", "FastAPI DeepFace/ArcFace AI Service",
                "status", healthy ? "ONLINE" : "UNREACHABLE"
        );
        return ResponseEntity.ok(ApiResponse.ok("Status layanan AI", data));
    }
}
