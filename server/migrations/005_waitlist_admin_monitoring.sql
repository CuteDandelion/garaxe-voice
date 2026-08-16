DROP POLICY IF EXISTS waitlist_api_monitor_read ON public.waitlist_signups;
CREATE POLICY waitlist_api_monitor_read ON public.waitlist_signups FOR SELECT TO voice_lab_api
  USING (true);

REVOKE ALL ON public.waitlist_signups FROM anon, authenticated, PUBLIC;
GRANT INSERT, SELECT ON public.waitlist_signups TO voice_lab_api;
