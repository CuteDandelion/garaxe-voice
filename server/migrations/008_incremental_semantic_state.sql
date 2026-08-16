CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
REVOKE ALL ON SCHEMA extensions FROM anon, authenticated, PUBLIC;
GRANT USAGE ON SCHEMA extensions TO voice_lab_api;

CREATE TABLE public.project_semantic_embeddings (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_version TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions = 384),
  embedding extensions.vector(384) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, content_hash, embedding_model, embedding_version)
);

CREATE TABLE public.project_review_semantic_decisions (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  contract_key TEXT NOT NULL,
  outcome JSONB NOT NULL,
  response_hash TEXT NOT NULL,
  source_analysis_run_id UUID NOT NULL REFERENCES public.analysis_runs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, review_id, contract_key)
);

CREATE TABLE public.project_review_pair_decisions (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  left_review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  right_review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  contract_key TEXT NOT NULL,
  same_topic BOOLEAN NOT NULL,
  response_hash TEXT NOT NULL,
  source_analysis_run_id UUID NOT NULL REFERENCES public.analysis_runs(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (left_review_id < right_review_id),
  PRIMARY KEY (project_id, left_review_id, right_review_id, contract_key)
);

CREATE TABLE public.analysis_run_pair_decisions (
  analysis_run_id UUID NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  left_review_id UUID NOT NULL,
  right_review_id UUID NOT NULL,
  contract_key TEXT NOT NULL,
  same_topic BOOLEAN NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (left_review_id < right_review_id),
  PRIMARY KEY (analysis_run_id, left_review_id, right_review_id),
  FOREIGN KEY (project_id, left_review_id, right_review_id, contract_key)
    REFERENCES public.project_review_pair_decisions(project_id, left_review_id, right_review_id, contract_key)
    ON DELETE RESTRICT
);

CREATE TABLE public.project_aspect_semantic_decisions (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  aspect_key TEXT NOT NULL,
  topic_identity TEXT NOT NULL,
  signal_fingerprint TEXT NOT NULL,
  contract_key TEXT NOT NULL,
  outcome JSONB NOT NULL,
  response_hash TEXT NOT NULL,
  source_analysis_run_id UUID NOT NULL REFERENCES public.analysis_runs(id) ON DELETE RESTRICT,
  source_signal_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, review_id, aspect_key, contract_key)
);

CREATE TABLE public.analysis_run_aspect_decisions (
  analysis_run_id UUID NOT NULL REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  signal_id TEXT NOT NULL REFERENCES public.review_signals(id) ON DELETE CASCADE,
  review_id UUID NOT NULL,
  aspect_key TEXT NOT NULL,
  contract_key TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (analysis_run_id, signal_id),
  FOREIGN KEY (project_id, review_id, aspect_key, contract_key)
    REFERENCES public.project_aspect_semantic_decisions(project_id, review_id, aspect_key, contract_key)
    ON DELETE RESTRICT
);

CREATE INDEX project_review_semantic_decisions_contract_idx
  ON public.project_review_semantic_decisions(project_id, contract_key, review_id);
CREATE INDEX project_review_pair_decisions_contract_idx
  ON public.project_review_pair_decisions(project_id, contract_key, left_review_id, right_review_id);
CREATE INDEX project_semantic_embeddings_vector_idx
  ON public.project_semantic_embeddings USING hnsw (embedding extensions.vector_cosine_ops);
CREATE INDEX project_aspect_semantic_decisions_contract_idx
  ON public.project_aspect_semantic_decisions(project_id, contract_key, topic_identity);

ALTER TABLE public.project_semantic_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_semantic_embeddings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_review_semantic_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_review_semantic_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_review_pair_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_review_pair_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_pair_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_pair_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_aspect_semantic_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_aspect_semantic_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_aspect_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_run_aspect_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.project_semantic_embeddings
  FOR ALL TO voice_lab_api USING (public.app_can_access_project(project_id))
  WITH CHECK (public.app_can_access_project(project_id));
CREATE POLICY tenant_isolation ON public.project_review_semantic_decisions
  FOR ALL TO voice_lab_api USING (public.app_can_access_project(project_id))
  WITH CHECK (public.app_can_access_project(project_id));
CREATE POLICY tenant_isolation ON public.project_review_pair_decisions
  FOR ALL TO voice_lab_api USING (public.app_can_access_project(project_id))
  WITH CHECK (public.app_can_access_project(project_id));
CREATE POLICY tenant_isolation ON public.analysis_run_pair_decisions
  FOR ALL TO voice_lab_api USING (public.app_can_access_run(analysis_run_id))
  WITH CHECK (public.app_can_access_run(analysis_run_id) AND public.app_can_access_project(project_id));
CREATE POLICY tenant_isolation ON public.project_aspect_semantic_decisions
  FOR ALL TO voice_lab_api USING (public.app_can_access_project(project_id))
  WITH CHECK (public.app_can_access_project(project_id));
CREATE POLICY tenant_isolation ON public.analysis_run_aspect_decisions
  FOR ALL TO voice_lab_api USING (public.app_can_access_run(analysis_run_id))
  WITH CHECK (public.app_can_access_run(analysis_run_id) AND public.app_can_access_project(project_id));

REVOKE ALL ON public.project_semantic_embeddings, public.project_review_semantic_decisions,
  public.project_review_pair_decisions, public.analysis_run_pair_decisions FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.project_aspect_semantic_decisions, public.analysis_run_aspect_decisions FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.project_semantic_embeddings, public.project_review_semantic_decisions,
  public.project_review_pair_decisions, public.analysis_run_pair_decisions,
  public.project_aspect_semantic_decisions, public.analysis_run_aspect_decisions FROM voice_lab_api;
GRANT SELECT, INSERT ON public.project_semantic_embeddings, public.project_review_semantic_decisions,
  public.project_review_pair_decisions, public.analysis_run_pair_decisions TO voice_lab_api;
GRANT SELECT, INSERT ON public.project_aspect_semantic_decisions, public.analysis_run_aspect_decisions TO voice_lab_api;
