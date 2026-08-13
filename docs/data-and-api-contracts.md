# Data and API Contracts

Status: Implemented local MVP contracts with an explicitly labelled production target
Last updated: 2026-08-13

## Data layers

1. Raw provider record: unchanged payload, hash, import timestamps.
2. Canonical review: shared typed fields plus provider metadata.
3. Derived analysis: dataset membership, signals, themes, evidence, insights.
4. Presentation: curation and immutable report snapshots.

## Implemented relational model

The current schema is composed from the application-owned schema modules and contains:

- identity and tenancy: Supabase-managed `auth.users` for passwords/sessions; application-owned `auth_users`, `organizations`, `organization_memberships`, and `project_organizations` for profile and authorization; legacy `auth_sessions` only for unconfigured local QA;
- ingestion and review core: `projects`, `import_jobs`, `review_source_records`, `reviews`;
- analysis, curation, and reporting: `analysis_runs`, `analysis_run_reviews`, `review_signals`, `themes`, `theme_evidence`, `voice_maps`, `curation_sessions`, `curation_actions`, `reports`;
- Google acquisition: `google_oauth_states`, `google_business_connections`, `google_business_entities`, `google_sync_job_entities`;
- tenant-aware LLM operations: `llm_jobs`, `llm_attempts`, `llm_budget_accounts`, `llm_budget_ledger`;
- deployment-owned LLM control plane: `llm_rate_buckets`, `llm_concurrency_limits`, `llm_provider_health`.

This is the implemented local and managed-PostgreSQL model. Earlier proposed entities such as separate `connections`, `review_entities`, `insights`, `insight_themes`, `theme_overrides`, and `audit_events` are not current tables; their responsibilities are represented by provider-specific connector tables, immutable `voice_maps`, the curation event stream, report snapshots, and operational records. Add any future table only through a governed schema and migration change.

Use JSONB for raw payloads, provider-specific metadata, rare attributes, run configuration, and snapshot bodies. Promote fields to typed columns when they are frequently filtered, grouped, sorted, joined, constrained, or indexed.

`GET /api/analysis-runs/:runId/overview` and `GET /api/demo/analysis-runs/:token/overview` return `{status: ready|evidence_only, schemaVersion: overview-intelligence-v1, brief}` after normal tenant or token authorization. A ready brief contains `understood`, nullable `majorOpportunity`/`majorRisk`, exactly one sales implication, exactly one marketing implication, and three next actions. Every item has bounded text plus one to four existing effective-theme IDs. The 1,800-token request budget is local to this compact brief and does not alter the analysis-engine budget. The response never contains provider/model identity or generated counts/ranks. Unknown citations, incomplete actions, malformed JSON, disabled configuration, or provider failure produce `evidence_only` with `brief: null`; deterministic evidence remains available from the existing map/coverage contracts.

### Default LLM interpretation queue model

The approved provider-enrichment slice adds the following tenant-aware operational tables:

The current governed model work starts with bounded per-comment categorization under job kind `emerging_signal_interpretation`. Each accepted result becomes `review_signals.attributes.canonicalOutcome` and is the sole per-comment authority for Dashboard, Curation, and a newly created report snapshot. `semantic-taxonomy-v2-v22` permits exactly `pain`, `desired_outcome`, `objection`, `emotion`, or `other`; an explicit request or wanted result is desired outcome even when motivated by a current failure, while concrete friction described as frustrating remains pain unless the customer's own affect is the main signal. `other` requires bounded topic/label/proposed-type context and exact evidence but cannot create a dynamic public type. Sentiment is stored and projected independently as `positive`, `neutral`, or `negative`; it does not alter semantic type or recurrence. New praise semantics use `desired_outcome + positive` for stated achieved value and `emotion + positive` for generic affective praise. Legacy taxonomy-v1 values remain readable: `operational_issue` maps to pain, while historical `feature_request`, `purchase_trigger`, and `praise` retain their stored compatibility meaning. Existing immutable report snapshots are never backfilled or rewritten. The server rejects generic labels, omissions, unknown IDs, invalid taxonomy/version, and non-exact evidence; incomplete categorization fails the new run after bounded failed-batch splitting. After completeness, optional `candidate_pair_adjudication` jobs contain at most five server-selected fixed pairs and accept only `{pairId, sameTopic}` for every supplied pair. A true decision requires one specific operator intervention that addresses both comments; if the intervention differs for either comment, `sameTopic` is false. Pair output cannot change inclusion, candidate membership, counts, rank, readiness, access, expiry, or projection. Invalid or failed pair jobs default to separate emerging outcomes. Historical aggregate results remain read-compatible but are not executable runtime job kinds.

