# SQL-vector incremental experiment

Status: local-only prototype; no product runtime, migration, or production behavior change.

The disposable Postgres 17.6 database provided pgvector 0.8.2. The prototype stores canonical 384-dimension embeddings and topic representatives by project and pinned model version, and retrieves nearest representatives through an HNSW cosine index. Because 30 rows are below PostgreSQL's natural approximate-index crossover, the experiment session disables sequential scan and explicit sort so `EXPLAIN` proves the real HNSW path rather than measuring a sequential substitute.

Only an identical canonical content hash attaches without semantic judgment. Vector matches at the existing 0.84 eligibility floor remain candidates for the existing saved adjudication contract; no new semantic threshold was introduced.

Official references:

- Supabase vector columns: <https://supabase.com/docs/guides/ai/vector-columns>
- Supabase HNSW indexes: <https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes>
- Extension version pinning change: <https://supabase.com/changelog/extension-version-pinning-ignored>

## Five-run result

All five runs used the HNSW plan and produced identical topic, evidence, and provenance fingerprints.

| path | candidates or retrieved rows | judgment candidates | request equivalents | wall p50 / p95 | CPU p50 / p95 | RSS delta p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| full 30 | 435 comparisons | 65 | 19 | 115.2 / 148.1 ms | 72.5 / 187.7 ms | 0.77 / 62.8 MiB |
| SQL incremental 20 | 52 retrieved | 52 | 15 | 234.2 / 285.4 ms | 70.0 / 525.2 ms | 1.02 / 42.0 MiB |

Per-review indexed retrieval had a within-run p50 of 2.47–2.99 ms and p95 of 4.17–5.15 ms. The incremental path created eight new topics and made no hash-identical automatic attachments. Its request-equivalent count fell by four, but transaction and query overhead made this 30-row local path slower overall. Provider latency was not measured.

## Bounded live-provider result

The one authorized sequential validation used `qwen3.7-plus`, the same pinned 30-review corpus, 65 full-rebuild candidates, and the exact 52 SQL-vector incremental candidates. It made 13 full-rebuild and 11 incremental adjudication requests with no retries or throttle errors.

| path | provider calls | serialized queue wait max / total | model duration | fully covered evidence / completion | CPU | peak RSS delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| full rebuild | 13 | 53.83 / 350.28 s | 58.02 s | 58.06 / 58.06 s | 1.02 s | 2.72 MiB |
| SQL incremental | 11 | 44.86 / 245.65 s | 50.79 s | 50.87 / 50.87 s | 1.27 s | 169.38 MiB |

The live result is rejected: evidence and provenance fingerprints were exact, but topic membership differed for one pair. The full rebuild kept `independent-03` and `independent-04` separate while the incremental path merged them. The equivalence gate returned `aborted: true`; no larger-scale or concurrent benchmark followed.

This does not support a production migration or scale-performance claim. A future experiment would first need a shared adjudication/lineage contract that makes the full and incremental paths topic-equivalent without changing the saved evidence contract.
