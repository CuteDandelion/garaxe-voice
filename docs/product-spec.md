# Product Specification

Status: Baseline approved from supplied product conversation
Last updated: 2026-07-14

## Product promise

Turn customer-authorized feedback into an evidence-backed Voice Map that explains what customers feel, why they buy or object, which language repeats, and what the business should do next.

The product is `customer-language intelligence`, not generic sentiment analytics. Its strongest interaction is: click a strategic claim and immediately see the exact quotes, sources, counts, and confidence supporting it.

## Initial customer and wedge

Primary MVP customers are local and multi-location businesses whose public feedback is concentrated in Google Business Profile, plus agencies serving them. CSV/XLSX/JSON/paste import broadens coverage without making the product dependent on restricted provider APIs.

Later customers may include B2B SaaS, apps, e-commerce, and service organizations once G2, app-store, support, survey, and authorized partner connectors are viable.

## Jobs to be done

- Understand recurring praise, pain, desired outcomes, objections, and emotional movement.
- Compare locations and time periods without manually reading hundreds of reviews.
- Validate every conclusion against real customer language.
- Turn insight into an operational, marketing, product, or support action.
- Produce a polished, shareable Voice Map without decoding a raw analysis dump.

## MVP scope

1. Organization/project creation.
2. Google Business Profile OAuth connection and verified-location selection.
3. CSV/XLSX/JSON/paste imports with column mapping and validation.
4. Review inventory, cleaning summary, and analysis configuration.
5. Versioned analysis: signals, themes, evidence validation, metrics, and Voice Map synthesis.
6. Voice Map in editorial `Read` mode as the default project landing view.
7. Theme explorer, quote/evidence drawer, and source filters in `Investigate` mode.
8. Dedicated project-backed Pain Phrases, Desired Outcomes, Objections, and Emotional Triggers workspaces.
9. Human approve/reject/edit/merge/rename/pin workflow.
10. Immutable PDF/report snapshot.

## Explicitly deferred

- Yelp full-review import, automatic Capterra ingestion, and arbitrary competitor scraping.
- Continuous monitoring, alerts, Jira/Slack routing, revenue attribution, and CRM-dependent churn claims.
- LLM-expanded Copy Lab variants, real-time collaboration, public API, and white-label agency portals.

## Core flow

`Create project -> Connect/upload -> Select entities -> Inventory and quality check -> Configure objective -> Run analysis -> Read conclusions -> Inspect evidence -> Curate -> Publish report`

## Principal screens

- Project setup: asks what decision customer language should support.
- Sources: connections, entities, import/sync state, and review inventory.
- Voice Map: pain, outcomes, objections, triggers, differentiators, and opportunities.
- Theme Explorer: ranked editorial index leading into a detailed evidence-backed narrative.
- Evidence: searchable quotes with provider, entity, rating, date, language, theme, and confidence filters.
- Report review: curation status and immutable publication snapshot.

## Acceptance criteria

- A user can import feedback without conforming headers through a mapping step.
- A user can see included/excluded counts and reasons before analysis.
- Each theme has evidence count, representative quotes, source/entity distribution, and confidence.
- Each synthesized insight links to supporting themes; every supporting theme links to exact reviews.
- A user can correct machine output without the next run silently overwriting curation.
- Google OAuth success is distinguished from business-account, location, and review-access success.
- The UI remains usable at 390px width, keyboard-only, and with reduced motion.
- The desktop Voice Map Read view follows the governed hierarchy in `dashboard-primary-reference.png`, expressed through the live Garaxe design tokens rather than generic dashboard components.
- Evidence views show the full immutable source comment and highlight the exact matched span; an excerpt never replaces the source comment.
- The top evidence buckets are an accessible bubble field whose supporting-review count, category, focus, reduced-motion, and mobile behavior remain understandable without animation or color. Literal customer feedback belongs in the linked evidence drawer, not as a truncated bubble label.
- Published reports remain stable when new reviews arrive.
- Dedicated signal workspaces expose only their governed taxonomy and retain exact review traversal; they never substitute fixture claims for project analysis.

