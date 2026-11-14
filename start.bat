@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
node "%~dp0scripts\serve.mjs" %*
if errorlevel 1 (
  echo.
  echo [start] failed. see messages above.
  pause
  goto :eof
)
if "%~1"=="" pause
endlocal
