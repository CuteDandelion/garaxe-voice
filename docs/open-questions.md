# Open Questions

Status: Requires owner decisions before production implementation
Last updated: 2026-07-13

1. Product name and whether the app is branded as `garaxe. voice` or a separate product.
2. Exact primary launch segment: individual local business, multi-location operator, or agency.
3. Hosting/data residency requirement and whether Supabase is approved.
4. Production authentication provider, invitation/recovery policy, and whether the implemented owner/admin/analyst/viewer roles need launch changes.
5. Google Business Profile API approval status and availability of a real staging design partner.
6. Supported launch languages and whether translated analysis preserves bilingual evidence.
7. Review/credential/report retention periods and deletion SLA.
8. Which future model or prompt revision will pass the promotion thresholds in `model-evaluation.md`; the three evaluated models are explicitly not promoted and zero-LLM publication remains mandatory.
9. Which organization roles may mark curation ready in production; the current write boundary allows owner, admin, and analyst.
10. White-label report requirements beyond the implemented Garaxe PDF fidelity.
11. Whether users may submit review-page URLs at launch; each URL source needs an explicit authorized acquisition method and rights review.
12. OpenCode Go production data-processing location, retention/training terms, published quota contract, and whether those terms permit the intended customer-review workload.
13. Initial provider/model concurrency, request/token bucket capacities, and dead-letter retention period; monetary global/organization/project/run budgets remain optional until a provider has a verified price contract.
14. Minimum analyst-curated corpus size, adjudication process, and per-label promotion thresholds for the future SetFit classifier.
15. Whether `SmolLM2-360M-Instruct` Q8_0 or `Qwen2.5-0.5B-Instruct` Q4_K_M can pass the root-cause interpretation gate under 500 MB without unacceptable JSON, multilingual, or reasoning regressions.

Billing and pricing remain outside the governed application MVP until explicitly reopened.
