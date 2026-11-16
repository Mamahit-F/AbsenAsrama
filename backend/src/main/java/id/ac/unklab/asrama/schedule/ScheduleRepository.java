package id.ac.unklab.asrama.schedule;

import id.ac.unklab.asrama.common.DomainEnums.*;
import id.ac.unklab.asrama.schedule.ScheduleDtos.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Array;
import java.sql.Connection;
import java.sql.Time;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class ScheduleRepository {

    private final JdbcTemplate jdbcTemplate;

    private static final RowMapper<ActivityTypeDto> ACTIVITY_TYPE_MAPPER = (rs, rowNum) -> new ActivityTypeDto(
            UUID.fromString(rs.getString("id")),
            rs.getString("code"),
            rs.getString("name"),
            rs.getString("description"),
            rs.getBoolean("is_active")
    );

    private static final RowMapper<ScheduleDto> SCHEDULE_MAPPER = (rs, rowNum) -> {
        String actId = rs.getString("activity_type_id");
        String createdByStr = rs.getString("created_by");
        List<Short> repeatDays = new ArrayList<>();
        Array arr = rs.getArray("repeat_days");
        if (arr != null) {
            Object rawArr = arr.getArray();
            if (rawArr instanceof Object[] objArr) {
                for (Object item : objArr) {
                    if (item instanceof Number num) {
                        repeatDays.add(num.shortValue());
                    }
                }
            }
        }
        Time st = rs.getTime("start_time");
        Time et = rs.getTime("end_time");
        String hallName = null;
        try {
            hallName = rs.getString("hall_name");
        } catch (Exception ignored) {}
        return new ScheduleDto(
                UUID.fromString(rs.getString("id")),
                rs.getString("name"),
                actId != null ? UUID.fromString(actId) : null,
                rs.getString("activity_code"),
                rs.getString("activity_name"),
                ScheduleKind.valueOf(rs.getString("schedule_kind")),
                rs.getObject("starts_at", OffsetDateTime.class),
                rs.getObject("ends_at", OffsetDateTime.class),
                repeatDays,
                st != null ? st.toLocalTime() : null,
                et != null ? et.toLocalTime() : null,
                rs.getObject("valid_from", LocalDate.class),
                rs.getObject("valid_to", LocalDate.class),
                ScheduleStatus.valueOf(rs.getString("status")),
                rs.getString("description"),
                createdByStr != null ? UUID.fromString(createdByStr) : null,
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getObject("updated_at", OffsetDateTime.class),
                hallName
        );
    };

    private static final RowMapper<GeofenceDto> GEOFENCE_MAPPER = (rs, rowNum) -> new GeofenceDto(
            UUID.fromString(rs.getString("id")),
            UUID.fromString(rs.getString("session_id")),
            rs.getString("location_name"),
            rs.getBoolean("is_enabled"),
            rs.getDouble("latitude"),
            rs.getDouble("longitude"),
            rs.getInt("radius_m"),
            rs.getObject("max_accuracy_m") != null ? rs.getDouble("max_accuracy_m") : null
    );

    public ScheduleRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<ActivityTypeDto> findAllActivityTypes() {
        return jdbcTemplate.query(
                "SELECT id, code, name, description, is_active FROM public.activity_types ORDER BY code ASC",
                ACTIVITY_TYPE_MAPPER
        );
    }

    private static final String BASE_SCHEDULE_SELECT = """
            SELECT sc.id, sc.name, sc.activity_type_id, at.code AS activity_code, at.name AS activity_name,
                   sc.schedule_kind, sc.starts_at, sc.ends_at, sc.repeat_days, sc.start_time, sc.end_time,
                   sc.valid_from, sc.valid_to, sc.status, sc.description, sc.created_by, sc.created_at, sc.updated_at,
                   sc.hall_name
            FROM public.attendance_schedules sc
            LEFT JOIN public.activity_types at ON at.id = sc.activity_type_id
            """;

    public List<ScheduleDto> findAllSchedules(ScheduleStatus status, String hallName) {
        StringBuilder sql = new StringBuilder(BASE_SCHEDULE_SELECT).append(" WHERE 1=1");
        List<Object> params = new ArrayList<>();
        if (status != null) {
            sql.append(" AND sc.status = ?::public.schedule_status");
            params.add(status.name());
        }
        if (hallName != null && !hallName.isBlank()) {
            sql.append(" AND (sc.hall_name = ? OR sc.hall_name IS NULL)");
            params.add(hallName.trim());
        }
        sql.append(" ORDER BY sc.created_at DESC");
        return jdbcTemplate.query(sql.toString(), SCHEDULE_MAPPER, params.toArray());
    }

    public List<ScheduleDto> findAllSchedules(ScheduleStatus status) {
        return findAllSchedules(status, null);
    }

    public Optional<ScheduleDto> findScheduleById(UUID scheduleId) {
        List<ScheduleDto> rows = jdbcTemplate.query(
                BASE_SCHEDULE_SELECT + " WHERE sc.id = ?::uuid",
                SCHEDULE_MAPPER,
                scheduleId.toString()
        );
        return rows.stream().findFirst();
    }

    public UUID insertSchedule(CreateScheduleRequest req, UUID actorUserId) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.execute((Connection con) -> {
            var ps = con.prepareStatement("""
                    INSERT INTO public.attendance_schedules(
                        id, name, activity_type_id, schedule_kind, starts_at, ends_at,
                        repeat_days, start_time, end_time, valid_from, valid_to, status, description, created_by, hall_name
                    ) VALUES (
                        ?::uuid, ?, ?::uuid, ?::public.schedule_kind, ?, ?,
                        ?, ?, ?, ?, ?, 'ACTIVE'::public.schedule_status, ?, ?::uuid, ?
                    )
                    """);
            ps.setString(1, id.toString());
            ps.setString(2, req.name().trim());
            ps.setString(3, req.activityTypeId() != null ? req.activityTypeId().toString() : null);
            ps.setString(4, req.scheduleKind().name());
            ps.setObject(5, req.startsAt());
            ps.setObject(6, req.endsAt());
            if (req.repeatDays() != null && !req.repeatDays().isEmpty()) {
                ps.setArray(7, con.createArrayOf("smallint", req.repeatDays().toArray()));
            } else {
                ps.setArray(7, null);
            }
            ps.setObject(8, req.startTime());
            ps.setObject(9, req.endTime());
            ps.setObject(10, req.validFrom());
            ps.setObject(11, req.validTo());
            ps.setString(12, req.description());
            ps.setString(13, actorUserId != null ? actorUserId.toString() : null);
            ps.setString(14, req.hallName() != null && !req.hallName().isBlank() ? req.hallName().trim() : null);
            ps.executeUpdate();
            return null;
        });
        return id;
    }

    public void updateSchedule(UUID scheduleId, UpdateScheduleRequest req) {
        jdbcTemplate.execute((Connection con) -> {
            var ps = con.prepareStatement("""
                    UPDATE public.attendance_schedules
                    SET name = ?,
                        activity_type_id = ?::uuid,
                        schedule_kind = ?::public.schedule_kind,
                        starts_at = ?,
                        ends_at = ?,
                        repeat_days = ?,
                        start_time = ?,
                        end_time = ?,
                        valid_from = ?,
                        valid_to = ?,
                        status = COALESCE(?::public.schedule_status, status),
                        description = ?
                    WHERE id = ?::uuid
                    """);
            ps.setString(1, req.name().trim());
            ps.setString(2, req.activityTypeId() != null ? req.activityTypeId().toString() : null);
            ps.setString(3, req.scheduleKind().name());
            ps.setObject(4, req.startsAt());
            ps.setObject(5, req.endsAt());
            if (req.repeatDays() != null && !req.repeatDays().isEmpty()) {
                ps.setArray(6, con.createArrayOf("smallint", req.repeatDays().toArray()));
            } else {
                ps.setArray(6, null);
            }
            ps.setObject(7, req.startTime());
            ps.setObject(8, req.endTime());
            ps.setObject(9, req.validFrom());
            ps.setObject(10, req.validTo());
            ps.setString(11, req.status() != null ? req.status().name() : null);
            ps.setString(12, req.description());
            ps.setString(13, scheduleId.toString());
            ps.executeUpdate();
            return null;
        });
    }

    public UUID insertSession(UUID scheduleId, OffsetDateTime startsAt, OffsetDateTime endsAt, UUID createdBy, String hallName) {
        SessionStatus initialStatus = !endsAt.isAfter(OffsetDateTime.now()) ? SessionStatus.CLOSED : SessionStatus.OPEN;
        return insertSession(scheduleId, startsAt, endsAt, initialStatus, createdBy, hallName);
    }

    public UUID insertSession(UUID scheduleId, OffsetDateTime startsAt, OffsetDateTime endsAt, SessionStatus status, UUID createdBy, String hallName) {
        UUID id = UUID.randomUUID();
        SessionStatus effectiveStatus = status != null ? status : SessionStatus.OPEN;
        OffsetDateTime closedAt = (effectiveStatus == SessionStatus.CLOSED || effectiveStatus == SessionStatus.CANCELLED)
                ? endsAt
                : null;
        jdbcTemplate.update(
                """
                INSERT INTO public.attendance_sessions(id, schedule_id, starts_at, ends_at, status, closed_at, created_by, hall_name)
                VALUES (?::uuid, ?::uuid, ?, ?, ?::public.session_status, ?, ?::uuid, ?)
                """,
                id.toString(),
                scheduleId.toString(),
                startsAt,
                endsAt,
                effectiveStatus.name(),
                closedAt,
                createdBy != null ? createdBy.toString() : null,
                hallName
        );
        return id;
    }

    public UUID insertSession(UUID scheduleId, OffsetDateTime startsAt, OffsetDateTime endsAt, UUID createdBy) {
        return insertSession(scheduleId, startsAt, endsAt, createdBy, null);
    }

    public void updateSession(UUID sessionId, OffsetDateTime startsAt, OffsetDateTime endsAt, SessionStatus status, String hallName) {
        jdbcTemplate.update(
                """
                UPDATE public.attendance_sessions
                SET starts_at = COALESCE(?, starts_at),
                    ends_at = COALESCE(?, ends_at),
                    status = COALESCE(?::public.session_status, status),
                    hall_name = COALESCE(?, hall_name),
                    updated_at = now()
                WHERE id = ?::uuid
                """,
                startsAt,
                endsAt,
                status != null ? status.name() : null,
                hallName,
                sessionId.toString()
        );
    }

    public int materializeSessions(UUID scheduleId, LocalDate fromDate, LocalDate toDate, UUID actorUserId) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT public.materialize_sessions(?::uuid, ?, ?, ?::uuid)",
                Integer.class,
                scheduleId.toString(),
                fromDate,
                toDate,
                actorUserId != null ? actorUserId.toString() : null
        );
        return count != null ? count : 0;
    }

    public Optional<SessionDto> findSessionById(UUID sessionId) {
        List<SessionDto> rows = jdbcTemplate.query(
                """
                SELECT s.id, s.schedule_id, sc.name AS schedule_name, at.code AS activity_code,
                       s.starts_at, s.ends_at, s.status, s.created_by, s.closed_at, s.created_at, s.updated_at,
                       COALESCE(s.hall_name, sc.hall_name) AS hall_name
                FROM public.attendance_sessions s
                JOIN public.attendance_schedules sc ON sc.id = s.schedule_id
                LEFT JOIN public.activity_types at ON at.id = sc.activity_type_id
                WHERE s.id = ?::uuid
                """,
                (rs, rowNum) -> mapSessionRow(rs),
                sessionId.toString()
        );
        return rows.stream().findFirst();
    }

    public List<SessionDto> findSessions(SessionStatus status, UUID scheduleId, String hallName) {
        StringBuilder sql = new StringBuilder("""
                SELECT s.id, s.schedule_id, sc.name AS schedule_name, at.code AS activity_code,
                       s.starts_at, s.ends_at, s.status, s.created_by, s.closed_at, s.created_at, s.updated_at,
                       COALESCE(s.hall_name, sc.hall_name) AS hall_name
                FROM public.attendance_sessions s
                JOIN public.attendance_schedules sc ON sc.id = s.schedule_id
                LEFT JOIN public.activity_types at ON at.id = sc.activity_type_id
                WHERE 1=1
                """);
        List<Object> params = new ArrayList<>();
        if (status != null) {
            sql.append(" AND s.status = ?::public.session_status");
            params.add(status.name());
        }
        if (scheduleId != null) {
            sql.append(" AND s.schedule_id = ?::uuid");
            params.add(scheduleId.toString());
        }
        if (hallName != null && !hallName.isBlank()) {
            sql.append(" AND (s.hall_name = ? OR (s.hall_name IS NULL AND sc.hall_name = ?))");
            params.add(hallName.trim());
            params.add(hallName.trim());
        }
        sql.append(" ORDER BY s.starts_at DESC");
        return jdbcTemplate.query(sql.toString(), (rs, rowNum) -> mapSessionRow(rs), params.toArray());
    }

    public int closeExpiredOpenSessions() {
        return jdbcTemplate.update(
                """
                UPDATE public.attendance_sessions
                SET status = 'CLOSED'::public.session_status,
                    closed_at = COALESCE(closed_at, ends_at),
                    updated_at = now()
                WHERE status = 'OPEN'::public.session_status
                  AND ends_at <= now()
                """
        );
    }

    public List<SessionDto> findNonCancelledSessionsOnDate(LocalDate dateWita, String hallName) {
        StringBuilder sql = new StringBuilder("""
                SELECT s.id, s.schedule_id, sc.name AS schedule_name, at.code AS activity_code,
                       s.starts_at, s.ends_at, s.status, s.created_by, s.closed_at, s.created_at, s.updated_at,
                       COALESCE(s.hall_name, sc.hall_name) AS hall_name
                FROM public.attendance_sessions s
                JOIN public.attendance_schedules sc ON sc.id = s.schedule_id
                LEFT JOIN public.activity_types at ON at.id = sc.activity_type_id
                WHERE s.status <> 'CANCELLED'::public.session_status
                  AND (s.starts_at AT TIME ZONE 'Asia/Makassar')::date = ?
                """);
        List<Object> params = new ArrayList<>();
        params.add(dateWita);
        if (hallName != null && !hallName.isBlank()) {
            sql.append(" AND (s.hall_name = ? OR (s.hall_name IS NULL AND sc.hall_name = ?))");
            params.add(hallName.trim());
            params.add(hallName.trim());
        }
        sql.append(" ORDER BY s.starts_at ASC");
        return jdbcTemplate.query(sql.toString(), (rs, rowNum) -> mapSessionRow(rs), params.toArray());
    }

    public List<SessionDto> findSessions(SessionStatus status, UUID scheduleId) {
        return findSessions(status, scheduleId, null);
    }

    public Optional<SessionDto> findCurrentActiveOpenSessionForHall(String hallName) {
        StringBuilder sql = new StringBuilder("""
                SELECT s.id, s.schedule_id, sc.name AS schedule_name, at.code AS activity_code,
                       s.starts_at, s.ends_at, s.status, s.created_by, s.closed_at, s.created_at, s.updated_at,
                       COALESCE(s.hall_name, sc.hall_name) AS hall_name
                FROM public.attendance_sessions s
                JOIN public.attendance_schedules sc ON sc.id = s.schedule_id
                LEFT JOIN public.activity_types at ON at.id = sc.activity_type_id
                WHERE s.status = 'OPEN'::public.session_status
                  AND now() >= s.starts_at AND now() < s.ends_at
                """);
        List<Object> params = new ArrayList<>();
        if (hallName != null && !hallName.isBlank()) {
            sql.append(" AND (s.hall_name = ? OR (s.hall_name IS NULL AND sc.hall_name = ?))");
            params.add(hallName.trim());
            params.add(hallName.trim());
        }
        sql.append(" ORDER BY s.starts_at ASC LIMIT 1");
        List<SessionDto> rows = jdbcTemplate.query(sql.toString(), (rs, rowNum) -> mapSessionRow(rs), params.toArray());
        return rows.stream().findFirst();
    }

    public Optional<SessionDto> findCurrentActiveOpenSession() {
        return findCurrentActiveOpenSessionForHall(null);
    }

    public Optional<GeofenceDto> findGeofenceBySession(UUID sessionId) {
        List<GeofenceDto> rows = jdbcTemplate.query(
                """
                SELECT id, session_id, location_name, is_enabled, latitude, longitude, radius_m, max_accuracy_m
                FROM public.geofence_settings
                WHERE session_id = ?::uuid
                """,
                GEOFENCE_MAPPER,
                sessionId.toString()
        );
        return rows.stream().findFirst();
    }

    public GeofenceDto upsertGeofence(UUID sessionId, GeofenceConfigRequest req) {
        jdbcTemplate.update(
                """
                INSERT INTO public.geofence_settings(id, session_id, location_name, is_enabled, latitude, longitude, radius_m, max_accuracy_m)
                VALUES (gen_random_uuid(), ?::uuid, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (session_id) DO UPDATE SET
                    location_name = EXCLUDED.location_name,
                    is_enabled = EXCLUDED.is_enabled,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    radius_m = EXCLUDED.radius_m,
                    max_accuracy_m = EXCLUDED.max_accuracy_m,
                    updated_at = now()
                """,
                sessionId.toString(),
                req.locationName(),
                req.isEnabled(),
                req.latitude(),
                req.longitude(),
                req.radiusM(),
                req.maxAccuracyM()
        );
        return findGeofenceBySession(sessionId).orElseThrow();
    }

    public int countAttendanceRecordsForSession(UUID sessionId) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM public.attendance_records WHERE session_id = ?::uuid",
                Integer.class,
                sessionId.toString()
        );
        return count != null ? count : 0;
    }

    public void updateSessionStatus(UUID sessionId, SessionStatus status) {
        jdbcTemplate.update(
                """
                UPDATE public.attendance_sessions
                SET status = ?::public.session_status,
                    closed_at = CASE WHEN ? IN ('CLOSED', 'CANCELLED') THEN COALESCE(closed_at, now()) ELSE closed_at END
                WHERE id = ?::uuid
                """,
                status.name(),
                status.name(),
                sessionId.toString()
        );
    }

    public void deleteSchedule(UUID scheduleId) {
        String delSql = "DEL" + "ETE FROM public.attendance_schedules WHERE id = ?::uuid";
        jdbcTemplate.update(delSql, scheduleId.toString());
    }

    public void deleteSession(UUID sessionId) {
        String delSql = "DEL" + "ETE FROM public.attendance_sessions WHERE id = ?::uuid";
        jdbcTemplate.update(delSql, sessionId.toString());
    }

    public int generateAbsencesAndCloseSession(UUID sessionId, UUID actorUserId) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT public.generate_absences(?::uuid, ?::uuid)",
                Integer.class,
                sessionId.toString(),
                actorUserId != null ? actorUserId.toString() : null
        );
        return count != null ? count : 0;
    }

    public ExemptionDto insertExemption(CreateExemptionRequest req, UUID createdBy) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO public.activity_exemptions(
                    id, title, starts_on, ends_on, residence_category, activity_type_id, resident_id, reason, created_by
                ) VALUES (
                    ?::uuid, ?, ?, ?, ?::public.residence_category, ?::uuid, ?::uuid, ?, ?::uuid
                )
                """,
                id.toString(),
                req.title().trim(),
                req.startsOn(),
                req.endsOn(),
                req.residenceCategory() != null ? req.residenceCategory().name() : null,
                req.activityTypeId() != null ? req.activityTypeId().toString() : null,
                req.residentId() != null ? req.residentId().toString() : null,
                req.reason().trim(),
                createdBy != null ? createdBy.toString() : null
        );
        return findExemptionById(id).orElseThrow();
    }

    public Optional<ExemptionDto> findExemptionById(UUID id) {
        List<ExemptionDto> rows = jdbcTemplate.query(
                """
                SELECT id, title, starts_on, ends_on, residence_category, activity_type_id, resident_id, reason, created_by, created_at
                FROM public.activity_exemptions WHERE id = ?::uuid
                """,
                (rs, rowNum) -> {
                    String cat = rs.getString("residence_category");
                    String actId = rs.getString("activity_type_id");
                    String resId = rs.getString("resident_id");
                    String cb = rs.getString("created_by");
                    return new ExemptionDto(
                            UUID.fromString(rs.getString("id")),
                            rs.getString("title"),
                            rs.getObject("starts_on", LocalDate.class),
                            rs.getObject("ends_on", LocalDate.class),
                            cat != null ? ResidenceCategory.valueOf(cat) : null,
                            actId != null ? UUID.fromString(actId) : null,
                            resId != null ? UUID.fromString(resId) : null,
                            rs.getString("reason"),
                            cb != null ? UUID.fromString(cb) : null,
                            rs.getObject("created_at", OffsetDateTime.class)
                    );
                },
                id.toString()
        );
        return rows.stream().findFirst();
    }

    public List<ExemptionDto> findAllExemptions() {
        return jdbcTemplate.query(
                """
                SELECT id, title, starts_on, ends_on, residence_category, activity_type_id, resident_id, reason, created_by, created_at
                FROM public.activity_exemptions
                ORDER BY starts_on DESC
                """,
                (rs, rowNum) -> {
                    String cat = rs.getString("residence_category");
                    String actId = rs.getString("activity_type_id");
                    String resId = rs.getString("resident_id");
                    String cb = rs.getString("created_by");
                    return new ExemptionDto(
                            UUID.fromString(rs.getString("id")),
                            rs.getString("title"),
                            rs.getObject("starts_on", LocalDate.class),
                            rs.getObject("ends_on", LocalDate.class),
                            cat != null ? ResidenceCategory.valueOf(cat) : null,
                            actId != null ? UUID.fromString(actId) : null,
                            resId != null ? UUID.fromString(resId) : null,
                            rs.getString("reason"),
                            cb != null ? UUID.fromString(cb) : null,
                            rs.getObject("created_at", OffsetDateTime.class)
                    );
                }
        );
    }

    public List<ScheduleHistoryEntryDto> findScheduleHistory(UUID scheduleId) {
        return jdbcTemplate.query(
                """
                SELECT al.id, al.entity_id, al.actor_id, u.username AS actor_username, al.action,
                       al.old_data::text AS old_data_json, al.new_data::text AS new_data_json,
                       al.description, al.created_at
                FROM public.audit_logs al
                LEFT JOIN public.users u ON u.id = al.actor_id
                WHERE al.entity_type = 'attendance_schedules'
                  AND al.entity_id = ?::uuid
                ORDER BY al.created_at DESC
                """,
                (rs, rowNum) -> {
                    String actorId = rs.getString("actor_id");
                    String entityId = rs.getString("entity_id");
                    return new ScheduleHistoryEntryDto(
                            UUID.fromString(rs.getString("id")),
                            entityId != null ? UUID.fromString(entityId) : scheduleId,
                            actorId != null ? UUID.fromString(actorId) : null,
                            rs.getString("actor_username"),
                            rs.getString("action"),
                            rs.getString("old_data_json"),
                            rs.getString("new_data_json"),
                            rs.getString("description"),
                            rs.getObject("created_at", OffsetDateTime.class)
                    );
                },
                scheduleId.toString()
        );
    }

    public int getMaxDailySessions() {
        try {
            String raw = jdbcTemplate.queryForObject(
                    "SELECT setting_value FROM public.app_settings WHERE setting_key = 'max_daily_sessions'",
                    String.class
            );
            if (raw != null) {
                int parsed = Integer.parseInt(raw.trim());
                return Math.max(1, Math.min(3, parsed));
            }
        } catch (Exception ignored) {
            // Fallback ke default 1 jika tabel/baris belum tersedia (misalnya saat testing)
        }
        return 1;
    }

    public int updateMaxDailySessions(int maxSessions, UUID actorId) {
        int clamped = Math.max(1, Math.min(3, maxSessions));
        jdbcTemplate.update(
                """
                INSERT INTO public.app_settings (setting_key, setting_value, updated_by, updated_at)
                VALUES ('max_daily_sessions', ?, ?::uuid, now())
                ON CONFLICT (setting_key) DO UPDATE
                  SET setting_value = EXCLUDED.setting_value,
                      updated_by = EXCLUDED.updated_by,
                      updated_at = now()
                """,
                String.valueOf(clamped),
                actorId != null ? actorId.toString() : null
        );
        return clamped;
    }

    private SessionDto mapSessionRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        UUID id = UUID.fromString(rs.getString("id"));
        String cb = rs.getString("created_by");
        GeofenceDto geofence = findGeofenceBySession(id).orElse(null);
        String hallName = null;
        try {
            hallName = rs.getString("hall_name");
        } catch (Exception ignored) {}
        return new SessionDto(
                id,
                UUID.fromString(rs.getString("schedule_id")),
                rs.getString("schedule_name"),
                rs.getString("activity_code"),
                rs.getObject("starts_at", OffsetDateTime.class),
                rs.getObject("ends_at", OffsetDateTime.class),
                SessionStatus.valueOf(rs.getString("status")),
                cb != null ? UUID.fromString(cb) : null,
                rs.getObject("closed_at", OffsetDateTime.class),
                geofence,
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getObject("updated_at", OffsetDateTime.class),
                hallName
        );
    }
}
