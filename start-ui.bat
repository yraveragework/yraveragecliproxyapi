@echo off
setlocal
cd /d "%~dp0"

echo Launching local control panel on http://127.0.0.1:9080/
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File webui\server.ps1' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:9080/"
endlocal
