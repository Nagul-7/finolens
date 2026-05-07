@echo off
echo Creating FinoLens desktop shortcut...

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "SHORTCUT=%USERPROFILE%\Desktop\FinoLens Terminal.lnk"
set "LAUNCHER=%ROOT%\finolens-launcher.bat"
set "ICON=%ROOT%\frontend\public\favicon.ico"

:: Use PowerShell to create a proper .lnk shortcut
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%LAUNCHER%'; $s.WorkingDirectory = '%ROOT%'; $s.Description = 'FinoLens Terminal - Stock Intelligence Platform'; if (Test-Path '%ICON%') { $s.IconLocation = '%ICON%' }; $s.Save()"

if exist "%SHORTCUT%" (
    echo.
    echo  SUCCESS: FinoLens shortcut created on your Desktop.
    echo  Double-click "FinoLens Terminal" icon to launch.
    echo.
) else (
    echo.
    echo  Shortcut created. Check your Desktop.
    echo.
)
pause
