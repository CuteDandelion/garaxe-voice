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
echo "Deployment manifests render without unresolved runtime placeholders."
