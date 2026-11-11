package id.ac.unklab.asrama.violation;

import id.ac.unklab.asrama.common.DomainEnums.*;
import id.ac.unklab.asrama.violation.ViolationDtos.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class ViolationRepository {

    private final JdbcTemplate jdbcTemplate;

    private static final RowMapper<ViolationDto> VIOLATION_MAPPER = (rs, rowNum) -> {
        String resId = rs.getString("resident_id");
        String attId = rs.getString("attendance_record_id");
        String semId = rs.getString("semester_id");
        String cb = rs.getString("created_by");
        return new ViolationDto(
                UUID.fromString(rs.getString("id")),
                resId != null ? UUID.fromString(resId) : null,
                rs.getString("resident_nim"),
                rs.getString("resident_name"),
                attId != null ? UUID.fromString(attId) : null,
                semId != null ? UUID.fromString(semId) : null,
                rs.getInt("points"),
                ViolationStatus.valueOf(rs.getString("status")),
                ViolationSource.valueOf(rs.getString("source")),
                rs.getString("reason"),
                cb != null ? UUID.fromString(cb) : null,
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getObject("updated_at", OffsetDateTime.class)
        );
    };

    private static final RowMapper<HelpRequestDto> HELP_REQUEST_MAPPER = (rs, rowNum) -> {
        String hb = rs.getString("handled_by");
        return new HelpRequestDto(
                UUID.fromString(rs.getString("id")),
                UUID.fromString(rs.getString("resident_id")),
                rs.getString("resident_nim"),
                rs.getString("resident_name"),
                RequestType.valueOf(rs.getString("request_type")),
                rs.getString("subject"),
                rs.getString("description"),
                CaseStatus.valueOf(rs.getString("status")),
                hb != null ? UUID.fromString(hb) : null,
                rs.getObject("resolved_at", OffsetDateTime.class),
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getObject("updated_at", OffsetDateTime.class)
        );
    };

    public ViolationRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<ViolationDto> findViolations(UUID residentId, ViolationStatus status, Integer limit, Integer offset) {
        StringBuilder sql = new StringBuilder("""
                SELECT id, resident_id, resident_nim, resident_name, attendance_record_id, semester_id,
                       points, status, source, reason, created_by, created_at, updated_at
                FROM public.violations
                WHERE 1=1
                """);
        List<Object> params = new ArrayList<>();
        if (residentId != null) {
            sql.append(" AND resident_id = ?::uuid");
            params.add(residentId.toString());
        }
        if (status != null) {
            sql.append(" AND status = ?::public.violation_status");
            params.add(status.name());
        }
        sql.append(" ORDER BY created_at DESC");
        if (limit != null && limit > 0) {
            sql.append(" LIMIT ?");
            params.add(Math.min(limit, 500));
        }
        if (offset != null && offset > 0) {
            sql.append(" OFFSET ?");
            params.add(offset);
        }
        return jdbcTemplate.query(sql.toString(), VIOLATION_MAPPER, params.toArray());
    }

    public List<ViolationDto> findViolations(UUID residentId, ViolationStatus status) {
        return findViolations(residentId, status, null, null);
    }

    public Optional<ViolationDto> findViolationById(UUID violationId) {
        List<ViolationDto> rows = jdbcTemplate.query(
                """
                SELECT id, resident_id, resident_nim, resident_name, attendance_record_id, semester_id,
                       points, status, source, reason, created_by, created_at, updated_at
                FROM public.violations
                WHERE id = ?::uuid
                """,
                VIOLATION_MAPPER,
                violationId.toString()
        );
        return rows.stream().findFirst();
    }

    public UUID insertManualViolation(
            UUID residentId,
            String residentNim,
            String residentName,
            UUID semesterId,
            int points,
            String reason,
            UUID createdBy
    ) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO public.violations(
                    id, resident_id, resident_nim, resident_name, semester_id,
                    points, status, source, reason, created_by
                ) VALUES (
                    ?::uuid, ?::uuid, ?, ?, ?::uuid,
                    ?, 'ACTIVE'::public.violation_status, 'MANUAL'::public.violation_source, ?, ?::uuid
                )
                """,
                id.toString(),
                residentId.toString(),
                residentNim,
                residentName,
                semesterId != null ? semesterId.toString() : null,
                points,
                reason.trim(),
                createdBy != null ? createdBy.toString() : null
        );
        return id;
    }

    public void updateViolation(UUID violationId, int points, ViolationStatus status, String reason) {
        jdbcTemplate.update(
                """
                UPDATE public.violations
                SET points = ?,
                    status = ?::public.violation_status,
                    reason = ?,
                    updated_at = now()
                WHERE id = ?::uuid
                """,
                points,
                status.name(),
                reason.trim(),
                violationId.toString()
        );
    }

    public List<ViolationPointHistoryDto> findViolationHistory(UUID violationId) {
        return jdbcTemplate.query(
                """
                SELECT id, violation_id, old_points, new_points, old_status, new_status, changed_by, reason, changed_at
                FROM public.violation_point_history
                WHERE violation_id = ?::uuid
                ORDER BY changed_at DESC
                """,
                (rs, rowNum) -> {
                    String os = rs.getString("old_status");
                    String ns = rs.getString("new_status");
                    String cb = rs.getString("changed_by");
                    return new ViolationPointHistoryDto(
                            UUID.fromString(rs.getString("id")),
                            UUID.fromString(rs.getString("violation_id")),
                            rs.getObject("old_points", Integer.class),
                            rs.getObject("new_points", Integer.class),
                            os != null ? ViolationStatus.valueOf(os) : null,
                            ns != null ? ViolationStatus.valueOf(ns) : null,
                            cb != null ? UUID.fromString(cb) : null,
                            rs.getString("reason"),
                            rs.getObject("changed_at", OffsetDateTime.class)
                    );
                },
                violationId.toString()
        );
    }

    public CoachingRecordDto insertCoachingRecord(CreateCoachingRecordRequest req, UUID coachedBy) {
        UUID id = UUID.randomUUID();
        LocalDate date = req.coachingDate() != null ? req.coachingDate() : LocalDate.now();
        jdbcTemplate.update(
                """
                INSERT INTO public.coaching_records(id, resident_id, semester_id, coached_by, coaching_date, topic, notes)
                VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?, ?, ?)
                """,
                id.toString(),
                req.residentId().toString(),
                req.semesterId() != null ? req.semesterId().toString() : null,
                coachedBy.toString(),
                date,
                req.topic().trim(),
                req.notes()
        );
        return findCoachingRecords(req.residentId()).stream()
                .filter(c -> c.id().equals(id))
                .findFirst()
                .orElseThrow();
    }

    public List<CoachingRecordDto> findCoachingRecords(UUID residentId, Integer limit, Integer offset) {
        StringBuilder sql = new StringBuilder("""
                SELECT cr.id, cr.resident_id, r.nim AS resident_nim, r.full_name AS resident_name,
                       cr.semester_id, cr.coached_by, cr.coaching_date, cr.topic, cr.notes, cr.created_at
                FROM public.coaching_records cr
                JOIN public.residents r ON r.id = cr.resident_id
                WHERE 1=1
                """);
        List<Object> params = new ArrayList<>();
        if (residentId != null) {
            sql.append(" AND cr.resident_id = ?::uuid");
            params.add(residentId.toString());
        }
        sql.append(" ORDER BY cr.coaching_date DESC, cr.created_at DESC");
        if (limit != null && limit > 0) {
            sql.append(" LIMIT ?");
            params.add(Math.min(limit, 500));
        }
        if (offset != null && offset > 0) {
            sql.append(" OFFSET ?");
            params.add(offset);
        }
        return jdbcTemplate.query(
                sql.toString(),
                (rs, rowNum) -> {
                    String semId = rs.getString("semester_id");
                    String cb = rs.getString("coached_by");
                    return new CoachingRecordDto(
                            UUID.fromString(rs.getString("id")),
                            UUID.fromString(rs.getString("resident_id")),
                            rs.getString("resident_nim"),
                            rs.getString("resident_name"),
                            semId != null ? UUID.fromString(semId) : null,
                            cb != null ? UUID.fromString(cb) : null,
                            rs.getObject("coaching_date", LocalDate.class),
                            rs.getString("topic"),
                            rs.getString("notes"),
                            rs.getObject("created_at", OffsetDateTime.class)
                    );
                },
                params.toArray()
        );
    }

    public List<CoachingRecordDto> findCoachingRecords(UUID residentId) {
        return findCoachingRecords(residentId, null, null);
    }

    public HelpRequestDto insertHelpRequest(UUID residentId, RequestType type, String subject, String description, UUID handledBy) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO public.help_requests(id, resident_id, request_type, subject, description, status, handled_by)
                VALUES (?::uuid, ?::uuid, ?::public.request_type, ?, ?, 'BARU'::public.case_status, ?::uuid)
                """,
                id.toString(),
                residentId.toString(),
                type.name(),
                subject.trim(),
                description.trim(),
                handledBy != null ? handledBy.toString() : null
        );
        return findHelpRequestById(id).orElseThrow();
    }

    public Optional<HelpRequestDto> findHelpRequestById(UUID id) {
        List<HelpRequestDto> rows = jdbcTemplate.query(
                """
                SELECT hr.id, hr.resident_id, r.nim AS resident_nim, r.full_name AS resident_name,
                       hr.request_type, hr.subject, hr.description, hr.status, hr.handled_by,
                       hr.resolved_at, hr.created_at, hr.updated_at
                FROM public.help_requests hr
                JOIN public.residents r ON r.id = hr.resident_id
                WHERE hr.id = ?::uuid
                """,
                HELP_REQUEST_MAPPER,
                id.toString()
        );
        return rows.stream().findFirst();
    }

    public List<HelpRequestDto> findHelpRequests(CaseStatus status, Integer limit, Integer offset) {
        StringBuilder sql = new StringBuilder("""
                SELECT hr.id, hr.resident_id, r.nim AS resident_nim, r.full_name AS resident_name,
                       hr.request_type, hr.subject, hr.description, hr.status, hr.handled_by,
                       hr.resolved_at, hr.created_at, hr.updated_at
                FROM public.help_requests hr
                JOIN public.residents r ON r.id = hr.resident_id
                WHERE 1=1
                """);
        List<Object> params = new ArrayList<>();
        if (status != null) {
            sql.append(" AND hr.status = ?::public.case_status");
            params.add(status.name());
        }
        sql.append(" ORDER BY hr.created_at DESC");
        if (limit != null && limit > 0) {
            sql.append(" LIMIT ?");
            params.add(Math.min(limit, 500));
        }
        if (offset != null && offset > 0) {
            sql.append(" OFFSET ?");
            params.add(offset);
        }
        return jdbcTemplate.query(sql.toString(), HELP_REQUEST_MAPPER, params.toArray());
    }

    public List<HelpRequestDto> findHelpRequests(CaseStatus status) {
        return findHelpRequests(status, null, null);
    }

    public void updateHelpRequestStatus(UUID requestId, CaseStatus newStatus, String note, UUID actorUserId) {
        CaseStatus oldStatus = findHelpRequestById(requestId)
                .map(HelpRequestDto::status)
                .orElse(null);

        jdbcTemplate.update(
                """
                UPDATE public.help_requests
                SET status = ?::public.case_status,
                    handled_by = COALESCE(handled_by, ?::uuid),
                    updated_at = now()
                WHERE id = ?::uuid
                """,
                newStatus.name(),
                actorUserId.toString(),
                requestId.toString()
        );
        // Trigger trg_help_request_status otomatis mencatat perubahan status tanpa catatan (note = NULL).
        // Bila petugas menyertakan catatan tindak lanjut (note), catat riwayat dengan old_status yang akurat.
        if (note != null && !note.isBlank()) {
            jdbcTemplate.update(
                    """
                    INSERT INTO public.help_request_updates(id, request_id, old_status, new_status, note, updated_by)
                    VALUES (gen_random_uuid(), ?::uuid, ?::public.case_status, ?::public.case_status, ?, ?::uuid)
                    """,
                    requestId.toString(),
                    oldStatus != null ? oldStatus.name() : null,
                    newStatus.name(),
                    note.trim(),
                    actorUserId.toString()
            );
        }
    }

    public List<HelpRequestUpdateHistoryDto> findHelpRequestUpdates(UUID requestId) {
        return jdbcTemplate.query(
                """
                SELECT id, request_id, old_status, new_status, note, updated_by, created_at
                FROM public.help_request_updates
                WHERE request_id = ?::uuid
                ORDER BY created_at ASC
                """,
                (rs, rowNum) -> {
                    String os = rs.getString("old_status");
                    String ub = rs.getString("updated_by");
                    return new HelpRequestUpdateHistoryDto(
                            UUID.fromString(rs.getString("id")),
                            UUID.fromString(rs.getString("request_id")),
                            os != null ? CaseStatus.valueOf(os) : null,
                            CaseStatus.valueOf(rs.getString("new_status")),
                            rs.getString("note"),
                            ub != null ? UUID.fromString(ub) : null,
                            rs.getObject("created_at", OffsetDateTime.class)
                    );
                },
                requestId.toString()
        );
    }
}
