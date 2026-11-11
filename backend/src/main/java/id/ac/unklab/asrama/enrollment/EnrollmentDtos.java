package id.ac.unklab.asrama.enrollment;

import id.ac.unklab.asrama.common.DomainEnums.EnrollmentStatus;
import id.ac.unklab.asrama.common.DomainEnums.FacePose;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class EnrollmentDtos {

    private EnrollmentDtos() {}

    public record StartEnrollmentRequest(
            UUID residentId,
            UUID consentId
    ) {}

    public record FinalizeEnrollmentRequest(
            UUID enrollmentId
    ) {}

    public record EnrollmentPhotoDto(
            UUID id,
            UUID enrollmentId,
            FacePose pose,
            String bucketId,
            String storagePath,
            Double qualityScore,
            Double livenessScore,
            boolean qualityPassed,
            boolean livenessPassed,
            String rejectionReason,
            Integer fileSizeBytes,
            OffsetDateTime createdAt
    ) {}

    /**
     * DTO Enrollment yang aman (K-01: TIDAK PERNAH memuat vektor embedding).
     */
    public record EnrollmentDetailDto(
            UUID id,
            UUID residentId,
            EnrollmentStatus status,
            String modelVersion,
            String failureReason,
            UUID consentId,
            OffsetDateTime startedAt,
            OffsetDateTime completedAt,
            OffsetDateTime supersededAt,
            int validPoseCount,
            List<EnrollmentPhotoDto> photos
    ) {}

    public record PoseUploadResponse(
            UUID enrollmentId,
            FacePose pose,
            boolean accepted,
            double qualityScore,
            boolean qualityPassed,
            double livenessScore,
            boolean livenessPassed,
            String rejectionReason,
            int totalValidPoses,
            boolean readyToComplete,
            long latencyMs
    ) {}

    public record CompleteEnrollmentResponse(
            UUID enrollmentId,
            UUID residentId,
            EnrollmentStatus status,
            String modelVersion,
            boolean promotedToActiveProfile,
            OffsetDateTime completedAt,
            long latencyMs
    ) {}

    /**
     * Status profil wajah aktif penghuni (tanpa mengembalikan array embedding 512-d).
     */
    public record ActiveFaceProfileMetadataDto(
            UUID id,
            UUID residentId,
            String modelVersion,
            UUID sourceEnrollmentId,
            OffsetDateTime enrolledAt,
            OffsetDateTime updatedAt
    ) {}

    public record SimilarFaceMatchDto(
            UUID residentId,
            double similarity
    ) {}
}
