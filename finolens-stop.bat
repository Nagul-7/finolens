@echo off
PowerShell -NoProfile -ExecutionPolicy Bypass -Command "& {
    Write-Host 'Stopping FinoLens services...' -ForegroundColor Yellow
    @(3000, 5000, 8000) | ForEach-Object {
        $port = $_
        $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($conn) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
            Write-Host \"Stopped service on port $port\" -ForegroundColor Green
        }
    }
    Write-Host 'All FinoLens services stopped.' -ForegroundColor Green
    Start-Sleep 2
}"