## Success measures

- Time from usable import to readable Voice Map.
- Percentage of published insights with reviewed evidence.
- Evidence-drawer open rate and insight approval/rejection rate.
- User-reported usefulness of recommended actions.
- Successful sync/import rate and analysis completion rate.
- Multi-location customers returning for comparison or a later run.

## Implementation status

### Slice 1 — Editorial Overview foundation

Implemented on 2026-07-12:

- React/Vite application shell derived from the governed dashboard reference.
- Responsive project rail, global bar, analysis tabs, editorial conclusion, primary-pain evidence, journey, recommended moves, and supporting-signal rail.
- Typed fixture model standing in for the future normalized analysis response.
- Functional evidence drawer, mobile project navigation, active section state, and the original JSON Voice Map export.
- Unit tests for evidence, navigation, and the original export interaction.
- Browser verification at the 1536x1024 reference viewport and a 390x844 mobile target.

At the conclusion of Slice 1, authentication/tenant isolation, provider OAuth, and managed PostgreSQL deployment remained open. Authentication, OAuth, and the managed database adapter were subsequently delivered in Slices 13–15; live managed deployment remains an external release gate. Slice 12 and the current application supersede the fixture JSON download: **Export Voice Map** now routes to immutable Reports, and application coverage asserts that route.

### Slice 2 — Project and CSV ingestion

Implemented on 2026-07-12:

- Lightweight project creation with a primary-decision field and immediate shell update.
- CSV file input plus deterministic sample dataset for evaluation and demos.
- RFC-style quoted-field handling, comma/semicolon detection, BOM removal, and multiline record support.
- Automatic mapping from common provider/export headers to the canonical import fields.
- Manual remapping with unknown columns preserved as metadata.
- Validation preview for written, rating-only, duplicate, invalid, and usable records.
- Explicit import-complete state and project-scoped confirmation.
- Responsive Sources workspace with a locally scrollable mapping table and no page-level mobile overflow.
- Unit and interaction coverage for parsing, detection, quality counts, sample import, real file input, and project creation.

### Slice 3 — Persistent projects and import jobs

Implemented on 2026-07-12:

- Disk-backed PostgreSQL-compatible local database with portable SQL schema.
- Persistent projects and idempotent default-project bootstrap.
- Server-authoritative asynchronous import jobs with queued, processing, completed, and failed states.
- Raw source-row retention with hashes and original row numbers.
- Normalized review storage with typed provider/entity/rating/text/date/reply fields and JSONB metadata.
- Project-scoped canonical deduplication and parameterized queries.
- Project, import-status, health, and normalized-review API resources.
- Frontend job polling and server-derived completion counts.
- Real API integration tests and full-stack browser verification.

At the conclusion of Slice 3, authentication, organization isolation, RLS, request/upload limits, malware scanning, durable multi-process queues, managed PostgreSQL, and backup/restore remained production work. Later slices delivered application authorization, organization isolation, the forced-RLS migration, bounded request bodies, and the managed-PostgreSQL adapter. Live managed deployment, file-specific validation/malware controls, durable external workers, and backup/restore operations remain paid-beta gates.

### Slice 4 — Persisted review inventory

Implemented on 2026-07-12:

- Editorial review inventory with dataset totals, written/rating-only distinction, responsive records, and provenance drawer.
- Server-backed search and provider, entity, rating, language, and feedback-type filters.
- Stable opaque cursor pagination with previous-page history in the client.
- Project-scoped summary breakdowns and review detail retrieval with raw source row, payload hash, import filename, and job identifier.
- Parameterized inventory queries and filter-oriented database indexes.
- API integration tests for filters, inclusive date boundaries, invalid parameters, multi-page cursor traversal, summaries, and provenance.
- Full-stack Browser proof from sample import to persisted inventory, written-only filtering, and provenance inspection with no console warnings or errors.

