package id.ac.unklab.asrama.violation;

import id.ac.unklab.asrama.common.ApiResponse;
import id.ac.unklab.asrama.common.DomainEnums.CaseStatus;
import id.ac.unklab.asrama.common.DomainEnums.ViolationStatus;
import id.ac.unklab.asrama.security.SecurityUtils;
import id.ac.unklab.asrama.violation.ViolationDtos.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "07. Violations, Coaching & Help Requests",
        description = "Perhitungan dan riwayat poin pelanggaran, catatan pembinaan Village Dean, serta permintaan bantuan & laporan tindak lanjut")
public class ViolationController {

    private final ViolationService violationService;
    private final SecurityUtils securityUtils;

    public ViolationController(ViolationService violationService, SecurityUtils securityUtils) {
        this.violationService = violationService;
        this.securityUtils = securityUtils;
    }

    @GetMapping("/violations")
    @Operation(summary = "Daftar pelanggaran penghuni (otomatis terfilter sesuai role, RLS & paginasi)")
    public ResponseEntity<ApiResponse<List<ViolationDto>>> listViolations(
            @RequestParam(required = false) UUID residentId,
            @RequestParam(required = false) ViolationStatus status,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        return ResponseEntity.ok(ApiResponse.ok("Daftar pelanggaran", violationService.listViolations(residentId, status, limit, offset)));
    }

    @GetMapping({"/violations/my-violations", "/violations/me"})
    @PreAuthorize("hasRole('PENGHUNI')")
    @Operation(summary = "Daftar pelanggaran milik penghuni yang sedang login (dengan paginasi)")
    public ResponseEntity<ApiResponse<List<ViolationDto>>> getMyViolations(
            @RequestParam(required = false) ViolationStatus status,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        UUID myResidentId = securityUtils.getCurrentResidentId();
        return ResponseEntity.ok(ApiResponse.ok("Daftar pelanggaran Anda", violationService.listViolations(myResidentId, status, limit, offset)));
    }

    @PostMapping("/violations")
    @PreAuthorize("hasAnyRole('ADMIN', 'VILLAGE_DEAN', 'MONITOR')")
    @Operation(summary = "Mencatat pelanggaran manual dengan alasan wajib")
    public ResponseEntity<ApiResponse<ViolationDto>> createManualViolation(
            @Valid @RequestBody CreateManualViolationRequest request
    ) {
        ViolationDto created = violationService.createManualViolation(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Pelanggaran manual berhasil dicatat", created));
    }

    @PatchMapping("/violations/{violationId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'VILLAGE_DEAN', 'MONITOR')")
    @Operation(summary = "Mengubah poin atau status pelanggaran (ACTIVE / VOID) dengan riwayat perubahan")
    public ResponseEntity<ApiResponse<ViolationDto>> updateViolation(
            @PathVariable UUID violationId,
            @Valid @RequestBody UpdateViolationRequest request
    ) {
        ViolationDto updated = violationService.updateViolation(violationId, request);
        return ResponseEntity.ok(ApiResponse.ok("Data pelanggaran berhasil diperbarui", updated));
    }

    @GetMapping("/violations/{violationId}/history")
    @Operation(summary = "Riwayat perubahan poin dan status pelanggaran")
    public ResponseEntity<ApiResponse<List<ViolationPointHistoryDto>>> getViolationHistory(@PathVariable UUID violationId) {
        return ResponseEntity.ok(ApiResponse.ok("Riwayat perubahan pelanggaran", violationService.getViolationHistory(violationId)));
    }

    @GetMapping({"/coaching", "/violations/coaching"})
    @Operation(summary = "Daftar catatan pembinaan penghuni (dengan paginasi)")
    public ResponseEntity<ApiResponse<List<CoachingRecordDto>>> listCoaching(
            @RequestParam(required = false) UUID residentId,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        return ResponseEntity.ok(ApiResponse.ok("Daftar catatan pembinaan", violationService.listCoachingRecords(residentId, limit, offset)));
    }

    @PostMapping({"/coaching", "/violations/coaching"})
    @PreAuthorize("hasAnyRole('ADMIN', 'VILLAGE_DEAN')")
    @Operation(summary = "Menambahkan catatan pembinaan penghuni oleh Village Dean / Admin")
    public ResponseEntity<ApiResponse<CoachingRecordDto>> createCoaching(
            @Valid @RequestBody CreateCoachingRecordRequest request
    ) {
        CoachingRecordDto created = violationService.createCoachingRecord(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Catatan pembinaan berhasil disimpan", created));
    }

    @GetMapping({"/help-requests", "/violations/help-requests"})
    @Operation(summary = "Daftar permintaan bantuan mahasiswa & laporan tindak lanjut kampus (dengan paginasi)")
    public ResponseEntity<ApiResponse<List<HelpRequestDto>>> listHelpRequests(
            @RequestParam(required = false) CaseStatus status,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        return ResponseEntity.ok(ApiResponse.ok("Daftar permintaan bantuan & tindak lanjut", violationService.listHelpRequests(status, limit, offset)));
    }

    @PostMapping({"/help-requests", "/violations/help-requests", "/attendance/request-help"})
    @Operation(summary = "Mengajukan permintaan bantuan (PENGHUNI) atau laporan tindak lanjut (MONITOR/VILLAGE_DEAN/ADMIN)")
    public ResponseEntity<ApiResponse<HelpRequestDto>> createHelpRequest(
            @Valid @RequestBody CreateHelpRequestDto request
    ) {
        HelpRequestDto created = violationService.createHelpRequest(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Permintaan/laporan berhasil dikirim", created));
    }

    @PatchMapping({"/help-requests/{requestId}/status", "/violations/help-requests/{requestId}/status"})
    @PreAuthorize("hasAnyRole('ADMIN', 'VILLAGE_DEAN', 'MONITOR')")
    @Operation(summary = "Memperbarui status penanganan permintaan bantuan / laporan tindak lanjut")
    public ResponseEntity<ApiResponse<HelpRequestDto>> updateHelpRequestStatus(
            @PathVariable UUID requestId,
            @Valid @RequestBody UpdateHelpRequestStatusDto request
    ) {
        HelpRequestDto updated = violationService.updateHelpRequestStatus(requestId, request);
        return ResponseEntity.ok(ApiResponse.ok("Status penanganan berhasil diperbarui", updated));
    }

    @GetMapping({"/help-requests/{requestId}/history", "/violations/help-requests/{requestId}/history"})
    @Operation(summary = "Riwayat perubahan status penanganan permintaan bantuan / tindak lanjut")
    public ResponseEntity<ApiResponse<List<HelpRequestUpdateHistoryDto>>> getHelpRequestHistory(@PathVariable UUID requestId) {
        return ResponseEntity.ok(ApiResponse.ok("Riwayat status penanganan", violationService.getHelpRequestHistory(requestId)));
    }
}
