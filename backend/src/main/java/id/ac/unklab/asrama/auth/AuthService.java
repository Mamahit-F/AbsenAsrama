package id.ac.unklab.asrama.auth;

import id.ac.unklab.asrama.auth.AuthDtos.*;
import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.security.AppPrincipal;
import id.ac.unklab.asrama.security.JwtTokenService;
import id.ac.unklab.asrama.security.RlsContextManager;
import id.ac.unklab.asrama.security.SecurityUtils;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final AuthRepository authRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenService jwtTokenService;
    private final SecurityUtils securityUtils;
    private final RlsContextManager rlsContextManager;

    @Autowired
    public AuthService(
            AuthRepository authRepository,
            PasswordEncoder passwordEncoder,
            JwtTokenService jwtTokenService,
            SecurityUtils securityUtils,
            RlsContextManager rlsContextManager
    ) {
        this.authRepository = authRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenService = jwtTokenService;
        this.securityUtils = securityUtils;
        this.rlsContextManager = rlsContextManager;
    }

    public AuthService(
            AuthRepository authRepository,
            PasswordEncoder passwordEncoder,
            JwtTokenService jwtTokenService,
            SecurityUtils securityUtils
    ) {
        this(authRepository, passwordEncoder, jwtTokenService, securityUtils, null);
    }

    @Transactional
    public UserSessionDto registerResident(RegisterResidentRequest request) {
        String hashedPassword = passwordEncoder.encode(request.password());
        UUID userId = authRepository.registerResidentAccount(
                request.nim().trim(),
                request.fullName().trim(),
                hashedPassword,
                request.email() != null ? request.email().trim() : null
        );
        log.info("Resident account registered successfully for NIM={}", request.nim().trim());

        UserLoginLookupRow row = authRepository.findUserForLogin(request.nim().trim())
                .orElseThrow(() -> BusinessException.notFound("USER_NOT_FOUND", "Akun tidak ditemukan setelah registrasi"));

        return new UserSessionDto(
                userId != null ? userId : row.id(),
                row.username(),
                row.email(),
                row.role(),
                row.residentId(),
                row.residentStatus(),
                row.isActive()
        );
    }

    @Transactional(noRollbackFor = BusinessException.class)
    public AuthTokenResponse login(LoginRequest request) {
        UserLoginLookupRow user = authRepository.findUserForLogin(request.identifier().trim())
                .orElseThrow(() -> BusinessException.unauthorized("INVALID_CREDENTIALS", "Username/NIM atau password salah"));

        if (!user.isActive()) {
            throw BusinessException.forbidden("ACCOUNT_INACTIVE", "Akun Anda telah dinonaktifkan oleh administrator");
        }

        if (user.residentId() != null && user.residentStatus() == ResidentStatus.NONAKTIF) {
            throw BusinessException.forbidden("RESIDENT_INACTIVE", "Status penghuni Anda saat ini tidak aktif");
        }

        if (user.isLocked()) {
            throw new BusinessException(
                    HttpStatus.LOCKED,
                    "ACCOUNT_LOCKED",
                    "Akun dikunci sementara selama 5 menit karena 5 kali gagal login berturut-turut",
                    Map.of("lockedUntil", user.lockedUntil() != null ? user.lockedUntil().toString() : "")
            );
        }

        if (!passwordEncoder.matches(request.password(), user.passwordHash())) {
            OffsetDateTime lockedUntil = authRepository.registerLoginFailure(user.id());
            if (lockedUntil != null && lockedUntil.isAfter(OffsetDateTime.now())) {
                log.warn("Account locked after 5 failed login attempts: userId={}", user.id());
                throw new BusinessException(
                        HttpStatus.LOCKED,
                        "ACCOUNT_LOCKED",
                        "Akun dikunci selama 5 menit karena 5 kali gagal login berturut-turut",
                        Map.of("lockedUntil", lockedUntil.toString())
                );
            }
            throw BusinessException.unauthorized("INVALID_CREDENTIALS", "Username/NIM atau password salah");
        }

        authRepository.registerLoginSuccess(user.id());
        log.info("User logged in successfully: userId={}, role={}", user.id(), user.role());

        return issueTokens(user);
    }

    @Transactional(readOnly = true)
    public AuthTokenResponse refreshToken(RefreshTokenRequest request) {
        Claims claims;
        try {
            claims = jwtTokenService.parseAndValidateToken(request.refreshToken(), "REFRESH");
        } catch (JwtException | IllegalArgumentException ex) {
            throw BusinessException.unauthorized("INVALID_REFRESH_TOKEN", "Refresh token tidak valid atau telah kedaluwarsa");
        }

        AppPrincipal tokenPrincipal = jwtTokenService.toPrincipal(claims);
        if (rlsContextManager != null) {
            rlsContextManager.applyUserContext(tokenPrincipal.userId(), tokenPrincipal.role(), tokenPrincipal.residentId());
        }

        UUID userId = tokenPrincipal.userId();
        UserLoginLookupRow user = authRepository.findUserById(userId)
                .orElseThrow(() -> BusinessException.unauthorized("USER_NOT_FOUND", "Pengguna tidak ditemukan"));

        if (!user.isActive() || user.isLocked()) {
            throw BusinessException.forbidden("ACCOUNT_UNAVAILABLE", "Akun tidak aktif atau sedang terkunci");
        }

        jwtTokenService.revokeToken(claims.getId(), claims.getExpiration().toInstant());
        return issueTokens(user);
    }

    public void logout(LogoutRequest request) {
        AppPrincipal principal = securityUtils.getCurrentPrincipal();
        if (principal.tokenJti() != null) {
            jwtTokenService.revokeToken(principal.tokenJti(), null);
        }
        if (request != null && request.refreshToken() != null && !request.refreshToken().isBlank()) {
            try {
                Claims refreshClaims = jwtTokenService.parseAndValidateToken(request.refreshToken(), "REFRESH");
                jwtTokenService.revokeToken(refreshClaims.getId(), refreshClaims.getExpiration().toInstant());
            } catch (Exception ignored) {
                // Ignore invalid refresh token on logout
            }
        }
        log.info("User logged out: userId={}", principal.userId());
    }

    @Transactional(readOnly = true)
    public UserSessionDto getCurrentSessionProfile() {
        AppPrincipal principal = securityUtils.getCurrentPrincipal();
        UserLoginLookupRow user = authRepository.findUserById(principal.userId())
                .orElseThrow(() -> BusinessException.notFound("USER_NOT_FOUND", "Profil sesi pengguna tidak ditemukan"));
        return new UserSessionDto(
                user.id(),
                user.username(),
                user.email(),
                user.role(),
                user.residentId(),
                user.residentStatus(),
                user.isActive()
        );
    }

    @Transactional
    public void changeOwnPassword(ChangePasswordRequest request) {
        AppPrincipal principal = securityUtils.getCurrentPrincipal();
        UserLoginLookupRow user = authRepository.findUserById(principal.userId())
                .orElseThrow(() -> BusinessException.notFound("USER_NOT_FOUND", "Pengguna tidak ditemukan"));

        if (!passwordEncoder.matches(request.currentPassword(), user.passwordHash())) {
            throw BusinessException.badRequest("INVALID_CURRENT_PASSWORD", "Password saat ini tidak sesuai");
        }
        String newHash = passwordEncoder.encode(request.newPassword());
        authRepository.updatePasswordHash(user.id(), newHash);
        jwtTokenService.revokeAllUserTokens(user.id());
        log.info("User changed password and revoked active tokens: userId={}", user.id());
    }

    private AuthTokenResponse issueTokens(UserLoginLookupRow user) {
        String accessToken = jwtTokenService.generateAccessToken(user.id(), user.username(), user.role(), user.residentId());
        String refreshToken = jwtTokenService.generateRefreshToken(user.id(), user.username(), user.role(), user.residentId());
        UserSessionDto sessionDto = new UserSessionDto(
                user.id(),
                user.username(),
                user.email(),
                user.role(),
                user.residentId(),
                user.residentStatus(),
                user.isActive()
        );
        return new AuthTokenResponse(
                accessToken,
                refreshToken,
                "Bearer",
                jwtTokenService.getAccessExpirationSeconds(),
                sessionDto
        );
    }
}
