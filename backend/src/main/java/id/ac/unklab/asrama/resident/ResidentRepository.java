package id.ac.unklab.asrama.resident;

import id.ac.unklab.asrama.common.DomainEnums.ResidenceCategory;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.resident.ResidentDtos.ConsentDto;
import id.ac.unklab.asrama.resident.ResidentDtos.EmergencyContactDto;
import id.ac.unklab.asrama.resident.ResidentDtos.ResidentProfileDto;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class ResidentRepository {

    private final JdbcTemplate jdbcTemplate;

    public static final RowMapper<ResidentProfileDto> RESIDENT_PROFILE_MAPPER = (rs, rowNum) -> new ResidentProfileDto(
            UUID.fromString(rs.getString("id")),
            rs.getString("nim"),
            rs.getString("full_name"),
            ResidentStatus.valueOf(rs.getString("status")),
            ResidenceCategory.valueOf(rs.getString("residence_category")),
            rs.getString("building"),
            rs.getString("room_number"),
            rs.getBoolean("has_face_profile"),
            rs.getObject("face_enrolled_at", OffsetDateTime.class),
            rs.getBoolean("has_active_consent"),
            rs.getString("active_consent_version"),
            rs.getObject("created_at", OffsetDateTime.class),
            rs.getObject("updated_at", OffsetDateTime.class)
    );

    private static final RowMapper<ConsentDto> CONSENT_MAPPER = (rs, rowNum) -> new ConsentDto(
            UUID.fromString(rs.getString("id")),
            UUID.fromString(rs.getString("resident_id")),
            rs.getString("consent_version"),
            rs.getObject("consented_at", OffsetDateTime.class),
            rs.getObject("revoked_at", OffsetDateTime.class),
            rs.getString("evidence_path")
    );

    private static final RowMapper<EmergencyContactDto> EMERGENCY_CONTACT_MAPPER = (rs, rowNum) -> new EmergencyContactDto(
            UUID.fromString(rs.getString("id")),
            UUID.fromString(rs.getString("resident_id")),
            rs.getString("full_name"),
            rs.getString("relationship"),
            rs.getString("phone"),
            rs.getBoolean("is_primary"),
            rs.getObject("created_at", OffsetDateTime.class),
            rs.getObject("updated_at", OffsetDateTime.class)
    );

    public ResidentRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final String BASE_RESIDENT_SELECT = """
            SELECT r.id, r.nim, r.full_name, r.status, r.residence_category, r.building, r.room_number,
                   (fp.id IS NOT NULL) AS has_face_profile,
                   fp.enrolled_at AS face_enrolled_at,
                   EXISTS (SELECT 1 FROM public.consent_records cr WHERE cr.resident_id = r.id AND cr.revoked_at IS NULL) AS has_active_consent,
                   (SELECT cr.consent_version FROM public.consent_records cr WHERE cr.resident_id = r.id AND cr.revoked_at IS NULL ORDER BY cr.consented_at DESC LIMIT 1) AS active_consent_version,
                   r.created_at, r.updated_at
            FROM public.residents r
            LEFT JOIN public.face_profiles fp ON fp.resident_id = r.id
            """;

    public Optional<ResidentProfileDto> findById(UUID residentId) {
        List<ResidentProfileDto> rows = jdbcTemplate.query(
                BASE_RESIDENT_SELECT + " WHERE r.id = ?::uuid",
                RESIDENT_PROFILE_MAPPER,
                residentId.toString()
        );
        return rows.stream().findFirst();
    }

    public Optional<ResidentProfileDto> findByNim(String nim) {
        List<ResidentProfileDto> rows = jdbcTemplate.query(
                BASE_RESIDENT_SELECT + " WHERE r.nim = ?",
                RESIDENT_PROFILE_MAPPER,
                nim.trim()
        );
        return rows.stream().findFirst();
    }

    public List<ResidentProfileDto> searchResidents(
            ResidentStatus status,
            ResidenceCategory category,
            String search,
            Integer limit,
            Integer offset
    ) {
        StringBuilder sql = new StringBuilder(BASE_RESIDENT_SELECT).append(" WHERE 1=1");
        List<Object> params = new ArrayList<>();
        if (status != null) {
            sql.append(" AND r.status = ?::public.resident_status");
            params.add(status.name());
        }
        if (category != null) {
            sql.append(" AND r.residence_category = ?::public.residence_category");
            params.add(category.name());
        }
        if (search != null && !search.isBlank()) {
            sql.append(" AND (LOWER(r.nim) LIKE ? OR LOWER(r.full_name) LIKE ?)");
            String like = "%" + search.trim().toLowerCase() + "%";
            params.add(like);
            params.add(like);
        }
        sql.append(" ORDER BY r.nim ASC");
        if (limit != null && limit > 0) {
            sql.append(" LIMIT ?");
            params.add(Math.min(limit, 500));
        }
        if (offset != null && offset > 0) {
            sql.append(" OFFSET ?");
            params.add(offset);
        }
        return jdbcTemplate.query(sql.toString(), RESIDENT_PROFILE_MAPPER, params.toArray());
    }

    public List<ResidentProfileDto> searchResidents(ResidentStatus status, ResidenceCategory category, String search) {
        return searchResidents(status, category, search, null, null);
    }

    public ConsentDto insertConsent(UUID residentId, String consentVersion, String evidencePath) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO public.consent_records(id, resident_id, consent_version, evidence_path)
                VALUES (?::uuid, ?::uuid, ?, ?)
                """,
                id.toString(),
                residentId.toString(),
                consentVersion.trim(),
                evidencePath
        );
        return findConsentById(id).orElseThrow();
    }

    public Optional<ConsentDto> findConsentById(UUID consentId) {
        List<ConsentDto> rows = jdbcTemplate.query(
                "SELECT id, resident_id, consent_version, consented_at, revoked_at, evidence_path FROM public.consent_records WHERE id = ?::uuid",
                CONSENT_MAPPER,
                consentId.toString()
        );
        return rows.stream().findFirst();
    }

    public Optional<ConsentDto> findActiveConsentByResident(UUID residentId) {
        List<ConsentDto> rows = jdbcTemplate.query(
                """
                SELECT id, resident_id, consent_version, consented_at, revoked_at, evidence_path
                FROM public.consent_records
                WHERE resident_id = ?::uuid AND revoked_at IS NULL
                ORDER BY consented_at DESC
                LIMIT 1
                """,
                CONSENT_MAPPER,
                residentId.toString()
        );
        return rows.stream().findFirst();
    }

    public List<ConsentDto> findConsentsByResident(UUID residentId) {
        return jdbcTemplate.query(
                """
                SELECT id, resident_id, consent_version, consented_at, revoked_at, evidence_path
                FROM public.consent_records
                WHERE resident_id = ?::uuid
                ORDER BY consented_at DESC
                """,
                CONSENT_MAPPER,
                residentId.toString()
        );
    }

    public void revokeActiveConsent(UUID residentId) {
        jdbcTemplate.update(
                "UPDATE public.consent_records SET revoked_at = now() WHERE resident_id = ?::uuid AND revoked_at IS NULL",
                residentId.toString()
        );
    }

    public List<EmergencyContactDto> findEmergencyContacts(UUID residentId) {
        return jdbcTemplate.query(
                """
                SELECT id, resident_id, full_name, relationship, phone, is_primary, created_at, updated_at
                FROM public.emergency_contacts
                WHERE resident_id = ?::uuid
                ORDER BY is_primary DESC, created_at ASC
                """,
                EMERGENCY_CONTACT_MAPPER,
                residentId.toString()
        );
    }

    public EmergencyContactDto insertEmergencyContact(UUID residentId, String fullName, String relationship, String phone, boolean isPrimary) {
        if (isPrimary) {
            jdbcTemplate.update(
                    "UPDATE public.emergency_contacts SET is_primary = false WHERE resident_id = ?::uuid AND is_primary = true",
                    residentId.toString()
            );
        }
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO public.emergency_contacts(id, resident_id, full_name, relationship, phone, is_primary)
                VALUES (?::uuid, ?::uuid, ?, ?, ?, ?)
                """,
                id.toString(),
                residentId.toString(),
                fullName.trim(),
                relationship.trim(),
                phone.trim(),
                isPrimary
        );
        return jdbcTemplate.queryForObject(
                "SELECT id, resident_id, full_name, relationship, phone, is_primary, created_at, updated_at FROM public.emergency_contacts WHERE id = ?::uuid",
                EMERGENCY_CONTACT_MAPPER,
                id.toString()
        );
    }
}
