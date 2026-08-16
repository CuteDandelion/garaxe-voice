# Architecture

Status: Implemented local MVP with production adapters
Last updated: 2026-08-13

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

The current MVP uses React/Vite plus a Node HTTP API. Authenticated persistence uses local PGlite or node-postgres when `DATABASE_URL` is present; Demo always uses its separate expiring PGlite handle and never enters managed PostgreSQL. Managed startup performs no DDL. `npm run migrate` applies the checksum-verified, advisory-lock-serialized chain through 007: BASE, tenant RLS, Supabase Auth, artifact Storage, server-only hardening, private waitlist monitoring, the non-bypass runtime login, and verified first-login provisioning. The authenticated wrapper sets transaction-local `app.current_user_id`; migration 007 permits only `voice_lab_api` to insert that same subject's profile, exact `Personal workspace`, self-owner membership, `Default project`, and binding while direct Data API roles remain denied. The private Storage adapter uses the public project URL/publishable key with the verified user's bearer token and fixed tenant paths. RLS remains the database backstop; backups, distributed controls, and live Auth/Storage traversal remain operational gates.

Migration 001 enables and forces RLS on all 22 tenant-owned tables.

Local staging uses the supported `voice-lab-local` Supabase CLI Docker stack for Postgres/Auth/Storage/Data API. Its ignored `.env` contains loopback-only values; production remains managed Supabase plus Kubernetes server-only secrets. The local stack is stopped with `--no-backup` after proof so its containers, network, and test volumes do not persist. Import and analysis admission is server-owned: public Demo uses hashed-client hourly/active and global-active limits in its isolated PGlite store, while authenticated work uses one organization-scoped advisory-lock transaction across queued/processing imports and active analyses.

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
- Public landing/demo -> explicit AuthGate -> tenant-scoped persistent workspace.

The public root remains outside `AuthGate`; its Product, Examples, Resources, and About hashes identify sections in one document rather than separate routes, and only the explicit login transition mounts the existing session and tenant workspace. The demo is a separate unauthenticated orchestration boundary: a high-entropy token resolves only to one isolated temporary organization/project/import/run and its temporary curation ledger, never to authenticated project, Google, team, persistent curation, or Reports routes. Demo and authenticated Sources share the same original-CSV parser, alias suggestions, allowlisted map-or-exclude configuration, row preview, and server preflight; manual and converted formats never enter the queue. Validated CSV rows enter the same `processAnalysisRun` function and durable interpretation queue. Success requires complete valid individual categorization for every retained comment; the shared deterministic grouping and selective pair-adjudication boundary then produces recurring candidates while unmatched items remain emerging. Presentation reuses the full dashboard shell with sibling Overview and Voice Map sections plus token-scoped Curation, without exposing provider/model identity, destination, or credentials.

Overview reads the same effective Curation projection as Voice Map. A deterministic Signal Story assigns each saved review ID once, then derives feedback volume, topic-by-period counts, eligible raw mapped-rating trends on one consistent declared positive source scale, category balance, source mix, and timeline eligibility from saved evidence without normalizing or inverting source ratings; known provider aliases are grouped only for the visible source mix while stored provider values remain unchanged. Recurrence, coverage plumbing, exhaustive comments, ranked buckets, and bubble exploration stay in Voice Map/evidence. `/api/analysis-runs/:runId/overview` and the token-scoped demo equivalent may add an `overview-intelligence-v1` brief containing only grounded prose and known theme IDs. The bounded request asks for one sales implication, one marketing implication, and three short next actions within a 1,800-token call budget. Unknown IDs, missing citations, invalid shape, provider failure, or fewer than three grounded actions return `evidence_only`; counts, ranks, grouping, categories, exact evidence, and persistence remain outside the completion contract. Overview projects the canonical effective themes so those validated IDs remain working evidence links even for emerging singletons.

The deterministic artifact, Curation projection, and coverage resolve independently of the optional brief. Authenticated and Demo clients publish the saved evidence view first and then replace its preparing state when the brief resolves. The server deduplicates identical in-flight/completed brief requests by a SHA-256 digest over schema version, model, and complete grounded messages; any byte change invalidates reuse, failures are not retained, and the bounded cache holds at most 100 results.

