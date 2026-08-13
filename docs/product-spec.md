# Product Specification

Status: Baseline approved from supplied product conversation
Last updated: 2026-08-13

## Product promise

Turn customer-authorized feedback into an evidence-backed Voice Map that explains what customers feel, why they buy or object, which language repeats, and what the business should do next.

The product is `customer-language intelligence`, not generic sentiment analytics. Its strongest interaction is: click a strategic claim and immediately see the exact quotes, sources, counts, and confidence supporting it.

## Initial customer and wedge

Primary MVP customers are local and multi-location businesses plus agencies serving them. A documented CSV-only import contract provides the customer-controlled acquisition boundary without depending on restricted provider APIs.

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
3. CSV-only imports with alias detection, explicit include/exclude mapping, row preview, and validation.
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
- Both Demo and authenticated uploaders show one concise schema hint, a downloadable template, a collapsed field reference, per-column mapping, a row preview, and actionable validation errors. Continue remains disabled until feedback ID, source, and comment text are mapped and every other source column is mapped or explicitly excluded.
- A user can see included/excluded counts and reasons before analysis.
- Each theme has evidence count, representative quotes, source/entity distribution, and confidence.
- Each synthesized insight links to supporting themes; every supporting theme links to exact reviews.
- A user can correct machine output without the next run silently overwriting curation.
- Google OAuth success is distinguished from business-account, location, and review-access success.
- The UI remains usable at 390px width, keyboard-only, and with reduced motion.
- The desktop Voice Map Read view follows the governed hierarchy in `dashboard-primary-reference.png`, expressed through the live Garaxe design tokens rather than generic dashboard components.
- Evidence views show the full immutable source comment and highlight the exact matched span; an excerpt never replaces the source comment.
- The top evidence buckets are an accessible bubble field whose supporting-review count, category, focus, reduced-motion, and mobile behavior remain understandable without animation or color. Literal customer feedback belongs in the linked evidence drawer, not as a truncated bubble label.
- The field shows at most ten outcomes ordered by feedback count descending with stable `themeId` ascending ties.
- Each category panel selects its highest-support matching outcome using review count descending with stable `themeId` ascending ties.
- Category cards with no matching retained signal use category-specific empty copy; absence is not presented as a validation failure.
- Every valid retained signal receives one canonical, evidence-backed semantic type and useful topic before recurrence is considered. `semantic-taxonomy-v2-v22` is exactly `pain`, `desired_outcome`, `objection`, `emotion`, and `other`; an explicit request or wanted result is desired outcome even when motivated by a current failure, while concrete friction described as frustrating remains pain unless the customer's own affect is the main signal. `other` has bounded proposed-type context, not a new filter. Sentiment is independently `positive`, `neutral`, or `negative`, never a semantic category or recurrence state. Similarity helps grouping only; it is never a visibility gate.
- Customer-facing outcomes are recurring or emerging. All use full-color filled bubbles on one monotonic bounded square-root count scale; count is the only recurrence encoding. Malformed or unsupported input is the only explicit error state.
- Curation is a touch-up workflow over grouped engine proposals. Review a bucket is the single primary action; accepted or edited buckets use truthful settled-state copy, while exact evidence and the contextual rename/combine/custom-bucket correction flow appear after selection. Authenticated **Undo latest change** is contextual to Activity, and restore projects the effective target revision rather than replaying superseded historical edits into the current view. Broader authorized actions remain auditable without becoming an always-visible toolbar. Users are not required to categorize retained feedback one comment at a time.
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
- Validation preview for written, rating-only, repeated-ID/no-source-ID text duplicates, invalid, and usable records; identical text attached to distinct source IDs remains usable.
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
- Project-scoped canonical identity and parameterized queries: reject repeated external IDs, and use normalized-text deduplication only when no source ID exists.
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
- Deterministic inclusion/exclusion precedence for rating-only, empty/short text, malformed/unsupported language, date/entity/rating filters, conservative spam, and user exclusions. Similarity alone does not exclude a valid retained record.
- Exact, canonical-hash, and conservative near-duplicate grouping with canonical review references as diagnostics; every distinct valid source record remains included and categorized.
- Immutable quality reports with found/included/excluded counts, reason breakdowns, language distribution, text-length metrics, duplicate groups, and confidence band.
- Responsive completed-run report and inspectable included/excluded membership table.
- Full-stack proof from mixed CSV import through immutable analysis creation, written/rating-only separation, quality report, desktop presentation, and 390px responsive rendering.

