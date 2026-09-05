@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "CLIPROXY_DIR=%~dp0"

echo Stopping Claude auto-start worker...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":19888 .*LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)

echo Stopping FabSol worker...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":19889 .*LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)

echo Stopping FabKim worker...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":19892 .*LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)

echo Stopping Moonshot worker...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":19891 .*LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)

echo Stopping Claude session worker...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":19893 .*LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)

echo Stopping local settings worker...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":19890 .*LISTENING"') do (
  taskkill /PID %%a /F >nul 2>&1
)

tasklist /FI "IMAGENAME eq cli-proxy-api.exe" | find /I "cli-proxy-api.exe" >nul
if %ERRORLEVEL% NEQ 0 (
  echo CLI Proxy API is not running.
  endlocal
  exit /b 0
)

echo Stopping CLI Proxy API...
taskkill /IM cli-proxy-api.exe /F >nul 2>&1

timeout /t 1 /nobreak >nul

tasklist /FI "IMAGENAME eq cli-proxy-api.exe" | find /I "cli-proxy-api.exe" >nul
if %ERRORLEVEL%==0 (
  echo [ERROR] Could not stop the process.
  pause
  exit /b 1
)

echo Stopped.
endlocal
