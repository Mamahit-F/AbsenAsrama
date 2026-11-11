package id.ac.unklab.asrama.attendance;

import id.ac.unklab.asrama.attendance.AttendanceDtos.*;
import id.ac.unklab.asrama.common.DomainEnums.AttendanceMethod;
import id.ac.unklab.asrama.common.DomainEnums.AttendanceStatus;
import id.ac.unklab.asrama.common.DomainEnums.ValidationResult;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class AttendanceRepository {

    private final JdbcTemplate jdbcTemplate;

    public static final RowMapper<AttendanceRecordDto> RECORD_MAPPER = (rs, rowNum) -> {
        String resId = rs.getString("resident_id");
        String methodStr = rs.getString("method");
        String recBy = rs.getString("recorded_by");
        String corrBy = rs.getString("corrected_by");
        return new AttendanceRecordDto(
                UUID.fromString(rs.getString("id")),
                UUID.fromString(rs.getString("session_id")),
                resId != null ? UUID.fromString(resId) : null,
                rs.getString("resident_nim"),
                rs.getString("resident_name"),
                AttendanceStatus.valueOf(rs.getString("status")),
                methodStr != null ? AttendanceMethod.valueOf(methodStr) : null,
                rs.getString("reason"),
                recBy != null ? UUID.fromString(recBy) : null,
                rs.getString("recorded_by_username"),
                rs.getObject("face_match", Boolean.class),
                rs.getObject("liveness_passed", Boolean.class),
                rs.getObject("latitude") != null ? rs.getDouble("latitude") : null,
                rs.getObject("longitude") != null ? rs.getDouble("longitude") : null,
                rs.getObject("accuracy_m") != null ? rs.getDouble("accuracy_m") : null,
                rs.getObject("distance_m") != null ? rs.getDouble("distance_m") : null,
                rs.getObject("location_valid", Boolean.class),
                corrBy != null ? UUID.fromString(corrBy) : null,
                rs.getString("correction_reason"),
                rs.getObject("corrected_at", OffsetDateTime.class),
                rs.getObject("recorded_at", OffsetDateTime.class)
        );
    };

    private static final String BASE_RECORD_SELECT = """
            SELECT ar.id, ar.session_id, ar.resident_id, ar.resident_nim, ar.resident_name,
                   ar.status, ar.method, ar.reason, ar.recorded_by, u.username AS recorded_by_username,
                   ar.face_match, ar.liveness_passed, ar.latitude, ar.longitude, ar.accuracy_m,
                   ar.distance_m, ar.location_valid, ar.corrected_by, ar.correction_reason,
                   ar.corrected_at, ar.recorded_at
            FROM public.attendance_records ar
            LEFT JOIN public.users u ON u.id = ar.recorded_by
            """;

    public AttendanceRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Double computeFaceSimilarity(UUID residentId, String vectorLiteral512) {
        return jdbcTemplate.queryForObject(
                "SELECT public.face_similarity(?::uuid, ?::extensions.vector(512))",
                Double.class,
                residentId.toString(),
                vectorLiteral512
        );
    }

    public GeofenceCheckResult checkGeofence(UUID sessionId, double latitude, double longitude, Double accuracyM) {
        List<GeofenceCheckResult> rows = jdbcTemplate.query(
                "SELECT is_valid, distance_m, reason FROM public.check_geofence(?::uuid, ?, ?, ?)",
                (rs, rowNum) -> new GeofenceCheckResult(
                        rs.getBoolean("is_valid"),
                        rs.getObject("distance_m") != null ? rs.getDouble("distance_m") : null,
                        rs.getString("reason")
                ),
                sessionId.toString(),
                latitude,
                longitude,
                accuracyM
        );
        return rows.stream().findFirst().orElse(new GeofenceCheckResult(true, null, "GEOFENCE_TIDAK_DIATUR"));
    }

    public boolean hasSessionGeofenceConfigured(UUID sessionId) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM public.geofence_settings WHERE session_id = ?::uuid AND is_enabled = true",
                Integer.class,
                sessionId.toString()
        );
        return count != null && count > 0;
    }

    public void insertValidationLog(
            UUID sessionId,
            UUID residentId,
            AttendanceMethod method,
            ValidationResult result,
            Double faceScore,
            Double livenessScore,
            Boolean faceMatch,
            Boolean livenessPassed,
            Boolean locationValid,
            Double distanceM,
            Double accuracyM,
            Double latitude,
            Double longitude,
            String locationReason,
            String rejectionReason
    ) {
        jdbcTemplate.update(
                """
                INSERT INTO public.attendance_validation_logs(
                    id, session_id, resident_id, method, result,
                    face_score, liveness_score, face_match, liveness_passed,
                    location_valid, distance_m, accuracy_m, latitude, longitude,
                    user_latitude, user_longitude, user_accuracy_meters, distance_meters,
                    location_reason, rejection_reason
                ) VALUES (
                    gen_random_uuid(), ?::uuid, ?::uuid, ?::public.attendance_method, ?::public.validation_result,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?
                )
                """,
                sessionId != null ? sessionId.toString() : null,
                residentId != null ? residentId.toString() : null,
                method.name(),
                result.name(),
                faceScore,
                livenessScore,
                faceMatch,
                livenessPassed,
                locationValid,
                distanceM,
                accuracyM,
                latitude,
                longitude,
                latitude,
                longitude,
                accuracyM,
                distanceM,
                locationReason,
                rejectionReason
        );
    }

    public UUID insertAttendanceRecord(
            UUID sessionId,
            UUID residentId,
            String residentNim,
            String residentName,
            AttendanceStatus status,
            AttendanceMethod method,
            String reason,
            UUID recordedBy,
            Boolean faceMatch,
            Boolean livenessPassed,
            Double latitude,
            Double longitude,
            Double accuracyM,
            Double distanceM,
            Boolean locationValid
    ) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO public.attendance_records(
                    id, session_id, resident_id, resident_nim, resident_name,
                    status, method, reason, recorded_by,
                    face_match, liveness_passed,
                    latitude, longitude, accuracy_m, distance_m, location_valid,
                    user_latitude, user_longitude, user_accuracy_meters, distance_meters,
                    location_captured_at
                ) VALUES (
                    ?::uuid, ?::uuid, ?::uuid, ?, ?,
                    ?::public.attendance_status, ?::public.attendance_method, ?, ?::uuid,
                    ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    CASE WHEN ? IS NOT NULL THEN now() ELSE NULL END
                )
                """,
                id.toString(),
                sessionId.toString(),
                residentId.toString(),
                residentNim,
                residentName,
                status.name(),
                method != null ? method.name() : null,
                reason,
                recordedBy != null ? recordedBy.toString() : null,
                faceMatch,
                livenessPassed,
                latitude,
                longitude,
                accuracyM,
                distanceM,
                locationValid,
                latitude,
                longitude,
                accuracyM,
                distanceM,
                latitude
        );
        return id;
    }

    public Optional<AttendanceRecordDto> findById(UUID recordId) {
        List<AttendanceRecordDto> rows = jdbcTemplate.query(
                BASE_RECORD_SELECT + " WHERE ar.id = ?::uuid",
                RECORD_MAPPER,
                recordId.toString()
        );
        return rows.stream().findFirst();
    }

    public Optional<AttendanceRecordDto> findBySessionAndResident(UUID sessionId, UUID residentId) {
        List<AttendanceRecordDto> rows = jdbcTemplate.query(
                BASE_RECORD_SELECT + " WHERE ar.session_id = ?::uuid AND ar.resident_id = ?::uuid",
                RECORD_MAPPER,
                sessionId.toString(),
                residentId.toString()
        );
        return rows.stream().findFirst();
    }

    public List<AttendanceRecordDto> findBySession(UUID sessionId) {
        return jdbcTemplate.query(
                BASE_RECORD_SELECT + " WHERE ar.session_id = ?::uuid ORDER BY ar.recorded_at ASC",
                RECORD_MAPPER,
                sessionId.toString()
        );
    }

    public List<AttendanceRecordDto> findByResident(UUID residentId, OffsetDateTime from, OffsetDateTime to, Integer limit, Integer offset) {
        StringBuilder sql = new StringBuilder(BASE_RECORD_SELECT).append(" WHERE ar.resident_id = ?::uuid");
        List<Object> params = new ArrayList<>();
        params.add(residentId.toString());
        if (from != null) {
            sql.append(" AND ar.recorded_at >= ?");
            params.add(from);
        }
        if (to != null) {
            sql.append(" AND ar.recorded_at <= ?");
            params.add(to);
        }
        sql.append(" ORDER BY ar.recorded_at DESC");
        if (limit != null && limit > 0) {
            sql.append(" LIMIT ?");
            params.add(Math.min(limit, 500));
        }
        if (offset != null && offset > 0) {
            sql.append(" OFFSET ?");
            params.add(offset);
        }
        return jdbcTemplate.query(sql.toString(), RECORD_MAPPER, params.toArray());
    }

    public List<AttendanceRecordDto> findByResident(UUID residentId, OffsetDateTime from, OffsetDateTime to) {
        return findByResident(residentId, from, to, null, null);
    }

    public void updateAttendanceRecord(UUID recordId, AttendanceStatus newStatus, String correctionReason, UUID correctedBy) {
        jdbcTemplate.update(
                """
                UPDATE public.attendance_records
                SET status = ?::public.attendance_status,
                    correction_reason = ?,
                    corrected_by = ?::uuid,
                    corrected_at = now()
                WHERE id = ?::uuid
                """,
                newStatus.name(),
                correctionReason.trim(),
                correctedBy.toString(),
                recordId.toString()
        );
    }

    public int countRequiredActiveResidentsForSession(UUID sessionId) {
        Integer count = jdbcTemplate.queryForObject(
                """
                SELECT COUNT(*)
                FROM public.residents r
                WHERE r.status = 'AKTIF'::public.resident_status
                  AND public.is_activity_required(r.id, ?::uuid)
                """,
                Integer.class,
                sessionId.toString()
        );
        return count != null ? count : 0;
    }

    public DashboardStatsDto computeDashboardStats() {
        long activeResidents = queryLong("SELECT COUNT(*) FROM public.residents WHERE status = 'AKTIF'::public.resident_status");
        long enrolledFaces = queryLong("SELECT COUNT(*) FROM public.face_profiles");
        long openSessions = queryLong("SELECT COUNT(*) FROM public.attendance_sessions WHERE status = 'OPEN'::public.session_status");
        long todayHadir = queryLong("""
                SELECT COUNT(*) FROM public.attendance_records
                WHERE status = 'HADIR'::public.attendance_status
                  AND (recorded_at AT TIME ZONE 'Asia/Makassar')::date = (now() AT TIME ZONE 'Asia/Makassar')::date
                """);
        long todayTidakHadir = queryLong("""
                SELECT COUNT(*) FROM public.attendance_records
                WHERE status = 'TIDAK_HADIR'::public.attendance_status
                  AND (recorded_at AT TIME ZONE 'Asia/Makassar')::date = (now() AT TIME ZONE 'Asia/Makassar')::date
                """);
        long totalHadirAll = queryLong("SELECT COUNT(*) FROM public.attendance_records WHERE status = 'HADIR'::public.attendance_status");
        long totalRecordsAll = queryLong("SELECT COUNT(*) FROM public.attendance_records");
        double rate = totalRecordsAll > 0 ? Math.round((totalHadirAll * 10000.0) / totalRecordsAll) / 100.0 : 0.0;

        List<SessionRecapSummaryItem> recentSessions = jdbcTemplate.query(
                """
                SELECT s.id, sc.name AS schedule_name, s.starts_at, s.ends_at, s.status,
                       COUNT(ar.id) FILTER (WHERE ar.status = 'HADIR') AS hadir_count,
                       COUNT(ar.id) FILTER (WHERE ar.status = 'TIDAK_HADIR') AS tidak_hadir_count
                FROM public.attendance_sessions s
                JOIN public.attendance_schedules sc ON sc.id = s.schedule_id
                LEFT JOIN public.attendance_records ar ON ar.session_id = s.id
                GROUP BY s.id, sc.name, s.starts_at, s.ends_at, s.status
                ORDER BY s.starts_at DESC
                LIMIT 10
                """,
                (rs, rowNum) -> new SessionRecapSummaryItem(
                        UUID.fromString(rs.getString("id")),
                        rs.getString("schedule_name"),
                        rs.getObject("starts_at", OffsetDateTime.class),
                        rs.getObject("ends_at", OffsetDateTime.class),
                        rs.getString("status"),
                        rs.getLong("hadir_count"),
                        rs.getLong("tidak_hadir_count")
                )
        );

        return new DashboardStatsDto(
                activeResidents,
                enrolledFaces,
                openSessions,
                todayHadir,
                todayTidakHadir,
                rate,
                recentSessions
        );
    }

    private long queryLong(String sql) {
        Long val = jdbcTemplate.queryForObject(sql, Long.class);
        return val != null ? val : 0L;
    }
}
