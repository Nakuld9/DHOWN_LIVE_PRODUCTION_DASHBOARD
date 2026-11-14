@echo off
REM DHOWN MES — STAGING instance (a prod-copy for testing changes before go-live).
REM Runs on port 4001 against the dhown_mes_staging DB. All side-effects are OFF:
REM no scheduled jobs, no backups, no tracking-API calls, no WhatsApp sends.
REM Refresh the DB first with: powershell -File staging-refresh.ps1
REM Stop with Ctrl+C.

cd /d "D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend"
set STAGING=true
set DB_NAME=dhown_mes_staging
set PORT=4001
set WHATSAPP_TOKEN=
set TRACKING_API_KEY=
set DC_API_KEY=
echo(
echo   === DHOWN MES STAGING ===
echo   URL : http://localhost:4001
echo   DB  : dhown_mes_staging  (copy of production)
echo   Jobs/backups/tracking/WhatsApp: DISABLED
echo   Press Ctrl+C to stop.
echo(
"C:\Program Files\nodejs\node.exe" server.js
