package id.ac.unklab.asrama.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

@ConfigurationProperties(prefix = "app")
public record AppProperties(
        String timezone,
        RlsProperties rls,
        JwtProperties jwt,
        CorsProperties cors,
        RateLimitProperties rateLimit,
        FaceProperties face,
        AiProperties ai,
        StorageProperties storage
) {
    public record RlsProperties(boolean enabled) {}

    public record JwtProperties(
            String secret,
            String issuer,
            long accessTokenExpirationMs,
            long refreshTokenExpirationMs
    ) {}

    public record CorsProperties(List<String> allowedOrigins) {}

    public record RateLimitProperties(
            int authRequestsPerMinute,
            int scanRequestsPerMinute
    ) {}

    public record FaceProperties(
            double similarityThreshold,
            double duplicateThreshold,
            double livenessThreshold,
            double qualityThreshold,
            String modelVersion,
            int retentionDays
    ) {}

    public record AiProperties(
            String baseUrl,
            String apiKey,
            int connectTimeoutMs,
            int readTimeoutMs
    ) {}

    public record StorageProperties(
            String supabaseUrl,
            String serviceRoleKey,
            String bucket,
            int signedUrlTtlSeconds
    ) {
        public StorageProperties {
            if (signedUrlTtlSeconds <= 0) {
                signedUrlTtlSeconds = 120;
            }
        }
    }
}