Subsequently delivered in Slices 7–9: evidence-span extraction, aspect normalization, themes, validation metrics, and Voice Map synthesis.

### Slices 7–9 — Evidence signals, validated themes, and deterministic Voice Map

Implemented on 2026-07-12:

- Versioned deterministic signal extraction with exact original-text character offsets and stable review-local ordering.
- Conservative pain, praise, objection, outcome, service, purchase, emotion, feature, competitor, and aspect taxonomy covering core local-service and SaaS language.
- Persisted `review_signals`, `themes`, `theme_evidence`, and immutable `voice_maps` artifacts.
- Theme formation by signal type and normalized aspect may merge similar distinct records analytically while retaining every contributing source record and exact span, with prevalence, rating/entity/language/time breakdowns, confidence, and contradiction penalties.
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

- Deployment/admin-only first-owner provisioning closes after the first identity and binds legacy unowned local projects into that organization; the public client exposes accessible `Log in` and `Join waitlist` tabs, never owner setup. Waitlist submission requires name, valid email, and explicit consent; it stores one normalized-email record and returns the same success for duplicates. It never creates an identity, membership, session, or access entitlement. Private monitoring shows count and paginated contact/consent/time records only to a verified, provisioned Supabase profile whose normalized email is present in the server-only admin allowlist; no browser metadata can grant access.
- Opaque sessions persist only SHA-256 token hashes; browser sessions use HttpOnly, SameSite=Strict cookies and API clients may use strict Bearer tokens.
- Owner, admin, analyst, and viewer memberships drive read/write authorization. Cross-tenant, insufficient-role, and nonexistent resources share the same concealed 404 response.
- Every implemented project, import, review, analysis, theme evidence, curation, report, and PDF route now authenticates and authorizes its owning organization.
- Project listing is membership-scoped, and project creation binds the new project to an authorized organization.
- The authenticated database boundary supports local PGlite or a `DATABASE_URL` PostgreSQL pool with tested parameterized queries, transactions, commit, rollback, and release. Demo always uses a distinct temporary PGlite handle, retains fixed expiry, and shares queue processing without reading `DATABASE_URL`.
- Managed bootstrap is fully versioned: `000_base_schema.sql` preserves the exact seven existing runtime schema blocks in their required order, and a fresh Supabase-compatible local database applies BASE -> 001 -> both existing 002 files -> 003 -> 004 -> 005 -> 006 -> 007 without hidden schema execution; managed application startup performs no DDL. Remote migration 007 adds only the RLS-constrained first-login insert boundary after the dedicated runtime role.
- The Supabase cutover boundary includes private CSV/PDF Storage adapters, fixed organization/project object paths, artifact metadata, and an idempotent deletion queue. It uses only the publishable key and authenticated user's token. The two empty private buckets and their four policies now exist remotely, but no user, object, customer data, or configured Auth provider flow exists yet.
- A Google Business Profile connector adapter supports injected server-only credentials, account and location discovery, complete per-location pagination, rating-only reviews, replies, timestamps, canonical normalization, safe errors, rate-limit metadata, and repeated-cursor protection.
- Contract tests cover authentication failures, cross-tenant concealment, token hashing/revocation, managed-database transactions, provider pagination, malformed payloads, 401/403/429/unavailable errors, and credential redaction.

Still required before production/provider claims: complete the redacted hosted-activation readiness gate; provision and prove the non-owner runtime login, private-bucket access and deletion, invitation/recovery and SMTP, managed database rollback/backup, KMS-backed OAuth key management/rotation, Google API approval, a verified managed Business Profile, and live account -> location -> full reviews -> refresh/revoke proof.

### Historical Slice 15 — Multi-format sources and connected Google ingestion

Implemented on 2026-07-12:

