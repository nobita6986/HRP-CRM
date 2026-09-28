[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('crm', 'hrp')][string]$Instance,
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [Parameter(Mandatory = $true)][string]$WorkflowId,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [string]$ExecutionId,
    [string]$ExpectedVersion,
    [string]$FinalNode = 'Build Final Output',
    [string]$SchemaRoot,
    [string]$ApiKeyFile,
    [switch]$ExpectInactive,
    [switch]$ValidateCrmAutomation
)

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'pull-evidence.mjs'
$apiKey = $null
if ($ApiKeyFile) {
    $resolvedApiKeyFile = (Resolve-Path -LiteralPath $ApiKeyFile).Path
} else {
    $apiKey = Read-Host 'n8n API key' -MaskInput
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        throw 'n8n API key is required'
    }
}

$arguments = @(
    $scriptPath,
    '--instance', $Instance,
    '--base-url', $BaseUrl,
    '--workflow-id', $WorkflowId,
    '--out-dir', $OutDir,
    '--final-node', $FinalNode
)
if ($ExecutionId) { $arguments += @('--execution-id', $ExecutionId) }
if ($ExpectedVersion) { $arguments += @('--expect-version', $ExpectedVersion) }
if ($SchemaRoot) { $arguments += @('--schema-root', $SchemaRoot) }
if ($ExpectInactive) { $arguments += '--expect-inactive' }
if ($ValidateCrmAutomation) { $arguments += '--validate-crm-automation' }

try {
    if ($resolvedApiKeyFile) {
        $env:N8N_API_KEY_FILE = $resolvedApiKeyFile
    } else {
        $env:N8N_API_KEY = $apiKey
    }
    & node @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "n8n evidence pull failed with exit code $LASTEXITCODE"
    }
}
finally {
    Remove-Item Env:N8N_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:N8N_API_KEY_FILE -ErrorAction SilentlyContinue
    $apiKey = $null
}
