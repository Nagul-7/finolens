@echo off
title FinoLens Terminal - Launcher
color 0A
cls

echo.
echo  FinoLens Terminal - Starting...
echo  ---------------------------------------------------------
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js is not installed.
    echo  Download from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python is not installed or not in PATH.
    echo  Download from: https://python.org
    echo  IMPORTANT: Check "Add Python to PATH" during install.
    echo.
    pause
    exit /b 1
)

:: Get script directory (project root)
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo  [1/6] Checking dependencies...

:: Install backend dependencies if needed
if not exist "%ROOT%\backend\node_modules" (
    echo  [2/6] Installing backend packages (first time only)...
    cd /d "%ROOT%\backend"
    call npm install --silent
) else (
    echo  [2/6] Backend packages OK
)

:: Install frontend dependencies if needed
if not exist "%ROOT%\frontend\node_modules" (
    echo  [3/6] Installing frontend packages (first time only)...
    cd /d "%ROOT%\frontend"
    call npm install --silent
) else (
    echo  [3/6] Frontend packages OK
)

:: Install Python dependencies if needed
if not exist "%ROOT%\ml-service\venv" (
    echo  [4/6] Creating Python virtual environment...
    cd /d "%ROOT%\ml-service"
    python -m venv venv
    "%ROOT%\ml-service\venv\Scripts\pip" install -r "%ROOT%\ml-service\requirements.txt"
) else (
    echo  [4/6] Python environment OK
)

echo  [5/6] Starting services...
echo.

:: Copy .env if it does not exist
if not exist "%ROOT%\backend\.env" (
    if exist "%ROOT%\backend\.env.example" (
        copy "%ROOT%\backend\.env.example" "%ROOT%\backend\.env" >nul
        echo  [INFO] Created backend\.env from example. Edit it to configure.
    )
)

:: Start ML Service (Python FastAPI) in new window
start "FinoLens ML Service" /min cmd /k "cd /d ""%ROOT%\ml-service"" && venv\Scripts\activate && python -m uvicorn main:app --host 0.0.0.0 --port 8000"

:: Start Node Backend in new window
start "FinoLens Backend" /min cmd /k "cd /d ""%ROOT%\backend"" && node src/server.js"

:: Start React Frontend in new window
start "FinoLens Frontend" /min cmd /k "cd /d ""%ROOT%\frontend"" && npm run dev"

:: Wait for services to boot
echo  Waiting for services to start...
timeout /t 8 /nobreak >nul

echo  [6/6] Opening FinoLens in browser...
echo.
echo  ---------------------------------------------------------
echo   ML Service  --  http://localhost:8000
echo   Backend     --  http://localhost:5000
echo   FinoLens    --  http://localhost:3000
echo  ---------------------------------------------------------
echo.
echo  Three minimised windows are running in the taskbar.
echo  Close them to stop FinoLens.
echo.
echo  Press any key to open FinoLens in your browser...
pause >nul

start http://localhost:3000

echo.
echo  FinoLens is running. This window can be closed.
echo  The 3 service windows in taskbar must stay open.
echo.
pause
exit /b 0
