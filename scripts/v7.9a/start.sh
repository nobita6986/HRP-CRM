# scripts/v7.9a/start.sh - CORE/1.15 V7.9a start API + worker + UI from clean state.
#
# Usage:
#   bash scripts/v7.9a/start.sh
#
# This script:
#   1. Sets synthetic env (mock mode, no HRP core DB markers).
#   2. Starts embedded PG via shared node bootstrap (port 51000).
#   3. Polls port 51000 until live, then starts API server on 127.0.0.1:4001.
#   4. Starts worker process (background).
#   5. Starts context-panel UI on 127.0.0.1:4003.
#   6. Prints shutdown commands.
#
# Requires: bash (Linux/macOS) or Git Bash (Windows). On native Windows,
# use scripts/v7.9a/start.ps1 instead.
#
# Note: PostgreSQL bootstrap delegates to scripts/v7.9a/bootstrap-pg.mjs and
#       runs with cwd=apps/integration-api so embedded-postgres resolves.
#       Root node_modules does NOT have it; only the per-package node_modules do.

#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "=========================================="
echo "CORE/1.15 V7.9a - Start"
echo "=========================================="

# Synthetic env
export NODE_ENV=development
export HRP_MOCK_MODE=deterministic
export HRP_ORGANIZATION_ID=org-synthetic-001

# API
export HRP_LISTEN_HOST=127.0.0.1
export HRP_LISTEN_PORT=4001
export HRP_RECEIVER_ENABLED=true
export HRP_RECEIVER_MAX_BODY_BYTES=262144
export HRP_RECEIVER_RATE_LIMIT_PER_MIN=600
export HRP_RECEIVER_RATE_MAP_IDLE_MS=300000
export HRP_RECEIVER_RATE_MAP_MAX_ENTRIES=10000
export HRP_NOW_EPOCH_MS=1700000000000

# Synthetic connections (CORE/1.2 receiver)
export HRP_WEBHOOK_CONNECTIONS='[
  {"organizationId":"org-synthetic-001","provider":"CHATWOOT","connectionId":"conn-synth-001","secret":"synthetic-hmac-secret-chatwoot-do-not-use","algorithm":"HMAC_SHA256"},
  {"organizationId":"org-synthetic-001","provider":"ZALO_OA","connectionId":"conn-synth-001","secret":"synthetic-hmac-secret-zalo-oa-do-not-use","algorithm":"HMAC_SHA256"},
  {"organizationId":"org-synthetic-001","provider":"GENERIC","connectionId":"conn-synth-001","secret":"synthetic-hmac-secret-generic-do-not-use","algorithm":"HMAC_SHA256"}
]'

# Embedded PG (synthetic test cluster). NOT HRP core.
export DATABASE_URL="postgresql://integration:synthetic@127.0.0.1:51000/integration_store?schema=integration"

# Worker
export HRP_POLL_INTERVAL_MS=5000
export HRP_LEASE_DURATION_MS=60000
export HRP_MAX_CONCURRENT_JOBS=4

# Internal helpers
wait_for_port() {
  local host="$1"; local port="$2"; local name="$3"; local tries=60
  while [ "$tries" -gt 0 ]; do
    if (echo > "/dev/tcp/$host/$port") 2>/dev/null; then
      echo "  $name OK on $host:$port"
      return 0
    fi
    tries=$((tries - 1))
    sleep 0.5
  done
  echo "  $name FAILED: $host:$port not reachable after 30s"
  return 1
}

mkdir -p .tmp_pgdata_v79a

echo "[1/4] Starting embedded PostgreSQL on 127.0.0.1:51000..."
(
  # Bootstrap PG by invoking the script that lives inside the apps/integration-api
  # package, so the `import EmbeddedPostgres from 'embedded-postgres'` resolves
  # from apps/integration-api/node_modules. (Root has none; node walks up from
  # the script file, NOT from cwd.)
  cd apps/integration-api
  node scripts/bootstrap-pg.mjs
) > ../../.tmp_pgdata_v79a/pg.log 2> ../../.tmp_pgdata_v79a/pg.err.log &
PG_PID=$!
echo "  PID=$PG_PID (cwd=apps/integration-api)"
# shellcheck disable=SC2154
wait_for_port "127.0.0.1" "51000" "[pg]" || {
  echo "  Last 20 lines of pg.err.log:" >&2
  tail -n 20 .tmp_pgdata_v79a/pg.err.log >&2 || true
  echo "  Last 20 lines of pg.log:" >&2
  tail -n 20 .tmp_pgdata_v79a/pg.log >&2 || true
  echo "Aborting start; worker, API, and seed will NOT be spawned." >&2
  kill "$PG_PID" 2>/dev/null || true
  exit 1
}

echo "[2/4] Starting integration-api on 127.0.0.1:4001..."
(
  cd apps/integration-api
  node dist/server.js
) > ../../.tmp_pgdata_v79a/api.log 2>&1 &
API_PID=$!
echo "  PID=$API_PID"
sleep 2

echo "[3/4] Starting integration-worker..."
(
  cd apps/integration-worker
  DATABASE_URL="$DATABASE_URL" node dist/server.js
) > ../../.tmp_pgdata_v79a/worker.log 2>&1 &
WORKER_PID=$!
echo "  PID=$WORKER_PID"
sleep 2

echo "[4/4] Starting context-panel UI on 127.0.0.1:4003..."
(
  cd apps/context-panel
  HRP_LISTEN_PORT=4003 node dist/server.js
) > ../../.tmp_pgdata_v79a/panel.log 2>&1 &
PANEL_PID=$!
echo "  PID=$PANEL_PID"

cat <<EOF

==========================================
Services running.
  PG (real):  127.0.0.1:51000 (PID $PG_PID)
  API:        http://127.0.0.1:4001/health/live (PID $API_PID)
  Worker:     background (PID $WORKER_PID)
  Panel UI:   http://127.0.0.1:4003 (PID $PANEL_PID)

Stop with: bash scripts/v7.9a/stop.sh
==========================================
EOF
