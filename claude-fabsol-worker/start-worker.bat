@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js to run FabSol worker.
  exit /b 1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":19889 .*LISTENING"') do (
  echo FabSol worker already running on port 19889.
  exit /b 0
)

start "ClaudeFabSolWorker" /MIN cmd /c "node worker.mjs >> worker.log 2>&1"
exit /b 0
