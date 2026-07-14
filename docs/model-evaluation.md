# OpenCode Go model evaluation

Status: Completed baseline and bounded production-schema pilot
Last updated: 2026-07-14

## Method

The governed `garaxe-llm-eval-fixture-v1` contains 50 synthetic English reviews balanced across pain points, desired outcomes, objections, and emotions. Each expected signal includes an exact source substring and JavaScript character offsets. Models received five bounded batches of ten reviews. The scorer checks schema validity, allowlisted taxonomy, exact-span fidelity, precision/recall/F1, tokens, and latency. Raw completions and machine-readable scores are retained under `output/model-evaluation/` and contain no credentials.

## Results

| Model | Batch outcome | Schema | Exact spans | Precision | Recall | F1 | Tokens | Latency |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `minimax-m2.5` | 5/5 completed | Failed taxonomy validation | 22% | 56% | 56% | 56% | 9,267 | 79.9 s |
| `deepseek-v4-flash` | 3/5 completed | Incomplete | 73.3% of returned candidates | 76.7% | 46% | 57.5% | 12,738 | 143.7 s |
| `qwen3.7-plus` | 0/5 within 30 s | Incomplete | 0% | 0% | 0% | 0% | No completed usage report | 152.5 s wall time |
| `qwen3.7-plus` with thinking disabled | 5/5 completed | Passed | 20% supplied offsets; 100% exact, unique source quotes recoverable server-side | 90% | 90% | 90% | 6,321 | 76.5 s wall time |

The production `cluster-interpretation-v3` contract was then exercised against the 100-review game-company fixture. The original four-theme prompt accepted only 14/70 candidates: 14/18 responses hit the 1,800-output-token cap and ended with `length`, taking 588.8 seconds. A one-theme control removed truncation but accepted only 9/12 candidates and averaged 11.3 seconds per theme. The compact `root-cause-first-v7-compact` prompt limits labels/aspects to six words, cause/consequence fields to 18 words, and evidence to one shortest exact quotation while instructing the complete response to stay below 1,200 tokens. Its bounded four-theme pilot accepted 12/12 candidates across 3/3 normal `stop` completions in 65.4 seconds, with 3,360 output tokens, 21.8-second mean batch latency, 21.6-second p50, and 24.6-second p95. No response reached the 1,800-token provider cap. A two-request concurrency probe then accepted 7/7 candidates in overlapping 22.2-second and 27.5-second calls; the larger response used 1,441 output tokens and still stopped normally below the hard cap.

`cluster-interpretation-v5` retains the compact `keep`/`split` assessment and adds a bounded, auditable `publish`/`discard` disposition inside the same request. The gate explicitly rejects metadata, context-only clusters, and unrelated feedback joined by shared templates. Local validation includes an adversarial repeated-boilerplate fixture, but a fresh pattern-diverse external accuracy, latency, and truncation comparison remains required before treating earlier timing numbers as v5 performance evidence.

The current embedding configuration is also gated by `semantic-diversity-gold-v1`: 24 deliberately dissimilar paraphrases across eight unrelated business domains. At the selected `0.84` mutual-KNN/mean floor and `0.81` weakest-member floor, the pinned current-runtime model scored 80.95% purity, 50% paraphrase-pair recall, 87.5% assignment coverage, and a 2.78% cross-topic merge rate. All mixed communities were marked for grouping adjudication. This fixture prevents syntactically repetitive demo data from overstating semantic quality; it is a bounded regression gate, not a claim of external validity.

## Decision

Disabling Qwen thinking cut this fixture's wall time by 49.8%, completed every batch, and materially improved taxonomy accuracy. All 50 returned quotations were exact, unique substrings of their immutable reviews, so the current server's deterministic unique-span recovery can establish trusted offsets; only 10 of the 50 model-supplied offset pairs were independently correct. This supports no-thinking as the default local inference mode and the compact prompt as the bounded cluster contract. It does not complete the paid-beta promotion gate: the full current-schema corpus, multilingual evidence, ambiguous repeated quotations, unsupported-claim audit, provider terms, cost, and analyst preference still require governed comparison.

`minimax-m2.5` remains not evidence-safe, `deepseek-v4-flash` misses bounded completion, and reasoning-default `qwen3.7-plus` is unsuitable under the tested latency budget. Deterministic evidence and fallback remain authoritative regardless of model mode.

Future promotion requires all of:

- 100% schema validity after provider-output parsing;
- 100% exact-span fidelity after deterministic unique-span recovery;
- at least 80% precision and 75% recall on the baseline plus multilingual, negation, and sarcasm fixtures;
- at least 99% bounded batch completion within the configured worker deadline;
- documented provider pricing/quota and privacy terms;
- queue budget, rate bucket, circuit, and deterministic-fallback tests remaining green.

The current queue/worker implementation can evaluate and accept future candidates without changing deterministic publication semantics.
