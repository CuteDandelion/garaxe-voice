# OpenCode Go model evaluation

Status: Baseline complete; held-out semantic gate failing
Last updated: 2026-08-12

## Method

The governed `garaxe-llm-eval-fixture-v1` contains 50 synthetic English reviews balanced across pain points, desired outcomes, objections, and emotions. Each expected signal includes an exact source substring and JavaScript character offsets. Models received five bounded batches of ten reviews. The scorer checks schema validity, allowlisted taxonomy, exact-span fidelity, precision/recall/F1, tokens, and latency. Raw completions and machine-readable scores are retained under `output/model-evaluation/` and contain no credentials.

## Results

| Model | Batch outcome | Schema | Exact spans | Precision | Recall | F1 | Tokens | Latency |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `minimax-m2.5` | 5/5 completed | Failed taxonomy validation | 22% | 56% | 56% | 56% | 9,267 | 79.9 s |
| `deepseek-v4-flash` | 3/5 completed | Incomplete | 73.3% of returned candidates | 76.7% | 46% | 57.5% | 12,738 | 143.7 s |
| `qwen3.7-plus` | 0/5 within 30 s | Incomplete | 0% | 0% | 0% | 0% | No completed usage report | 152.5 s wall time |
| `qwen3.7-plus` with thinking disabled | 5/5 completed | Passed | 20% supplied offsets; 100% exact, unique source quotes recoverable server-side | 90% | 90% | 90% | 6,321 | 76.5 s wall time |

The historical production `cluster-interpretation-v3` contract was exercised against the 100-review game-company fixture. The original four-theme prompt accepted only 14/70 candidates: 14/18 responses hit the 1,800-output-token cap and ended with `length`, taking 588.8 seconds. A one-theme control removed truncation but accepted only 9/12 candidates and averaged 11.3 seconds per theme. The compact `root-cause-first-v7-compact` prompt limits labels/aspects to six words, cause/consequence fields to 18 words, and evidence to one shortest exact quotation while instructing the complete response to stay below 1,200 tokens. Its bounded four-theme pilot accepted 12/12 candidates across 3/3 normal `stop` completions in 65.4 seconds, with 3,360 output tokens, 21.8-second mean batch latency, 21.6-second p50, and 24.6-second p95. No response reached the 1,800-token provider cap. A two-request concurrency probe then accepted 7/7 candidates in overlapping 22.2-second and 27.5-second calls; the larger response used 1,441 output tokens and still stopped normally below the hard cap. D-077 supersedes this aggregate model path for current runs; these measurements remain historical comparison data only.

Historical `cluster-interpretation-v5` retained the compact `keep`/`split` assessment and added a bounded, auditable `publish`/`discard` disposition inside the same request. The gate explicitly rejected metadata, context-only clusters, and unrelated feedback joined by shared templates. Current runs use bounded per-comment interpretation followed by deterministic primary-category grouping and do not send grouped evidence to the model.

The preliminary semantic-diagnostic embedding configuration remains gated by `semantic-diversity-gold-v1` at its historical `0.84`/`0.81` floors. Those provisional communities remain internal. D-080's generated `aspect + label` recurrence and local `0.90`/`0.88` checks are historical and superseded by D-091. Current candidate evaluation uses controlled category plus immutable original feedback embedded by the pinned local provider at a `0.84` candidate floor; exact normalized source duplicates are direct edges and all other candidates require fixed-pair adjudication. Generated labels, topics, aspects, and evidence do not affect eligibility. The controlled acceptance matrix measures candidate recall, false candidates, pair decisions, complete-link grouping, exact-once coverage, and final projection separately.

## Current category and grouping evaluation

The 2026-08-11 controlled category gate uses eight distinct comments: two clear primary pains, desired outcomes, main objections, and emotional drivers. It does not require a category absent from an input corpus. The live Demo and authenticated paths each accounted for all 8 comments exactly once, returned exact engine quotations, projected 2 comments into each required category, and preserved the expected two-comment group membership and counts.

A separate held-out rubric uses 20 paraphrased, username-stripped reports from public issue trackers. Human expectations cover actionable category, topic-family cues, merge pairs, and near-miss separation without requiring exact model prose. The evaluator reads the canonical topic before falling back to legacy aspect. The following table is a historical pre-taxonomy-v2 baseline, not current prompt-v22 proof:

The independent realistic-style gate is separate again: ten gold-free consent-safe synthetic public-style comments over food-allergen substitutions, bike-dock reservations, renter energy-monitor permissions, event-ticket transfer confirmation, and museum-audio language scope. Those topic names, exact texts, and normalized four-token shingles are preflighted against blinded-100, and the category/topic rubric is not sent to the engine. Fresh Demo and authenticated runs each projected all 10 inputs exactly once; the authenticated report snapshot preserved exact evidence for 10/10. Desktop and mobile browser checks had no page overflow. This remains a single-run disjointness and projection observation, not a claim of representative prevalence, natural customer provenance, multilingual validity, or model repeatability, and the post-run human rubric remains QA monitoring rather than a runtime veto.

| Path | Coverage / exact quote | Actionable category | Topic family | Feature-request tag | False merges | Missed merges |
|---|---:|---:|---:|---:|---:|---:|
| Demo, two runs of 10 | 20/20 | 20/20 | 17/20 visible labels | 0/7 | 3 | 3 |
| Authenticated, one run of 20 | 20/20 | 20/20 | 20/20 label plus persisted aspect | 0/7 | 1 | 3 |

