# Paid Beta Readiness

Status: Conditional gate
Last updated: 2026-08-13

## Locally and staging proven

- Locally, the one-page public Voice Map landing and token-scoped demo data remain outside AuthGate while Demo mode reuses the full dashboard presentation. Overview is the real-data default beside Voice Map and separates compact deterministic evidence context from read-only, evidence-cited interpretation and actions that fail closed to context-only UI. Coverage plumbing, exhaustive comments, ranked buckets, and bubbles remain in Voice Map/evidence. The current source uses canonical per-comment outcome persistence with `semantic-taxonomy-v2-v22`, explicit-request/wanted-result precedence, concrete-friction-versus-affect calibration, grounded `other`, orthogonal sentiment, deterministic recurrence/count/ranking, and failed-batch-only recovery without a partial-map completion path. Prior independent ten-input Demo/authenticated runs achieved exact-once projection and authenticated report evidence was exact for 10/10, but fresh post-D-106 browser/live evidence is still required. Durable Overview-brief caching/queue admission, v1 compatibility, immutable-report non-rewrite, broader semantic quality, target deployment, and connected-beta gates remain required.
- Evidence-first CSV-only customer ingestion and separately governed authorized connector ingestion through immutable report/PDF publication.
- Versioned CPU semantic analysis with exact source spans, reciprocal-neighbour coherence gates, honest outliers, persisted diagnostics, an LLM publication-quality gate, and human approval; the local test suite includes adversarial boilerplate and surface-diverse cases while the runtime uses the pinned ONNX q8 artifact.
- Organization-scoped opaque sessions, role checks, and cross-tenant concealment.
- Local and managed-PostgreSQL database adapters with transaction tests, a checksum-verified migration runner, forced RLS on all 22 tenant-owned tables plus two separately governed artifact metadata/queue tables, private Storage adapter tests, and least-privilege cross-tenant behavior tests.
- Google Business Profile connector contract tests with complete pagination and safe normalization.
- Google OAuth, encrypted token persistence, account/location discovery, explicit selection, and raw-preserving asynchronous sync proven against a deterministic provider contract server.
- CSV-only Demo/authenticated ingestion with original artifact retention, explicit allowlisted mapping/exclusion, row preview, template download, and actionable validation.
- The exact production candidate build must pass the complete live local Docker-staging matrix before any deployment begins; production validation runs only after that evidence is recorded. This candidate has not yet recorded that live gate.
- Automated structural accessibility scans plus responsive/reduced-motion/focus contracts.
- Bounded request bodies, no-store/nosniff API responses, restricted cookie-origin mutations, and sanitized operational errors.
- Responsive editorial workflows at 390px and clean browser console checks for the completed product flows.
- Locally runnable strict typecheck, unit/integration tests, production web/server builds, full dependency audit, Kubernetes rendering, and documentation sync commands. Repository CI and GHCR publication workflows encode these lanes and passed for the deployed source SHA.
- Non-root web/API images, pinned ReportLab, prewarmed pinned ONNX revisions, offline runtime inference, same-origin proxying, database-aware readiness, staging bootstrap closure, and staging access-key recovery are proven on Bluerose. The staging proof includes capacity observation, a bounded off-server dump/restore rehearsal, pod persistence, and application rollback; it does not establish managed backup, HA, disaster recovery, or paid-beta identity readiness. See `deployment-evidence/2026-07-14-bluerose-staging.md`.
- OpenCode Go interpretation is active for new Bluerose runs: a bounded live proof completed three provider jobs without fallback and published two validated `qwen3.7-plus` interpretations under `llm-interpreted-theme-engine-v1`. This proves staging execution, not comparative quality, production egress, independent-worker, or ongoing provider-availability gates. See `deployment-evidence/2026-07-14-bluerose-llm.md`.

## External release gates

The product must not be called production-ready or offered as a paid connected beta until all items below are proven in the target environment.

1. Run the redacted hosted-activation readiness gate, explicitly approve and apply local migration 006 for the non-owner runtime login that inherits `voice_lab_api`, enter its password through operator handoff, and repeat cross-tenant/control-table/waitlist-monitoring tests against the remotely verified schema. Demo remains on its separate PGlite handle and must not receive managed-database grants. Do not populate `VOICE_LAB_ADMIN_EMAILS` until the intended provisioned operators are approved.
2. Prove invited-user email/password login triggers the idempotent server-owned personal workspace/`Default project` boundary, then prove member removal, private CSV/PDF bucket isolation and deletion, account recovery, and custom SMTP.
3. Move the implemented OAuth envelopes to a managed key service; prove production key rotation, revocation retry, reconnect, and redacted logs.
4. Receive Google Business Profile API approval and complete OAuth verification as required.
5. Run staging proof with a real verified profile: authorize -> accounts -> locations -> every review page -> normalized persistence -> refresh -> revoke -> delete.
6. Confirm Google terms, reviewer display, retention, deletion, and data-processing obligations with counsel.
7. Move import/analysis/PDF jobs to supervised durable workers while reusing the existing PostgreSQL LLM queue; prove multi-worker recovery, concurrency, timeout, retry, dead-letter, and idempotency for bounded categorization and selective pair-adjudication jobs.
8. Export and alert on oldest queue age, provider/model request-token saturation, active/expired leases, retry/dead-letter/circuit/fallback rates, categorization split amplification, and source-derived pair-candidate/call volume. Treat the 1,800-call categorization degradation envelope, a raw-eligible source-text component beyond the 16-complete-pair all-edge ceiling, more than two retained triggers per signal in a larger component, or a deterministic-component expansion beyond the fixed 16-pair ceiling as alarms, then load-test 10–100 active users. Calibrate source-text candidate recall/precision without allowing generated topic or label changes to alter eligibility.
9. Add managed backups, restore rehearsal, monitoring, alerting, structured audit events, malware/file validation, and incident runbooks. Local parser/source-link and Demo/organization admission controls are implemented, but sustained distributed-rate testing and live Storage upload validation remain open.
10. Run accessibility audit, supported-browser matrix, load benchmarks, penetration test, and disaster-recovery exercise.
11. Configure TLS, allowed origin, secure cookies, CSP at the web edge, secret management, and separate development/staging/production environments.
12. Package/prewarm and integrity-verify the pinned ONNX model, then pass the 100/1,000-review quality, peak-RSS, cold/warm-latency, restart, and offline-cache benchmarks on the 4 vCPU/8 GB worker target.
13. Run categorization and pair-adjudication benchmarks against the selected model and any compact fallback; record schema validity, exact-span/category precision, pair false/missed-merge rates, call amplification, multilingual ceiling, p50/p95 latency, peak RSS, and cost before connected paid-beta release.
14. Exercise the repository CI and extend it to enforce formatting, lint, complete dependency/security disposition, documentation contradiction/diff hygiene, and merge-blocking critical-path browser E2E; add scheduled provider smoke tests only where credentials and provider policy permit.

## Release decision

Current decision: **connected paid beta not yet released**. The independent ten-input Demo/authenticated exact-once, authenticated report-evidence, and desktop/mobile no-overflow checks are fresh local proof, but they do not resolve the documented semantic-grouping quality failures or constitute representative customer evidence. The remaining connected-beta gates additionally require deployment authority, provider approval, real customer authorization, and operational ownership; they cannot be truthfully satisfied by synthetic fixtures alone.
