# Open Questions

Status: Requires owner decisions before connected paid-beta release
Last updated: 2026-08-12

1. Resolved by D-101: the customer-facing product is Voice Lab; Voice Map remains the technical name of its evidence map feature.
2. Exact primary launch segment: individual local business, multi-location operator, or agency.
3. Supabase project `voice-lab` (`ugkubygaitrlwszygbno`) is selected in `eu-central-1`; confirm the production DPA, database/Storage backup and restore, private-bucket policy rehearsal, and residency evidence before customer data enters it.
4. Supabase Auth is selected by D-108; the production invitation/recovery policy and whether the implemented owner/admin/analyst/viewer roles need launch changes remain open.
5. Google Business Profile API approval status and availability of a real staging design partner.
6. Supported launch languages and whether translated analysis preserves bilingual evidence. Category quality and repeatability require governed multilingual fixtures and held-out evaluation; deterministic keyword correction is not used as a substitute for semantic validation.
7. Review/credential/report retention periods and deletion SLA.
8. Whether the configured primary/fallback pair in `.env.example` will pass the paid-beta promotion thresholds in `model-evaluation.md` and the target-environment operational gates. Runtime code intentionally contains no provider model literal; deployment may tune both IDs, and current local fallback/backoff tests are not live promotion evidence.
9. Which organization roles may mark curation ready in production; the current write boundary allows owner, admin, and analyst.
10. White-label report requirements beyond the implemented Voice Lab PDF fidelity.
11. Whether users may submit review-page URLs at launch; each URL source needs an explicit authorized acquisition method and rights review.
12. OpenCode Go production data-processing location, retention/training terms, published quota contract, and whether those terms permit the intended customer-review workload.
13. Whether the Bluerose staging capacity policy—two global/provider/organization calls, two-request/16,000-token buckets, and a 240-second deadline—remains appropriate under larger live datasets; production limits and dead-letter retention remain open, and monetary budgets remain optional until a provider has a verified price contract.
14. Minimum analyst-curated corpus size, adjudication process, and per-label promotion thresholds for the future SetFit classifier.
15. Whether `SmolLM2-360M-Instruct` Q8_0 or `Qwen2.5-0.5B-Instruct` Q4_K_M can pass the root-cause interpretation gate under 500 MB without unacceptable JSON, multilingual, or reasoning regressions.
16. Which managed PostgreSQL, object-storage, KMS, and independent backup/restore targets replace the single-node Bluerose staging dependencies before paid beta.
17. Resolved by D-108: Supabase Auth replaces the staging access key for production. Existing local QA identities remain local-only; production identities require an explicit matching `auth_users` profile and organization membership, with no automatic grants.
18. Which managed least-privilege database role and RLS context will authorize the server-owned temporary-demo worker and expiry cleanup without weakening authenticated workspace policies; local isolation and deletion tests do not prove this target-environment boundary.
19. Resolved by D-072: every valid retained signal receives bounded shared-worker interpretation, a grounded actionable category/topic, and exact evidence before similarity grouping; customer outcomes are recurring or emerging only.
20. What measured authenticated workload, completion-time SLO, and provider quota define the intended 10–100-active-user envelope; the current two-call policy, API-attached analysis scheduler, and absent production queue-age/saturation exporter are explicit ceilings rather than capacity proof.
21. Resolved by D-124 (superseding D-122's numeric allowance): Demo accepts 50 unique comments in one temporary project, then closes that project for an eight-hour cooldown before offering a fresh token/project. The client countdown is informational; server time and visitor admission remain authoritative.
22. Resolved by D-085: taxonomy v2 keeps unknown semantic feedback as grounded `other` with bounded proposed-type context; no dynamic public type is created. Future promotion of an official type requires a reviewed taxonomy version, controlled/held-out evaluation, filters/labels, stored-run compatibility policy, and regression coverage.
23. D-084 fixes the responsibility boundary and focused false-merge regression; fresh controlled and held-out Demo/auth matrices must now establish whether the bounded pair adjudicator meets category, topic, false-merge, missed-merge, latency, and call-volume thresholds without weakening the human rubric.
24. Which provenance-backed natural-language corpus can replace or supplement the consent-safe synthetic independent holdout for prevalence-weighted, multilingual, real-customer validity without exposing customer data or tuning on the acceptance set.
25. What production waitlist retention/deletion period, privacy notice URL, export process, and anti-abuse control are required before promotional collection begins; the local schema and write-only endpoint do not settle these launch operations.
26. Whether request-time Overview intelligence should become a persisted, queue-admitted derivative artifact before paid beta; the current local endpoint is fail-closed and read-only but does not yet prove durable caching, cross-process deduplication, or target-capacity economics.

Billing and pricing remain outside the governed application MVP until explicitly reopened.