In that historical baseline the paths differed in batching, and public coverage exposed labels without the persisted aspect used by authenticated topic scoring. The recurring-group variance was a product-quality failure, not an evidence or transport failure. D-090 prompt-v21 passed the guided-setup recurrence, and all three controlled Demo batches preserved exact coverage/evidence and valid PDFs. The combined oracle still stopped because migration-risk comments controlled-09/10 shared one recurring bucket while controlled-11 remained separate. Current prompt-v22 evaluation instead reads canonical topic before legacy aspect; fresh authenticated, held-out, category, and browser parity remain unproven.

## Blinded 100-comment authenticated evaluation

`npm run test:e2e:authenticated:blinded-100` measures one frozen-engine authenticated run without exposing gold labels to the analysis path. The input fixture contains 100 unique English consent-safe synthetic public-style comments and only their IDs, text, and inert source URLs. A separate reviewed rubric assigns category per comment and explicitly judges all 200 within-family pairs under the production definition of one bounded customer job plus one shared operator intervention. It contains 175 expected merges and 25 expected separations across 26 merge groups; pain has 21 comments, desired outcome 19, and objection/emotion/other 20 each. The repair changes one color-only current-friction comment from desired outcome to pain and separates issue-specific support recovery, retention lifecycle timing from retained-report scope, and compliance legal roles from processing-region facts. These decisions were derived from the input and production rule, not runtime output.

The report keeps dimensions separate rather than producing a composite score: exact-once coverage, exact-quote rate, overall category accuracy, per-category accuracy and confusion, lexical topic-cue coherence, and pairwise merge precision/recall. It includes 95% Wilson intervals as descriptive ranges only. The 100 comments are not 100 independent semantic observations because within-group paraphrases are related; 26 reviewed merge groups are the closer effective independent sample. Pairwise merge observations are also correlated, lexical cue matching is not an independent human semantic judgment, and a single frozen-engine run cannot establish provider repeatability, multilingual performance, prevalence-weighted customer validity, or production readiness.

This lane is evaluation-only QA monitoring, not a customer-runtime veto or release blocker. Its human rubric is joined only after the saved run and is never imported by the server analysis path. For a server-selected ambiguous pair, a structurally valid saved `{pairId, sameTopic}` decision is the semantic authority for that run; deterministic code still owns candidate eligibility, complete-link membership, exact-once projection, counts, ranking, evidence validation, isolation, and no-partial publication. The lane changes no taxonomy prompt, source-text planner, candidate floor or bounds, complete-link rule, evidence validator, retry/no-partial behavior, canonical persistence, or customer projection.

The fresh corrected-rubric run kept the engine byte-identical and produced 100/100 exact-once coverage, 100/100 exact quotes, 91/100 categories, and 99/100 lexical topic coherence. Merge precision was 64/68 (94.1%; descriptive Wilson interval 85.8%–97.7%) and recall was 64/175 (36.6%; 29.8%–43.9%). The four false merges joined two import-recovery comments with configuration recovery and two retention-lifecycle comments with retained-report scope. The 111 expected-but-missed pairs broke down at their first proven blocker as 24 candidate ineligibility (21.6%), 25 bounded selection (22.5%), 29 false pair adjudications (26.1%), and 33 complete-link blocks (29.7%). The corrected oracle therefore removes the earlier false appearance of perfect precision and leaves grouping quality below acceptance; no downstream live-path gate was run.

The rejected and reverted v23 intervention-level pair-contract experiment preserved 100/100 exact-once coverage and exact quotes, with 93/100 category accuracy and 97/100 topic coherence. Pair precision stayed 64/68 (94.1%) and recall stayed 64/175 (36.6%): zero delta from the corrected-rubric pair baseline. Four retention-lifecycle-timing/report-retention-scope pairs still merged. The 111 missed pairs were first blocked by 25 candidate ineligibilities, 24 bounded selections, 30 false adjudications, and 32 complete-link rejections. This fails the precision/recall gate; no downstream live path was run.

The bounded replacement repeatability command is `npm run test:e2e:authenticated:blinded-100:repeatability`. A fresh isolated run produced 100/100 coverage and exact quotes, 95/100 categories, 98/100 topic cues, 67/67 merge precision, and 67/175 recall. Its original pair jobs contained 19 reviewed expected-same decisions returned false and two reviewed-separate decisions returned true. Thirteen unique raw request batches containing those 21 errors were replayed three times before database teardown: 63/63 outputs were schema-valid, 15 pairs were stable-wrong, three varied, and three were stable-correct. Replay latency ranged from 5,976 to 7,269 ms. This supports a systematic pair-contract problem for most errors while also proving material provider variance; it does not by itself approve a prompt change.

The repeatability wrapper exists only in the verifier. It retains exact raw pair bodies, model settings, runtime IDs, and context in process memory; it never captures authorization headers, never inserts replay output into the queue or analysis tables, logs no source text, clears capture before printing diagnostics, and closes the isolated `memory://` database in `finally`.

After the frozen run completes, an ephemeral mode-`0600` ledger joins the external rubric to the retained runtime plan and pair-job records. Each final miss is attributed once to candidate ineligibility, bounded selection, pair rejection, or complete-link blocking; only neutral IDs, source hashes, request/result hashes, and decision metadata are retained.

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
