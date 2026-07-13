-- Managed PostgreSQL tenant isolation. Apply with scripts/apply-migrations.mjs.
-- The application role must set app.current_user_id inside each transaction.

CREATE OR REPLACE FUNCTION public.app_current_user_id() RETURNS UUID
LANGUAGE SQL STABLE SET search_path = ''
AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION public.app_can_access_org(target UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.organization_memberships m
  WHERE m.organization_id = target AND m.user_id = public.app_current_user_id()
) $$;

CREATE OR REPLACE FUNCTION public.app_can_access_project(target UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.project_organizations po
  WHERE po.project_id = target AND public.app_can_access_org(po.organization_id)
) $$;

CREATE OR REPLACE FUNCTION public.app_can_access_run(target UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.analysis_runs r
  WHERE r.id = target AND public.app_can_access_project(r.project_id)
) $$;

CREATE OR REPLACE FUNCTION public.app_can_access_theme(target TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.themes t
  WHERE t.id = target AND public.app_can_access_run(t.analysis_run_id)
) $$;

CREATE OR REPLACE FUNCTION public.app_can_access_import(target UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.import_jobs j
  WHERE j.id = target AND public.app_can_access_project(j.project_id)
) $$;

CREATE OR REPLACE FUNCTION public.app_can_access_google_connection(target UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.google_business_connections c
  WHERE c.id = target AND public.app_can_access_org(c.organization_id)
) $$;

CREATE OR REPLACE FUNCTION public.app_can_access_llm_job(target UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.llm_jobs j
  WHERE j.id = target
    AND public.app_can_access_org(j.organization_id)
    AND public.app_can_access_project(j.project_id)
    AND public.app_can_access_run(j.analysis_run_id)
) $$;

CREATE OR REPLACE FUNCTION public.app_can_access_llm_budget(target_type TEXT, target_id TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT CASE target_type
  WHEN 'organization' THEN public.app_can_access_org(target_id::uuid)
  WHEN 'project' THEN public.app_can_access_project(target_id::uuid)
  WHEN 'run' THEN public.app_can_access_run(target_id::uuid)
  ELSE FALSE
END $$;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.projects;
CREATE POLICY tenant_isolation ON public.projects FOR ALL
  USING (public.app_can_access_project(id))
  WITH CHECK (
    public.app_can_access_project(id)
    OR (
      public.app_current_user_id() IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.project_organizations po WHERE po.project_id = id)
    )
  );

ALTER TABLE public.project_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.project_organizations;
CREATE POLICY tenant_isolation ON public.project_organizations FOR ALL
  USING (public.app_can_access_org(organization_id)) WITH CHECK (public.app_can_access_org(organization_id));

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.import_jobs;
CREATE POLICY tenant_isolation ON public.import_jobs FOR ALL
  USING (public.app_can_access_project(project_id)) WITH CHECK (public.app_can_access_project(project_id));

ALTER TABLE public.review_source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_source_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.review_source_records;
CREATE POLICY tenant_isolation ON public.review_source_records FOR ALL
  USING (public.app_can_access_project(project_id)) WITH CHECK (public.app_can_access_project(project_id));

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.reviews;
CREATE POLICY tenant_isolation ON public.reviews FOR ALL
  USING (public.app_can_access_project(project_id)) WITH CHECK (public.app_can_access_project(project_id));

ALTER TABLE public.analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.analysis_runs;
CREATE POLICY tenant_isolation ON public.analysis_runs FOR ALL
  USING (public.app_can_access_project(project_id)) WITH CHECK (public.app_can_access_project(project_id));

ALTER TABLE public.analysis_run_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.analysis_run_reviews;
CREATE POLICY tenant_isolation ON public.analysis_run_reviews FOR ALL
  USING (public.app_can_access_run(analysis_run_id)) WITH CHECK (public.app_can_access_run(analysis_run_id));

ALTER TABLE public.review_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_signals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.review_signals;
CREATE POLICY tenant_isolation ON public.review_signals FOR ALL
  USING (public.app_can_access_run(analysis_run_id)) WITH CHECK (public.app_can_access_run(analysis_run_id));

ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.themes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.themes;
CREATE POLICY tenant_isolation ON public.themes FOR ALL
  USING (public.app_can_access_run(analysis_run_id)) WITH CHECK (public.app_can_access_run(analysis_run_id));

ALTER TABLE public.theme_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theme_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.theme_evidence;
CREATE POLICY tenant_isolation ON public.theme_evidence FOR ALL
  USING (public.app_can_access_theme(theme_id)) WITH CHECK (public.app_can_access_theme(theme_id));

ALTER TABLE public.voice_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_maps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.voice_maps;
CREATE POLICY tenant_isolation ON public.voice_maps FOR ALL
  USING (public.app_can_access_run(analysis_run_id)) WITH CHECK (public.app_can_access_run(analysis_run_id));

