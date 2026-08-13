ALTER TABLE public.auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_user_self_provision ON public.auth_users;
CREATE POLICY auth_user_self_provision ON public.auth_users FOR INSERT TO voice_lab_api
  WITH CHECK (id = public.app_current_user_id());

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS personal_organization_provision ON public.organizations;
CREATE POLICY personal_organization_provision ON public.organizations FOR INSERT TO voice_lab_api
  WITH CHECK (public.app_current_user_id() IS NOT NULL AND name = 'Personal workspace');

ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_membership_self_provision ON public.organization_memberships;
CREATE POLICY owner_membership_self_provision ON public.organization_memberships FOR INSERT TO voice_lab_api
  WITH CHECK (user_id = public.app_current_user_id() AND role = 'owner');

REVOKE INSERT ON public.auth_users, public.organizations, public.organization_memberships FROM anon, authenticated, PUBLIC;
GRANT INSERT ON public.auth_users, public.organizations, public.organization_memberships TO voice_lab_api;
