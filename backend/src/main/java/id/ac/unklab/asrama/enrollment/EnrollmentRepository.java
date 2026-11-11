package id.ac.unklab.asrama.enrollment;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import id.ac.unklab.asrama.common.DomainEnums.EnrollmentStatus;
import id.ac.unklab.asrama.common.DomainEnums.FacePose;
import id.ac.unklab.asrama.enrollment.EnrollmentDtos.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class EnrollmentRepository {

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    private static final RowMapper<EnrollmentPhotoDto> PHOTO_MAPPER = (rs, rowNum) -> new EnrollmentPhotoDto(
            UUID.fromString(rs.getString("id")),
            UUID.fromString(rs.getString("enrollment_id")),
            FacePose.valueOf(rs.getString("pose")),
            rs.getString("bucket_id"),
            rs.getString("storage_path"),
            rs.getObject("quality_score") != null ? rs.getDouble("quality_score") : null,
            rs.getObject("liveness_score") != null ? rs.getDouble("liveness_score") : null,
            rs.getBoolean("quality_passed"),
            rs.getBoolean("liveness_passed"),
            rs.getString("rejection_reason"),
            rs.getObject("file_size_bytes", Integer.class),
            rs.getObject("created_at", OffsetDateTime.class)
    );

    private static final RowMapper<ActiveFaceProfileMetadataDto> ACTIVE_PROFILE_MAPPER = (rs, rowNum) -> {
        String srcId = rs.getString("source_enrollment_id");
        return new ActiveFaceProfileMetadataDto(
                UUID.fromString(rs.getString("id")),
                UUID.fromString(rs.getString("resident_id")),
                rs.getString("model_version"),
                srcId != null ? UUID.fromString(srcId) : null,
                rs.getObject("enrolled_at", OffsetDateTime.class),
                rs.getObject("updated_at", OffsetDateTime.class)
        );
    };

    public EnrollmentRepository(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    public Optional<UUID> findInProgressEnrollmentId(UUID residentId) {
        List<String> ids = jdbcTemplate.queryForList(
                """
                SELECT id::text FROM public.face_enrollments
                WHERE resident_id = ?::uuid AND status IN ('PENDING', 'PROCESSING')
                LIMIT 1
                """,
                String.class,
                residentId.toString()
        );
        return ids.stream().findFirst().map(UUID::fromString);
    }

    public UUID createEnrollment(UUID residentId, UUID consentId) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO public.face_enrollments(id, resident_id, status, consent_id)
                VALUES (?::uuid, ?::uuid, 'PENDING', ?::uuid)
                """,
                id.toString(),
                residentId.toString(),
                consentId.toString()
        );
        return id;
    }

    public Optional<EnrollmentDetailDto> findEnrollmentById(UUID enrollmentId) {
        List<EnrollmentDetailDto> list = jdbcTemplate.query(
                """
                SELECT id, resident_id, status, model_version, failure_reason, consent_id,
                       started_at, completed_at, superseded_at
                FROM public.face_enrollments
                WHERE id = ?::uuid
                """,
                (rs, rowNum) -> {
                    UUID id = UUID.fromString(rs.getString("id"));
                    List<EnrollmentPhotoDto> photos = findPhotosByEnrollment(id);
                    int validCount = (int) photos.stream()
                            .filter(p -> p.qualityPassed() && p.livenessPassed())
                            .count();
                    String consentIdStr = rs.getString("consent_id");
                    return new EnrollmentDetailDto(
                            id,
                            UUID.fromString(rs.getString("resident_id")),
                            EnrollmentStatus.valueOf(rs.getString("status")),
                            rs.getString("model_version"),
                            rs.getString("failure_reason"),
                            consentIdStr != null ? UUID.fromString(consentIdStr) : null,
                            rs.getObject("started_at", OffsetDateTime.class),
                            rs.getObject("completed_at", OffsetDateTime.class),
                            rs.getObject("superseded_at", OffsetDateTime.class),
                            validCount,
                            photos
                    );
                },
                enrollmentId.toString()
        );
        return list.stream().findFirst();
    }

    public List<EnrollmentPhotoDto> findPhotosByEnrollment(UUID enrollmentId) {
        return jdbcTemplate.query(
                """
                SELECT id, enrollment_id, pose, bucket_id, storage_path, quality_score, liveness_score,
                       quality_passed, liveness_passed, rejection_reason, file_size_bytes, created_at
                FROM public.enrollment_photos
                WHERE enrollment_id = ?::uuid
                ORDER BY created_at ASC
                """,
                PHOTO_MAPPER,
                enrollmentId.toString()
        );
    }

    public void upsertEnrollmentPhoto(
            UUID enrollmentId,
            FacePose pose,
            String bucketId,
            String storagePath,
            double qualityScore,
            double livenessScore,
            boolean qualityPassed,
            boolean livenessPassed,
            Map<String, Object> qualityDetails,
            String rejectionReason,
            int fileSizeBytes
    ) {
        String detailsJson = toJsonOrNull(qualityDetails);
        jdbcTemplate.update(
                """
                INSERT INTO public.enrollment_photos(
                    id, enrollment_id, pose, bucket_id, storage_path,
                    quality_score, liveness_score, quality_passed, liveness_passed,
                    quality_details, rejection_reason, file_size_bytes
                ) VALUES (
                    gen_random_uuid(), ?::uuid, ?::public.face_pose, ?, ?,
                    ?, ?, ?, ?, ?::jsonb, ?, ?
                )
                ON CONFLICT (enrollment_id, pose) DO UPDATE SET
                    bucket_id = EXCLUDED.bucket_id,
                    storage_path = EXCLUDED.storage_path,
                    quality_score = EXCLUDED.quality_score,
                    liveness_score = EXCLUDED.liveness_score,
                    quality_passed = EXCLUDED.quality_passed,
                    liveness_passed = EXCLUDED.liveness_passed,
                    quality_details = EXCLUDED.quality_details,
                    rejection_reason = EXCLUDED.rejection_reason,
                    file_size_bytes = EXCLUDED.file_size_bytes,
                    created_at = now()
                """,
                enrollmentId.toString(),
                pose.name(),
                bucketId,
                storagePath,
                qualityScore,
                livenessScore,
                qualityPassed,
                livenessPassed,
                detailsJson,
                rejectionReason,
                fileSizeBytes
        );
    }

    public int countValidPoses(UUID enrollmentId) {
        Integer count = jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*) FROM public.enrollment_photos
                WHERE enrollment_id = ?::uuid AND quality_passed = true AND liveness_passed = true
                """,
                Integer.class,
                enrollmentId.toString()
        );
        return count != null ? count : 0;
    }

    public List<SimilarFaceMatchDto> findSimilarFaces(String vectorLiteral512, double threshold, UUID excludeResidentId, int limit) {
        return jdbcTemplate.query(
                "SELECT resident_id, similarity FROM public.find_similar_face(?::extensions.vector(512), ?, ?::uuid, ?)",
                (rs, rowNum) -> new SimilarFaceMatchDto(
                        UUID.fromString(rs.getString("resident_id")),
                        rs.getDouble("similarity")
                ),
                vectorLiteral512,
                threshold,
                excludeResidentId != null ? excludeResidentId.toString() : null,
                limit
        );
    }

    public void markEnrollmentCompleted(UUID enrollmentId, String vectorLiteral512, String modelVersion, Map<String, Object> qualitySummary) {
        String summaryJson = toJsonOrNull(qualitySummary);
        jdbcTemplate.update(
                """
                UPDATE public.face_enrollments
                SET status = 'COMPLETED'::public.enrollment_status,
                    candidate_embedding = ?::extensions.vector(512),
                    model_version = ?,
                    quality_summary = ?::jsonb
                WHERE id = ?::uuid
                """,
                vectorLiteral512,
                modelVersion,
                summaryJson,
                enrollmentId.toString()
        );
    }

    public void markEnrollmentFailed(UUID enrollmentId, String failureReason) {
        jdbcTemplate.update(
                """
                UPDATE public.face_enrollments
                SET status = 'FAILED'::public.enrollment_status,
                    failure_reason = ?
                WHERE id = ?::uuid
                """,
                failureReason,
                enrollmentId.toString()
        );
    }

    public void promoteEnrollment(UUID enrollmentId, int retentionDays) {
        String intervalStr = retentionDays + " days";
        jdbcTemplate.queryForObject(
                "SELECT public.promote_enrollment(?::uuid, ?::interval)::text",
                String.class,
                enrollmentId.toString(),
                intervalStr
        );
    }

    public Optional<ActiveFaceProfileMetadataDto> findActiveFaceProfileMetadata(UUID residentId) {
        List<ActiveFaceProfileMetadataDto> rows = jdbcTemplate.query(
                """
                SELECT id, resident_id, model_version, source_enrollment_id, enrolled_at, updated_at
                FROM public.face_profiles
                WHERE resident_id = ?::uuid
                """,
                ACTIVE_PROFILE_MAPPER,
                residentId.toString()
        );
        return rows.stream().findFirst();
    }

    public int purgeExpiredFaceData() {
        Integer purged = jdbcTemplate.queryForObject(
                "SELECT public.purge_expired_face_data()",
                Integer.class
        );
        return purged != null ? purged : 0;
    }

    private String toJsonOrNull(Map<String, Object> map) {
        if (map == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(map);
        } catch (JsonProcessingException e) {
            return "{}";
        }
    }
}