Demo state is temporary rather than anonymous persistence. `demo_analysis_sessions` stores only a token digest and tenant/run references with a creation-fixed 24-hour expiry. The token serializes incremental imports into that one project; accepted unique rows append, duplicate retries do not create another run, and every non-empty append creates a new immutable run. The server derives a 50-comment allowance from accepted project reviews, starts an eight-hour cooldown at the 50th accepted row, and keeps that project closed. At the exact boundary the same visitor may create a fresh temporary project; the client countdown is presentation only and confirms availability against the server before offering that action. Demo curation reuses the same append-only session/action tables and projection code as authenticated curation, but token scope and a 50-action ceiling bound the public surface. A one-minute server sweep deletes expired projects and organizations; project cascades remove source, derived, and curation rows. Demo PDF bytes are generated on demand after successful interpretation and are not retained as Reports or download history.

Local browser automation may inject an in-memory Demo clock through the `handleRequest` test dependency and control it with a random per-process header token. The production entry point never constructs that dependency, and production mode ignores it and returns the ordinary not-found response for its test route. It changes only the clock used by existing server quota decisions; it never changes allowance arithmetic, project ownership, stored rows, or public admission policy.

## Processing model

Long operations are asynchronous and idempotent. APIs create jobs and return identifiers; the UI polls or subscribes to progress. Each stage records version, start/end time, counters, and failure information. A failed stage can resume without duplicating reviews or discarding completed work.

## Data flow

1. Encrypt connection credentials.
2. Fetch provider pages and retain raw payload/hash.
3. Upsert canonical reviews by external source ID; use normalized text as a deduplication key only when a source ID is absent, so matching text from distinct source records remains separate.
4. Freeze analysis configuration and dataset membership.
5. Normalize/enrich without altering original text.
6. Segment exact evidence spans, embed them with a pinned ONNX int8 multilingual model, and form coherent mutual-nearest-neighbour communities while retaining weakly connected claims as explicit outliers.
7. Interpret every valid retained signal through the shared queue and persist one canonical outcome (taxonomy version/type, bounded topic/label, confidence, and exact evidence).
8. For a later project run, reuse only content-hash and full-contract-compatible project embeddings, per-review outcomes, and canonical fixed-pair decisions. The guarded aspect candidate may instead reuse exact signal-span decisions keyed only by source content, controlled signal type, quotation, and offsets; mutable corpus-derived labels are excluded, while the separate compatibility key binds all pipeline/model/prompt/schema/embedding versions. It is active only when its explicit server flag and migration-008 tables are both present; missing or incompatible lineage sends the new immutable run through the established full review-level path. Reused decisions are linked to that run rather than mutating history.
9. Use deterministic similarity only to group canonical outcomes; project one-item outcomes as emerging and repeated outcomes as recurring while retaining internal clustering diagnostics. In the guarded aspect candidate, exact canonical signal-type/aspect identity is the fail-closed grouping authority, so sibling aspects from one review remain independently addressable and no vector-only merge or second semantic judge is introduced. Persisted pair decisions can satisfy only the same server-generated canonical pair IDs in the established path, and the unchanged complete-link grouping step remains authoritative there. Dashboard and Curation read the selected run's canonical records; a newly created report snapshots them without rewriting existing immutable reports.
10. Apply human curation as a separate touch-up layer with grouped/bulk defaults and progressively disclosed secondary actions.
11. Publish immutable report snapshot.

## Implemented persistence slice

- `projects`: durable project identity and primary decision.
- `import_jobs`: queued/processing/completed/failed lifecycle and auditable counters.
- `review_source_records`: every uploaded row retained as JSONB with payload hash and original row number.
- `reviews`: provider-neutral normalized fields, metadata JSONB, rating-only state, and project-scoped canonical identity. Repeated external IDs deduplicate; text-derived canonical identity is used only without an external ID.
- Local API routes: health, create/list projects, create/read import jobs, and list normalized project reviews.
- The web app submits raw CSV plus approved mapping, polls the job resource, and trusts server counts for completion.

## Implemented identity and provider boundaries

- Supabase Auth is the configured production credential/session issuer. A verified JWT `sub` is the sole onboarding identity: first login transactionally creates one application profile, one `Personal workspace` owner membership, and one `Default project`; repeat logins are idempotent and all later memberships remain separate. No unauthenticated or browser-authored identity can invoke this boundary.
- The Node API remains the sole product-data boundary, verifies bearer claims with the public URL/publishable key, sets `app.current_user_id` transaction-locally, and retains the existing forced-RLS authorization path. Hashed `auth_sessions`, bootstrap, and staging/local recovery remain unconfigured local compatibility paths only.
- Google review acquisition is split into an OAuth/token lifecycle boundary and a connector adapter. The connector independently discovers accounts and locations, exhausts review pagination, and emits canonical records.
- Provider credentials stay server-side. Raw provider payloads stop at the connector/import boundary and do not leak into presentation contracts.

## Current job boundary

