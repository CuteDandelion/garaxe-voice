# Bluerose staging deployment evidence — 2026-07-14

Status: verified staging deployment

Scope: bounded operational evidence for `voice.misakirose.com`. This is not paid-beta production evidence and does not close the managed PostgreSQL, production identity, Google approval/live-profile, durable-worker, managed-backup, observability, security-assessment, or disaster-recovery gates.

## Release identity

- Source and deployed image tag: `3aaddeacdd3d32e7ed49878b699778c84f209347`.
- GitHub CI and immutable-image publication completed successfully for that SHA.
- API and web manifests use public, anonymously pullable Linux/amd64 GHCR images. PostgreSQL uses its repository-pinned digest.
- Final application rollback revision: API 3 and web 3, both restored to the release SHA after the controlled rehearsal.

## Cluster and data proof

- Namespace `garaxe` contains one ready API replica, two ready web replicas, one ready PostgreSQL StatefulSet pod, and one completed migration Job. All application services are ClusterIP-only.
- The 50 GiB static PVC is bound with retain policy. Five NetworkPolicies provide namespace default-deny plus the explicit web, API, migration, and PostgreSQL paths.
- Both versioned migrations have 64-character checksums. All 22 tenant-owned tables have forced RLS and all 22 expected policies exist.
- `test-user@example.com` was bootstrapped once; public bootstrap subsequently returned conflict and `/api/auth/status` reported `needsBootstrap:false` with staging access enabled.
- The authenticated private proof created one project, imported four reviews, completed analysis with two themes and four exact evidence links, made one human-approved theme publishable, created report version 1, and rendered an 8,699-byte PDF.
- PostgreSQL and API pods were replaced independently. The database still contained one owner, one project, and one report; staging login returned 201 and the persisted report returned 200.
- A PostgreSQL custom-format dump with SHA-256 `157b66e417e63234c2ce1e60fa4f7d80f95caaacccf47872f77062aa6ca1e7d0` restored into a disposable database with matching `1/1/1` bounded counts and was copied off Bluerose. This proves the rehearsal, not an ongoing backup system.

## Rollback proof

- API and web were rolled to prior immutable SHA `2c93bf8262d8c040a1ec216e18411b0e7db53efc`.
- Staging login and the persisted report both remained available on the prior application images.
- `kubectl rollout undo` restored API and web to `3aaddeacdd3d32e7ed49878b699778c84f209347`; all replicas became ready with zero restarts.

## Cloudflare and external proof

- Tunnel `bluerose-vps-tunnel` remained healthy with two connections.
- Configuration version 46 retained `portfolio.misakirose.com`, added `voice.misakirose.com` to `garaxe-web.garaxe.svc.cluster.local:80`, and retained the terminal `http_status:404` rule in that order.
- The proxied `voice.misakirose.com` CNAME was re-read after creation and targets the existing tunnel.
- Three public HTTPS requests to the Garaxe root and three to `/api/health` returned 200 with successful TLS verification.
- Public staging login returned 201; the persisted report and its PDF returned 200 through Cloudflare.
- Three post-publication HTTPS requests to `portfolio.misakirose.com` returned 200 with successful TLS verification. Portfolio remained 2/2 ready and cloudflared remained 2/2 ready.

## Bounded runtime observation

- At handoff, Garaxe pods showed zero restarts and no error/fatal/panic/exception lines in their bounded log tails; recent namespace events were normal rollout events.
- Observed pod usage was approximately 1 millicore/17 MiB for API, 12 millicores/22 MiB for PostgreSQL, and 1 millicore/7 MiB per web replica. The single node was approximately 1% CPU and 33% memory at that instant.
- These point-in-time observations are not load, latency, alerting, or capacity evidence. The 100/1,000-review benchmark and managed observability gates remain open.
