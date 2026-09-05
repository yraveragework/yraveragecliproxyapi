@echo off
REM Session launcher used by the Claude-only management worker.
REM Uses the native Claude login — do NOT route this session through the proxy.
setlocal
cd /d "%~dp0\.."

set HTTPS_PROXY=
set HTTP_PROXY=
set ALL_PROXY=
set https_proxy=
set http_proxy=
set all_proxy=

set ANTHROPIC_BASE_URL=
set ANTHROPIC_AUTH_TOKEN=
set CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=
set CLIPROXY_DIR=%cd%

where claude >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] claude not found in PATH.
  echo Install with: npm install -g @anthropic-ai/claude-code
  pause
  exit /b 1
)

title ClaudeSession
echo Claude-only session (direct login, no proxy)
echo   Model: claude-fable-5 @ high
echo   Command:    /claude ^<brief^>
echo.
claude --model claude-fable-5 %*
endlocal
