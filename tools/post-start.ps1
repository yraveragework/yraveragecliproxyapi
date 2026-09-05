$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

try {
  Invoke-RestMethod -Uri 'http://127.0.0.1:19890/heal-paths' -Method POST -TimeoutSec 3 | Out-Null
} catch {}

$open = $true
$settingsPath = Join-Path $Root 'app-settings.json'
if (Test-Path $settingsPath) {
  try {
    $s = Get-Content $settingsPath -Raw | ConvertFrom-Json
    if ($null -ne $s.openPanelOnStart) { $open = [bool]$s.openPanelOnStart }
  } catch {}
}

if ($open) {
  Start-Process 'http://127.0.0.1:8317/management.html'
}
