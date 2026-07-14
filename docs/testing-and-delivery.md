# Testing and Delivery

Status: Baseline
Last updated: 2026-07-14

## Test lanes

- Static: strict typecheck and the full npm dependency audit are wired in repository CI. Formatting, lint, and merge-blocking browser checks remain required pre-beta automation work and must not be reported as passing repository gates until scripts exist.
- Unit: import mapping, normalization, hashes, filters, metrics, confidence, permission policies.
- Integration: PostgreSQL migrations/RLS, OAuth callbacks with mocked providers, token encryption/refresh, connector pagination, job retry/idempotency, report snapshots.
- Analysis evaluation: fixed labeled dataset and regression thresholds.
- End-to-end: create project, import CSV/XLSX/JSON/paste or authorize selected Google locations, map/validate source data, run analysis, inspect evidence, curate themes, and publish an immutable report.
- Visual/accessibility: desktop and 390x844; keyboard; focus; contrast; reduced motion; drawer/dialog semantics; no horizontal overflow.
- Semantic quality/performance: 100-record unseen-domain fixtures, rerun stability, exact segment/evidence offsets, positive/negative cohort separation, recurrent root-cause representation, both pinned-model identities, cold/warm latency, and peak RSS on the 4 vCPU/8 GB target.
- Model interpretation: malformed JSON, unknown theme/review, bad offsets, unsupported root cause/consequence, duplicate theme, instruction-like review text, deterministic fallback, and comparative 100-record food evaluation.

## External connector testing

Separate connector tests from analysis fixtures. Google staging requires a real authorized verified Business Profile; never create fake businesses or public reviews. Mock provider failures locally and perform a read-only staging proof of account -> entity -> full-text reviews -> pagination -> refresh -> revoke.

## Local gates and automation status

The repository wires `npm run typecheck`, `npm test`, `npm run build`, `npm run build:server`, `npm audit`, Kubernetes rendering, and `./scripts/check-docs-sync.sh` into `.github/workflows/ci.yml`. CI provisions Python 3.11 and installs the pinned report-renderer requirements before integration tests so PDF coverage exercises the real renderer rather than relying on runner-global packages. The separate publication workflow builds Linux/amd64 web/API images and publishes only commit-SHA tags to GHCR on `main` or explicit dispatch.

The CI and publication workflows passed on GitHub for deployed source SHA `3aaddeacdd3d32e7ed49878b699778c84f209347`; the published Linux/amd64 GHCR images were anonymously pullable before rollout. There is still no lint/format script, merge-blocking browser E2E, scheduled provider smoke test, or automated complete-diff gate. The production image build also audits its smaller runtime-only dependency installation separately.

## Release strategy

Use migrations before app rollout, feature flags for new pipeline versions/connectors, and canary analysis runs. Retain the previous analysis version for comparison and rollback. Record release, pipeline, prompt, model, and schema versions on every run/report.

For Bluerose staging, verify in this order: render manifests; create nonsecret configuration and out-of-band Secrets; start PostgreSQL and prove retained storage; run the checksum migration Job; deploy the single API and two web replicas; bootstrap the configured owner; test upload/analysis/evidence/report/PDF and pod restart; only then add Cloudflare Tunnel/DNS. Rollback uses the previous application image SHA and restores the immediately preceding tunnel configuration without changing Portfolio.

That sequence completed on 2026-07-14. The exact bounded results, including restart, restore, rollback, Cloudflare, and Portfolio checks, are in `deployment-evidence/2026-07-14-bluerose-staging.md`; they are staging operations evidence, not paid-beta production evidence.

## Current MVP evidence

