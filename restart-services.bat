@echo off
REM Restart the two MES backends so they re-read backend\.env
REM (e.g. after pasting WHATSAPP_APP_SECRET or WHATSAPP_TOKEN).
REM The cloudflared tunnel is left running - it does not read .env and
REM restarting it would briefly drop the public URL. Double-click; approve UAC.

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Restarting DHOWN MES...
net stop "dhownmes.exe"
net start "dhownmes.exe"

echo.
echo Restarting VD Knits MES...
net stop "vdknitsmes.exe"
net start "vdknitsmes.exe"

echo.
echo ---- state ----
sc query "dhownmes.exe"   | findstr STATE
sc query "vdknitsmes.exe" | findstr STATE
sc query "Cloudflared"    | findstr STATE
echo.
echo Both backends restarted and now serving the current .env values.
echo (Cloudflared was left running.)
echo.
pause
