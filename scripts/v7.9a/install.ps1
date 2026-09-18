# scripts/v7.9a/install.ps1 - CORE/1.15 V7.9a one-shot install from clean environment.
#
# Usage:
#   pwsh scripts/v7.9a/install.ps1
#
# Idempotent: re-running will skip steps that are already done.
# Does NOT touch any system-wide PATH or env. Does NOT require Docker.
# Resets only the apps' .tmp_pgdata_* directories (test artifacts).
#
# What it does:
#   1. Build contracts.
#   2. Build config.
#   3. Build integration-store + Prisma client.
#   4. Build integration-api + integration-worker.
#   5. Build context-panel (UI bundle).
#   6. Clean stale .tmp_pgdata_* artifacts.
#   7. Run unit tests (contracts + config).
#   8. Print next-step commands.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "CORE/1.15 V7.9a - Install" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

function Step([string]$n, [string]$msg, [string]$cwd, [string]$cmd) {
  Write-Host ""
  Write-Host "[$n] $msg" -ForegroundColor Yellow
  Push-Location $cwd
  try {
    if ($cmd) { Invoke-Expression $cmd }
  } catch {
    Write-Host "  failed: $_" -ForegroundColor Red
  }
  Pop-Location
}

Step "1/7" "Building packages/contracts..." "packages/contracts" "if (-not (Test-Path dist/index.js)) { npm run build }"
Step "2/7" "Building packages/config..." "packages/config" "npm run build 2>&1 | Out-Null"
Step "3/7" "Building packages/integration-store..." "packages/integration-store" "if (-not (Test-Path dist/client/index.js)) { npm run build }"
Step "4/7" "Building apps/integration-api..." "apps/integration-api" "if (-not (Test-Path dist/server.js)) { npm run build }"
Step "5/7" "Building apps/integration-worker..." "apps/integration-worker" "if (-not (Test-Path dist/server.js)) { npm run build }"
Step "6/7" "Building apps/context-panel (UI bundle)..." "apps/context-panel" "if (-not (Test-Path dist/ui/bundle.js)) { npm run build }"

Write-Host ""
Write-Host "[7/7] Cleaning stale .tmp_pgdata_* artifacts..." -ForegroundColor Yellow
Get-ChildItem -Recurse -Force -Filter ".tmp_pgdata_*" -ErrorAction SilentlyContinue |
  Where-Object { $_.PSIsContainer } | ForEach-Object {
    Write-Host "  removing $($_.FullName)" -ForegroundColor DarkGray
    Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
  }

Write-Host ""
Write-Host "Unit tests (contracts):" -ForegroundColor Yellow
Push-Location packages/contracts
npm test 2>&1 | Select-Object -Last 10
Pop-Location

Write-Host ""
Write-Host "Unit tests (config):" -ForegroundColor Yellow
Push-Location packages/config
npm test 2>&1 | Select-Object -Last 10
Pop-Location

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Install complete." -ForegroundColor Green
Write-Host "Next step: scripts/v7.9a/start.ps1 to start API + worker + UI." -ForegroundColor Yellow
Write-Host "Or run integration tests: scripts/v7.9a/test-integration.ps1" -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan
