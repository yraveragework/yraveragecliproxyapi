[CmdletBinding()]
param(
    [string]$CurrentVersion = '',
    [string]$TagName = '',
    [switch]$NoRestart
)

$ErrorActionPreference = 'Stop'
$WorkerBase = 'http://127.0.0.1:19890'
$InstallRoot = Split-Path -Parent $PSScriptRoot

function Write-Step {
    param([string]$Message)
    Write-Host "[CLIProxyAPI Update] $Message" -ForegroundColor Cyan
}

function Resolve-CurrentVersion {
    if ($CurrentVersion) { return $CurrentVersion -replace '^[vV]', '' }

    $folderName = Split-Path -Leaf $InstallRoot
    if ($folderName -match '^CLIProxyAPI_([^_]+)_windows_') {
        return $Matches[1] -replace '^[vV]', ''
    }

    $exePath = Join-Path $InstallRoot 'cli-proxy-api.exe'
    if (Test-Path -LiteralPath $exePath) {
        $candidate = (Get-Item -LiteralPath $exePath).VersionInfo.ProductVersion
        if ($candidate -match '\d+(?:\.\d+)+') { return $Matches[0] }
    }

    return '0.0.0'
}

try {
    Write-Step "Install folder: $InstallRoot"
    Write-Step 'Contacting the local settings worker on port 19890...'
    $health = Invoke-RestMethod -Method Get -Uri "$WorkerBase/health" -TimeoutSec 10
    if (-not $health.ok) { throw 'The local settings worker returned an unhealthy response.' }

    $resolvedCurrent = Resolve-CurrentVersion
    Write-Step "Checking GitHub Releases (current version: $resolvedCurrent)..."
    $escapedCurrent = [Uri]::EscapeDataString($resolvedCurrent)
    $check = Invoke-RestMethod -Method Get -Uri "$WorkerBase/update/check?current=$escapedCurrent" -TimeoutSec 60
    if (-not $check.ok) { throw "Update check failed: $($check.error)" }

    Write-Host "  Latest version : $($check.latest)"
    Write-Host "  Release        : $($check.name)"
    Write-Host "  Asset          : $($check.asset.name) ($([Math]::Round([double]$check.asset.size / 1MB, 1)) MB)"
    if ($check.htmlUrl) { Write-Host "  GitHub         : $($check.htmlUrl)" }

    $requestedTag = if ($TagName) { $TagName } else { $check.tagName }
    if (-not $TagName -and -not $check.updateAvailable) {
        Write-Host "CLIProxyAPI $resolvedCurrent is already up to date." -ForegroundColor Green
        exit 0
    }

    Write-Step "Downloading and applying $requestedTag..."
    Write-Host '  The worker will preserve config.yaml, auth, local-settings, panel files, logs, and other user data.'
    Write-Host '  Only cli-proxy-api.exe will be stopped, backed up, and replaced.'

    $payload = @{
        currentVersion = $resolvedCurrent
        tagName = $requestedTag
        restart = -not [bool]$NoRestart
    } | ConvertTo-Json

    $result = Invoke-RestMethod `
        -Method Post `
        -Uri "$WorkerBase/update/apply" `
        -ContentType 'application/json' `
        -Body $payload `
        -TimeoutSec 1800

    if (-not $result.ok) { throw "Update apply failed: $($result.error)" }

    Write-Host ''
    Write-Host "Update completed: $($result.previousVersion) -> $($result.newVersion)" -ForegroundColor Green
    Write-Host "Executable : $($result.exePath)"
    Write-Host "Backup     : $($result.backupPath)"
    Write-Host "Restarted  : $($result.restarted)"
    foreach ($note in @($result.notes)) { Write-Host "  - $note" }
    exit 0
}
catch {
    Write-Host ''
    Write-Host '[CLIProxyAPI Update] FAILED' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor DarkRed }
    Write-Host 'Make sure local-settings\start-worker.bat is running and port 19890 is available.' -ForegroundColor Yellow
    exit 1
}
