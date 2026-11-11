package id.ac.unklab.asrama.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import id.ac.unklab.asrama.common.ApiResponse;
import id.ac.unklab.asrama.config.AppProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private final AppProperties appProperties;
    private final ObjectMapper objectMapper;
    private final Map<String, WindowCounter> counters = new ConcurrentHashMap<>();
    private java.util.function.Supplier<Long> minuteWindowSupplier = () -> Instant.now().getEpochSecond() / 60;

    public RateLimitFilter(AppProperties appProperties, ObjectMapper objectMapper) {
        this.appProperties = appProperties;
        this.objectMapper = objectMapper;
    }

    public void setMinuteWindowSupplier(java.util.function.Supplier<Long> minuteWindowSupplier) {
        this.minuteWindowSupplier = minuteWindowSupplier != null ? minuteWindowSupplier : () -> Instant.now().getEpochSecond() / 60;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String uri = request.getRequestURI();
        int limitPerMinute = resolveLimitForPath(uri);
        if (limitPerMinute > 0) {
            String clientKey = resolveClientIp(request) + ":" + resolveBucketType(uri);
            if (!allowRequest(clientKey, limitPerMinute)) {
                response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                ApiResponse<Void> body = ApiResponse.error(
                        "RATE_LIMIT_EXCEEDED",
                        "Terlalu banyak permintaan dalam 1 menit. Silakan tunggu sebentar dan coba kembali."
                );
                response.getWriter().write(objectMapper.writeValueAsString(body));
                return;
            }
        }
        filterChain.doFilter(request, response);
    }

    private int resolveLimitForPath(String uri) {
        if (uri == null) {
            return -1;
        }
        if (uri.startsWith("/api/v1/auth/login") || uri.startsWith("/api/v1/auth/register")) {
            return appProperties.rateLimit().authRequestsPerMinute();
        }
        if (uri.contains("/attendance/scan") || uri.contains("/enrollments")) {
            return appProperties.rateLimit().scanRequestsPerMinute();
        }
        return -1;
    }

    private String resolveBucketType(String uri) {
        if (uri.startsWith("/api/v1/auth/")) {
            return "AUTH";
        }
        return "SCAN";
    }

    private String resolveClientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            return xff.split(",")[0].trim();
        }
        return request.getRemoteAddr() != null ? request.getRemoteAddr() : "unknown";
    }

    private boolean allowRequest(String key, int maxPerMinute) {
        long currentMinuteWindow = minuteWindowSupplier.get();
        WindowCounter counter = counters.compute(key, (k, existing) -> {
            if (existing == null || existing.minuteWindow != currentMinuteWindow) {
                return new WindowCounter(currentMinuteWindow, new AtomicInteger(1));
            }
            existing.count.incrementAndGet();
            return existing;
        });
        return counter.count.get() <= maxPerMinute;
    }

    public void resetAllCounters() {
        counters.clear();
        this.minuteWindowSupplier = () -> Instant.now().getEpochSecond() / 60;
    }

    private record WindowCounter(long minuteWindow, AtomicInteger count) {}
}
