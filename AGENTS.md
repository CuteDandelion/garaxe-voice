# AGENTS.md

## Mission

Build Garaxe Voice Intelligence as a premium, evidence-first research workspace—not a generic sentiment dashboard. Every strategic claim must remain traceable to exact source feedback.

## Mandatory reading order

1. `docs/product-spec.md`
2. `docs/architecture.md`
3. `docs/design-system.md`
4. `docs/data-and-api-contracts.md`
5. `docs/analysis-pipeline.md`
6. `docs/engineering-standards.md`
7. `docs/testing-and-delivery.md`
8. `docs/security-and-operations.md`
9. `docs/decisions.md`
10. `docs/open-questions.md`
11. `docs/traceability-matrix.md`
12. `docs/paid-beta-readiness.md`

## Product invariants

- Conclusion first, evidence one interaction away.
- Import all authorized reviews; do not cherry-pick provider-ranked samples.
- Preserve raw source payloads and immutable original text.
- Provider-specific shapes stop at connector boundaries.
- Analysis runs are versioned, reproducible transformations—not one large prompt.
- Machine output and human curation are separate, auditable layers.
- Reports are immutable snapshots of an analysis run.
- Google-only insights must be described as public-review intelligence, not the complete voice of every customer.
- Customer-authorized data and uploads are the MVP acquisition boundary. Do not add unapproved scraping.
- The default visual mode is editorial `Read`; filters and diagnostics live in `Investigate`.

## Design invariants

- Treat `docs/reference-assets/garaxe-voice-of-customer/dashboard-primary-reference.png` as the primary application composition reference.
- Reuse the live Garaxe Voice of Customer brand system captured in the same folder: warm paper, near-black rules, Space Grotesk/Inter utility typography, restrained orange, square/subtly rounded geometry, and minimal shadows.
- Preserve the reference hierarchy: slim project rail, compact global bar, horizontal section navigation, large editorial insight canvas, and a narrow supporting-signal rail.
- Use a high-contrast editorial serif for customer conclusions and quotations while keeping controls, metadata, and navigation in the Garaxe sans-serif system.
- Customer quotes and strategic conclusions are visual heroes. Charts support decisions; they do not lead the page.
- Avoid generic KPI-card grids, dark sidebars, glass effects, decorative gradients, word clouds, and sentiment donuts.
- All important flows must work at 390px width and with reduced motion.

## Engineering workflow

- Prefer codebase-memory MCP graph discovery (`search_graph`, `trace_path`, `get_code_snippet`, `query_graph`) before text search. Index the repository if needed.
- Work in small vertical slices. Add or update tests with behavior changes.
- Keep connector, normalization, analysis, and presentation boundaries explicit.
- Never log or return access tokens, refresh tokens, raw secrets, or unnecessary reviewer PII.
- Update governed docs in the same change whenever behavior, schemas, APIs, UX contracts, risks, or decisions change.
- Run `./scripts/check-docs-sync.sh` before declaring work complete.

## Documentation audit

- Treat `./scripts/check-docs-sync.sh` as the minimum automated audit, not proof by itself that prose matches the implementation.
- Before declaring any change complete, compare every changed behavior, route, schema, model/pipeline version, test claim, security boundary, release gate, and implementation-status statement against current code and repository automation.
- Use codebase-memory graph tools first for code contracts, then exact text/config searches for documentation, migrations, scripts, and CI wiring. Cite the implementation or test evidence used to justify factual documentation claims.
- Keep current truth separate from historical slices and superseded decisions. Historical text that is no longer current must say when and by what it was superseded; it must not use unqualified words such as `current`, `implemented`, `production`, or `required` for obsolete behavior.
- Distinguish implemented local `/api` contracts, aspirational `/v1` contracts, locally proven behavior, and external/deployment gates. Never present planned automation, provider approval, live infrastructure, or manual verification as already implemented or CI-enforced.
- When a change touches governed behavior, update the product specification, applicable architecture/API/pipeline/security/testing documents, decision log, open questions, traceability matrix, paid-beta gate, and README in the same branch as needed. If a document is unaffected, verify that explicitly rather than assuming it.
- The final verification must include `./scripts/check-docs-sync.sh`, a targeted contradiction search, and a review of `git diff --check` plus the complete scoped diff.

## Git hygiene

