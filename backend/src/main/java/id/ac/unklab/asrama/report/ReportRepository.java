package id.ac.unklab.asrama.report;

import id.ac.unklab.asrama.common.DomainEnums.AttendanceMethod;
import id.ac.unklab.asrama.common.DomainEnums.AttendanceStatus;
import id.ac.unklab.asrama.common.DomainEnums.ValidationResult;
import id.ac.unklab.asrama.report.ReportDtos.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Repository
public class ReportRepository {

    private final JdbcTemplate jdbcTemplate;

    public ReportRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<AttendanceReportRowDto> queryAttendanceReportRows(
            OffsetDateTime from,
            OffsetDateTime to,
            UUID sessionId,
            AttendanceStatus status
    ) {
        StringBuilder sql = new StringBuilder("""
                SELECT ar.id AS record_id, ar.session_id, sc.name AS schedule_name, at.code AS activity_code,
                       s.starts_at AS session_starts_at, s.ends_at AS session_ends_at,
                       ar.resident_id, ar.resident_nim, ar.resident_name,
                       COALESCE(r.residence_category::text, '-') AS residence_category,
                       r.building, r.room_number,
                       ar.status, ar.method, ar.reason, ar.recorded_by, u.username AS recorded_by_username,
                       ar.face_match, ar.liveness_passed, ar.location_valid, ar.distance_m,
                       COALESCE(s.is_geo_enabled, g.is_enabled, false) AS is_geo_enabled,
                       ar.latitude AS user_latitude, ar.longitude AS user_longitude, ar.accuracy_m AS user_accuracy_m,
                       COALESCE(s.geo_latitude, g.latitude) AS session_latitude,
                       COALESCE(s.geo_longitude, g.longitude) AS session_longitude,
                       COALESCE(s.geo_radius_meters, g.radius_m) AS session_radius_m,
                       ar.correction_reason, ar.recorded_at
                FROM public.attendance_records ar
                JOIN public.attendance_sessions s ON s.id = ar.session_id
                JOIN public.attendance_schedules sc ON sc.id = s.schedule_id
                LEFT JOIN public.activity_types at ON at.id = sc.activity_type_id
                LEFT JOIN public.residents r ON r.id = ar.resident_id
                LEFT JOIN public.users u ON u.id = ar.recorded_by
                LEFT JOIN public.geofence_settings g ON g.session_id = s.id
                WHERE 1=1
                """);
        List<Object> params = new ArrayList<>();
        if (from != null) {
            sql.append(" AND s.starts_at >= ?");
            params.add(from);
        }
        if (to != null) {
            sql.append(" AND s.starts_at <= ?");
            params.add(to);
        }
        if (sessionId != null) {
            sql.append(" AND ar.session_id = ?::uuid");
            params.add(sessionId.toString());
        }
        if (status != null) {
            sql.append(" AND ar.status = ?::public.attendance_status");
            params.add(status.name());
        }
        sql.append(" ORDER BY s.starts_at DESC, ar.resident_nim ASC");

        return jdbcTemplate.query(
                sql.toString(),
                (rs, rowNum) -> {
                    String resId = rs.getString("resident_id");
                    String methodStr = rs.getString("method");
                    String recBy = rs.getString("recorded_by");
                    return new AttendanceReportRowDto(
                            UUID.fromString(rs.getString("record_id")),
                            UUID.fromString(rs.getString("session_id")),
                            rs.getString("schedule_name"),
                            rs.getString("activity_code"),
                            rs.getObject("session_starts_at", OffsetDateTime.class),
                            rs.getObject("session_ends_at", OffsetDateTime.class),
                            resId != null ? UUID.fromString(resId) : null,
                            rs.getString("resident_nim"),
                            rs.getString("resident_name"),
                            rs.getString("residence_category"),
                            rs.getString("building"),
                            rs.getString("room_number"),
                            AttendanceStatus.valueOf(rs.getString("status")),
                            methodStr != null ? AttendanceMethod.valueOf(methodStr) : null,
                            rs.getString("reason"),
                            recBy != null ? UUID.fromString(recBy) : null,
                            rs.getString("recorded_by_username"),
                            rs.getObject("face_match", Boolean.class),
                            rs.getObject("liveness_passed", Boolean.class),
                            rs.getObject("location_valid", Boolean.class),
                            rs.getObject("distance_m") != null ? rs.getDouble("distance_m") : null,
                            rs.getObject("is_geo_enabled", Boolean.class),
                            rs.getObject("user_latitude") != null ? rs.getDouble("user_latitude") : null,
                            rs.getObject("user_longitude") != null ? rs.getDouble("user_longitude") : null,
                            rs.getObject("user_accuracy_m") != null ? rs.getDouble("user_accuracy_m") : null,
                            rs.getObject("session_latitude") != null ? rs.getDouble("session_latitude") : null,
                            rs.getObject("session_longitude") != null ? rs.getDouble("session_longitude") : null,
                            rs.getObject("session_radius_m") != null ? rs.getInt("session_radius_m") : null,
                            rs.getString("correction_reason"),
                            rs.getObject("recorded_at", OffsetDateTime.class)
                    );
                },
                params.toArray()
        );
    }

