# scripts/v7.9a/start.ps1 - CORE/1.15 V7.9a start API + worker + UI from clean state.
#
# Usage:
#   pwsh scripts/v7.9a/start.ps1
#
# Starts in separate PowerShell windows so each process can be monitored
# and stopped independently. Outputs to .tmp_pgdata_v79a/*.log.
#
# Stop with: scripts/v7.9a/stop.ps1

$ErrorActionPreference = "Continue"
Set-Location (Join-Path $PSScriptRoot "..\..")

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "CORE/1.15 V7.9a - Start (Windows)" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Setup log directory
$logDir = ".tmp_pgdata_v79a"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

# Synthetic env block
$env:NODE_ENV = "development"
$env:HRP_MOCK_MODE = "deterministic"
$env:HRP_ORGANIZATION_ID = "org-synthetic-001"

# API env
$env:HRP_LISTEN_HOST = "127.0.0.1"
$env:HRP_LISTEN_PORT = "4001"
$env:HRP_RECEIVER_ENABLED = "true"
$env:HRP_RECEIVER_MAX_BODY_BYTES = "262144"
$env:HRP_RECEIVER_RATE_LIMIT_PER_MIN = "600"
$env:HRP_RECEIVER_RATE_MAP_IDLE_MS = "300000"
$env:HRP_RECEIVER_RATE_MAP_MAX_ENTRIES = "10000"
$env:HRP_NOW_EPOCH_MS = "1700000000000"
$env:HRP_WEBHOOK_CONNECTIONS = @'
[
  {"organizationId":"org-synthetic-001","provider":"CHATWOOT","connectionId":"conn-synth-001","secret":"synthetic-hmac-secret-chatwoot-do-not-use","algorithm":"HMAC_SHA256"},
  {"organizationId":"org-synthetic-001","provider":"ZALO_OA","connectionId":"conn-synth-001","secret":"synthetic-hmac-secret-zalo-oa-do-not-use","algorithm":"HMAC_SHA256"},
  {"organizationId":"org-synthetic-001","provider":"GENERIC","connectionId":"conn-synth-001","secret":"synthetic-hmac-secret-generic-do-not-use","algorithm":"HMAC_SHA256"}
]
'@
$env:DATABASE_URL = "postgresql://integration:synthetic@127.0.0.1:51000/integration_store?schema=integration"

# Worker env
$env:HRP_POLL_INTERVAL_MS = "5000"
$env:HRP_LEASE_DURATION_MS = "60000"
$env:HRP_MAX_CONCURRENT_JOBS = "4"

Write-Host "[1/4] Starting embedded PostgreSQL on 127.0.0.1:51000..." -ForegroundColor Yellow
$pgScript = @'
import EmbeddedPostgres from 'embedded-postgres';
const pg = new EmbeddedPostgres({
  databaseDir: '.tmp_pgdata_v79a/pgdata',
  user: 'integration', password: 'synthetic',
  port: 51000, persistent: true,
  initdbFlags: ['--locale=C', '--encoding=UTF8', '--no-locale'],
});
await pg.initialise(); await pg.start();
await pg.createDatabase('integration_store');
console.log('[pg] ready on 127.0.0.1:51000');
setInterval(() => {}, 1<<30);
'@
$pgScriptPath = Join-Path $logDir "bootstrap-pg.mjs"
$pgScript | Out-File -FilePath $pgScriptPath -Encoding utf8
$pgProc = Start-Process -FilePath "node" -ArgumentList $pgScriptPath -WorkingDirectory (Get-Location) -RedirectStandardOutput (Join-Path $logDir "pg.log") -RedirectStandardError (Join-Path $logDir "pg.err.log") -NoNewWindow -PassThru
Write-Host "  PID=$($pgProc.Id)"

Write-Host "[2/4] Starting integration-api on 127.0.0.1:4001..." -ForegroundColor Yellow
$apiProc = Start-Process -FilePath "node" -ArgumentList "dist/server.js" -WorkingDirectory "apps/integration-api" -RedirectStandardOutput (Join-Path $logDir "api.log") -RedirectStandardError (Join-Path $logDir "api.err.log") -NoNewWindow -PassThru
Write-Host "  PID=$($apiProc.Id)"

Write-Host "[3/4] Starting integration-worker..." -ForegroundColor Yellow
$workerProc = Start-Process -FilePath "node" -ArgumentList "dist/server.js" -WorkingDirectory "apps/integration-worker" -RedirectStandardOutput (Join-Path $logDir "worker.log") -RedirectStandardError (Join-Path $logDir "worker.err.log") -NoNewWindow -PassThru
Write-Host "  PID=$($workerProc.Id)"

Write-Host "[4/4] Starting context-panel UI on 127.0.0.1:4003..." -ForegroundColor Yellow
$env:HRP_LISTEN_PORT = "4003"
$panelProc = Start-Process -FilePath "node" -ArgumentList "dist/server.js" -WorkingDirectory "apps/context-panel" -RedirectStandardOutput (Join-Path $logDir "panel.log") -RedirectStandardError (Join-Path $logDir "panel.err.log") -NoNewWindow -PassThru
Write-Host "  PID=$($panelProc.Id)"

Start-Sleep -Seconds 3

Write-Host "[seed] Seeding synthetic data..." -ForegroundColor Yellow
$env:DATABASE_URL = "postgresql://integration:synthetic@127.0.0.1:51000/integration_store?schema=integration"
$seedProc = Start-Process -FilePath "node" -ArgumentList "scripts/v7.9a/seed.mjs" -WorkingDirectory (Get-Location) -RedirectStandardOutput (Join-Path $logDir "seed.log") -RedirectStandardError (Join-Path $logDir "seed.err.log") -NoNewWindow -PassThru -Wait
Write-Host "  seed exit: $LASTEXITCODE"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Services running:" -ForegroundColor Green
Write-Host "  PG:        127.0.0.1:51000 (PID $($pgProc.Id))"
Write-Host "  API:       http://127.0.0.1:4001/health/live (PID $($apiProc.Id))"
Write-Host "  Worker:    background (PID $($workerProc.Id))"
Write-Host "  Panel UI:  http://127.0.0.1:4003 (PID $($panelProc.Id))"
Write-Host ""
Write-Host "Stop with: scripts/v7.9a/stop.ps1"
Write-Host "==========================================" -ForegroundColor Cyan
