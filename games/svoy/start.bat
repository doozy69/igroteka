@echo off
cd /d "%~dp0"
echo Starting "Svoya Igra" server...
echo Open http://localhost:8102 in your browser.
echo.
call npm start
echo.
echo Server stopped.
pause
