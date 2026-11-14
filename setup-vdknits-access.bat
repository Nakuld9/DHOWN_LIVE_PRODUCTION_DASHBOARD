@echo off
REM Open VD Knits (:4100) on the LAN and over the tunnel (vdknits.dhownhosiery.com).
REM Double-click; approve the UAC prompt.

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo [1/3] Allowing inbound TCP 4100 through Windows Firewall (LAN access)...
netsh advfirewall firewall show rule name="VD Knits MES Backend Port 4100" >nul 2>&1
if %errorLevel% neq 0 (
  netsh advfirewall firewall add rule name="VD Knits MES Backend Port 4100" dir=in action=allow protocol=TCP localport=4100
) else (
  echo     rule already exists - skipping
)

echo [2/3] Pushing updated tunnel config to the service profile...
set "CF_SYS=%SystemRoot%\System32\config\systemprofile\.cloudflared"
if not exist "%CF_SYS%" mkdir "%CF_SYS%"
copy /Y "C:\Users\nakul\.cloudflared\config.yml" "%CF_SYS%\config.yml" >nul

echo [3/3] Restarting the cloudflared service to load the new route...
sc stop Cloudflared >nul 2>&1
timeout /t 3 /nobreak >nul
sc start Cloudflared >nul 2>&1
timeout /t 5 /nobreak >nul
sc query Cloudflared | findstr STATE

echo.
echo Done.
echo   LAN:    http://192.168.1.252:4100
echo   Public: https://vdknits.dhownhosiery.com
echo.
pause
