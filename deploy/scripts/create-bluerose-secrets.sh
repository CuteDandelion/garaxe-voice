#!/usr/bin/env bash
set -euo pipefail
set +x

expected_context="kubernetes-admin@kubernetes"
if [[ "$(kubectl config current-context)" != "$expected_context" ]]; then
  echo "Refusing to create secrets outside $expected_context." >&2
  exit 1
fi

if kubectl get secret --namespace garaxe garaxe-secrets >/dev/null 2>&1; then
  echo "garaxe/garaxe-secrets already exists; refusing implicit credential rotation." >&2
  exit 1
fi

postgres_password="$(openssl rand -hex 32)"
staging_access_key="$(openssl rand -hex 32)"
database_url="postgresql://garaxe_app:${postgres_password}@garaxe-postgres.garaxe.svc.cluster.local:5432/garaxe"

kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: garaxe-secrets
  namespace: garaxe
type: Opaque
stringData:
  postgres-password: "${postgres_password}"
  database-url: "${database_url}"
  staging-access-key: "${staging_access_key}"
EOF

unset postgres_password staging_access_key database_url
echo "Created garaxe/garaxe-secrets without printing secret values."
