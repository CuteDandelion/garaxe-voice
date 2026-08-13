-- Harden server-only public objects after the Supabase Auth and Storage overlays.
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.demo_analysis_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_analysis_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.llm_concurrency_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_concurrency_limits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.llm_provider_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_provider_health FORCE ROW LEVEL SECURITY;
ALTER TABLE public.llm_rate_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_rate_buckets FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.auth_sessions,
  public.demo_analysis_sessions,
  public.llm_concurrency_limits,
  public.llm_provider_health,
  public.llm_rate_buckets
FROM PUBLIC, anon, authenticated;

-- Supabase Auth replaces local compatibility sessions, and Demo uses its separate PGlite handle.
REVOKE ALL ON TABLE public.auth_sessions, public.demo_analysis_sessions FROM voice_lab_api;

-- Queue admission, throttling, and circuit state remain server-owned runtime controls.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.llm_concurrency_limits,
  public.llm_provider_health,
  public.llm_rate_buckets
TO voice_lab_api;

DROP POLICY IF EXISTS voice_lab_api_server_control ON public.llm_concurrency_limits;
CREATE POLICY voice_lab_api_server_control ON public.llm_concurrency_limits
  FOR ALL TO voice_lab_api USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS voice_lab_api_server_control ON public.llm_provider_health;
CREATE POLICY voice_lab_api_server_control ON public.llm_provider_health
  FOR ALL TO voice_lab_api USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS voice_lab_api_server_control ON public.llm_rate_buckets;
CREATE POLICY voice_lab_api_server_control ON public.llm_rate_buckets
  FOR ALL TO voice_lab_api USING (true) WITH CHECK (true);

-- These helpers are RLS predicates, not public RPC endpoints.
REVOKE EXECUTE ON FUNCTION
  public.app_can_access_google_connection(UUID),
  public.app_can_access_import(UUID),
  public.app_can_access_llm_budget(TEXT, TEXT),
  public.app_can_access_llm_job(UUID),
  public.app_can_access_org(UUID),
  public.app_can_access_project(UUID),
  public.app_can_access_run(UUID),
  public.app_can_access_theme(TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.app_can_access_google_connection(UUID),
  public.app_can_access_import(UUID),
  public.app_can_access_llm_budget(TEXT, TEXT),
  public.app_can_access_llm_job(UUID),
  public.app_can_access_org(UUID),
  public.app_can_access_project(UUID),
  public.app_can_access_run(UUID),
  public.app_can_access_theme(TEXT)
TO voice_lab_api;