- Historical behavior accepted CSV, XLSX, JSON, and pasted feedback. D-120 supersedes that customer-ingestion surface with one CSV-only mapping contract; the connector history below remains historical context.
- All four inputs share one server trust boundary: tenant authorization; 10,000-row, 100-column, and 10,000-character cell/comment ceilings; HTTPS source-link validation; stable invalid-input errors; and literal, non-executable rendering through inventory, evidence, model context, report snapshots, and escaped PDFs.
- Original upload bytes/text, media type, encoding, and SHA-256 hash are retained separately from normalized rows; binary workbook conversion never replaces source provenance.
- Google Authorization Code + S256 PKCE uses organization/user-bound, expiring, single-use hashed state and encrypted server-confidential verifiers.
- AES-256-GCM envelopes protect access and refresh tokens at rest; token exchange, refresh-token preservation/rotation, remote revoke, and local disconnect are implemented without returning credentials.
- The Sources workspace distinguishes OAuth, Business Profile account, managed location, and review access, then persists discovered entities for explicit location selection.
- Selected locations are frozen into a nonsecret sync-job snapshot. Every review page is exhausted, exact raw provider payloads are retained, and written/rating-only/reply/timestamp fields enter the same canonical inventory.
- Provider/location/review identity makes re-sync idempotent while preventing equal review IDs from different locations from merging.
- A real protected HTTP integration test proves connection persistence -> discovery -> selection -> asynchronous sync -> normalized inventory using a deterministic provider contract server.
- With the four public/server Supabase URL/publishable-key variables configured, invited users sign in through Supabase email/password auth. The API verifies the bearer token and, on that subject's first successful login only, transactionally creates its application profile, one owner membership in `Personal workspace`, and one `Default project`. Repeat logins reuse that boundary; later membership changes are separate administrative actions. This does not enable public signup, and the write-only waitlist still creates no account or access.
- First-owner bootstrap and loopback recovery remain non-production API compatibility routes. `/api/auth/staging-session` additionally requires the explicit browser local-QA flag and returns 404 whenever `NODE_ENV=production`; absent Supabase configuration otherwise fails closed in the public login form.
- Historical browser QA covered the former multi-format Sources bundle. Current release proof is the D-120 CSV mapping journey and D-121 local Docker gate.

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

- At delivery, production analysis used exact-offset sentence/clause segmentation, pinned `Xenova/multilingual-e5-small` ONNX q8 embeddings, deterministic spherical clustering, and dataset-derived c-TF-IDF-style representation. Slice 24 replaced spherical assignment with mutual-KNN diagnostics. D-080's generated-topic token connectivity is historical and superseded by D-091: communities and clause siblings remain internal/provisional, while current customer recurrence uses controlled category plus immutable source text and pinned source-text embeddings.
- The run records model ID, immutable model revision, dtype, dimensions, segment count, cluster count, pipeline version, confidence, and the existing immutable review/signal/evidence relationships.
- Keyword/rule extraction is no longer called by the production run. Rules are reserved for preprocessing, deduplication, safety/negation validation, exact-span integrity, and evidence publication thresholds.
- Rating provides only the phase-one polarity/type prior. A later SetFit multi-label classifier may add pain, desired outcome, objection, praise, purchase trigger, operational issue, and emotion labels only after real analyst-curated training and benchmark approval.
- The evidence dialog renders the full original feedback, visibly marks the exact matched span, retains provider/entity/rating/date/language, and traverses to the source review.
- Historical Slice 19 removed standalone Overview navigation, and D-100 briefly restored it as an internal Voice Map mode. D-103 restored Overview and Voice Map as sibling top-level dashboard sections; D-106 now gives Overview a three-layer business-brief role. Compact deterministic context presents source breadth, category balance, signal maturity, and justified time trend without coverage plumbing or ranked topics. Separate evidence-cited interpretation and action layers provide understanding, opportunity/risk, one sales implication, one marketing implication, and three actions without authority over saved map facts. Coverage, exhaustive comments, ranked buckets, and bubble exploration remain only in Voice Map/evidence.
- Top evidence buckets shows the ten highest-support valid recurring or emerging outcomes. Ordering is feedback count descending with stable `themeId` ascending ties. Each full-color filled bubble displays the topic and feedback count; full feedback remains in the evidence drawer after selection. One bounded square-root radius scale makes every count increase monotonic, and count is the only recurrence encoding. Low-velocity physics, boundary bounce, and pairwise collision resolution provide continuous but controlled movement. The field retains the category legend, focus/tap/keyboard evidence opening, paused interaction, reduced-motion static layout, semantic table fallback, and 390px behavior.
- Bucket names must be descriptive dataset-derived phrases, not isolated context tokens. The representation layer counts term support once per review and prefers supported multi-word concepts; label font size increases with bubble size.