ALTER TABLE public.curation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curation_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.curation_sessions;
CREATE POLICY tenant_isolation ON public.curation_sessions FOR ALL
  USING (public.app_can_access_run(analysis_run_id)) WITH CHECK (public.app_can_access_run(analysis_run_id));

ALTER TABLE public.curation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curation_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.curation_actions;
CREATE POLICY tenant_isolation ON public.curation_actions FOR ALL
  USING (public.app_can_access_run(analysis_run_id)) WITH CHECK (public.app_can_access_run(analysis_run_id));

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.reports;
CREATE POLICY tenant_isolation ON public.reports FOR ALL
  USING (public.app_can_access_project(project_id)) WITH CHECK (public.app_can_access_project(project_id));

ALTER TABLE public.google_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_oauth_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.google_oauth_states;
CREATE POLICY tenant_isolation ON public.google_oauth_states FOR ALL
  USING (user_id = public.app_current_user_id() AND public.app_can_access_org(organization_id))
  WITH CHECK (user_id = public.app_current_user_id() AND public.app_can_access_org(organization_id));

ALTER TABLE public.google_business_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_business_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.google_business_connections;
CREATE POLICY tenant_isolation ON public.google_business_connections FOR ALL
  USING (public.app_can_access_org(organization_id) AND public.app_can_access_project(project_id))
  WITH CHECK (public.app_can_access_org(organization_id) AND public.app_can_access_project(project_id));

ALTER TABLE public.google_business_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_business_entities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.google_business_entities;
CREATE POLICY tenant_isolation ON public.google_business_entities FOR ALL
  USING (public.app_can_access_google_connection(connection_id))
  WITH CHECK (public.app_can_access_google_connection(connection_id));

ALTER TABLE public.google_sync_job_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_sync_job_entities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.google_sync_job_entities;
CREATE POLICY tenant_isolation ON public.google_sync_job_entities FOR ALL
  USING (public.app_can_access_import(import_job_id))
  WITH CHECK (public.app_can_access_import(import_job_id));

ALTER TABLE public.llm_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.llm_jobs;
CREATE POLICY tenant_isolation ON public.llm_jobs FOR ALL
  USING (
    public.app_can_access_org(organization_id)
    AND public.app_can_access_project(project_id)
    AND public.app_can_access_run(analysis_run_id)
  )
  WITH CHECK (
    public.app_can_access_org(organization_id)
    AND public.app_can_access_project(project_id)
    AND public.app_can_access_run(analysis_run_id)
  );

ALTER TABLE public.llm_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.llm_attempts;
CREATE POLICY tenant_isolation ON public.llm_attempts FOR ALL
  USING (public.app_can_access_llm_job(job_id)) WITH CHECK (public.app_can_access_llm_job(job_id));

ALTER TABLE public.llm_budget_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_budget_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.llm_budget_accounts;
CREATE POLICY tenant_isolation ON public.llm_budget_accounts FOR ALL
  USING (public.app_can_access_llm_budget(scope_type, scope_id))
  WITH CHECK (public.app_can_access_llm_budget(scope_type, scope_id));

ALTER TABLE public.llm_budget_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_budget_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.llm_budget_ledger;
CREATE POLICY tenant_isolation ON public.llm_budget_ledger FOR ALL
  USING (
    public.app_can_access_llm_job(job_id)
    AND public.app_can_access_llm_budget(scope_type, scope_id)
  )
  WITH CHECK (
    public.app_can_access_llm_job(job_id)
    AND public.app_can_access_llm_budget(scope_type, scope_id)
  );

-- Provider/model quota, concurrency policy, and health are deployment-owned control-plane state,
-- not tenant Data API resources.
REVOKE ALL ON TABLE public.llm_rate_buckets, public.llm_concurrency_limits, public.llm_provider_health FROM PUBLIC;

-- Foreign keys and policy predicates require explicit indexes in PostgreSQL.
CREATE INDEX IF NOT EXISTS project_organizations_project_org_idx ON public.project_organizations(project_id, organization_id);
CREATE INDEX IF NOT EXISTS review_source_records_project_idx ON public.review_source_records(project_id);
CREATE INDEX IF NOT EXISTS analysis_run_reviews_review_idx ON public.analysis_run_reviews(review_id);
CREATE INDEX IF NOT EXISTS theme_evidence_signal_idx ON public.theme_evidence(signal_id);
CREATE INDEX IF NOT EXISTS curation_actions_session_idx ON public.curation_actions(curation_session_id);
CREATE INDEX IF NOT EXISTS google_oauth_states_user_org_idx ON public.google_oauth_states(user_id, organization_id);
CREATE INDEX IF NOT EXISTS google_connections_project_idx ON public.google_business_connections(project_id);
CREATE INDEX IF NOT EXISTS llm_jobs_tenant_idx ON public.llm_jobs(organization_id, project_id, analysis_run_id);
CREATE INDEX IF NOT EXISTS llm_budget_ledger_scope_idx ON public.llm_budget_ledger(scope_type, scope_id);
