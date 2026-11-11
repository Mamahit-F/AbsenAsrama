package id.ac.unklab.asrama.auth;

import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class AuthDtos {

    private AuthDtos() {}

    public record RegisterResidentRequest(
            @NotBlank(message = "NIM wajib diisi")
            @Size(min = 5, max = 30, message = "Panjang NIM antara 5 sampai 30 karakter")
            String nim,

            @NotBlank(message = "Nama lengkap wajib diisi")
            @Size(min = 2, max = 120, message = "Nama lengkap wajib diisi")
            String fullName,

            @NotBlank(message = "Password wajib diisi")
            @Size(min = 8, max = 72, message = "Password minimal 8 karakter")
            String password,

            @Email(message = "Format email tidak valid")
            String email
    ) {}

    public record LoginRequest(
            @NotBlank(message = "Username, email, atau NIM wajib diisi")
            String identifier,

            @NotBlank(message = "Password wajib diisi")
            String password
    ) {}

    public record RefreshTokenRequest(
            @NotBlank(message = "Refresh token wajib diisi")
            String refreshToken
    ) {}

    public record LogoutRequest(
            String refreshToken
    ) {}

    public record ChangePasswordRequest(
            @NotBlank(message = "Password lama wajib diisi")
            String currentPassword,

            @NotBlank(message = "Password baru wajib diisi")
            @Size(min = 8, max = 72, message = "Password baru minimal 8 karakter")
            String newPassword
    ) {}

    public record AuthTokenResponse(
            String accessToken,
            String refreshToken,
            String tokenType,
            long expiresInSeconds,
            UserSessionDto user
    ) {}

    public record UserSessionDto(
            UUID userId,
            String username,
            String email,
            UserRole role,
            UUID residentId,
            ResidentStatus residentStatus,
            boolean isActive
    ) {}

    public record UserLoginLookupRow(
            UUID id,
            String username,
            String email,
            String passwordHash,
            UserRole role,
            UUID residentId,
            ResidentStatus residentStatus,
            boolean isActive,
            int failedLoginAttempts,
            OffsetDateTime lockedUntil,
            boolean isLocked
    ) {}
}
