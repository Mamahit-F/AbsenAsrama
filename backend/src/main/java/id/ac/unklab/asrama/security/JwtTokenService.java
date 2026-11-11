package id.ac.unklab.asrama.security;

import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import id.ac.unklab.asrama.config.AppProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class JwtTokenService {

    public static final String DEFAULT_AUDIENCE = "asrama-presensi-client";

    private final SecretKey secretKey;
    private final String issuer;
    private final long accessExpirationMs;
    private final long refreshExpirationMs;
    private final Map<String, Instant> revokedTokens = new ConcurrentHashMap<>();
    private final Map<UUID, Set<String>> activeUserJtis = new ConcurrentHashMap<>();
    private final Map<UUID, Instant> userRevocationCutoffs = new ConcurrentHashMap<>();
    private final Set<UUID> disabledUserIds = ConcurrentHashMap.newKeySet();

    public JwtTokenService(AppProperties properties) {
        String rawSecret = properties.jwt().secret();
        if (rawSecret == null || rawSecret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalArgumentException("JWT secret must be at least 32 bytes (256 bits)");
        }
        this.secretKey = Keys.hmacShaKeyFor(rawSecret.getBytes(StandardCharsets.UTF_8));
        this.issuer = properties.jwt().issuer();
        this.accessExpirationMs = properties.jwt().accessTokenExpirationMs();
        this.refreshExpirationMs = properties.jwt().refreshTokenExpirationMs();
    }

    public String generateAccessToken(UUID userId, String username, UserRole role, UUID residentId) {
        return buildToken(userId, username, role, residentId, "ACCESS", accessExpirationMs);
    }

    public String generateRefreshToken(UUID userId, String username, UserRole role, UUID residentId) {
        return buildToken(userId, username, role, residentId, "REFRESH", refreshExpirationMs);
    }

    private String buildToken(UUID userId, String username, UserRole role, UUID residentId, String tokenType, long ttlMs) {
        Instant now = Instant.now();
        Instant expiry = now.plusMillis(ttlMs);
        String jti = UUID.randomUUID().toString();

        var builder = Jwts.builder()
                .id(jti)
                .issuer(issuer)
                .audience().add(DEFAULT_AUDIENCE).and()
                .subject(userId.toString())
                .claim("username", username)
                .claim("role", role.name())
                .claim("app_role", role.name())
                .claim("type", tokenType)
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiry));

        if (residentId != null) {
            builder.claim("resident_id", residentId.toString());
        }

        activeUserJtis.computeIfAbsent(userId, k -> ConcurrentHashMap.newKeySet()).add(jti);
        return builder.signWith(secretKey, Jwts.SIG.HS256).compact();
    }

    public Claims parseAndValidateToken(String token, String expectedType) {
        Claims claims = Jwts.parser()
                .verifyWith(secretKey)
                .requireIssuer(issuer)
                .requireAudience(DEFAULT_AUDIENCE)
                .build()
                .parseSignedClaims(token)
                .getPayload();

        UUID userId = UUID.fromString(claims.getSubject());
        if (disabledUserIds.contains(userId)) {
            throw new IllegalArgumentException("Akun telah dinonaktifkan oleh administrator");
        }

        String jti = claims.getId();
        if (jti != null && isRevoked(jti)) {
            throw new IllegalArgumentException("Token telah dicabut (logged out)");
        }

        Instant cutoff = userRevocationCutoffs.get(userId);
        if (cutoff != null && claims.getIssuedAt() != null) {
            if (!claims.getIssuedAt().toInstant().isAfter(cutoff)) {
                throw new IllegalArgumentException("Token telah dicabut (akun di-reset atau password diubah)");
            }
        }

        String tokenType = claims.get("type", String.class);
        if (expectedType != null && !expectedType.equals(tokenType)) {
            throw new IllegalArgumentException("Tipe token tidak sesuai");
        }

        return claims;
    }

    public AppPrincipal toPrincipal(Claims claims) {
        UUID userId = UUID.fromString(claims.getSubject());
        String username = claims.get("username", String.class);
        UserRole role = UserRole.valueOf(claims.get("role", String.class));
        String resIdStr = claims.get("resident_id", String.class);
        UUID residentId = (resIdStr != null && !resIdStr.isBlank()) ? UUID.fromString(resIdStr) : null;
        return new AppPrincipal(userId, username, role, residentId, claims.getId());
    }

    public void revokeToken(String jti) {
        revokeToken(jti, Instant.now().plusMillis(refreshExpirationMs));
    }

    public void revokeToken(String jti, Instant expiresAt) {
        if (jti != null) {
            revokedTokens.put(jti, expiresAt != null ? expiresAt : Instant.now().plusMillis(refreshExpirationMs));
        }
        cleanupExpiredRevocations();
    }

    public void revokeAllUserTokens(UUID userId) {
        if (userId == null) {
            return;
        }
        userRevocationCutoffs.put(userId, Instant.now());
        Set<String> jtis = activeUserJtis.remove(userId);
        if (jtis != null) {
            Instant expiry = Instant.now().plusMillis(refreshExpirationMs);
            for (String jti : jtis) {
                revokedTokens.put(jti, expiry);
            }
        }
        cleanupExpiredRevocations();
    }

    public void setUserDisabled(UUID userId, boolean disabled) {
        if (userId == null) {
            return;
        }
        if (disabled) {
            disabledUserIds.add(userId);
            revokeAllUserTokens(userId);
        } else {
            disabledUserIds.remove(userId);
        }
    }

    public boolean isRevoked(String jti) {
        Instant exp = revokedTokens.get(jti);
        if (exp == null) {
            return false;
        }
        if (exp.isBefore(Instant.now())) {
            revokedTokens.remove(jti);
            return false;
        }
        return true;
    }

    public Map<String, Object> buildRlsClaimsMap(AppPrincipal principal) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("sub", principal.userId().toString());
        map.put("role", principal.role().name());
        map.put("app_role", principal.role().name());
        if (principal.residentId() != null) {
            map.put("resident_id", principal.residentId().toString());
        }
        return map;
    }

    public long getAccessExpirationSeconds() {
        return accessExpirationMs / 1000L;
    }

    private void cleanupExpiredRevocations() {
        Instant now = Instant.now();
        revokedTokens.entrySet().removeIf(entry -> entry.getValue().isBefore(now));
    }
}