- CSV parser tests cover quoted text, canonical mapping, written reviews, rating-only rows, duplicates, and invalid ratings.
- UI tests cover sample import, actual browser `File` input, project creation and switching, authenticated identity, server-backed logout, evidence drawers, tab selection, and routing **Export Voice Map** to immutable project Reports instead of fixture JSON.
- Browser QA covers Sources start, mapping/quality preview, completion, project creation, console health, and mobile page-overflow checks.
- Server integration tests run against an isolated in-memory PostgreSQL-compatible database and prove project persistence, job completion, raw-row processing, normalized review counts, duplicate handling, invalid-row handling, and rating-only retention.
- Full-stack Browser QA runs through the Vite `/api` proxy against disk-backed local persistence and verifies server-derived completion with no console warnings/errors.
- Inventory integration tests cover every supported filter, inclusive date-only upper bounds, malformed query rejection, three-page cursor traversal, aggregate breakdowns, and raw provenance.
- Full-stack Browser QA verifies sample import -> persisted inventory -> written-only server filter -> provenance drawer, with zero browser console warnings/errors.
- Deterministic preprocessing has focused fixtures for selection filters, text preservation/normalization, exclusion precedence, spam, exact/hash/near duplicates, quality metrics, and confidence.
- Analysis API integration tests prove configuration validation, project scoping, complete membership persistence, immutable snapshots, quality reports, history/detail, membership filters, and invalid identifiers.
- Full-stack Browser QA verifies CSV import -> analysis configuration -> asynchronous immutable run -> completed quality report at desktop and 390x844, with no horizontal overflow or console warnings/errors.
- Signal fixtures prove exact substring offsets, repeated-phrase selection, mixed statements, negation, Unicode offsets, stable ordering, bounded confidence, natural setup/documentation/price variants, and rating-only safety.
- Theme fixtures prove deterministic clustering/ranking, duplicate-independent evidence, contradictions, breakdowns, thresholds, sparse-data honesty, and synthesis traceability.
- API integration proves persisted signal/theme/evidence/Voice Map relationships and re-validates returned quote offsets against original review text.
- Browser QA verifies import -> deterministic run -> Read -> Investigate -> exact evidence drawer on desktop and 390px, with zero console warnings/errors and no page overflow.
- Curation API coverage proves all eight actions, strict fields and run ownership, non-overlapping splits, idempotent sessions, readiness gates, append-only sequence/history, immutable machine artifacts, ready-session locking, and rerun isolation.
- Curation component coverage exercises readiness, queue, merge selection, accessible drawer focus, edit/split controls, and the activity trail.
- Full-stack Browser QA proves edit + evidence pin + approve/reject decisions -> readiness -> published curated Read/Investigate projection; the rejected theme is absent, the curated title is present, mobile has no horizontal overflow, and browser logs contain no warnings/errors.
- Report API coverage proves ready-only creation, monotonically increasing versions, frozen curation and evidence, stability after later imports/runs, project-scoped history/detail, and a valid `%PDF` attachment.
- Report component coverage exercises empty, loading, creation, selected revision, exact evidence, error, and PDF-download states.
- Full-stack Browser QA proves a ready revision can be published and inspected with frozen provenance and exact excerpts; desktop and 390px layouts remain overflow-free with no console warnings/errors.
- PDF delivery uses a deterministic `report-snapshot-v2` sample, extracts text, renders and inspects every page, and verifies typography, charts, action citations, full comments, page breaks, clipping, evidence attribution, and provenance before acceptance.
- `npm run evaluate:semantic` runs the pinned current-runtime embedding model against the pattern-diverse semantic gold set and fails on purity, recall, coverage, cross-topic-merge, or mixed-cluster-adjudication regressions.
- Auth tests prove one-way token storage, strict cookie/Bearer parsing, expiry/revocation, membership roles, authorized project/run/report traversal, and indistinguishable cross-tenant/insufficient-role/not-found responses.
- Full API integration proves unauthenticated rejection, organization-scoped project listing, and cross-tenant concealment through the real HTTP request path.
- Managed PostgreSQL adapter tests prove parameter forwarding, pool queries, transaction commit/rollback, and client release without requiring cloud credentials in local test runs.
- Migration tests apply the forced-RLS schema idempotently, verify all 22 tenant-owned tables and policies, and use a least-privilege role to prove tenant filtering plus same-tenant project creation. `databaseContext.test.ts` separately verifies that the application adapter injects identity through transaction-local `set_config` before protected queries.
- Google connector contract tests prove account/location pagination, complete review pagination, rating-only/reply/timestamp normalization, repeated-cursor protection, malformed payload handling, safe 401/403/429/unavailable errors, and no token/provider-body leakage.
- OAuth tests prove S256 PKCE, expiring single-use state, user/organization binding, encrypted/tamper-evident token envelopes, refresh rotation, revoke, safe provider failures, and database-atomic state consumption.
- Multi-format import tests parse a real rendered XLSX fixture plus CSV, JSON, and pasted lines, while asserting preserved original workbook bytes.
- Google sync tests prove discovery/upsert, cross-connection selection rejection, complete pagination, raw-payload equality, rating-only/replies/timestamps, idempotent updates, and location-aware identities.
- Protected HTTP integration proves account/location discovery -> selection -> queued Google sync -> written and rating-only canonical inventory without returning credentials.
- Automated axe scans cover the authenticated Voice Map landing, Pain Phrases, Outcomes, Objections, Emotional Triggers, Copy Lab, and Sources structures; color contrast remains a rendered/manual audit because JSDOM cannot calculate the rendered palette.
- API hardening integration proves defensive no-store/nosniff headers and configured request-body limits. Cookie-authenticated mutations reject origins that do not equal `GARAXE_ALLOWED_ORIGIN` when configured.
- Staging-auth integration proves the access-key route is absent outside the staging tier, rejects an incorrect key with a generic response, creates a normal opaque session for the configured owner, and never returns the key. AuthGate coverage proves staging uses this route while development retains loopback recovery.
- Every Vitest lane forces `GARAXE_DB_DIR=memory://` before server database initialization; the test suite must never truncate or mutate `.local/pgdata`.
- Browser QA on a freshly restarted server proves first-owner/local-session entry, the current multi-format Sources bundle, pasted mapping, safe missing-Google-config feedback, empty console logs, and no 390px page overflow.
- Durable LLM queue integration tests run concurrent lease attempts against global and provider/model caps, prove exactly one admission, assert no partial request/token debit on saturation, verify `leased` and `running` jobs count while expired leases do not, and demonstrate that a saturated organization cannot prevent a second organization from receiving available provider capacity.
- The 50-review OpenCode benchmark explicitly compares hybrid-model thinking modes. The Qwen no-thinking artifact records 5/5 completed batches, 76.5 s wall time, 90% precision/recall/F1, and 100% deterministic recovery from exact unique source quotations; supplied offsets remain independently scored. Current local cluster interpretation uses the evaluated no-thinking mode when that provider is configured.
- The current-schema pilot demonstrates why the output cap alone was insufficient: the original four-theme prompt produced 14 `length`-truncated batches, while `root-cause-first-v7-compact` accepted 12/12 candidates with 3/3 normal stops, 3,360 output tokens, and 21.8-second mean four-theme latency under the unchanged 1,800-token cap.
- A simultaneous two-request current-schema probe accepted 7/7 candidates in overlapping 22.2-second and 27.5-second calls, proving the selected endpoint can use the local two-call provider/organization concurrency without truncation.
- Analysis lifecycle tests prove a run waits in `interpreting_clusters` for active jobs, consolidates accepted/fallback coverage, and exposes the matching LLM or deterministic engine identity before curation can open.
- Analysis progress tests prove persisted queue counts become accessible completed/total, remaining, waiting, interpreted-theme, fallback, model, and run indicators immediately after **Run analysis**. Full-stack Computer QA verifies a real LLM run advances live at desktop and 390px without horizontal overflow.
- Curation contract and component tests prove validated interpretation labels are projected into the review queue while each evidence item retains the complete source feedback and highlights the exact immutable span.
- Semantic pipeline tests prove exact sentence/clause offsets, injected deterministic embedding contracts, reciprocal-neighbour clustering, coherent partitioning, independent-review gates, honest outliers, one representation per cluster, reproducible diagnostics, and malformed embedding rejection without downloading a model during local test runs.
- Grouping-assessment tests prove only deterministically ambiguous clusters may receive a bounded LLM split recommendation, ordinary clusters default to keep without extra fields, and the recommendation is visible to curators without mutating evidence membership.
- Publication-gate tests use unrelated product failures joined by identical session boilerplate and require an explicit, reasoned discard; surface-different objection and emotion labels must remain visible through multi-label workspace routing. The intentionally templated game fixture is adversarial coverage, not standalone semantic-accuracy proof.
- A warm pinned-ONNX calibration on the 100-review multilingual food fixture completed in 2.375 seconds, producing 261 contextual claims, 38 accepted communities, 160 clustered claims, and 101 explicit outliers. Manual inspection of every cluster meeting the existing three-review publication threshold found coherent topics; two-item coincidences remained below publication eligibility.
- Voice Map component tests prove full original feedback plus highlighted exact span, provider/entity/rating/date/language metadata, source traversal, keyboard bucket-bubble activation, descriptive bucket labels, supporting-review sizing, radius-scaled type, collision-safe motion fallback, and semantic table fallback. Browser/Computer QA must additionally verify perceptible motion, no overlap, pause, reduced motion, and 390px tap/readability.
- Workspace Browser QA selects a second authorized project, verifies both selectors and project-scoped content update together, signs out through the visible account action, and resumes through the loopback owner-email flow.
- Date-window Browser QA opens the global control, validates invalid ranges, creates a filtered immutable run, observes the new evidence count/period, and verifies the avatar menu exposes the authenticated email plus logout.
- OpenCode Go and any sub-500 MB local GGUF candidate run against the same frozen 100-record food batch. Promotion requires 100% exact-span validity, 0 unsupported cause/consequence claims, at least 90% schema-valid completion, analyst-preferred labels over the deterministic baseline, and recorded p50/p95 latency plus peak RSS.

The definitive release gate is `docs/paid-beta-readiness.md`. Synthetic connector and adapter tests establish code readiness, not provider approval or live deployment readiness.
