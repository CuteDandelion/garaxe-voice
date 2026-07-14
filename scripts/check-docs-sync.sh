#!/bin/sh
set -eu

required_files="
README.md
AGENTS.md
docs/product-spec.md
docs/architecture.md
docs/design-system.md
docs/data-and-api-contracts.md
docs/analysis-pipeline.md
docs/engineering-standards.md
docs/testing-and-delivery.md
docs/security-and-operations.md
docs/decisions.md
docs/open-questions.md
docs/traceability-matrix.md
docs/model-evaluation.md
docs/paid-beta-readiness.md
server/migrations/001_tenant_rls.sql
docs/reference-assets/garaxe-voice-of-customer/README.md
docs/reference-assets/garaxe-voice-of-customer/dashboard-primary-reference.png
docs/reference-assets/garaxe-voice-of-customer/live-page-full.png
Dockerfile.api
Dockerfile.web
.github/workflows/ci.yml
.github/workflows/publish-images.yml
deploy/README.md
deploy/kubernetes/overlays/bluerose/kustomization.yaml
deploy/scripts/check-manifests.sh
deploy/scripts/render-manifests.sh
"

failed=0
for file in $required_files; do
  if [ ! -f "$file" ]; then
    echo "missing required file: $file" >&2
    failed=1
  fi
done

governed_docs="
docs/product-spec.md
docs/architecture.md
docs/design-system.md
docs/data-and-api-contracts.md
docs/analysis-pipeline.md
docs/engineering-standards.md
docs/testing-and-delivery.md
docs/security-and-operations.md
docs/decisions.md
docs/open-questions.md
docs/traceability-matrix.md
docs/paid-beta-readiness.md
"

for file in $governed_docs; do
  if ! grep -q "$file" AGENTS.md 2>/dev/null; then
    echo "AGENTS.md must reference governed document: $file" >&2
    failed=1
  fi
done

if ! grep -q "check-docs-sync.sh" AGENTS.md 2>/dev/null; then
  echo "AGENTS.md must require the docs sync check" >&2
  failed=1
fi

if ! grep -q "Documentation audit" AGENTS.md 2>/dev/null; then
  echo "AGENTS.md must enforce a factual documentation audit" >&2
  failed=1
fi

if ! grep -q "Git hygiene" AGENTS.md 2>/dev/null; then
  echo "AGENTS.md must enforce Git hygiene" >&2
  failed=1
fi

if grep -R -n -E 'TBD|TO[ -]?DO|PLACEHOLDER|FIXME' AGENTS.md docs/*.md >/tmp/garaxe-doc-placeholders.txt 2>/dev/null; then
  echo "unresolved placeholders found:" >&2
  cat /tmp/garaxe-doc-placeholders.txt >&2
  failed=1
fi

: >/tmp/garaxe-doc-obsolete-claims.txt
obsolete_found=0
if grep -n -E 'current analysis pipeline is deterministic and model-free' README.md >>/tmp/garaxe-doc-obsolete-claims.txt 2>/dev/null; then obsolete_found=1; fi
if grep -n -E 'intentionally have no auth yet' server/app.ts >>/tmp/garaxe-doc-obsolete-claims.txt 2>/dev/null; then obsolete_found=1; fi
if grep -n -E 'Production authorization must scope every route' docs/data-and-api-contracts.md >>/tmp/garaxe-doc-obsolete-claims.txt 2>/dev/null; then obsolete_found=1; fi
if grep -n -E 'Production analysis uses.*deterministic spherical clustering' docs/product-spec.md >>/tmp/garaxe-doc-obsolete-claims.txt 2>/dev/null; then obsolete_found=1; fi
if grep -n -E 'Merge-blocking E2E covers' docs/testing-and-delivery.md >>/tmp/garaxe-doc-obsolete-claims.txt 2>/dev/null; then obsolete_found=1; fi
if grep -n -E 'There is currently no repository CI workflow|not yet enforced by a repository CI workflow' docs/testing-and-delivery.md docs/paid-beta-readiness.md >>/tmp/garaxe-doc-obsolete-claims.txt 2>/dev/null; then obsolete_found=1; fi
if [ "$obsolete_found" -ne 0 ]; then
  echo "obsolete or contradictory documentation claims found:" >&2
  cat /tmp/garaxe-doc-obsolete-claims.txt >&2
  failed=1
fi

rls_table_count=$(grep -c 'ENABLE ROW LEVEL SECURITY' server/migrations/001_tenant_rls.sql 2>/dev/null || true)
rls_docs="docs/architecture.md docs/data-and-api-contracts.md docs/testing-and-delivery.md docs/security-and-operations.md docs/paid-beta-readiness.md"
if [ "$rls_table_count" -eq 0 ]; then
  echo "server/migrations/001_tenant_rls.sql is missing, unreadable, or contains no RLS table declarations" >&2
  failed=1
else
  for file in $rls_docs; do
    if ! grep -q "all $rls_table_count tenant-owned tables" "$file"; then
      echo "$file must match the migration's $rls_table_count RLS-enabled tables" >&2
      failed=1
    fi
  done
fi

if grep -q '^Status: Proposed baseline' docs/data-and-api-contracts.md docs/analysis-pipeline.md; then
  echo "implemented contract and pipeline documents cannot retain Proposed baseline status" >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "Documentation baseline, governed references, known contradiction checks, and RLS counts are synchronized."
