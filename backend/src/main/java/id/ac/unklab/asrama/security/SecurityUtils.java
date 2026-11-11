package id.ac.unklab.asrama.security;

import id.ac.unklab.asrama.common.BusinessException;
import id.ac.unklab.asrama.common.DomainEnums.UserRole;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class SecurityUtils {

    public AppPrincipal getCurrentPrincipal() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof AppPrincipal principal)) {
            throw BusinessException.unauthorized("UNAUTHORIZED", "Sesi autentikasi tidak ditemukan");
        }
        return principal;
    }

    public UUID getCurrentUserId() {
        return getCurrentPrincipal().userId();
    }

    public UserRole getCurrentRole() {
        return getCurrentPrincipal().role();
    }

    public UUID getCurrentResidentId() {
        return getCurrentPrincipal().residentId();
    }

    public void assertResidentOwnershipOrStaff(UUID targetResidentId) {
        AppPrincipal principal = getCurrentPrincipal();
        if (principal.role() == UserRole.PENGHUNI) {
            if (principal.residentId() == null || !principal.residentId().equals(targetResidentId)) {
                throw BusinessException.forbidden("FORBIDDEN_OWNERSHIP",
                        "Penghuni hanya diizinkan mengakses data miliknya sendiri");
            }
        }
    }
}
