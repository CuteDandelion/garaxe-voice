-- Local migration draft for Supabase Auth. Do not apply until the managed
-- project, dedicated database login, and rollback rehearsal are approved.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voice_lab_api') THEN
    CREATE ROLE voice_lab_api NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'auth_users_supabase_user_fk' AND conrelid = 'public.auth_users'::regclass
  ) THEN
    ALTER TABLE public.auth_users
      ADD CONSTRAINT auth_users_supabase_user_fk
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_user_self_read ON public.auth_users;
CREATE POLICY auth_user_self_read ON public.auth_users FOR SELECT TO voice_lab_api
  USING (id = public.app_current_user_id());

ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS membership_self_read ON public.organization_memberships;
CREATE POLICY membership_self_read ON public.organization_memberships FOR SELECT TO voice_lab_api
  USING (user_id = public.app_current_user_id());

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_member_read ON public.organizations;
CREATE POLICY organization_member_read ON public.organizations FOR SELECT TO voice_lab_api
  USING (public.app_can_access_org(id));

ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist_signups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waitlist_api_insert ON public.waitlist_signups;
CREATE POLICY waitlist_api_insert ON public.waitlist_signups FOR INSERT TO voice_lab_api
  WITH CHECK (consent_version = 'voice-lab-waitlist-v1');

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
GRANT USAGE ON SCHEMA public TO voice_lab_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO voice_lab_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO voice_lab_api;

-- Credentials and membership provisioning stay administrator-only.
REVOKE INSERT, UPDATE, DELETE ON public.auth_users, public.organizations, public.organization_memberships FROM voice_lab_api;
REVOKE ALL ON public.auth_sessions FROM voice_lab_api;
REVOKE SELECT, UPDATE, DELETE ON public.waitlist_signups FROM voice_lab_api;
GRANT INSERT ON public.waitlist_signups TO voice_lab_api;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO voice_lab_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO voice_lab_api;
