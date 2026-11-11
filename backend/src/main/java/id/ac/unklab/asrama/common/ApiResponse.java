package id.ac.unklab.asrama.common;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(
        boolean success,
        String code,
        String message,
        T data,
        Map<String, Object> metadata,
        OffsetDateTime timestamp
) {
    private static final ZoneId WITA_ZONE = ZoneId.of("Asia/Makassar");

    public static <T> ApiResponse<T> ok(String message, T data) {
        return new ApiResponse<>(true, "OK", message, data, null, OffsetDateTime.now(WITA_ZONE));
    }

    public static <T> ApiResponse<T> ok(String message, T data, Map<String, Object> metadata) {
        return new ApiResponse<>(true, "OK", message, data, metadata, OffsetDateTime.now(WITA_ZONE));
    }

    public static <T> ApiResponse<T> created(String message, T data) {
        return new ApiResponse<>(true, "CREATED", message, data, null, OffsetDateTime.now(WITA_ZONE));
    }

    public static <T> ApiResponse<T> error(String code, String message) {
        return new ApiResponse<>(false, code, message, null, null, OffsetDateTime.now(WITA_ZONE));
    }

    public static <T> ApiResponse<T> error(String code, String message, Map<String, Object> metadata) {
        return new ApiResponse<>(false, code, message, null, metadata, OffsetDateTime.now(WITA_ZONE));
    }
}
