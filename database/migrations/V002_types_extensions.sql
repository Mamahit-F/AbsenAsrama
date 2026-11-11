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
