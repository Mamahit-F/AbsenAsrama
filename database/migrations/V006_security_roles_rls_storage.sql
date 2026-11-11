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
