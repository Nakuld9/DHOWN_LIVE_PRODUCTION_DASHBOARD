@echo off
REM One-shot repair: the cloudflared service was registered without a run command.
REM Point it at "tunnel run" (config.yml in the system profile supplies the rest).

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Stopping cloudflared service...
sc stop Cloudflared >nul 2>&1

set "CF_SYS=%SystemRoot%\System32\config\systemprofile\.cloudflared"
if not exist "%CF_SYS%" mkdir "%CF_SYS%"
copy /Y "C:\Users\nakul\.cloudflared\config.yml" "%CF_SYS%\config.yml" >nul
copy /Y "C:\Users\nakul\.cloudflared\*.json" "%CF_SYS%\" >nul 2>&1

echo Setting the service run command to "tunnel run"...
sc config Cloudflared binPath= "\"C:\Program Files (x86)\cloudflared\cloudflared.exe\" tunnel run"
sc config Cloudflared start= auto

echo Starting cloudflared service...
sc start Cloudflared
timeout /t 6 /nobreak >nul

echo.
echo ---- state ----
sc query Cloudflared | findstr STATE
echo.
pause
