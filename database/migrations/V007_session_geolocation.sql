-- ====================================================================
-- V007_session_geolocation.sql
-- Additive migration for Session-Based Geolocation (Geofencing)
-- Requirements: P-11, J-06, J-08, S-04, K-03, K-04, K-05, K-06, T-05, T-06
-- ====================================================================

-- 1. Jadwal Presensi (attendance_schedules)
ALTER TABLE public.attendance_schedules
  ADD COLUMN IF NOT EXISTS is_geo_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS geo_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_radius_meters INTEGER NOT NULL DEFAULT 50;

-- 2. Sesi Presensi (attendance_sessions)
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS is_geo_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS geo_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_radius_meters INTEGER NOT NULL DEFAULT 50;

-- 3. Catatan Presensi (attendance_records)
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS user_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS user_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS user_accuracy_meters DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS distance_meters DOUBLE PRECISION;

-- Sinkronkan data koordinat yang sudah ada jika ada catatan lama
UPDATE public.attendance_records
SET user_latitude = latitude::double precision,
    user_longitude = longitude::double precision,
    user_accuracy_meters = accuracy_m::double precision,
    distance_meters = distance_m::double precision
WHERE user_latitude IS NULL AND latitude IS NOT NULL;

-- 4. Log Validasi / Log Teknis (attendance_validation_logs)
ALTER TABLE public.attendance_validation_logs
  ADD COLUMN IF NOT EXISTS user_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS user_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS user_accuracy_meters DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS distance_meters DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS stage_latencies_json JSONB;

UPDATE public.attendance_validation_logs
SET user_latitude = latitude::double precision,
    user_longitude = longitude::double precision,
    user_accuracy_meters = accuracy_m::double precision,
    distance_meters = distance_m::double precision
WHERE user_latitude IS NULL AND latitude IS NOT NULL;

-- 5. Sinkronkan sesi yang sudah memiliki geofence_settings
UPDATE public.attendance_sessions s
SET is_geo_enabled = g.is_enabled,
    geo_latitude = g.latitude::double precision,
    geo_longitude = g.longitude::double precision,
    geo_radius_meters = g.radius_m
FROM public.geofence_settings g
WHERE g.session_id = s.id
  AND (s.geo_latitude IS NULL OR s.is_geo_enabled = FALSE);

-- Index penunjang untuk pencarian sesi ber-geofence
CREATE INDEX IF NOT EXISTS idx_sessions_geo_enabled ON public.attendance_sessions (is_geo_enabled);
