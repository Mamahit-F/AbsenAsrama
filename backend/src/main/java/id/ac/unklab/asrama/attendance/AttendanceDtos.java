package id.ac.unklab.asrama.attendance;

import id.ac.unklab.asrama.common.DomainEnums.AttendanceMethod;
import id.ac.unklab.asrama.common.DomainEnums.AttendanceStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class AttendanceDtos {

    private AttendanceDtos() {}

    public record ManualAttendanceRequest(
            @NotNull(message = "sessionId wajib diisi")
            UUID sessionId,

            @NotNull(message = "residentId wajib diisi")
            UUID residentId,

            @NotNull(message = "Status kehadiran (HADIR atau TIDAK_HADIR) wajib diisi")
            AttendanceStatus status,

            @NotBlank(message = "Alasan wajib diisi untuk presensi manual (J-03)")
            String reason
    ) {}

    public record CorrectAttendanceRequest(
            @NotNull(message = "Status baru wajib diisi")
            AttendanceStatus status,

            @NotBlank(message = "Alasan koreksi (correctionReason) wajib diisi")
            String correctionReason
    ) {}

    public record AttendanceRecordDto(
            UUID id,
            UUID sessionId,
            UUID residentId,
            String residentNim,
            String residentName,
            AttendanceStatus status,
            AttendanceMethod method,
            String reason,
            UUID recordedBy,
            String recordedByUsername,
            Boolean faceMatch,
            Boolean livenessPassed,
            Double latitude,
            Double longitude,
            Double accuracyM,
            Double distanceM,
            Boolean locationValid,
            UUID correctedBy,
            String correctionReason,
            OffsetDateTime correctedAt,
            OffsetDateTime recordedAt
    ) {}

    public record AttendanceScanResultResponse(
            UUID recordId,
            UUID sessionId,
            UUID residentId,
            String residentNim,
            String residentName,
            AttendanceStatus status,
            AttendanceMethod method,
            boolean faceMatch,
            double similarityScore,
            boolean livenessPassed,
            double livenessScore,
            Boolean locationValid,
            Double distanceM,
            OffsetDateTime recordedAt,
            Map<String, Long> stageLatenciesMs
    ) {}

    public record GeofenceCheckResult(
            boolean isValid,
            Double distanceM,
            String reason
    ) {}

    public record SessionRecapDto(
            UUID sessionId,
            String scheduleName,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            int totalRequiredResidents,
            int totalHadir,
            int totalTidakHadir,
            int totalBelumPresensi,
            int scanCount,
            int guardAssistedCount,
            int manualCount,
            List<AttendanceRecordDto> records
    ) {}

    public record DashboardStatsDto(
            long totalActiveResidents,
            long totalEnrolledFaces,
            long totalOpenSessions,
            long todayTotalHadir,
            long todayTotalTidakHadir,
            double overallAttendanceRatePercent,
            List<SessionRecapSummaryItem> recentSessions
    ) {}

    public record SessionRecapSummaryItem(
            UUID sessionId,
            String scheduleName,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            String status,
            long hadirCount,
            long tidakHadirCount
    ) {}
}
