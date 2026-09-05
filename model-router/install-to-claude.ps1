# Install / export model-router into Claude Code so /fabsol, /fabkim, /claude, /moonshot work.
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\Tools\CLIProxyAPI\model-router\install-to-claude.ps1

$ErrorActionPreference = 'Stop'
$PluginRoot = $PSScriptRoot
$ClaudeHome = Join-Path $env:USERPROFILE '.claude'
$CursorSkills = Join-Path $env:USERPROFILE '.cursor\skills'

function Copy-Tree([string]$src, [string]$dest) {
  if (-not (Test-Path $src)) {
    Write-Warning "missing source: $src"
    return $false
  }
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force
  return $true
}

Write-Host "Plugin root: $PluginRoot"
Write-Host "Claude home: $ClaudeHome"

# Manual install (plain /fabkim /claude /moonshot /fabsol)
[void](Copy-Tree (Join-Path $PluginRoot 'skills\fabsol') (Join-Path $ClaudeHome 'skills\fabsol'))
[void](Copy-Tree (Join-Path $PluginRoot 'skills\fabkim') (Join-Path $ClaudeHome 'skills\fabkim'))
[void](Copy-Tree (Join-Path $PluginRoot 'skills\claude') (Join-Path $ClaudeHome 'skills\claude'))
[void](Copy-Tree (Join-Path $PluginRoot 'skills\moonshot') (Join-Path $ClaudeHome 'skills\moonshot'))
[void](Copy-Tree (Join-Path $PluginRoot 'skills\model-router') (Join-Path $ClaudeHome 'skills\model-router'))
[void](Copy-Tree (Join-Path $PluginRoot 'skills\fabkim') (Join-Path $CursorSkills 'fabkim'))
[void](Copy-Tree (Join-Path $PluginRoot 'skills\claude') (Join-Path $CursorSkills 'claude'))
[void](Copy-Tree (Join-Path $PluginRoot 'skills\moonshot') (Join-Path $CursorSkills 'moonshot'))

New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeHome 'commands') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeHome 'agents') | Out-Null
Copy-Item (Join-Path $PluginRoot 'commands\fabsol.md') (Join-Path $ClaudeHome 'commands\fabsol.md') -Force
Copy-Item (Join-Path $PluginRoot 'commands\fabkim.md') (Join-Path $ClaudeHome 'commands\fabkim.md') -Force
Copy-Item (Join-Path $PluginRoot 'commands\claude.md') (Join-Path $ClaudeHome 'commands\claude.md') -Force
Copy-Item (Join-Path $PluginRoot 'commands\moonshot.md') (Join-Path $ClaudeHome 'commands\moonshot.md') -Force
Copy-Item (Join-Path $PluginRoot 'agents\worker.md') (Join-Path $ClaudeHome 'agents\worker.md') -Force

Write-Host 'Manual skills/commands synced to ~/.claude and ~/.cursor/skills'

$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
  Write-Warning 'claude CLI not on PATH - skipped plugin marketplace install. Manual slash commands still work after restarting Claude.'
  exit 0
}

Write-Host 'Validating plugin...'
& claude plugin validate $PluginRoot
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'Plugin validation reported issues - continuing with marketplace add/install'
}

$existing = (& claude plugin marketplace list 2>$null | Out-String)
if ($existing -notmatch 'robonuggets') {
  Write-Host "Adding local marketplace: $PluginRoot"
  & claude plugin marketplace add $PluginRoot
} else {
  Write-Host 'Marketplace robonuggets already registered - updating'
  & claude plugin marketplace update robonuggets
}

Write-Host 'Installing model-router@robonuggets (user scope)...'
& claude plugin install 'model-router@robonuggets' --scope user

Write-Host ''
Write-Host 'Done. Restart Claude Code / Claude Desktop, then try:'
Write-Host '  /fabkim YOUR_BRIEF'
Write-Host '  /claude YOUR_BRIEF'
Write-Host '  /moonshot YOUR_BRIEF'
Write-Host '  /model-router:fabkim YOUR_BRIEF'
Write-Host '  /model-router:claude YOUR_BRIEF'
Write-Host '  /model-router:moonshot YOUR_BRIEF'
Write-Host ''
Write-Host 'List plugins:  claude plugin list'
