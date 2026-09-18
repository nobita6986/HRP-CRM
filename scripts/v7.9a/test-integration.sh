#!/usr/bin/env bash
# scripts/v7.9a/test-integration.sh - PG-backed integration tests.
set -uo pipefail
cd "$(dirname "$0")/../.."

echo "=========================================="
echo "CORE/1.15 - Integration Tests (PG-backed)"
echo "=========================================="

run_test() {
  local label="$1" cwd="$2" cmd="$3"
  echo ""
  echo "[$label] running..."
  ( cd "$cwd" && eval "$cmd" ) && echo "[$label] PASS" || echo "[$label] FAIL"
}

# Clean stale pgdata
find . -type d -name '.tmp_pgdata_*' -exec rm -rf {} + 2>/dev/null || true

run_test "receiver.int"        "apps/integration-api" "node --test tests/receiver.int.test.mjs"
run_test "orchestrator.pg-e2e" "apps/integration-api" "node --test tests/orchestrator.pg-e2e.test.mjs"
run_test "outbox"              "apps/integration-api" "node --test tests/outbox.test.mjs"
run_test "retry"               "apps/integration-api" "node --test tests/retry.test.mjs"
run_test "orchestrator.unit"   "apps/integration-api" "node --test tests/orchestrator.test.mjs"

echo ""
echo "=========================================="
echo "Integration test run complete."
echo "=========================================="
