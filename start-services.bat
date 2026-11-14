@echo off
REM Start (or restart) the three MES services without opening services.msc.
REM Double-click; approve the UAC prompt.

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Starting services...
net start "dhownmes.exe"
net start "vdknitsmes.exe"
net start "Cloudflared"

echo.
echo ---- current state ----
sc query "dhownmes.exe"  | findstr STATE
sc query "vdknitsmes.exe" | findstr STATE
sc query "Cloudflared"    | findstr STATE
echo.
pause
