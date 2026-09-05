@echo off
REM Session launcher used by the Moonshot management worker.
REM Assumes CLIProxyAPI is already running on :8317.
setlocal
cd /d "%~dp0\.."

set HTTPS_PROXY=
set HTTP_PROXY=
set ALL_PROXY=
set https_proxy=
set http_proxy=
set all_proxy=

set ANTHROPIC_BASE_URL=http://127.0.0.1:8317
set ANTHROPIC_AUTH_TOKEN=CHANGE_ME_LOCAL_SECRET
set CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1
set MODEL_ROUTER_URL=http://127.0.0.1:8317
set MODEL_ROUTER_KEY=CHANGE_ME_LOCAL_SECRET
set MODEL_ROUTER_MODEL=kimi-k3
set MODEL_ROUTER_EFFORT=high
set CLIPROXY_DIR=%cd%

where claude >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] claude not found in PATH.
  echo Install with: npm install -g @anthropic-ai/claude-code
  pause
  exit /b 1
)

title ClaudeMoonshot
echo Moonshot session ready via proxy :8317
echo   Kimi model: kimi-k3 @ high
echo   Command:    /moonshot ^<brief^>
echo.
claude --model kimi-k3 %*
endlocal
