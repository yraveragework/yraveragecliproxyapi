$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$UiRoot = $PSScriptRoot
$Port = 9080
$ProxyExe = Join-Path $Root "cli-proxy-api.exe"
$ConfigPath = Join-Path $Root "config.yaml"
$LogsDir = Join-Path $Root "logs"
$ProxyLog = Join-Path $LogsDir "proxy.log"

function Get-ConfigInfo {
  $port = 8317
  $apiKey = "CHANGE_ME_LOCAL_SECRET"
  $adminKey = "CHANGE_ME_LOCAL_SECRET"
  $passwordFile = Join-Path $UiRoot "panel-password.txt"

  if (Test-Path $passwordFile) {
    $fromFile = (Get-Content -Path $passwordFile -TotalCount 1 -ErrorAction SilentlyContinue)
    if (-not [string]::IsNullOrWhiteSpace($fromFile)) {
      $adminKey = $fromFile.Trim()
    }
  }

  if (Test-Path $ConfigPath) {
    $lines = Get-Content -Path $ConfigPath -ErrorAction SilentlyContinue
    $inApiKeys = $false
    foreach ($line in $lines) {
      if ($line -match '^\s*port:\s*(\d+)\s*$') {
        $port = [int]$Matches[1]
      }
      if ($line -match '^\s*api-keys:\s*$') { $inApiKeys = $true; continue }
      if ($line -match '^\S') { $inApiKeys = $false }
      if ($inApiKeys -and $line -match '^\s*-\s*"([^"]+)"\s*$') {
        $apiKey = $Matches[1]
        $inApiKeys = $false
      }
    }
  }

  return @{
    port     = $port
    apiKey   = $apiKey
    adminKey = $adminKey
  }
}

function Test-ProxyRunning {
  return $null -ne (Get-Process -Name "cli-proxy-api" -ErrorAction SilentlyContinue)
}

function Start-Proxy {
  if (Test-ProxyRunning) {
    return @{ ok = $true; running = $true; message = "Already running." }
  }
  if (-not (Test-Path $ProxyExe)) {
    return @{ ok = $false; running = $false; error = "cli-proxy-api.exe not found." }
  }
  if (-not (Test-Path $ConfigPath)) {
    return @{ ok = $false; running = $false; error = "config.yaml not found." }
  }

  if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir | Out-Null
  }
  $authDir = "C:\cli-proxy-api"
  if (-not (Test-Path $authDir)) {
    New-Item -ItemType Directory -Path $authDir | Out-Null
  }

  $arg = "/c `"`"$ProxyExe`" --config `"$ConfigPath`" >> `"$ProxyLog`" 2>&1`""
  Start-Process -FilePath "cmd.exe" -ArgumentList $arg -WorkingDirectory $Root -WindowStyle Hidden | Out-Null

  Start-Sleep -Seconds 2

  if (Test-ProxyRunning) {
    $p = (Get-ConfigInfo).port
    return @{ ok = $true; running = $true; message = "Started on port $p." }
  }
  return @{ ok = $false; running = $false; error = "Start failed. Check logs\proxy.log" }
}

function Stop-Proxy {
  $procs = Get-Process -Name "cli-proxy-api" -ErrorAction SilentlyContinue
  if (-not $procs) {
    return @{ ok = $true; running = $false; message = "Already stopped." }
  }
  $procs | Stop-Process -Force
  Start-Sleep -Milliseconds 600
  return @{
    ok      = $true
    running = (Test-ProxyRunning)
    message = "Stopped."
  }
}

function Send-Json($response, $status, $obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 6
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $response.StatusCode = $status
  $response.ContentType = "application/json; charset=utf-8"
  $response.ContentLength64 = $bytes.Length
  $response.AddHeader("Cache-Control", "no-store")
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.OutputStream.Close()
}

function Send-File($response, $path, $contentType) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $response.StatusCode = 200
  $response.ContentType = $contentType
  $response.ContentLength64 = $bytes.Length
  $response.AddHeader("Cache-Control", "no-store")
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.OutputStream.Close()
}

# Avoid duplicate listeners
try {
  $existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Control panel already listening on http://127.0.0.1:$Port/"
    exit 0
  }
} catch { }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

Write-Host "CLI Proxy control panel: http://127.0.0.1:$Port/"
Write-Host "Press Ctrl+C to close the control panel (proxy keeps running)."

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  $path = $req.Url.AbsolutePath.TrimEnd("/")
  if ([string]::IsNullOrWhiteSpace($path)) { $path = "/" }

  try {
    if ($path -eq "/api/status" -and $req.HttpMethod -eq "GET") {
      $info = Get-ConfigInfo
      Send-Json $res 200 @{
        running  = (Test-ProxyRunning)
        port     = $info.port
        apiKey   = $info.apiKey
        adminKey = $info.adminKey
      }
    }
    elseif ($path -eq "/api/start" -and $req.HttpMethod -eq "POST") {
      $result = Start-Proxy
      $info = Get-ConfigInfo
      $status = if ($result.ok) { 200 } else { 500 }
      Send-Json $res $status (@{
        running  = (Test-ProxyRunning)
        port     = $info.port
        apiKey   = $info.apiKey
        adminKey = $info.adminKey
        message  = $result.message
        error    = $result.error
      })
    }
    elseif ($path -eq "/api/stop" -and $req.HttpMethod -eq "POST") {
      $result = Stop-Proxy
      $info = Get-ConfigInfo
      Send-Json $res 200 (@{
        running  = (Test-ProxyRunning)
        port     = $info.port
        apiKey   = $info.apiKey
        adminKey = $info.adminKey
        message  = $result.message
      })
    }
    elseif ($path -eq "/" -or $path -eq "/index.html") {
      Send-File $res (Join-Path $UiRoot "index.html") "text/html; charset=utf-8"
    }
    else {
      Send-Json $res 404 @{ error = "Not found" }
    }
  }
  catch {
    try {
      Send-Json $res 500 @{ error = $_.Exception.Message }
    } catch { }
  }
}