### Slice 19 — Project switching and session exit

Implemented on 2026-07-13:

- Both desktop project controls list the projects authorized for the current organization and select the same active project; creating a project remains a separate explicit action.
- Selecting a project returns to its default Voice Map and clears project-scoped cursors, selected evidence, review pages, and import confirmation before loading that project's counts, dates, and analysis.
- The project rail renders the authenticated display name, email, and membership role from `/api/auth/me`; no sample identity is used in the signed-in workspace.
- An explicit Log out action signs out the configured Supabase session before returning to the email-and-password login screen; unconfigured local QA continues to revoke its legacy server session.
- Project switching remains available at narrow widths through the project-rail drawer, and all controls use native keyboard-accessible form elements.

### Slice 20 — Actionable root causes and date-window analysis

Implemented on 2026-07-13:

- The global date control opens an exact From/To evidence window and creates a new immutable analysis run; it never cosmetically filters an existing published result.
- The upper-right avatar opens authenticated account details, including the full email and role, plus the same revoking Log out action as the project rail.
- A pinned multilingual q8 ONNX sentiment classifier assigns clause-level positive, neutral, or negative polarity before clustering, so a mixed review can preserve both what worked and what failed.
- Long feedback is segmented into independently traceable clauses. Dataset-recurrent cause language such as an unanswered phone or an unclean restroom is named separately from consequences such as a leaked bag or a changed impression.
- Root-cause preference uses recurrence and general negation structure, not a food-industry theme dictionary; full consequence text remains available as evidence.

### Historical Slices 21–25 — Superseded aggregate cluster interpretation

Implemented on 2026-07-13 and retained as historical context. D-077 removed aggregate-cluster interpretation; D-084 now governs current fixed-ID categorization plus selective ambiguous-pair adjudication.

- After deterministic evidence persistence, a run enters `interpreting_clusters` and enqueues one bounded OpenCode Go job per validated evidence-backed theme, using all supporting feedback attached to that theme. Pain and praise themes are interleaved so early results remain balanced while the full queue drains asynchronously. Theme isolation keeps each candidate inside the existing compact response budget and prevents one omitted or invalid candidate from hiding a sibling without raising the provider-wide output ceiling.
- The model returns a versioned candidate containing actionable aspect, praise/pain/mixed evaluation, root cause, consequence, confidence, and exact review spans. Root cause and consequence require their own supporting spans or must be `null`.
- Root cause and consequence are optional enrichment rather than publication prerequisites. Unsupported optional fields normalize to `null` with an omission diagnostic; the theme's primary publication evidence still requires an exact source span.
- The candidate validator rejects malformed JSON, unknown themes/reviews, incorrect offsets, and unsupported cause/consequence claims. Rejection, provider outage, missing configuration, timeout, or quota exhaustion leaves the deterministic artifact usable without pretending that partial model coverage is complete.
- Accepted candidates are visibly used for machine-workspace bucket names and summaries while retaining deterministic artifacts and requiring human curation before publication.
- Provider/model request and token capacities, refill rates, concurrency, output limit, and deadline are mandatory. Monetary budgets are opt-in and may be enabled only with a verified pricing contract; they are disabled by default for capacity-priced OpenCode Go so cumulative invented spend cannot stop complete analysis.
- A provider-compatible local compact-model fallback is documented for evaluation, not promoted. Any sub-500 MB artifact must pass the identical 100-record food, evidence, unsupported-claim, latency, memory, and analyst-preference gates.

### Historical Slice 22 — LLM-first curation and full-feedback evidence

Implemented on 2026-07-13:

