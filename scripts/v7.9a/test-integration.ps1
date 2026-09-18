# scripts/v7.9a/test-integration.ps1 - CORE/1.15 PG-backed integration test suite.
#
# Runs the real PostgreSQL-backed tests that prove durability/concurrency:
#   - apps/integration-api/tests/receiver.int.test.mjs
#       (webhook receiver integration: A01, A02, A05, F1/F2/F3)
#   - apps/integration-api/tests/orchestrator.pg-e2e.test.mjs
#       (orchestrator with real PG: A03, A04, A06, A07, A08, A10)
#   - apps/integration-api/tests/outbox.test.mjs
#       (outbox edge cases)
#   - apps/integration-api/tests/retry.test.mjs
#       (retry policy: bounded exponential backoff, DLQ)
#   - apps/integration-api/tests/orchestrator.test.mjs
#       (orchestrator unit: 42 tests)
#
# Each test runs in its own embedded PG cluster (port + data dir isolated).
#
# Usage:
#   pwsh scripts/v7.9a/test-integration.ps1
#
# Notes:
#   - PowerShell + embedded-postgres can be slow on Windows; allow 5-15 min total.
#   - Each test uses a unique SUFFIX via the harness (when supported).
#   - The harness files were fixed in CORE/1.15 to use initdbFlags with
#     C-locale for portability.

$ErrorActionPreference = "Continue"
Set-Location (Join-Path $PSScriptRoot "..\..")

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "CORE/1.15 - Integration Tests (PG-backed)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

function Run-Test([string]$label, [string]$cwd, [string]$cmd) {
  Write-Host ""
  Write-Host "[$label] running..." -ForegroundColor Yellow
  Push-Location $cwd
  try {
    Invoke-Expression $cmd
    if ($LASTEXITCODE -eq 0) {
      Write-Host "[$label] PASS" -ForegroundColor Green
    } else {
      Write-Host "[$label] FAIL (exit $LASTEXITCODE)" -ForegroundColor Red
    }
  } catch {
    Write-Host "[$label] error: $_" -ForegroundColor Red
  }
  Pop-Location
}

# Clean stale pgdata
Get-ChildItem -Recurse -Force -Filter ".tmp_pgdata_*" -ErrorAction SilentlyContinue |
  Where-Object { $_.PSIsContainer } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Run-Test "receiver.int" "apps/integration-api" "node --test tests/receiver.int.test.mjs"
Run-Test "orchestrator.pg-e2e" "apps/integration-api" "node --test tests/orchestrator.pg-e2e.test.mjs"
Run-Test "outbox" "apps/integration-api" "node --test tests/outbox.test.mjs"
Run-Test "retry" "apps/integration-api" "node --test tests/retry.test.mjs"
Run-Test "orchestrator.unit" "apps/integration-api" "node --test tests/orchestrator.test.mjs"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Integration test run complete." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
