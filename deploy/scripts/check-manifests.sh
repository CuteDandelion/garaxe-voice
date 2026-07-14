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
grep -q 'cidr: 0.0.0.0/0' "$rendered"
grep -q 'port: 443' "$rendered"
echo "Deployment manifests render without unresolved runtime placeholders."
