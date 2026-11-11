package id.ac.unklab.asrama.violation;

import id.ac.unklab.asrama.common.DomainEnums.CaseStatus;
import id.ac.unklab.asrama.common.DomainEnums.RequestType;
import id.ac.unklab.asrama.common.DomainEnums.ViolationSource;
import id.ac.unklab.asrama.common.DomainEnums.ViolationStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class ViolationDtos {

    private ViolationDtos() {}

    public record CreateManualViolationRequest(
            @NotNull(message = "residentId wajib diisi")
            UUID residentId,

            UUID semesterId,

            @PositiveOrZero(message = "Poin pelanggaran tidak boleh negatif")
            int points,

            @NotBlank(message = "Alasan pelanggaran manual wajib diisi")
            String reason
    ) {}

    public record UpdateViolationRequest(
            @PositiveOrZero(message = "Poin pelanggaran tidak boleh negatif")
            int points,

            @NotNull(message = "Status pelanggaran (ACTIVE atau VOID) wajib diisi")
            ViolationStatus status,

            @NotBlank(message = "Alasan perubahan poin/status pelanggaran wajib diisi")
            String reason
    ) {}

    public record ViolationDto(
            UUID id,
            UUID residentId,
            String residentNim,
            String residentName,
            UUID attendanceRecordId,
            UUID semesterId,
            int points,
            ViolationStatus status,
            ViolationSource source,
            String reason,
            UUID createdBy,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt
    ) {}

    public record ViolationPointHistoryDto(
            UUID id,
            UUID violationId,
            Integer oldPoints,
            Integer newPoints,
            ViolationStatus oldStatus,
            ViolationStatus newStatus,
            UUID changedBy,
            String reason,
            OffsetDateTime changedAt
    ) {}

    public record CreateCoachingRecordRequest(
            @NotNull(message = "residentId wajib diisi")
            UUID residentId,

            UUID semesterId,
            LocalDate coachingDate,

            @NotBlank(message = "Topik pembinaan wajib diisi")
            String topic,

            String notes
    ) {}

    public record CoachingRecordDto(
            UUID id,
            UUID residentId,
            String residentNim,
            String residentName,
            UUID semesterId,
            UUID coachedBy,
            LocalDate coachingDate,
            String topic,
            String notes,
            OffsetDateTime createdAt
    ) {}

    public record CreateHelpRequestDto(
            UUID residentId,

            @NotNull(message = "Jenis permintaan (PERMINTAAN_BANTUAN atau LAPORAN_TINDAK_LANJUT) wajib diisi")
            RequestType requestType,

            @NotBlank(message = "Subjek wajib diisi")
            String subject,

            @NotBlank(message = "Deskripsi wajib diisi")
            String description
    ) {}

    public record UpdateHelpRequestStatusDto(
            @NotNull(message = "Status penanganan baru wajib diisi")
            CaseStatus status,

            String note
    ) {}

    public record HelpRequestDto(
            UUID id,
            UUID residentId,
            String residentNim,
            String residentName,
            RequestType requestType,
            String subject,
            String description,
            CaseStatus status,
            UUID handledBy,
            OffsetDateTime resolvedAt,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt
    ) {}

    public record HelpRequestUpdateHistoryDto(
            UUID id,
            UUID requestId,
            CaseStatus oldStatus,
            CaseStatus newStatus,
            String note,
            UUID updatedBy,
            OffsetDateTime createdAt
    ) {}
}
