# DHOWN MES — Operations Runbook

What to do when something is wrong, written for whoever is holding the phone at
the time. Disaster recovery has its own document (`DISASTER_RECOVERY.md`); this
covers the day-to-day.

---

## The system in one paragraph

One Windows host runs everything: two Node/Express instances (DHOWN on **4000**,
VD Knits on **4100**), one PostgreSQL 18 server holding both databases
(`dhown_mes`, `vdknits_mes`), and the ESP32 data collectors posting into
`/api/live-data`. The frontend is a React build served by the backend. There is
no load balancer and no second machine — see *Accepted risks* at the foot.

Start either instance with its launcher:

```bash
D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\START_MES.bat
```

```bash
D:\VDKNITS_MES\START_VDKNITS.bat
```

---

## First checks, in order

Run these before anything else. Most incidents are answered by one of them.

```bash
curl -s -o NUL -w "%{http_code}" http://localhost:4000/api/health
```

| Result | Meaning |
|---|---|
| `200` | The app is up. The problem is narrower than "the system is down". |
| `000` / refused | The process is not running or not listening. Restart it. |
| `500` | The app is up but a dependency (almost always Postgres) is not. |

Then, in order: is Postgres running (`services.msc` → `postgresql-x64-18`), is
the disk full, and does the boot log show a schema step failing.

---

## Symptoms

### Nobody can log in
1. Check the login endpoint answers at all — a wrong password should give
   `401 Invalid credentials`, not `500`:
   ```bash
   curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d "{\"username\":\"admin\",\"password\":\"deliberately-wrong\"}"
   ```
2. `500` here means the database is unreachable — go to *Postgres is down*.
3. `401` means the endpoint is healthy and it is a credentials problem. Rate
   limiting is **10 attempts per 15 minutes per IP**, held in memory, so a
   restart clears a lockout.
4. Rotate the admin password (the operator supplies it; it is never written to a
   file):
   ```bash
   cd D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend
   ```
   Then in PowerShell: `$env:NEW_PASSWORD="..."; node scripts/set-admin-password.js`
   and afterwards `Remove-Item Env:NEW_PASSWORD`.

**Known cause, seen once:** a probe tool sent `DELETE /1` across live routers and
removed the admin user. `seedDefaultAdmin()` then recreated `admin` with a random
password printed once to a console that had scrolled away — so the account
existed and looked healthy but nobody knew its password. If `users` has an
`admin` row with a recent `created_at` and nobody created it, this is what
happened. Recover the old password hash from a backup rather than resetting, if
the old password is still known to someone.

### A machine has stopped reporting
1. The collector posts to `/api/live-data`. Check whether anything has arrived:
   ```sql
   SELECT machine_id, MAX(created_at) FROM machine_live_data GROUP BY 1 ORDER BY 2;
   ```
2. If every machine is stale, the ingest path or the network is the problem, not
   the machine. If one is stale, it is the collector or its cabling.
3. `machine_live_data` is **not** a time series — it is one upserted row per
   machine. Do not expect history there.

### The disk is filling
1. The usual causes are Postgres WAL, the backup directory, and `uploads/wa`.
2. Retention runs nightly. To see what it would remove and run it early, use the
   **Data Retention** screen, or:
   ```bash
   curl -s http://localhost:4000/api/settings/retention -H "Authorization: Bearer <token>"
   ```
3. Backups live in `backend/backups` and are copied to `D:\DHOWN_BACKUPS`.
   Financial records are never in the retention list.

### Postgres is down
1. `services.msc` → `postgresql-x64-18` → Start.
2. Both instances recover on their own once it is back; the pool reconnects.
   There is no need to restart Node.
3. If it will not start, check the Postgres log in its `data\log` directory.
   A full disk is the most common reason.

### Everything is slow, or requests hang
The pool is 25 connections with a 10-second acquire timeout. If requests hang
rather than error, look for a query holding a connection:

```sql
SELECT pid, state, wait_event_type, now()-query_start AS age, left(query,80)
  FROM pg_stat_activity WHERE state <> 'idle' ORDER BY age DESC;
```

`idle in transaction` rows with a long age are the signature of code holding one
connection while waiting for another. That deadlocked the whole application once
(20 concurrent receipts, 305 seconds, all failed) — see addendum 9 in
`PRODUCTION_GAP_ANALYSIS.md`.

### A page shows empty tables with no error
Almost always a wrong API path falling through to the SPA catch-all, which
returns `index.html` with status `200`. `npm run test:paths` checks every prefix
the frontend calls against the routes actually mounted.

---

## Routine tasks

| Task | How |
|---|---|
| Deploy a backend change | Edit in `DHOWN_LIVE_PRODUCTION_DASHBOARD`, **copy the changed files to `D:\VDKNITS_MES`**, restart both |
| Rebuild the frontend | `cd frontend && npx react-scripts build` |
| Run the tests | `cd backend && npm run test:all` (needs Postgres and a running server) |
| Load test | `cd backend && npm run loadtest` |
| Check the API surface | `GET /api/openapi.json` |

**VD Knits is a mirrored copy, not a shared tree.** A backend change is not live
there until the file is copied across and the instance restarted.

---

## Accepted risks

These are known, deliberate, and recorded here so they are decisions rather than
oversights. Revisit if the business outgrows them.

### Single point of failure
One Windows host runs both application instances, PostgreSQL and the collector
ingest. There is no HA, no failover, and no standby. A hardware failure stops
production recording until the host is replaced and a backup restored.

**Why it is accepted:** a single-site mill with ~18 machines, where a few hours
of lost dashboard time is an inconvenience rather than a stoppage — the machines
keep running and knitting is not gated on the MES. The mitigation is backup
quality rather than redundancy: nightly dumps with 7-day retention, hourly dumps
kept 48 hours, an off-machine copy, and a **rehearsed** restore
(`DISASTER_RECOVERY.md`). Measured RPO is about one hour.

**What would change the calculation:** a second site, dispatch becoming
MES-gated, or the WhatsApp CRM becoming the primary customer channel.

### Secrets in plaintext `.env`
Database password, JWT secret, WhatsApp and AI keys sit in two `.env` files. No
secrets manager, no rotation policy.

**Why it is accepted for now:** single host, no cloud control plane to integrate
with, files gitignored and outside the web root. **What it does not survive:**
anyone with file access to the host. Rotating the JWT secret logs everyone out,
which is the intended behaviour if it is ever suspected.

### Manual portal steps
E-way bill numbers are generated on the NIC portal and typed in; GSTR-1 is
prepared here and filed on the GST portal. Both need a GSP account and a
commercial API contract to automate. The system owns knowing *when* a bill was
required and missing, and when one is about to expire — see the
**Compliance Board**.
