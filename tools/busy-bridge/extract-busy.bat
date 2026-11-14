@echo off
REM DHOWN MES - scheduled Busy mirror extract (READ-ONLY).
REM Runs the Windows extractor against the live DHOWN Busy company (COMP0004,
REM FY 26-27) and drops a busy-extract_*.json into the MES drop folder. The MES
REM backend poller (BUSY_INBOX_DIR) then ingests + reconciles it automatically.
REM Scheduled daily by the "DHOWN Busy Mirror Extract" task. Never writes to Busy.
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\tools\busy-bridge\extract-busy.ps1" -CompanyDir "C:\BusyWin\busy dhown indusind\COMP0004" -OutDir "D:\DHOWN_BUSY_INBOX"
