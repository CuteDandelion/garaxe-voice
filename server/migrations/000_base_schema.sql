
CREATE TABLE IF NOT EXISTS waitlist_signups (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email_normalized TEXT NOT NULL UNIQUE CHECK (char_length(email_normalized) BETWEEN 3 AND 254),
  consent_version TEXT NOT NULL CHECK (char_length(consent_version) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

ALTER TABLE themes DROP CONSTRAINT IF EXISTS themes_analysis_run_id_theme_type_name_key;

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
    'merge_themes', 'split_theme', 'create_custom_theme', 'move_evidence', 'restore_revision', 'mark_ready'
  )),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(curation_session_id, sequence)
);

ALTER TABLE curation_actions DROP CONSTRAINT IF EXISTS curation_actions_action_type_check;
ALTER TABLE curation_actions ADD CONSTRAINT curation_actions_action_type_check CHECK (action_type IN (
  'approve_theme', 'reject_theme', 'edit_theme', 'pin_evidence', 'exclude_evidence',
  'merge_themes', 'split_theme', 'create_custom_theme', 'move_evidence', 'restore_revision', 'mark_ready'
));

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



CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

-- Compatibility bridge for the current project schema. A managed-Postgres
-- migration can promote organization_id onto projects without changing the
-- authorization API below.
CREATE TABLE IF NOT EXISTS project_organizations (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memberships_user_idx ON organization_memberships(user_id, organization_id);
CREATE INDEX IF NOT EXISTS project_organizations_org_idx ON project_organizations(organization_id, project_id);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at DESC);


CREATE TABLE IF NOT EXISTS artifact_objects (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  import_job_id UUID REFERENCES import_jobs(id) ON DELETE SET NULL,
  report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('csv', 'pdf')),
  bucket_id TEXT NOT NULL CHECK (bucket_id IN ('voice-lab-uploads', 'voice-lab-reports')),
  object_path TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artifact_deletion_queue (
  id UUID PRIMARY KEY,
  artifact_object_id UUID NOT NULL UNIQUE REFERENCES artifact_objects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'deleted', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifact_objects_project_created_idx ON artifact_objects(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS artifact_deletion_queue_status_idx ON artifact_deletion_queue(status, scheduled_at);


CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash TEXT PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  encrypted_code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS google_oauth_states_expiry_idx ON google_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS google_business_connections (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connected_by_user_id UUID NOT NULL REFERENCES auth_users(id),
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  granted_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('authorization_required','connected','refresh_required','revoked','error')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (organization_id, project_id),
  FOREIGN KEY (organization_id, connected_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS google_connections_org_status_idx
  ON google_business_connections(organization_id, status);


CREATE TABLE IF NOT EXISTS google_business_entities (
  id UUID PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES google_business_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  account_external_id TEXT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('account', 'location')),
  name TEXT NOT NULL,
  selected BOOLEAN NOT NULL DEFAULT FALSE,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(connection_id, external_id)
);
CREATE INDEX IF NOT EXISTS google_entities_connection_type_idx
  ON google_business_entities(connection_id, entity_type, available, selected);

CREATE TABLE IF NOT EXISTS google_sync_job_entities (
  import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  google_entity_id UUID NOT NULL REFERENCES google_business_entities(id) ON DELETE RESTRICT,
  account_external_id TEXT NOT NULL,
  entity_external_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  PRIMARY KEY(import_job_id, google_entity_id),
  UNIQUE(import_job_id, entity_external_id)
);
CREATE INDEX IF NOT EXISTS google_sync_job_entities_job_idx
  ON google_sync_job_entities(import_job_id, entity_external_id);


CREATE TABLE IF NOT EXISTS llm_jobs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  routing_policy TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'queued','budget_wait','rate_wait','leased','running','succeeded','retry_wait',
    'dead_lettered','cancelled','fallback_completed'
  )),
  priority INTEGER NOT NULL DEFAULT 0,
  estimated_input_tokens INTEGER NOT NULL CHECK (estimated_input_tokens >= 0),
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens >= 0),
  requested_reservation_micro BIGINT NOT NULL CHECK (requested_reservation_micro >= 0),
  reserved_micro BIGINT NOT NULL DEFAULT 0 CHECK (reserved_micro >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_token_hash TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_leased_at TIMESTAMPTZ,
  retry_after TIMESTAMPTZ,
  last_error_code TEXT,
  result_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (organization_id, idempotency_key)
);

