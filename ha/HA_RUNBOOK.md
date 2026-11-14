# DHOWN MES — High Availability Runbook (warm standby)

Tier-1 HA: a **second machine on the LAN** kept as a ready-to-promote mirror of the
primary, via PostgreSQL streaming replication. On a primary failure you promote the
standby and start the services on it — **downtime measured in minutes, data loss in
seconds** (or zero with synchronous replication).

This kit is the **software side**, prepared ahead of hardware. To go live you need a
second Windows machine with the same PostgreSQL 18 + the MES app installed.

## Why HA on top of RAID + backups

- **RAID** (the primary's `D:\PostgreSQL\Data` sits on a RAID array) protects against a
  single **drive** failure — the array keeps serving, no failover needed. It does **not**
  cover a dead PSU/motherboard, OS corruption, ransomware, theft, or fire: those take the
  whole machine down.
- **Off-site git bundle + pg_dump backups** protect your **data** — you can rebuild, but
  it takes hours.
- **HA (this)** covers **machine/site failure** with minutes of downtime instead of hours.
  Use all three together.

## Architecture

```
          PRIMARY (this machine)                 STANDBY (second machine)
  +----------------------------------+    +----------------------------------+
  |  PostgreSQL 18  (read-write)     |====|  PostgreSQL 18  (read-only)      |
  |   D:\PostgreSQL\Data  [RAID]     | WAL|   D:\PostgreSQL\Data             |
  |   dhown_mes + vdknits_mes        |--->|   (streaming, slot 'standby1')   |
  |                                  |    |                                  |
  |  dhownmes.exe  :4000  (running)  |    |  dhownmes.exe  :4000  (STOPPED)  |
  |  vdknitsmes.exe :4100 (running)  |    |  vdknitsmes.exe :4100 (STOPPED)  |
  |  cloudflared tunnel (running)    |    |  cloudflared (installed, off)    |
  +----------------------------------+    +----------------------------------+
```

Both firms share one cluster, so **one** replication stream covers both databases.

## Environment (from the live primary, 2026-10-10)

| | Value |
|---|---|
| PostgreSQL | 18.4 |
| Data dir | `D:\PostgreSQL\Data` (on RAID) |
| PG service | `postgresql-x64-18` (verify exact name on each box) |
| PG bin | `C:\Program Files\PostgreSQL\18\bin` |
| Already set | `wal_level=replica`, `listen_addresses=*`, `max_wal_senders=10` |
| Firm DBs | `dhown_mes`, `vdknits_mes` (one cluster) |
| App services | `dhownmes.exe` (:4000), `vdknitsmes.exe` (:4100) |

## One-time setup

### On the PRIMARY
1. `psql -U postgres -f ha\setup-primary.sql` — creates the `replicator` role + slot
   `standby1`. **Set a strong password in that file first.**
2. Add to `D:\PostgreSQL\Data\pg_hba.conf` (replace `<STANDBY_IP>`):
   ```
   host    replication    replicator    <STANDBY_IP>/32    scram-sha-256
   ```
3. (Optional) `wal_keep_size = '1GB'` in `postgresql.conf`.
4. `psql -U postgres -c "SELECT pg_reload_conf();"`

### On the STANDBY
1. Install **the same PostgreSQL 18** (default service `postgresql-x64-18`, data dir
   `D:\PostgreSQL\Data`).
2. Install the MES app: copy the tree, both `backend\.env` files (point them at
   `localhost`), run the frontend build, install the two Windows services
   (`dhownmes.exe`, `vdknitsmes.exe`) — but **leave them STOPPED**.
3. Edit `PRIMARY_IP` in `ha\rebuild-standby.bat`, then run it. It base-backups from the
   primary and starts PostgreSQL in standby mode.
4. Make streaming survive restarts: add the replicator password to `primary_conninfo` in
   `D:\PostgreSQL\Data\postgresql.auto.conf`, **or** create a `.pgpass` for the service
   account (`%APPDATA%\postgresql\pgpass.conf` for the service user, line
   `<PRIMARY_IP>:5432:replication:replicator:<password>`).

### Verify replication is healthy
- On the primary: `SELECT client_addr, state, sync_state FROM pg_stat_replication;`
  → one `streaming` row for the standby.
- On the standby: `SELECT pg_is_in_recovery();` → `t`, and
  `SELECT now() - pg_last_xact_replay_timestamp();` → a small lag.

## Normal operation
- Primary serves everything. Standby streams, read-only, services stopped.
- Keep the standby patched to the **same app version** as the primary: after each deploy
  on the primary, copy the changed files + rebuilt frontend to the standby (its services
  stay stopped, so this is just file copy — no restart).
- `restart-services.bat` and the local push CI are unchanged and run on the primary.

## Failover (primary is DOWN)
1. Confirm the old primary really is down / unreachable (avoid split-brain).
2. On the standby, run **`ha\promote-to-primary.bat`** — promotes PostgreSQL and starts
   both MES services.
3. Repoint access to the standby:
   - **LAN clients:** use the standby's IP, or move the shared hostname/DNS to it.
   - **Public URL:** start the **cloudflared** tunnel on the standby (it was running on the
     old primary). Same tunnel credentials → same public URL.
4. Tell operators to re-login (JWT secrets differ per box unless you copied them; if the
   standby's `.env` has the same `JWT_SECRET`, existing sessions keep working).

## Failback (old primary repaired)
Do **not** just restart the old primary as primary — it diverged the moment you promoted.
1. On the **old primary**, run `ha\rebuild-standby.bat` with `PRIMARY_IP` = the current
   primary (the machine you promoted). It becomes the new standby.
   - (Faster alternative if WAL lines up: `pg_rewind` — advanced; base backup is the safe
     default.)
2. When you want the original machine back as primary, schedule a quiet window and do a
   clean **switchover**: stop app services on the current primary, confirm the standby has
   caught up (`pg_last_xact_replay_timestamp` current), promote the original, repoint. This
   is a planned version of the failover above.

## Test it (before you rely on it)
On a quiet day: pull the primary's network cable (or stop its services), run the failover,
confirm both firms serve on the standby, then fail back. Record how long it took.

## Limitations (Tier 1, by design)
- **Manual promotion** — no automatic failover (that's Tier 2: repmgr/Patroni + a floating
  IP, which is hard to do reliably on Windows; overkill for one site).
- **Async replication** → up to a few seconds of in-flight transactions can be lost on a
  hard primary crash. Set `synchronous_standby_names` for zero-loss, at a small write-latency
  cost.
- **App-version drift** — the standby is only as current as your last file copy to it; keep
  it in step after each deploy.
