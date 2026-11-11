package id.ac.unklab.asrama.security;

import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Before;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * Menjalankan pengikatan konteks RLS tepat setelah transaksi Spring dimulai (@Order(Ordered.LOWEST_PRECEDENCE - 10)),
 * sehingga setiap query di dalam method @Transactional otomatis berjalan sebagai ROLE app_backend dengan set_app_context().
 */
@Aspect
@Component
@Order(Ordered.LOWEST_PRECEDENCE - 10)
public class RlsTransactionAspect {

    private final RlsContextManager rlsContextManager;

    public RlsTransactionAspect(RlsContextManager rlsContextManager) {
        this.rlsContextManager = rlsContextManager;
    }

    @Before("@annotation(org.springframework.transaction.annotation.Transactional) || @within(org.springframework.transaction.annotation.Transactional)")
    public void bindRlsContextOnTransactionStart() {
        rlsContextManager.ensureRlsContextForCurrentTransaction();
    }
}
