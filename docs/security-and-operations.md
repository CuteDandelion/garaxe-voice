# Security and Operations

Status: Baseline
Last updated: 2026-07-14

## Data protection

- Enforce organization/project isolation in application authorization and forced PostgreSQL RLS for every tenant-owned table.
- Encrypt OAuth refresh tokens and API credentials with envelope encryption; separate key management from the database.
- Request the minimum viable provider scope and keep the product read-only until write features are explicitly designed.
- Never expose tokens to the browser after callback completion or log credential payloads.
- Minimize reviewer PII; retain display identity/profile links only when necessary and policy-permitted.
- Support retention periods, project deletion, credential revocation, and deletion verification.

## OAuth protections

Use Authorization Code + PKCE, exact redirect allowlists, signed/expiring state bound to user/project/provider, nonce where applicable, refresh-token rotation handling, and explicit reconnect/revoke states. The test result distinguishes authentication, identity, entities, full-text review access, pagination, and refresh.

The current first-owner/session implementation is not a public password identity provider. Public bootstrap closes after the first user; session tokens are 256-bit random values stored only as SHA-256 hashes and delivered to browsers in HttpOnly, SameSite=Strict cookies. Google OAuth state is hashed, expiring, single-use, organization/user/project-bound, and paired with S256 PKCE. Access/refresh tokens and PKCE verifiers use AES-256-GCM envelopes; production must move the envelope key to managed KMS with rotation. Production must place the app behind TLS, add CSRF protection if cookie-authenticated state-changing requests cross same-site assumptions, integrate a supported identity provider, and define session rotation/recovery.

The local session-recovery endpoint accepts only loopback connections when `NODE_ENV` is not `production`; production receives the same 404 as an absent route. It exists solely to keep a local MVP usable after restart and must never be enabled as an internet-facing login mechanism.

The Bluerose demo has a separate staging-only recovery boundary. `/api/auth/staging-session` is enabled only by the exact staging tier plus feature flag, accepts only the configured existing owner, requires a generated secret of at least 32 characters, compares a SHA-256 digest in constant time, and returns a generic authentication failure. The key lives in Kubernetes Secret material, is never returned, and must be rotated if exposed. This is not invitation, account recovery, MFA, or a production identity provider; those paid-beta gates remain open.

## Import and model safety

Treat uploaded files and review text as untrusted. Enforce file size/row limits, safe parsing, formula-injection protection on exports, MIME/content validation, and malware scanning where required. Review text is data, never instruction; prompts delimit it and model tools are unavailable during extraction.

OpenCode Go receives only the minimum review fields required for an approved enrichment task and only after provider terms, data-processing location, retention, and training-use controls are documented. Do not send reviewer names, profile URLs, source credentials, owner replies, or unrelated metadata unless an explicit governed task requires them. Provider secrets remain server-side and must be redacted from errors, telemetry, dead-letter payloads, exports, and support tooling.

Each cluster-interpreter prompt contains a bounded batch of validated theme identifiers, current machine labels/types, deterministic coherence diagnostics, and the exact evidence spans plus original text needed to validate them. Review content is delimited JSON and declared untrusted data. A model may recommend splitting only a cluster already marked ambiguous; that recommendation cannot move evidence or bypass human curation. A local OpenAI-compatible endpoint is subject to the same payload minimization, fixed model allowlist, artifact checksum, no-tools policy, output bounds, and evidence validator; binding a local server must not expose it beyond the trusted deployment network.

Model calls have no tools, network callbacks, or authority to mutate reviews, themes, curation, reports, budgets, or credentials. Treat all output as untrusted candidate data. Enforce output-schema size/depth limits, exact evidence spans, tenant/run ownership, taxonomy allowlists, and unsupported-claim rejection before persistence.

The local ONNX embedding model is non-generative and cannot become an evidence authority. Pin its artifact revision/dtype, verify cache integrity at deployment, prohibit arbitrary per-request model IDs or URLs, bound segment length/batch size/runtime memory, and keep model-cache writes outside tenant-controlled paths. Customer text remains data and the only evidence is the immutable review plus validated offsets.

Queue authorization is tenant-scoped. Request/token buckets plus global, provider/model, and organization concurrency are mandatory deployment control-plane policy. Monetary budgets are a separate opt-in policy: only privileged administrators may request organization/project limits, and analysis workers may reserve and reconcile but may not increase them. Integer-micro reservations and append-only usage/audit events prevent floating-point drift when spend enforcement is enabled; zero-reservation capacity-priced jobs never write fake monetary ledger entries.

## Operations

Monitor sync success, provider latency/rate limits, queue depth, stage duration, retries, analysis cost, unsupported-claim evaluation, and report generation. Define alerts for stuck jobs, token-refresh spikes, tenant-isolation failures, and provider contract drift.

For LLM work, monitor queue depth/age by tenant and task kind, active/expired leases, request/token bucket saturation, budget reservations versus reconciled cost, retry and dead-letter rates, circuit state, fallback rate, schema rejection, exact-span rejection, and unsupported-claim rate. Alert on sustained oldest-job age, repeated lease expiry, ledger imbalance, budget overrun, provider authentication failures, circuit-open duration, and any secret/PII detection in logs.

