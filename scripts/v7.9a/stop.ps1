# scripts/v7.9a/stop.ps1 - Stop V7.9a demo processes.
$ErrorActionPreference = "Continue"

# Kill processes bound to demo ports
foreach ($port in 51000, 4001, 4002, 4003) {
  $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' }
  if ($conn) {
    foreach ($c in $conn) {
      Write-Host "Stopping PID $($c.OwningProcess) on port $port"
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host "Demo stopped."
