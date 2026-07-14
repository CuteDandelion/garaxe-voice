# Analysis Pipeline

Status: Implemented local MVP pipeline with explicit paid-beta gates
Last updated: 2026-07-14

## Principle

Analysis is a sequence of versioned transformations. The system never writes a conclusion first and invents supporting evidence afterward.

## MVP phases

1. Configuration: freeze objective, entities, dates, ratings, languages, and options.
2. Dataset assembly: record every included/excluded review and reason.
3. Quality/cleaning: normalize without overwriting original text; detect duplicates, language, spam risk, invalid records, and optional PII redaction.
4. Enrichment: deterministic rating groups, dates, entity dimensions, reply state, keyphrase candidates, sentiment, embeddings.
5. Exact segmentation: split sentence/clause evidence with original-text character offsets.
6. Semantic representation: embed segments with pinned multilingual-e5-small ONNX int8, build polarity-specific mutual-nearest-neighbour graphs, and retain only coherent dataset-derived communities. Weakly connected claims remain explicit outliers.
7. Cluster representation: rank literal phrases with c-TF-IDF/KeyBERT-style scoring while preserving customer wording. Count term support once per independent review, not once per repeated segment, and prefer supported two-to-four-word phrases over isolated context tokens.
8. Evidence validation: minimum support, independence, time/entity diversity, contradictions, overlap, and extraction uncertainty.
9. Metrics: prevalence, rating, trend, entity/language/rating breakdown, severity, reply rate.
10. Voice Map synthesis: generate higher-level conclusions only from validated themes.
11. Human review: approve, reject, edit, merge, split, rename, exclude, and pin.
12. Report snapshot: persist approved output and versions immutably.

## Hybrid compute strategy

Use hashes/rules/local libraries only for normalization, deduplication, negation/safety checks, span integrity, and publication thresholds. Current local-runtime theme membership comes from pinned CPU-friendly semantic embeddings and deterministic clustering—not keyword rules. LLM interpretation is the default presentation layer when configured: every validated evidence-backed cluster and all of its supporting feedback pass through model interpretation before a run becomes curatable. The model never supplies evidence, and all model output must conform to a versioned schema and pass the same evidence validation.

Phase one requires no custom training. `Xenova/multilingual-e5-small` is loaded through Transformers.js/ONNX at the pinned revision recorded in code and uses q8 weights, mean pooling, normalized vectors, and bounded batches. The current mutual-KNN similarity and mean-coherence floors are `0.84`; the weakest-member floor is `0.81`. A deliberately pattern-diverse 24-review gold fixture gates purity, paraphrase-pair recall, coverage, cross-topic merges, and mixed-cluster adjudication through `npm run evaluate:semantic`. Lower-cohesion accepted communities are routed to `keep`/`split` review inside the existing interpretation call, and a model `split` disposition is quarantined from publication until human curation resolves it. A later SetFit multi-label classifier may predict pain, desired outcome, objection, praise, purchase trigger, operational issue, and emotion only from a versioned analyst-curated training set. Invented labels and synthetic-only promotion are prohibited.

The Bluerose API image prewarms both pinned model revisions into `/opt/garaxe/models` during the image build and starts with remote-model loading disabled. Deployment verification must execute both pipelines with the runtime offline setting, confirm the expected 384-dimensional embedding and a valid sentiment result, and record cold/warm latency and peak RSS separately from image-build availability.

LLM work is queued only after immutable dataset membership exists. A provider candidate must name existing review IDs and return exact source substrings or offsets that satisfy `quote === original_text.slice(start, end)`. The validator rejects unknown IDs, altered/paraphrased evidence, invalid taxonomy values, cross-tenant references, unsupported conclusions, and schema/version mismatches. Rejected candidates do not weaken or overwrite deterministic artifacts; a terminal provider or validation failure explicitly activates the deterministic degraded mode.

The routing policy starts with the lowest-cost model that meets the evaluated task-quality threshold and escalates only on a recorded trigger such as schema failure, evidence-validation failure, or an approved high-ambiguity task. Provider/model selection is versioned per job so availability changes do not make a completed run irreproducible.

