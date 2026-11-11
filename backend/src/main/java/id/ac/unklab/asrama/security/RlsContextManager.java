package id.ac.unklab.asrama.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import id.ac.unklab.asrama.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Mengelola konteks identitas transaksi PostgreSQL (SET LOCAL ROLE app_backend + public.set_app_context)
 * sesuai kontrak DATABASE_SECURITY_DESIGN.md dan DATABASE_DEPLOYMENT_GUIDE.md.
 */
@Component
public class RlsContextManager {

    private static final Logger log = LoggerFactory.getLogger(RlsContextManager.class);
    private static final String TX_BOUND_RESOURCE_KEY = "ASRAMA_RLS_CONTEXT_APPLIED";

    private final JdbcTemplate jdbcTemplate;
    private final AppProperties appProperties;
    private final ObjectMapper objectMapper;

    public RlsContextManager(JdbcTemplate jdbcTemplate, AppProperties appProperties, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.appProperties = appProperties;
        this.objectMapper = objectMapper;
    }

    /**
     * Dipanggil secara otomatis di awal transaksi (@Transactional) atau secara eksplisit.
     * Menerapkan SET LOCAL ROLE app_backend pada setiap transaksi (termasuk transaksi publik/unauthenticated)
     * dan SELECT public.set_app_context(userId, claimsJson) bila prinsipal JWT terverifikasi tersedia.
     */
    public void ensureRlsContextForCurrentTransaction() {
        if (!appProperties.rls().enabled()) {
            return;
        }
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            return;
        }

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof AppPrincipal principal) {
            String expectedState = "USER:" + principal.userId();
            Object currentBound = TransactionSynchronizationManager.getResource(TX_BOUND_RESOURCE_KEY);
            if (expectedState.equals(currentBound)) {
                return;
            }
            applyUserContext(principal.userId(), principal.role(), principal.residentId());
        } else {
            if (TransactionSynchronizationManager.hasResource(TX_BOUND_RESOURCE_KEY)) {
                return;
            }
            applyAnonymousBackendRole();
        }
    }

    public void applyAnonymousBackendRole() {
        if (!appProperties.rls().enabled() || !TransactionSynchronizationManager.isActualTransactionActive()) {
            return;
        }
        jdbcTemplate.execute("SET LOCAL ROLE app_backend");
        bindTransactionState("ANONYMOUS_APP_BACKEND");
    }

    public void applyUserContext(UUID userId, UserRole role, UUID residentId) {
        if (!appProperties.rls().enabled() || !TransactionSynchronizationManager.isActualTransactionActive()) {
            return;
        }

        try {
            Map<String, Object> claims = new LinkedHashMap<>();
            claims.put("sub", userId.toString());
            claims.put("role", role.name());
            claims.put("app_role", role.name());
            if (residentId != null) {
                claims.put("resident_id", residentId.toString());
            }
            String claimsJson = objectMapper.writeValueAsString(claims);

            jdbcTemplate.execute("SET LOCAL ROLE app_backend");
            jdbcTemplate.queryForObject(
                    "SELECT public.set_app_context(?::uuid, ?::jsonb)::text",
                    String.class,
                    userId.toString(),
                    claimsJson
            );

            bindTransactionState("USER:" + userId);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Gagal membentuk JSON klaim RLS", e);
        }
    }

    private void bindTransactionState(String stateValue) {
        boolean alreadyRegistered = TransactionSynchronizationManager.hasResource(TX_BOUND_RESOURCE_KEY);
        if (alreadyRegistered) {
            TransactionSynchronizationManager.unbindResource(TX_BOUND_RESOURCE_KEY);
        }
        TransactionSynchronizationManager.bindResource(TX_BOUND_RESOURCE_KEY, stateValue);
        if (!alreadyRegistered && TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                private Object suspendedState;

                @Override
                public void suspend() {
                    if (TransactionSynchronizationManager.hasResource(TX_BOUND_RESOURCE_KEY)) {
                        suspendedState = TransactionSynchronizationManager.unbindResource(TX_BOUND_RESOURCE_KEY);
                    }
                }

                @Override
                public void resume() {
                    if (suspendedState != null && !TransactionSynchronizationManager.hasResource(TX_BOUND_RESOURCE_KEY)) {
                        TransactionSynchronizationManager.bindResource(TX_BOUND_RESOURCE_KEY, suspendedState);
                    }
                }

                @Override
                public void afterCompletion(int status) {
                    if (TransactionSynchronizationManager.hasResource(TX_BOUND_RESOURCE_KEY)) {
                        TransactionSynchronizationManager.unbindResource(TX_BOUND_RESOURCE_KEY);
                    }
                }
            });
        }
    }
}
