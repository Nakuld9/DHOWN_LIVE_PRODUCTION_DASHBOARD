# Disaster Recovery Runbook

**Last rehearsed:** 2026-08-06 — restore verified end to end, 286 tests passed
against the restored database.

This is the procedure to follow when the database is lost, corrupted, or a bad
change has to be rolled back. It has been executed, not just written.

---

## Measured figures

| | Value | How it was measured |
|---|---|---|
| Dump time | **~1 second** | `pg_dump -F c` of `dhown_mes` (405 KB) |
| Restore time | **~3 seconds** | `pg_restore` into an empty database |
| Verification | **~40 seconds** | full 286-test suite against the restore |
| **RTO** (time to working system) | **< 15 minutes** | dump/restore is seconds; the rest is human steps |
| **RPO** (data at risk) | **~1 hour** | hourly backups kept 48h, plus nightly kept 7 days |

The RPO was 24 hours when this was first written — a failure at 01:00 lost a full
day of production, dispatch and receipts. Since the dump costs about a second,
the fix was simply to take more of them. Hourly backups now run on the hour and
are kept for 48 hours; the nightly dump is unchanged and kept for 7 days.

Set `BACKUP_HOURLY=false` to return to daily-only. `BACKUP_HOURLY_KEEP_HOURS` and
`BACKUP_DAILY_KEEP_DAYS` tune the windows.

---

## Where the backups are

| Location | Contents | Retention |
|---|---|---|
| `backend/backups/` | `<db>_YYYY-MM-DD.sql` nightly · `<db>_hourly_YYYY-MM-DDTHH.sql` · `media_YYYY-MM-DD/` · on-demand `.dump` | 7 days / 48 hours |
| Google Drive (`BACKUP_SECONDARY_DIR`) | copy of each nightly dump + media | per Drive |
| `D:\DHOWN_BACKUPS\` | manual/pre-change dumps and git bundles | manual |

**WhatsApp media is included.** `uploads/wa` — every customer photo, shade card and
document — is copied into `media_YYYY-MM-DD/` alongside the nightly dump and to the
secondary location. It is copied as a dated folder rather than an archive so a
single file can be recovered without unpacking anything.

⚠️ **One directory, and it moved.** The nightly job previously wrote to
`backend/src/lib/backups` (because `__dirname` there is `src/lib`) while the admin
screen listed `backend/backups`. The two diverged silently — the UI showed backups
three weeks stale while the real ones piled up where nobody looked, and the
retention sweep never matched them. Both now resolve from `tenant.backupDir`.
The stranded files were migrated; `backend/src/lib/backups` can be deleted once
you are satisfied nothing is missing.

Each instance writes to its **own** directory — set by `BACKUP_DIR` in that
instance's `.env`, with filenames prefixed by `TENANT_CODE`. Never restore a
`vdknits_` dump into `dhown_mes` or the reverse.

---

## Procedure

Paths below assume `PG_BIN=C:\Program Files\PostgreSQL\18\bin` and the credentials
in `backend/.env`.

### 1. Stop the application
Prevent writes to a database you are about to replace.

```bash
powershell -Command "Get-Process node | Stop-Process -Force"
```

### 2. Preserve the current state — even if it looks broken

Do this **before** restoring. A corrupted database is still evidence, and it may
hold hours of data the backup does not.

```bash
pg_dump.exe -U postgres -F c -f "D:/DHOWN_BACKUPS/pre-restore-$(date +%Y%m%d-%H%M%S).dump" dhown_mes
```

### 3. Restore into a SCRATCH database first — never straight over production

```bash
psql.exe -U postgres -d postgres -c "DROP DATABASE IF EXISTS dhown_restore_test;" -c "CREATE DATABASE dhown_restore_test;"
pg_restore.exe -U postgres -d dhown_restore_test --no-owner --no-privileges "D:/DHOWN_BACKUPS/<dump-file>"
```

`pg_restore` must exit 0. Warnings about ownership are expected and harmless with
`--no-owner`.

### 4. Verify the restore before trusting it

```bash
cd backend && DB_NAME=dhown_restore_test npm run test:all
```

All 286 must pass. This is the step that distinguishes a restored file from a
working system: it exercises the balance views, the money paths and the schema
together.

Also confirm counts against expectation — tables, views, foreign keys, indexes and
row counts on `partners`, `items`, `tax_invoices`, `payments`, `stock_ledger`.

### 5. Promote the scratch database

Only after step 4 passes.

```bash
psql.exe -U postgres -d postgres -c "ALTER DATABASE dhown_mes RENAME TO dhown_mes_broken_$(date +%Y%m%d);"
psql.exe -U postgres -d postgres -c "ALTER DATABASE dhown_restore_test RENAME TO dhown_mes;"
```

Renaming rather than dropping keeps the damaged copy available. Delete it only
once the restored system has run for a day.

### 6. Restart and confirm

```bash
cd backend && node server.js
```

The boot line must name the right firm and database:
`Backend running on port 4000 — DHOWN HOSIERY MILLS [dhown] db=dhown_mes`

Then check in the UI: today's production, the ageing list, and the most recent
invoice. If the most recent invoice is missing, you have restored an older dump
than you meant to.

---

## Rehearsal log

| Date | Result | Notes |
|---|---|---|
| 2026-08-06 | ✅ Pass | First rehearsal. Restore exit 0, zero warnings. 118 tables, 2 views, 85 FKs, 243 indexes all restored; row counts matched on every key table; sequences ahead of max id (next 87 > max 9), so the first insert would not collide; restored database accepts writes; 286/286 tests passed against it. |

**Re-rehearse after any schema-heavy release, and at minimum every quarter.**
A restore path that worked six months ago is not evidence about today.

---

## What this does NOT cover

Honest limits of the current position:

- **Whole-host failure.** One Windows box runs both instances, Postgres and the DC
  ingest. Losing it means procuring hardware before any of the above applies.
  There is no standby.
- **Point-in-time recovery.** No WAL archiving, so recovery granularity is the
  most recent hourly dump — up to an hour of loss, not arbitrary.
- **The DC collector's own buffer.** Whether an ESP32 replays readings taken while
  the server was down has not been tested.
- **QR images and generated PDFs** are not backed up. Both are regenerable from
  database state, so this is deliberate rather than an oversight. WhatsApp media
  *is* backed up — see above.
