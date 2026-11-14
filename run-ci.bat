@echo off
REM Nightly CI wrapper — runs the full test suite and records to ci_runs.
REM Must cd into backend first so .env is loaded (dotenv resolves from cwd).
cd /d "D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend"
"C:\Program Files\nodejs\node.exe" "scripts\ci-run.js" --trigger scheduled
