# Bluerose staging deployment

This runbook deploys the repository-defined staging environment to the protected Bluerose cluster and publishes `voice.misakirose.com` through the existing Cloudflare Tunnel. It does not establish paid-beta production readiness.

## Invariants

- Use Kubernetes context `kubernetes-admin@kubernetes` on node `ubuntu`.
- Preserve namespace `portfolio`, namespace `cloudflare-tunnel`, Kubernetes core services, `portfolio.misakirose.com`, and the tunnel's terminal `http_status:404` rule.
- Deploy only immutable `ghcr.io/cutedandelion/garaxe-{api,web}:<full-git-sha>` images. The committed manifests contain an intentional tag placeholder; `render-manifests.sh` accepts only a full lowercase Git SHA and creates the temporary tree used for validation and deployment. The corresponding GHCR packages must be public before rollout; public GHCR containers permit anonymous cluster pulls.
- Never commit or print `garaxe-secrets`. `secret.example.yaml` is documentation only and is excluded from every Kustomization.
- OpenCode Go cluster interpretation is enabled for this staging target with the evaluated `qwen3.7-plus` model, capacity limits, and spend enforcement disabled. Keep Google integration disabled until its credentials, egress policy, provider approval, and operational limits are separately authorized.
- Standard Kubernetes NetworkPolicy cannot select the OpenCode FQDN. The API may reach public IPv4 destinations only on TCP 443, with private, local, test, and reserved networks excluded; the server-owned adapter fixes the configured provider base URL. Treat broader public-HTTPS reachability as a staging exception, not a production egress design.

## Repository verification

Run typecheck, tests, web/server builds, the full npm audit, container builds, offline-model smoke, documentation sync, manifest rendering, and complete diff review before publication. Invoke `deploy/scripts/check-manifests.sh` with `GARAXE_IMAGE_TAG` set to the source commit SHA; it renders a temporary tree and rejects unresolved image tags.

## Ordered private rollout

1. Apply `deploy/kubernetes/overlays/bluerose/platform` to create namespace, retained storage, nonsecret configuration, and network policy.
2. Export `OPENCODE_GO_API_KEY` only in the operator shell on Bluerose and run `deploy/scripts/create-bluerose-secrets.sh`. It refuses to rotate an existing Secret and never prints generated values. For an existing installation whose Secret predates LLM enablement, run `deploy/scripts/add-bluerose-llm-secret.sh`; it adds the missing key but refuses implicit rotation.
3. Apply `deploy/kubernetes/overlays/bluerose/database` and wait for `statefulset/garaxe-postgres` readiness.
4. Delete only a completed, explicitly named previous `job/garaxe-migrate`, apply `deploy/kubernetes/overlays/bluerose/migration`, and wait for `condition=complete`.
5. Apply `deploy/kubernetes/overlays/bluerose/app`; wait for one API and two web replicas and inspect endpoints, warnings, and bounded logs.
6. Verify `/api/live`, `/api/health`, frontend `/healthz`, PostgreSQL migration checksums, forced RLS flags/policies, and retained-volume behavior before any public route exists.
7. Bootstrap `test-user@example.com` from inside the API pod, discard the returned session token, and confirm `/api/auth/status` reports `needsBootstrap:false` plus staging access enabled. The staging access key remains retrievable only from the exact Kubernetes Secret by an authorized operator.
8. Run upload, analysis, evidence traversal, curation/report/PDF, offline-model, restart, and resource checks. A supported-theme proof must create LLM jobs, record provider attempts, reach `llm-interpreted-theme-engine-v1`, and retain exact evidence validation. Deterministic output is acceptable only when the run records an explicit degraded reason.

## Cloudflare publication

Immediately before mutation, fetch the live zone, DNS records, tunnel, connections, and configuration. Insert this ingress rule before the final fallback without replacing unrelated rules:

```yaml
- hostname: voice.misakirose.com
  service: http://garaxe-web.garaxe.svc.cluster.local:80
```

Create a proxied CNAME `voice.misakirose.com` pointing to `9fbd3101-3691-49e1-b0f0-865d96d570fd.cfargotunnel.com`. Re-read both APIs, verify tunnel connections, then check DNS, TLS, expected Garaxe content, staging login, API mutations, and Portfolio at least three times.

## Backup and rollback

Before retaining meaningful staging data, create a PostgreSQL custom-format dump, verify it with `pg_restore --list`, copy it off Bluerose without committing it, and perform a bounded restore rehearsal into a disposable database. The retained host volume is not an independent backup.

Application rollback selects the preceding verified image SHA and reapplies the app overlay. Schema changes must remain compatible with that revision. If publication alone fails, restore the previous Cloudflare tunnel configuration and remove only the Garaxe DNS record. Never alter the protected Portfolio route during Garaxe rollback.