- Historical behavior: a run did not become curatable until all cluster-interpretation jobs reached an accepted or explicit fallback terminal state.
- Current behavior begins here: the validated per-comment result is persisted as `review_signals.attributes.canonicalOutcome` and is the sole category/topic/label/exact-evidence/confidence authority for Dashboard and Curation and for newly created report snapshots. `emergingInterpretation` and taxonomy-v1 values are read-only compatibility for stored runs. New results use `semantic-taxonomy-v2-v22`; sentiment is orthogonal metadata. Existing immutable report snapshots are never rewritten. The model receives fixed IDs and supplies semantic labels/evidence; after completeness it may answer only same-topic booleans for server-selected fixed ambiguous pairs. Complementary manifestations of one bounded customer job and coherent operator initiative may share a topic only when the adjudicator can name one specific shared operator intervention; different interventions require `false` even when the comments share a surface or broad intent. It cannot decide inclusion, counts, rank, readiness, access, expiry, projection, or broad membership. Missing canonical outcomes fail the run; failed pair decisions default to separate emerging signals.
- The persisted Voice Map engine identifies whether the run completed with `llm-interpreted-theme-engine-v1` or `deterministic-theme-engine-v2`, and the quality report records interpreted and fallback coverage. Theme evidence remains bounded to one semantic cluster even when separate clusters share a generated aspect label.
- Curation evidence renders the complete immutable source feedback and visually highlights the exact supporting span instead of presenting a context-free fragment as if it were the review.

### Historical Slice 23 — Live LLM analysis progress

Implemented on 2026-07-13:

- Clicking **Run analysis** keeps the Analysis workspace attached to the newly created immutable run through deterministic preparation and the current per-comment interpretation jobs.
- During interpretation, the workspace polls persisted server state and reports completed/total jobs, remaining work, interpreted/validated theme coverage, active/waiting jobs, governed fallbacks, elapsed time, model identity, and a short run identity.
- Queue waits are identified as provider-capacity waits with automatic retries, so a slow model run is visible rather than appearing frozen.
- Reloading or returning to Analysis resumes monitoring the latest non-terminal run for the active project.
- The progress surface uses an accessible progressbar, remains readable at 390px, and disables its width transition under reduced motion.

### Historical Slice 24 — Coherent semantic communities and bounded grouping review

Implemented on 2026-07-13:

- Forced centroid assignment is replaced by polarity-specific reciprocal K-NN similarity graphs with versioned coherence and independent-review gates.
- Weakly connected claims remain explicit outliers and cannot silently become machine themes.
- Every accepted semantic cluster shares one dataset-derived representation, preventing phrase-level fragmentation inside the same community.
- Analysis quality exposes cluster coverage, outliers, ambiguity count, engine version, and similarity floor.
- Historical aggregate behavior used bounded `keep`/`split` advice. Current runs never send groups: only capped candidate pairs may be adjudicated, and deterministic code retains all membership authority.

### Historical Slice 25 — Publication-quality gate and multi-label signal workspaces

Implemented on 2026-07-13:

- Historical cluster interpretation explicitly discarded metadata, boilerplate, context-only clusters, and unrelated feedback joined only by repeated template language; current malformed/unsupported rejection happens at the per-comment validation boundary.
- A cluster may enter publication as `publish + keep` only when every retained source review contributes an exact span that independently supports the same label and operator decision; incomplete review coverage is rejected before persistence.
- Discarded or unresolved cluster output cannot enter confirmed publication. Superseded by the per-signal complete-coverage contract in Slice 28: every valid retained signal receives its own grounded recurring or emerging outcome, while cluster diagnostics remain internal.
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

### Slice 27 — Bluerose LLM interpretation enablement

Implemented and deployed to Bluerose staging on 2026-07-14. The bounded provider-backed proof is recorded in `deployment-evidence/2026-07-14-bluerose-llm.md`:

- The Bluerose ConfigMap enables the evaluated OpenCode Go `qwen3.7-plus` adapter with explicit request/token capacity, two-call global/provider/organization concurrency, a 1,800-token output cap, a 240-second job deadline, and monetary enforcement disabled for the capacity-priced provider. Its July deployment proof predates D-077's per-comment-only call shape and is not fresh deployment evidence for the current source.
- The provider credential is a required server-side Kubernetes Secret key. Initial and additive secret scripts fail closed, never print the value, and refuse implicit rotation.
- API egress adds public IPv4 TCP 443 while excluding private, local, test, and reserved networks. This is an explicit staging limitation because standard Kubernetes NetworkPolicy cannot select an FQDN; the server-owned provider adapter retains the fixed OpenCode base URL.
- Live acceptance proved three successful provider jobs, two validated OpenCode-backed themes, `llm-interpreted-theme-engine-v1`, public application health, and Portfolio preservation. Existing deterministic runs remain immutable historical artifacts.