    public List<AuditLogDto> findAuditLogs(String entityType, int limit, int offset) {
        StringBuilder sql = new StringBuilder("""
                SELECT al.id, al.actor_id, u.username AS actor_username, al.action,
                       al.entity_type, al.entity_id, al.old_data::text AS old_data_json,
                       al.new_data::text AS new_data_json, al.description, al.created_at
                FROM public.audit_logs al
                LEFT JOIN public.users u ON u.id = al.actor_id
                WHERE 1=1
                """);
        List<Object> params = new ArrayList<>();
        if (entityType != null && !entityType.isBlank()) {
            sql.append(" AND al.entity_type = ?");
            params.add(entityType.trim());
        }
        sql.append(" ORDER BY al.created_at DESC LIMIT ? OFFSET ?");
        params.add(Math.min(Math.max(limit, 1), 500));
        params.add(Math.max(offset, 0));

        return jdbcTemplate.query(
                sql.toString(),
                (rs, rowNum) -> {
                    String actorId = rs.getString("actor_id");
                    String entityId = rs.getString("entity_id");
                    return new AuditLogDto(
                            UUID.fromString(rs.getString("id")),
                            actorId != null ? UUID.fromString(actorId) : null,
                            rs.getString("actor_username"),
                            rs.getString("action"),
                            rs.getString("entity_type"),
                            entityId != null ? UUID.fromString(entityId) : null,
                            rs.getString("old_data_json"),
                            rs.getString("new_data_json"),
                            rs.getString("description"),
                            rs.getObject("created_at", OffsetDateTime.class)
                    );
                },
                params.toArray()
        );
    }

    public List<AuditLogDto> findAuditLogs(String entityType, int limit) {
        return findAuditLogs(entityType, limit, 0);
    }