- Start by running `git status --short --branch`. Preserve all pre-existing user changes and stop for direction if they overlap the requested work.
- For non-trivial or multi-file work, create a scoped branch using the `codex/` prefix unless the user requests another branch. Do not make feature or documentation changes directly on `main`.
- Keep commits single-purpose and keep unrelated formatting, generated artifacts, caches, local databases, secrets, and editor files out of the diff.
- Never use destructive history or worktree commands (`git reset --hard`, destructive checkout/restore, force push, or unrequested rebase). Do not amend or rewrite user commits unless explicitly requested.
- Before staging, inspect `git status --short`, `git diff --stat`, `git diff --check`, and the full diff. Stage only the intended paths and review the staged diff before committing.
- Use an imperative commit subject that describes the delivered outcome. Run proportionate tests before committing and report any skipped or unavailable verification.
- Do not push, open a pull request, merge, or delete branches without explicit user authorization. End every implementation handoff with the branch name, commit state, verification run, and remaining Git action, if any.

## Cost-aware orchestration

- The primary agent owns scope, architecture, integration, final verification, and the user-facing answer. Do not delegate those responsibilities wholesale.
- Delegate only when a subtask is concrete, bounded, independently verifiable, and can run in parallel with other useful work.
- Good delegation targets include isolated test lanes, one connector investigation, one scoped UI surface, fixture creation, or an independent review. Do not delegate simple file reads, tiny edits, sequential dependencies, or work whose context would cost more to explain than to perform.
- Default to zero subagents for small tasks. For substantial work, start with at most two subagents; increase fan-out only when the work has clearly independent lanes and the expected latency reduction exceeds coordination cost.
- Give each subagent the minimum necessary context: objective, owned files or read-only scope, constraints, expected artifact, and verification command. Avoid sending the full project history when a focused brief is sufficient.
- Assign non-overlapping write scopes. Only the primary agent integrates shared files, cross-cutting contracts, migrations, and final documentation unless ownership is explicitly partitioned.
- Require concise handoffs containing: outcome, files changed or evidence inspected, verification performed, unresolved risks, and no repeated background narrative.
- Stop or redirect delegated work when it duplicates another lane, loses relevance, repeatedly fails, or becomes more expensive than completing it locally.
- Reuse existing findings and agents where possible instead of spawning new investigations. Never ask multiple agents to perform the same analysis unless variance reduction is explicitly required for security, correctness, or evaluation.
- Parallelism is an optimization, not a completion criterion. A task is complete only after the primary agent reviews the combined result and runs proportionate end-to-end verification.

### Model routing

- Route by required capability, not prestige or a hard-coded model name. Model availability changes; orchestration briefs should request a capability tier and reasoning level.
- Use the lowest-cost tier that can reliably satisfy the lane:
  - `economy`: file inventory, deterministic transforms, fixture generation, formatting, narrow documentation checks, and straightforward test execution.
  - `standard`: scoped implementation, ordinary debugging, connector work with known contracts, UI components, and evidence-based code review.
  - `deep`: architecture, security boundaries, data-model migrations, ambiguous cross-module failures, analysis-quality evaluation, and final synthesis of conflicting findings.
- The primary agent defaults to `standard` reasoning and escalates a lane to `deep` only when complexity, risk, ambiguity, or failed lower-tier attempts justify it.
- Do not use `economy` for security conclusions, destructive migrations, OAuth/tenant-isolation decisions, or final validation of evidence-backed analysis semantics.
- Do not assign multiple `deep` agents to the same question unless independent variance reduction is explicitly valuable and approved by the task's risk profile.
- A subagent brief must state the selected tier and why it is sufficient. If the tier cannot be selected explicitly in the runtime, narrow the task and response budget to approximate the intended cost profile.
- Escalation requires a concrete trigger: conflicting evidence, unresolved failure after one focused attempt, high-impact uncertainty, or a decision crossing security/data/architecture boundaries. Never escalate merely because the task is large.
- De-escalate after the difficult decision is resolved: use lower-cost lanes for mechanical propagation, tests, and documentation updates.
- Prefer one stronger agent producing a decision plus cheaper agents verifying independent consequences over several strong agents repeating the entire investigation.
- Handoffs from higher-cost tiers must capture the decision, evidence, assumptions, and reusable constraints so later agents do not pay to rediscover them.

## Definition of done

- Acceptance criteria in `docs/product-spec.md` are met for the delivered slice.
- Evidence links resolve from insight/theme to exact review excerpts.
- Automated tests and relevant responsive/accessibility checks pass.
- Security and privacy implications are addressed.
- Documentation and traceability entries are current.
- Current behavior, historical decisions, implementation status, automation claims, and release gates contain no known contradictions.
- `./scripts/check-docs-sync.sh` passes.
- `git diff --check` passes and the final status/diff contain only intentional files.