Import and analysis work is asynchronous but still scheduled inside the local API process. The domain operations are idempotent and versioned; paid deployment must move execution to a durable worker with retry, timeout, concurrency, and dead-letter controls without changing the job resources consumed by the UI.

The LLM lane now has a durable queue and a configured-by-default local worker attachment with leases, safe retry classification, exactly-once result/usage acceptance, deterministic fallback, and persisted circuit state. The primary model is required server configuration; an optional distinct fallback model is also configuration, never a runtime literal. One transient primary failure may use that fallback immediately. If it is also transiently unavailable, the same idempotent job re-enters the durable queue using bounded `Retry-After` or capped exponential jitter, without splitting or creating another semantic job. Authentication, invalid-model, validation, schema, and local acceptance failures do not switch routes or back off. A run remains in `interpreting_clusters` while any attached LLM job is active and becomes curatable only after accepted or fallback terminal outcomes are consolidated. The local API polls this lane only when the provider key, selected model, request/token capacity, refill rates, concurrency, output limit, and deadline are explicit. Monetary budgets are a separate opt-in policy for providers with verified pricing. A production process supervisor and independently scalable worker fleet remain paid-beta gates.

The local semantic lane runs inside the existing asynchronous analysis job. It batches 32 segments per ONNX call, pins the embedding and multilingual segment-sentiment revisions and q8 dtype, and records both model/config identities on the immutable run. Preliminary `mutual-knn-cluster-v1` builds polarity-specific cosine-neighbour graphs, retains only reciprocal edges above the versioned similarity floor, partitions chaining components by mean and weakest-member coherence, and records honest outliers as internal diagnostics. Final customer grouping happens only after per-comment categorization, with the separate primary-category calibration described below. Deployment must package or prewarm both model caches and move analysis execution to the durable worker; HTTP request handlers never perform inference.

## Approved default model-interpretation boundary

OpenCode Go is approved as the first default LLM provider adapter. It returns one validated dominant customer signal per retained comment; deterministic clause siblings remain internal. After complete canonical persistence, it may adjudicate only server-selected ambiguous pairs by returning the supplied pair ID and a same-actionable-topic boolean. It does not replace dataset assembly, exact-span validation, candidate generation, deterministic group membership, curation, publication, counts, ranking, readiness, access, expiry, or projection. Complete per-comment interpretation is the model gate when configured. A failed optional pair adjudication keeps the pair separate; it never makes the run incomplete.

Every retained comment enters compact categorization through the same queue, admission, concurrency, worker, schema, and exact-span validator, normally in five-comment jobs. The engine is given fixed IDs and returns only `semantic-taxonomy-v2-v22` semantic type (`pain`, `desired_outcome`, `objection`, `emotion`, or `other`), orthogonal sentiment (`positive`, `neutral`, or `negative`), bounded label/topic, and exact evidence. An explicit request or wanted result is desired outcome even when a current failure motivates it; concrete friction described as frustrating remains pain unless the customer's own affect is the main signal. The canonical persisted result under `review_signals.attributes.canonicalOutcome` is authoritative across Dashboard and Curation and informs new report snapshots; deterministic code validates structure and grounding without prescribing semantic truth through keyword cues. `emergingInterpretation` and taxonomy-v1 values remain legacy read fallback. `other` stores bounded proposed-type context and exact evidence but cannot dynamically add a public type. Existing immutable reports are not rewritten. Completeness requires one valid canonical result per retained comment. The queue retries a failed batch within its bounded attempt budget and only then splits that failed batch (`5 -> 2/3 -> 1`); a terminal structural, evidence, or coverage failure fails the analysis rather than publishing a partial replacement.

After completeness validation, the server creates category-bounded candidate edges from immutable source text and pinned source-text embeddings. Exact normalized source duplicates group deterministically; other source-similar pairs above the calibrated candidate floor are ambiguous candidates. Generated topic, label, aspect, and evidence do not affect eligibility. Every qualifying edge is retained when its raw-eligible connected component contains at most 16 complete pairs; larger components retain only pairs whose endpoints rank each other in their stable top four eligible neighbors by similarity then pair ID. If a trigger connects deterministic components, the planner expands the complete cross-pair set only up to 16 pairs and queues those fixed pairs in batches of five for same-topic adjudication. A true decision requires naming one specific operator intervention that addresses both comments; if the intervention differs for either comment, the decision is false. The server still decides membership: components may join only when every cross-pair is compatible, so one accepted edge cannot create broad transitive membership. Rejected, invalid, timed-out, over-limit, or failed pairs remain separate emerging signals. Exact evidence remains grounding, source URLs remain provenance only, and stable theme IDs—not labels—define bucket identity. The server transactionally replaces provisional themes and projects every resolved comment exactly once.

