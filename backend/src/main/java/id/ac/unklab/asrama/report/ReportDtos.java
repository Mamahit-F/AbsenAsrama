package id.ac.unklab.asrama.report;

import id.ac.unklab.asrama.common.DomainEnums.AttendanceMethod;
import id.ac.unklab.asrama.common.DomainEnums.AttendanceStatus;
import id.ac.unklab.asrama.common.DomainEnums.ValidationResult;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class ReportDtos {

    private ReportDtos() {}

    public record AttendanceReportRowDto(
            UUID recordId,
            UUID sessionId,
            String scheduleName,
            String activityCode,
            OffsetDateTime sessionStartsAt,
            OffsetDateTime sessionEndsAt,
            UUID residentId,
            String residentNim,
            String residentName,
            String residenceCategory,
            String building,
            String roomNumber,
            AttendanceStatus status,
            AttendanceMethod method,
            String reason,
            UUID recordedBy,
            String recordedByUsername,
            Boolean faceMatch,
            Boolean livenessPassed,
            Boolean locationValid,
            Double distanceM,
            Boolean isGeoEnabled,
            Double userLatitude,
            Double userLongitude,
            Double userAccuracyM,
            Double sessionLatitude,
            Double sessionLongitude,
            Integer sessionRadiusM,
            String correctionReason,
            OffsetDateTime recordedAt
    ) {}

    public record PeriodRecapReportDto(
            OffsetDateTime from,
            OffsetDateTime to,
            long totalRecords,
            long hadirCount,
            long tidakHadirCount,
            long scanCount,
            long guardAssistedCount,
            long manualCount,
            List<AttendanceReportRowDto> rows
    ) {}

    public record AuditLogDto(
            UUID id,
            UUID actorId,
            String actorUsername,
            String action,
            String entityType,
            UUID entityId,
            String oldDataJson,
            String newDataJson,
            String description,
            OffsetDateTime createdAt
    ) {}

    public record ValidationLogDto(
            UUID id,
            UUID sessionId,
            UUID residentId,
            String residentNim,
            String residentName,
            AttendanceMethod method,
            ValidationResult result,
            Double faceScore,
            Double livenessScore,
            Boolean faceMatch,
            Boolean livenessPassed,
            Boolean locationValid,
            Double distanceM,
            Double accuracyM,
            String locationReason,
            String rejectionReason,
            OffsetDateTime attemptedAt
    ) {}

    public record AttendanceRecordHistoryDto(
            UUID id,
            UUID recordId,
            AttendanceStatus oldStatus,
            AttendanceStatus newStatus,
            AttendanceMethod oldMethod,
            AttendanceMethod newMethod,
            String oldReason,
            String newReason,
            UUID changedBy,
            String changedByUsername,
            String correctionReason,
            OffsetDateTime changedAt
    ) {}
}