Subsequently delivered in Slices 5–6: analysis-run configuration, immutable dataset membership, preprocessing, data-quality reporting, and later review-detail authorization.

### Slices 5–6 — Immutable analysis runs and deterministic preprocessing

Implemented on 2026-07-12:

- Editorial analysis workspace for objective, evidence window, entity, rating, language, written-only, and minimum-text-length configuration.
- Immutable `analysis_runs` configuration snapshots and one persisted `analysis_run_reviews` membership decision per project review.
- Asynchronous run lifecycle with queued, dataset assembly, preprocessing, membership persistence, completed, and failed states.
- Unicode/whitespace normalization that never overwrites original customer text.
- Deterministic inclusion/exclusion precedence for rating-only, empty/short text, duplicates, unsupported language, date/entity/rating filters, conservative spam, and user exclusions.
- Exact, canonical-hash, and conservative near-duplicate grouping with canonical review references.
- Immutable quality reports with found/included/excluded counts, reason breakdowns, language distribution, text-length metrics, duplicate groups, and confidence band.
- Responsive completed-run report and inspectable included/excluded membership table.
- Full-stack proof from mixed CSV import through immutable analysis creation, written/rating-only separation, quality report, desktop presentation, and 390px responsive rendering.

Subsequently delivered in Slices 7–9: evidence-span extraction, aspect normalization, themes, validation metrics, and Voice Map synthesis.

### Slices 7–9 — Evidence signals, validated themes, and deterministic Voice Map

Implemented on 2026-07-12:

- Versioned deterministic signal extraction with exact original-text character offsets and stable review-local ordering.
- Conservative pain, praise, objection, outcome, service, purchase, emotion, feature, competitor, and aspect taxonomy covering core local-service and SaaS language.
- Persisted `review_signals`, `themes`, `theme_evidence`, and immutable `voice_maps` artifacts.
- Theme formation by signal type and normalized aspect with duplicate-independent support, prevalence, rating/entity/language/time breakdowns, confidence, and contradiction penalties.
- Evidence validation with configurable independent-review thresholds and explicit insufficient-evidence degradation.
- Template Voice Map synthesis that links every insight and recommendation to supporting theme IDs and never invents customer quotes.
- Live Read mode with conclusion, four strategic signals, customer language, and evidence-linked moves.
- Live Investigate mode with ranked themes, confidence, contradiction, breakdowns, and exact-evidence drawer.
- Full-stack proof from CSV import through run creation, signal/theme persistence, Read/Investigate navigation, and exact quote-to-original substring verification.

At delivery of Slices 7–9, extraction vocabulary was intentionally conservative and English-first, unsupported languages remained visible without fabricated interpretation, and optional model-based enrichment was still a future adapter.

Superseded on 2026-07-13 by Slice 18: production analysis no longer uses the governed keyword vocabulary or frequency rules as its theme source. Those modules remain only as historical regression fixtures while existing immutable runs retain their recorded versions.

The following slice adds the governed human-approval layer without changing the immutable machine run.

### Slices 10–11 — Human curation and publication readiness

Implemented on 2026-07-12:

- Curation sessions are idempotent per analysis run and retain append-only, revisioned action history.
- All eight governed actions are live: approve, reject, edit, pin evidence, exclude evidence, merge themes, split theme, and mark ready.
- Machine rows and the immutable synthesis artifact are never overwritten; the UI renders a derived effective-theme projection.
- Every validated machine theme must be approved, rejected, or consumed, and at least one theme must remain publishable before readiness can be recorded.
- Ready sessions reject further mutation. A later analysis run receives a separate curation session and cannot inherit prior decisions.
- The editorial analyst workspace exposes readiness, the ranked queue, machine-versus-curated comparison, exact evidence, and append-only activity.
- Ready curated projections replace rejected/edited machine claims in both Read and Investigate modes.

