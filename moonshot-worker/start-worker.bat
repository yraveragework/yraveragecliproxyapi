@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js to run Moonshot worker.
  exit /b 1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":19891 .*LISTENING"') do (
  echo Moonshot worker already running on port 19891.
  exit /b 0
)

start "ClaudeMoonshotWorker" /MIN cmd /c "node worker.mjs >> worker.log 2>&1"
exit /b 0
