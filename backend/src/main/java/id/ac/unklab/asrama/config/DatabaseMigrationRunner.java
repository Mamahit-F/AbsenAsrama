package id.ac.unklab.asrama.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
@Order(1)
public class DatabaseMigrationRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DatabaseMigrationRunner.class);

    private final JdbcTemplate jdbcTemplate;
    private final PasswordEncoder passwordEncoder;

    public DatabaseMigrationRunner(JdbcTemplate jdbcTemplate, PasswordEncoder passwordEncoder) {
        this.jdbcTemplate = jdbcTemplate;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(ApplicationArguments args) {
        log.info("Starting automated database schema migration and seed check for 4 Halls and Cascade deletions...");
        try {
            if (!isTablePresent("residents") || !isTablePresent("users")) {
                log.info("Database tables not present (possibly lightweight test environment); skipping schema updates.");
                return;
            }
            executeSchemaUpdates();
            executeCascadeConstraints();
            executeSeedHallsAndGuards();
            log.info("Database migration completed successfully.");
        } catch (Exception ex) {
            log.error("Database migration encountered an error (continuing app startup): {}", ex.getMessage(), ex);
        }
    }

    private boolean isTablePresent(String tableName) {
        try {
            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM information_schema.tables WHERE lower(table_name) = lower(?)",
                    Integer.class,
                    tableName
            );
            return count != null && count > 0;
        } catch (Exception ex) {
            return false;
        }
    }

    private void executeSchemaUpdates() {
        // 1. Add hall_name column to tables
        jdbcTemplate.execute("ALTER TABLE public.residents ADD COLUMN IF NOT EXISTS hall_name VARCHAR(20) NULL");
        jdbcTemplate.execute("ALTER TABLE public.users ADD COLUMN IF NOT EXISTS hall_name VARCHAR(20) NULL");
        jdbcTemplate.execute("ALTER TABLE public.attendance_schedules ADD COLUMN IF NOT EXISTS hall_name VARCHAR(20) NULL");
        jdbcTemplate.execute("ALTER TABLE public.attendance_sessions ADD COLUMN IF NOT EXISTS hall_name VARCHAR(20) NULL");

        // 2. Remove rigid schedule overlap constraint & scope sessions overlap per Hall (J-06, P-07)
        try {
            jdbcTemplate.execute("ALTER TABLE public.attendance_schedules DROP CONSTRAINT IF EXISTS no_overlapping_active_schedules");
            String updateSessionOverlapSql = """
                DO $$
                BEGIN
                  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_no_overlap') THEN
                    ALTER TABLE public.attendance_sessions DROP CONSTRAINT sessions_no_overlap;
                  END IF;
                  ALTER TABLE public.attendance_sessions ADD CONSTRAINT sessions_no_overlap
                    EXCLUDE USING gist (hall_name WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
                    WHERE (status <> 'CANCELLED' AND hall_name IS NOT NULL);
                EXCEPTION WHEN OTHERS THEN
                  -- Fallback if gist index requires specific extension setup
                  NULL;
                END $$;
            """;
            jdbcTemplate.execute(updateSessionOverlapSql);
        } catch (Exception ex) {
            log.warn("Could not update exclusion constraints (likely in test H2): {}", ex.getMessage());
        }

        // 3. Add check constraints for valid halls
        String checkConstraintSql = """
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_residents_hall_name') THEN
                ALTER TABLE public.residents
                  ADD CONSTRAINT check_residents_hall_name
                  CHECK (hall_name IS NULL OR hall_name IN ('Hall A1', 'Hall B1', 'Hall A2', 'Hall B2'));
              END IF;

              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_users_hall_name') THEN
                ALTER TABLE public.users
                  ADD CONSTRAINT check_users_hall_name
                  CHECK (hall_name IS NULL OR hall_name IN ('Hall A1', 'Hall B1', 'Hall A2', 'Hall B2'));
              END IF;

              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_schedules_hall_name') THEN
                ALTER TABLE public.attendance_schedules
                  ADD CONSTRAINT check_schedules_hall_name
                  CHECK (hall_name IS NULL OR hall_name IN ('Hall A1', 'Hall B1', 'Hall A2', 'Hall B2'));
              END IF;

              IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_sessions_hall_name') THEN
                ALTER TABLE public.attendance_sessions
                  ADD CONSTRAINT check_sessions_hall_name
                  CHECK (hall_name IS NULL OR hall_name IN ('Hall A1', 'Hall B1', 'Hall A2', 'Hall B2'));
              END IF;
            END $$;
        """;
        try {
            jdbcTemplate.execute(checkConstraintSql);
        } catch (Exception ex) {
            log.warn("Could not apply hall check constraints: {}", ex.getMessage());
        }

        // 3. Create indexes
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_residents_hall ON public.residents(hall_name)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_users_hall ON public.users(hall_name)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_sessions_hall ON public.attendance_sessions(hall_name)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_schedules_hall ON public.attendance_schedules(hall_name)");

        // 4. Hapus akun dean / legacy VILLAGE_DEAN agar sistem hanya menggunakan PENGHUNI, MONITOR, dan ADMIN
        try {
            Integer otherAdmins = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM public.users WHERE role::text = 'ADMIN' AND lower(username) <> 'dean' AND COALESCE(lower(email), '') <> 'dean@unklab.ac.id'",
                    Integer.class
            );
            if (otherAdmins != null && otherAdmins > 0) {
                int deleted = jdbcTemplate.update(
                        "DELETE FROM public.users WHERE lower(username) = 'dean' OR lower(email) = 'dean@unklab.ac.id' OR role::text = 'VILLAGE_DEAN'"
                );
                if (deleted > 0) {
                    log.info("Removed {} dean / legacy VILLAGE_DEAN account(s) from database.", deleted);
                }
            }
        } catch (Exception ex) {
            log.warn("Could not clean up dean / legacy VILLAGE_DEAN rows: {}", ex.getMessage());
        }

        String updateRoleCheckSql = """
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_resident_role_check') THEN
                ALTER TABLE public.users DROP CONSTRAINT users_resident_role_check;
              END IF;
              ALTER TABLE public.users ADD CONSTRAINT users_resident_role_check CHECK (
                (role::text = 'PENGHUNI' AND resident_id IS NOT NULL)
                OR (role::text IN ('MONITOR', 'ADMIN') AND resident_id IS NULL)
              );
            EXCEPTION WHEN OTHERS THEN
              NULL;
            END $$;
        """;
        jdbcTemplate.execute(updateRoleCheckSql);

        // 5. Tabel konfigurasi sistem (pengaturan maksimal sesi presensi harian 1-3)
        String appSettingsSql = """
            CREATE TABLE IF NOT EXISTS public.app_settings (
              setting_key VARCHAR(100) PRIMARY KEY,
              setting_value VARCHAR(255) NOT NULL,
              updated_by UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            INSERT INTO public.app_settings (setting_key, setting_value)
            VALUES ('max_daily_sessions', '1')
            ON CONFLICT (setting_key) DO NOTHING;

            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
                GRANT SELECT, INSERT, UPDATE ON public.app_settings TO app_backend;
                ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
                DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
                CREATE POLICY app_settings_select ON public.app_settings FOR SELECT TO app_backend USING (true);
                DROP POLICY IF EXISTS app_settings_insert ON public.app_settings;
                CREATE POLICY app_settings_insert ON public.app_settings FOR INSERT TO app_backend
                  WITH CHECK (public.current_app_role() = 'ADMIN');
                DROP POLICY IF EXISTS app_settings_update ON public.app_settings;
                CREATE POLICY app_settings_update ON public.app_settings FOR UPDATE TO app_backend
                  USING (public.current_app_role() = 'ADMIN')
                  WITH CHECK (public.current_app_role() = 'ADMIN');
              END IF;
            EXCEPTION WHEN OTHERS THEN
              NULL;
            END $$;
        """;
        try {
            jdbcTemplate.execute(appSettingsSql);
        } catch (Exception ex) {
            log.warn("Could not initialize app_settings table: {}", ex.getMessage());
        }
    }

    private void executeCascadeConstraints() {
        String cascadeSql = """
            DO $$
            BEGIN
              -- attendance_records -> attendance_sessions ON DELETE CASCADE
              IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'attendance_records_session_id_fkey') THEN
                ALTER TABLE public.attendance_records DROP CONSTRAINT attendance_records_session_id_fkey;
              END IF;
              ALTER TABLE public.attendance_records
                ADD CONSTRAINT attendance_records_session_id_fkey
                FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE CASCADE;

              -- geofence_settings -> attendance_sessions ON DELETE CASCADE
              IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'geofence_settings_session_id_fkey') THEN
                ALTER TABLE public.geofence_settings DROP CONSTRAINT geofence_settings_session_id_fkey;
              END IF;
              ALTER TABLE public.geofence_settings
                ADD CONSTRAINT geofence_settings_session_id_fkey
                FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE CASCADE;

              -- attendance_validation_logs -> attendance_sessions ON DELETE CASCADE
              IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'attendance_validation_logs_session_id_fkey') THEN
                ALTER TABLE public.attendance_validation_logs DROP CONSTRAINT attendance_validation_logs_session_id_fkey;
              END IF;
              ALTER TABLE public.attendance_validation_logs
                ADD CONSTRAINT attendance_validation_logs_session_id_fkey
                FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE CASCADE;

              -- attendance_sessions -> attendance_schedules ON DELETE CASCADE
              IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'attendance_sessions_schedule_id_fkey') THEN
                ALTER TABLE public.attendance_sessions DROP CONSTRAINT attendance_sessions_schedule_id_fkey;
              END IF;
              ALTER TABLE public.attendance_sessions
                ADD CONSTRAINT attendance_sessions_schedule_id_fkey
                FOREIGN KEY (schedule_id) REFERENCES public.attendance_schedules(id) ON DELETE CASCADE;
            END $$;
        """;
        jdbcTemplate.execute(cascadeSql);

        // Allow permanent schedule/session deletion to cascade-remove linked validation logs & record history
        // while keeping UPDATE blocked and preserving full immutability of audit_logs & violation_point_history.
        try {
            jdbcTemplate.execute("""
                CREATE OR REPLACE FUNCTION public.prevent_history_modification()
                RETURNS trigger LANGUAGE plpgsql
                SET search_path = pg_catalog AS $fn$
                BEGIN
                  IF TG_OP = 'DELETE'
                     AND TG_TABLE_NAME IN ('attendance_validation_logs', 'attendance_record_history') THEN
                    RETURN OLD;
                  END IF;
                  RAISE EXCEPTION 'Tabel riwayat/audit (%) bersifat immutable dan tidak dapat diubah', TG_TABLE_NAME
                    USING ERRCODE = '42501';
                END;
                $fn$
            """);
            jdbcTemplate.execute("DROP TRIGGER IF EXISTS trg_immutable_attendance_validation_logs ON public.attendance_validation_logs");
            jdbcTemplate.execute("""
                CREATE TRIGGER trg_immutable_attendance_validation_logs
                  BEFORE UPDATE ON public.attendance_validation_logs
                  FOR EACH ROW EXECUTE FUNCTION public.prevent_history_modification()
            """);
            jdbcTemplate.execute("DROP TRIGGER IF EXISTS trg_immutable_attendance_record_history ON public.attendance_record_history");
            jdbcTemplate.execute("""
                CREATE TRIGGER trg_immutable_attendance_record_history
                  BEFORE UPDATE ON public.attendance_record_history
                  FOR EACH ROW EXECUTE FUNCTION public.prevent_history_modification()
            """);
        } catch (Exception ex) {
            log.warn("Could not update prevent_history_modification trigger function: {}", ex.getMessage());
        }
    }

    private void executeSeedHallsAndGuards() {
        String defaultPasswordHash = passwordEncoder.encode("11111111");

        // Seed or assign default guard accounts for each of the 4 Halls
        String[][] hallGuards = {
                {"penjaga_a1", "penjaga.a1@unklab.ac.id", "Hall A1"},
                {"penjaga_b1", "penjaga.b1@unklab.ac.id", "Hall B1"},
                {"penjaga_a2", "penjaga.a2@unklab.ac.id", "Hall A2"},
                {"penjaga_b2", "penjaga.b2@unklab.ac.id", "Hall B2"}
        };

        for (String[] guard : hallGuards) {
            String username = guard[0];
            String email = guard[1];
            String hall = guard[2];

            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM public.users WHERE lower(username) = lower(?)",
                    Integer.class,
                    username
            );

            if (count == null || count == 0) {
                jdbcTemplate.update(
                        """
                        INSERT INTO public.users (id, username, email, password_hash, role, is_active, hall_name)
                        VALUES (?::uuid, ?, ?, ?, 'MONITOR'::public.user_role, true, ?)
                        """,
                        UUID.randomUUID().toString(),
                        username,
                        email,
                        defaultPasswordHash,
                        hall
                );
                log.info("Seeded monitor account for {}: username={}", hall, username);
            } else {
                // Ensure hall_name is set
                jdbcTemplate.update(
                        "UPDATE public.users SET hall_name = ? WHERE lower(username) = lower(?) AND hall_name IS NULL",
                        hall,
                        username
                );
            }
        }

        // If existing 'penjaga' user exists without hall, assign to 'Hall A1'
        jdbcTemplate.update(
                "UPDATE public.users SET hall_name = 'Hall A1' WHERE lower(username) = 'penjaga' AND hall_name IS NULL"
        );
    }
}
