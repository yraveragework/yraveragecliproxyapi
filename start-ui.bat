@echo off
setlocal
cd /d "%~dp0"

echo Launching local control panel on http://127.0.0.1:9080/
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0webui\server.ps1"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:9080/"
endlocal
