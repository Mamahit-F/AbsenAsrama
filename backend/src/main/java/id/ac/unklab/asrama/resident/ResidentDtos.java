package id.ac.unklab.asrama.resident;

import id.ac.unklab.asrama.common.DomainEnums.ResidenceCategory;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class ResidentDtos {

    private ResidentDtos() {}

    public record ResidentProfileDto(
            UUID id,
            String nim,
            String fullName,
            ResidentStatus status,
            ResidenceCategory residenceCategory,
            String building,
            String roomNumber,
            boolean hasActiveFaceProfile,
            OffsetDateTime faceEnrolledAt,
            boolean hasActiveConsent,
            String activeConsentVersion,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt
    ) {}

    public record ConsentRequest(
            @NotBlank(message = "Versi persetujuan (consentVersion) wajib diisi")
            String consentVersion,
            String evidencePath
    ) {}

    public record ConsentDto(
            UUID id,
            UUID residentId,
            String consentVersion,
            OffsetDateTime consentedAt,
            OffsetDateTime revokedAt,
            String evidencePath
    ) {}

    public record EmergencyContactRequest(
            @NotBlank(message = "Nama lengkap kontak darurat wajib diisi")
            @Size(max = 120)
            String fullName,

            @NotBlank(message = "Hubungan keluarga/relasi wajib diisi")
            @Size(max = 60)
            String relationship,

            @NotBlank(message = "Nomor telepon wajib diisi")
            @Size(max = 30)
            String phone,

            boolean isPrimary
    ) {}

    public record EmergencyContactDto(
            UUID id,
            UUID residentId,
            String fullName,
            String relationship,
            String phone,
            boolean isPrimary,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt
    ) {}
}