Subsequently delivered in Slice 12: immutable report snapshots and PDF export derived from a ready curation revision.

### Slice 12 — Immutable report snapshots and PDF export

Implemented on 2026-07-12:

- A ready curation revision can be published as a new, immutable, monotonically versioned report.
- Each `report-snapshot-v2` freezes the analysis configuration and quality counts, pipeline and model provenance, curation revision/readiness, LLM-powered executive brief, evidence-cited actions, deterministic chart aggregates, publishable themes, exact excerpts, and full source comments.
- Report history and detail APIs keep earlier revisions stable when reviews, runs, or curation state change later.
- The editorial Reports workspace creates, selects, previews, and downloads published revisions without reducing them to a generic table.
- The PDF renderer produces a warm, evidence-first A4 report with an executive brief, opportunities and risks, prioritized actions and success measures, theme/rating/timeline charts, approved themes, full customer comments, and methodology/provenance.
- API integration tests prove immutability across later imports and runs and validate the generated attachment as a real PDF.
- Full-stack Browser QA proves ready-revision publication, report inspection, clean console state, and a no-overflow 390px layout.

Subsequently delivered in Slices 13–15: authentication and organization isolation, managed PostgreSQL compatibility, and the customer-authorized Google Business Profile connector path.

### Slices 13–14 — Authenticated tenant boundary and Google connector readiness

Implemented on 2026-07-12:

- One-time first-owner setup closes after the first identity and binds legacy unowned local projects into that organization.
- Opaque sessions persist only SHA-256 token hashes; browser sessions use HttpOnly, SameSite=Strict cookies and API clients may use strict Bearer tokens.
- Owner, admin, analyst, and viewer memberships drive read/write authorization. Cross-tenant, insufficient-role, and nonexistent resources share the same concealed 404 response.
- Every implemented project, import, review, analysis, theme evidence, curation, report, and PDF route now authenticates and authorizes its owning organization.
- Project listing is membership-scoped, and project creation binds the new project to an authorized organization.
- The database boundary supports local PGlite or a `DATABASE_URL` PostgreSQL pool with tested parameterized queries, transactions, commit, rollback, and release.
- A Google Business Profile connector adapter supports injected server-only credentials, account and location discovery, complete per-location pagination, rating-only reviews, replies, timestamps, canonical normalization, safe errors, rate-limit metadata, and repeated-cursor protection.
- Contract tests cover authentication failures, cross-tenant concealment, token hashing/revocation, managed-database transactions, provider pagination, malformed payloads, 401/403/429/unavailable errors, and credential redaction.

Still required before production/provider claims: a production identity provider, managed migration/RLS execution, KMS-backed OAuth key management/rotation, Google API approval, a verified managed Business Profile, and live account -> location -> full reviews -> refresh/revoke proof.

### Slice 15 — Multi-format sources and connected Google ingestion

Implemented on 2026-07-12:

- CSV, real XLSX workbooks, JSON arrays/wrapped review collections, and pasted feedback share one mapping and validation experience.
- Original upload bytes/text, media type, encoding, and SHA-256 hash are retained separately from normalized rows; binary workbook conversion never replaces source provenance.
- Google Authorization Code + S256 PKCE uses organization/user-bound, expiring, single-use hashed state and encrypted server-confidential verifiers.
- AES-256-GCM envelopes protect access and refresh tokens at rest; token exchange, refresh-token preservation/rotation, remote revoke, and local disconnect are implemented without returning credentials.
- The Sources workspace distinguishes OAuth, Business Profile account, managed location, and review access, then persists discovered entities for explicit location selection.
- Selected locations are frozen into a nonsecret sync-job snapshot. Every review page is exhausted, exact raw provider payloads are retained, and written/rating-only/reply/timestamp fields enter the same canonical inventory.
- Provider/location/review identity makes re-sync idempotent while preventing equal review IDs from different locations from merging.
- A real protected HTTP integration test proves connection persistence -> discovery -> selection -> asynchronous sync -> normalized inventory using a deterministic provider contract server.
- First-run owner setup and loopback-only local session recovery keep the development MVP usable across restarts without creating a password endpoint that could accidentally ship to production.
- The public staging tier may use the separately gated access-key session route only when `GARAXE_DEPLOYMENT_TIER=staging`, `GARAXE_STAGING_AUTH_ENABLED=true`, the configured owner already exists, and a generated secret of at least 32 characters is present. This route does not satisfy the production identity-provider gate.
- Browser QA on a fresh server proves the current Sources bundle, paste mapping, Google configuration diagnostics, clean console, and no page overflow at 390px.

