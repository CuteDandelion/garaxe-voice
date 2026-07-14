# Open Questions

Status: Requires owner decisions before connected paid-beta release
Last updated: 2026-07-14

1. Product name and whether the app is branded as `garaxe. voice` or a separate product.
2. Exact primary launch segment: individual local business, multi-location operator, or agency.
3. Hosting/data residency requirement and whether Supabase is approved.
4. Production authentication provider, invitation/recovery policy, and whether the implemented owner/admin/analyst/viewer roles need launch changes.
5. Google Business Profile API approval status and availability of a real staging design partner.
6. Supported launch languages and whether translated analysis preserves bilingual evidence.
7. Review/credential/report retention periods and deletion SLA.
8. Which provider/model configuration will pass the paid-beta promotion thresholds in `model-evaluation.md` and the target-environment operational gates. Qwen no-thinking is the evaluated local default under D-052, but it is not yet promoted for connected paid-beta operation; an explicitly labelled deterministic fallback remains mandatory.
9. Which organization roles may mark curation ready in production; the current write boundary allows owner, admin, and analyst.
10. White-label report requirements beyond the implemented Garaxe PDF fidelity.
11. Whether users may submit review-page URLs at launch; each URL source needs an explicit authorized acquisition method and rights review.
12. OpenCode Go production data-processing location, retention/training terms, published quota contract, and whether those terms permit the intended customer-review workload.
13. Whether the Bluerose staging capacity policy—two global/provider/organization calls, two-request/16,000-token buckets, and a 240-second deadline—remains appropriate under larger live datasets; production limits and dead-letter retention remain open, and monetary budgets remain optional until a provider has a verified price contract.
14. Minimum analyst-curated corpus size, adjudication process, and per-label promotion thresholds for the future SetFit classifier.
15. Whether `SmolLM2-360M-Instruct` Q8_0 or `Qwen2.5-0.5B-Instruct` Q4_K_M can pass the root-cause interpretation gate under 500 MB without unacceptable JSON, multilingual, or reasoning regressions.
16. Which managed PostgreSQL, object-storage, KMS, and independent backup/restore targets replace the single-node Bluerose staging dependencies before paid beta.
17. Which production IdP replaces the staging access key, and what migration/recovery flow converts `test-user@example.com` into a verified controlled identity.

Billing and pricing remain outside the governed application MVP until explicitly reopened.