Rate control is dual-dimensional per provider/model: request capacity and estimated/observed token capacity, plus global and per-organization concurrency ceilings. Respect `Retry-After` delta seconds or HTTP dates. Backoff is capped exponential with full jitter and a configured maximum attempt count. Dead-letter records retain sanitized classification and hashes, never raw prompt/customer text.

Circuit breakers open per provider/model after a configured consecutive/transient failure threshold, reject dispatch during the cool-down period, and permit a bounded half-open probe. Provider outage, open circuit, deadline expiry, retry exhaustion, or an explicitly enabled verified-price budget must terminate in a recorded degraded mode rather than masquerade as complete model analysis.

The implemented circuit record persists `closed`, `open`, or `half_open`, a consecutive-failure count, threshold, cool-down deadline, and a single half-open in-flight claim. `429` responses respect quota scheduling but do not count as provider-outage circuit failures. Transport/eligible provider failures do; authentication and missing-model failures are non-retryable. Provider health, rate buckets, and concurrency limits are deployment control-plane tables, revoked from `PUBLIC`, and are not exposed through tenant APIs. Queue admission locks these policy rows and counts unexpired active leases before quota debit, preventing concurrent workers from bypassing caps or consuming tokens for work that cannot dispatch.

Usage and audit events record organization, project, run, task kind, routing-policy/prompt/schema versions, provider/model identifiers, timestamps, reserved/reconciled integer micros, request/token counts, result disposition, and sanitized failure class. They never record credentials, raw review text, reviewer PII, full prompts, or hidden model reasoning.

The local API defaults request bodies to 5 MiB, marks JSON responses `no-store` and `nosniff`, marks PDFs private/no-store, and avoids logging raw exception messages. When cookie authentication is used with `GARAXE_ALLOWED_ORIGIN`, state-changing requests must match that exact origin. Distributed rate limits, edge CSP, durable audit logging, and managed observability remain deployment gates.

The Bluerose staging origin uses only ClusterIP services. Cloudflare Tunnel is the sole public path, and the route must be appended without altering Portfolio or the terminal 404 fallback. Namespace default-deny policy permits Cloudflare-to-web, web-to-API, API/migration-to-PostgreSQL, required DNS, and API-to-public-IPv4 TCP 443 for the authorized OpenCode Go adapter. Private, local, test, and reserved networks are excluded from that HTTPS rule. Standard Kubernetes NetworkPolicy cannot restrict by provider FQDN, so the fixed server-owned provider URL and absence of user-controlled destinations are compensating staging controls; production requires domain-aware egress enforcement. Google credentials remain absent and Google live use remains gated.

The 2026-07-14 rollout followed that order: Cloudflare configuration version 46 preserved Portfolio and the terminal 404, then added Garaxe; the new proxied CNAME and authenticated public traversal were re-read and verified. See `deployment-evidence/2026-07-14-bluerose-staging.md`. This evidence does not replace managed edge policy, monitoring, or incident-response gates.

## Current local persistence boundary

PGlite is used only as the local MVP database adapter. It is excluded from Git under `.local/`, creates its parent directory explicitly, and uses parameterized queries for user values. `DATABASE_URL` selects the node-postgres pool adapter. The versioned migration enables and forces RLS across all 22 tenant-owned tables; policies derive access through organization membership and the authenticated adapter supplies `app.current_user_id` only with transaction-local `set_config`. A least-privilege-role integration test proves cross-tenant filtering and permitted same-tenant project creation. Production still requires applying and negatively testing this migration against the chosen managed service/runtime role, plus distributed rate limiting, structured audit logging, backup policy, and a durable external job runner.

Bluerose staging uses a pinned PostgreSQL 16 image and a retained 50 GiB host-backed volume on the single node. Because the static hostPath provisioner creates a root-owned volume directory, a one-shot init container creates only the exact `pgdata` subdirectory with UID/GID 999; that init step runs as root with only `CHOWN` added after dropping all capabilities, while the long-running PostgreSQL container remains non-root. The in-cluster hop explicitly disables PostgreSQL TLS only while NetworkPolicy confines it to the namespace. External or paid-beta PostgreSQL defaults to certificate verification and may load a private CA bundle. The deployment rehearsal produced a custom-format dump, restored it into a disposable database with matching bounded counts, and copied it off Bluerose. That one-time staging artifact is not a managed backup policy, and the single-node volume is neither managed storage nor disaster recovery.

## Current PDF rendering boundary

The local API passes only a server-owned immutable snapshot to a fixed renderer script and never accepts a command, script path, output path, or template from the browser. The subprocess is replaceable infrastructure, not a public execution surface. Production should run it in a resource-limited worker with bounded snapshot size, timeouts, isolated temporary storage, dependency pinning, and redacted failure logs. A downloaded PDF inherits the report's reviewer-data retention and access-control requirements.

The staging API image pins ReportLab, runs as a non-root user with a read-only root filesystem, and provides only a size-limited temporary volume. PDF isolation into an external durable worker remains a paid-beta requirement.

## Provider/legal boundary

The MVP uses customer-authorized connections and uploads. Provider terms, storage/retention rights, reviewer display requirements, and data-processing roles require legal review before production launch. No arbitrary scraping or redistribution is authorized by these specifications.
