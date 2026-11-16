package id.ac.unklab.asrama.schedule;

import com.fasterxml.jackson.annotation.JsonCreator;
import id.ac.unklab.asrama.common.DomainEnums.ResidenceCategory;
import id.ac.unklab.asrama.common.DomainEnums.ScheduleKind;
import id.ac.unklab.asrama.common.DomainEnums.ScheduleStatus;
import id.ac.unklab.asrama.common.DomainEnums.SessionStatus;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class ScheduleDtos {

    private ScheduleDtos() {}

    public record ActivityTypeDto(
            UUID id,
            String code,
            String name,
            String description,
            boolean isActive
    ) {}

    public record CreateScheduleRequest(
            @NotBlank(message = "Nama jadwal kegiatan wajib diisi")
            String name,

            UUID activityTypeId,

            @NotNull(message = "Jenis jadwal (ONE_TIME atau RECURRING) wajib diisi")
            ScheduleKind scheduleKind,

            OffsetDateTime startsAt,
            OffsetDateTime endsAt,

            List<Short> repeatDays,
            LocalTime startTime,
            LocalTime endTime,
            LocalDate validFrom,
            LocalDate validTo,
            String description,
            String hallName
    ) {
        public CreateScheduleRequest(
                String name,
                UUID activityTypeId,
                ScheduleKind scheduleKind,
                OffsetDateTime startsAt,
                OffsetDateTime endsAt,
                List<Short> repeatDays,
                LocalTime startTime,
                LocalTime endTime,
                LocalDate validFrom,
                LocalDate validTo,
                String description
        ) {
            this(name, activityTypeId, scheduleKind, startsAt, endsAt, repeatDays, startTime, endTime, validFrom, validTo, description, null);
        }
    }

    public record UpdateScheduleRequest(
            @NotBlank(message = "Nama jadwal kegiatan wajib diisi")
            String name,
            UUID activityTypeId,
            ScheduleKind scheduleKind,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            List<Short> repeatDays,
            LocalTime startTime,
            LocalTime endTime,
            LocalDate validFrom,
            LocalDate validTo,
            ScheduleStatus status,
            String description,
            String hallName
    ) {
        public UpdateScheduleRequest(
                String name,
                UUID activityTypeId,
                ScheduleKind scheduleKind,
                OffsetDateTime startsAt,
                OffsetDateTime endsAt,
                List<Short> repeatDays,
                LocalTime startTime,
                LocalTime endTime,
                LocalDate validFrom,
                LocalDate validTo,
                ScheduleStatus status,
                String description
        ) {
            this(name, activityTypeId, scheduleKind, startsAt, endsAt, repeatDays, startTime, endTime, validFrom, validTo, status, description, null);
        }
    }

    public record ScheduleDto(
            UUID id,
            String name,
            UUID activityTypeId,
            String activityTypeCode,
            String activityTypeName,
            ScheduleKind scheduleKind,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            List<Short> repeatDays,
            LocalTime startTime,
            LocalTime endTime,
            LocalDate validFrom,
            LocalDate validTo,
            ScheduleStatus status,
            String description,
            UUID createdBy,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt,
            String hallName
    ) {
        public ScheduleDto(
                UUID id,
                String name,
                UUID activityTypeId,
                String activityTypeCode,
                String activityTypeName,
                ScheduleKind scheduleKind,
                OffsetDateTime startsAt,
                OffsetDateTime endsAt,
                List<Short> repeatDays,
                LocalTime startTime,
                LocalTime endTime,
                LocalDate validFrom,
                LocalDate validTo,
                ScheduleStatus status,
                String description,
                UUID createdBy,
                OffsetDateTime createdAt,
                OffsetDateTime updatedAt
        ) {
            this(id, name, activityTypeId, activityTypeCode, activityTypeName, scheduleKind, startsAt, endsAt,
                    repeatDays, startTime, endTime, validFrom, validTo, status, description, createdBy, createdAt, updatedAt, null);
        }
    }

    public record CreateSessionRequest(
            @NotNull(message = "scheduleId wajib diisi")
            UUID scheduleId,

            @NotNull(message = "Waktu mulai sesi (startsAt) wajib diisi")
            OffsetDateTime startsAt,

            @NotNull(message = "Waktu selesai sesi (endsAt) wajib diisi")
            OffsetDateTime endsAt,

            String hallName
    ) {
        public CreateSessionRequest(UUID scheduleId, OffsetDateTime startsAt, OffsetDateTime endsAt) {
            this(scheduleId, startsAt, endsAt, null);
        }
    }

    public record UpdateSessionRequest(
            String name,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            SessionStatus status,
            String hallName,
            GeofenceConfigRequest geofence
    ) {}

    public record MaterializeSessionsRequest(
            @NotNull(message = "Tanggal awal (fromDate) wajib diisi")
            LocalDate fromDate,

            @NotNull(message = "Tanggal akhir (toDate) wajib diisi")
            LocalDate toDate
    ) {}

    public record GeofenceConfigRequest(
            String locationName,
            boolean isEnabled,

            @NotNull(message = "Latitude wajib diisi")
            Double latitude,

            @NotNull(message = "Longitude wajib diisi")
            Double longitude,

            @Positive(message = "Radius meter harus lebih dari 0")
            int radiusM,

            Double maxAccuracyM
    ) {}

    public record GeofenceDto(
            UUID id,
            UUID sessionId,
            String locationName,
            boolean isEnabled,
            double latitude,
            double longitude,
            int radiusM,
            Double maxAccuracyM
    ) {}

    public record SessionDto(
            UUID id,
            UUID scheduleId,
            String scheduleName,
            String activityTypeCode,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            SessionStatus status,
            UUID createdBy,
            OffsetDateTime closedAt,
            GeofenceDto geofence,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt,
            String hallName
    ) {
        public SessionDto(
                UUID id,
                UUID scheduleId,
                String scheduleName,
                String activityTypeCode,
                OffsetDateTime startsAt,
                OffsetDateTime endsAt,
                SessionStatus status,
                UUID createdBy,
                OffsetDateTime closedAt,
                GeofenceDto geofence,
                OffsetDateTime createdAt,
                OffsetDateTime updatedAt
        ) {
            this(id, scheduleId, scheduleName, activityTypeCode, startsAt, endsAt, status, createdBy, closedAt, geofence, createdAt, updatedAt, null);
        }
        public boolean isGeoEnabled() {
            return geofence != null && geofence.isEnabled();
        }

        public Double geoLatitude() {
            return geofence != null ? geofence.latitude() : null;
        }

        public Double geoLongitude() {
            return geofence != null ? geofence.longitude() : null;
        }

        public int geoRadiusMeters() {
            return geofence != null ? geofence.radiusM() : 50;
        }
    }

    public record CreateExemptionRequest(
            @NotBlank(message = "Judul pembebasan/hari libur wajib diisi")
            String title,

            @NotNull(message = "Tanggal mulai (startsOn) wajib diisi")
            LocalDate startsOn,

            @NotNull(message = "Tanggal selesai (endsOn) wajib diisi")
            LocalDate endsOn,

            ResidenceCategory residenceCategory,
            UUID activityTypeId,
            UUID residentId,

            @NotBlank(message = "Alasan pembebasan wajib diisi")
            String reason
    ) {}

    public record ExemptionDto(
            UUID id,
            String title,
            LocalDate startsOn,
            LocalDate endsOn,
            ResidenceCategory residenceCategory,
            UUID activityTypeId,
            UUID residentId,
            String reason,
            UUID createdBy,
            OffsetDateTime createdAt
    ) {}

    public record ScheduleHistoryEntryDto(
            UUID id,
            UUID scheduleId,
            UUID actorId,
            String actorUsername,
            String action,
            String oldDataJson,
            String newDataJson,
            String description,
            OffsetDateTime createdAt
    ) {}

    public record ScheduleSettingsDto(
            int maxDailySessions
    ) {}

    public record UpdateScheduleSettingsRequest(
            @NotNull(message = "Batas maksimal sesi per hari wajib diisi")
            @Min(value = 1, message = "Minimal 1 sesi per hari")
            @Max(value = 3, message = "Maksimal 3 sesi per hari")
            Integer maxDailySessions
    ) {
        @JsonCreator
        public UpdateScheduleSettingsRequest {}
    }
}
