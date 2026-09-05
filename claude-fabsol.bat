@echo off
setlocal
cd /d "%~dp0"

REM Clear SOCKS proxy vars - Claude Code's client often breaks on socks5://
set HTTPS_PROXY=
set HTTP_PROXY=
set ALL_PROXY=
set https_proxy=
set http_proxy=
set all_proxy=

REM Main Claude Code session talks to CLIProxyAPI (Claude OAuth already logged in there).
REM Workers (FabSol / Sol) use the same proxy via MODEL_ROUTER_* env vars.
set ANTHROPIC_BASE_URL=http://127.0.0.1:8317
set ANTHROPIC_AUTH_TOKEN=CHANGE_ME_LOCAL_SECRET
set CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1

if not defined MODEL_ROUTER_URL set MODEL_ROUTER_URL=http://127.0.0.1:8317
if not defined MODEL_ROUTER_KEY set MODEL_ROUTER_KEY=CHANGE_ME_LOCAL_SECRET
if not defined MODEL_ROUTER_MODEL set MODEL_ROUTER_MODEL=gpt-5.6-sol
if not defined MODEL_ROUTER_EFFORT set MODEL_ROUTER_EFFORT=high
if not defined CLIPROXY_DIR set CLIPROXY_DIR=%~dp0

tasklist /FI "IMAGENAME eq cli-proxy-api.exe" | find /I "cli-proxy-api.exe" >nul
if %ERRORLEVEL% NEQ 0 (
  echo Proxy not running. Starting...
  call "%~dp0start.bat"
)

where claude >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] claude not found in PATH. Open a new terminal after npm install, or run:
  echo   npm install -g @anthropic-ai/claude-code
  pause
  exit /b 1
)

echo Starting Claude Code via proxy :8317
echo   Orchestrator model: claude-fable-5
echo   Worker default:     %MODEL_ROUTER_MODEL% @ %MODEL_ROUTER_EFFORT%
echo   FabSol command:     /fabsol ^<brief^>
echo.

claude --model claude-fable-5 %*
endlocal
