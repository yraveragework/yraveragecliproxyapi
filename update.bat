@echo off
setlocal
cd /d "%~dp0"
echo [CLIProxyAPI Update] Starting updater...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "tools\Update-CLIProxyAPI.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo [CLIProxyAPI Update] Update failed with exit code %EXIT_CODE%.
endlocal & exit /b %EXIT_CODE%