Live Google project approval, consent-screen verification, and proof against a real verified profile remain external release evidence, not synthetic-test claims.

### Slice 16 — Dedicated signal workspaces

Implemented on 2026-07-13:

- Pain Phrases, Desired Outcomes, Objections, and Emotional Triggers are first-class editorial workspaces rather than disabled navigation or aliases of the Overview.
- Each workspace reads the latest completed project analysis, applies the ready curated projection when available, filters only its governed theme taxonomy, and exposes exact evidence in a source-review drawer.
- Empty and insufficient-evidence states remain explicit; the UI never fabricates a signal to fill a section.
- The four routes reuse the Garaxe editorial hierarchy and collapse safely at mobile width.
- The shared shell derives review count, source count, analysis confidence, review date range, and active workspace title from the selected project rather than fixture constants.
- Application tests prove every route resolves to its project-backed workspace and that the unfinished standalone Evidence route remains disabled.

### Slice 17 — Evidence-backed Copy Lab

Implemented on 2026-07-13:

- Copy Lab generates deterministic homepage, advertising, email, and FAQ drafts from a selected validated theme and representative customer excerpt.
- Format and tone controls recompute locally, so the core workflow remains available with zero provider credentials, exhausted budget, or an open LLM circuit.
- Every draft displays its supporting theme, independent review count, confidence, and exact source excerpts; generated prose is never represented as a customer quotation.
- LLM-expanded variants remain gated behind the quota-aware queue and hybrid candidate-validation boundary.

### Slice 18 — Semantic analysis and Voice Map consolidation

Implemented on 2026-07-13:

- At delivery, production analysis used exact-offset sentence/clause segmentation, pinned `Xenova/multilingual-e5-small` ONNX q8 embeddings, deterministic spherical clustering, and dataset-derived c-TF-IDF-style cluster representation. Slice 24 subsequently replaced spherical assignment with the current polarity-specific mutual-KNN community graph, coherence gates, and explicit outliers; the remaining segmentation, embedding, and representation boundaries still apply.
- The run records model ID, immutable model revision, dtype, dimensions, segment count, cluster count, pipeline version, confidence, and the existing immutable review/signal/evidence relationships.
- Keyword/rule extraction is no longer called by the production run. Rules are reserved for preprocessing, deduplication, safety/negation validation, exact-span integrity, and evidence publication thresholds.
- Rating provides only the phase-one polarity/type prior. A later SetFit multi-label classifier may add pain, desired outcome, objection, praise, purchase trigger, operational issue, and emotion labels only after real analyst-curated training and benchmark approval.
- The evidence dialog renders the full original feedback, visibly marks the exact matched span, retains provider/entity/rating/date/language, and traverses to the source review.
- Overview was removed from navigation; Voice Map Read mode is the project landing surface. There was no independently addressable Overview URL in the current client, so no external route required migration.
- Top evidence buckets now shows at most the eight themes with the most independent supporting reviews. Each bubble displays the bucket name and review count; full feedback remains in the evidence drawer after selection. Bounded logarithmic sizing makes support differences visible, while low-velocity physics, boundary bounce, and pairwise collision resolution provide continuous but controlled movement. The field retains category colors and legend, focus/tap/keyboard evidence opening, paused interaction, reduced-motion static layout, semantic table fallback, and 390px behavior.
- Bucket names must be descriptive dataset-derived phrases, not isolated context tokens. The representation layer counts term support once per review and prefers supported multi-word concepts; label font size increases with bubble size.

