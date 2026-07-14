#!/usr/bin/env bash
set -euo pipefail
set +x

expected_context="kubernetes-admin@kubernetes"
if [[ "$(kubectl config current-context)" != "$expected_context" ]]; then
  echo "Refusing to update secrets outside $expected_context." >&2
  exit 1
fi

if [[ -z ${OPENCODE_GO_API_KEY:-} ]]; then
  echo "OPENCODE_GO_API_KEY is required." >&2
  exit 1
fi

if ! kubectl get secret --namespace garaxe garaxe-secrets >/dev/null 2>&1; then
  echo "garaxe/garaxe-secrets does not exist." >&2
  exit 1
fi

if [[ -n $(kubectl get secret --namespace garaxe garaxe-secrets -o jsonpath='{.data.opencode-go-api-key}') ]]; then
  echo "garaxe/garaxe-secrets already has opencode-go-api-key; refusing implicit rotation." >&2
  exit 1
fi

encoded="$(printf '%s' "$OPENCODE_GO_API_KEY" | base64 | tr -d '\n')"
printf '{"data":{"opencode-go-api-key":"%s"}}' "$encoded" \
  | kubectl patch secret --namespace garaxe garaxe-secrets --type merge --patch-file /dev/stdin >/dev/null

unset encoded OPENCODE_GO_API_KEY
echo "Added opencode-go-api-key to garaxe/garaxe-secrets without printing it."
