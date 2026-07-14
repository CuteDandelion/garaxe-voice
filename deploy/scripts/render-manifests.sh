#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image_tag="${GARAXE_IMAGE_TAG:-}"
destination="${1:-}"

if [[ ! "$image_tag" =~ ^[0-9a-f]{40}$ ]]; then
  echo "GARAXE_IMAGE_TAG must be a full lowercase 40-character Git SHA." >&2
  exit 1
fi
if [[ -z "$destination" ]]; then
  echo "usage: GARAXE_IMAGE_TAG=<full-sha> $0 OUTPUT_DIRECTORY" >&2
  exit 1
fi
if [[ -e "$destination/kubernetes" ]]; then
  echo "$destination/kubernetes already exists; refusing to overwrite it." >&2
  exit 1
fi

mkdir -p "$destination"
cp -R "$root/deploy/kubernetes" "$destination/kubernetes"
find "$destination/kubernetes" -type f -name '*.yaml' ! -name 'secret.example.yaml' \
  -exec sed -i.bak "s/REPLACE_WITH_GIT_SHA/${image_tag}/g" {} +
find "$destination/kubernetes" -type f -name '*.bak' -delete

if grep -R "REPLACE_WITH_GIT_SHA" --exclude='secret.example.yaml' "$destination/kubernetes" >/dev/null; then
  echo "Rendered deployment still contains unresolved image placeholders." >&2
  exit 1
fi

echo "$destination/kubernetes"
