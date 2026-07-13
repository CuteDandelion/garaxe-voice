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
docs/reference-assets/garaxe-voice-of-customer/README.md
docs/reference-assets/garaxe-voice-of-customer/dashboard-primary-reference.png
docs/reference-assets/garaxe-voice-of-customer/live-page-full.png
"

failed=0
for file in $required_files; do
  if [ ! -f "$file" ]; then
    echo "missing required file: $file" >&2
    failed=1
  fi
done

if ! grep -q "docs/product-spec.md" AGENTS.md 2>/dev/null; then
  echo "AGENTS.md must reference docs/product-spec.md" >&2
  failed=1
fi

if ! grep -q "check-docs-sync.sh" AGENTS.md 2>/dev/null; then
  echo "AGENTS.md must require the docs sync check" >&2
  failed=1
fi

if grep -R -n -E 'TBD|TO[ -]?DO|PLACEHOLDER|FIXME' AGENTS.md docs/*.md >/tmp/garaxe-doc-placeholders.txt 2>/dev/null; then
  echo "unresolved placeholders found:" >&2
  cat /tmp/garaxe-doc-placeholders.txt >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "Documentation baseline is complete and internally linked."
