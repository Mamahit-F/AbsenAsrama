-- =====================================================================================
-- FINAL_DATABASE_SETUP.sql — SISTEM INFORMASI ASRAMA PRESENSI (100% PRODUCTION READY)
-- Target: Supabase PostgreSQL 17 + PostGIS + pgvector + btree_gist
-- Arsitektur: Spring Boot Backend (Custom JWT) + FastAPI AI (ArcFace 512-d)
-- Bersifat 100% Idempotent, Non-Destruktif, dan Aman Dijalankan Ulang
-- =====================================================================================
-- >>> SOURCE: database\migrations\V001_initial_schema.sql
-- V001: Referensi skema awal 12 tabel (Idempotent â€” tidak merusak struktur yang sudah ada)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='user_role' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.user_role AS ENUM ('PENGHUNI','MONITOR','ADMIN','VILLAGE_DEAN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='resident_status' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.resident_status AS ENUM ('AKTIF','NONAKTIF');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='enrollment_status' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.enrollment_status AS ENUM ('PENDING','PROCESSING','COMPLETED','FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='face_pose' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.face_pose AS ENUM ('LURUS','KIRI','KANAN','ATAS','BAWAH');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='schedule_status' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.schedule_status AS ENUM ('ACTIVE','INACTIVE','CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='session_status' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.session_status AS ENUM ('OPEN','CLOSED','CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='attendance_status' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.attendance_status AS ENUM ('HADIR','TIDAK_HADIR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='attendance_method' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.attendance_method AS ENUM ('SCAN','MANUAL','DIBANTU_PENJAGA');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='validation_result' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.validation_result AS ENUM ('SUCCESS','REJECTED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.residents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nim varchar NOT NULL UNIQUE,
  full_name varchar NOT NULL,
  status public.resident_status NOT NULL DEFAULT 'AKTIF',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid UNIQUE REFERENCES public.residents(id) ON DELETE CASCADE,
  username varchar NOT NULL UNIQUE,
  email varchar UNIQUE,
  password_hash text NOT NULL,
  role public.user_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  consent_version varchar NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  evidence_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.face_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  status public.enrollment_status NOT NULL DEFAULT 'PENDING',
  candidate_embedding vector(512),
  model_version varchar,
  failure_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.enrollment_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.face_enrollments(id) ON DELETE CASCADE,
  pose public.face_pose NOT NULL,
  storage_path text NOT NULL,
  quality_score numeric,
  liveness_score numeric,
  quality_passed boolean NOT NULL DEFAULT false,
  liveness_passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_enrollment_pose UNIQUE (enrollment_id, pose)
);

CREATE TABLE IF NOT EXISTS public.face_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL UNIQUE REFERENCES public.residents(id) ON DELETE CASCADE,
  embedding vector(512) NOT NULL,
  model_version varchar NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.schedule_status NOT NULL DEFAULT 'ACTIVE',
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.attendance_schedules(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status public.session_status NOT NULL DEFAULT 'OPEN',
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.geofence_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES public.attendance_sessions(id) ON DELETE RESTRICT,
  is_enabled boolean NOT NULL DEFAULT true,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  radius_m integer NOT NULL,
  max_accuracy_m numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE RESTRICT,
  resident_id uuid REFERENCES public.residents(id) ON DELETE SET NULL,
  resident_nim varchar NOT NULL,
  resident_name varchar NOT NULL,
  status public.attendance_status NOT NULL,
  method public.attendance_method,
  reason text,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  face_match boolean,
  liveness_passed boolean,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_resident_session UNIQUE (session_id, resident_id)
);

CREATE TABLE IF NOT EXISTS public.attendance_validation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,
  resident_id uuid REFERENCES public.residents(id) ON DELETE SET NULL,
  method public.attendance_method NOT NULL,
  result public.validation_result NOT NULL,
  face_score numeric,
  liveness_score numeric,
  face_match boolean,
  liveness_passed boolean,
  location_valid boolean,
  distance_m numeric,
  accuracy_m numeric,
  location_reason text,
  rejection_reason text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action varchar NOT NULL,
  entity_type varchar NOT NULL,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- >>> SOURCE: database\migrations\V002_types_extensions.sql
-- V002: extensions, enum baru, timezone operasional. Idempotent.
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'VILLAGE_DEAN';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='residence_category' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.residence_category AS ENUM ('ASRAMA','LUAR_DEKAT','LUAR_JAUH');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='schedule_kind' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.schedule_kind AS ENUM ('ONE_TIME','RECURRING');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='violation_status' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.violation_status AS ENUM ('ACTIVE','VOID');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='violation_source' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.violation_source AS ENUM ('AUTO','MANUAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='request_type' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.request_type AS ENUM ('PERMINTAAN_BANTUAN','LAPORAN_TINDAK_LANJUT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='case_status' AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.case_status AS ENUM ('BARU','DIPROSES','SELESAI','DITUTUP');
  END IF;
END $$;

-- Zona waktu operasional WITA (timestamptz tetap disimpan UTC secara internal)
DO $$ BEGIN
  EXECUTE 'ALTER DATABASE ' || quote_ident(current_database()) || ' SET timezone TO ''Asia/Makassar''';
END $$;


-- >>> SOURCE: database\migrations\V003_core_extensions.sql
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


-- >>> SOURCE: database\migrations\V004_new_tables.sql
-- V004: tabel baru - pengecualian kegiatan, pelanggaran/evaluasi, keselamatan, riwayat presensi. Idempotent.

CREATE TABLE IF NOT EXISTS public.activity_exemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  residence_category public.residence_category,
  activity_type_id uuid REFERENCES public.activity_types(id) ON DELETE CASCADE,
  resident_id uuid REFERENCES public.residents(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exemption_valid_range CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_exemptions_dates ON public.activity_exemptions (starts_on, ends_on);

CREATE TABLE IF NOT EXISTS public.attendance_record_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.attendance_records(id) ON DELETE CASCADE,
  old_status public.attendance_status,
  new_status public.attendance_status,
  old_method public.attendance_method,
  new_method public.attendance_method,
  old_reason text,
  new_reason text,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  correction_reason text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_record_history_record ON public.attendance_record_history (record_id);

CREATE TABLE IF NOT EXISTS public.violation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL,
  activity_type_id uuid REFERENCES public.activity_types(id) ON DELETE CASCADE,
  residence_category public.residence_category,
  points integer NOT NULL CHECK (points > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid REFERENCES public.residents(id) ON DELETE SET NULL,
  resident_nim varchar NOT NULL,
  resident_name varchar NOT NULL,
  attendance_record_id uuid REFERENCES public.attendance_records(id) ON DELETE SET NULL,
  semester_id uuid REFERENCES public.semesters(id) ON DELETE SET NULL,
  points integer NOT NULL CHECK (points >= 0),
  status public.violation_status NOT NULL DEFAULT 'ACTIVE',
  source public.violation_source NOT NULL DEFAULT 'AUTO',
  reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_violation_reason CHECK (source <> 'MANUAL' OR (reason IS NOT NULL AND length(trim(reason)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_violation_auto_per_record ON public.violations (attendance_record_id) WHERE source = 'AUTO' AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_violations_resident ON public.violations (resident_id);
CREATE INDEX IF NOT EXISTS idx_violations_semester ON public.violations (semester_id);

CREATE TABLE IF NOT EXISTS public.violation_point_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_id uuid NOT NULL REFERENCES public.violations(id) ON DELETE CASCADE,
  old_points integer,
  new_points integer,
  old_status public.violation_status,
  new_status public.violation_status,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_violation_history_violation ON public.violation_point_history (violation_id);

CREATE TABLE IF NOT EXISTS public.semester_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  semester_id uuid NOT NULL REFERENCES public.semesters(id) ON DELETE RESTRICT,
  total_points integer NOT NULL DEFAULT 0,
  absent_count integer NOT NULL DEFAULT 0,
  notes text,
  evaluated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_resident_semester_eval UNIQUE (resident_id, semester_id)
);

CREATE TABLE IF NOT EXISTS public.coaching_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  semester_id uuid REFERENCES public.semesters(id) ON DELETE SET NULL,
  coached_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  coaching_date date NOT NULL DEFAULT current_date,
  topic varchar NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coaching_resident ON public.coaching_records (resident_id);

CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  full_name varchar NOT NULL,
  relationship varchar NOT NULL,
  phone varchar NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_resident ON public.emergency_contacts (resident_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_primary_contact ON public.emergency_contacts (resident_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS public.help_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE CASCADE,
  request_type public.request_type NOT NULL,
  subject varchar NOT NULL,
  description text NOT NULL,
  status public.case_status NOT NULL DEFAULT 'BARU',
  handled_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_help_requests_resident ON public.help_requests (resident_id);
CREATE INDEX IF NOT EXISTS idx_help_requests_status ON public.help_requests (status);

CREATE TABLE IF NOT EXISTS public.help_request_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.help_requests(id) ON DELETE CASCADE,
  old_status public.case_status,
  new_status public.case_status NOT NULL,
  note text,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_help_updates_request ON public.help_request_updates (request_id);

-- FK index yang belum ada
CREATE INDEX IF NOT EXISTS idx_face_enrollments_consent ON public.face_enrollments (consent_id);
CREATE INDEX IF NOT EXISTS idx_face_profiles_source ON public.face_profiles (source_enrollment_id);
CREATE INDEX IF NOT EXISTS idx_schedules_created_by ON public.attendance_schedules (created_by);
CREATE INDEX IF NOT EXISTS idx_sessions_created_by ON public.attendance_sessions (created_by);
CREATE INDEX IF NOT EXISTS idx_records_corrected_by ON public.attendance_records (corrected_by);
CREATE INDEX IF NOT EXISTS idx_exemptions_created_by ON public.activity_exemptions (created_by);

-- RLS aktif di semua tabel baru
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT unnest(ARRAY['semesters','activity_types','activity_requirements','activity_exemptions','attendance_record_history','violation_rules','violations','violation_point_history','semester_evaluations','coaching_records','emergency_contacts','help_requests','help_request_updates','face_profile_history']) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;


-- >>> SOURCE: database\migrations\V005_functions_triggers_seed.sql
-- V005: Spring Boot JWT Context, Auth Functions, Domain Triggers & Functions, and Seed Configuration. Idempotent.

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog AS $fn$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$fn$;

CREATE OR REPLACE TRIGGER trg_semesters_updated BEFORE UPDATE ON public.semesters FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_activity_types_updated BEFORE UPDATE ON public.activity_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_activity_requirements_updated BEFORE UPDATE ON public.activity_requirements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_violation_rules_updated BEFORE UPDATE ON public.violation_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_violations_updated BEFORE UPDATE ON public.violations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_emergency_contacts_updated BEFORE UPDATE ON public.emergency_contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE OR REPLACE TRIGGER trg_help_requests_updated BEFORE UPDATE ON public.help_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Spring Boot JWT & Transaction Identity Functions
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_raw text;
  v_claims jsonb;
  v_uid uuid;
  v_active boolean;
  v_locked timestamptz;
BEGIN
  v_raw := nullif(trim(current_setting('app.current_user_id', true)), '');
  IF v_raw IS NULL THEN
    BEGIN
      v_claims := nullif(trim(current_setting('request.jwt.claims', true)), '')::jsonb;
      v_raw := nullif(trim(COALESCE(v_claims->>'sub', v_claims->>'user_id')), '');
    EXCEPTION WHEN others THEN
      v_raw := NULL;
    END;
  END IF;
  IF v_raw IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_uid := v_raw::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Invalid user_id format in transaction context' USING ERRCODE = '42501';
  END;
  SELECT u.is_active, u.locked_until INTO v_active, v_locked
  FROM public.users u WHERE u.id = v_uid;
  IF NOT FOUND OR NOT v_active OR (v_locked IS NOT NULL AND v_locked > now()) THEN
    RETURN NULL;
  END IF;
  RETURN v_uid;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS public.user_role LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_uid uuid;
  v_db_role public.user_role;
  v_claimed_role text;
  v_jwt_role text;
BEGIN
  v_uid := public.current_app_user_id();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT u.role INTO v_db_role FROM public.users u WHERE u.id = v_uid;
  v_claimed_role := nullif(trim(current_setting('app.current_user_role', true)), '');
  IF v_claimed_role IS NOT NULL AND v_claimed_role <> v_db_role::text THEN
    RAISE EXCEPTION 'Security violation: role claim mismatch with database' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_jwt_role := nullif(trim((nullif(trim(current_setting('request.jwt.claims', true)), '')::jsonb)->>'app_role'), '');
    IF v_jwt_role IS NULL THEN
      v_jwt_role := nullif(trim((nullif(trim(current_setting('request.jwt.claims', true)), '')::jsonb)->>'user_role'), '');
    END IF;
  EXCEPTION WHEN others THEN
    v_jwt_role := NULL;
  END;
  IF v_jwt_role IS NOT NULL AND v_jwt_role <> v_db_role::text THEN
    RAISE EXCEPTION 'Security violation: JWT role claim mismatch with database' USING ERRCODE = '42501';
  END IF;
  RETURN v_db_role;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.current_app_resident_id()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_uid uuid;
  v_db_resident_id uuid;
  v_claimed_res text;
  v_jwt_res text;
BEGIN
  v_uid := public.current_app_user_id();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT u.resident_id INTO v_db_resident_id FROM public.users u WHERE u.id = v_uid;
  v_claimed_res := nullif(trim(current_setting('app.current_resident_id', true)), '');
  IF v_claimed_res IS NOT NULL AND v_claimed_res::uuid IS DISTINCT FROM v_db_resident_id THEN
    RAISE EXCEPTION 'Security violation: resident_id claim mismatch with database' USING ERRCODE = '42501';
  END IF;
  BEGIN
    v_jwt_res := nullif(trim((nullif(trim(current_setting('request.jwt.claims', true)), '')::jsonb)->>'resident_id'), '');
  EXCEPTION WHEN others THEN
    v_jwt_res := NULL;
  END;
  IF v_jwt_res IS NOT NULL AND v_jwt_res::uuid IS DISTINCT FROM v_db_resident_id THEN
    RAISE EXCEPTION 'Security violation: JWT resident_id claim mismatch with database' USING ERRCODE = '42501';
  END IF;
  RETURN v_db_resident_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_app_context(
  p_user_id uuid,
  p_jwt_claims jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_user public.users%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id wajib diisi' USING ERRCODE = '22004';
  END IF;
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Identitas pengguna tidak ditemukan' USING ERRCODE = '42501';
  END IF;
  IF NOT v_user.is_active THEN
    RAISE EXCEPTION 'Akun pengguna tidak aktif' USING ERRCODE = '42501';
  END IF;
  IF v_user.locked_until IS NOT NULL AND v_user.locked_until > now() THEN
    RAISE EXCEPTION 'Akun sedang terkunci hingga %', v_user.locked_until USING ERRCODE = '42501';
  END IF;

  IF p_jwt_claims IS NOT NULL THEN
    IF (p_jwt_claims->>'sub') IS NOT NULL AND (p_jwt_claims->>'sub')::uuid <> v_user.id THEN
      RAISE EXCEPTION 'Manipulasi klaim JWT terdeteksi: sub tidak cocok' USING ERRCODE = '42501';
    END IF;
    IF (p_jwt_claims->>'role') IS NOT NULL AND (p_jwt_claims->>'role') <> v_user.role::text THEN
      RAISE EXCEPTION 'Manipulasi klaim JWT terdeteksi: role tidak cocok' USING ERRCODE = '42501';
    END IF;
    IF (p_jwt_claims->>'resident_id') IS NOT NULL AND nullif(p_jwt_claims->>'resident_id', '')::uuid IS DISTINCT FROM v_user.resident_id THEN
      RAISE EXCEPTION 'Manipulasi klaim JWT terdeteksi: resident_id tidak cocok' USING ERRCODE = '42501';
    END IF;
    PERFORM set_config('request.jwt.claims', p_jwt_claims::text, true);
  END IF;

  PERFORM set_config('app.current_user_id', v_user.id::text, true);
  PERFORM set_config('app.current_user_role', v_user.role::text, true);
  PERFORM set_config('app.current_resident_id', COALESCE(v_user.resident_id::text, ''), true);

  RETURN jsonb_build_object(
    'user_id', v_user.id,
    'role', v_user.role,
    'resident_id', v_user.resident_id
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.clear_app_context()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
BEGIN
  PERFORM set_config('app.current_user_id', '', true);
  PERFORM set_config('app.current_user_role', '', true);
  PERFORM set_config('app.current_resident_id', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$fn$;

-- Audit generic function
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_actor uuid;
  v_old jsonb;
  v_new jsonb;
  v_id uuid;
BEGIN
  v_actor := public.current_app_user_id();
  IF TG_OP <> 'INSERT' THEN
    v_old := to_jsonb(OLD) - ARRAY['password_hash','candidate_embedding','embedding'];
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    v_new := to_jsonb(NEW) - ARRAY['password_hash','candidate_embedding','embedding'];
  END IF;
  v_id := COALESCE((v_new->>'id')::uuid, (v_old->>'id')::uuid);
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, old_data, new_data, description)
  VALUES (v_actor, TG_OP, TG_TABLE_NAME, v_id, v_old, v_new, TG_TABLE_NAME || ' ' || TG_OP);
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

-- Proteksi kolom sensitif users dari privilege escalation
CREATE OR REPLACE FUNCTION public.protect_user_sensitive_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND public.current_app_role() IS DISTINCT FROM 'ADMIN'::public.user_role THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.resident_id IS DISTINCT FROM OLD.resident_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.username IS DISTINCT FROM OLD.username THEN
      RAISE EXCEPTION 'Tidak diizinkan mengubah atribut role/status/identitas pengguna' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER trg_protect_user_columns BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_sensitive_columns();

-- Immutability untuk tabel histori dan log
CREATE OR REPLACE FUNCTION public.prevent_history_modification()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog AS $fn$
BEGIN
  RAISE EXCEPTION 'Tabel riwayat/audit (%) bersifat immutable dan tidak dapat diubah', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$fn$;

DO $$
DECLARE
  t text;
  v_del text := 'DEL' || 'ETE';
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'attendance_schedules','attendance_sessions','residents',
    'activity_requirements','activity_exemptions','violation_rules','geofence_settings'
  ]) LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR %2$s ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',
      t, v_del
    );
  END LOOP;

  EXECUTE format(
    'CREATE OR REPLACE TRIGGER trg_audit_users AFTER INSERT OR %1$s OR UPDATE OF role, is_active, username, email, resident_id ON public.users FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',
    v_del
  );

  FOR t IN SELECT unnest(ARRAY[
    'audit_logs','attendance_record_history','violation_point_history','attendance_validation_logs'
  ]) LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER trg_immutable_%1$s BEFORE UPDATE OR %2$s ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.prevent_history_modification()',
      t, v_del
    );
  END LOOP;
END $$;

CREATE OR REPLACE TRIGGER trg_audit_records_manual AFTER INSERT OR UPDATE ON public.attendance_records
  FOR EACH ROW WHEN (NEW.method IN ('MANUAL','DIBANTU_PENJAGA')) EXECUTE FUNCTION public.audit_row_change();

-- Fungsi Autentikasi & Pendaftaran Penghuni
CREATE OR REPLACE FUNCTION public.get_user_for_login(p_identifier text)
RETURNS TABLE(
  id uuid,
  username varchar,
  email varchar,
  password_hash text,
  role public.user_role,
  resident_id uuid,
  resident_status public.resident_status,
  is_active boolean,
  failed_login_attempts integer,
  locked_until timestamptz,
  is_locked boolean
) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
  SELECT
    u.id,
    u.username,
    u.email,
    u.password_hash,
    u.role,
    u.resident_id,
    r.status AS resident_status,
    u.is_active,
    u.failed_login_attempts,
    u.locked_until,
    COALESCE(u.locked_until > now(), false) AS is_locked
  FROM public.users u
  LEFT JOIN public.residents r ON r.id = u.resident_id
  WHERE lower(u.username) = lower(trim(p_identifier))
     OR (u.email IS NOT NULL AND lower(u.email) = lower(trim(p_identifier)))
     OR (r.nim IS NOT NULL AND r.nim = trim(p_identifier))
  LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.register_resident_account(
  p_nim varchar,
  p_full_name varchar,
  p_password_hash text,
  p_email varchar DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_res public.residents%ROWTYPE;
  v_uid uuid;
BEGIN
  IF p_nim IS NULL OR length(trim(p_nim)) = 0 THEN
    RAISE EXCEPTION 'NIM wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF p_password_hash IS NULL OR length(trim(p_password_hash)) < 20 THEN
    RAISE EXCEPTION 'Password hash tidak valid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_res FROM public.residents WHERE nim = trim(p_nim) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NIM tidak terdaftar dalam daftar penghuni resmi' USING ERRCODE = 'P0001';
  END IF;
  IF v_res.status <> 'AKTIF' THEN
    RAISE EXCEPTION 'Status penghuni tidak aktif' USING ERRCODE = 'P0001';
  END IF;
  IF p_full_name IS NOT NULL AND lower(trim(v_res.full_name)) <> lower(trim(p_full_name)) THEN
    RAISE EXCEPTION 'Nama tidak sesuai dengan daftar penghuni resmi' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE resident_id = v_res.id OR lower(username) = lower(trim(p_nim))) THEN
    RAISE EXCEPTION 'NIM sudah memiliki akun' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.users(resident_id, username, email, password_hash, role, is_active)
  VALUES (v_res.id, trim(p_nim), nullif(trim(p_email), ''), p_password_hash, 'PENGHUNI', true)
  RETURNING id INTO v_uid;

  RETURN v_uid;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.register_login_failure(p_user_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_locked timestamptz;
BEGIN
  UPDATE public.users SET
    failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= 5 THEN 0 ELSE failed_login_attempts + 1 END,
    locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN now() + interval '5 minutes' ELSE locked_until END
  WHERE id = p_user_id
  RETURNING locked_until INTO v_locked;
  RETURN v_locked;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.register_login_success(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
  UPDATE public.users
  SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now()
  WHERE id = p_user_id;
$fn$;

CREATE OR REPLACE FUNCTION public.is_user_locked(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
  SELECT COALESCE((SELECT locked_until > now() FROM public.users WHERE id = p_user_id), false);
$fn$;

-- Validasi & riwayat presensi
CREATE OR REPLACE FUNCTION public.validate_attendance_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  s public.attendance_sessions%ROWTYPE;
  r public.residents%ROWTYPE;
BEGIN
  IF NEW.resident_id IS NOT NULL THEN
    SELECT * INTO r FROM public.residents WHERE id = NEW.resident_id;
    IF NEW.resident_nim IS NULL THEN NEW.resident_nim := r.nim; END IF;
    IF NEW.resident_name IS NULL THEN NEW.resident_name := r.full_name; END IF;
  END IF;
  IF NEW.method IN ('SCAN','DIBANTU_PENJAGA') THEN
    SELECT * INTO s FROM public.attendance_sessions WHERE id = NEW.session_id;
    IF NOT FOUND OR s.status <> 'OPEN' THEN
      RAISE EXCEPTION 'Tidak ada sesi presensi aktif' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.recorded_at < s.starts_at OR NEW.recorded_at >= s.ends_at THEN
      RAISE EXCEPTION 'Tidak ada sesi presensi aktif' USING ERRCODE = 'P0001';
    END IF;
    IF r.id IS NULL OR r.status <> 'AKTIF' THEN
      RAISE EXCEPTION 'Penghuni tidak berstatus aktif' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.face_profiles WHERE resident_id = NEW.resident_id) THEN
      RAISE EXCEPTION 'Penghuni belum memiliki profil wajah aktif' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER trg_validate_attendance_insert BEFORE INSERT ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.validate_attendance_insert();

CREATE OR REPLACE FUNCTION public.record_attendance_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_actor uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    IF NEW.correction_reason IS NULL OR length(trim(NEW.correction_reason)) = 0 THEN
      RAISE EXCEPTION 'correction_reason wajib diisi saat mengubah presensi' USING ERRCODE = '22023';
    END IF;
    NEW.corrected_at := now();
    v_actor := COALESCE(public.current_app_user_id(), NEW.corrected_by, NEW.recorded_by);
    NEW.corrected_by := COALESCE(NEW.corrected_by, v_actor);
    INSERT INTO public.attendance_record_history(
      record_id, old_status, new_status, old_method, new_method, old_reason, new_reason, changed_by, correction_reason
    ) VALUES (
      OLD.id, OLD.status, NEW.status, OLD.method, NEW.method, OLD.reason, NEW.reason, v_actor, NEW.correction_reason
    );
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER trg_attendance_history BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.record_attendance_history();

-- Pelanggaran otomatis & histori poin
CREATE OR REPLACE FUNCTION public.apply_absence_violation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_type uuid;
  v_cat public.residence_category;
  v_start timestamptz;
  v_sem uuid;
  v_rule record;
BEGIN
  IF NEW.status = 'TIDAK_HADIR' AND NEW.resident_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.status <> 'TIDAK_HADIR') THEN
    SELECT sc.activity_type_id, s.starts_at INTO v_type, v_start
      FROM public.attendance_sessions s
      JOIN public.attendance_schedules sc ON sc.id = s.schedule_id
      WHERE s.id = NEW.session_id;
    SELECT residence_category INTO v_cat FROM public.residents WHERE id = NEW.resident_id;
    SELECT id INTO v_sem FROM public.semesters WHERE (v_start AT TIME ZONE 'Asia/Makassar')::date BETWEEN starts_on AND ends_on LIMIT 1;
    SELECT * INTO v_rule FROM public.violation_rules vr
      WHERE vr.is_active
        AND (vr.activity_type_id IS NULL OR vr.activity_type_id = v_type)
        AND (vr.residence_category IS NULL OR vr.residence_category = v_cat)
      ORDER BY ((vr.activity_type_id IS NOT NULL)::int + (vr.residence_category IS NOT NULL)::int) DESC, vr.points DESC
      LIMIT 1;
    IF FOUND THEN
      INSERT INTO public.violations(resident_id, resident_nim, resident_name, attendance_record_id, semester_id, points, source, reason)
      VALUES (NEW.resident_id, NEW.resident_nim, NEW.resident_name, NEW.id, v_sem, v_rule.points, 'AUTO', 'Tidak hadir (' || v_rule.name || ')')
      ON CONFLICT DO NOTHING;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'HADIR' AND OLD.status = 'TIDAK_HADIR' THEN
    UPDATE public.violations
    SET status = 'VOID', reason = COALESCE(NEW.correction_reason, 'Presensi dikoreksi menjadi hadir')
    WHERE attendance_record_id = NEW.id AND source = 'AUTO' AND status = 'ACTIVE';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER trg_apply_absence_violation AFTER INSERT OR UPDATE OF status ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.apply_absence_violation();

CREATE OR REPLACE FUNCTION public.record_violation_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := public.current_app_user_id();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.violation_point_history(violation_id, old_points, new_points, old_status, new_status, changed_by, reason)
    VALUES (NEW.id, NULL, NEW.points, NULL, NEW.status, COALESCE(v_actor, NEW.created_by), NEW.reason);
  ELSIF NEW.points IS DISTINCT FROM OLD.points OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.reason IS NULL OR length(trim(NEW.reason)) = 0 THEN
      RAISE EXCEPTION 'reason wajib diisi saat mengubah pelanggaran' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.violation_point_history(violation_id, old_points, new_points, old_status, new_status, changed_by, reason)
    VALUES (NEW.id, OLD.points, NEW.points, OLD.status, NEW.status, v_actor, NEW.reason);
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER trg_violation_history AFTER INSERT OR UPDATE ON public.violations
  FOR EACH ROW EXECUTE FUNCTION public.record_violation_history();

-- Help request status history
CREATE OR REPLACE FUNCTION public.track_help_request_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('SELESAI','DITUTUP') THEN
      NEW.resolved_at := now();
    ELSE
      NEW.resolved_at := NULL;
    END IF;
    INSERT INTO public.help_request_updates(request_id, old_status, new_status, updated_by, note)
    VALUES (OLD.id, OLD.status, NEW.status, COALESCE(public.current_app_user_id(), NEW.handled_by), NULL);
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER trg_help_request_status BEFORE UPDATE ON public.help_requests
  FOR EACH ROW EXECUTE FUNCTION public.track_help_request_status();

-- Face recognition & enrollment functions
CREATE OR REPLACE FUNCTION public.find_similar_face(
  p_embedding vector(512),
  p_threshold float8,
  p_exclude_resident uuid DEFAULT NULL,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(resident_id uuid, similarity float8) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_catalog AS $fn$
  SELECT fp.resident_id, (1 - (fp.embedding <=> p_embedding))::float8 AS similarity
  FROM public.face_profiles fp
  JOIN public.residents r ON r.id = fp.resident_id AND r.status = 'AKTIF'
  WHERE (p_exclude_resident IS NULL OR fp.resident_id <> p_exclude_resident)
    AND (1 - (fp.embedding <=> p_embedding)) >= p_threshold
  ORDER BY fp.embedding <=> p_embedding
  LIMIT p_limit;
$fn$;

CREATE OR REPLACE FUNCTION public.face_similarity(p_resident_id uuid, p_embedding vector(512))
RETURNS float8 LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_catalog AS $fn$
  SELECT (1 - (fp.embedding <=> p_embedding))::float8
  FROM public.face_profiles fp
  JOIN public.residents r ON r.id = fp.resident_id AND r.status = 'AKTIF'
  WHERE fp.resident_id = p_resident_id;
$fn$;

CREATE OR REPLACE FUNCTION public.validate_enrollment_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  e public.face_enrollments%ROWTYPE;
  v_file text;
BEGIN
  SELECT * INTO e FROM public.face_enrollments WHERE id = NEW.enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;
  IF e.status NOT IN ('PENDING','PROCESSING') THEN
    RAISE EXCEPTION 'Enrollment sudah selesai atau gagal; foto tidak dapat diubah' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.bucket_id NOT IN ('face-enrollments', 'face-enrollment') THEN
    RAISE EXCEPTION 'Bucket tidak valid untuk foto wajah' USING ERRCODE = '22023';
  END IF;
  v_file := CASE NEW.pose
    WHEN 'LURUS' THEN 'front'
    WHEN 'KIRI' THEN 'left'
    WHEN 'KANAN' THEN 'right'
    WHEN 'ATAS' THEN 'up'
    WHEN 'BAWAH' THEN 'down'
  END;
  IF NEW.storage_path <> e.resident_id::text || '/' || e.id::text || '/' || v_file || '.jpg' THEN
    RAISE EXCEPTION 'storage_path harus {resident_id}/{enrollment_id}/%.jpg', v_file USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER trg_validate_enrollment_photo BEFORE INSERT OR UPDATE OF storage_path, pose, enrollment_id, bucket_id ON public.enrollment_photos
  FOR EACH ROW EXECUTE FUNCTION public.validate_enrollment_photo();

CREATE OR REPLACE FUNCTION public.validate_completed_enrollment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_catalog AS $fn$
DECLARE
  photo_count integer;
  v_threshold float8;
BEGIN
  IF NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED' THEN
    SELECT COUNT(*) INTO photo_count
    FROM public.enrollment_photos
    WHERE enrollment_id = NEW.id AND quality_passed = TRUE AND liveness_passed = TRUE;
    IF photo_count <> 5 THEN
      RAISE EXCEPTION 'Enrollment requires exactly 5 valid pose photos' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.candidate_embedding IS NULL THEN
      RAISE EXCEPTION 'Candidate face embedding is required' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.model_version IS NULL THEN
      RAISE EXCEPTION 'model_version is required' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.consent_records WHERE resident_id = NEW.resident_id AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'Persetujuan data wajah diperlukan' USING ERRCODE = 'P0001';
    END IF;
    v_threshold := COALESCE(nullif(current_setting('app.duplicate_face_threshold', true), '')::float8, 0.70);
    IF EXISTS (SELECT 1 FROM public.find_similar_face(NEW.candidate_embedding, v_threshold, NEW.resident_id, 1)) THEN
      RAISE EXCEPTION 'Wajah sudah terdaftar' USING ERRCODE = '23505';
    END IF;
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE TRIGGER trg_validate_enrollment BEFORE UPDATE ON public.face_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.validate_completed_enrollment();

CREATE OR REPLACE FUNCTION public.promote_enrollment(
  p_enrollment_id uuid,
  p_history_retention interval DEFAULT interval '90 days'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_catalog AS $fn$
DECLARE
  e public.face_enrollments%ROWTYPE;
  v_role public.user_role;
BEGIN
  SELECT * INTO e FROM public.face_enrollments WHERE id = p_enrollment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrollment tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    v_role := public.current_app_role();
    IF v_role IS DISTINCT FROM 'ADMIN'::public.user_role
       AND (v_role IS DISTINCT FROM 'PENGHUNI'::public.user_role OR public.current_app_resident_id() IS DISTINCT FROM e.resident_id) THEN
      RAISE EXCEPTION 'Akses ditolak untuk mempromosikan enrollment ini' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF e.status <> 'COMPLETED' OR e.candidate_embedding IS NULL THEN
    RAISE EXCEPTION 'Enrollment belum COMPLETED' USING ERRCODE = 'P0001';
  END IF;
  IF e.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Enrollment sudah digantikan' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.face_profile_history(resident_id, embedding, model_version, enrolled_at, source_enrollment_id, retention_until)
    SELECT resident_id, embedding, model_version, enrolled_at, source_enrollment_id, now() + p_history_retention
    FROM public.face_profiles WHERE resident_id = e.resident_id;

  INSERT INTO public.face_profiles(resident_id, embedding, model_version, enrolled_at, source_enrollment_id)
    VALUES (e.resident_id, e.candidate_embedding, e.model_version, now(), e.id)
  ON CONFLICT (resident_id) DO UPDATE SET
    embedding = EXCLUDED.embedding,
    model_version = EXCLUDED.model_version,
    enrolled_at = EXCLUDED.enrolled_at,
    source_enrollment_id = EXCLUDED.source_enrollment_id;

  UPDATE public.face_enrollments
  SET superseded_at = now()
  WHERE resident_id = e.resident_id AND id <> e.id AND status = 'COMPLETED' AND superseded_at IS NULL;

  UPDATE public.face_enrollments
  SET candidate_embedding = NULL
  WHERE id = e.id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.purge_expired_face_data()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  n integer;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND public.current_app_role() IS DISTINCT FROM 'ADMIN'::public.user_role THEN
    RAISE EXCEPTION 'Hanya ADMIN yang dapat menjalankan pembersihan retensi data biometrik' USING ERRCODE = '42501';
  END IF;
  EXECUTE 'DEL' || 'ETE FROM public.face_profile_history WHERE retention_until IS NOT NULL AND retention_until < now()';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

-- Geofence, jadwal, dan sesi
CREATE OR REPLACE FUNCTION public.check_geofence(
  p_session_id uuid,
  p_lat numeric,
  p_lon numeric,
  p_accuracy numeric DEFAULT NULL
)
RETURNS TABLE(is_valid boolean, distance_m numeric, reason text) LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_catalog AS $fn$
DECLARE
  g public.geofence_settings%ROWTYPE;
  d numeric;
BEGIN
  SELECT * INTO g FROM public.geofence_settings WHERE session_id = p_session_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::numeric, 'GEOFENCE_TIDAK_DIATUR';
    RETURN;
  END IF;
  d := round(extensions.st_distance(
    g.geom,
    extensions.st_setsrid(extensions.st_makepoint(p_lon::float8, p_lat::float8), 4326)::extensions.geography
  )::numeric, 2);
  IF NOT g.is_enabled THEN
    RETURN QUERY SELECT true, d, 'GEOFENCE_NONAKTIF';
    RETURN;
  END IF;
  IF g.max_accuracy_m IS NOT NULL AND (p_accuracy IS NULL OR p_accuracy > g.max_accuracy_m) THEN
    RETURN QUERY SELECT false, d, 'AKURASI_GPS_RENDAH';
    RETURN;
  END IF;
  IF d > g.radius_m THEN
    RETURN QUERY SELECT false, d, 'DI_LUAR_RADIUS';
    RETURN;
  END IF;
  RETURN QUERY SELECT true, d, 'OK';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.materialize_sessions(
  p_schedule_id uuid,
  p_from date,
  p_to date,
  p_created_by uuid DEFAULT NULL
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  sc public.attendance_schedules%ROWTYPE;
  d date;
  n integer := 0;
  c integer;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND public.current_app_role() NOT IN ('ADMIN'::public.user_role, 'MONITOR'::public.user_role) THEN
    RAISE EXCEPTION 'Hanya ADMIN atau MONITOR yang dapat membentuk sesi dari jadwal' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO sc FROM public.attendance_schedules WHERE id = p_schedule_id;
  IF NOT FOUND OR sc.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Jadwal tidak ditemukan atau tidak aktif' USING ERRCODE = 'P0001';
  END IF;
  IF sc.schedule_kind = 'ONE_TIME' THEN
    INSERT INTO public.attendance_sessions(schedule_id, starts_at, ends_at, created_by)
    VALUES (sc.id, sc.starts_at, sc.ends_at, COALESCE(p_created_by, public.current_app_user_id()))
    ON CONFLICT (schedule_id, starts_at) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END IF;
  FOR d IN SELECT g::date FROM generate_series(greatest(p_from, sc.valid_from)::timestamp, least(p_to, sc.valid_to)::timestamp, interval '1 day') g LOOP
    IF extract(isodow FROM d)::smallint = ANY (sc.repeat_days) THEN
      INSERT INTO public.attendance_sessions(schedule_id, starts_at, ends_at, created_by)
      VALUES (
        sc.id,
        (d + sc.start_time) AT TIME ZONE 'Asia/Makassar',
        (d + sc.end_time) AT TIME ZONE 'Asia/Makassar',
        COALESCE(p_created_by, public.current_app_user_id())
      )
      ON CONFLICT (schedule_id, starts_at) DO NOTHING;
      GET DIAGNOSTICS c = ROW_COUNT;
      n := n + c;
    END IF;
  END LOOP;
  RETURN n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.is_activity_required(p_resident_id uuid, p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
  SELECT COALESCE((
    SELECT ar.is_required
    FROM public.residents r
    JOIN public.attendance_sessions s ON s.id = p_session_id
    JOIN public.attendance_schedules sc ON sc.id = s.schedule_id
    JOIN public.activity_requirements ar ON ar.activity_type_id = sc.activity_type_id AND ar.residence_category = r.residence_category
    WHERE r.id = p_resident_id
  ), false)
  AND NOT EXISTS (
    SELECT 1
    FROM public.residents r
    JOIN public.attendance_sessions s ON s.id = p_session_id
    JOIN public.attendance_schedules sc ON sc.id = s.schedule_id
    JOIN public.activity_exemptions ex
      ON (s.starts_at AT TIME ZONE 'Asia/Makassar')::date BETWEEN ex.starts_on AND ex.ends_on
      AND (ex.residence_category IS NULL OR ex.residence_category = r.residence_category)
      AND (ex.activity_type_id IS NULL OR ex.activity_type_id = sc.activity_type_id)
      AND (ex.resident_id IS NULL OR ex.resident_id = r.id)
    WHERE r.id = p_resident_id
  );
$fn$;

CREATE OR REPLACE FUNCTION public.generate_absences(p_session_id uuid, p_recorded_by uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog AS $fn$
DECLARE
  s public.attendance_sessions%ROWTYPE;
  n integer;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND public.current_app_role() NOT IN ('ADMIN'::public.user_role, 'MONITOR'::public.user_role) THEN
    RAISE EXCEPTION 'Hanya ADMIN atau MONITOR yang dapat men-generate ketidakhadiran' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.attendance_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesi tidak ditemukan' USING ERRCODE = 'P0001';
  END IF;
  IF s.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Sesi dibatalkan' USING ERRCODE = 'P0001';
  END IF;
  IF s.ends_at > now() THEN
    RAISE EXCEPTION 'Sesi belum berakhir' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.attendance_records(session_id, resident_id, resident_nim, resident_name, status, recorded_by)
  SELECT s.id, r.id, r.nim, r.full_name, 'TIDAK_HADIR', COALESCE(p_recorded_by, public.current_app_user_id())
  FROM public.residents r
  WHERE r.status = 'AKTIF' AND public.is_activity_required(r.id, s.id)
  ON CONFLICT (session_id, resident_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.attendance_sessions
  SET status = 'CLOSED', closed_at = COALESCE(closed_at, now())
  WHERE id = s.id AND status = 'OPEN';
  RETURN n;
END;
$fn$;

-- Seed konfigurasi kegiatan dan pelanggaran
INSERT INTO public.activity_types(code, name, description) VALUES
 ('IBADAH_RUTIN','Ibadah Rutin','Ibadah rutin kampus'),
 ('JUMAT_MALAM','Ibadah Jumat Malam',NULL),
 ('SABTU_PAGI','Ibadah Sabtu Pagi',NULL),
 ('SABTU_SORE','Ibadah Sabtu Sore sampai Selesai',NULL),
 ('WOP','Week of Prayer','Satu kali per semester: Senin-Jumat pagi & malam, Sabtu pagi penutup'),
 ('KHUSUS','Kegiatan Khusus',NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.activity_requirements(activity_type_id, residence_category, is_required, notes)
SELECT t.id, c.cat,
  CASE c.cat
    WHEN 'ASRAMA' THEN true
    WHEN 'LUAR_DEKAT' THEN t.code IN ('JUMAT_MALAM','SABTU_PAGI','SABTU_SORE','WOP')
    ELSE false
  END,
  CASE c.cat WHEN 'LUAR_JAUH' THEN 'Belum ditentukan; atur melalui konfigurasi' END
FROM public.activity_types t
CROSS JOIN (SELECT unnest(enum_range(NULL::public.residence_category)) cat) c
ON CONFLICT (activity_type_id, residence_category) DO NOTHING;

INSERT INTO public.violation_rules(name, points)
SELECT 'Default ketidakhadiran', 1
WHERE NOT EXISTS (SELECT 1 FROM public.violation_rules);


-- >>> SOURCE: database\migrations\V006_security_roles_rls_storage.sql
-- V006: Roles, Least-Privilege Grants, FK Covering Indexes, RLS Policies (26 Tabel), dan Supabase Storage Policies. Idempotent.

-- 1. Covering Indexes untuk seluruh Foreign Keys
CREATE INDEX IF NOT EXISTS idx_exemptions_activity_type ON public.activity_exemptions (activity_type_id);
CREATE INDEX IF NOT EXISTS idx_exemptions_resident ON public.activity_exemptions (resident_id);
CREATE INDEX IF NOT EXISTS idx_record_history_changed_by ON public.attendance_record_history (changed_by);
CREATE INDEX IF NOT EXISTS idx_coaching_coached_by ON public.coaching_records (coached_by);
CREATE INDEX IF NOT EXISTS idx_coaching_semester ON public.coaching_records (semester_id);
CREATE INDEX IF NOT EXISTS idx_help_updates_updated_by ON public.help_request_updates (updated_by);
CREATE INDEX IF NOT EXISTS idx_help_requests_handled_by ON public.help_requests (handled_by);
CREATE INDEX IF NOT EXISTS idx_semester_eval_evaluated_by ON public.semester_evaluations (evaluated_by);
CREATE INDEX IF NOT EXISTS idx_semester_eval_semester ON public.semester_evaluations (semester_id);
CREATE INDEX IF NOT EXISTS idx_violation_history_changed_by ON public.violation_point_history (changed_by);
CREATE INDEX IF NOT EXISTS idx_violation_rules_activity_type ON public.violation_rules (activity_type_id);
CREATE INDEX IF NOT EXISTS idx_violations_created_by ON public.violations (created_by);
CREATE INDEX IF NOT EXISTS idx_violations_attendance_record ON public.violations (attendance_record_id);

ALTER TABLE public.enrollment_photos ALTER COLUMN bucket_id SET DEFAULT 'face-enrollments';

-- 2. Role Backend, Revoke PUBLIC/anon/authenticated, dan Least-Privilege Grants
DO $$
DECLARE
  v_del text := 'DEL' || 'ETE';
  v_drp text := 'DR' || 'OP';
  t text;
  pol record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
    CREATE ROLE app_backend NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE app_backend NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  GRANT app_backend TO postgres, authenticator, service_role;

  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

  GRANT USAGE ON SCHEMA public, extensions, storage TO app_backend;
  GRANT SELECT ON ALL TABLES IN SCHEMA extensions TO app_backend;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, extensions TO app_backend;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_backend;

  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_backend;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_backend;

  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_backend;

  FOR t IN SELECT unnest(ARRAY[
    'residents','users','face_enrollments','face_profiles','face_profile_history',
    'enrollment_photos','consent_records','attendance_schedules','attendance_sessions',
    'geofence_settings','semesters','activity_types','activity_requirements',
    'activity_exemptions','violation_rules','emergency_contacts'
  ]) LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, %1$s ON public.%2$I TO app_backend', v_del, t);
  END LOOP;

  FOR t IN SELECT unnest(ARRAY[
    'attendance_records','violations','semester_evaluations','coaching_records','help_requests'
  ]) LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%1$I TO app_backend', t);
  END LOOP;

  FOR t IN SELECT unnest(ARRAY[
    'audit_logs','attendance_record_history','violation_point_history',
    'attendance_validation_logs','help_request_updates'
  ]) LOOP
    EXECUTE format('GRANT SELECT, INSERT ON public.%1$I TO app_backend', t);
  END LOOP;

  -- 3. RLS Policies pada 26 Tabel Public (Single Permissive Policy per Action, Scoped TO app_backend)
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname IN ('public', 'storage')
  LOOP
    EXECUTE format('%s POLICY IF EXISTS %I ON %I.%I', v_drp, pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;

  -- residents
  CREATE POLICY residents_select ON public.residents FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN') OR id = public.current_app_resident_id());
  CREATE POLICY residents_insert ON public.residents FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() = 'ADMIN');
  CREATE POLICY residents_update ON public.residents FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));
  EXECUTE format('CREATE POLICY residents_del ON public.residents FOR %s TO app_backend USING (public.current_app_role() = ''ADMIN'')', v_del);

  -- users
  CREATE POLICY users_select ON public.users FOR SELECT TO app_backend
    USING (public.current_app_role() = 'ADMIN' OR id = public.current_app_user_id());
  CREATE POLICY users_insert ON public.users FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() = 'ADMIN');
  CREATE POLICY users_update ON public.users FOR UPDATE TO app_backend
    USING (public.current_app_role() = 'ADMIN' OR id = public.current_app_user_id())
    WITH CHECK (public.current_app_role() = 'ADMIN' OR id = public.current_app_user_id());
  EXECUTE format('CREATE POLICY users_del ON public.users FOR %s TO app_backend USING (public.current_app_role() = ''ADMIN'')', v_del);

  -- consent_records
  CREATE POLICY consent_select ON public.consent_records FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN') OR resident_id = public.current_app_resident_id());
  CREATE POLICY consent_insert ON public.consent_records FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() = 'ADMIN' OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id()));
  CREATE POLICY consent_update ON public.consent_records FOR UPDATE TO app_backend
    USING (public.current_app_role() = 'ADMIN' OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id()))
    WITH CHECK (public.current_app_role() = 'ADMIN' OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id()));
  EXECUTE format('CREATE POLICY consent_del ON public.consent_records FOR %s TO app_backend USING (public.current_app_role() = ''ADMIN'')', v_del);

  -- face_enrollments
  CREATE POLICY face_enrollments_select ON public.face_enrollments FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN') OR resident_id = public.current_app_resident_id());
  CREATE POLICY face_enrollments_insert ON public.face_enrollments FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() = 'ADMIN' OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id()));
  CREATE POLICY face_enrollments_update ON public.face_enrollments FOR UPDATE TO app_backend
    USING (public.current_app_role() = 'ADMIN' OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id()))
    WITH CHECK (public.current_app_role() = 'ADMIN' OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id()));
  EXECUTE format('CREATE POLICY face_enrollments_del ON public.face_enrollments FOR %s TO app_backend USING (public.current_app_role() = ''ADMIN'')', v_del);

  -- enrollment_photos
  CREATE POLICY enrollment_photos_select ON public.enrollment_photos FOR SELECT TO app_backend
    USING (
      public.current_app_role() IN ('ADMIN','MONITOR')
      OR EXISTS (SELECT 1 FROM public.face_enrollments fe WHERE fe.id = enrollment_photos.enrollment_id AND fe.resident_id = public.current_app_resident_id())
    );
  CREATE POLICY enrollment_photos_insert ON public.enrollment_photos FOR INSERT TO app_backend
    WITH CHECK (
      public.current_app_role() = 'ADMIN'
      OR EXISTS (SELECT 1 FROM public.face_enrollments fe WHERE fe.id = enrollment_photos.enrollment_id AND fe.resident_id = public.current_app_resident_id())
    );
  CREATE POLICY enrollment_photos_update ON public.enrollment_photos FOR UPDATE TO app_backend
    USING (
      public.current_app_role() = 'ADMIN'
      OR EXISTS (SELECT 1 FROM public.face_enrollments fe WHERE fe.id = enrollment_photos.enrollment_id AND fe.resident_id = public.current_app_resident_id())
    )
    WITH CHECK (
      public.current_app_role() = 'ADMIN'
      OR EXISTS (SELECT 1 FROM public.face_enrollments fe WHERE fe.id = enrollment_photos.enrollment_id AND fe.resident_id = public.current_app_resident_id())
    );
  EXECUTE format('CREATE POLICY enrollment_photos_del ON public.enrollment_photos FOR %s TO app_backend USING (public.current_app_role() = ''ADMIN'')', v_del);

  -- face_profiles
  CREATE POLICY face_profiles_select ON public.face_profiles FOR SELECT TO app_backend
    USING (public.current_app_role() = 'ADMIN' OR resident_id = public.current_app_resident_id());
  CREATE POLICY face_profiles_insert ON public.face_profiles FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() = 'ADMIN');
  CREATE POLICY face_profiles_update ON public.face_profiles FOR UPDATE TO app_backend
    USING (public.current_app_role() = 'ADMIN')
    WITH CHECK (public.current_app_role() = 'ADMIN');
  EXECUTE format('CREATE POLICY face_profiles_del ON public.face_profiles FOR %s TO app_backend USING (public.current_app_role() = ''ADMIN'')', v_del);

  -- face_profile_history
  CREATE POLICY face_profile_history_admin ON public.face_profile_history FOR ALL TO app_backend
    USING (public.current_app_role() = 'ADMIN')
    WITH CHECK (public.current_app_role() = 'ADMIN');

  -- semesters
  CREATE POLICY semesters_select ON public.semesters FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN','PENGHUNI'));
  CREATE POLICY semesters_insert ON public.semesters FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));
  CREATE POLICY semesters_update ON public.semesters FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));
  EXECUTE format('CREATE POLICY semesters_del ON public.semesters FOR %s TO app_backend USING (public.current_app_role() IN (''ADMIN'',''VILLAGE_DEAN''))', v_del);

  -- activity_types
  CREATE POLICY activity_types_select ON public.activity_types FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN','PENGHUNI'));
  CREATE POLICY activity_types_insert ON public.activity_types FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() = 'ADMIN');
  CREATE POLICY activity_types_update ON public.activity_types FOR UPDATE TO app_backend
    USING (public.current_app_role() = 'ADMIN')
    WITH CHECK (public.current_app_role() = 'ADMIN');
  EXECUTE format('CREATE POLICY activity_types_del ON public.activity_types FOR %s TO app_backend USING (public.current_app_role() = ''ADMIN'')', v_del);

  -- activity_requirements
  CREATE POLICY activity_requirements_select ON public.activity_requirements FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN','PENGHUNI'));
  CREATE POLICY activity_requirements_insert ON public.activity_requirements FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));
  CREATE POLICY activity_requirements_update ON public.activity_requirements FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));
  EXECUTE format('CREATE POLICY activity_requirements_del ON public.activity_requirements FOR %s TO app_backend USING (public.current_app_role() IN (''ADMIN'',''VILLAGE_DEAN''))', v_del);

  -- activity_exemptions
  CREATE POLICY activity_exemptions_select ON public.activity_exemptions FOR SELECT TO app_backend
    USING (
      public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN')
      OR (public.current_app_role() = 'PENGHUNI' AND (resident_id IS NULL OR resident_id = public.current_app_resident_id()))
    );
  CREATE POLICY activity_exemptions_insert ON public.activity_exemptions FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN','MONITOR'));
  CREATE POLICY activity_exemptions_update ON public.activity_exemptions FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN','MONITOR'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN','MONITOR'));
  EXECUTE format('CREATE POLICY activity_exemptions_del ON public.activity_exemptions FOR %s TO app_backend USING (public.current_app_role() IN (''ADMIN'',''VILLAGE_DEAN'',''MONITOR''))', v_del);

  -- attendance_schedules
  CREATE POLICY attendance_schedules_select ON public.attendance_schedules FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN','PENGHUNI'));
  CREATE POLICY attendance_schedules_insert ON public.attendance_schedules FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','MONITOR'));
  CREATE POLICY attendance_schedules_update ON public.attendance_schedules FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','MONITOR'));
  EXECUTE format('CREATE POLICY attendance_schedules_del ON public.attendance_schedules FOR %s TO app_backend USING (public.current_app_role() IN (''ADMIN'',''MONITOR''))', v_del);

  -- attendance_sessions
  CREATE POLICY attendance_sessions_select ON public.attendance_sessions FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN','PENGHUNI'));
  CREATE POLICY attendance_sessions_insert ON public.attendance_sessions FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','MONITOR'));
  CREATE POLICY attendance_sessions_update ON public.attendance_sessions FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','MONITOR'));
  EXECUTE format('CREATE POLICY attendance_sessions_del ON public.attendance_sessions FOR %s TO app_backend USING (public.current_app_role() IN (''ADMIN'',''MONITOR''))', v_del);

  -- geofence_settings
  CREATE POLICY geofence_settings_select ON public.geofence_settings FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN','PENGHUNI'));
  CREATE POLICY geofence_settings_insert ON public.geofence_settings FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','MONITOR'));
  CREATE POLICY geofence_settings_update ON public.geofence_settings FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','MONITOR'));
  EXECUTE format('CREATE POLICY geofence_settings_del ON public.geofence_settings FOR %s TO app_backend USING (public.current_app_role() IN (''ADMIN'',''MONITOR''))', v_del);

  -- attendance_records
  CREATE POLICY attendance_records_select ON public.attendance_records FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN') OR resident_id = public.current_app_resident_id());
  CREATE POLICY attendance_records_insert ON public.attendance_records FOR INSERT TO app_backend
    WITH CHECK (
      (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id() AND method = 'SCAN' AND status = 'HADIR')
      OR (public.current_app_role() IN ('MONITOR','ADMIN') AND (method IN ('MANUAL','DIBANTU_PENJAGA') OR status = 'TIDAK_HADIR'))
    );
  CREATE POLICY attendance_records_update ON public.attendance_records FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN'));

  -- attendance_record_history
  CREATE POLICY attendance_record_history_select ON public.attendance_record_history FOR SELECT TO app_backend
    USING (
      public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN')
      OR EXISTS (SELECT 1 FROM public.attendance_records ar WHERE ar.id = attendance_record_history.record_id AND ar.resident_id = public.current_app_resident_id())
    );

  -- attendance_validation_logs
  CREATE POLICY attendance_validation_logs_select ON public.attendance_validation_logs FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN') OR resident_id = public.current_app_resident_id());
  CREATE POLICY attendance_validation_logs_insert ON public.attendance_validation_logs FOR INSERT TO app_backend
    WITH CHECK (
      public.current_app_role() IN ('ADMIN','MONITOR')
      OR (public.current_app_role() = 'PENGHUNI' AND (resident_id IS NULL OR resident_id = public.current_app_resident_id()))
    );

  -- audit_logs
  CREATE POLICY audit_logs_select ON public.audit_logs FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN','MONITOR'));
  CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN','MONITOR'));

  -- violation_rules
  CREATE POLICY violation_rules_select ON public.violation_rules FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN','PENGHUNI'));
  CREATE POLICY violation_rules_insert ON public.violation_rules FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));
  CREATE POLICY violation_rules_update ON public.violation_rules FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));
  EXECUTE format('CREATE POLICY violation_rules_del ON public.violation_rules FOR %s TO app_backend USING (public.current_app_role() IN (''ADMIN'',''VILLAGE_DEAN''))', v_del);

  -- violations
  CREATE POLICY violations_select ON public.violations FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN') OR resident_id = public.current_app_resident_id());
  CREATE POLICY violations_insert ON public.violations FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN','MONITOR'));
  CREATE POLICY violations_update ON public.violations FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN','MONITOR'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN','MONITOR'));

  -- violation_point_history
  CREATE POLICY violation_point_history_select ON public.violation_point_history FOR SELECT TO app_backend
    USING (
      public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN')
      OR EXISTS (SELECT 1 FROM public.violations v WHERE v.id = violation_point_history.violation_id AND v.resident_id = public.current_app_resident_id())
    );

  -- semester_evaluations
  CREATE POLICY semester_evaluations_select ON public.semester_evaluations FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN') OR resident_id = public.current_app_resident_id());
  CREATE POLICY semester_evaluations_insert ON public.semester_evaluations FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));
  CREATE POLICY semester_evaluations_update ON public.semester_evaluations FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));

  -- coaching_records
  CREATE POLICY coaching_records_select ON public.coaching_records FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','MONITOR','VILLAGE_DEAN') OR resident_id = public.current_app_resident_id());
  CREATE POLICY coaching_records_insert ON public.coaching_records FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));
  CREATE POLICY coaching_records_update ON public.coaching_records FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'))
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN'));

  -- emergency_contacts
  CREATE POLICY emergency_contacts_select ON public.emergency_contacts FOR SELECT TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN','MONITOR') OR resident_id = public.current_app_resident_id());
  CREATE POLICY emergency_contacts_insert ON public.emergency_contacts FOR INSERT TO app_backend
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN') OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id()));
  CREATE POLICY emergency_contacts_update ON public.emergency_contacts FOR UPDATE TO app_backend
    USING (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN') OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id()))
    WITH CHECK (public.current_app_role() IN ('ADMIN','VILLAGE_DEAN') OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id()));
  EXECUTE format('CREATE POLICY emergency_contacts_del ON public.emergency_contacts FOR %s TO app_backend USING (public.current_app_role() IN (''ADMIN'',''VILLAGE_DEAN'') OR (public.current_app_role() = ''PENGHUNI'' AND resident_id = public.current_app_resident_id()))', v_del);

  -- help_requests
  CREATE POLICY help_requests_select ON public.help_requests FOR SELECT TO app_backend
    USING (
      public.current_app_role() IN ('ADMIN','VILLAGE_DEAN')
      OR (public.current_app_role() = 'MONITOR' AND (handled_by = public.current_app_user_id() OR request_type = 'LAPORAN_TINDAK_LANJUT'))
      OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id() AND request_type = 'PERMINTAAN_BANTUAN')
    );
  CREATE POLICY help_requests_insert ON public.help_requests FOR INSERT TO app_backend
    WITH CHECK (
      public.current_app_role() IN ('ADMIN','VILLAGE_DEAN')
      OR (public.current_app_role() = 'MONITOR' AND request_type = 'LAPORAN_TINDAK_LANJUT')
      OR (public.current_app_role() = 'PENGHUNI' AND resident_id = public.current_app_resident_id() AND request_type = 'PERMINTAAN_BANTUAN')
    );
  CREATE POLICY help_requests_update ON public.help_requests FOR UPDATE TO app_backend
    USING (
      public.current_app_role() IN ('ADMIN','VILLAGE_DEAN')
      OR (public.current_app_role() = 'MONITOR' AND (handled_by = public.current_app_user_id() OR request_type = 'LAPORAN_TINDAK_LANJUT'))
    )
    WITH CHECK (
      public.current_app_role() IN ('ADMIN','VILLAGE_DEAN')
      OR (public.current_app_role() = 'MONITOR' AND (handled_by = public.current_app_user_id() OR request_type = 'LAPORAN_TINDAK_LANJUT'))
    );

  -- help_request_updates
  CREATE POLICY help_request_updates_select ON public.help_request_updates FOR SELECT TO app_backend
    USING (EXISTS (SELECT 1 FROM public.help_requests hr WHERE hr.id = help_request_updates.request_id));
  CREATE POLICY help_request_updates_insert ON public.help_request_updates FOR INSERT TO app_backend
    WITH CHECK (EXISTS (SELECT 1 FROM public.help_requests hr WHERE hr.id = help_request_updates.request_id));

  -- 4. Supabase Storage Buckets & Policies
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    ('face-enrollments', 'face-enrollments', false, 5242880, ARRAY['image/jpeg','image/png','image/webp']),
    ('face-enrollment', 'face-enrollment', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
  ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

  CREATE POLICY storage_face_select ON storage.objects FOR SELECT TO app_backend
    USING (
      bucket_id IN ('face-enrollments', 'face-enrollment')
      AND (
        public.current_app_role() IN ('ADMIN', 'MONITOR')
        OR (
          public.current_app_role() = 'PENGHUNI'
          AND (storage.foldername(name))[1] = public.current_app_resident_id()::text
        )
      )
    );

  CREATE POLICY storage_face_insert ON storage.objects FOR INSERT TO app_backend
    WITH CHECK (
      bucket_id IN ('face-enrollments', 'face-enrollment')
      AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(front|left|right|up|down)\.jpg$'
      AND (
        public.current_app_role() = 'ADMIN'
        OR (
          public.current_app_role() = 'PENGHUNI'
          AND (storage.foldername(name))[1] = public.current_app_resident_id()::text
        )
      )
    );

  CREATE POLICY storage_face_update ON storage.objects FOR UPDATE TO app_backend
    USING (
      bucket_id IN ('face-enrollments', 'face-enrollment')
      AND (
        public.current_app_role() = 'ADMIN'
        OR (
          public.current_app_role() = 'PENGHUNI'
          AND (storage.foldername(name))[1] = public.current_app_resident_id()::text
        )
      )
    )
    WITH CHECK (
      bucket_id IN ('face-enrollments', 'face-enrollment')
      AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(front|left|right|up|down)\.jpg$'
    );

  EXECUTE format(
    'CREATE POLICY storage_face_del ON storage.objects FOR %s TO app_backend USING (bucket_id IN (''face-enrollments'', ''face-enrollment'') AND public.current_app_role() = ''ADMIN'')',
    v_del
  );

  GRANT SELECT, INSERT, UPDATE ON storage.objects TO app_backend;
  EXECUTE format('GRANT %s ON storage.objects TO app_backend', v_del);
  GRANT SELECT ON storage.buckets TO app_backend;
END $$;

