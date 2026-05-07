@echo off
echo Creating FinoLens desktop shortcut...

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

:: Get the correct Desktop path (works for both OneDrive
:: and standard Desktop)
for /f "usebackq tokens=3*" %%i in (`reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" /v Desktop 2^>nul`) do set "DESKTOP=%%i %%j"
if "%DESKTOP:~-1%"==" " set "DESKTOP=%DESKTOP:~0,-1%"

:: Fallback if registry query failed
if not defined DESKTOP set "DESKTOP=%USERPROFILE%\OneDrive\Desktop"
if not exist "%DESKTOP%" set "DESKTOP=%USERPROFILE%\Desktop"

set "SHORTCUT=%DESKTOP%\FinoLens Terminal.lnk"
set "LAUNCHER=%ROOT%\finolens-launcher.bat"
set "PS1=%ROOT%\finolens-start.ps1"
set "ICON=%ROOT%\frontend\public\favicon.ico"

echo Desktop path detected: %DESKTOP%
echo.

:: Write PowerShell script to a temp file to avoid
:: quoting issues with spaces in paths
set "PS=%TEMP%\create_finolens_shortcut.ps1"

echo $ws = New-Object -ComObject WScript.Shell > "%PS%"
echo $s = $ws.CreateShortcut('%SHORTCUT%') >> "%PS%"
echo $s.TargetPath = '%LAUNCHER%' >> "%PS%"
echo $s.WorkingDirectory = '%ROOT%' >> "%PS%"
echo $s.Description = 'FinoLens Terminal' >> "%PS%"
echo if (Test-Path '%ICON%') { $s.IconLocation = '%ICON%' } >> "%PS%"
echo $s.Save() >> "%PS%"

powershell -ExecutionPolicy Bypass -File "%PS%"
del "%PS%" >nul 2>&1

if exist "%SHORTCUT%" (
    echo.
    echo  SUCCESS: FinoLens shortcut created at:
    echo  %SHORTCUT%
    echo.
    echo  Double-click "FinoLens Terminal" on your Desktop to launch.
    echo.
) else (
    echo.
    echo  Shortcut could not be created automatically.
    echo  To launch manually, double-click:
    echo  %ROOT%\finolens-launcher.bat
    echo  Or run directly: powershell -File "%PS1%"
    echo.
)
pause
