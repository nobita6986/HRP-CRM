# scripts/v7.9a/install.ps1 - CORE/1.15 V7.9a one-shot install from clean environment.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/v7.9a/install.ps1
#
# Idempotent: re-running skips steps whose dist/ already exists.
# Does NOT touch any system-wide PATH or env. Does NOT require Docker.
# Resets only stale .tmp_pgdata_* test artifacts.
#
# Build order enforced (with prisma generate between contracts/config and apps):
#   1. packages/contracts
#   2. packages/config
#   3. packages/integration-store  (npm ci + prisma generate + build)
#   4. apps/integration-worker     (npm ci + build)
#   5. apps/integration-api        (npm ci + build)
#   6. apps/context-panel          (npm ci + build)
#   7. apps/core-1.10-media        (npm ci + build, if present)
#   8. Clean stale .tmp_pgdata_* artifacts.
#   9. Unit tests (contracts + config smoke).
#
# Note: $ErrorActionPreference is set to "Continue" globally so that npm
# warnings (which PowerShell classifies as non-terminating errors when
# they reach stderr) do not abort the script. We check $LASTEXITCODE
# explicitly after each command to detect real failures.

$ErrorActionPreference = "Continue"
Set-Location (Join-Path $PSScriptRoot "..\..")

function Section([string]$msg) {
  Write-Host ""
  Write-Host "==========================================" -ForegroundColor Cyan
  Write-Host $msg -ForegroundColor Cyan
  Write-Host "==========================================" -ForegroundColor Cyan
}

function Step([string]$n, [string]$msg) {
  Write-Host ""
  Write-Host "[$n] $msg" -ForegroundColor Yellow
}

# Run an external command; capture exit code without throwing on warnings.
function Invoke-Silently([string]$exe, [string[]]$cmdArgs) {
  if ($cmdArgs.Count -gt 0) {
    & $exe @cmdArgs 2>&1 | Out-Null
  } else {
    & $exe 2>&1 | Out-Null
  }
  return $LASTEXITCODE
}

# Run npm ci + build for a package, skipping if dist/ is already present.
function Ensure-Pkg([string]$pkg, [string]$distCheck) {
  Push-Location $pkg
  try {
    if (Test-Path $distCheck) {
      Write-Host "  (already built: $distCheck exists)" -ForegroundColor DarkGray
      return $true
    }
    if (Test-Path node_modules) {
      Write-Host "  (deps already installed)" -ForegroundColor DarkGray
    } else {
      Write-Host "  npm ci..." -ForegroundColor DarkGray
      $rc = Invoke-Silently "npm" @("ci")
      if ($rc -ne 0) {
        Write-Host "  npm ci FAILED (exit=$rc)" -ForegroundColor Red
        return $false
      }
    }
    Write-Host "  npm run build..." -ForegroundColor DarkGray
    $rc = Invoke-Silently "npm" @("run", "build")
    if ($rc -ne 0) {
      Write-Host "  npm run build FAILED (exit=$rc)" -ForegroundColor Red
      return $false
    }
    return $true
  } finally {
    Pop-Location
  }
}

Section "CORE/1.15 V7.9a - Install"

# Track overall success.
$ok = $true

# 1. contracts
Step "1/9" "packages/contracts"
$ok = (Ensure-Pkg "packages/contracts" "packages/contracts/dist/index.js") -and $ok

# 2. config
Step "2/9" "packages/config"
$ok = (Ensure-Pkg "packages/config" "packages/config/dist/index.js") -and $ok

# 3. integration-store — always prisma generate (idempotent and fast)
Step "3/9" "packages/integration-store (npm ci + prisma generate + build)"
Push-Location packages/integration-store
try {
  if (Test-Path node_modules) {
    Write-Host "  (deps already installed)" -ForegroundColor DarkGray
  } else {
    Write-Host "  npm ci..." -ForegroundColor DarkGray
    $rc = Invoke-Silently "npm" @("ci")
    if ($rc -ne 0) { $ok = $false }
  }
  if ($ok) {
    Write-Host "  npx prisma generate..." -ForegroundColor DarkGray
    $rc = Invoke-Silently "npx" @("prisma", "generate")
    if ($rc -ne 0) {
      Write-Host "  prisma generate FAILED (exit=$rc)" -ForegroundColor Red
      $ok = $false
    }
  }
  if ($ok) {
    Write-Host "  npm run build..." -ForegroundColor DarkGray
    $rc = Invoke-Silently "npm" @("run", "build")
    if ($rc -ne 0) {
      Write-Host "  build FAILED (exit=$rc)" -ForegroundColor Red
      $ok = $false
    }
  }
} finally {
  Pop-Location
}

# 4. integration-worker
Step "4/9" "apps/integration-worker"
$ok = (Ensure-Pkg "apps/integration-worker" "apps/integration-worker/dist/server.js") -and $ok

# 5. integration-api
Step "5/9" "apps/integration-api"
$ok = (Ensure-Pkg "apps/integration-api" "apps/integration-api/dist/server.js") -and $ok

# 6. context-panel
Step "6/9" "apps/context-panel (UI bundle)"
$ok = (Ensure-Pkg "apps/context-panel" "apps/context-panel/dist/ui/bundle.js") -and $ok

# 7. core-1.10-media (optional)
if (Test-Path "apps/core-1.10-media/package.json") {
  Step "7/9" "apps/core-1.10-media"
  $ok = (Ensure-Pkg "apps/core-1.10-media" "apps/core-1.10-media/dist/index.js") -and $ok
} else {
  Step "7/9" "apps/core-1.10-media - not present, skipping"
}

# 8. Clean stale PG artifacts.
Step "8/9" "Cleaning stale .tmp_pgdata_* artifacts"
Get-ChildItem -Recurse -Force -Filter ".tmp_pgdata_*" -ErrorAction SilentlyContinue |
  Where-Object { $_.PSIsContainer } | ForEach-Object {
    Write-Host "  removing $($_.FullName)" -ForegroundColor DarkGray
    Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
  }

# 9. Unit tests smoke (contracts + config).
Step "9/9" "Unit tests smoke (contracts + config)"
Push-Location packages/contracts
try {
  Write-Host "  contracts:" -ForegroundColor Yellow
  & npm test 2>&1 | Select-Object -Last 8 | ForEach-Object { Write-Host "    $_" }
  if ($LASTEXITCODE -ne 0) { $ok = $false }
} finally {
  Pop-Location
}
Push-Location packages/config
try {
  Write-Host "  config:" -ForegroundColor Yellow
  & npm test 2>&1 | Select-Object -Last 8 | ForEach-Object { Write-Host "    $_" }
  if ($LASTEXITCODE -ne 0) { $ok = $false }
} finally {
  Pop-Location
}

Section "Install complete"
if ($ok) {
  Write-Host "All steps OK." -ForegroundColor Green
  Write-Host "Next step: powershell -ExecutionPolicy Bypass -File scripts/v7.9a/start.ps1" -ForegroundColor Yellow
  exit 0
} else {
  Write-Host "One or more steps FAILED. See output above." -ForegroundColor Red
  exit 1
}
