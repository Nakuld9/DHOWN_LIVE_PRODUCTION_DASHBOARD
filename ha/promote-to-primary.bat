@echo off
REM ============================================================================
REM  DHOWN MES HA — PROMOTE THIS STANDBY TO PRIMARY  (failover)
REM ----------------------------------------------------------------------------
REM  Run on the STANDBY machine when the primary is DOWN. Promotes the local
REM  PostgreSQL replica to a read-write primary, then starts both MES services.
REM  After this, repoint access to this machine (see the end + HA_RUNBOOK.md).
REM
REM  Double-click; approve UAC.
REM ============================================================================

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set PGBIN=C:\Program Files\PostgreSQL\18\bin
set PGDATA=D:\PostgreSQL\Data

echo.
echo  Only run this when you are sure the OLD primary is DOWN (or isolated).
echo  Promoting while the old primary is still live + reachable by clients causes
echo  split-brain (two primaries, diverging data).
echo.
pause

echo Promoting PostgreSQL replica to PRIMARY...
"%PGBIN%\pg_ctl.exe" promote -D "%PGDATA%"
timeout /t 6 /nobreak >nul

echo Confirming no longer in recovery...
"%PGBIN%\psql.exe" -U postgres -h localhost -c "SELECT pg_is_in_recovery();"
echo  (expected: f = this machine is now a read-write PRIMARY)

echo.
echo Starting DHOWN MES...
net start "dhownmes.exe"
echo Starting VD Knits MES...
net start "vdknitsmes.exe"

echo.
echo ---- state ----
sc query "dhownmes.exe"   | findstr STATE
sc query "vdknitsmes.exe" | findstr STATE
echo.
echo  ================= THIS MACHINE IS NOW THE PRIMARY =================
echo   Repoint access so clients + the public URL reach it:
echo    - LAN clients: use this machine's IP (or move the shared hostname here)
echo    - Public URL: start the cloudflared tunnel on THIS machine
echo      (it was left running on the old primary; run it here instead).
echo   When the old primary is repaired, DO NOT just restart it as primary --
echo   rebuild it as the new standby with rebuild-standby.bat pointed here.
echo  ==================================================================
pause
