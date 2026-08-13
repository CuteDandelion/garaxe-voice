#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/garaxe-manifests.XXXXXX")"
trap 'rm -rf -- "$temporary"' EXIT
"$root/deploy/scripts/render-manifests.sh" "$temporary" >/dev/null
overlay="$temporary/kubernetes/overlays/bluerose"

kubectl kustomize "$overlay" >/dev/null
kubectl kustomize "$overlay/platform" >/dev/null
kubectl kustomize "$overlay/database" >/dev/null
kubectl kustomize "$overlay/migration" >/dev/null
kubectl kustomize "$overlay/app" >/dev/null

rendered="$temporary/bluerose.yaml"
kubectl kustomize "$overlay" >"$rendered"
grep -q 'GARAXE_LLM_ENRICHMENT_ENABLED: "true"' "$rendered"
grep -q 'name: OPENCODE_GO_API_KEY' "$rendered"
grep -q 'key: opencode-go-api-key' "$rendered"
grep -q 'SUPABASE_URL: https://ugkubygaitrlwszygbno.supabase.co' "$rendered"
grep -q 'GARAXE_ALLOWED_ORIGIN: https://voicelab.elseform.tech' "$rendered"
grep -q 'GARAXE_DATABASE_SSL_MODE: verify-full' "$rendered"
grep -q 'GARAXE_DEMO_DB_DIR: /tmp/voice-lab-demo-pgdata' "$rendered"
grep -q 'GARAXE_DATABASE_CA_FILE: /etc/voice-lab/database/prod-ca-2021.crt' "$rendered"
grep -q 'name: garaxe-database-ca' "$rendered"
grep -q 'mountPath: /etc/voice-lab/database' "$rendered"
grep -q 'name: SUPABASE_PUBLISHABLE_KEY' "$rendered"
grep -q 'key: supabase-publishable-key' "$rendered"
grep -q 'name: VOICE_LAB_ADMIN_EMAILS' "$rendered"
grep -q 'key: voice-lab-admin-emails' "$rendered"
grep -q 'name: garaxe-voice-lab-secrets' "$rendered"
if grep -q 'GARAXE_STAGING_ACCESS_KEY\|GARAXE_STAGING_AUTH_ENABLED: "true"' "$rendered"; then
  echo "Production manifests still enable legacy staging authentication." >&2
  exit 1
fi
grep -q 'cidr: 0.0.0.0/0' "$rendered"
grep -q 'port: 443' "$rendered"
grep -q 'port: 5432' "$rendered"
grep -q '^ARG VITE_SUPABASE_URL$' "$root/Dockerfile.web"
grep -q '^ARG VITE_SUPABASE_PUBLISHABLE_KEY$' "$root/Dockerfile.web"
grep -q '^COPY public ./public$' "$root/Dockerfile.web"
grep -q 'location = /index.html' "$root/deploy/docker/nginx.conf"
grep -q 'Cache-Control "no-cache, no-store, must-revalidate" always' "$root/deploy/docker/nginx.conf"
grep -q 'name: garaxe-voice-lab-migration-secrets' "$overlay/migration/migration-job.yaml"
grep -q 'VITE_SUPABASE_URL=.*vars.VITE_SUPABASE_URL' "$root/.github/workflows/publish-images.yml"
grep -q 'VITE_SUPABASE_PUBLISHABLE_KEY=.*secrets.VITE_SUPABASE_PUBLISHABLE_KEY' "$root/.github/workflows/publish-images.yml"
echo "Deployment manifests render without unresolved runtime placeholders."