The deterministic pipeline remains the evidence and reproducibility authority, while validated LLM interpretation is the default vocabulary and narrative shown to curators. If interpretation is disabled, waits beyond its deadline, hits an open circuit, exhausts retries, or dead-letters, the run records the sanitized degraded-mode reason and completes with deterministic presentation. A successful deterministic artifact never implies complete model coverage. Optional monetary budget exhaustion applies only when an administrator explicitly enables verified-price spend enforcement.

After **Run analysis**, the client monitors the immutable run rather than estimating progress locally. The server derives terminal job percentage, outstanding queue and provider-capacity waits, in-flight work, fallback/failure totals, and interpreted-theme coverage from durable queue and theme records. Navigation or reload may reattach to the latest non-terminal run. Progress reaches 100% when every job is terminal; interpretation coverage remains a separate quality measure so a fallback completion cannot be mistaken for successful model intelligence.

### Quota-aware execution

Before a call, the queue consumes one request token plus estimated input/output token capacity from the provider/model buckets and acquires every configured concurrency slot. Workers claim with `FOR UPDATE SKIP LOCKED`, bounded per-organization concurrency, priority, and age-based fairness. Leases require heartbeats and may be reclaimed after expiry. Only providers with an explicitly enabled verified-price policy also reserve hierarchical integer-micro spend.

Transient timeouts, `429`, and eligible `5xx` responses retry with provider `Retry-After` when supplied or capped exponential backoff with full jitter. Authentication, authorization, invalid-request, safety, and schema-incompatibility failures do not retry blindly. Attempts are bounded; exhaustion enters the dead-letter queue and triggers deterministic fallback. Repeated provider failures open a provider/model circuit until a timed half-open probe succeeds.

## Confidence

Confidence combines evidence volume, semantic consistency, reviewer independence, time/entity/source diversity, and extraction certainty, with penalties for contradiction, duplication, dominance by one incident, and overlapping themes. User-facing labels: High, Moderate, Emerging, Weak, Insufficient. Semantic diagnostics record cluster mean similarity, weakest-member similarity, ambiguous membership, clustered coverage, and outlier count; volume never overrides a failed coherence gate.

## Implemented run status and stage values

Persisted `status` values are `queued`, `assembling_dataset`, `preprocessing`, `interpreting_clusters`, `completed`, and `failed`.

Persisted `stage` values used by the current runtime are `queued`, `assembling_dataset`, `preprocessing`, `extracting_signals`, `forming_themes`, `interpreting_clusters`, `completed`, and `failed`. Any future cancellation, review, validation, metric, insight, or report-building lifecycle value requires a schema and runtime change before it may be documented as implemented.

## Evaluation

Maintain a gold fixture set containing mixed statements, ratings-only, duplicates, multiple languages, negation, sarcasm, named staff, pros/cons fields, long/short text, and contradictory evidence. Score exact-span integrity (required 100%), cluster coherence and analyst agreement, label precision/recall once SetFit exists, unsupported-claim rate (required 0), stability across reruns, and report usefulness. Record cold/warm latency and peak RSS against the 4 vCPU/8 GB budgets. Model/config/pipeline changes require comparative evaluation before rollout.

### Root-cause-first cluster interpretation

