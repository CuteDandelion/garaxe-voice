# Data and API Contracts

Status: Proposed baseline
Last updated: 2026-07-13

## Data layers

1. Raw provider record: unchanged payload, hash, import timestamps.
2. Canonical review: shared typed fields plus provider metadata.
3. Derived analysis: dataset membership, signals, themes, evidence, insights.
4. Presentation: curation and immutable report snapshots.

## Minimum relational model

`organizations`, `users`, `organization_members`, `projects`, `connections`, `review_entities`, `review_source_records`, `reviews`, `analysis_runs`, `analysis_run_reviews`, `review_signals`, `themes`, `theme_evidence`, `insights`, `insight_themes`, `theme_overrides`, `reports`, `audit_events`.

Use JSONB for raw payloads, provider-specific metadata, rare attributes, run configuration, and snapshot bodies. Promote fields to typed columns when they are frequently filtered, grouped, sorted, joined, constrained, or indexed.

### Default LLM interpretation queue model

The approved provider-enrichment slice adds the following tenant-aware operational tables:

The first governed job kind is `cluster_interpretation`. Its `cluster-interpretation-v5` result is stored as a candidate inside the existing theme validation JSON, including label, aspect, evaluation, multi-label signal types, root cause, consequence, exact evidence references, confidence, provider/model, prompt/schema versions, an auditable `publish`/`discard` disposition, and a `keep`/`split` grouping assessment. A discard requires a bounded reason and removes the candidate from publication and Curation surfaces without deleting the immutable cluster or evidence. A split is valid only when deterministic diagnostics marked the cluster ambiguous; it remains quarantined with its evidence for later adjudication and does not enter the publication-ready Curation queue. For an LLM-synthesized run, a missing interpretation is also excluded rather than falling through to a deterministic label. The model supplies exact quote text and review identity; the server derives offsets from one unambiguous occurrence in immutable original text.

An analysis run remains in `interpreting_clusters` while any attached job is queued, leased, running, or retryable. Once all jobs are terminal, the server records interpreted and fallback counts, selects `llm-interpreted-theme-engine-v1` when at least one validated interpretation exists, and otherwise records `deterministic-theme-engine-v1` as the degraded presentation engine. Curation evidence includes the complete immutable review plus the trusted exact-span offsets.

`GET /api/analysis-runs/:runId` includes a derived `llmProgress` object whenever the run has interpretation jobs. It exposes total, queued, waiting, in-flight, succeeded, fallback, failed, completed, remaining, percentage, validated-theme count, interpreted-theme count, coverage, provider, model, and last-update time. These values are aggregated from persisted `llm_jobs` and `themes`; no browser-only counter is authoritative. The project run list attaches this detail only to active `interpreting_clusters` runs to avoid historical per-run queue scans.

- `llm_jobs`: immutable task input hash and routing snapshot, lifecycle state, priority, eligibility time, lease owner/expiry, attempt bounds, and accepted result reference.
- `llm_attempts`: append-only provider/model attempt, timing, sanitized outcome, retry classification, provider request identifier hash, and reported request/token usage.
- `llm_budget_accounts`: active integer-micro limits, reservations, and spend by `global`, `organization`, `project`, or `analysis_run` scope.
- `llm_budget_ledger`: append-only integer-micro reservations, releases, reconciliations, and conservative charges linked to one job/attempt.
- `llm_rate_buckets`: per provider/model request and token bucket state with capacity, refill rate, and observed reset.
- `llm_concurrency_limits`: deployment-owned global and provider/model caps plus organization-scoped in-flight caps. Each row is a transactional admission lock and stores only policy identity and `max_in_flight`.
- `llm_provider_health`: circuit state, consecutive failure counters, opened/reset times, and last sanitized provider outcome.

Secrets remain in the server secret store or encrypted connection boundary, not these tables. Prompt bodies and raw customer text remain in governed analysis storage; the queue stores references and hashes. All tenant-owned queue rows inherit application authorization and forced RLS.

`llm_jobs.idempotency_key` is a SHA-256 digest of organization, project, analysis run, task kind, canonical input hash, prompt version, output-schema version, and routing-policy version. Enqueue returns the existing compatible job when this key already exists. Only one successful result may be accepted and attached.

