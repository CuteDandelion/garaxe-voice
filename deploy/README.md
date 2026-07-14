# Bluerose staging deployment

This runbook deploys the repository-defined staging environment to the protected Bluerose cluster and publishes `voice.misakirose.com` through the existing Cloudflare Tunnel. It does not establish paid-beta production readiness.

## Invariants

- Use Kubernetes context `kubernetes-admin@kubernetes` on node `ubuntu`.
- Preserve namespace `portfolio`, namespace `cloudflare-tunnel`, Kubernetes core services, `portfolio.misakirose.com`, and the tunnel's terminal `http_status:404` rule.
- Deploy only immutable `ghcr.io/cutedandelion/garaxe-{api,web}:<full-git-sha>` images. The committed manifests contain an intentional tag placeholder; `render-manifests.sh` accepts only a full lowercase Git SHA and creates the temporary tree used for validation and deployment. The corresponding GHCR packages must be public before rollout; public GHCR containers permit anonymous cluster pulls.
- Never commit or print `garaxe-secrets`. `secret.example.yaml` is documentation only and is excluded from every Kustomization.
- Keep Google and LLM integration disabled until credentials, egress policy, provider approval, and operational limits are separately authorized.

## Repository verification

Run typecheck, tests, web/server builds, the full npm audit, container builds, offline-model smoke, documentation sync, manifest rendering, and complete diff review before publication. Invoke `deploy/scripts/check-manifests.sh` with `GARAXE_IMAGE_TAG` set to the source commit SHA; it renders a temporary tree and rejects unresolved image tags.

## Ordered private rollout

1. Apply `deploy/kubernetes/overlays/bluerose/platform` to create namespace, retained storage, nonsecret configuration, and network policy.
2. Run `deploy/scripts/create-bluerose-secrets.sh` on Bluerose. It refuses to rotate an existing Secret and never prints generated values.
3. Apply `deploy/kubernetes/overlays/bluerose/database` and wait for `statefulset/garaxe-postgres` readiness.
4. Delete only a completed, explicitly named previous `job/garaxe-migrate`, apply `deploy/kubernetes/overlays/bluerose/migration`, and wait for `condition=complete`.
5. Apply `deploy/kubernetes/overlays/bluerose/app`; wait for one API and two web replicas and inspect endpoints, warnings, and bounded logs.
6. Verify `/api/live`, `/api/health`, frontend `/healthz`, PostgreSQL migration checksums, forced RLS flags/policies, and retained-volume behavior before any public route exists.
7. Bootstrap `test-user@example.com` from inside the API pod, discard the returned session token, and confirm `/api/auth/status` reports `needsBootstrap:false` plus staging access enabled. The staging access key remains retrievable only from the exact Kubernetes Secret by an authorized operator.
8. Run upload, analysis, evidence traversal, curation/report/PDF, offline-model, restart, and resource checks. LLM interpretation is intentionally disabled, so the run must label deterministic fallback honestly.

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
