-- ====================================================================
-- V008_hall_isolation_and_cascade.sql
-- Migration for:
-- 1. 4 Halls System ('Hall A1', 'Hall B1', 'Hall A2', 'Hall B2') (P-06, P-07, J-01, J-06, J-07, J-09, A-04, K-07)
-- 2. Session Deletion Cascade & Free Edit/Delete (J-06, K-05)
-- 3. Hall Isolation for Residents, Users, Schedules, and Attendance Sessions
-- ====================================================================

-- 1. Add hall_name column to residents, users, attendance_schedules, attendance_sessions
ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS hall_name VARCHAR(20) NULL;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS hall_name VARCHAR(20) NULL;

ALTER TABLE public.attendance_schedules
  ADD COLUMN IF NOT EXISTS hall_name VARCHAR(20) NULL;

ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS hall_name VARCHAR(20) NULL;

-- 2. Drop global schedule overlap restriction & scope sessions overlap by hall (J-06, P-07)
ALTER TABLE public.attendance_schedules DROP CONSTRAINT IF EXISTS no_overlapping_active_schedules;

ALTER TABLE public.attendance_sessions DROP CONSTRAINT IF EXISTS sessions_no_overlap;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT sessions_no_overlap
  EXCLUDE USING gist (hall_name WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status <> 'CANCELLED' AND hall_name IS NOT NULL);

-- 3. Constraints for 4 valid Halls
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

-- 3. Foreign Key Updates for Unrestricted Session Deletion (ON DELETE CASCADE)
DO $$
BEGIN
  -- attendance_records -> attendance_sessions
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'attendance_records_session_id_fkey') THEN
    ALTER TABLE public.attendance_records DROP CONSTRAINT attendance_records_session_id_fkey;
  END IF;
  ALTER TABLE public.attendance_records
    ADD CONSTRAINT attendance_records_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE CASCADE;

  -- geofence_settings -> attendance_sessions
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'geofence_settings_session_id_fkey') THEN
    ALTER TABLE public.geofence_settings DROP CONSTRAINT geofence_settings_session_id_fkey;
  END IF;
  ALTER TABLE public.geofence_settings
    ADD CONSTRAINT geofence_settings_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE CASCADE;

  -- attendance_validation_logs -> attendance_sessions
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'attendance_validation_logs_session_id_fkey') THEN
    ALTER TABLE public.attendance_validation_logs DROP CONSTRAINT attendance_validation_logs_session_id_fkey;
  END IF;
  ALTER TABLE public.attendance_validation_logs
    ADD CONSTRAINT attendance_validation_logs_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE CASCADE;

  -- attendance_sessions -> attendance_schedules
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'attendance_sessions_schedule_id_fkey') THEN
    ALTER TABLE public.attendance_sessions DROP CONSTRAINT attendance_sessions_schedule_id_fkey;
  END IF;
  ALTER TABLE public.attendance_sessions
    ADD CONSTRAINT attendance_sessions_schedule_id_fkey
    FOREIGN KEY (schedule_id) REFERENCES public.attendance_schedules(id) ON DELETE CASCADE;
END $$;

-- 4. Indexes for fast Hall filtering
CREATE INDEX IF NOT EXISTS idx_residents_hall ON public.residents(hall_name);
CREATE INDEX IF NOT EXISTS idx_users_hall ON public.users(hall_name);
CREATE INDEX IF NOT EXISTS idx_sessions_hall ON public.attendance_sessions(hall_name);
CREATE INDEX IF NOT EXISTS idx_schedules_hall ON public.attendance_schedules(hall_name);
