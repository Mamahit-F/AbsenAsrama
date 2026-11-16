package id.ac.unklab.asrama.auth;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
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
            @JsonProperty("old_password")
            @JsonAlias({"oldPassword", "currentPassword", "current_password"})
            String currentPassword,

            @NotBlank(message = "Password baru wajib diisi")
            @Size(min = 6, max = 72, message = "Password baru minimal 6 karakter")
            @JsonProperty("new_password")
            @JsonAlias({"newPassword"})
            String newPassword,

            @JsonProperty("confirm_password")
            @JsonAlias({"confirmPassword"})
            String confirmPassword
    ) {
        @JsonCreator
        public ChangePasswordRequest {}

        public ChangePasswordRequest(String currentPassword, String newPassword) {
            this(currentPassword, newPassword, null);
        }
    }

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
            boolean isActive,
            String hallName
    ) {
        public UserSessionDto(UUID userId, String username, String email, UserRole role, UUID residentId, ResidentStatus residentStatus, boolean isActive) {
            this(userId, username, email, role, residentId, residentStatus, isActive, null);
        }
    }

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
            boolean isLocked,
            String hallName
    ) {
        public UserLoginLookupRow(UUID id, String username, String email, String passwordHash, UserRole role, UUID residentId, ResidentStatus residentStatus, boolean isActive, int failedLoginAttempts, OffsetDateTime lockedUntil, boolean isLocked) {
            this(id, username, email, passwordHash, role, residentId, residentStatus, isActive, failedLoginAttempts, lockedUntil, isLocked, null);
        }
    }
}
