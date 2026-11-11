-- V003: perluasan tabel existing (residents, users, schedules, sessions, geofence, records, logs, face). Idempotent & non-destruktif.

-- Semester & konfigurasi kegiatan
CREATE TABLE IF NOT EXISTS public.semesters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL UNIQUE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT semester_valid_range CHECK (ends_on > starts_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_semesters_current ON public.semesters (is_current) WHERE is_current;

CREATE TABLE IF NOT EXISTS public.activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar NOT NULL UNIQUE,
  name varchar NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.activity_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_type_id uuid NOT NULL REFERENCES public.activity_types(id) ON DELETE CASCADE,
  residence_category public.residence_category NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_activity_requirement UNIQUE (activity_type_id, residence_category)
);

-- residents
ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS residence_category public.residence_category NOT NULL DEFAULT 'ASRAMA',
  ADD COLUMN IF NOT EXISTS building varchar,
  ADD COLUMN IF NOT EXISTS room_number varchar;
CREATE INDEX IF NOT EXISTS idx_residents_category ON public.residents (residence_category);

-- users: lockout login (A-01, A-04) + Village Dean
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_resident_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_resident_role_check CHECK (
  (role = 'PENGHUNI' AND resident_id IS NOT NULL)
  OR (role IN ('MONITOR','ADMIN','VILLAGE_DEAN') AND resident_id IS NULL));
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_failed_attempts_check;
ALTER TABLE public.users ADD CONSTRAINT users_failed_attempts_check CHECK (failed_login_attempts >= 0);

-- attendance_schedules: jadwal berulang
ALTER TABLE public.attendance_schedules
  ADD COLUMN IF NOT EXISTS activity_type_id uuid REFERENCES public.activity_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schedule_kind public.schedule_kind NOT NULL DEFAULT 'ONE_TIME',
  ADD COLUMN IF NOT EXISTS repeat_days smallint[],
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_to date,
  ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.attendance_schedules ALTER COLUMN starts_at DROP NOT NULL, ALTER COLUMN ends_at DROP NOT NULL;
ALTER TABLE public.attendance_schedules DROP CONSTRAINT IF EXISTS schedule_kind_fields;
ALTER TABLE public.attendance_schedules ADD CONSTRAINT schedule_kind_fields CHECK (
  (schedule_kind = 'ONE_TIME' AND starts_at IS NOT NULL AND ends_at IS NOT NULL)
  OR (schedule_kind = 'RECURRING'
      AND repeat_days IS NOT NULL AND cardinality(repeat_days) > 0
      AND repeat_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
      AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time
      AND valid_from IS NOT NULL AND valid_to IS NOT NULL AND valid_to >= valid_from));
CREATE INDEX IF NOT EXISTS idx_schedules_activity ON public.attendance_schedules (activity_type_id);

-- attendance_sessions: satu jadwal banyak sesi + larang tumpang tindih
ALTER TABLE public.attendance_sessions DROP CONSTRAINT IF EXISTS attendance_sessions_schedule_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_schedule_start ON public.attendance_sessions (schedule_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_sessions_schedule ON public.attendance_sessions (schedule_id);
CREATE INDEX IF NOT EXISTS idx_sessions_time ON public.attendance_sessions (starts_at, ends_at);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sessions_no_overlap') THEN
    ALTER TABLE public.attendance_sessions ADD CONSTRAINT sessions_no_overlap
      EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status <> 'CANCELLED');
  END IF;
END $$;

-- geofence: PostGIS geography
ALTER TABLE public.geofence_settings ADD COLUMN IF NOT EXISTS location_name varchar;
ALTER TABLE public.geofence_settings ADD COLUMN IF NOT EXISTS geom extensions.geography(Point,4326)
  GENERATED ALWAYS AS (extensions.st_setsrid(extensions.st_makepoint(longitude::float8, latitude::float8),4326)::extensions.geography) STORED;
CREATE INDEX IF NOT EXISTS idx_geofence_geom ON public.geofence_settings USING gist (geom);

-- attendance_records: lokasi, koreksi
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS accuracy_m numeric,
  ADD COLUMN IF NOT EXISTS distance_m numeric,
  ADD COLUMN IF NOT EXISTS location_valid boolean,
  ADD COLUMN IF NOT EXISTS location_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS corrected_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_reason text,
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz;
ALTER TABLE public.attendance_records DROP CONSTRAINT IF EXISTS record_valid_coords;
ALTER TABLE public.attendance_records ADD CONSTRAINT record_valid_coords CHECK (
  (latitude IS NULL OR latitude BETWEEN -90 AND 90) AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
  AND (accuracy_m IS NULL OR accuracy_m >= 0) AND (distance_m IS NULL OR distance_m >= 0));
CREATE INDEX IF NOT EXISTS idx_records_recorded_at ON public.attendance_records (recorded_at);
CREATE INDEX IF NOT EXISTS idx_records_recorded_by ON public.attendance_records (recorded_by);

ALTER TABLE public.attendance_validation_logs
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS location_captured_at timestamptz;
ALTER TABLE public.attendance_validation_logs DROP CONSTRAINT IF EXISTS log_valid_coords;
ALTER TABLE public.attendance_validation_logs ADD CONSTRAINT log_valid_coords CHECK (
  (latitude IS NULL OR latitude BETWEEN -90 AND 90) AND (longitude IS NULL OR longitude BETWEEN -180 AND 180));
CREATE INDEX IF NOT EXISTS idx_validation_logs_result ON public.attendance_validation_logs (result, attempted_at);

-- audit_logs index tambahan
CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_logs (entity_type, entity_id);

-- Face enrollment
ALTER TABLE public.enrollment_photos
  ADD COLUMN IF NOT EXISTS bucket_id varchar NOT NULL DEFAULT 'face-enrollment',
  ADD COLUMN IF NOT EXISTS quality_details jsonb,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS file_size_bytes integer;
ALTER TABLE public.enrollment_photos DROP CONSTRAINT IF EXISTS photo_path_format;
ALTER TABLE public.enrollment_photos ADD CONSTRAINT photo_path_format CHECK (
  storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(front|left|right|up|down)\.jpg$');

ALTER TABLE public.face_enrollments
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS quality_summary jsonb,
  ADD COLUMN IF NOT EXISTS consent_id uuid REFERENCES public.consent_records(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_inprogress_enrollment ON public.face_enrollments (resident_id) WHERE status IN ('PENDING','PROCESSING');

ALTER TABLE public.face_profiles
  ADD COLUMN IF NOT EXISTS source_enrollment_id uuid REFERENCES public.face_enrollments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_face_profiles_embedding ON public.face_profiles USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.face_profile_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  embedding vector(512) NOT NULL,
  model_version varchar NOT NULL,
  enrolled_at timestamptz NOT NULL,
  source_enrollment_id uuid,
  replaced_at timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz
);
CREATE INDEX IF NOT EXISTS idx_face_profile_history_resident ON public.face_profile_history (resident_id);
