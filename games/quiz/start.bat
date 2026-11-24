@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Quiz Lite - LAN Quiz

rem --- Check Node.js ---------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] Node.js was not found.
  echo  Install Node.js 22 or newer from https://nodejs.org
  echo  Then close this window and run start.bat again.
  echo.
  pause
  exit /b 1
)

rem --- Install dependencies on the first run ---------------------------------
if not exist "node_modules\express\package.json" (
  echo.
  echo  First run: installing dependencies. This may take a minute...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [ERROR] npm install failed. Check your internet connection
    echo  and run manually: npm install
    echo.
    pause
    exit /b 1
  )
)

echo.
echo  Starting Quiz Lite server. Press Ctrl+C to stop.
echo.

node server\index.js %*

if errorlevel 1 (
  echo.
  echo  [ERROR] The server exited with an error. See the log above.
  echo.
  pause
)
