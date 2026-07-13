# Architecture

Status: Implemented local MVP with production adapters
Last updated: 2026-07-13

## Recommended system

A modular monolith plus one background worker is sufficient for the MVP:

```text
Web application
  UI + auth + projects + REST endpoints + report rendering
                  |
                  v
PostgreSQL + object storage
  tenant data + raw imports + normalized reviews + versioned analysis
                  |
                  v
Background worker
  sync + normalization + enrichment + extraction + clustering + reports
```

Production target: TypeScript web/API deployment, managed PostgreSQL, object storage for source files/report artifacts, and a durable Postgres-backed job queue. Keep deployment replaceable; do not couple domain logic to a hosting provider.

The current MVP uses React/Vite plus a Node HTTP API. PGlite provides the disk-backed local adapter; `DATABASE_URL` selects the tested node-postgres pool adapter with explicit transaction commit/rollback behavior. `npm run migrate` applies checksum-verified, advisory-lock-serialized SQL migrations. The first managed migration enables and forces row-level security on all 18 tenant-owned tables, adds tenant predicate indexes, and uses a transaction-local `app.current_user_id` set by the authenticated database wrapper. Opaque hashed sessions, organizations, memberships, role checks, and ownership authorization remain the first application boundary; RLS is the database backstop. A live managed migration rehearsal, durable multi-process workers, backups, and deployment remain release gates.

## Bounded modules

- Identity and tenancy: organizations, members, roles, project access.
- Connections: OAuth/token lifecycle and provider capability discovery.
- Ingestion: sync jobs, uploaded source rows, pagination, idempotency.
- Review core: entities, normalized reviews, authors, replies, deletion state.
- Analysis: run configuration, membership, signals, themes, metrics, insights.
- Curation: overrides, approvals, evidence pins, audit events.
- Reporting: immutable snapshots and export rendering.

## Stable boundaries

- Provider adapter -> canonical review object.
- Canonical review -> analysis dataset membership.
- Original text -> extracted evidence span.
- Signals -> themes -> insights -> report snapshot.
- Machine proposal -> explicit human override.

## Processing model

Long operations are asynchronous and idempotent. APIs create jobs and return identifiers; the UI polls or subscribes to progress. Each stage records version, start/end time, counters, and failure information. A failed stage can resume without duplicating reviews or discarding completed work.

## Data flow

1. Encrypt connection credentials.
2. Fetch provider pages and retain raw payload/hash.
3. Upsert canonical reviews by provider + entity + external ID.
4. Freeze analysis configuration and dataset membership.
5. Normalize/enrich without altering original text.
6. Segment exact evidence spans, embed them with a pinned ONNX int8 multilingual model, and form coherent mutual-nearest-neighbour communities while retaining weakly connected claims as outliers.
7. Represent clusters with c-TF-IDF-style literal phrases, derive phase-one rating priors, and validate themes/metrics.
8. Synthesize insights only from validated themes.
9. Apply human curation as a separate layer.
10. Publish immutable report snapshot.

## Implemented persistence slice

- `projects`: durable project identity and primary decision.
- `import_jobs`: queued/processing/completed/failed lifecycle and auditable counters.
- `review_source_records`: every uploaded row retained as JSONB with payload hash and original row number.
- `reviews`: provider-neutral normalized fields, metadata JSONB, rating-only state, and project-scoped canonical deduplication.
- Local API routes: health, create/list projects, create/read import jobs, and list normalized project reviews.
- The web app submits raw CSV plus approved mapping, polls the job resource, and trusts server counts for completion.

## Implemented identity and provider boundaries

- `auth_users`, `organizations`, `organization_memberships`, `project_organizations`, and hashed `auth_sessions` provide the current tenant boundary.
- One-time owner bootstrap closes after first use; browser sessions use HttpOnly SameSite=Strict cookies and API clients can use strict Bearer tokens.
- Google review acquisition is split into an OAuth/token lifecycle boundary and a connector adapter. The connector independently discovers accounts and locations, exhausts review pagination, and emits canonical records.
- Provider credentials stay server-side. Raw provider payloads stop at the connector/import boundary and do not leak into presentation contracts.

## Current job boundary

Import and analysis work is asynchronous but still scheduled inside the local API process. The domain operations are idempotent and versioned; paid deployment must move execution to a durable worker with retry, timeout, concurrency, and dead-letter controls without changing the job resources consumed by the UI.

The LLM lane now has a durable queue and a configured-by-default local worker attachment with leases, safe retry classification, exactly-once result/usage acceptance, deterministic fallback, and persisted circuit state. A run remains in `interpreting_clusters` while any attached LLM job is active and becomes curatable only after accepted or fallback terminal outcomes are consolidated. The local API polls this lane only when the provider key, selected model, request/token capacity, refill rates, concurrency, output limit, and deadline are explicit. Monetary budgets are a separate opt-in policy for providers with verified pricing. A production process supervisor and independently scalable worker fleet remain paid-beta gates.

The local semantic lane runs inside the existing asynchronous analysis job. It batches 32 segments per ONNX call, pins the embedding and multilingual segment-sentiment revisions and q8 dtype, and records both model/config identities on the immutable run. `mutual-knn-cluster-v1` builds polarity-specific cosine-neighbour graphs, retains only reciprocal edges above the versioned similarity floor, partitions chaining components by mean and weakest-member coherence, requires independent reviewers, and assigns `-1` to honest outliers. It records cluster coverage and diagnostics, and one representation is shared by every member of an accepted cluster. Deployment must package or prewarm both model caches and move analysis execution to the durable worker; HTTP request handlers never perform inference.

