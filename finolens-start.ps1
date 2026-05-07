$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$host.UI.RawUI.WindowTitle = "FinoLens Terminal"
Clear-Host

Write-Host ""
Write-Host " FinoLens Terminal - Starting..." -ForegroundColor Cyan
Write-Host " --------------------------------------------- " -ForegroundColor DarkGray
Write-Host ""

# Check Node.js
try { $nodeVer = node --version 2>&1; Write-Host " [OK] Node.js $nodeVer" -ForegroundColor Green }
catch { Write-Host " [ERROR] Node.js not found. Install from nodejs.org" -ForegroundColor Red; Read-Host; exit }

# Check Python 3.11+
$pyCmd = $null
foreach ($cmd in @("py -3.11", "python3.11", "python3", "python")) {
    try {
        $ver = & $cmd.Split()[0] ($cmd.Split()[1..99]) --version 2>&1
        if ($ver -match "3\.(11|10|12|9)") {
            $pyCmd = $cmd
            Write-Host " [OK] Found $ver (using: $cmd)" -ForegroundColor Green
            break
        }
    } catch {}
}
if (-not $pyCmd) {
    Write-Host " [ERROR] Python 3.11 not found." -ForegroundColor Red
    Write-Host " Install from https://python.org - check Add to PATH" -ForegroundColor Red
    Read-Host
    exit
}

Write-Host ""
Write-Host " [1/5] Checking backend dependencies..." -ForegroundColor Yellow
if (-not (Test-Path "$ROOT\backend\node_modules")) {
    Write-Host " Installing backend packages (first time)..." -ForegroundColor Yellow
    Set-Location "$ROOT\backend"
    npm install --silent
}
Write-Host " [OK] Backend packages ready" -ForegroundColor Green

Write-Host " [2/5] Checking frontend dependencies..." -ForegroundColor Yellow
if (-not (Test-Path "$ROOT\frontend\node_modules")) {
    Write-Host " Installing frontend packages (first time)..." -ForegroundColor Yellow
    Set-Location "$ROOT\frontend"
    npm install --silent
}
Write-Host " [OK] Frontend packages ready" -ForegroundColor Green

Write-Host " [3/5] Checking Python environment..." -ForegroundColor Yellow
if (-not (Test-Path "$ROOT\ml-service\venv")) {
    Write-Host " Creating Python virtual environment..." -ForegroundColor Yellow
    Set-Location "$ROOT\ml-service"
    $pySplit = $pyCmd.Split()
    if ($pySplit.Length -gt 1) {
        & $pySplit[0] $pySplit[1] -m venv "$ROOT\ml-service\venv"
    } else {
        & $pySplit[0] -m venv "$ROOT\ml-service\venv"
    }
    & "$ROOT\ml-service\venv\Scripts\pip.exe" install -r "$ROOT\ml-service\requirements.txt"
}
Write-Host " [OK] Python environment ready" -ForegroundColor Green

# Copy .env if missing
if (-not (Test-Path "$ROOT\backend\.env")) {
    if (Test-Path "$ROOT\backend\.env.example") {
        Copy-Item "$ROOT\backend\.env.example" "$ROOT\backend\.env"
        Write-Host " [INFO] Created backend\.env from example" -ForegroundColor Cyan
    }
}

Write-Host " [4/5] Starting services..." -ForegroundColor Yellow
Write-Host ""

# Start ML Service
Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$ROOT\ml-service'; & '$ROOT\ml-service\venv\Scripts\python.exe' -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload`"" -WindowStyle Normal

# Start Node Backend
Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$ROOT\backend'; node src/server.js`"" -WindowStyle Normal

# Start React Frontend
Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$ROOT\frontend'; npm run dev`"" -WindowStyle Normal

Write-Host " [5/5] Waiting for services to boot..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

Write-Host ""
Write-Host " --------------------------------------------- " -ForegroundColor DarkGray
Write-Host "  ML Service  ->  http://localhost:8000" -ForegroundColor Cyan
Write-Host "  Backend     ->  http://localhost:5000" -ForegroundColor Cyan
Write-Host "  FinoLens    ->  http://localhost:3000" -ForegroundColor Cyan
Write-Host " --------------------------------------------- " -ForegroundColor DarkGray
Write-Host ""
Write-Host " Opening FinoLens in browser..." -ForegroundColor Green
Start-Sleep -Seconds 2

Start-Process "http://localhost:3000"

Write-Host ""
Write-Host " FinoLens is running." -ForegroundColor Green
Write-Host " Three PowerShell service windows must stay open." -ForegroundColor Yellow
Write-Host " Close them to stop FinoLens." -ForegroundColor Yellow
Write-Host ""
Read-Host " Press Enter to close this window"
