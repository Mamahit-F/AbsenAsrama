-- V001: Referensi skema awal 12 tabel (Idempotent — tidak merusak struktur yang sudah ada)
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
