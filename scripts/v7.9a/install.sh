#!/usr/bin/env bash
# scripts/v7.9a/install.sh - CORE/1.15 V7.9a one-shot install from clean environment.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "=========================================="
echo "CORE/1.15 V7.9a - Install (Linux/macOS)"
echo "=========================================="

# Build order is strictly enforced:
#   1. contracts  (no deps)
#   2. config     (no deps)
#   3. integration-store  (needs contracts+config built first; prisma generate always)
#   4. integration-worker (needs integration-store)
#   5. integration-api     (needs integration-store)
#   6. context-panel        (needs integration-store)
#   7. core-1.10-media
# Then clean .tmp_pgdata_* and run unit tests.

npx_ci() {
  local dir="$1"; shift
  echo "[$dir] npm ci"
  if [ -f "$dir/package-lock.json" ]; then
    npm ci --prefix "$dir" 2>&1 | tail -3
  else
    npm install --prefix "$dir" 2>&1 | tail -3
  fi
}

build_pkg() {
  local dir="$1"
  if [ -f "$dir/dist/index.js" ] || [ -f "$dir/dist/server.js" ]; then
    echo "[$dir] (already built, skipping)"
  else
    npx_ci "$dir"
    npm run build --prefix "$dir"
  fi
}

build_always() {
  local dir="$1"; shift
  npx_ci "$dir"
  "$@" --prefix "$dir"
}

# Step 1-2: no-deps packages
build_pkg packages/contracts
build_pkg packages/config

# Step 3: integration-store — prisma generate always runs (fast, idempotent)
echo "[integration-store] npm ci + prisma generate + build"
npx_ci packages/integration-store
npm run --prefix packages/integration-store prisma generate
npm run --prefix packages/integration-store build

# Steps 4-7: apps
build_pkg apps/integration-worker
build_pkg apps/integration-api
build_pkg apps/context-panel
build_pkg apps/core-1.10-media

# Clean stale PG test data
echo ""
echo "[cleanup] Removing stale .tmp_pgdata_* artifacts..."
find . -type d -name ".tmp_pgdata_*" -exec rm -rf {} + 2>/dev/null || true

# Unit tests
echo ""
echo "[unit-tests] packages/contracts"
(cd packages/contracts && npm test) 2>&1 | tail -8

echo ""
echo "[unit-tests] packages/config"
(cd packages/config && npm test) 2>&1 | tail -8

echo ""
echo "=========================================="
echo "Install complete."
echo "Next: bash scripts/v7.9a/start.sh"
echo "=========================================="