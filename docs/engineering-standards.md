# Engineering Standards

Status: Baseline
Last updated: 2026-07-14

- TypeScript strict mode; validate all external input at boundaries.
- Domain modules own their types and behavior; routes/controllers stay thin.
- Connector implementations never leak provider response shapes downstream.
- Database migrations are forward-only, reviewed, and accompanied by compatibility notes.
- Jobs are idempotent, retry-safe, observable, cancellable where practical, and use stable deduplication keys.
- Preserve original source data; derived fields record the producing version.
- Use structured logs with request/job/tenant correlation and automatic secret/PII redaction.
- Prefer deterministic functions and fixtures for normalization, filtering, metrics, and evidence mapping.
- Add unit tests before or with domain behavior; add integration tests at DB/provider/job boundaries; add end-to-end tests for customer-critical flows.
- Avoid speculative abstractions. Add a provider capability only after a manual proof of credential acquisition, identity discovery, useful full-text retrieval, lifecycle behavior, and commercial permission.
- Changes to schemas, APIs, UX contracts, analysis semantics, risks, or architectural boundaries require matching documentation updates.

## Deployment engineering

- Build web and API images from reviewed source and address them by immutable Git commit tag; never deploy `latest`.
- Keep Kubernetes desired state under `deploy/kubernetes`, render it before use, validate it against the target API, and apply database/storage, migration, application, then external routing in that order.
- Keep database passwords, staging access keys, provider credentials, OAuth envelope keys, Cloudflare credentials, and generated Secret manifests out of Git and build logs.
- Use ClusterIP services behind Cloudflare Tunnel. Fetch the current remote tunnel configuration immediately before mutation, preserve unrelated routes and terminal fallback, and verify the protected Portfolio path after every Cloudflare change.
- Treat the single-node retained volume and process-attached jobs as staging constraints. They must not be described as HA, managed persistence, independently scalable workers, or paid-beta readiness.

## Agent orchestration

Use delegation to reduce critical-path time, not to maximize activity. Small and tightly coupled changes remain with one agent. For larger work, partition by independently testable boundary—for example connector, analysis fixture/evaluation, UI surface, or security review—with non-overlapping file ownership.

The orchestrating agent must define the acceptance condition and retain responsibility for cross-module decisions, integration, and final tests. Begin with no more than two parallel workers. Additional workers require a clear independent lane, measurable latency benefit, and low merge risk. Handoffs must be short and evidence-based; duplicated discovery, broad context replication, speculative parallel implementations, and repeated full-suite runs are considered avoidable cost.

### Model selection

Select models by capability tier rather than a permanent vendor/model identifier:

| Tier | Use | Avoid |
|---|---|---|
| Economy | Mechanical, deterministic, narrow, easily verified work | Security judgments, architecture, destructive data changes |
| Standard | Normal implementation, debugging, UI, connector contracts, review | Highly ambiguous or high-impact decisions without escalation |
| Deep | Architecture, security, migrations, cross-module ambiguity, final conflict resolution | Routine edits, repeated test execution, duplicate investigations |

Start at the lowest reliable tier. Escalate only on recorded evidence: one focused attempt failed, sources conflict, uncertainty affects a high-impact boundary, or the lane requires deep synthesis. Once resolved, propagate the decision through economy/standard lanes. When explicit model routing is unavailable, control cost through narrower scope, minimal context, bounded output, and fewer parallel workers.

Model choice never relaxes verification. Cheap work must be easy to check; expensive reasoning must leave a concise decision record that cheaper lanes can reuse.
