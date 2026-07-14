# Garaxe Voice Intelligence

Specification-first workspace for an evidence-backed customer-review analysis product. The product turns customer-authorized feedback into a traceable Voice Map: strategic conclusions, recurring themes, exact quotes, and action-ready recommendations.

Start with [docs/product-spec.md](docs/product-spec.md), then read [AGENTS.md](AGENTS.md). No implementation should begin until the readiness conditions in those documents are satisfied.

Validate the documentation baseline with:

```sh
./scripts/check-docs-sync.sh
```

## Run the MVP

```sh
npm install --cache /tmp/garaxe-npm-cache
npm run dev
```

Quality gates:

```sh
npm run typecheck
npm test
npm run build
./scripts/check-docs-sync.sh
```

The repository also contains CI verification and immutable-image publication workflows under `.github/workflows/`. Deployment manifests and the operator runbook live under `deploy/`; they target the Bluerose staging cluster and `voice.misakirose.com`, not the paid-beta production environment.

The current MVP implements the responsive editorial shell, persistent CSV/XLSX/JSON/paste ingestion and review inventory, immutable versioned analysis runs, exact-span signals, CPU semantic clustering, governed LLM cluster interpretation, Read/Investigate Voice Maps, append-only human curation with publication gates, immutable report versions, evidence-backed PDF export, organization-scoped sessions, and a managed-PostgreSQL adapter. Google OAuth, account/location discovery, explicit location selection, complete review sync, refresh/revoke, and access diagnostics are implemented and contract-tested; provider approval and live-profile proof remain external readiness gates.

Local development starts both the web app and API. The API persists an embedded PostgreSQL-compatible database under `.local/pgdata`; override it with `GARAXE_DB_DIR` when needed. Set `DATABASE_URL` to use the managed PostgreSQL pool adapter, then run `npm run migrate` before rollout. The checksum-verified migration runner serializes deploys with a PostgreSQL advisory lock. A fresh installation opens a one-time owner setup; after the first owner exists, public bootstrap closes and every workspace resource requires a valid session.

After a local server restart, an existing owner can use the loopback-only “Resume local workspace” form. That recovery endpoint returns 404 in production and is not a substitute for the production identity provider. All Vitest runs force `GARAXE_DB_DIR=memory://` and cannot truncate `.local/pgdata`.

The Bluerose staging tier uses a separate explicit access-key route for `test-user@example.com`. It is enabled only when the deployment tier is `staging`, the feature flag is true, and a generated access key of at least 32 characters is supplied through a Kubernetes Secret. This is a demo continuity mechanism, not a production identity provider.

The current analysis pipeline is reproducible but not model-free. Deterministic preprocessing freezes dataset membership and exact evidence spans; pinned local ONNX models provide sentiment and embeddings; mutual-KNN communities and coherence gates form candidate themes; and the default local interpretation path uses the evaluated Qwen no-thinking configuration behind the governed LLM queue. Invalid or unavailable model output settles into an explicitly labelled deterministic fallback, never an unsupported claim. Run-scoped curation records approve, reject, edit, pin, exclude, merge, split, and mark-ready decisions as an append-only audit stream. Ready Read/Investigate views use the human-approved projection while retaining immutable machine artifacts and model provenance underneath.

Next: complete and verify the Bluerose staging rollout, then apply the forced-RLS migration to a live managed database with a least-privilege runtime role and KMS-backed key rotation and prove the implemented Google OAuth/sync flow against an approved project plus a real verified managed profile.

See `docs/paid-beta-readiness.md` for the explicit release gate. The repository is a complete local MVP; the connected paid beta remains conditional on deployment, identity-provider, Google approval, and live-profile evidence.
