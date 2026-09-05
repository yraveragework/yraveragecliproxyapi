@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js to run local settings worker.
  exit /b 1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":19890 .*LISTENING"') do (
  echo Local settings worker already running on port 19890.
  exit /b 0
)

start "CLIProxyLocalSettings" /MIN cmd /c "node worker.mjs >> worker.log 2>&1"
exit /b 0
