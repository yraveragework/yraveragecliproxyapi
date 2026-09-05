@echo off
setlocal
cd /d "%~dp0"
echo Installing FabSol / FabKim / Claude / Moonshot into Claude Code...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0model-router\install-to-claude.ps1"
if errorlevel 1 (
  echo [ERROR] Install failed.
  pause
  exit /b 1
)
echo.
pause
endlocal
