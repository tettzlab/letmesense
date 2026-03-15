#!/usr/bin/env bash
set -euo pipefail

# Check for non-permissive licenses in production dependencies
# Usage: ./scripts/check-licenses.sh

echo "Checking for non-permissive licenses in production dependencies..."
echo ""

# Get all unique licenses
echo "=== All licenses found ==="
pnpm licenses list --prod 2>/dev/null | tail -n +3 | awk -F'│' '{print $3}' | sort -u | grep -v '^$' | grep -v '^\s*$'

echo ""
echo "=== Checking for problematic licenses ==="

# Check for AGPL, SSPL, or other strong copyleft (excluding LGPL which is OK for dynamic linking)
PROBLEMATIC=$(pnpm licenses list --prod --json 2>/dev/null | jq -r '
  to_entries[] |
  select(.key | test("AGPL|SSPL|GPL-3|GPL-2"; "i")) |
  select(.key | test("LGPL|MIT OR GPL|Apache OR GPL"; "i") | not) |
  "\(.key): \(.value | map(.name) | join(", "))"
')

if [ -n "$PROBLEMATIC" ]; then
  echo "ERROR: Found non-permissive licenses:"
  echo "$PROBLEMATIC"
  exit 1
fi

echo "All production licenses are permissive."
echo ""

echo "License check passed."
