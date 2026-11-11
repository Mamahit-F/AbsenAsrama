package id.ac.unklab.asrama.auth;

import id.ac.unklab.asrama.auth.AuthDtos.UserLoginLookupRow;
import id.ac.unklab.asrama.common.DomainEnums.ResidentStatus;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class AuthRepository {

    private final JdbcTemplate jdbcTemplate;

    private static final RowMapper<UserLoginLookupRow> LOGIN_ROW_MAPPER = (rs, rowNum) -> {
        String roleStr = rs.getString("role");
        String resStatusStr = rs.getString("resident_status");
        String resIdStr = rs.getString("resident_id");
        return new UserLoginLookupRow(
                UUID.fromString(rs.getString("id")),
                rs.getString("username"),
                rs.getString("email"),
                rs.getString("password_hash"),
                roleStr != null ? UserRole.valueOf(roleStr) : null,
                resIdStr != null ? UUID.fromString(resIdStr) : null,
                resStatusStr != null ? ResidentStatus.valueOf(resStatusStr) : null,
                rs.getBoolean("is_active"),
                rs.getInt("failed_login_attempts"),
                rs.getObject("locked_until", OffsetDateTime.class),
                rs.getBoolean("is_locked")
        );
    };

    public AuthRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Optional<UserLoginLookupRow> findUserForLogin(String identifier) {
        List<UserLoginLookupRow> rows = jdbcTemplate.query(
                "SELECT * FROM public.get_user_for_login(?)",
                LOGIN_ROW_MAPPER,
                identifier
        );
        return rows.stream().findFirst();
    }

    public UUID registerResidentAccount(String nim, String fullName, String passwordHash, String email) {
        String id = jdbcTemplate.queryForObject(
                "SELECT public.register_resident_account(?, ?, ?, ?)::text",
                String.class,
                nim,
                fullName,
                passwordHash,
                email
        );
        return id != null ? UUID.fromString(id) : null;
    }

    public OffsetDateTime registerLoginFailure(UUID userId) {
        return jdbcTemplate.queryForObject(
                "SELECT public.register_login_failure(?::uuid)",
                OffsetDateTime.class,
                userId.toString()
        );
    }

    public void registerLoginSuccess(UUID userId) {
        jdbcTemplate.queryForObject(
                "SELECT public.register_login_success(?::uuid)::text",
                String.class,
                userId.toString()
        );
    }

    public Optional<UserLoginLookupRow> findUserById(UUID userId) {
        List<UserLoginLookupRow> rows = jdbcTemplate.query(
                """
                SELECT u.id, u.username, u.email, u.password_hash, u.role, u.resident_id,
                       r.status AS resident_status, u.is_active, u.failed_login_attempts,
                       u.locked_until, COALESCE(u.locked_until > now(), false) AS is_locked
                FROM public.users u
                LEFT JOIN public.residents r ON r.id = u.resident_id
                WHERE u.id = ?::uuid
                """,
                LOGIN_ROW_MAPPER,
                userId.toString()
        );
        return rows.stream().findFirst();
    }

    public void updatePasswordHash(UUID userId, String newPasswordHash) {
        jdbcTemplate.update(
                "UPDATE public.users SET password_hash = ? WHERE id = ?::uuid",
                newPasswordHash,
                userId.toString()
        );
    }
}