Job states are `queued`, `budget_wait`, `rate_wait`, `leased`, `running`, `succeeded`, `retry_wait`, `dead_lettered`, `cancelled`, and `fallback_completed`. State transitions and lease renewal are compare-and-set operations. Attempts are never overwritten.

The implemented worker runtime receives provider request construction, candidate acceptance, clock, jitter, and price calculation as injected boundaries. It never reads arbitrary prompts from queue rows. It leases and marks a job running before the provider call, accepts only the validator-governed candidate payload, and completes usage reconciliation in the same transaction that accepts the result. Provider/model health is deployment-owned control-plane state: it is not exposed through tenant APIs, and managed migrations revoke its tables from `PUBLIC`.

`llm_concurrency_limits` supports `global`, `provider_model`, and `organization` scopes. A missing row means that scope is uncapped; a configured value of zero pauses dispatch at that scope. During `leaseNext`, applicable policy rows are locked and active counts include only `leased`/`running` jobs whose lease has not expired. Saturation never decrements request or token buckets. The selected job receives deterministic `rate_wait`, `retry_after`, and a sanitized `CONCURRENCY_*` reason based on the earliest blocking lease expiry (or a one-second control-plane recheck when no active expiry exists). Organization saturation is skipped so another organization can use available provider capacity.

When verified-price spend enforcement is enabled, budget policy and ledger amounts use integer micros. A dispatch transaction reserves a configured worst-case amount at global, organization, project, and run scopes; completion reconciles actual provider usage and releases the remainder. Unverified usage consumes the full reservation, and configured limits are deny-by-default when they cannot be evaluated. A zero requested reservation explicitly means capacity-priced/unmetered dispatch: it creates no budget account or ledger mutation but still requires request/token bucket and concurrency admission.

## Canonical review

```json
{
  "id": "rev_...",
  "provider": "google_business",
  "external_review_id": "...",
  "connection_id": "conn_...",
  "entity_id": "entity_...",
  "rating_value": 4,
  "rating_scale": 5,
  "title": null,
  "body_original": "...",
  "body_normalized": "...",
  "language": "en",
  "source_created_at": "2026-06-12T18:30:00Z",
  "source_updated_at": "2026-06-12T18:30:00Z",
  "reply_body": null,
  "flags": {"rating_only": false, "deleted": false},
  "metadata": {}
}
```

## Customer-facing import shape

Ship the forgiving template:

```csv
review_id,source,entity,rating,rating_scale,title,review_text,review_date,language,reviewer_name,owner_reply,source_url
```

Require at least review text or rating. Allow mapping arbitrary headers, preview 20 rows, preserve unmapped columns in metadata, normalize dates to ISO 8601, default rating scale to 5, detect language, generate missing IDs, and warn rather than fail for absent optional values.

The MVP importer implements quoted and multiline CSV parsing, comma/semicolon detection, BOM handling, common-header detection, manual mapping, duplicate detection by external ID or normalized exact text, rating validation against each row's positive rating scale (default 5), parseable-date validation, written/rating-only counts, raw-row persistence, source hashes, normalized review persistence, and server-authoritative completion counts. Each job writes its raw records, canonical reviews, progress, and completion state in one transaction so a failed job cannot leave a partially imported dataset. Invalid rows remain preserved in raw source records but never enter canonical reviews. Automated language detection remains future work; provided language values are retained.

## Connector contract

```ts
interface ReviewProviderConnector {
  testConnection(): Promise<ConnectionTestResult>;
  listEntities(cursor?: string): Promise<EntityPage>;
  fetchReviews(input: FetchReviewsInput): Promise<ReviewPage>;
  refreshCredentials?(): Promise<void>;
  disconnect(): Promise<void>;
}
```

Capabilities explicitly describe full-text access, replies, pagination, incremental sync, refresh, and write access. OAuth success alone is not connector success.

## API resources

- `POST /v1/connections`; `GET /v1/connections/:id/callback`; `POST /v1/connections/:id/test`; `DELETE /v1/connections/:id`
- `GET /v1/connections/:id/entities`
- `POST /v1/review-syncs`; `GET /v1/review-syncs/:id`
- `POST /v1/imports`; `POST /v1/imports/:id/mapping`; `GET /v1/imports/:id`
- `GET /v1/projects/:id/reviews`
- `POST /v1/analysis-runs`; `GET /v1/analysis-runs/:id`
- `GET /v1/analysis-runs/:id/themes`; `GET /v1/themes/:id/evidence`
- `GET /v1/analysis-runs/:id/insights`; `POST /v1/themes/:id/overrides`
- `POST /v1/reports`; `GET /v1/reports/:id`
- `POST /v1/llm-jobs`; `GET /v1/llm-jobs/:id`; `POST /v1/llm-jobs/:id/cancel`
- `GET /v1/projects/:id/llm-usage`; `GET /v1/analysis-runs/:id/llm-usage`

