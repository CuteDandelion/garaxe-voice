DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voice_lab_runtime') THEN
    CREATE ROLE voice_lab_runtime LOGIN INHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE voice_lab_runtime LOGIN INHERIT NOBYPASSRLS;
GRANT voice_lab_api TO voice_lab_runtime;
