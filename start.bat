@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Igroteka

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] Node.js 22 or newer is required.
  echo  Install it from https://nodejs.org
  echo.
  pause
  exit /b 1
)

node tools\start-all.mjs
if errorlevel 1 (
  echo.
  pause
)