Preprocessing's exact/hash/near-duplicate relationship is diagnostic, not a membership exclusion. Every valid distinct source record continues into the same categorization path; similarity may merge their outcomes while source IDs and exact spans remain separate. Demo rows use generated per-row external IDs in their canonical hashes, preserving repeated wording as distinct feedback just like authenticated imports with distinct external IDs.

The categorization-call envelope remains 200 normal five-item calls for 1,000 comments, 202 when one failed parent succeeds through its `2/3` children, 208 when one original batch reaches all singleton leaves, and 1,800 only when every batch fully degrades. Selective pair adjudication is additional and bounded separately: candidate generation retains every qualifying edge only inside raw-eligible connected components of at most 16 complete pairs, otherwise retains only mutual stable top-four eligible neighbors, expands a triggered deterministic-component cross-product only through 16 pairs, batches five pairs per call, and uses the same shared request/token/concurrency admission. It is not a blanket pairwise comparison.

The provider boundary remains OpenAI-chat-compatible so an evaluated local `llama.cpp` endpoint can reuse the same queue, prompt, validator, and persistence contract. Local model size does not bypass promotion gates.

The implemented provider-independent validation boundary accepts only versioned candidate envelopes bound to a trusted organization, project, analysis run, and review membership. Type-specific labels are allowlisted, payload/count/field sizes are bounded, and evidence must be an exact original-text substring. A unique exact quote may repair incorrect provider offsets; missing or repeated ambiguous quotes are rejected. Validation returns new proposal objects and cannot mutate authoritative deterministic artifacts.

All provider calls pass through a durable PostgreSQL queue rather than executing in an HTTP request or directly inside an analysis stage. The queue owns:

- optional global, organization, project, and analysis-run monetary budget enforcement;
- per-provider/model request and token rate buckets;
- idempotency, leases, heartbeats, bounded retries, dead-lettering, circuit breaking, and deterministic fallback;
- append-only attempt and usage records without prompt bodies, customer text, credentials, or reviewer PII in operational logs.

Workers claim eligible jobs with `FOR UPDATE SKIP LOCKED`, apply bounded per-organization concurrency, and order work by priority plus age so one tenant cannot monopolize provider capacity. A lease has an expiry and heartbeat; an expired lease may be reclaimed safely because result acceptance and budget reconciliation are idempotent.

Concurrency admission is explicit control-plane policy at three independently configurable scopes: global, provider/model, and organization. `leaseNext` locks the applicable policy rows in a stable order, counts only unexpired `leased` and `running` jobs, and performs the admission decision before touching request/token buckets. A saturated global or provider/model scope returns no lease; a saturated organization is moved to `rate_wait` and the same transaction continues to the next fair `SKIP LOCKED` candidate. The lease expiry is the safe stale-worker fallback, but a verified success, failure, fallback, or cancellation releases ownership and immediately makes matching concurrency waiters eligible to retry. Their next transactional lease attempt still enforces every cap, rate bucket, and idempotency boundary. Expired leases are reclaimed before counting. This keeps tenant fairness without leaving capacity idle or allowing concurrent workers to oversubscribe a configured cap.

When monetary enforcement is explicitly enabled, budget amounts are stored as integer micros, never floating point. Before dispatch, the worker reserves the worst-case configured cost at every applicable scope and atomically reconciles verified usage on completion. Missing or untrusted usage is charged conservatively at the reservation amount. For capacity-priced providers, a zero-reservation job bypasses monetary accounts but still must acquire request tokens, estimated token capacity, and every configured concurrency slot before dispatch.

The durable queue state machine is:

`queued -> budget_wait|rate_wait|leased -> running -> succeeded|retry_wait|dead_lettered|fallback_completed|cancelled`

Provider delivery is at least once; accepted results, budget ledger entries, and artifact attachment are exactly once through a stable idempotency key covering tenant, run, task kind, input hash, prompt/schema versions, and routing policy.

The implemented LLM worker runtime is a bounded adapter around this queue. Request construction and candidate validation are injected governed boundaries; the worker itself persists no prompt or raw provider completion. Provider/model circuit state is persisted separately from tenant jobs and permits only one half-open probe after cooldown. A process supervisor or external worker deployment may call the same `runOnce` contract without changing queue semantics.

### Current capacity and scale-out boundary

The authenticated product path owns the capacity model. Public-demo runs enter the same analysis and LLM queue; their 20-start rolling-hour limit, 16 KB/10-comment per-run ceiling, one-run project, and fixed expiry are additional anonymous-abuse controls, not a second engine or a substitute for tenant admission.

