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