After deterministic evidence persistence, the run enters `interpreting_clusters`, orders every validated evidence-backed theme by explicit root-cause coverage, interleaves praise with non-praise work, and creates bounded four-theme `cluster_interpretation` jobs containing all supporting feedback. The run cannot become curatable until every queued interpretation job reaches a terminal accepted or fallback state. Two bounded semantic scout jobs also search for one explicit objection and one explicit emotional driver. The pinned multilingual-e5 model ranks compact theme-plus-representative-comment candidates against governed, domain-agnostic signal definitions; only the top twelve enter each OpenCode scout prompt. Scouts return at most one detailed candidate or an honest empty result; they do not manufacture a section merely to fill the UI. All jobs have queue-position-aware deadlines so one slow or malformed response cannot discard other valid interpretations. The versioned `cluster-interpretation-v5` envelope contains a concise actionable label, aspect, evaluation, evidence-backed multi-label signal types, explicit root cause, consequence, confidence, exact review quotations, an auditable `publish`/`discard` assessment, and bounded `keep`/`split` advice. The no-thinking `root-cause-first-v9-publication-gate` prompt judges underlying feedback meaning rather than repeated wording and discards metadata, boilerplate, session context, or unrelated topics joined only by a shared template. Every discard requires a bounded reason; the immutable cluster and evidence remain stored but are omitted from publication surfaces. Ambiguous or lower-cohesion accepted clusters may receive a split recommendation and remain quarantined with their immutable evidence for a later adjudication workflow; they cannot enter the publication-ready review queue or move evidence automatically. Both Voice Map publication and the LLM curation queue require a validated LLM `publish` disposition, no unresolved `split`, and deduplicated evidence support, so raw deterministic labels, rejected context, and near-identical projections cannot leak into authoritative surfaces. The server derives immutable offsets only from an unambiguous exact quotation. Accepted output is stored under `theme.validation.interpretationCandidate` with governed identities. The presentation adapter preserves all evidence-backed `signalTypes`, so one published theme can appear in objection or emotion workspaces without losing its primary evaluation type. Human curation remains authoritative for final publication.

The same task contract is provider-independent. A local OpenAI-compatible `llama.cpp` server may be evaluated as a fallback using an official sub-500 MB GGUF artifact. Initial benchmark candidates are `HuggingFaceTB/SmolLM2-360M-Instruct-GGUF` Q8_0 (386 MB) and `Qwen/Qwen2.5-0.5B-Instruct-GGUF` Q4_K_M. Neither is approved until it passes the 100-record food fixture, exact-span and unsupported-claim gates, CPU/RAM limits, and analyst comparison.

## Current implementation

Phases 1–10 are implemented as `semantic-voice-map-v5` with `deterministic-preprocessing-v1`, `semantic-cluster-pipeline-v4`, `mutual-knn-cluster-v1`, pinned `Xenova/multilingual-e5-small` q8 ONNX embeddings, pinned `Xenova/distilbert-base-multilingual-cased-sentiments-student` q8 segment sentiment, and the default configured `llm-interpreted-theme-engine-v1` presentation engine. `deterministic-theme-engine-v1` remains the explicit degraded fallback. Current local runs no longer call the historical keyword or adaptive-frequency extractors. Positive, neutral, and negative segments form separate semantic cohorts. Mutual top-neighbour edges must clear the similarity floor in both directions; connected candidates are deterministically partitioned by mean and weakest-member coherence, require two independent reviews, and may leave claims unclustered. Every accepted cluster receives one shared dataset-derived representation, preventing one semantic community from fragmenting into unrelated phrase themes. Exact segment offsets, model and clustering versions, parameters, diagnostics, full original text, and curation decisions remain traceable.

The provider-independent hybrid candidate validator is implemented as `hybrid-candidate-validator-v1`. It treats every model envelope as untrusted, binds it to the trusted organization/project/run and immutable review membership, enforces a type-specific allowlisted taxonomy and payload limits, and accepts only exact original-text evidence. Incorrect offsets are repaired only when the exact quote occurs once; missing or ambiguous quotes are rejected. Accepted candidates remain separate proposals and never mutate deterministic artifacts.

The durable queue and bounded worker runtime are implemented behind injected provider, clock, jitter, governed-work resolver, candidate-acceptance, and price boundaries. The runtime handles lease/start/call/complete, optional verified or conservative spend reconciliation, zero-reservation capacity-priced dispatch, safe `Retry-After`, capped jitter, non-retryable failures, deadlines, disabled providers, retry exhaustion, and provider/model circuits with one half-open probe. Operational events contain only job/provider/model identifiers and sanitized dispositions. Bluerose configures the evaluated provider/model and capacity policy on the API-attached poller; target evidence remains separate until a live run proves accepted coverage. An independent continuously running worker, production policy, and production comparative evidence remain release work.
