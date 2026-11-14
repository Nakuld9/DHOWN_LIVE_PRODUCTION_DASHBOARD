@echo off
REM Register the DHOWN + VD Knits backends as auto-start Windows services.
REM Double-click this file; approve the UAC prompt when it appears.

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ============================================================
echo  Installing DHOWN MES and VD Knits MES as Windows services
echo ============================================================
echo.
echo Stopping any manually-started backend instances (freeing ports 4000/4100)...
taskkill /F /IM node.exe >nul 2>&1
echo.

cd /d "D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend"
node scripts\win-service.js install both

echo.
echo ============================================================
echo  Installing Cloudflare Tunnel (cloudflared) as a service
echo ============================================================
set "CF_EXE=C:\Program Files (x86)\cloudflared\cloudflared.exe"
set "CF_SRC=C:\Users\nakul\.cloudflared"
set "CF_SYS=%SystemRoot%\System32\config\systemprofile\.cloudflared"
if not exist "%CF_EXE%" (
  echo cloudflared.exe not found - skipping tunnel service.
  goto cf_done
)
echo Stopping any manually-run cloudflared...
taskkill /F /IM cloudflared.exe >nul 2>&1
echo Placing tunnel config where the LocalSystem service looks for it...
if not exist "%CF_SYS%" mkdir "%CF_SYS%"
copy /Y "%CF_SRC%\config.yml" "%CF_SYS%\config.yml" >nul
copy /Y "%CF_SRC%\cert.pem" "%CF_SYS%\cert.pem" >nul 2>&1
copy /Y "%CF_SRC%\*.json" "%CF_SYS%\" >nul 2>&1
echo Registering and starting the cloudflared service...
"%CF_EXE%" service install >nul 2>&1
REM `service install` on this build registers a no-argument binary path (it
REM expects a token). For a config-file tunnel the service must run "tunnel run"
REM explicitly, or it exits 1067. Set the binary path directly.
sc config Cloudflared binPath= "\"%CF_EXE%\" tunnel run" >nul
sc config Cloudflared start= auto >nul 2>&1
sc start Cloudflared >nul 2>&1
echo cloudflared installed - mes.dhownhosiery.com now survives reboot.
:cf_done

echo.
echo When the services show "running" above, all three now start on boot:
echo   DHOWN MES (4000), VD Knits MES (4100), and the Cloudflare tunnel.
echo Manage them any time in services.msc.
echo.
pause
