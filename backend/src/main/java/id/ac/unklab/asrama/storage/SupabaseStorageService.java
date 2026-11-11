package id.ac.unklab.asrama.storage;

import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.FacePose;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import id.ac.unklab.asrama.config.AppProperties;
import id.ac.unklab.asrama.security.AppPrincipal;
import id.ac.unklab.asrama.security.SecurityUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class SupabaseStorageService {

    private static final Logger log = LoggerFactory.getLogger(SupabaseStorageService.class);
    private static final long MAX_PHOTO_BYTES = 5_242_880L; // 5 MB
    private static final Set<String> ALLOWED_MIME_TYPES = Set.of("image/jpeg", "image/png", "image/webp");
    private static final Pattern STORAGE_PATH_PATTERN = Pattern.compile(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/"
            + "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/"
            + "(front|left|right|up|down)\\.jpg$"
    );

    private final RestClient storageRestClient;
    private final AppProperties appProperties;
    private final SecurityUtils securityUtils;

    @Autowired
    public SupabaseStorageService(
            @Qualifier("storageRestClient") RestClient storageRestClient,
            AppProperties appProperties,
            SecurityUtils securityUtils
    ) {
        this.storageRestClient = storageRestClient;
        this.appProperties = appProperties;
        this.securityUtils = securityUtils;
    }

    public SupabaseStorageService(
            @Qualifier("storageRestClient") RestClient storageRestClient,
            AppProperties appProperties
    ) {
        this(storageRestClient, appProperties, new SecurityUtils());
    }

    public String buildEnrollmentPhotoPath(UUID residentId, UUID enrollmentId, FacePose pose) {
        if (residentId == null || enrollmentId == null || pose == null) {
            throw BusinessException.badRequest("INVALID_STORAGE_PATH", "Parameter path foto enrollment tidak lengkap");
        }
        String path = residentId.toString().toLowerCase() + "/"
                + enrollmentId.toString().toLowerCase() + "/"
                + pose.getFilePrefix() + ".jpg";
        if (!STORAGE_PATH_PATTERN.matcher(path).matches()) {
            throw BusinessException.badRequest("INVALID_STORAGE_PATH", "Format path objek Storage tidak sesuai aturan keamanan");
        }
        return path;
    }

    public void validateImageFile(byte[] bytes, String contentType) {
        if (bytes == null || bytes.length == 0) {
            throw BusinessException.badRequest("EMPTY_IMAGE", "File foto wajah tidak boleh kosong");
        }
        if (bytes.length > MAX_PHOTO_BYTES) {
            throw new BusinessException(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE",
                    "Ukuran foto wajah melebihi batas maksimum 5 MB");
        }
        String normalizedMime = contentType != null ? contentType.toLowerCase().trim() : "";
        if (!ALLOWED_MIME_TYPES.contains(normalizedMime)) {
            throw BusinessException.badRequest("INVALID_IMAGE_TYPE",
                    "Format foto wajah wajib berupa JPEG, PNG, atau WebP");
        }
        if (!hasValidImageMagicBytes(bytes)) {
            throw BusinessException.badRequest("INVALID_IMAGE_SIGNATURE",
                    "Isi biner file bukan gambar JPEG, PNG, atau WebP yang valid");
        }
    }

    private boolean hasValidImageMagicBytes(byte[] b) {
        if (b == null || b.length < 4) {
            return false;
        }
        // JPEG: FF D8 FF
        if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return true;
        }
        // PNG: 89 50 4E 47
        if ((b[0] & 0xFF) == 0x89 && (b[1] & 0xFF) == 0x50 && (b[2] & 0xFF) == 0x4E && (b[3] & 0xFF) == 0x47) {
            return true;
        }
        // WebP: RIFF....WEBP
        if (b.length >= 12
                && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return true;
        }
        return false;
    }

    /**
     * Karena operasi backend ke Supabase Storage menggunakan SUPABASE_SERVICE_ROLE_KEY,
     * otorisasi kepemilikan folder penghuni wajib diverifikasi secara eksplisit di sini
     * agar setara dengan policy storage_enrollment_insert / storage_enrollment_update.
     */
    private void assertStorageWriteAuthorized(UUID residentId) {
        AppPrincipal principal = securityUtils.getCurrentPrincipal();
        if (principal.role() == UserRole.ADMIN) {
            return;
        }
        if (principal.role() == UserRole.PENGHUNI
                && principal.residentId() != null
                && principal.residentId().equals(residentId)) {
            return;
        }
        throw BusinessException.forbidden("STORAGE_ACCESS_DENIED",
                "Anda tidak berhak mengunggah atau memodifikasi foto wajah milik penghuni lain");
    }

    private void assertStorageReadAuthorized(UUID residentId) {
        AppPrincipal principal = securityUtils.getCurrentPrincipal();
        if (principal.role() == UserRole.ADMIN || principal.role() == UserRole.MONITOR || principal.role() == UserRole.VILLAGE_DEAN) {
            return;
        }
        if (principal.role() == UserRole.PENGHUNI
                && principal.residentId() != null
                && principal.residentId().equals(residentId)) {
            return;
        }
        throw BusinessException.forbidden("STORAGE_ACCESS_DENIED",
                "Anda tidak berhak melihat foto wajah milik penghuni lain");
    }

    record SupabaseSignRequest(int expiresIn) {}
    record SupabaseSignResponse(String signedURL) {}

    public String createSignedUrl(UUID residentId, String storagePath, int expiresInSeconds) {
        assertStorageReadAuthorized(residentId);
        if (storagePath == null || storagePath.isBlank()) {
            throw BusinessException.badRequest("INVALID_STORAGE_PATH", "Storage path tidak boleh kosong");
        }
        int ttl = expiresInSeconds > 0 ? expiresInSeconds : appProperties.storage().signedUrlTtlSeconds();
        String bucket = appProperties.storage().bucket();
        String serviceKey = appProperties.storage().serviceRoleKey();
        if (serviceKey == null || serviceKey.isBlank() || "CHANGE_ME".equals(serviceKey)) {
            log.info("Supabase Storage service key not configured; simulated signed URL for path={} (ttl={}s)", storagePath, ttl);
            return appProperties.storage().supabaseUrl() + "/storage/v1/object/sign/" + bucket + "/" + storagePath + "?token=simulated_token&expiresIn=" + ttl;
        }

        try {
            SupabaseSignResponse resp = storageRestClient.post()
                    .uri("/storage/v1/object/sign/{bucket}/{wildcard}", bucket, storagePath)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(new SupabaseSignRequest(ttl))
                    .retrieve()
                    .body(SupabaseSignResponse.class);
            if (resp != null && resp.signedURL() != null) {
                return appProperties.storage().supabaseUrl() + resp.signedURL();
            }
            throw new BusinessException(HttpStatus.BAD_GATEWAY, "STORAGE_SIGN_FAILED",
                    "Respons kosong dari Supabase Storage saat pembuatan Signed URL");
        } catch (Exception ex) {
            log.error("Failed to generate signed URL for path={}: {}", storagePath, ex.getMessage());
            throw new BusinessException(HttpStatus.BAD_GATEWAY, "STORAGE_SIGN_FAILED",
                    "Gagal menghasilkan Signed URL dari Supabase Storage privat");
        }
    }

    public String uploadEnrollmentPhoto(UUID residentId, UUID enrollmentId, FacePose pose, byte[] imageBytes, String contentType) {
        assertStorageWriteAuthorized(residentId);
        validateImageFile(imageBytes, contentType);
        String storagePath = buildEnrollmentPhotoPath(residentId, enrollmentId, pose);
        String bucket = appProperties.storage().bucket();

        String serviceKey = appProperties.storage().serviceRoleKey();
        if (serviceKey == null || serviceKey.isBlank() || "CHANGE_ME".equals(serviceKey)) {
            log.info("Supabase Storage service key not configured; validated path={} in local/contract mode", storagePath);
            return storagePath;
        }

        try {
            storageRestClient.post()
                    .uri("/storage/v1/object/{bucket}/{residentId}/{enrollmentId}/{fileName}",
                            bucket,
                            residentId.toString(),
                            enrollmentId.toString(),
                            pose.getFilePrefix() + ".jpg")
                    .header("x-upsert", "true")
                    .contentType(MediaType.parseMediaType(contentType))
                    .body(imageBytes)
                    .retrieve()
                    .toBodilessEntity();
            log.info("Uploaded enrollment photo to private bucket={}, path={}", bucket, storagePath);
            return storagePath;
        } catch (Exception ex) {
            log.error("Failed to upload photo to Supabase Storage path={}: {}", storagePath, ex.getMessage());
            throw new BusinessException(HttpStatus.BAD_GATEWAY, "STORAGE_UPLOAD_FAILED",
                    "Gagal mengunggah foto ke Supabase Storage privat");
        }
    }

    public void deleteEnrollmentFolder(UUID residentId, UUID enrollmentId) {
        assertStorageWriteAuthorized(residentId);
        String serviceKey = appProperties.storage().serviceRoleKey();
        if (serviceKey == null || serviceKey.isBlank() || "CHANGE_ME".equals(serviceKey)) {
            return;
        }
        String bucket = appProperties.storage().bucket();
        for (FacePose pose : FacePose.values()) {
            try {
                storageRestClient.delete()
                        .uri("/storage/v1/object/{bucket}/{residentId}/{enrollmentId}/{fileName}",
                                bucket,
                                residentId.toString(),
                                enrollmentId.toString(),
                                pose.getFilePrefix() + ".jpg")
                        .retrieve()
                        .toBodilessEntity();
            } catch (Exception ex) {
                log.debug("Cleanup storage object skipped for pose={}: {}", pose, ex.getMessage());
            }
        }
    }
}
