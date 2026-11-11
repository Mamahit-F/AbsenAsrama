package id.ac.unklab.asrama.admin;

import id.ac.unklab.asrama.common.DomainEnums.ResidenceCategory;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class AdminDtos {

    private AdminDtos() {}

    public record CreateResidentRequest(
            @NotBlank(message = "NIM wajib diisi")
            @Size(min = 5, max = 30)
            String nim,

            @NotBlank(message = "Nama lengkap wajib diisi")
            @Size(min = 2, max = 120)
            String fullName,

            ResidentStatus status,
            ResidenceCategory residenceCategory,
            String building,
            String roomNumber
    ) {}

    public record UpdateResidentRequest(
            @NotBlank(message = "NIM wajib diisi")
            @Size(min = 5, max = 30)
            String nim,

            @NotBlank(message = "Nama lengkap wajib diisi")
            @Size(min = 2, max = 120)
            String fullName,

            @NotNull(message = "Status penghuni wajib diisi")
            ResidentStatus status,

            @NotNull(message = "Kategori tempat tinggal wajib diisi")
            ResidenceCategory residenceCategory,

            String building,
            String roomNumber
    ) {}

    public record ChangeResidentStatusRequest(
            @NotNull(message = "Status baru (AKTIF atau NONAKTIF) wajib diisi")
            ResidentStatus status
    ) {}

    public record CsvRowValidationError(
            int rowNumber,
            String nim,
            String errorMessage
    ) {}

    public record CsvImportSummaryDto(
            int totalRowsProcessed,
            int insertedCount,
            int updatedCount,
            int rejectedCount,
            List<CsvRowValidationError> errors
    ) {}

    public record CreateStaffUserRequest(
            @NotBlank(message = "Username wajib diisi")
            @Size(min = 3, max = 60)
            String username,

            @Email(message = "Format email tidak valid")
            String email,

            @NotBlank(message = "Password awal wajib diisi")
            @Size(min = 8, max = 72)
            String password,

            @NotNull(message = "Role petugas (MONITOR, VILLAGE_DEAN, atau ADMIN) wajib diisi")
            UserRole role
    ) {}

    public record ResetUserPasswordRequest(
            @NotBlank(message = "Password baru wajib diisi")
            @Size(min = 8, max = 72)
            String newPassword
    ) {}

    public record ChangeUserActiveRequest(
            boolean isActive
    ) {}

    public record ChangeUserRoleRequest(
            @NotNull(message = "Role baru wajib diisi")
            UserRole role
    ) {}

    public record UserAccountDto(
            UUID id,
            UUID residentId,
            String residentNim,
            String residentName,
            String username,
            String email,
            UserRole role,
            boolean isActive,
            int failedLoginAttempts,
            OffsetDateTime lockedUntil,
            OffsetDateTime lastLoginAt,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt
    ) {}
}
