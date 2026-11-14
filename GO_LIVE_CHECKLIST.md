# DHOWN MES — Go-Live Checklist

*Everything code-side is done. What remains is credentials + data entry, in order.*
*Last updated: 2026-08-12.*

Legend: ⬜ to do · ✅ done · ⏱️ ~time · 🔒 needs UAC (admin)

---

## A. DHOWN — flip to live-operational

### A1 ⬜ WhatsApp secrets  ⏱️2 min
The webhook is fail-closed (returns 503) until the app secret is set, and outbound
alerts are off until the token is refreshed.

1. Open `D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backend\.env` in a text editor.
2. Set / add these two lines (paste your values — do **not** commit this file):
   ```
   WHATSAPP_APP_SECRET=<Meta App Dashboard → Settings → Basic → App Secret>
   WHATSAPP_TOKEN=<fresh permanent token>
   ```
3. 🔒 Double-click `restart-services.bat` (repo root) → approve UAC.
4. **Verify:** the DHOWN service log no longer prints
   `WHATSAPP_APP_SECRET is not set`, and a test message sends without a `401 code 190`.

### A2 ⬜ Opening stock  ⏱️depends on stock count
Enter the physical stock you're holding on day one, so the books start correct.
*(Do this once the TSC label printer is set up, so roll/stock labels print.)*

- **Yarn**: Yarn Store → add each yarn lot with weight + rate.
- **Greige / finished rolls**: enter ready rolls (or Opening Balances screen).
- **Verify:** Live Inventory + Stock Valuation totals match your physical count.

### A3 ⬜ Customer credit limits  ⏱️10 min
No customer has a limit set, so the credit gate currently enforces nothing.

- Open the **Credit Limits** screen (it leads with the "no limit set" count).
- Set a limit per active customer.
- **Verify:** the "customers with no limit" count drops to 0 (or your intended set).

---

## B. VD Knits — activate the 2nd company

### B1 ⬜ Reset the admin password  ⏱️1 min — **blocks all VD Knits login**
Admin was seeded with a random password (none was configured), so nobody can log in yet.

```
cd D:\VDKNITS_MES\backend; $env:NEW_PASSWORD="ChooseAStrongPassword"; node scripts/set-admin-password.js; Remove-Item Env:NEW_PASSWORD
```
- Expect: `Password updated for admin (role SUPER_ADMIN)`.
- **Verify:** log in at `https://vdknits.dhownhosiery.com` as `admin` + that password.

### B2 ⬜ Add users  ⏱️10 min
Either from **User Management** in the UI (after B1), or seed a batch:
1. Edit the `USERS` array in `D:\VDKNITS_MES\backend\scripts\seed-users.js`.
2. `cd D:\VDKNITS_MES\backend; node scripts/seed-users.js`
3. Hand each person the printed temp password; they change it after first login.

### B3 ⬜ PIN-gate the public URL  ⏱️5 min (Cloudflare dashboard)
`vdknits.dhownhosiery.com` is currently public-with-login (no PIN wall like dhown).

- Cloudflare **Zero Trust → Access → Applications → Add an application → Self-hosted**.
- Domain: `vdknits.dhownhosiery.com`. Apply the same policy as `mes.dhownhosiery.com`.
- **Verify:** loading the URL now shows the Cloudflare PIN screen first (302), not the app login.

### B4 ⬜ Confirm pincode
Identity was set with pincode **141010** (inferred from the Focal Point locality).
Correct it in Settings if VD Knits' is different.

### B5 ⬜ Wire collectors (when hardware is ready)
The 7 machines show offline until a data collector POSTs for each `machine_id`.

---

## C. One-time verification after A + B

- ⬜ `services.msc` shows **DHOWN MES**, **VD Knits MES**, **Cloudflared** all *Running*.
- ⬜ `https://mes.dhownhosiery.com` → PIN gate → app (dhown).
- ⬜ `https://vdknits.dhownhosiery.com` → PIN gate (after B3) → app (VD Knits).
- ⬜ First automated backup after go-live succeeds (check `D:\DHOWN_BACKUPS`).
- ⬜ Reboot the server once and confirm all three services come back on their own.

---

## D. VD Knits independence — things to acquire (future)

Turns VD Knits from "runs on the laptop under dhown's domain" into a fully
standalone tenant. Buy in this order — the slow one (WhatsApp verification) first.
Detailed setup steps live in [SERVER_MIGRATION.md](SERVER_MIGRATION.md).

| # | Acquire | Notes / why the order | ⏱️ |
|---|---|---|---|
| D1 ⬜ | **WhatsApp Business** number + Meta app (WABA) | **Start first** — Meta business verification can take days. Separate number from dhown; its own app secret + token. | days |
| D2 ⬜ | **Domain** for VD Knits | Buy it, add the zone to Cloudflare. The MES will run at e.g. `app.<newdomain>`. Cheap, fast. | ~1 hr |
| D3 ⬜ | **2nd server** | Spec it like the T160 (SSD RAID 1, redundant PSU). Decide its **static LAN IP**. | procurement |

Once acquired, the setup (I drive it):
- **Server**: PostgreSQL 18 + Node + cloudflared, restore `vdknits_mes`, register
  services (SERVER_MIGRATION.md §B).
- **Domain + tunnel**: new `vdknits-mes` tunnel → the new host → `:4100`; DNS route;
  update `config/tenant.js` origins + QR base to the new host; retire
  `vdknits.dhownhosiery.com`.
- **WhatsApp**: put VD Knits' own `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID` /
  `WHATSAPP_APP_SECRET` / verify token in `VDKNITS_MES\backend\.env`; register the
  webhook at Meta as `https://<vdknits-host>/api/whatsapp/webhook`. **Never copy
  dhown's WhatsApp keys across.**

Verify: VD Knits opens on its own domain, sends/receives on its own WhatsApp number,
and nothing of dhown's is shared.

---

## Ops toolkit (repo root — all self-elevating)

| Script | Does |
|---|---|
| `install-services.bat` | Register all 3 services (first time / new server) |
| `start-services.bat` | Start all 3 |
| `restart-services.bat` | Restart the 2 backends to reload `.env` |
| `uninstall-services.bat` | Remove all 3 services |
| `setup-vdknits-access.bat` | VD Knits firewall + tunnel route |
| `fix-cloudflared.bat` | Repair the tunnel service run command |

**Not blocking go-live** (features/infra, decide later): WhatsApp reactions, sample-request
tracking, shade-lot certificate, 2FA, encryption-at-rest, full Busy two-way sync
(purchases→MES, yarn-issue→Busy), secrets manager.

**Dropped by decision (2026-08-12):** e-way bill + e-invoice are generated **in Busy**
(its own Webtel/Pinnacle GSP), so no GSP integration or NIC/GST export is built in the
MES. GST invoicing is a Busy responsibility; MES tax invoices are internal/proforma
unless you designate the MES as the invoice system of record.
