package id.ac.unklab.asrama.schedule;

import id.ac.unklab.asrama.common.ApiResponse;
import id.ac.unklab.asrama.common.DomainEnums.ScheduleStatus;
import id.ac.unklab.asrama.common.DomainEnums.SessionStatus;
import id.ac.unklab.asrama.schedule.ScheduleDtos.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/schedules")
@Tag(name = "04. Schedule, Session & Geofence Management", description = "CRUD jadwal sekali waktu & berulang (J-06), pencegahan sesi bertumpuk, geofence PostGIS, pembebasan kegiatan, serta proteksi sesi berpresensi (K-05)")
public class ScheduleController {

    private final ScheduleService scheduleService;

    public ScheduleController(ScheduleService scheduleService) {
        this.scheduleService = scheduleService;
    }

    @GetMapping("/activity-types")
    @Operation(summary = "Daftar master jenis kegiatan kerohanian")
    public ResponseEntity<ApiResponse<List<ActivityTypeDto>>> listActivityTypes() {
        return ResponseEntity.ok(ApiResponse.ok("Daftar jenis kegiatan", scheduleService.listActivityTypes()));
    }

    @GetMapping
    @Operation(summary = "Daftar seluruh jadwal kegiatan (sekali waktu maupun berulang)")
    public ResponseEntity<ApiResponse<List<ScheduleDto>>> listSchedules(
            @RequestParam(required = false) ScheduleStatus status
    ) {
        return ResponseEntity.ok(ApiResponse.ok("Daftar jadwal kegiatan", scheduleService.listSchedules(status)));
    }

    @GetMapping("/{scheduleId}")
    @Operation(summary = "Detail jadwal kegiatan berdasarkan ID")
    public ResponseEntity<ApiResponse<ScheduleDto>> getSchedule(@PathVariable UUID scheduleId) {
        return ResponseEntity.ok(ApiResponse.ok("Detail jadwal kegiatan", scheduleService.getSchedule(scheduleId)));
    }