An analysis run remains in `interpreting_clusters` while required categorization or optional pair jobs are active. After canonical completeness, the server forms category-bounded candidate edges from immutable original feedback and pinned source-text embeddings. Exact normalized source duplicates are deterministic edges; every other eligible pair requires fixed-ID adjudication. Generated topic, label, aspect, and evidence cannot add or remove a candidate. A raw-eligible connected component with at most 16 complete pairs retains every qualifying edge; larger components retain only pairs whose endpoints rank each other in their stable top four eligible neighbors by similarity then pair ID. A trigger between deterministic components expands to their complete cross-pair set only when that set contains at most 16 pairs. Pair jobs batch five candidates and return only fixed-ID same-topic decisions. The server builds final groups, requires all cross-pairs to be compatible before combining components, replaces provisional themes transactionally, and creates a singleton for every ungrouped resolved comment. Stable IDs define themes; duplicate model labels may coexist. Quotes remain evidence and URLs provenance only.

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

## Canonical review boundaries

“Canonical review” names two related shapes at different boundaries; they must not be treated as one storage schema.

### Google connector DTO

The provider-normalized Google connector output uses application casing and still carries the raw provider payload for provenance at the connector/import boundary:

```json
{
  "provider": "google_business",
  "externalReviewId": "...",
  "entityExternalId": "...",
  "ratingValue": 4,
  "ratingScale": 5,
  "title": null,
  "bodyOriginal": "...",
  "language": null,
  "sourceCreatedAt": "2026-06-12T18:30:00Z",
  "sourceUpdatedAt": "2026-06-12T18:30:00Z",
  "replyBody": null,
  "replyUpdatedAt": null,
  "flags": {"ratingOnly": false, "deleted": false},
  "metadata": {"reviewerDisplayName": null, "reviewerProfilePhotoUrl": null},
  "rawPayload": {}
}
```

### Persisted canonical review

The `reviews` table stores the normalized cross-provider record: `id`, `project_id`, `source_record_id`, optional `external_review_id`, `provider`, `entity_name`, rating value/scale, title, immutable `body_original`, language, reviewer name, owner reply, source URL/time, `is_rating_only`, `canonical_hash`, metadata, and import time. The exact source row or provider payload and its hash remain in `review_source_records`; normalized analysis text belongs to the versioned `analysis_run_reviews` membership record rather than overwriting the review. The current table does not persist connector-only `sourceUpdatedAt`, `replyUpdatedAt`, or a deleted flag as first-class columns.

## Customer-facing import shape

Ship the forgiving template:

```csv
review_id,source,entity,rating,rating_scale,title,review_text,review_date,language,reviewer_name,owner_reply,source_url
```

Require at least review text or rating. Allow mapping arbitrary headers, preview 20 rows, preserve unmapped columns in metadata, normalize dates to ISO 8601, default rating scale to 5, detect language, generate missing IDs, and warn rather than fail for absent optional values.

The importer accepts original UTF-8 CSV only. It implements quoted and multiline parsing, comma/semicolon detection, BOM handling, alias detection, explicit map-or-exclude configuration, duplicate rejection by repeated external ID, normalized exact-text deduplication only when no external ID exists, rating validation against an explicitly mapped positive scale, ISO-date validation, raw-row persistence, source hashes, normalized review persistence, and server-authoritative completion counts. `review_id`, `source`, and `review_text` are required; `entity`, `rating` plus `rating_scale`, `title`, `review_date`, `language`, `reviewer_name`, `customer_id`, `context`, `owner_reply`, and HTTPS `source_url` are optional. Unknown columns never enter normalized metadata unless mapped to an allowlisted field; they must otherwise be excluded. Files are limited to 10,000 rows, 100 columns, and 10,000 characters per cell/comment. Demo adds its smaller row/byte limits. Validation happens before queue creation, so malformed input leaves no partial job or canonical dataset. Automated language detection remains future work; provided language values are retained.

