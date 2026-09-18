# scripts/v7.9a/start.sh - CORE/1.15 V7.9a start API + worker + UI from clean state.
#
# Usage:
#   bash scripts/v7.9a/start.sh
#
# This script:
#   1. Sets synthetic env (mock mode, no HRP core DB markers).
#   2. Starts embedded PG via node bootstrap (TEST PORT 51000).
#   3. Starts API server on 127.0.0.1:4001.
#   4. Starts worker process (background) on 127.0.0.1:4002.
#   5. Starts context-panel UI on 127.0.0.1:4003.
#   6. Prints shutdown commands.
#
# Requires: bash (Linux/macOS) or Git Bash (Windows). On native Windows,
# use scripts/v7.9a/start.ps1 instead.

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

# Context panel
export HRP_LISTEN_HOST=127.0.0.1
export HRP_LISTEN_PORT=4003

echo "[1/4] Starting embedded PostgreSQL on 127.0.0.1:51000..."
mkdir -p .tmp_pgdata_v79a
node --import tsx/esm scripts/v7.9a/bootstrap-pg.ts &
PG_PID=$!
echo "  PID=$PG_PID"
sleep 3

echo "[2/4] Starting integration-api on 127.0.0.1:4001..."
cd apps/integration-api
node dist/server.js > ../../.tmp_pgdata_v79a/api.log 2>&1 &
API_PID=$!
echo "  PID=$API_PID"
cd ../..
sleep 2

echo "[3/4] Starting integration-worker..."
cd apps/integration-worker
DATABASE_URL="$DATABASE_URL" node dist/server.js > ../../.tmp_pgdata_v79a/worker.log 2>&1 &
WORKER_PID=$!
echo "  PID=$WORKER_PID"
cd ../..
sleep 2

echo "[4/4] Starting context-panel UI on 127.0.0.1:4003..."
cd apps/context-panel
HRP_LISTEN_PORT=4003 node dist/server.js > ../../.tmp_pgdata_v79a/panel.log 2>&1 &
PANEL_PID=$!
echo "  PID=$PANEL_PID"
cd ../..

cat <<EOF

==========================================
Services running.
  PG:        127.0.0.1:51000 (PID $PG_PID)
  API:       http://127.0.0.1:4001/health/live (PID $API_PID)
  Worker:    background (PID $WORKER_PID)
  Panel UI:  http://127.0.0.1:4003 (PID $PANEL_PID)

Stop with: bash scripts/v7.9a/stop.sh
EOF
