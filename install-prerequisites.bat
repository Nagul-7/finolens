@echo off
title FinoLens — Install Prerequisites
color 0A
cls

echo.
echo  FinoLens Prerequisites Installer
echo  This will install: Git, Node.js 20, Python 3.11,
echo  Memurai (Redis), PostgreSQL 16
echo  ─────────────────────────────────────────────
echo  This may take 10-15 minutes depending on internet speed.
echo  Do not close this window.
echo.
pause

:: Check if running as Administrator
net session >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Please run this script as Administrator.
    echo  Right-click the file and select "Run as administrator"
    echo.
    pause
    exit /b 1
)

:: Try winget first (Windows 11 / updated Windows 10)
winget --version >nul 2>&1
if errorlevel 1 (
    echo  [INFO] winget not found. Using direct download method.
    goto :direct_download
)

echo  [INFO] Using winget installer...
echo.

:: Git
echo  [1/5] Installing Git...
winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
echo  Git done.

:: Node.js 20
echo  [2/5] Installing Node.js 20...
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
echo  Node.js done.

:: Python 3.11
echo  [3/5] Installing Python 3.11...
winget install --id Python.Python.3.11 -e --silent --accept-package-agreements --accept-source-agreements
echo  Python done.

:: PostgreSQL 16
echo  [4/5] Installing PostgreSQL 16...
winget install --id PostgreSQL.PostgreSQL.16 -e --silent --accept-package-agreements --accept-source-agreements
echo  PostgreSQL done.

:: Memurai (not on winget — direct download)
echo  [5/5] Installing Memurai (Redis for Windows)...
goto :install_memurai

:direct_download
echo  [INFO] Downloading installers directly...
echo.

:: Create temp folder
mkdir "%TEMP%\finolens_setup" 2>nul
cd /d "%TEMP%\finolens_setup"

:: Git
echo  [1/5] Downloading Git...
curl -L -o git_installer.exe "https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe"
echo  Installing Git silently...
git_installer.exe /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"
echo  Git done.

:: Node.js 20
echo  [2/5] Downloading Node.js 20...
curl -L -o node_installer.msi "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi"
echo  Installing Node.js silently...
msiexec /i node_installer.msi /quiet /norestart
echo  Node.js done.

:: Python 3.11
echo  [3/5] Downloading Python 3.11...
curl -L -o python_installer.exe "https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe"
echo  Installing Python silently (adding to PATH)...
python_installer.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
echo  Python done.

:: PostgreSQL 16
echo  [4/5] Downloading PostgreSQL 16...
curl -L -o pg_installer.exe "https://get.enterprisedb.com/postgresql/postgresql-16.2-1-windows-x64.exe"
echo  Installing PostgreSQL silently (password: finolens123)...
pg_installer.exe --unattendedmodeui none --mode unattended --superpassword finolens123 --serverport 5432
echo  PostgreSQL done. Password is: finolens123

:install_memurai
echo  [5/5] Downloading Memurai (Redis for Windows)...
curl -L -o "%TEMP%\finolens_setup\memurai_installer.msi" "https://www.memurai.com/static/download/Memurai-Developer-v4.0.2.msi"
echo  Installing Memurai silently...
msiexec /i "%TEMP%\finolens_setup\memurai_installer.msi" /quiet /norestart
echo  Memurai done.

:: Refresh PATH
echo.
echo  Refreshing environment variables...
set "PATH=%PATH%;C:\Program Files\Git\bin;C:\Program Files\nodejs;C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python311;C:\Program Files\PostgreSQL\16\bin"

:: Verify installations
echo.
echo  ─────────────────────────────────────────────
echo  Verifying installations...
echo  ─────────────────────────────────────────────

git --version >nul 2>&1 && echo  [OK] Git installed || echo  [FAIL] Git - restart PC and check
node --version >nul 2>&1 && echo  [OK] Node.js installed || echo  [FAIL] Node.js - restart PC and check
python --version >nul 2>&1 && echo  [OK] Python installed || echo  [FAIL] Python - restart PC and check
psql --version >nul 2>&1 && echo  [OK] PostgreSQL installed || echo  [FAIL] PostgreSQL - restart PC and check

echo.
echo  ─────────────────────────────────────────────
echo  All prerequisites installed.
echo.
echo  IMPORTANT NEXT STEPS:
echo  1. Restart your computer now
echo  2. PostgreSQL password is: finolens123
echo     Open backend\.env and set:
echo     DATABASE_URL=postgresql://postgres:finolens123@localhost:5432/finolens
echo  3. After restart, run Create-FinoLens-Shortcut.bat
echo  4. Double-click FinoLens Terminal icon on Desktop
echo  ─────────────────────────────────────────────
echo.
pause
exit /b 0