`POST /api/demo/analysis-runs/:token/imports` appends a validated CSV to that token's current temporary project only after its current run completes. The transaction deduplicates existing external IDs before admission, rejects the whole file if its new unique rows exceed the remaining allowance, and creates no run for a duplicate-only retry. The initial Demo file remains 6–10 rows; later files may contain 1–50 rows. Accepting the 50th unique comment sets `quota.remaining=0` and `quota.resetAt` eight hours later. Before that exact instant further unique rows return `DEMO_CAPACITY_EXCEEDED`; at the boundary status returns `quota.freshDemoAvailable=true`, and unique appends to that exhausted token return `DEMO_SESSION_EXHAUSTED`. The browser checks status when its accessible countdown reaches zero, then `POST /api/demo/analysis-runs` creates a fresh token/project for the next allowance. Authenticated imports do not use this Demo quota.

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

### Implemented public waitlist API

- `POST /api/waitlist` accepts `{ name, email, consentVersion: "voice-lab-waitlist-v1" }` and returns `{ data: { status: "recorded" } }` for both first and duplicate submissions.
- `waitlist_signups` stores a generated ID, trimmed name, lowercase normalized unique email, consent version, and server creation timestamp. It is not an account or tenant-membership table.
- There is no public waitlist read endpoint. Invalid name, email, or consent returns `400`; request bodies are not logged.
- `GET /api/admin/waitlist?limit=25&offset=0` is a private application endpoint. It accepts limits from 1–100 and returns `{ total, limit, offset, items: [{ name, email, consentVersion, createdAt }] }` without internal IDs.
- Access requires a valid Supabase bearer whose verified claim email matches the pre-provisioned `auth_users.email` and the normalized server-only `VOICE_LAB_ADMIN_EMAILS` allowlist. Missing authentication is `401`; unprovisioned, mismatched, or non-admin identities are `403`. `user_metadata` is never consulted.
- `/api/auth/me` exposes only the derived `capabilities.waitlistMonitoring` boolean. The verified claim email itself remains server-internal. Migration 005 grants waitlist `SELECT` only to `voice_lab_api` while revoking direct `PUBLIC`, `anon`, and `authenticated` access.

## Production `/v1` API target (not yet implemented)

The following inventory is the aspirational production resource shape. It is not a statement that these `/v1` routes exist in the current Node API; the implemented routes are documented in the sections below.

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

The implemented membership record stores `review_id`, inclusion status, exclusion reason, normalized text, and preprocessing version while retaining the original review as the source of truth. Every implemented analysis route authenticates the session and authorizes the associated project or analysis run; mutation routes additionally enforce owner, admin, or analyst roles.

`POST /api/analysis-runs` always creates a new run. Processing reads the project's current review inventory, applies the run's persisted filters, and freezes one exact membership record per review; later imports can enter only a later run. Existing run membership, Curation history, and report snapshots remain immutable. `POST /api/demo/analysis-runs` instead creates a fresh isolated temporary project/run for only that submission; it has no append/combine contract.

### Implemented local MVP evidence and Voice Map API

- Completed analysis runs persist exact-span `review_signals`, ranked `themes`, `theme_evidence`, and one immutable `voice_maps` artifact.
- `GET /api/analysis-runs/:id/voice-map` returns the run, synthesis artifact, themes, metrics, validation data, and source-enriched evidence.
- `GET /api/themes/:id/evidence` returns exact quotes, offsets, original text, source dimensions, and representative status.

The hard invariant is `quote === original_text.slice(quote_start, quote_end)`. Signal, theme, extractor, synthesis, and pipeline versions are retained with their records.

Voice Map evidence responses include `originalText`, `quoteStart`, `quoteEnd`, `provider`, `entity`, `rating`, `sourceCreatedAt`, `language`, and `sourceUrl` where authorized. Presentation must render the full `originalText` and highlight the validated slice. Semantic signal attributes also retain segment ID, cluster ID, embedding model ID/revision/dtype/dimensions, and semantic pipeline version. Human decisions continue in the separate curation event stream.

