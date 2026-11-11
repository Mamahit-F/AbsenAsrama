package id.ac.unklab.asrama.ai;

import id.ac.unklab.asrama.ai.AiDtos.*;
import id.ac.unklab.asrama.common.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * HTTP Client terstruktur untuk komunikasi Spring Boot -> Python FastAPI AI Service (DeepFace / ArcFace 512-d).
 * PENTING: Tidak melakukan simulasi pengenalan wajah palsu. Jika AI Service tidak aktif/timeout,
 * melempar BusinessException(503 SERVICE_UNAVAILABLE, "AI_SERVICE_UNAVAILABLE").
 */
@Component
public class FastApiAiClient {

    private static final Logger log = LoggerFactory.getLogger(FastApiAiClient.class);

    private final RestClient aiRestClient;

    public FastApiAiClient(@Qualifier("aiRestClient") RestClient aiRestClient) {
        this.aiRestClient = aiRestClient;
    }

    public AiPoseCheckResponse validateEnrollmentPose(AiPoseCheckRequest request) {
        long startNs = System.nanoTime();
        try {
            AiPoseCheckResponse response = aiRestClient.post()
                    .uri("/api/v1/ai/enrollment/validate-pose")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(AiPoseCheckResponse.class);
            long elapsedMs = (System.nanoTime() - startNs) / 1_000_000L;
            log.info("AI pose validation completed in {} ms (pose={}, qualityPassed={}, livenessPassed={})",
                    elapsedMs, request.expectedPose(),
                    response != null && response.qualityPassed(),
                    response != null && response.livenessPassed());
            if (response == null) {
                throw new BusinessException(HttpStatus.BAD_GATEWAY, "AI_EMPTY_RESPONSE",
                        "Layanan AI mengembalikan respons kosong pada validasi pose");
            }
            return response;
        } catch (ResourceAccessException ex) {
            log.error("AI Service timeout/unreachable during pose validation: {}", ex.getMessage());
            throw new BusinessException(HttpStatus.SERVICE_UNAVAILABLE, "AI_SERVICE_UNAVAILABLE",
                    "Layanan AI (FastAPI) tidak dapat dihubungi atau melebihi batas waktu (timeout)");
        } catch (RestClientResponseException ex) {
            log.error("AI Service returned HTTP {} during pose validation", ex.getStatusCode().value());
            throw new BusinessException(HttpStatus.BAD_GATEWAY, "AI_SERVICE_ERROR",
                    "Layanan AI menolak permintaan validasi pose (" + ex.getStatusCode().value() + ")");
        }
    }

    public AiEnrollmentEmbeddingResponse extractEnrollmentEmbedding(AiEnrollmentEmbeddingRequest request) {
        long startNs = System.nanoTime();
        try {
            AiEnrollmentEmbeddingResponse response = aiRestClient.post()
                    .uri("/api/v1/ai/enrollment/extract-embedding")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(AiEnrollmentEmbeddingResponse.class);
            long elapsedMs = (System.nanoTime() - startNs) / 1_000_000L;
            log.info("AI enrollment embedding extraction completed in {} ms (enrollmentId={}, success={})",
                    elapsedMs, request.enrollmentId(), response != null && response.success());
            if (response == null) {
                throw new BusinessException(HttpStatus.BAD_GATEWAY, "AI_EMPTY_RESPONSE",
                        "Layanan AI mengembalikan respons kosong saat ekstraksi embedding");
            }
            return response;
        } catch (ResourceAccessException ex) {
            log.error("AI Service timeout/unreachable during embedding extraction: {}", ex.getMessage());
            throw new BusinessException(HttpStatus.SERVICE_UNAVAILABLE, "AI_SERVICE_UNAVAILABLE",
                    "Layanan AI (FastAPI) tidak dapat dihubungi saat pembentukan embedding wajah");
        } catch (RestClientResponseException ex) {
            log.error("AI Service returned HTTP {} during embedding extraction", ex.getStatusCode().value());
            throw new BusinessException(HttpStatus.BAD_GATEWAY, "AI_SERVICE_ERROR",
                    "Layanan AI gagal membentuk embedding wajah (" + ex.getStatusCode().value() + ")");
        }
    }

    public AiAttendanceScanResponse analyzeAttendanceFrame(AiAttendanceScanRequest request) {
        long startNs = System.nanoTime();
        try {
            AiAttendanceScanResponse response = aiRestClient.post()
                    .uri("/api/v1/ai/attendance/analyze-frame")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(request)
                    .retrieve()
                    .body(AiAttendanceScanResponse.class);
            long elapsedMs = (System.nanoTime() - startNs) / 1_000_000L;
            log.info("AI attendance frame analysis completed in {} ms (sessionId={}, faceDetected={}, livenessPassed={})",
                    elapsedMs, request.sessionId(),
                    response != null && response.faceDetected(),
                    response != null && response.livenessPassed());
            if (response == null) {
                throw new BusinessException(HttpStatus.BAD_GATEWAY, "AI_EMPTY_RESPONSE",
                    "Layanan AI mengembalikan respons kosong saat verifikasi wajah");
            }
            return response;
        } catch (ResourceAccessException ex) {
            log.error("AI Service timeout/unreachable during attendance scan: {}", ex.getMessage());
            throw new BusinessException(HttpStatus.SERVICE_UNAVAILABLE, "AI_SERVICE_UNAVAILABLE",
                    "Layanan AI (FastAPI) tidak dapat dihubungi atau melebihi batas waktu saat pemindaian wajah");
        } catch (RestClientResponseException ex) {
            log.error("AI Service returned HTTP {} during attendance scan", ex.getStatusCode().value());
            throw new BusinessException(HttpStatus.BAD_GATEWAY, "AI_SERVICE_ERROR",
                    "Layanan AI mengalami kendala saat memproses gambar presensi (" + ex.getStatusCode().value() + ")");
        }
    }

    public boolean checkHealth() {
        try {
            var response = aiRestClient.get()
                    .uri("/health")
                    .retrieve()
                    .toBodilessEntity();
            return response.getStatusCode().is2xxSuccessful();
        } catch (Exception ex) {
            log.debug("FastAPI health check failed: {}", ex.getMessage());
            return false;
        }
    }

    public static String toPgVectorLiteral( java.util.List<Double> embedding512) {
        if (embedding512 == null || embedding512.size() != 512) {
            throw BusinessException.badRequest("INVALID_EMBEDDING_DIMENSION",
                    "Vektor embedding wajah wajib memiliki tepat 512 dimensi (ArcFace)");
        }
        StringBuilder sb = new StringBuilder(4096);
        sb.append('[');
        for (int i = 0; i < embedding512.size(); i++) {
            Double val = embedding512.get(i);
            if (val == null || Double.isNaN(val) || Double.isInfinite(val)) {
                throw BusinessException.badRequest("INVALID_EMBEDDING_VALUE", "Nilai komponen embedding tidak valid");
            }
            if (i > 0) {
                sb.append(',');
            }
            sb.append(val);
        }
        sb.append(']');
        return sb.toString();
    }
}
