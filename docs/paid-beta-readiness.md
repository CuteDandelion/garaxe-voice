# Paid Beta Readiness

Status: Conditional gate
Last updated: 2026-07-14

## Locally and staging proven

- Evidence-first CSV/XLSX/JSON/paste and authorized Google ingestion through immutable report/PDF publication.
- Versioned CPU semantic analysis with exact source spans, reciprocal-neighbour coherence gates, honest outliers, persisted diagnostics, an LLM publication-quality gate, and human approval; the local test suite includes adversarial boilerplate and surface-diverse cases while the runtime uses the pinned ONNX q8 artifact.
- Organization-scoped opaque sessions, role checks, and cross-tenant concealment.
- Local and managed-PostgreSQL database adapters with transaction tests, a checksum-verified migration runner, forced RLS on all 22 tenant-owned tables, and least-privilege cross-tenant behavior tests.
- Google Business Profile connector contract tests with complete pagination and safe normalization.
- Google OAuth, encrypted token persistence, account/location discovery, explicit selection, and raw-preserving asynchronous sync proven against a deterministic provider contract server.
- CSV, XLSX, JSON, and paste ingestion with original source artifact retention.
- Automated structural accessibility scans plus responsive/reduced-motion/focus contracts.
- Bounded request bodies, no-store/nosniff API responses, restricted cookie-origin mutations, and sanitized operational errors.
- Responsive editorial workflows at 390px and clean browser console checks for the completed product flows.
- Locally runnable strict typecheck, unit/integration tests, production web/server builds, full dependency audit, Kubernetes rendering, and documentation sync commands. Repository CI and GHCR publication workflows encode these lanes and passed for the deployed source SHA.
- Non-root web/API images, pinned ReportLab, prewarmed pinned ONNX revisions, offline runtime inference, same-origin proxying, database-aware readiness, staging bootstrap closure, and staging access-key recovery are proven on Bluerose. The staging proof includes capacity observation, a bounded off-server dump/restore rehearsal, pod persistence, and application rollback; it does not establish managed backup, HA, disaster recovery, or paid-beta identity readiness. See `deployment-evidence/2026-07-14-bluerose-staging.md`.

## External release gates

The product must not be called production-ready or offered as a paid connected beta until all items below are proven in the target environment.

1. Deploy managed PostgreSQL, apply the locally rehearsed versioned forced-RLS migration using a least-privilege runtime role, and repeat cross-tenant tests against that live service.
2. Integrate a production identity provider with account recovery, session rotation, invitation, and member-removal flows.
3. Move the implemented OAuth envelopes to a managed key service; prove production key rotation, revocation retry, reconnect, and redacted logs.
4. Receive Google Business Profile API approval and complete OAuth verification as required.
5. Run staging proof with a real verified profile: authorize -> accounts -> locations -> every review page -> normalized persistence -> refresh -> revoke -> delete.
6. Confirm Google terms, reviewer display, retention, deletion, and data-processing obligations with counsel.
7. Move import/analysis/PDF jobs to a durable worker; enforce concurrency, timeout, retry, dead-letter, and idempotency policies.
8. Add managed backups, restore rehearsal, monitoring, alerting, structured audit events, rate limits, malware/file validation, and incident runbooks.
9. Run accessibility audit, supported-browser matrix, load benchmarks, penetration test, and disaster-recovery exercise.
10. Configure TLS, allowed origin, secure cookies, CSP at the web edge, secret management, and separate development/staging/production environments.
11. Package/prewarm and integrity-verify the pinned ONNX model, then pass the 100/1,000-review quality, peak-RSS, cold/warm-latency, restart, and offline-cache benchmarks on the 4 vCPU/8 GB worker target.
12. Run the root-cause interpretation benchmark against the selected OpenCode Go model and any local compact fallback; record provider terms, schema validity, unsupported-claim rate, exact-span validity, analyst preference, p50/p95 latency, peak RSS, and cost before connected paid-beta release.
13. Exercise the repository CI and extend it to enforce formatting, lint, complete dependency/security disposition, documentation contradiction/diff hygiene, and merge-blocking critical-path browser E2E; add scheduled provider smoke tests only where credentials and provider policy permit.

## Release decision

Current decision: **local MVP complete; connected paid beta not yet released**. The remaining gates require deployment authority, provider approval, real customer authorization, and operational ownership. They cannot be truthfully satisfied by synthetic fixtures alone.
