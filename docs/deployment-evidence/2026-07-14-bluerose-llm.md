# Bluerose LLM interpretation evidence — 2026-07-14

Status: verified staging rollout

Scope: bounded operational evidence that the intended OpenCode Go interpretation layer is active for new runs on `voice.misakirose.com`. This is not production or paid-beta evidence, and it does not change the deterministic evidence authority or close the independent-worker, domain-aware egress, managed-secret, provider-comparison, load, or observability gates.

## Release identity and configuration

- Source and deployed API/web image tag: `791a0eda71928d6a49825f07e5be636e8b82a3c0`.
- Repository CI and immutable-image publication completed successfully for that SHA before rollout.
- The live ConfigMap enabled LLM enrichment with OpenCode Go model `qwen3.7-plus`; the API Secret contained the required additive key without exposing or rotating existing Secret values.
- API NetworkPolicy retained PostgreSQL and DNS access and added the documented public-IPv4 TCP 443 staging exception while excluding private, local, test, and reserved ranges.
- An authenticated provider preflight from the rolled API pod returned HTTP 200 and confirmed that the configured model was available. No credential value was logged or returned.

## Provider-backed run proof

- A fresh authenticated project imported 12 written verification reviews and created analysis run `0e8791a0-cb12-4c89-bc11-19f070e58c59`.
- The run visibly progressed through `preprocessing`, `extracting_signals`, and `interpreting_clusters` before completing.
- The terminal API and Voice Map projection reported state `completed`, engine and synthesis version `llm-interpreted-theme-engine-v1`, two accepted/published themes, and two OpenCode-backed interpretation candidates using `qwen3.7-plus`.
- Direct PostgreSQL evidence for the same run showed three `succeeded` LLM jobs, three leased/running/succeeded attempt sequences, zero failed or fallback jobs, provider `opencode_go`, model `qwen3.7-plus`, and two interpreted themes.
- Existing completed deterministic runs were not rewritten; the proof came from a newly created immutable run.

## External and protected-service checks

- Three public HTTPS requests to the Garaxe root and three to `/api/auth/status` returned 200 with successful TLS verification.
- API was 1/1 ready and web was 2/2 ready on the release SHA with zero pod restarts. A bounded ten-minute API log scan found no fatal, panic, unhandled, or provider-request-failure matches.
- Three public HTTPS requests to `portfolio.misakirose.com` returned 200 with successful TLS verification; Portfolio remained 2/2 ready.
- Cloudflared remained 2/2 ready. The Kubernetes node remained Ready with no current cluster events; point-in-time usage was approximately 2% CPU and 35% memory, with the API at approximately 3 millicores and 588 MiB.

## Remaining limits

- Standard Kubernetes NetworkPolicy cannot restrict HTTPS egress by provider FQDN. Paid-beta production still requires domain-aware egress control or an equivalent enforcement boundary.
- The API-attached poller is staging architecture. Independent durable workers, managed secret rotation, sustained provider monitoring, comparative model evidence, and the 100/1,000-review benchmark remain release work.
- The checks above are bounded rollout observations, not load, availability-SLO, disaster-recovery, or ongoing monitoring evidence.
