@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting "100 k odnomu" server...
echo Default address: http://localhost:8101
echo If the port is busy, the next free port will be used automatically.
echo.
call npm start
echo.
echo Server stopped.
pause