The current OpenCode policy permits two in-flight jobs globally, two for the configured provider/model, and two per organization. Its provider/model buckets permit a burst of two requests and 16,000 estimated tokens, refilling at 0.2 requests and 500 tokens per second; each job is capped at 1,800 output tokens and a 240-second deadline. Project and run are monetary-budget scopes when verified-price enforcement is enabled, not concurrency scopes. With the current capacity-priced policy, monetary enforcement is disabled, so project/run isolation, idempotency, immutable run identity, and the demo's one-run limit bound work without inventing a spend ceiling.

This is an architectural target for roughly 10–100 concurrently active users, not proof of 10–100 simultaneous analyses or provider calls. Excess LLM work queues behind the two-call ceiling with organization-aware fairness. The deterministic ONNX/import/PDF stages still execute from the API-attached analysis scheduler, and the LLM poller is attached to the API process even though queue state, leases, attempts, retries, circuit state, and accepted results are durable in PostgreSQL.

Scale out at measured queue-age or CPU saturation without changing either product engine: use managed PostgreSQL, move the existing idempotent analysis jobs to supervised workers, and run additional `runOnce` worker processes against the shared queue. Before raising worker count or provider limits, load-test representative 100/1,000-review runs and export queue oldest-age, active/expired leases, provider/model request-token saturation, retry/dead-letter, circuit, and fallback metrics with alerts. A guarded loopback-only development page may poll sanitized staging run, queue, model-call, fairness, CPU, and RAM measurements while those tests execute; it is omitted from the production browser build and its API is a production `404`. Production metrics and alerting remain required operational gates, and the repository does not yet prove sustained 10–100-user throughput.

## Bluerose staging topology

The repository-defined staging target is a single-node Kubernetes deployment behind the existing remotely managed Cloudflare Tunnel. Cloudflare terminates public TLS and routes `voicelab.elseform.tech` to the `garaxe-web` ClusterIP service. The former hostname remains an unadvertised rollback route until the candidate release and new-domain verification pass. The unprivileged web tier serves the Vite build and proxies same-origin `/api` traffic to `garaxe-api`; neither workload uses NodePort or LoadBalancer exposure.

The staging API remains one 4 vCPU/8 GiB-requested replica because import, semantic analysis, PDF work, and the attached interpretation poller are not yet fully externalized. `Recreate` prevents overlapping API owners during rollout. Two small web replicas may roll independently. PostgreSQL is a pinned image on a retained static host-backed volume with namespace-local access only. This topology proves deployment behavior but is not HA, managed PostgreSQL, an independent durable worker, or a paid-beta production architecture.

Application images use immutable Git commit tags. The API image contains the compiled server and migration entries, pinned ReportLab runtime, and prewarmed pinned ONNX model cache; runtime model downloads are disabled. A migration Job must complete before the API deployment is applied. Secrets are created out of band and referenced by name.

The web tier forces `index.html` to revalidate with `no-cache, no-store, must-revalidate`; fingerprinted Vite assets retain their immutable URLs. This prevents a browser-cached SPA shell from continuing to reference an obsolete product build after a rolling web deployment.

Bluerose model work uses the API-attached durable poller and a server-side OpenCode Go credential. Its staging NetworkPolicy permits public IPv4 TCP 443 while excluding private, local, test, and reserved networks because standard Kubernetes NetworkPolicy cannot select a provider FQDN. The application adapter owns the fixed provider base URL and users cannot supply arbitrary destinations. The recorded July deployment exercised the historical aggregate contract, not D-077's current per-comment-only source path. Production still requires fresh deployment proof, a domain-aware egress proxy or equivalent control, independent workers, and managed secret rotation.

`GARAXE_DATABASE_SSL_MODE=disable` is an explicit staging exception only for the NetworkPolicy-restricted in-cluster PostgreSQL hop. Production and external database connections default to certificate verification and may load a provider CA bundle. `NODE_ENV` remains `production` in staging so secure cookies and production-only route restrictions stay active.

## Scale posture

Optimize for 50-10,000 written reviews per project first. Batch work, use cursor pagination, and analyze changed records incrementally. Avoid application microservices and new Kubernetes complexity until measured operational load requires them. The Bluerose staging overlay is an explicit exception because an existing protected cluster and tunnel are the chosen deployment substrate; it does not justify production microservice decomposition.

The semantic worker target is a comfortable 4 vCPU/8 GB deployment. Release budgets are <=2.5 GB peak worker RSS, <=180 seconds cold and <=45 seconds warm for 100 medium-length reviews, and no unbounded all-dataset tensor allocation. Ten-thousand-review operation requires chunked embedding persistence/incremental clustering before promotion.
