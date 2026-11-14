# DHOWN MES — Staging

A **staging instance** is a full copy of the app running against a **copy of the
production database**, so you can test changes before they reach the factory.

- **Prod:** port **4000**, DB `dhown_mes` — the live system (Windows service).
- **Staging:** port **4001**, DB `dhown_mes_staging` — on-demand, safe to break.

Staging runs with `STAGING=true`, which **disables all side-effects**: no scheduled
jobs, no backups (won't touch prod backups), no tracking-API calls (no credits
burned), and **no WhatsApp messages**. It's for exercising the HTTP API + UI only.

## Workflow

1. **Refresh** the staging DB from a fresh prod snapshot (do this before a test session):
   ```
   powershell -File D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\staging-refresh.ps1
   ```
2. **Start** staging (foreground; Ctrl+C to stop):
   ```
   D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\start-staging.bat
   ```
3. **Test** at `http://localhost:4001` — log in, click around, or run the CI suite
   against it (`set DB_NAME=dhown_mes_staging & node backend\scripts\ci-run.js`).
4. **Stop** staging (Ctrl+C).
5. If everything looks good, **deploy to prod** the usual way (copy files + restart
   the service). Staging caught anything that would have broken the live shift.

## Notes
- Staging reuses the same code tree — it's a *runtime* copy, not a code branch.
- The staging DB is disposable; `staging-refresh.ps1` drops and rebuilds it each time.
- Only the `*_staging` DB is ever written by these scripts; production is read-only
  to them (a `pg_dump`).
