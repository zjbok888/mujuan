@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
node "%~dp0scripts\stop-server.mjs" %*
if errorlevel 1 (
  echo.
  pause
  goto :eof
)
if "%~1"=="" ping -n 3 127.0.0.1 >nul 2>&1
endlocal
