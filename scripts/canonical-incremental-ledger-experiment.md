# Canonical incremental decision-ledger experiment

Status: provider-free local experiment only. It does not change product runtime, migrations, provider configuration, or production behavior.

The experiment persists canonical review embeddings, eligible review-pair IDs, and one boolean decision per pair in an isolated PGlite ledger. A saved 10-review run contributes its existing six decisions. Appended reviews generate only canonical new-to-existing and new-to-new review pairs at the unchanged `0.84` cosine floor. Full and incremental paths then load their persisted ledgers and use the same grouping algorithm.

No representative or topic proxy IDs are used. The deterministic oracle stands in for a previously validated saved decision; no provider is called.

## Five-run result

Every append partition (`20`, `10+10`, and `5+5+10`) was exact in all five runs: topic, evidence, provenance, and the complete 65-pair candidate ledger. Each pair was adjudicated once; proxy-pair count and provider-call count were zero.

| path | comparisons | newly adjudicated pairs | request equivalents | wall p50 / p95 | CPU p50 / p95 | RSS delta p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| full rebuild 30 | 435 | 65 | 13 | 182.22 / 284.23 ms | 399.95 / 636.23 ms | 0.28 / 5.47 MiB |
| append 20 | 390 | 59 | 12 | 138.44 / 163.94 ms | 241.46 / 468.87 ms | 0.06 / 0.44 MiB |
| append 10+10 | 390 | 59 | 12 coalesced; 13 partition-bound | 145.58 / 186.76 ms | 544.11 / 639.77 ms | 0.13 / 1.55 MiB |
| append 5+5+10 | 390 | 59 | 12 coalesced; 13 partition-bound | 135.46 / 195.08 ms | 500.83 / 540.00 ms | 0.02 / 0.39 MiB |

The saved initial ledger contains six decisions, leaving 59 unseen canonical pairs after the append. Coalescing those pairs reduces five-pair request equivalents from 13 to 12; partition-bound batching can erase that one-request saving. These are local persistence/CPU measurements, not provider timings.

## Decision

One bounded live-provider validity run is justified only if each canonical pair is adjudicated once and the resulting immutable ledger is replayed by both full and incremental projections. The experiment supports that correctness check, not a provider-speed or scale claim. Abort on any topic, evidence, provenance, candidate-ledger, retry, or schema mismatch; do not proceed to larger or concurrent testing from this result alone.

## Bounded live attempt

The one authorized attempt planned 12 sequential adjudication requests for the 59 unseen canonical pairs. After roughly 148 seconds, the provider returned HTTP 503 `PROVIDER_UNAVAILABLE` with no retry-after value. The harness performed no retry and stopped before creating either projection ledger, so topic, evidence, provenance, and ledger equivalence were not evaluated.

The original helper reported counters only after all batches succeeded, so the exact number of completed calls, partial model duration, CPU, and RSS are not recoverable from that failed process. That attempt did not justify a scale or concurrency experiment. A further live validity attempt required separate approval after provider availability and failure-safe partial diagnostics were addressed.

## Approved failure-safe retry

Before retrying, the local harness gained failure-safe attempted/completed counters, per-call queue/model timing, terminal provider status, and projection-ledger cleanup state. A fake third-call HTTP 503 regression proves these diagnostics survive failure without creating projection ledgers.

The one approved retry completed all 12 sequential `qwen3.7-plus` calls for the 59 unseen canonical pairs. It made no retry and returned no throttle/error status. Both projections replayed the same six saved plus 59 newly adjudicated decisions, closed their isolated ledgers, and produced exact topic, evidence, provenance, and 65-pair ledger fingerprints.

| metric | provider/shared | full projection | incremental projection |
| --- | ---: | ---: | ---: |
| completed / planned calls | 12 / 12 | — | — |
| model duration | 54.241 s | — | — |
| max / cumulative serialized wait | 50.870 / 313.831 s | — | — |
| first fully covered evidence | — | 56.393 s | 55.609 s |
| completion | — | 56.393 s | 55.609 s |
| CPU | 1.163 s | 7.025 s | 4.725 s |
| peak RSS delta | 102.27 MiB | 1,133.56 MiB | 111.14 MiB |
| retries | 0 | — | — |
| cleanup | — | closed | closed |

The serialized-wait values measure batches waiting behind earlier calls in this isolated harness, not production durable-queue latency. First evidence equals completion because the experiment intentionally publishes no partial result. This validates semantic equivalence, not a performance win. One bounded scale experiment is now justified for correctness/resource characterization, but no scale or concurrency run was started.
