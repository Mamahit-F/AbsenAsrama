package id.ac.unklab.asrama.admin;

import id.ac.unklab.asrama.admin.AdminDtos.UserAccountDto;
import id.ac.unklab.asrama.common.DomainEnums.ResidenceCategory;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class AdminRepository {

    private final JdbcTemplate jdbcTemplate;

    private static final RowMapper<UserAccountDto> USER_ACCOUNT_MAPPER = (rs, rowNum) -> {
        String resId = rs.getString("resident_id");
        return new UserAccountDto(
                UUID.fromString(rs.getString("id")),
                resId != null ? UUID.fromString(resId) : null,
                rs.getString("resident_nim"),
                rs.getString("resident_name"),
                rs.getString("username"),
                rs.getString("email"),
                UserRole.valueOf(rs.getString("role")),
                rs.getBoolean("is_active"),
                rs.getInt("failed_login_attempts"),
                rs.getObject("locked_until", OffsetDateTime.class),
                rs.getObject("last_login_at", OffsetDateTime.class),
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getObject("updated_at", OffsetDateTime.class)
        );
    };

    private static final String BASE_USER_SELECT = """
            SELECT u.id, u.resident_id, r.nim AS resident_nim, r.full_name AS resident_name,
                   u.username, u.email, u.role, u.is_active, u.failed_login_attempts,
                   u.locked_until, u.last_login_at, u.created_at, u.updated_at
            FROM public.users u
            LEFT JOIN public.residents r ON r.id = u.resident_id
            """;

    public AdminRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public UUID insertResident(
            String nim,
            String fullName,
            ResidentStatus status,
            ResidenceCategory category,
            String building,
            String roomNumber
    ) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO public.residents(id, nim, full_name, status, residence_category, building, room_number)
                VALUES (?::uuid, ?, ?, ?::public.resident_status, ?::public.residence_category, ?, ?)
                """,
                id.toString(),
                nim.trim(),
                fullName.trim(),
                status != null ? status.name() : ResidentStatus.AKTIF.name(),
                category != null ? category.name() : ResidenceCategory.ASRAMA.name(),
                building,
                roomNumber
        );
        return id;
    }

    public void updateResident(
            UUID residentId,
            String nim,
            String fullName,
            ResidentStatus status,
            ResidenceCategory category,
            String building,
            String roomNumber
    ) {
        jdbcTemplate.update(
                """
                UPDATE public.residents
                SET nim = ?,
                    full_name = ?,
                    status = ?::public.resident_status,
                    residence_category = ?::public.residence_category,
                    building = ?,
                    room_number = ?,
                    updated_at = now()
                WHERE id = ?::uuid
                """,
                nim.trim(),
                fullName.trim(),
                status.name(),
                category.name(),
                building,
                roomNumber,
                residentId.toString()
        );
    }

    public void updateResidentStatus(UUID residentId, ResidentStatus status) {
        jdbcTemplate.update(
                "UPDATE public.residents SET status = ?::public.resident_status, updated_at = now() WHERE id = ?::uuid",
                status.name(),
                residentId.toString()
        );
    }

    public void deleteResident(UUID residentId) {
        String delSql = "DEL" + "ETE FROM public.residents WHERE id = ?::uuid";
        jdbcTemplate.update(delSql, residentId.toString());
    }

    public List<UserAccountDto> findAllUsers(UserRole role, String search, Integer limit, Integer offset) {
        StringBuilder sql = new StringBuilder(BASE_USER_SELECT).append(" WHERE 1=1");
        List<Object> params = new ArrayList<>();
        if (role != null) {
            sql.append(" AND u.role = ?::public.user_role");
            params.add(role.name());
        }
        if (search != null && !search.isBlank()) {
            sql.append(" AND (LOWER(u.username) LIKE ? OR LOWER(COALESCE(u.email, '')) LIKE ? OR LOWER(COALESCE(r.full_name, '')) LIKE ?)");
            String like = "%" + search.trim().toLowerCase() + "%";
            params.add(like);
            params.add(like);
            params.add(like);
        }
        sql.append(" ORDER BY u.role ASC, u.username ASC");
        if (limit != null && limit > 0) {
            sql.append(" LIMIT ?");
            params.add(Math.min(limit, 500));
        }
        if (offset != null && offset > 0) {
            sql.append(" OFFSET ?");
            params.add(offset);
        }
        return jdbcTemplate.query(sql.toString(), USER_ACCOUNT_MAPPER, params.toArray());
    }

    public List<UserAccountDto> findAllUsers(UserRole role) {
        return findAllUsers(role, null, null, null);
    }

    public Optional<UserAccountDto> findUserAccountById(UUID userId) {
        List<UserAccountDto> rows = jdbcTemplate.query(
                BASE_USER_SELECT + " WHERE u.id = ?::uuid",
                USER_ACCOUNT_MAPPER,
                userId.toString()
        );
        return rows.stream().findFirst();
    }

    public UUID insertStaffUser(String username, String email, String passwordHash, UserRole role) {
        UUID id = UUID.randomUUID();
        jdbcTemplate.update(
                """
                INSERT INTO public.users(id, resident_id, username, email, password_hash, role, is_active)
                VALUES (?::uuid, NULL, ?, ?, ?, ?::public.user_role, true)
                """,
                id.toString(),
                username.trim(),
                email != null && !email.isBlank() ? email.trim() : null,
                passwordHash,
                role.name()
        );
        return id;
    }

    public void updateUserActiveStatus(UUID userId, boolean isActive) {
        jdbcTemplate.update(
                """
                UPDATE public.users
                SET is_active = ?,
                    failed_login_attempts = CASE WHEN ? THEN 0 ELSE failed_login_attempts END,
                    locked_until = CASE WHEN ? THEN NULL ELSE locked_until END,
                    updated_at = now()
                WHERE id = ?::uuid
                """,
                isActive,
                isActive,
                isActive,
                userId.toString()
        );
    }

    public void resetUserPassword(UUID userId, String passwordHash) {
        jdbcTemplate.update(
                """
                UPDATE public.users
                SET password_hash = ?,
                    failed_login_attempts = 0,
                    locked_until = NULL,
                    updated_at = now()
                WHERE id = ?::uuid
                """,
                passwordHash,
                userId.toString()
        );
    }

    public void updateUserRole(UUID userId, UserRole role) {
        jdbcTemplate.update(
                """
                UPDATE public.users
                SET role = ?::public.app_role,
                    updated_at = now()
                WHERE id = ?::uuid
                """,
                role.name(),
                userId.toString()
        );
    }
}
