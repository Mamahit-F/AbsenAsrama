-- ====================================================================
-- V009_permanent_schedule_session_delete.sql
-- Mengizinkan penghapusan permanen jadwal/sesi presensi secara cascade
-- pada tabel attendance_validation_logs & attendance_record_history.
-- UPDATE pada kedua tabel tersebut tetap dilarang, direct DELETE oleh
-- app_backend tetap diblokir oleh GRANT/RLS, dan tabel audit_logs
-- serta violation_point_history tetap 100% immutable (DELETE & UPDATE).
-- ====================================================================

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
$fn$;

DROP TRIGGER IF EXISTS trg_immutable_attendance_validation_logs ON public.attendance_validation_logs;
CREATE TRIGGER trg_immutable_attendance_validation_logs
  BEFORE UPDATE ON public.attendance_validation_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_history_modification();

DROP TRIGGER IF EXISTS trg_immutable_attendance_record_history ON public.attendance_record_history;
CREATE TRIGGER trg_immutable_attendance_record_history
  BEFORE UPDATE ON public.attendance_record_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_history_modification();
