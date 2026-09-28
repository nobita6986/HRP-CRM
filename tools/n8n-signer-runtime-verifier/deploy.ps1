[CmdletBinding()]
param(
    [string]$VpsCredentialFile = 'D:\CodeApp\vps-n8n.txt',
    [string]$HostKey = 'SHA256:bijvhqFP33lBRhVyL9KDjwxz/gJHH9ZpELJjNT5Xu70'
)

$ErrorActionPreference = 'Stop'
$puttyRoot = Join-Path $env:ProgramFiles 'PuTTY'
$plink = Join-Path $puttyRoot 'plink.exe'
$pscp = Join-Path $puttyRoot 'pscp.exe'
$sourceRoot = $PSScriptRoot
$temporaryFiles = [System.Collections.Generic.List[string]]::new()

function New-TemporaryUtf8File {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Content)
    $path = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($path, $Content, [Text.UTF8Encoding]::new($false))
    $temporaryFiles.Add($path)
    return $path
}

function Remove-TemporaryFiles {
    foreach ($path in $temporaryFiles) {
        if (Test-Path -LiteralPath $path) {
            $length = (Get-Item -LiteralPath $path).Length
            [IO.File]::WriteAllBytes($path, [byte[]]::new([Math]::Max(128, $length)))
            Remove-Item -LiteralPath $path -Force
        }
    }
}

function Invoke-Pscp {
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
    & $pscp -batch -hostkey $HostKey -pwfile $script:passwordFile $Source $Destination
    if ($LASTEXITCODE -ne 0) { throw "pscp failed for a verifier deployment artifact" }
}

$vps = Get-Content -LiteralPath $VpsCredentialFile
if ($vps.Count -lt 3) { throw 'VPS credential file must contain host, user and password lines' }
$hostSpec = "$($vps[1])@$($vps[0])"
$passwordFile = New-TemporaryUtf8File -Content $vps[2]
$secretBytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
$secret = ([Convert]::ToHexString($secretBytes)).ToLowerInvariant()

try {
    $environment = @"
PORT=8080
VERIFIER_SERVICE_ID=svc-crm-n8n-signer-test
VERIFIER_ORGANIZATION_ID=org-synthetic-signer
VERIFIER_CONNECTION_ID=conn-synthetic-signer
VERIFIER_SECRET=$secret
"@
    $environmentFile = New-TemporaryUtf8File -Content $environment
    $remoteScript = @'
set -eu
base=/opt/n8n/signer-verifier
site=/etc/nginx/sites-available/n8n-shared
snippet=/etc/nginx/snippets/n8n-signer-verifier.conf
stamp=$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0750 "$base"
install -m 0644 /tmp/n8n-signer-server.mjs "$base/server.mjs"
install -m 0644 /tmp/n8n-signer-compose.yaml "$base/compose.yaml"
if [ ! -f "$base/.env" ]; then
  install -m 0600 /tmp/n8n-signer.env "$base/.env"
  echo VERIFIER_SECRET_STATE=CREATED
else
  echo VERIFIER_SECRET_STATE=PRESERVED
fi
install -m 0644 /tmp/n8n-signer-nginx.conf "$snippet"
cd "$base"
docker compose up -d
i=1
while [ "$i" -le 30 ]; do
  if curl -fsS http://127.0.0.1:18081/healthz >/dev/null; then break; fi
  if [ "$i" = 30 ]; then echo VERIFIER_HEALTH=FAIL; exit 1; fi
  i=$((i + 1))
  sleep 1
done
cp -a "$site" "$site.before-signer-$stamp"
if ! grep -q 'include /etc/nginx/snippets/n8n-signer-verifier.conf;' "$site"; then
  sed -i '0,/server_name n8n-crm.hrpartner.vn;/s//server_name n8n-crm.hrpartner.vn;\n  include \/etc\/nginx\/snippets\/n8n-signer-verifier.conf;/' "$site"
fi
if ! nginx -t; then
  cp -a "$site.before-signer-$stamp" "$site"
  nginx -t
  echo NGINX_CONFIG=RESTORED
  exit 1
fi
systemctl reload nginx
rm -f /tmp/n8n-signer-server.mjs /tmp/n8n-signer-compose.yaml /tmp/n8n-signer.env /tmp/n8n-signer-nginx.conf
echo VERIFIER_HEALTH=PASS
echo NGINX_TEST=PASS
echo NGINX_RELOAD=PASS
docker compose ps --format json
'@
    $remoteScriptFile = New-TemporaryUtf8File -Content $remoteScript

    Invoke-Pscp -Source (Join-Path $sourceRoot 'server.mjs') -Destination "${hostSpec}:/tmp/n8n-signer-server.mjs"
    Invoke-Pscp -Source (Join-Path $sourceRoot 'compose.yaml') -Destination "${hostSpec}:/tmp/n8n-signer-compose.yaml"
    Invoke-Pscp -Source (Join-Path $sourceRoot 'nginx-location.conf') -Destination "${hostSpec}:/tmp/n8n-signer-nginx.conf"
    Invoke-Pscp -Source $environmentFile -Destination "${hostSpec}:/tmp/n8n-signer.env"
    Invoke-Pscp -Source $remoteScriptFile -Destination "${hostSpec}:/tmp/n8n-signer-deploy.sh"

    & $plink -batch -hostkey $HostKey -pwfile $passwordFile $hostSpec 'sudo bash /tmp/n8n-signer-deploy.sh && rm -f /tmp/n8n-signer-deploy.sh'
    if ($LASTEXITCODE -ne 0) { throw 'remote verifier deployment failed' }
    $health = Invoke-RestMethod -Uri 'https://n8n-crm.hrpartner.vn/__t0/n8n12-signer/healthz'
    Write-Output "PUBLIC_HEALTH=$($health.status) mode=$($health.mode)"
    Write-Output 'CREDENTIAL_PROVISIONING=SEPARATE_ADMIN_CLI_STEP'
} finally {
    $secret = $null
    $secretBytes = [byte[]]::new(0)
    Remove-TemporaryFiles
}
