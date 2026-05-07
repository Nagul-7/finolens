@echo off
title FinoLens — Stop All Services
echo Stopping FinoLens services...
echo.

:: Kill processes on ports 3000, 5000, 8000
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5000 "') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| find ":8000 "') do taskkill /F /PID %%a >nul 2>&1

echo All FinoLens services stopped.
echo.
pause
