@echo off
REM Remove the DHOWN + VD Knits backend Windows services.
REM Double-click this file; approve the UAC prompt when it appears.
REM (After this, the backends no longer auto-start - run them manually or
REM  re-install with install-services.bat.)

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ============================================================
echo  Removing DHOWN MES and VD Knits MES Windows services
echo ============================================================
echo.

cd /d "D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend"
node scripts\win-service.js uninstall both

echo.
set "CF_EXE=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if exist "%CF_EXE%" (
  echo Removing cloudflared service...
  sc stop Cloudflared >nul 2>&1
  "%CF_EXE%" service uninstall
)

echo.
pause
