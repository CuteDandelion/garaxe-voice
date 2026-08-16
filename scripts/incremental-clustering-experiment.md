# Incremental clustering experiment

Status: local-only prototype; no production behavior or schema change.

## Plan

1. Use the repository's realistic incremental fixture for ten initial reviews and ten paraphrased follow-ups, then append the independent ten-review fixture as five new topics. Preserve source, date, entity, URL, and missing-date provenance.
2. Run the current full-project shape: embed all 30 reviews, compare every pair, and adjudicate every embedding-eligible pair with a deterministic local judge.
3. Persist the first run's normalized embeddings, topic representatives, evidence hashes, provenance, and review-to-topic lineage in one isolated in-memory PGlite transaction.
4. Run the incremental shape on only the appended 20 reviews: embed each once, compare it with persisted representatives, adjudicate eligible assignments, update representatives, and persist all appended embeddings/lineage/final representatives in one transaction.
5. Compare exact topic membership and evidence IDs, then report embedding/model-call equivalents, candidate comparisons, CPU, peak RSS delta, and wall time.

The prototype succeeds only if the full and incremental fingerprints are byte-identical and all 30 evidence IDs occur exactly once. Timings are descriptive local measurements; a production design is not recommended from speed alone.

The pinned differential replay uses `Xenova/multilingual-e5-small` at the repository-pinned revision/dtype with remote loading disabled. Before either path runs, it embeds each unique normalized review independently and caches the vector by content hash plus pinned model version. Full and incremental paths read those same immutable vectors, so input batch composition cannot change cosine eligibility. It persists the complete fixed pair-decision ledger, gives full and incremental outputs one transaction each, and reloads initial embeddings/representatives/lineage before the append. A topic mismatch rejects the experiment even when evidence and provenance remain exact.

## Pinned differential result

Five warm offline replays produced identical topic, evidence, and provenance fingerprints in every run. Canonicalization made 30 local embedding inferences once and both compared paths then used cache hits.

| path | candidates | saved decisions | request equivalents | wall p50 / p95 | CPU p50 / p95 | RSS delta p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| full 30 | 435 | 65 | 19 | 130.8 / 148.1 ms | 124.1 / 157.6 ms | 0.91 / 1.72 MiB |
| incremental 20 | 227 | 70 | 18 | 87.0 / 119.1 ms | 104.6 / 171.3 ms | 0.48 / 1.39 MiB |
| shared canonicalization | — | — | 30 local embedding calls | 411.2 / 479.1 ms | 1,451.0 / 1,665.1 ms | 1.94 / 31.97 MiB |

Percentiles use the nearest observed value from five samples. The fixed saved-decision replay makes no provider calls; request equivalents estimate the existing five-item model batches and are not provider timings.

## Bounded live-provider validity result

One sequential full-30 path followed by one incremental-20 path used fresh in-memory PGlite state and the production pair prompt/validator. Retries were disabled and neither path reported a retry or throttle. The experiment was rejected because topic membership differed even though evidence and provenance remained byte-identical.

| path | provider calls | longest serial queue wait | model duration | fully covered evidence | completion | CPU | RSS delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full 30 | 13 | 54.05 s | 58.40 s | 58.40 s | 58.46 s | 2.66 s | 18.53 MiB |
| incremental 20 | 14 | 57.12 s | 61.51 s | 61.56 s | 61.56 s | 1.94 s | 0 MiB sampled delta |

The full path persisted 19 topic representatives; incremental persisted 18. This failed validity result does not justify larger provider-backed benchmarks or a production implementation.

## Resource guard recommendation

Before the current quadratic path allocates a similarity matrix or same-category pair ledger, estimate segment count, pair count, and raw matrix bytes. Fail closed with a retryable resource-capacity error when a deployment-owned memory/work ceiling would be exceeded. The ceiling must come from measured worker capacity and remain an operational admission policy, not an arbitrary customer-facing review limit.