ALTER TABLE llm_jobs ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS llm_attempts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES llm_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('leased','running','succeeded','retry','failed','reclaimed')),
  error_code TEXT,
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  charged_micro BIGINT CHECK (charged_micro IS NULL OR charged_micro >= 0),
  usage_verified BOOLEAN,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS llm_budget_accounts (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','organization','project','run')),
  scope_id TEXT NOT NULL,
  limit_micro BIGINT NOT NULL CHECK (limit_micro >= 0),
  reserved_micro BIGINT NOT NULL DEFAULT 0 CHECK (reserved_micro >= 0),
  spent_micro BIGINT NOT NULL DEFAULT 0 CHECK (spent_micro >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(scope_type, scope_id),
  CHECK (reserved_micro + spent_micro <= limit_micro)
);

CREATE TABLE IF NOT EXISTS llm_budget_ledger (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES llm_jobs(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','organization','project','run')),
  scope_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('reservation','reconciliation','release')),
  reserved_delta_micro BIGINT NOT NULL,
  spent_delta_micro BIGINT NOT NULL,
  usage_verified BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, scope_type, scope_id, entry_type)
);

CREATE TABLE IF NOT EXISTS llm_rate_buckets (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_capacity BIGINT NOT NULL CHECK (request_capacity >= 0),
  request_tokens DOUBLE PRECISION NOT NULL CHECK (request_tokens >= 0),
  requests_per_second DOUBLE PRECISION NOT NULL CHECK (requests_per_second >= 0),
  token_capacity BIGINT NOT NULL CHECK (token_capacity >= 0),
  token_tokens DOUBLE PRECISION NOT NULL CHECK (token_tokens >= 0),
  tokens_per_second DOUBLE PRECISION NOT NULL CHECK (tokens_per_second >= 0),
  refilled_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(provider, model)
);

CREATE TABLE IF NOT EXISTS llm_concurrency_limits (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','provider_model','organization')),
  scope_id TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  max_in_flight INTEGER NOT NULL CHECK (max_in_flight >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(scope_type, scope_id),
  CHECK (
    (scope_type = 'global' AND scope_id = 'global' AND provider IS NULL AND model IS NULL AND organization_id IS NULL)
    OR (scope_type = 'provider_model' AND provider IS NOT NULL AND model IS NOT NULL AND organization_id IS NULL)
    OR (scope_type = 'organization' AND provider IS NULL AND model IS NULL AND organization_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS llm_provider_health (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  circuit_state TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  failure_threshold INTEGER NOT NULL DEFAULT 3 CHECK (failure_threshold > 0),
  cooldown_ms INTEGER NOT NULL DEFAULT 60000 CHECK (cooldown_ms > 0),
  half_open_in_flight BOOLEAN NOT NULL DEFAULT FALSE,
  opened_at TIMESTAMPTZ,
  next_probe_at TIMESTAMPTZ,
  last_outcome TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(provider, model)
);

CREATE INDEX IF NOT EXISTS llm_jobs_dispatch_idx
  ON llm_jobs(provider, model, state, available_at, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS llm_jobs_org_dispatch_idx
  ON llm_jobs(organization_id, last_leased_at, created_at);
CREATE INDEX IF NOT EXISTS llm_jobs_lease_idx ON llm_jobs(state, lease_expires_at);
CREATE INDEX IF NOT EXISTS llm_jobs_active_provider_idx
  ON llm_jobs(provider, model, lease_expires_at) WHERE state IN ('leased','running');
CREATE INDEX IF NOT EXISTS llm_jobs_active_org_idx
  ON llm_jobs(organization_id, lease_expires_at) WHERE state IN ('leased','running');
CREATE INDEX IF NOT EXISTS llm_attempts_job_idx ON llm_attempts(job_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS llm_budget_ledger_job_idx ON llm_budget_ledger(job_id, created_at);


CREATE TABLE IF NOT EXISTS demo_analysis_sessions (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  analysis_run_id UUID NOT NULL UNIQUE REFERENCES analysis_runs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS demo_analysis_sessions_expiry_idx ON demo_analysis_sessions(expires_at);
CREATE INDEX IF NOT EXISTS demo_analysis_sessions_created_idx ON demo_analysis_sessions(created_at);