### Slice 19 — Project switching and session exit

Implemented on 2026-07-13:

- Both desktop project controls list the projects authorized for the current organization and select the same active project; creating a project remains a separate explicit action.
- Selecting a project returns to its default Voice Map and clears project-scoped cursors, selected evidence, review pages, and import confirmation before loading that project's counts, dates, and analysis.
- The project rail renders the authenticated display name, email, and membership role from `/api/auth/me`; no sample identity is used in the signed-in workspace.
- An explicit Log out action calls the revoking server endpoint before returning to the protected local-session screen.
- Project switching remains available at narrow widths through the project-rail drawer, and all controls use native keyboard-accessible form elements.

### Slice 20 — Actionable root causes and date-window analysis

Implemented on 2026-07-13:

- The global date control opens an exact From/To evidence window and creates a new immutable analysis run; it never cosmetically filters an existing published result.
- The upper-right avatar opens authenticated account details, including the full email and role, plus the same revoking Log out action as the project rail.
- A pinned multilingual q8 ONNX sentiment classifier assigns clause-level positive, neutral, or negative polarity before clustering, so a mixed review can preserve both what worked and what failed.
- Long feedback is segmented into independently traceable clauses. Dataset-recurrent cause language such as an unanswered phone or an unclean restroom is named separately from consequences such as a leaked bag or a changed impression.
- Root-cause preference uses recurrence and general negation structure, not a food-industry theme dictionary; full consequence text remains available as evidence.

### Slice 21 — Root-cause cluster interpretation

Implemented on 2026-07-13:

- After deterministic evidence persistence, a run enters `interpreting_clusters` and enqueues bounded four-theme OpenCode Go jobs covering every validated evidence-backed theme, using all supporting feedback attached to each theme. Pain and praise themes are interleaved so early results remain balanced while the full queue drains asynchronously.
- The model returns a versioned candidate containing actionable aspect, praise/pain/mixed evaluation, root cause, consequence, confidence, and exact review spans. Root cause and consequence require their own supporting spans or must be `null`.
- The candidate validator rejects malformed JSON, unknown themes/reviews, incorrect offsets, and unsupported cause/consequence claims. Rejection, provider outage, missing configuration, timeout, or quota exhaustion leaves the deterministic artifact usable without pretending that partial model coverage is complete.
- Accepted candidates are visibly used for machine-workspace bucket names and summaries while retaining deterministic artifacts and requiring human curation before publication.
- Provider/model request and token capacities, refill rates, concurrency, output limit, and deadline are mandatory. Monetary budgets are opt-in and may be enabled only with a verified pricing contract; they are disabled by default for capacity-priced OpenCode Go so cumulative invented spend cannot stop complete analysis.
- A provider-compatible local compact-model fallback is documented for evaluation, not promoted. Any sub-500 MB artifact must pass the identical 100-record food, evidence, unsupported-claim, latency, memory, and analyst-preference gates.

### Slice 22 — LLM-first curation and full-feedback evidence

Implemented on 2026-07-13:

- A run does not become curatable until all cluster-interpretation jobs reach an accepted or explicit fallback terminal state.
- Validated `publish + keep` interpretation candidates supply the curation label, cause-first summary, evaluation, and signal type. Missing, discarded, or unresolved-split candidates remain outside an LLM publication-ready queue; deterministic names are used only when the run records the degraded deterministic engine.
- The persisted Voice Map engine identifies whether the run completed with `llm-interpreted-theme-engine-v1` or `deterministic-theme-engine-v1`, and the quality report records interpreted and fallback coverage.
- Curation evidence renders the complete immutable source feedback and visually highlights the exact supporting span instead of presenting a context-free fragment as if it were the review.