    public List<ValidationLogDto> findValidationLogs(UUID sessionId, ValidationResult result, int limit, int offset) {
        StringBuilder sql = new StringBuilder("""
                SELECT vl.id, vl.session_id, vl.resident_id, r.nim AS resident_nim, r.full_name AS resident_name,
                       vl.method, vl.result, vl.face_score, vl.liveness_score, vl.face_match,
                       vl.liveness_passed, vl.location_valid, vl.distance_m, vl.accuracy_m,
                       vl.location_reason, vl.rejection_reason, vl.attempted_at
                FROM public.attendance_validation_logs vl
                LEFT JOIN public.residents r ON r.id = vl.resident_id
                WHERE 1=1
                """);
        List<Object> params = new ArrayList<>();
        if (sessionId != null) {
            sql.append(" AND vl.session_id = ?::uuid");
            params.add(sessionId.toString());
        }
        if (result != null) {
            sql.append(" AND vl.result = ?::public.validation_result");
            params.add(result.name());
        }
        sql.append(" ORDER BY vl.attempted_at DESC LIMIT ? OFFSET ?");
        params.add(Math.min(Math.max(limit, 1), 500));
        params.add(Math.max(offset, 0));

        return jdbcTemplate.query(
                sql.toString(),
                (rs, rowNum) -> {
                    String sessId = rs.getString("session_id");
                    String resId = rs.getString("resident_id");
                    return new ValidationLogDto(
                            UUID.fromString(rs.getString("id")),
                            sessId != null ? UUID.fromString(sessId) : null,
                            resId != null ? UUID.fromString(resId) : null,
                            rs.getString("resident_nim"),
                            rs.getString("resident_name"),
                            AttendanceMethod.valueOf(rs.getString("method")),
                            ValidationResult.valueOf(rs.getString("result")),
                            rs.getObject("face_score") != null ? rs.getDouble("face_score") : null,
                            rs.getObject("liveness_score") != null ? rs.getDouble("liveness_score") : null,
                            rs.getObject("face_match", Boolean.class),
                            rs.getObject("liveness_passed", Boolean.class),
                            rs.getObject("location_valid", Boolean.class),
                            rs.getObject("distance_m") != null ? rs.getDouble("distance_m") : null,
                            rs.getObject("accuracy_m") != null ? rs.getDouble("accuracy_m") : null,
                            rs.getString("location_reason"),
                            rs.getString("rejection_reason"),
                            rs.getObject("attempted_at", OffsetDateTime.class)
                    );
                },
                params.toArray()
        );
    }

    public List<ValidationLogDto> findValidationLogs(UUID sessionId, ValidationResult result, int limit) {
        return findValidationLogs(sessionId, result, limit, 0);
    }

    public List<AttendanceRecordHistoryDto> findAttendanceRecordHistory(UUID recordId, int limit, int offset) {
        StringBuilder sql = new StringBuilder("""
                SELECT h.id, h.record_id, h.old_status, h.new_status, h.old_method, h.new_method,
                       h.old_reason, h.new_reason, h.changed_by, u.username AS changed_by_username,
                       h.correction_reason, h.changed_at
                FROM public.attendance_record_history h
                LEFT JOIN public.users u ON u.id = h.changed_by
                WHERE 1=1
                """);
        List<Object> params = new ArrayList<>();
        if (recordId != null) {
            sql.append(" AND h.record_id = ?::uuid");
            params.add(recordId.toString());
        }
        sql.append(" ORDER BY h.changed_at DESC LIMIT ? OFFSET ?");
        params.add(Math.min(Math.max(limit, 1), 500));
        params.add(Math.max(offset, 0));

        return jdbcTemplate.query(
                sql.toString(),
                (rs, rowNum) -> {
                    String os = rs.getString("old_status");
                    String ns = rs.getString("new_status");
                    String om = rs.getString("old_method");
                    String nm = rs.getString("new_method");
                    String cb = rs.getString("changed_by");
                    return new AttendanceRecordHistoryDto(
                            UUID.fromString(rs.getString("id")),
                            UUID.fromString(rs.getString("record_id")),
                            os != null ? AttendanceStatus.valueOf(os) : null,
                            ns != null ? AttendanceStatus.valueOf(ns) : null,
                            om != null ? AttendanceMethod.valueOf(om) : null,
                            nm != null ? AttendanceMethod.valueOf(nm) : null,
                            rs.getString("old_reason"),
                            rs.getString("new_reason"),
                            cb != null ? UUID.fromString(cb) : null,
                            rs.getString("changed_by_username"),
                            rs.getString("correction_reason"),
                            rs.getObject("changed_at", OffsetDateTime.class)
                    );
                },
                params.toArray()
        );
    }

    public List<AttendanceRecordHistoryDto> findAttendanceRecordHistory(UUID recordId, int limit) {
        return findAttendanceRecordHistory(recordId, limit, 0);
    }
}
