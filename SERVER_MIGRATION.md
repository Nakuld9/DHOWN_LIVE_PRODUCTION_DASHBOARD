# Server Migration — split DHOWN and VD Knits onto two servers

*Plan written 2026-08-12. Execute when hardware arrives. I (Claude) drive each step with you.*

## Target architecture — full isolation

```
  Server A (Dell T160)                 Server B (2nd server, TBD)
  ────────────────────                 ─────────────────────────
  DHOWN MES                            VD Knits MES
  D:\DHOWN_LIVE_PRODUCTION_DASHBOARD   D:\VDKNITS_MES
  PostgreSQL 18  → db dhown_mes        PostgreSQL 18  → db vdknits_mes
  Node app       → :4000  (DC :8190)   Node app       → :4100  (DC :8190)
  cloudflared    → tunnel "dhown-mes"  cloudflared    → tunnel "vdknits-mes" (NEW)
                   mes.dhownhosiery.com                 vdknits.dhownhosiery.com
  Backups → D:\DHOWN_BACKUPS           Backups → D:\DHOWN_BACKUPS (or local)
  Static IP: A_IP  (decide)            Static IP: B_IP  (decide)
```

Nothing shared. Each server backs up only its own DB, runs its own tunnel, and its
collectors point only at it. Ports stay 4000 / 4100 (they're on different machines,
so no conflict — kept as-is to match all existing docs/config).

### ⚠️ Decisions still needed from you
- **A_IP** and **B_IP** — the two static LAN IPs (reserve them on the router).
- Confirm the **T160 build**: SSD in **RAID 1**, **redundant PSU**.
- The 2nd server's spec + arrival date.

---

## Per-server prerequisites (do on BOTH A and B)

1. Windows, fully updated. Assign the **static IP** (router DHCP reservation + set on NIC).
2. Install **PostgreSQL 18** to the default path `C:\Program Files\PostgreSQL\18`
   (the backup code uses that absolute `pg_dump.exe` path — keep it).
3. Install **Node LTS** to `C:\Program Files\nodejs`.
4. Install **cloudflared** to `C:\Program Files (x86)\cloudflared`.
5. Create `D:\` layout matching the app's absolute paths (the service scripts and
   tunnel config use `D:\...` — keep the same drive letter, or we adjust every path).

---

## A. DHOWN → Dell T160

### A1. Copy the app + secrets
- Copy the whole `D:\DHOWN_LIVE_PRODUCTION_DASHBOARD` tree to the T160 (git clone or
  file copy). **`backend\.env` is NOT in git** — copy it separately (it holds
  `JWT_SECRET`, DB creds, `DC_API_KEY`, WhatsApp keys). Verify `.env` landed.
- `cd backend && npm ci` and `cd frontend && npm ci && npm run build` on the T160.

### A2. Restore the database
On the **laptop**, take a fresh dump:
```
"C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -U postgres -Fc dhown_mes -f D:\DHOWN_BACKUPS\dhown_migrate.dump
```
Copy the file to the T160, create the DB, restore:
```
psql -U postgres -c "CREATE DATABASE dhown_mes;"
"C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -U postgres -d dhown_mes D:\DHOWN_BACKUPS\dhown_migrate.dump
```
The app also self-heals schema at boot, so a slightly older dump + boot is fine.

### A3. cloudflared on the T160 (keep the existing tunnel)
- Copy `C:\Users\<you>\.cloudflared\` (cert.pem, config.yml, `<tunnelID>.json`) to the
  T160's user profile. The tunnel `dhown-mes` (25debc8e…) already routes
  `mes.dhownhosiery.com`. Trim its `config.yml` ingress to **only** dhown:
  ```yaml
  ingress:
    - hostname: mes.dhownhosiery.com
      service: http://localhost:4000
    - service: http_status:404
  ```
  (Remove the vdknits line — that moves to Server B.)

### A4. Register services on the T160
- Edit `backend\scripts\win-service.js` so it has only the DHOWN target (or run
  `node scripts\win-service.js install dhown`). Then use the elevated installer to
  register **DHOWN MES + Cloudflared** (single-app variant — I'll trim
  `install-services.bat` to this server's one app + tunnel at migration time).
- `cloudflared` service binPath must be `cloudflared.exe tunnel run` (known fix).

### A5. Verify (T160)
- `services.msc`: DHOWN MES + Cloudflared **Running**.
- `http://localhost:4000/api/health` → 200; `https://mes.dhownhosiery.com` → PIN gate.
- Point one **collector** at `A_IP:8190`, confirm it ingests.