`quality_report.semanticAnalysis` records `semantic-cluster-pipeline-v4`, `mutual-knn-cluster-v1`, every clustering parameter, segment/cluster/clustered/outlier/ambiguous counts, and per-cluster mean, weakest-member, reviewer-independence, and grouping-check diagnostics. `clusterStatus=unclustered`, split, and withheld remain internal grouping diagnostics for reproducibility and older stored runs. They do not become customer states: each valid retained signal receives bounded individual interpretation and appears in a recurring or emerging outcome.

### Implemented local MVP report API

- `POST /api/reports` accepts `{projectId, analysisRunId, title?}` and creates the next immutable project report revision only when the run's curation session is ready.
- `GET /api/projects/:id/reports` returns report metadata ordered by revision.
- Report snapshot dataset metadata includes the distinct source count for the frozen run; the UI must not infer total dataset sources only from evidence attached to approved themes.
- `GET /api/reports/:id` returns the frozen `report-snapshot-v2` dataset, version, curation, evidence-cited executive narrative and actions, chart aggregates, themes, and exact evidence including full original comments.
- `GET /api/reports/:id/pdf` renders that same snapshot as an `application/pdf` attachment; it does not re-read live themes or reviews.

Creating another report never updates an existing report row. The snapshot JSON is the rendering contract and preserves both curated output and machine provenance. Report narrative generation is one compact, no-thinking structured call capped at 1,200 output tokens; every action must cite frozen theme IDs. Provider absence, invalid JSON, or invalid citations activates an explicitly labelled `curated_interpretations` fallback rather than blocking the immutable snapshot.

### Implemented public same-engine demo API

