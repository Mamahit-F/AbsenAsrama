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