---

## B. VD Knits → 2nd server (fully independent tenant)

VD Knits will get its **own domain**, **own tunnel**, and **own WhatsApp** — nothing
shared with dhown. `vdknits.dhownhosiery.com` is interim; retire it once the new
domain is live.

### B0. Its own domain + WhatsApp (buy/create before cutover)
- **Domain**: buy it, add the zone to Cloudflare (or the registrar's DNS if you
  point a tunnel there). Everywhere below that says `vdknits.dhownhosiery.com`, use
  the new hostname (e.g. `app.<newdomain>` for the MES). Update
  `config/tenant.js` / trusted-origins + the QR base URL to the new host.
- **Its own WhatsApp Business**: a separate Meta app + WABA + phone number. Put its
  own values in `D:\VDKNITS_MES\backend\.env` — `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`,
  `WHATSAPP_APP_SECRET`, and the webhook `WHATSAPP_VERIFY_TOKEN`. The webhook
  callback URL registered at Meta = `https://<vdknits-host>/api/whatsapp/webhook`.
  (dhown's WhatsApp keys stay only in dhown's `.env` — never copy them across.)
- **Website**: a marketing/company website is separate hosting from the MES app;
  the MES itself is served by the Node app at the app hostname. Keep them distinct.

Same as A with these differences:
- Tree `D:\VDKNITS_MES`, db `vdknits_mes`, port **4100**. Copy its **own `.env`**
  (distinct `JWT_SECRET` — tokens must not cross).
- Dump/restore `vdknits_mes` the same way.
- **NEW tunnel** (a tunnel can't run on two machines for different apps) routed to the
  new domain:
  ```
  cloudflared tunnel login              (if this server has no cert yet)
  cloudflared tunnel create vdknits-mes
  ```
  Write `config.yml` for the new tunnel:
  ```yaml
  tunnel: <new-tunnel-id>
  credentials-file: C:\Users\<you>\.cloudflared\<new-tunnel-id>.json
  ingress:
    - hostname: vdknits.dhownhosiery.com
      service: http://localhost:4100
    - service: http_status:404
  ```
  Repoint DNS to the new tunnel (overwrites the old CNAME):
  ```
  cloudflared tunnel route dns vdknits-mes vdknits.dhownhosiery.com
  ```
- Register **VD Knits MES + its Cloudflared** as services (single-app installer variant).
- Verify: `:4100/api/health` 200, `https://vdknits.dhownhosiery.com` serves, collectors → `B_IP:8100`.

---

## C. Cutover sequence (minimise downtime)

1. Stand up **both new servers fully** and verify them while the laptop still serves
   live (new tunnels/DNS can be tested via `localhost`/`A_IP` before DNS flips).
2. Freeze data entry for a short window. Take **final dumps** from the laptop and
   restore to A and B (so no rows are lost between the earlier dump and cutover).
3. **Stop the laptop's** services (`uninstall-services.bat` or stop) so only one
   tunnel per hostname is active. DNS for `mes` already points to A's tunnel (same
   tunnel id); `vdknits` now points to B's new tunnel.
4. **Repoint every data collector** to the new IPs (`A_IP:8190` / `B_IP:8190`).
5. Re-run the go-live probe on each server (health, tunnel, backup, a test login).

## D. Rollback
Keep the laptop untouched (services stopped, not uninstalled/deleted) for ~1 week.
If a new server misbehaves, restart the laptop's services and repoint DNS/collectors
back — the laptop's DB is the pre-cutover state; reconcile any rows entered after.

---

## E. New deploy model after the split
The two apps are now on separate machines, so **a code change must be deployed to
each server it applies to** (git pull + `npm ci`/rebuild + restart that server's
service). The old "cp files into the mirror tree" workflow ends — each server is its
own deployment. Keep both on the same git commit to avoid drift.

## F. Post-migration cleanup (once stable)
- Decommission the laptop as a server (keep it as a spare).
- Confirm each server's **backups** run and land (and copy off-box).
- Reboot each server once to confirm services auto-start.