### Slice 28 — Public Voice Map entry and isolated demo

Implemented locally on 2026-08-10; no deployment claim is made:

- The Voice Map root is one public editorial homepage. Product, Examples, Resources, and About are anchored sections in that page; the shared header and footer navigate to those section IDs without mounting standalone public routes. Pricing is absent until a governed pricing decision exists. Log in and Try the demo remain direct actions, and only Log in mounts the existing authenticated workspace boundary.
- At narrower breakpoints, the four product links move into an accessible menu while Log in and Try the demo remain directly visible.
- The temporary demo accepts an original CSV containing 6–10 mapped feedback rows within 16 KB. It uses the same alias, map-or-exclude, preview, and row validation contract as authenticated Sources before creating an isolated organization, project, import, and analysis run.
- Additional Demo CSVs append only to the current expiring token-scoped project; each accepted import creates a new immutable run over all current project feedback. The server accepts at most 50 unique comments per project allowance, starts an eight-hour cooldown when the 50th is accepted, ignores duplicate retries for capacity, and permanently closes that project to new uploads. The upload area exposes a live accessible countdown; at the exact server-confirmed boundary it offers a fresh temporary Demo project rather than appending to the old result. Authenticated uploads accumulate as distinct project sources without this Demo allowance; starting analysis creates a new immutable run over every current project review matching the selected filters. Earlier run membership, Curation revisions, and report snapshots are not overwritten.
- Demo mode renders the shared full dashboard shell and the same sibling Overview and Voice Map sections as the authenticated path. Overview is the default live-data business brief: compact deterministic source/category/maturity/time context appears before separate evidence-cited interpretation and actions. It contains no coverage headline, exhaustive comment ledger, ranked bucket list, bubble map, or hard-coded marketing preview data. An invalid or unavailable intelligence response yields evidence-context-only UI, never invented fallback claims. Voice Map is read-only in both modes and owns detailed coverage and bubble exploration. Demo Curation can temporarily accept, create or rename buckets, move comments, merge, split, and restore revisions; changes update the demo Voice Map and Overview brief but never enter an authenticated workspace. Team, account, history, connections, and persistent report actions remain unavailable.
- Every valid retained comment receives exactly one validated canonical engine signal under `semantic-taxonomy-v2-v22`: `pain`, `desired_outcome`, `objection`, `emotion`, or `other`, plus independent `positive`, `neutral`, or `negative` sentiment, bounded topic/label, and exact evidence for its fixed review ID. `other` is stable, honest context rather than a dynamic category. An explicit request or wanted result is desired outcome even when it names the motivating failure; concrete workflow friction described as frustrating remains pain unless the customer's own affect is the main signal. Achieved-value praise is desired outcome plus positive sentiment; generic affective praise is emotion plus positive sentiment. Prompt/schema `semantic-taxonomy-v2-v22` / `cluster-interpretation-v9` cannot choose inclusion, candidate membership, count, rank, readiness, access, expiry, or projection. Deterministic validation enforces schema, allowlists, exact evidence, full coverage, and publication state but does not veto an allowed grounded category through keyword rules. The server persists the canonical outcome before recurrence. One comment produces an emerging outcome; compatible groups of at least two produce recurring outcomes. Both are full-color filled bubbles, with count-driven size as the only recurrence encoding. New reports use v2; existing immutable report snapshots remain unchanged.
- Identical or near-paraphrase text from distinct source records remains valid, included, and individually categorized. Exact/hash/near-similarity groups are diagnostics and may guide analytical merging; they do not silently remove retained feedback. Repeated external IDs remain import duplicates, while text-only deduplication is reserved for rows without a source ID. Demo per-row canonical hashes preserve the same rule.
- Complete successful individual categorization for every retained comment is sufficient for a usable result. The server generates category-bounded candidates from immutable original feedback and pinned source-text embeddings. Exact normalized source duplicates group deterministically; other source-similar pairs are ambiguous candidates. Model-generated topic, label, aspect, and evidence are excluded from candidate eligibility. Raw-eligible connected components of at most 16 complete pairs retain every qualifying candidate; larger components retain only pairs whose endpoints rank each other in their stable top four eligible neighbors by similarity then pair ID. A trigger may expand a deterministic component cross-product through 16 fixed pairs, which are adjudicated in five-pair batches. Components join only when every cross-pair is compatible, preventing transitive chaining. Invalid, failed, over-limit, or rejected pair decisions remain emerging and never block completeness. Stable IDs—not labels—define bucket identity, so same-label singletons may coexist.
- The separate Curation section is touch-up rather than primary categorization. Both authenticated and demo paths expose every retained item inside grouped proposals and begin with one primary action: review a bucket. Accepted or edited buckets are described as settled instead of pending. The selected bucket reveals its exact evidence and contextual rename/correction flow; combine and custom-bucket actions appear only there. The underlying authorized API retains move, merge, split, restore, and audit capabilities without exposing an always-on management toolbar. Creating a custom bucket can reassign a retained comment already represented by a recurring or emerging machine bucket; the effective projection removes it from its prior bucket, preserves exact evidence/provenance, and keeps the comment accounted exactly once. Authenticated actions persist in the append-only revision ledger, expose **Undo latest change** in Activity, and restore the effective target revision without reapplying superseded historical edits; demo actions remain token-scoped and expire with the isolated session.
- Legacy themes that omit a contradiction metric render that value as unavailable; the UI never invents a zero or displays `NaN`.
- Normal retained-comment categorization uses compact five-item queue jobs and accepts output only when every requested comment has one non-generic label, controlled type, bounded topic, and exact quote. The shared queue retries and recursively splits only the failed batch (`5 -> 2/3 -> 1`). Terminal singleton failure marks the analysis failed and leaves any prior completed map intact.
- At 1,000 comments, categorization is 200 normal calls, 202 with one recovered parent, 208 when one original batch reaches every singleton leaf, and 1,800 only under total degradation. Selective pair adjudication is additional but bounded to all qualifying edges only inside raw-eligible connected components of at most 16 complete pairs, mutual stable top-four eligible neighbors for larger components, at most 16 cross-pairs for one triggered deterministic component pair, and five pairs per call; it is not a blanket pairwise or aggregate-cluster pass.
- Authenticated analysts may create, rename, merge, split, and reorganize user-curated buckets from exact source evidence. The append-only curation ledger records actor, timestamp, source review/signal IDs, model origin, and revision restores. Later edits reopen the draft; marking it ready again enables a new immutable report version without mutating earlier reports.
- The demo refuses to start unless the server-side analysis-engine credential, endpoint/model policy, rate, token, concurrency, output, and deadline contract is complete. Provider credentials are never returned, logged, copied, or accepted from the browser, and provider identity never appears in public status/error/PDF copy. Incomplete individual categorization fails; deterministic grouping leaves valid singles emerging.
- A session expires exactly 24 hours after creation, independent of activity. A server sweep runs every minute and deletes the demo source, derived, and curation rows. Starts are capped at 20 per rolling server hour, each temporary project permits one run, and each demo session permits at most 50 curation actions.
- `GET /api/demo/analysis-runs/:token/pdf` renders a visibly labelled demo report only after verified OpenCode interpretation. It writes no report or download-history row, deletes the renderer's temporary file in `finally`, and sends `private, no-store, max-age=0`, `Pragma: no-cache`, and `Expires: 0`.
- Authenticated immutable reports remain separate under `/api/reports/:id/pdf`; demo curation is explicitly temporary and user-curated, never an immutable publication or anonymous persistent workspace.
- Authenticated and demo runs share the same deterministic analysis, durable OpenCode queue, provider/model request-token buckets, global/provider-model/organization concurrency admission, fair organization ordering, retry/circuit policy, and result validator. Demo quotas are additive anonymous-abuse controls.
- The current two-call policy queues excess work and is an architectural path toward 10–100 concurrently active users, not a load-tested claim of 10–100 simultaneous analyses. Independent analysis workers, managed PostgreSQL, exported queue-age/provider-saturation metrics, alert proof, and representative load tests remain release gates before raising the ceiling.
- The browser gives a live demo run at most 270 seconds before reporting a bounded timeout, exceeding the current 240-second server job deadline without allowing indefinite polling. This source contract is covered automatically; the current category-first desktop/mobile live-browser acceptance rerun remains a delivery gate and is not claimed complete here.
