package id.ac.unklab.asrama.ai;

import id.ac.unklab.asrama.common.DomainEnums.FacePose;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class AiDtos {

    private AiDtos() {}

    public record AiPoseCheckRequest(
            UUID residentId,
            UUID enrollmentId,
            FacePose expectedPose,
            String imageBase64
    ) {}

    public record AiPoseCheckResponse(
            boolean faceDetected,
            int faceCount,
            boolean poseMatched,
            FacePose detectedPose,
            double qualityScore,
            boolean qualityPassed,
            double livenessScore,
            boolean livenessPassed,
            Map<String, Object> qualityDetails,
            String rejectionReason,
            long processingTimeMs
    ) {}

    public record AiEnrollmentEmbeddingRequest(
            UUID residentId,
            UUID enrollmentId,
            Map<FacePose, String> poseImagesBase64
    ) {}

    public record AiEnrollmentEmbeddingResponse(
            boolean success,
            List<Double> embedding512,
            String modelVersion,
            Map<String, Object> qualitySummary,
            String failureReason,
            long processingTimeMs
    ) {}

    public record AiAttendanceScanRequest(
            UUID sessionId,
            UUID residentId,
            String imageBase64
    ) {}

    public record AiAttendanceScanResponse(
            boolean faceDetected,
            int faceCount,
            double livenessScore,
            boolean livenessPassed,
            double qualityScore,
            List<Double> embedding512,
            String modelVersion,
            String rejectionReason,
            long processingTimeMs
    ) {}
}
