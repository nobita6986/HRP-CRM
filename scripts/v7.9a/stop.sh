#!/usr/bin/env bash
# scripts/v7.9a/stop.sh - Stop V7.9a demo processes.
set -uo pipefail

for port in 51000 4001 4002 4003; do
  pids=$(lsof -ti :$port 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Stopping PIDs on port $port: $pids"
    kill -9 $pids 2>/dev/null || true
  fi
done

echo "Demo stopped."