Use cursor pagination. Long-running creation endpoints return `queued` resources. Never return stored credentials.

The LLM job create contract accepts a governed task kind and references an immutable analysis input; it never accepts arbitrary provider credentials, unrestricted prompts, tools, or callback URLs. Safe responses expose lifecycle, routing tier, estimated/reserved/actual integer-micro usage, retry eligibility, and fallback status, but not provider secrets, raw prompts, hidden reasoning, or customer text. Administrative budget-policy mutation is a separate privileged contract and is not delegated to project analysts.

Provider `429` responses map to `rate_wait` or `retry_wait`. `Retry-After` supports both delta seconds and HTTP dates and takes precedence over exponential backoff; otherwise use capped exponential backoff with full jitter. Provider/model buckets independently account for requests and estimated tokens before dispatch, then reconcile observed tokens afterward.

### Implemented local MVP inventory API

- `GET /api/projects/:id/reviews` returns `{items,nextCursor,hasMore}` and accepts `provider`, `entity`, `rating_min`, `rating_max`, `date_from`, `date_to`, `language`, `has_text`, `search`, `limit`, and opaque `cursor`.
- `GET /api/projects/:id/review-summary` accepts the same non-page filters and returns totals plus provider/entity/rating/language breakdowns.
- `GET /api/reviews/:id` returns the normalized review with its raw source record and import-job provenance.

These routes are local MVP contracts and now require organization authorization. A production `/v1` surface may preserve them behind the same ownership boundary.

### Implemented local MVP analysis API

- `POST /api/analysis-runs` freezes `{projectId, configuration}` and returns a queued immutable run.
- `GET /api/analysis-runs/:id` returns lifecycle, configuration, versions, counts, and quality report.
- `GET /api/projects/:id/analysis-runs` returns immutable run history.
- `GET /api/analysis-runs/:id/reviews` returns bounded dataset membership and accepts `inclusion_status`, `reason`, and `limit`.

The implemented membership record stores `review_id`, inclusion status, exclusion reason, normalized text, and preprocessing version while retaining the original review as the source of truth. Production authorization must scope every route to the authenticated organization/project.

### Implemented local MVP evidence and Voice Map API

- Completed analysis runs persist exact-span `review_signals`, ranked `themes`, `theme_evidence`, and one immutable `voice_maps` artifact.
- `GET /api/analysis-runs/:id/voice-map` returns the run, synthesis artifact, themes, metrics, validation data, and source-enriched evidence.
- `GET /api/themes/:id/evidence` returns exact quotes, offsets, original text, source dimensions, and representative status.

The hard invariant is `quote === original_text.slice(quote_start, quote_end)`. Signal, theme, extractor, synthesis, and pipeline versions are retained with their records.

Voice Map evidence responses include `originalText`, `quoteStart`, `quoteEnd`, `provider`, `entity`, `rating`, `sourceCreatedAt`, `language`, and `sourceUrl` where authorized. Presentation must render the full `originalText` and highlight the validated slice. Semantic signal attributes also retain segment ID, cluster ID, embedding model ID/revision/dtype/dimensions, and semantic pipeline version. Human decisions continue in the separate curation event stream.

`quality_report.semanticAnalysis` records `semantic-cluster-pipeline-v4`, `mutual-knn-cluster-v1`, every clustering parameter, segment/cluster/clustered/outlier/ambiguous counts, and per-cluster mean, weakest-member, reviewer-independence, and grouping-check diagnostics. Signals with `clusterStatus=unclustered` retain exact evidence and provenance but are excluded from machine theme formation.

### Implemented local MVP report API

- `POST /api/reports` accepts `{projectId, analysisRunId, title?}` and creates the next immutable project report revision only when the run's curation session is ready.
- `GET /api/projects/:id/reports` returns report metadata ordered by revision.
- Report snapshot dataset metadata includes the distinct source count for the frozen run; the UI must not infer total dataset sources only from evidence attached to approved themes.
- `GET /api/reports/:id` returns the frozen `report-snapshot-v2` dataset, version, curation, evidence-cited executive narrative and actions, chart aggregates, themes, and exact evidence including full original comments.
- `GET /api/reports/:id/pdf` renders that same snapshot as an `application/pdf` attachment; it does not re-read live themes or reviews.

