#!/usr/bin/env bash
# scripts/v7.9a/install.sh - CORE/1.15 V7.9a one-shot install from clean environment.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "=========================================="
echo "CORE/1.15 V7.9a - Install (Linux/macOS)"
echo "=========================================="

step() {
  local n="$1" msg="$2" cwd="$3" cmd="$4"
  echo ""
  echo "[$n] $msg"
  ( cd "$cwd" && eval "$cmd" )
}

step "1/7" "Building packages/contracts..." "packages/contracts" "[ -d dist ] || npm run build"
step "2/7" "Building packages/config..." "packages/config" "npm run build 2>&1 | tail -5"
step "3/7" "Building packages/integration-store..." "packages/integration-store" "[ -f dist/client/index.js ] || npm run build"
step "4/7" "Building apps/integration-api..." "apps/integration-api" "[ -f dist/server.js ] || npm run build"
step "5/7" "Building apps/integration-worker..." "apps/integration-worker" "[ -f dist/server.js ] || npm run build"
step "6/7" "Building apps/context-panel (UI bundle)..." "apps/context-panel" "[ -f dist/ui/bundle.js ] || npm run build"

echo ""
echo "[7/7] Cleaning stale .tmp_pgdata_* artifacts..."
find . -type d -name '.tmp_pgdata_*' -exec rm -rf {} + 2>/dev/null || true

echo ""
echo "Unit tests (contracts):"
( cd packages/contracts && npm test 2>&1 | tail -10 )

echo ""
echo "Unit tests (config):"
( cd packages/config && npm test 2>&1 | tail -10 )

echo ""
echo "=========================================="
echo "Install complete."
echo "Next step: bash scripts/v7.9a/start.sh"
echo "=========================================="