### Slice 23 — Live LLM analysis progress

Implemented on 2026-07-13:

- Clicking **Run analysis** keeps the Analysis workspace attached to the newly created immutable run through deterministic preparation and LLM cluster interpretation.
- During interpretation, the workspace polls persisted server state and reports completed/total jobs, remaining work, interpreted/validated theme coverage, active/waiting jobs, governed fallbacks, elapsed time, model identity, and a short run identity.
- Queue waits are identified as provider-capacity waits with automatic retries, so a slow model run is visible rather than appearing frozen.
- Reloading or returning to Analysis resumes monitoring the latest non-terminal run for the active project.
- The progress surface uses an accessible progressbar, remains readable at 390px, and disables its width transition under reduced motion.

### Slice 24 — Coherent semantic communities and bounded grouping review

Implemented on 2026-07-13:

- Forced centroid assignment is replaced by polarity-specific reciprocal K-NN similarity graphs with versioned coherence and independent-review gates.
- Weakly connected claims remain explicit outliers and cannot silently become machine themes.
- Every accepted semantic cluster shares one dataset-derived representation, preventing phrase-level fragmentation inside the same community.
- Analysis quality exposes cluster coverage, outliers, ambiguity count, engine version, and similarity floor.
- Deterministically ambiguous clusters reuse the existing LLM interpretation request for bounded `keep`/`split` advice; no additional API call is created. An unresolved split is quarantined with immutable evidence for a later adjudication workflow and cannot enter publication automatically.

### Slice 25 — Publication-quality gate and multi-label signal workspaces

Implemented on 2026-07-13:

- Cluster interpretation explicitly discards metadata, boilerplate, context-only clusters, and unrelated feedback joined only by repeated template language; every discard carries a bounded audit reason.
- Discarded machine output and exact evidence remain immutable and reproducible but do not appear in the Voice Map or Curation queue.
- Published interpretation candidates retain every evidence-backed signal type, allowing one primary pain or praise theme to also appear in Objections and Emotional Triggers.
- Regression evaluation includes surface-different paraphrases and shared boilerplate across unrelated topics; the intentionally templated game fixture cannot alone establish semantic quality.

### Slice 26 — Bluerose staging deployment enablement

Implemented in the repository and deployed to Bluerose staging on 2026-07-14. The bounded target evidence is recorded in `deployment-evidence/2026-07-14-bluerose-staging.md`:

- Production build definitions emit a Vite/Nginx web image and a compiled Node API image. The repository workflow publishes both to GHCR with immutable source-commit tags only after it runs on `main`.
- The API exposes process-only `/api/live` and database-aware `/api/health`, binds through explicit host/port configuration, closes listeners/database connections on termination, and uses an explicit PostgreSQL certificate policy.
- Both pinned ONNX revisions are downloaded during the API image build and runtime remote-model access is disabled. Python and ReportLab are pinned inside the same staging image for immutable report rendering.
- The Bluerose Kubernetes overlay defines a dedicated namespace, retained static PostgreSQL storage, one API/analysis replica, two web replicas, ClusterIP-only services, probes, resource envelopes, and default-deny network policy.
- The staging database is intentionally self-hosted on the single Bluerose node and therefore does not satisfy the managed-PostgreSQL, independent-backup, HA, or paid-beta restore gates.
- Cloudflare Tunnel publication occurs only after internal service verification and owner bootstrap. The existing Portfolio route and terminal 404 rule are protected dependencies.
- The staging owner is `test-user@example.com`; a generated access key lives only in Kubernetes Secret material and is never committed or returned by the session API.
- The live staging proof covers migration/RLS, owner closure, import through evidence-backed PDF, PostgreSQL and API restart persistence, dump/restore rehearsal, immutable-image rollback, public TLS, authenticated Cloudflare traversal, and Portfolio preservation. It does not close any paid-beta production gate.
