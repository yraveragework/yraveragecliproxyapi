@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "CLIPROXY_DIR=%~dp0"
if "%CLIPROXY_DIR:~-1%"=="\" set "CLIPROXY_DIR=%CLIPROXY_DIR:~0,-1%"

if not exist "cli-proxy-api.exe" (
  echo [ERROR] cli-proxy-api.exe not found in:
  echo   %cd%
  pause
  exit /b 1
)

if not exist "config.yaml" (
  echo [ERROR] config.yaml not found. Copy config.yaml.example to config.yaml first.
  pause
  exit /b 1
)

if not exist "logs" mkdir "logs"

if exist "tools\ensure-auth-dir.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "tools\ensure-auth-dir.ps1" >nul 2>&1
)

tasklist /FI "IMAGENAME eq cli-proxy-api.exe" | find /I "cli-proxy-api.exe" >nul
if %ERRORLEVEL%==0 (
  echo CLI Proxy API is already running.
) else (
  echo Starting CLI Proxy API on port 8317...
  start "CLIProxyAPI" /MIN cmd /c "cli-proxy-api.exe --config config.yaml >> logs\proxy.log 2>&1"
  timeout /t 2 /nobreak >nul
)

tasklist /FI "IMAGENAME eq cli-proxy-api.exe" | find /I "cli-proxy-api.exe" >nul
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Failed to start. Check logs\proxy.log
  pause
  exit /b 1
)

if exist "claude-autostart\start-worker.bat" (
  call "claude-autostart\start-worker.bat"
  if errorlevel 1 (
    echo [WARN] Claude auto-start worker did not start. Quota toggles need Node.js.
  ) else (
    echo Claude auto-start worker: http://127.0.0.1:19888/
  )
)

if exist "claude-fabsol-worker\start-worker.bat" (
  call "claude-fabsol-worker\start-worker.bat"
  if errorlevel 1 (
    echo [WARN] FabSol worker did not start. Operate ^> FabSol needs Node.js.
  ) else (
    echo FabSol worker: http://127.0.0.1:19889/
  )
)

if exist "claude-fabkim-worker\start-worker.bat" (
  call "claude-fabkim-worker\start-worker.bat"
  if errorlevel 1 (
    echo [WARN] FabKim worker did not start. Operate ^> FabKim needs Node.js.
  ) else (
    echo FabKim worker: http://127.0.0.1:19892/
  )
)

if exist "moonshot-worker\start-worker.bat" (
  call "moonshot-worker\start-worker.bat"
  if errorlevel 1 (
    echo [WARN] Moonshot worker did not start. Operate ^> Moonshot needs Node.js.
  ) else (
    echo Moonshot worker: http://127.0.0.1:19891/
  )
)

if exist "claude-session-worker\start-worker.bat" (
  call "claude-session-worker\start-worker.bat"
  if errorlevel 1 (
    echo [WARN] Claude session worker did not start. Operate ^> Claude needs Node.js.
  ) else (
    echo Claude session worker: http://127.0.0.1:19893/
  )
)

if exist "local-settings\start-worker.bat" (
  call "local-settings\start-worker.bat"
  if errorlevel 1 (
    echo [WARN] Local settings worker did not start. Settings tab needs Node.js.
  ) else (
    echo Local settings worker: http://127.0.0.1:19890/
  )
)

echo Started successfully.
echo   API:   http://127.0.0.1:8317/
echo   Panel: http://127.0.0.1:8317/management.html
echo   Panel password: (remote-management.secret-key in config.yaml)
echo   Client API key: (api-keys in config.yaml)

if exist "tools\post-start.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "tools\post-start.ps1"
) else (
  start "" "http://127.0.0.1:8317/management.html"
)

endlocal