Creating another report never updates an existing report row. The snapshot JSON is the rendering contract and preserves both curated output and machine provenance. Report narrative generation is one compact, no-thinking structured call capped at 1,200 output tokens; every action must cite frozen theme IDs. Provider absence, invalid JSON, or invalid citations activates an explicitly labelled `curated_interpretations` fallback rather than blocking the immutable snapshot.

### Implemented authentication and tenant contract

- `GET /api/auth/status` reveals only whether first-owner setup remains available.
- `POST /api/auth/bootstrap` creates the sole initial owner and organization, closes on subsequent calls, sets an HttpOnly SameSite=Strict session cookie, and returns a token once for non-browser clients.
- `GET /api/auth/me` returns the authenticated identity and memberships without credentials and is the only source for signed-in shell identity; `POST /api/auth/logout` revokes the server-side session before the client returns to its signed-out gate.
- `POST /api/auth/local-session` restores an existing owner by email only from loopback in non-production environments; it is deliberately unavailable in production.
- All remaining `/api` resources require a cookie or strict Bearer session and resolve ownership through project -> organization membership.
- Session rows store token hashes, expiry, revocation, and last-seen time; plaintext session tokens are never persisted.

The compatibility table `project_organizations` avoids a destructive local migration. The managed deployment should promote `organization_id` onto tenant-owned tables and add RLS after migration rehearsal.

### Google Business Profile connector boundary

The connector accepts a server-only access-token provider and injectable fetch implementation. It returns provider-neutral accounts, locations, capabilities, and canonical review DTOs while keeping raw payloads at the connector boundary for provenance. `listAllLocations` and `fetchAllReviews` exhaust cursors and fail on repeated cursors. Incremental sync and reply writes remain explicitly disabled until live contract proof.

Implemented resources:

- `POST /api/connections/google/start` creates tenant-bound single-use OAuth state and returns only Google’s authorization URL.
- `GET /api/connections/google/callback` validates the authenticated user, state, organization, and project before encrypted credential persistence, then redirects to the workspace.
- `GET|DELETE /api/projects/:id/connections/google` returns safe connection metadata or revokes/disconnects it.
- `POST /api/projects/:id/connections/google/probe` separately reports authentication, account, location, and review access.
- `GET|POST|PUT /api/projects/:id/connections/google/entities` lists, refreshes, and selects only locations owned by that connection.
- `POST /api/projects/:id/connections/google/sync` freezes selected locations and creates a normal asynchronous import job.

Upload imports send normalized CSV for mapping plus an `originalSource` envelope containing UTF-8 text or base64 binary content, original media type, and encoding. The server stores the original bytes and SHA-256 hash on the import job; `review_source_records` retain every exact row/provider payload.

### Implemented local MVP curation API

- `POST /api/analysis-runs/:id/curation-sessions` creates or returns the run's idempotent curation session.
- `GET /api/analysis-runs/:id/curation` returns immutable machine themes, effective curated themes, append-only actions, and readiness counts.
- `POST /api/curation-sessions/:id/actions` appends one validated action and returns the refreshed projection.
- `GET /api/curation-sessions/:id/actions` returns the ordered audit history.

Supported actions are `approve_theme`, `reject_theme`, `edit_theme`, `pin_evidence`, `exclude_evidence`, `merge_themes`, `split_theme`, and `mark_ready`. IDs are validated against the session's analysis run, split evidence groups cannot overlap, and a ready session is immutable. These routes require an authorized owner, admin, or analyst for mutation.

## Error envelope

```json
{"error":{"code":"CONNECTION_PERMISSION_DENIED","message":"...","request_id":"req_...","details":{}}}
```

Stable codes include `AUTHORIZATION_REQUIRED`, `TOKEN_EXPIRED`, `TOKEN_REFRESH_FAILED`, `CONNECTION_PERMISSION_DENIED`, `ENTITY_NOT_FOUND`, `PROVIDER_RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `IMPORT_MAPPING_INVALID`, and `ANALYSIS_INSUFFICIENT_DATA`.
