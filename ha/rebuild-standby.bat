@echo off
REM ============================================================================
REM  DHOWN MES HA — rebuild THIS machine as a streaming-replication STANDBY
REM ----------------------------------------------------------------------------
REM  Run on the SECOND (standby) machine. It DESTROYS this machine's local
REM  PostgreSQL data directory and re-syncs a fresh base backup from the primary,
REM  then starts PostgreSQL in standby mode (read-only, streaming from primary).
REM
REM  One-time, or whenever a machine needs to (re)join as standby after a failover.
REM  Edit PRIMARY_IP below first. Double-click; approve UAC.
REM ============================================================================

net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting administrator rights...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

REM ---- EDIT THESE ----
set PRIMARY_IP=<PRIMARY_IP>
set REPL_USER=replicator
set SLOT=standby1
REM --------------------
set PGBIN=C:\Program Files\PostgreSQL\18\bin
set PGDATA=D:\PostgreSQL\Data
set PGSVC=postgresql-x64-18

echo.
echo  This will STOP the MES + PostgreSQL services on THIS machine and
echo  DELETE %PGDATA%, then resync everything from %PRIMARY_IP%.
echo  Only do this on the STANDBY machine.
echo.
pause

echo Stopping MES + PostgreSQL services...
net stop "dhownmes.exe"    2>nul
net stop "vdknitsmes.exe"  2>nul
net stop "%PGSVC%"         2>nul

echo Clearing old data directory...
rmdir /s /q "%PGDATA%"
mkdir "%PGDATA%"

echo.
echo Taking base backup from primary %PRIMARY_IP% (enter the replicator password when prompted)...
"%PGBIN%\pg_basebackup.exe" -h %PRIMARY_IP% -U %REPL_USER% -D "%PGDATA%" -Fp -Xs -P -R -S %SLOT%
if %errorLevel% neq 0 (
  echo.
  echo  BASE BACKUP FAILED. Check PRIMARY_IP, the pg_hba.conf line on the primary,
  echo  and that the replicator password is correct. Data dir left empty.
  pause
  exit /b 1
)

echo.
echo  pg_basebackup -R wrote primary_conninfo + standby.signal. Make streaming
echo  survive restarts by ensuring the replicator PASSWORD is available: either
echo  add  password=...  to primary_conninfo in %PGDATA%\postgresql.auto.conf,
echo  or create a .pgpass for the service account. See HA_RUNBOOK.md.
echo.

echo Starting PostgreSQL as standby...
net start "%PGSVC%"

echo.
echo ---- state ----
"%PGBIN%\psql.exe" -U postgres -h localhost -c "SELECT pg_is_in_recovery();"
echo  (t = this machine is a read-only STANDBY, streaming from the primary)
echo.
echo  Leave the DHOWN + VD MES services STOPPED on this machine until a failover.
echo  To fail over here, run promote-to-primary.bat.
pause
