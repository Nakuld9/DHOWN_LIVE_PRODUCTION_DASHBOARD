@echo off
REM DHOWN MES - local READ-ONLY Busy HTTP API launcher.
REM Serves Busy company data as JSON on http://127.0.0.1:8765 (localhost only).
REM Never writes to Busy. Set an API key with -ApiKey if you want one.
REM Install as an auto-start Windows service later (node-windows / nssm / Task Scheduler at logon).
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\tools\busy-bridge\busy-api.ps1" -DataDir "C:\BusyWin\busy dhown indusind" -Port 8765