    @GetMapping("/{scheduleId}/history")
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR', 'VILLAGE_DEAN')")
    @Operation(summary = "Riwayat perubahan jadwal kegiatan (audit trail jadwal)")
    public ResponseEntity<ApiResponse<List<ScheduleHistoryEntryDto>>> getScheduleHistory(@PathVariable UUID scheduleId) {
        return ResponseEntity.ok(ApiResponse.ok("Riwayat perubahan jadwal", scheduleService.getScheduleHistory(scheduleId)));
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR')")
    @Operation(summary = "Membuat jadwal kegiatan baru (ONE_TIME atau RECURRING) dengan validasi jam (J-06)")
    public ResponseEntity<ApiResponse<ScheduleDto>> createSchedule(@Valid @RequestBody CreateScheduleRequest request) {
        ScheduleDto created = scheduleService.createSchedule(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Jadwal kegiatan berhasil dibuat", created));
    }

    @PutMapping("/{scheduleId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR')")
    @Operation(summary = "Memperbarui jadwal kegiatan")
    public ResponseEntity<ApiResponse<ScheduleDto>> updateSchedule(
            @PathVariable UUID scheduleId,
            @Valid @RequestBody UpdateScheduleRequest request
    ) {
        ScheduleDto updated = scheduleService.updateSchedule(scheduleId, request);
        return ResponseEntity.ok(ApiResponse.ok("Jadwal kegiatan berhasil diperbarui", updated));
    }

    @PostMapping("/{scheduleId}/materialize")
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR')")
    @Operation(summary = "Membentuk sesi presensi otomatis dari jadwal untuk rentang tanggal tertentu")
    public ResponseEntity<ApiResponse<Map<String, Object>>> materializeSessions(
            @PathVariable UUID scheduleId,
            @Valid @RequestBody MaterializeSessionsRequest request
    ) {
        Map<String, Object> result = scheduleService.materializeSessions(scheduleId, request);
        return ResponseEntity.ok(ApiResponse.ok("Sesi presensi berhasil dibentuk dari jadwal", result));
    }

    @GetMapping("/sessions")
    @Operation(summary = "Daftar sesi presensi dengan filter status dan jadwal")
    public ResponseEntity<ApiResponse<List<SessionDto>>> listSessions(
            @RequestParam(required = false) SessionStatus status,
            @RequestParam(required = false) UUID scheduleId
    ) {
        return ResponseEntity.ok(ApiResponse.ok("Daftar sesi presensi", scheduleService.listSessions(status, scheduleId)));
    }

    @GetMapping({"/sessions/active", "/active-session"})
    @Operation(summary = "Mendapatkan sesi presensi yang sedang aktif saat ini (J-07)")
    public ResponseEntity<ApiResponse<SessionDto>> getActiveSession() {
        return ResponseEntity.ok(ApiResponse.ok("Sesi presensi aktif saat ini", scheduleService.getActiveSessionOrThrow()));
    }

    @PostMapping({"/sessions", "/sessions/open"})
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR')")
    @Operation(summary = "Membuka sesi presensi baru dengan pencegahan jadwal bertumpuk (J-06)")
    public ResponseEntity<ApiResponse<SessionDto>> createSession(@Valid @RequestBody CreateSessionRequest request) {
        SessionDto created = scheduleService.createSession(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Sesi presensi berhasil dibuka", created));
    }

    @GetMapping("/sessions/{sessionId}/geofence")
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR', 'PENGHUNI', 'VILLAGE_DEAN')")
    @Operation(summary = "Mendapatkan konfigurasi geofence untuk sesi presensi")
    public ResponseEntity<ApiResponse<GeofenceDto>> getSessionGeofence(@PathVariable UUID sessionId) {
        GeofenceDto geofence = scheduleService.getSession(sessionId).geofence();
        return ResponseEntity.ok(ApiResponse.ok(geofence != null ? "Geofence sesi ditemukan" : "Geofence tidak dikonfigurasi", geofence));
    }

    @PutMapping("/sessions/{sessionId}/geofence")
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR')")
    @Operation(summary = "Mengatur koordinat GPS dan radius geofence PostGIS untuk sesi presensi")
    public ResponseEntity<ApiResponse<GeofenceDto>> configureGeofence(
            @PathVariable UUID sessionId,
            @Valid @RequestBody GeofenceConfigRequest request
    ) {
        GeofenceDto geofence = scheduleService.configureSessionGeofence(sessionId, request);
        return ResponseEntity.ok(ApiResponse.ok("Konfigurasi geofence sesi berhasil disimpan", geofence));
    }

    @PostMapping("/sessions/{sessionId}/close")
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR')")
    @Operation(summary = "Menutup sesi yang telah berakhir dan mencatat ketidakhadiran otomatis beserta poin pelanggaran")
    public ResponseEntity<ApiResponse<Map<String, Object>>> closeSession(@PathVariable UUID sessionId) {
        Map<String, Object> result = scheduleService.closeSessionAndGenerateAbsences(sessionId);
        return ResponseEntity.ok(ApiResponse.ok("Sesi presensi ditutup dan ketidakhadiran telah dihitung", result));
    }

    @DeleteMapping("/sessions/{sessionId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'MONITOR')")
    @Operation(summary = "Menghapus sesi presensi (ditolak secara permanen jika sudah memiliki riwayat presensi K-05)")
    public ResponseEntity<ApiResponse<Void>> deleteSession(@PathVariable UUID sessionId) {
        scheduleService.deleteOrCancelSession(sessionId);
        return ResponseEntity.ok(ApiResponse.ok("Sesi presensi yang belum memiliki riwayat berhasil dihapus", null));
    }

    @GetMapping("/exemptions")
    @Operation(summary = "Daftar hari libur atau pembebasan kewajiban kegiatan")
    public ResponseEntity<ApiResponse<List<ExemptionDto>>> listExemptions() {
        return ResponseEntity.ok(ApiResponse.ok("Daftar pembebasan kegiatan", scheduleService.listExemptions()));
    }

    @PostMapping("/exemptions")
    @PreAuthorize("hasAnyRole('ADMIN', 'VILLAGE_DEAN', 'MONITOR')")
    @Operation(summary = "Menambahkan hari libur atau izin pembebasan kewajiban kegiatan")
    public ResponseEntity<ApiResponse<ExemptionDto>> createExemption(@Valid @RequestBody CreateExemptionRequest request) {
        ExemptionDto created = scheduleService.createExemption(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.created("Pembebasan kegiatan berhasil ditambahkan", created));
    }
}
