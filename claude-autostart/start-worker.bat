@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js to run Claude auto-start.
  exit /b 1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":19888 .*LISTENING"') do (
  echo Claude auto-start worker already running on port 19888.
  exit /b 0
)

start "ClaudeAutoStart" /MIN cmd /c "node worker.mjs >> worker.log 2>&1"
exit /b 0