## Approved default model-interpretation boundary

OpenCode Go is approved as the first default LLM provider adapter. It interprets deterministic analysis artifacts; it does not replace dataset assembly, exact-span extraction, evidence validation, confidence calculation, curation, or publication. Every validated theme and all of its supporting feedback enter the model lane when the provider is configured. The deterministic path remains an explicit degraded mode when the provider is disabled or unavailable; it is not reported as equivalent to complete model coverage.

The attached task creates bounded four-theme root-cause-first interpretation jobs covering every validated theme, plus two bounded semantic scouts for explicit objection and emotion evidence. Theme jobs receive all immutable supporting feedback and deterministic coherence diagnostics. The resolver accepts `cluster-interpretation-v5` under `capacity-governed-routing-v6`. The no-thinking `root-cause-first-v9-publication-gate` prompt preserves the compact response budget, adds an auditable `publish`/`discard` decision for context-only or boilerplate clusters, and retains `keep`/`split` assessment only for clusters already flagged as ambiguous. This piggybacks on the interpretation request rather than creating extra provider calls. A discarded cluster remains immutable and traceable but is omitted from Voice Map publication and Curation; a split assessment is shown to the curator and cannot automatically rewrite membership. The server, not the model, derives exact offsets from unambiguous copied quotations. Published candidates remain in the machine validation layer and human curation controls final publication.

The provider boundary remains OpenAI-chat-compatible so an evaluated local `llama.cpp` endpoint can reuse the same queue, prompt, validator, and persistence contract. Local model size does not bypass promotion gates.

The implemented provider-independent validation boundary accepts only versioned candidate envelopes bound to a trusted organization, project, analysis run, and review membership. Type-specific labels are allowlisted, payload/count/field sizes are bounded, and evidence must be an exact original-text substring. A unique exact quote may repair incorrect provider offsets; missing or repeated ambiguous quotes are rejected. Validation returns new proposal objects and cannot mutate authoritative deterministic artifacts.

All provider calls pass through a durable PostgreSQL queue rather than executing in an HTTP request or directly inside an analysis stage. The queue owns:

- optional global, organization, project, and analysis-run monetary budget enforcement;
- per-provider/model request and token rate buckets;
- idempotency, leases, heartbeats, bounded retries, dead-lettering, circuit breaking, and deterministic fallback;
- append-only attempt and usage records without prompt bodies, customer text, credentials, or reviewer PII in operational logs.

Workers claim eligible jobs with `FOR UPDATE SKIP LOCKED`, apply bounded per-organization concurrency, and order work by priority plus age so one tenant cannot monopolize provider capacity. A lease has an expiry and heartbeat; an expired lease may be reclaimed safely because result acceptance and budget reconciliation are idempotent.

Concurrency admission is explicit control-plane policy at three independently configurable scopes: global, provider/model, and organization. `leaseNext` locks the applicable policy rows in a stable order, counts only unexpired `leased` and `running` jobs, and performs the admission decision before touching request/token buckets. A saturated global or provider/model scope returns no lease; a saturated organization is moved to `rate_wait` until the earliest active lease expiry and the same transaction continues to the next fair `SKIP LOCKED` candidate. Expired leases are reclaimed before counting. This keeps tenant fairness without allowing concurrent workers to oversubscribe a configured cap or partially consume provider quota.

When monetary enforcement is explicitly enabled, budget amounts are stored as integer micros, never floating point. Before dispatch, the worker reserves the worst-case configured cost at every applicable scope and atomically reconciles verified usage on completion. Missing or untrusted usage is charged conservatively at the reservation amount. For capacity-priced providers, a zero-reservation job bypasses monetary accounts but still must acquire request tokens, estimated token capacity, and every configured concurrency slot before dispatch.

The durable queue state machine is:

`queued -> budget_wait|rate_wait|leased -> running -> succeeded|retry_wait|dead_lettered|fallback_completed|cancelled`

Provider delivery is at least once; accepted results, budget ledger entries, and artifact attachment are exactly once through a stable idempotency key covering tenant, run, task kind, input hash, prompt/schema versions, and routing policy.

The implemented LLM worker runtime is a bounded adapter around this queue. Request construction and candidate validation are injected governed boundaries; the worker itself persists no prompt or raw provider completion. Provider/model circuit state is persisted separately from tenant jobs and permits only one half-open probe after cooldown. A process supervisor or external worker deployment may call the same `runOnce` contract without changing queue semantics.

## Scale posture

Optimize for 50-10,000 written reviews per project first. Batch work, use cursor pagination, and analyze changed records incrementally. Avoid microservices and Kubernetes until measured operational load requires them.

The semantic worker target is a comfortable 4 vCPU/8 GB deployment. Release budgets are <=2.5 GB peak worker RSS, <=180 seconds cold and <=45 seconds warm for 100 medium-length reviews, and no unbounded all-dataset tensor allocation. Ten-thousand-review operation requires chunked embedding persistence/incremental clustering before promotion.