- `POST /api/demo/analysis-runs` accepts one `feedback` string containing 6–10 newline-delimited comments. UTF-8 input is capped at 16 KB and each comment at 20–1,000 characters. It returns `202` with a high-entropy token, fixed `createdAt`/`expiresAt`, `retentionHours: 24`, and queued status only when the existing server-side interpretation policy is complete. Incomplete configuration returns `503 DEMO_ANALYSIS_UNAVAILABLE`; hourly capacity returns `429 DEMO_RATE_LIMITED`.
- One start inserts an isolated organization, project, import/source rows, reviews, one queued run, and one `demo_analysis_sessions` row, then invokes the same `processAnalysisRun` used by authenticated runs. The stored token is a SHA-256 digest; plaintext is returned once.
- `GET /api/demo/analysis-runs/:token` returns safe status and expiry, then sanitized recurring/emerging outcomes and a PDF URL after every retained comment has a valid individual engine category/topic/exact quote. Incomplete individual categorization returns a safe failed-demo result. The shared category-bounded planner may selectively adjudicate ambiguous fixed pairs; unresolved pairs remain emerging and never block completeness. Unknown/expired tokens return `404`. Public fields use neutral Voice Map language and never identify the provider.
- `GET /api/demo/analysis-runs/:token/pdf` renders `demo-report-v2`, returns `voice-map-demo-report.pdf`, and never inserts a curation, report, or download-history row. It sends `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, `Expires: 0`, and `X-Content-Type-Options: nosniff`.
- `GET /api/demo/analysis-runs/:token/curation` returns the existing curation projection with public source labels sanitized. `POST` accepts the existing validated curation actions, records actor `demo:<session-id>`, and returns the next projection. The token can write at most 50 actions; these rows are temporary and cannot address another run or authenticated workspace.
- `expires_at` is fixed at creation plus 24 hours. Startup cleanup and a one-minute sweep delete expired projects and organizations; cascades delete source records, reviews, runs, signals, themes, Voice Maps, queue jobs, and session rows. The PDF renderer removes its unique temporary file immediately in `finally`.
- Persistent downloads remain authenticated at `GET /api/reports/:reportId/pdf` and resolve only immutable stored snapshots.

### Implemented authentication and tenant contract

- `GET /api/auth/status` reports bootstrap availability only when an administrator has explicitly enabled provisioning; the public client never renders owner setup.
- `POST /api/auth/bootstrap` is absent unless `GARAXE_ADMIN_BOOTSTRAP_ENABLED=true`. During that administrator-controlled window it creates the sole initial owner and organization, closes on subsequent calls, and sets an HttpOnly SameSite=Strict session cookie.
- `GET /api/auth/me` returns the authenticated identity and memberships without credentials and is the only source for signed-in shell identity; `POST /api/auth/logout` revokes the server-side session before the client returns to its signed-out gate.
- `POST /api/auth/local-session` restores an existing owner by email only from loopback in non-production environments. It is an API-only developer compatibility endpoint, is never called or rendered by the public client, and is deliberately unavailable in production.
- With `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, the browser signs in through Supabase email/password auth and sends the access token to the same-origin API as `Authorization: Bearer`. The API verifies claims with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` and requires `sub`, `session_id`, and email. If that verified subject has no application profile, one server-side transaction creates the profile, `Personal workspace` owner membership, `Default project`, and project binding. Conflict-safe insertion makes repeat/concurrent login idempotent; later memberships are never inferred from login. Migration 007 grants insertion only to `voice_lab_api`, while RLS requires the transaction-local verified subject, exact personal-workspace name, and self-owner role; `anon` and `authenticated` retain no direct insert grant.
- The private artifact adapter uses the same public project URL/publishable key plus the user's bearer token—never a browser or server service-role key. Its planned CSV objects use `voice-lab-uploads/{organizationId}/{projectId}/imports/{importJobId}.csv`; PDFs use `voice-lab-reports/{organizationId}/{projectId}/reports/{reportId}.pdf`. `artifact_objects` records immutable location/hash/size/provenance metadata, and `artifact_deletion_queue` provides idempotent deletion admission. Direct Data API access to both metadata tables is revoked from `anon` and `authenticated`; the tenant-scoped API role owns metadata changes while Storage-object RLS permits organization reads and owner/admin/analyst writes. The current import route still retains uploaded source bytes in database rows and does not yet write customer uploads through this Storage adapter.
- `POST /api/auth/staging-session` is local-QA compatibility only. The browser calls it only with `VITE_LOCAL_QA_AUTH_ENABLED=true`, and the server returns 404 whenever `NODE_ENV=production`; missing Supabase production configuration fails closed rather than accepting an access key.
- All remaining `/api` resources require a cookie or strict Bearer session and resolve ownership through project -> organization membership.
- Session rows store token hashes, expiry, revocation, and last-seen time; plaintext session tokens are never persisted.

The compatibility table `project_organizations` avoids a destructive local migration while providing the project-to-organization ownership join used by application authorization. The managed migration chain begins with `000_base_schema.sql`, byte-equivalent to the seven existing runtime schema blocks in their established order; the runner no longer executes those blocks outside migration history, and managed application startup performs no DDL. Local migration 006 defines the dedicated non-bypass runtime LOGIN as a member of the existing non-login API role without embedding a password; it remains unapplied remotely. Migration 001 enables and forces RLS on all 22 tenant-owned tables; migration 003 separately forces RLS on the two artifact metadata/queue tables. Remote-verified migration 004 covers the remaining five server-only tables: `auth_sessions` and `demo_analysis_sessions` have no API-role policy, while `llm_concurrency_limits`, `llm_provider_health`, and `llm_rate_buckets` have an all-command policy only for `voice_lab_api`. It also revokes public/anonymous/authenticated EXECUTE on the eight `app_can_access_*` SECURITY DEFINER helpers and grants only `voice_lab_api`, preserving their use as RLS predicates. Live private-Storage rehearsal under the intended non-owner application role remains a paid-beta gate; a future direct `organization_id` migration is an optional simplification, not a prerequisite for current authorization.

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

Supported actions are `approve_theme`, `reject_theme`, `edit_theme`, `pin_evidence`, `exclude_evidence`, `merge_themes`, `split_theme`, `create_custom_theme`, `move_evidence`, `restore_revision`, and `mark_ready`. IDs are validated against the session's analysis run. A custom bucket may select any retained review currently present in that run's effective Curation projection or legacy unassigned evidence; selected signal IDs are removed from prior effective buckets before insertion so they remain exact-once. An emptied source theme remains in the effective audit projection but is omitted from actionable `machineThemes` and readiness counts until restore repopulates it. Cross-run IDs fail closed and split evidence groups cannot overlap. The action history stays append-only, while `restore_revision` recomputes the effective projection at the target revision; actions superseded before that target do not leak back into the restored view. User-curated projections expose actor/time/source provenance and remain distinct from machine outcomes. The visible Curation flow starts by reviewing one bucket, uses settled copy for accepted/edited state, places authenticated **Undo latest change** in Activity, and reveals rename, combine, and custom-bucket correction only in the selected context; the broader action API stays authorization-checked and auditable. A post-ready mutation reopens the draft; earlier reports stay frozen and the next ready state can produce a new version. These routes require an authorized owner, admin, or analyst for mutation.

`GET /api/analysis-runs/:runId/coverage` accounts for every immutable run member and returns its canonical exact-quote signal, topic, taxonomy-v2 type, orthogonal sentiment, linked outcome ID, and a neutral `interpretedBy` marker. Valid retained feedback maps to one customer-facing type (`pain`, `desired_outcome`, `objection`, `emotion`, or `other`); `other` retains bounded proposed-type context without changing public filters. Assignment precedes recurrence; deterministic similarity only proposes grouping after canonical persistence. Normal compact five-comment categorization jobs share the same queue and exact-span validator. Customer projection maps one supporting comment to `emerging` and repeated support to `recurring`; malformed or unsupported input is the only explicit error, with a bounded reason. Existing stored runs may still contain raw compatibility dispositions and taxonomy-v1 values for audit/replay; adapters preserve those historical values without rewriting immutable reports.

Preprocessing never removes a valid retained review merely because its exact text, canonical hash, or near-paraphrase resembles another distinct source record. It records `duplicateOfReviewId` and immutable duplicate-group diagnostics while every member remains included and eligible for individual categorization. Similar members may share an analytical outcome, but their source record IDs and exact evidence remain traceable. Repeated external IDs are import duplicates; normalized text can be the canonical deduplication key only for rows without an external ID. Demo imports derive each canonical hash from the generated per-row external ID and original text, so two submitted rows with the same wording remain separate retained records.

Current categorization admission normally batches five retained comments. Each completion covers every requested comment exactly once with canonical taxonomy-v2 type, orthogonal sentiment, bounded topic/label, and exact evidence. The queue exhausts bounded retry before only the failed batch recursively splits (`5 -> 2/3 -> 1`); terminal singleton failure fails the analysis. Categorization therefore requires 200 normal calls for 1,000 comments, 202 with one recovered parent, 208 when one batch reaches every singleton leaf, and 1,800 only under total degradation. Selective pair adjudication is additional and separately bounded: every qualifying edge is retained only inside raw-eligible connected components of at most 16 complete pairs; larger components retain only mutual stable top-four eligible neighbors. One trigger may expand a deterministic component cross-product through at most 16 pairs, and five pairs share one call, avoiding a blanket quadratic matrix.

## Error envelope

### Implemented local API

Most current errors return only stable `code` and safe `message` fields:

```json
{"error":{"code":"CONNECTION_PERMISSION_DENIED","message":"..."}}
```

Validated analysis-configuration failures may additionally include a bounded `details.reason`, and Google connector rate-limit errors may include `retryAfterSeconds`. The current server does not generate or return `request_id`.

### Production target

The production `/v1` target adds a request correlation identifier and may add bounded safe details:

```json
{"error":{"code":"CONNECTION_PERMISSION_DENIED","message":"...","request_id":"req_...","details":{}}}
```

Stable codes include `AUTHORIZATION_REQUIRED`, `TOKEN_EXPIRED`, `TOKEN_REFRESH_FAILED`, `CONNECTION_PERMISSION_DENIED`, `ENTITY_NOT_FOUND`, `PROVIDER_RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `IMPORT_MAPPING_INVALID`, and `ANALYSIS_INSUFFICIENT_DATA`.
