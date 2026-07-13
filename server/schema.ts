export const schemaSql = `
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  primary_decision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  usable_rows INTEGER NOT NULL DEFAULT 0,
  written_rows INTEGER NOT NULL DEFAULT 0,
  rating_only_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS review_source_records (
  id UUID PRIMARY KEY,
  import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(import_job_id, row_number)
);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_record_id UUID NOT NULL REFERENCES review_source_records(id) ON DELETE CASCADE,
  external_review_id TEXT,
  provider TEXT NOT NULL DEFAULT 'csv_import',
  entity_name TEXT,
  rating_value DOUBLE PRECISION,
  rating_scale DOUBLE PRECISION NOT NULL DEFAULT 5,
  title TEXT,
  body_original TEXT,
  language TEXT,
  reviewer_name TEXT,
  owner_reply TEXT,
  source_url TEXT,
  source_created_at TIMESTAMPTZ,
  is_rating_only BOOLEAN NOT NULL DEFAULT FALSE,
  canonical_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, canonical_hash)
);

CREATE INDEX IF NOT EXISTS reviews_project_created_idx ON reviews(project_id, source_created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_project_inventory_idx ON reviews(project_id, imported_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reviews_project_provider_idx ON reviews(project_id, provider);
CREATE INDEX IF NOT EXISTS reviews_project_entity_idx ON reviews(project_id, entity_name);
CREATE INDEX IF NOT EXISTS reviews_project_rating_idx ON reviews(project_id, rating_value);
CREATE INDEX IF NOT EXISTS reviews_project_language_idx ON reviews(project_id, language);
CREATE INDEX IF NOT EXISTS imports_project_created_idx ON import_jobs(project_id, created_at DESC);

ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS source_media_type TEXT;
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS source_encoding TEXT CHECK (source_encoding IN ('utf8', 'base64'));
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS source_content BYTEA;
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS source_hash TEXT;

CREATE TABLE IF NOT EXISTS analysis_runs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  objective TEXT NOT NULL CHECK (objective IN ('full_voice_map', 'complaints', 'positive_language', 'operational_issues', 'purchase_drivers', 'location_comparison')),
  configuration JSONB NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  quality_report JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

ALTER TABLE analysis_runs DROP CONSTRAINT IF EXISTS analysis_runs_status_check;
ALTER TABLE analysis_runs ADD CONSTRAINT analysis_runs_status_check
  CHECK (status IN ('queued', 'assembling_dataset', 'preprocessing', 'interpreting_clusters', 'completed', 'failed'));

CREATE TABLE IF NOT EXISTS analysis_run_reviews (
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  inclusion_status TEXT NOT NULL CHECK (inclusion_status IN ('included', 'excluded')),
  exclusion_reason TEXT,
  normalized_text TEXT,
  preprocessing_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (analysis_run_id, review_id),
  CHECK (
    (inclusion_status = 'included' AND exclusion_reason IS NULL)
    OR (inclusion_status = 'excluded' AND exclusion_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS analysis_runs_project_created_idx ON analysis_runs(project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS analysis_run_reviews_status_idx ON analysis_run_reviews(analysis_run_id, inclusion_status, exclusion_reason, review_id);

CREATE TABLE IF NOT EXISTS review_signals (
  id TEXT PRIMARY KEY,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  label TEXT NOT NULL,
  normalized_aspect TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  emotion TEXT,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  quote_text TEXT NOT NULL,
  quote_start INTEGER NOT NULL CHECK (quote_start >= 0),
  quote_end INTEGER NOT NULL CHECK (quote_end >= quote_start),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  extractor_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(analysis_run_id, review_id, signal_type, normalized_aspect, quote_start, quote_end)
);

CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  theme_type TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  confidence TEXT NOT NULL,
  rank INTEGER NOT NULL,
  metrics JSONB NOT NULL,
  validation JSONB NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(analysis_run_id, theme_type, name)
);

CREATE TABLE IF NOT EXISTS theme_evidence (
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  signal_id TEXT NOT NULL REFERENCES review_signals(id) ON DELETE CASCADE,
  review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  evidence_strength DOUBLE PRECISION NOT NULL CHECK (evidence_strength >= 0 AND evidence_strength <= 1),
  is_representative BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(theme_id, signal_id)
);

CREATE TABLE IF NOT EXISTS voice_maps (
  analysis_run_id UUID PRIMARY KEY REFERENCES analysis_runs(id) ON DELETE CASCADE,
  artifact JSONB NOT NULL,
  synthesis_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS review_signals_run_type_idx ON review_signals(analysis_run_id, signal_type, normalized_aspect);
CREATE INDEX IF NOT EXISTS review_signals_review_idx ON review_signals(review_id, analysis_run_id);
CREATE INDEX IF NOT EXISTS themes_run_rank_idx ON themes(analysis_run_id, rank, id);
CREATE INDEX IF NOT EXISTS theme_evidence_review_idx ON theme_evidence(review_id, theme_id);

CREATE TABLE IF NOT EXISTS curation_sessions (
  id UUID PRIMARY KEY,
  analysis_run_id UUID NOT NULL UNIQUE REFERENCES analysis_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft', 'ready')) DEFAULT 'draft',
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS curation_actions (
  id UUID PRIMARY KEY,
  curation_session_id UUID NOT NULL REFERENCES curation_sessions(id) ON DELETE CASCADE,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'approve_theme', 'reject_theme', 'edit_theme', 'pin_evidence', 'exclude_evidence',
    'merge_themes', 'split_theme', 'mark_ready'
  )),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(curation_session_id, sequence)
);

CREATE INDEX IF NOT EXISTS curation_sessions_run_idx ON curation_sessions(analysis_run_id);
CREATE INDEX IF NOT EXISTS curation_actions_session_sequence_idx ON curation_actions(curation_session_id, sequence);
CREATE INDEX IF NOT EXISTS curation_actions_run_idx ON curation_actions(analysis_run_id, created_at, id);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE RESTRICT,
  curation_session_id UUID NOT NULL REFERENCES curation_sessions(id) ON DELETE RESTRICT,
  curation_revision INTEGER NOT NULL CHECK (curation_revision > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(analysis_run_id, version)
);

CREATE INDEX IF NOT EXISTS reports_project_generated_idx ON reports(project_id, generated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reports_run_version_idx ON reports(analysis_run_id, version DESC);
`
