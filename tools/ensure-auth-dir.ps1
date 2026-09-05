$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$auth = 'C:\cli-proxy-api'
$configPath = Join-Path $Root 'config.yaml'
if (Test-Path $configPath) {
  $match = Select-String -Path $configPath -Pattern '^\s*auth-dir:\s*["'']?([^"''#\r\n]+)' | Select-Object -First 1
  if ($match) {
    $auth = $match.Matches[0].Groups[1].Value.Trim().Replace('/', '\')
  }
}
if (-not (Test-Path -LiteralPath $auth)) {
  New-Item -ItemType Directory -Path $auth -Force | Out-Null
}
Write-Output $auth
