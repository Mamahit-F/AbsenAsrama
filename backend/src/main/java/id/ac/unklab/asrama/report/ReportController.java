package id.ac.unklab.asrama.report;

import id.ac.unklab.asrama.common.ApiResponse;
import id.ac.unklab.asrama.common.DomainEnums.AttendanceStatus;
import id.ac.unklab.asrama.common.DomainEnums.ValidationResult;
import id.ac.unklab.asrama.report.ReportDtos.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/reports")
@PreAuthorize("hasAnyRole('ADMIN', 'MONITOR', 'VILLAGE_DEAN')")
@Tag(name = "08. Reports, CSV Export & Audit/System Logs",
        description = "Rekap presensi per periode, export CSV lengkap (J-08), audit logs (S-07, K-03), attendance validation logs, dan riwayat perubahan data")
public class ReportController {

    private final ReportService reportService;

    public ReportController(ReportService reportService) {
        this.reportService = reportService;
    }

    @GetMapping("/attendance")
    @Operation(summary = "Laporan rekapitulasi presensi berdasarkan periode waktu, sesi, dan status")
    public ResponseEntity<ApiResponse<PeriodRecapReportDto>> getAttendanceReport(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(required = false) UUID sessionId,
            @RequestParam(required = false) AttendanceStatus status
    ) {
        return ResponseEntity.ok(ApiResponse.ok(
                "Laporan rekapitulasi presensi",
                reportService.getPeriodAttendanceReport(from, to, sessionId, status)
        ));
    }

    @GetMapping(value = "/attendance/export-csv", produces = "text/csv")
    @Operation(summary = "Export laporan rekap presensi ke file CSV dengan seluruh kolom lengkap (J-08)")
    public ResponseEntity<byte[]> exportAttendanceCsv(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(required = false) UUID sessionId,
            @RequestParam(required = false) AttendanceStatus status
    ) {
        String csvContent = reportService.exportAttendanceReportCsv(from, to, sessionId, status);
        byte[] bytes = csvContent.getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"rekap_presensi_asrama.csv\"")
                .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
                .body(bytes);
    }

    @GetMapping("/logs/audit")
    @Operation(summary = "Daftar Audit Logs perubahan data dan aktivitas penting tanpa password/JWT/embedding (S-07, K-03, dengan paginasi)")
    public ResponseEntity<ApiResponse<List<AuditLogDto>>> getAuditLogs(
            @RequestParam(required = false) String entityType,
            @RequestParam(defaultValue = "100") int limit,
            @RequestParam(defaultValue = "0") int offset
    ) {
        return ResponseEntity.ok(ApiResponse.ok("Daftar audit logs", reportService.getAuditLogs(entityType, limit, offset)));
    }

    @GetMapping("/logs/validation")
    @Operation(summary = "Daftar System & AI Attendance Validation Logs (skor wajah, liveness, lokasi, dan alasan penolakan) (S-07, dengan paginasi)")
    public ResponseEntity<ApiResponse<List<ValidationLogDto>>> getValidationLogs(
            @RequestParam(required = false) UUID sessionId,
            @RequestParam(required = false) ValidationResult result,
            @RequestParam(defaultValue = "100") int limit,
            @RequestParam(defaultValue = "0") int offset
    ) {
        return ResponseEntity.ok(ApiResponse.ok(
                "Daftar attendance validation logs",
                reportService.getValidationLogs(sessionId, result, limit, offset)
        ));
    }

    @GetMapping("/logs/attendance-history")
    @Operation(summary = "Riwayat perubahan/koreksi status presensi (immutable history K-03, dengan paginasi)")
    public ResponseEntity<ApiResponse<List<AttendanceRecordHistoryDto>>> getAttendanceHistory(
            @RequestParam(required = false) UUID recordId,
            @RequestParam(defaultValue = "100") int limit,
            @RequestParam(defaultValue = "0") int offset
    ) {
        return ResponseEntity.ok(ApiResponse.ok(
                "Riwayat koreksi presensi",
                reportService.getAttendanceHistoryLogs(recordId, limit, offset)
        ));
    }
}
