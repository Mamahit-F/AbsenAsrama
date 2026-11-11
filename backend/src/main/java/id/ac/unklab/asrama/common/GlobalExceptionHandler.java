package id.ac.unklab.asrama.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusinessException(BusinessException ex) {
        return ResponseEntity.status(ex.getStatus())
                .body(ApiResponse.error(ex.getErrorCode(), ex.getMessage(), ex.getDetails()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidationException(MethodArgumentNotValidException ex) {
        Map<String, Object> fieldErrors = new LinkedHashMap<>();
        for (FieldError err : ex.getBindingResult().getFieldErrors()) {
            fieldErrors.put(err.getField(), err.getDefaultMessage());
        }
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error("VALIDATION_ERROR", "Data input tidak valid", fieldErrors));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiResponse<Void>> handleMaxUploadSize(MaxUploadSizeExceededException ex) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(ApiResponse.error("FILE_TOO_LARGE", "Ukuran file melebihi batas maksimum 5 MB"));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiResponse<Void>> handleAccessDenied(AccessDeniedException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error("FORBIDDEN", "Akses ditolak: Anda tidak memiliki izin untuk aksi ini"));
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiResponse<Void>> handleAuthenticationException(AuthenticationException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ApiResponse.error("UNAUTHORIZED", "Autentikasi diperlukan atau sesi telah berakhir"));
    }

    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<ApiResponse<Void>> handleDuplicateKey(DuplicateKeyException ex) {
        String raw = ex.getMostSpecificCause().getMessage();
        if (raw != null && raw.contains("unique_resident_session")) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ApiResponse.error("ALREADY_ATTENDED", "Anda sudah melakukan presensi pada sesi ini"));
        }
        if (raw != null && raw.contains("Wajah sudah terdaftar")) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ApiResponse.error("DUPLICATE_FACE", "Wajah sudah terdaftar"));
        }
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.error("DUPLICATE_DATA", extractSafePostgresMessage(raw, "Data duplikat terdeteksi")));
    }

    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ApiResponse<Void>> handleDataAccessException(DataAccessException ex) {
        Throwable root = ex.getMostSpecificCause();
        String sqlState = (root instanceof SQLException sqlEx) ? sqlEx.getSQLState() : null;
        String rawMsg = root != null ? root.getMessage() : ex.getMessage();

        if ("42501".equals(sqlState)) {
            log.warn("Database RLS/Privilege violation blocked operation: {}", extractSafePostgresMessage(rawMsg, "Access denied"));
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(ApiResponse.error("DB_ACCESS_DENIED", extractSafePostgresMessage(rawMsg, "Operasi ditolak oleh kebijakan keamanan database")));
        }
        if ("23503".equals(sqlState)) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ApiResponse.error("REFERENTIAL_INTEGRITY",
                            "Data tidak dapat dihapus atau diubah karena masih terkait dengan riwayat presensi/data aktif"));
        }
        if ("23P01".equals(sqlState)
                || (rawMsg != null && (rawMsg.contains("sessions_no_overlap") || rawMsg.contains("no_overlapping_active_schedules")))) {
            String overlapMsg = (rawMsg != null && rawMsg.contains("no_overlapping_active_schedules"))
                    ? "Rentang waktu jadwal sekali waktu (ONE_TIME) beririsan dengan jadwal aktif lainnya (J-06)"
                    : "Rentang waktu sesi presensi beririsan dengan sesi aktif lainnya (J-06)";
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ApiResponse.error("SCHEDULE_OVERLAP", overlapMsg));
        }
        if ("P0001".equals(sqlState) || "22023".equals(sqlState) || "23514".equals(sqlState)) {
            String cleanMsg = extractSafePostgresMessage(rawMsg, "Permintaan ditolak oleh validasi aturan database");
            HttpStatus status = cleanMsg.contains("sudah memiliki") || cleanMsg.contains("Wajah sudah terdaftar")
                    ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
            return ResponseEntity.status(status)
                    .body(ApiResponse.error("DOMAIN_RULE_VIOLATION", cleanMsg));
        }

        log.error("Database execution error (state={})", sqlState, ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error("DATABASE_ERROR", "Terjadi kesalahan saat memproses transaksi database"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleGenericException(Exception ex) {
        log.error("Unhandled internal server error", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error("INTERNAL_ERROR", "Terjadi kesalahan internal pada server"));
    }

    private String extractSafePostgresMessage(String raw, String fallback) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        int errIdx = raw.indexOf("ERROR:");
        String msg = errIdx >= 0 ? raw.substring(errIdx + 6).trim() : raw.trim();
        int newline = msg.indexOf('\n');
        if (newline > 0) {
            msg = msg.substring(0, newline).trim();
        }
        return msg.isEmpty() ? fallback : msg;
    }
}
