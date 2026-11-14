# Busy Read Bridge (Phase 1) — mirror + reconcile Busy into MES

**Status:** built + validated to the rupee on `COMP0004` (DHOWN's own Busy book, FY 26-27).
**Scope:** a one-way **read/mirror** of Busy's masters + Trial Balance into the MES `acct`
schema, plus a reconciliation that proves a MES-side TB equals Busy's **to the rupee**.
This is the parallel-run foundation for eventually replacing Busy — **MES never writes to
Busy**, and Busy stays the statutory book of record until a CA-signed cutover.

Part of the roadmap in `D:\busy21-re\spec\00-BUSY-MAP.md` (Phase 1 = read bridge).

## Why the pipeline looks the way it does

Busy `.bds` files are **Microsoft Access JET 4.0** databases (fixed Jet password
`<set via BUSY_BDS_PASSWORD env var>`), readable only via **ACE OLEDB, which is Windows-only**. MES runs in
Docker/Linux and cannot open them directly. So:

```
  Windows                                   |  MES (Docker/Linux)
  ──────────────────────────────────────────┼──────────────────────────────────────
  Busy .bds  ──(ACE OLEDB, read-only)──►     |
    extract-busy.ps1  ──►  busy-extract_*.json  ──►  BUSY_INBOX drop folder
                                             |        │
                                             |        ▼  busy-inbox.js poller (every 10 min)
                                             |     busy-mirror.importExtract()
                                             |        │  → acct.busy_imports / busy_masters / busy_trial_balance
                                             |        ▼
                                             |     busy-mirror.reconcile()  → MES TB == Busy TB (to the rupee)
```

This mirrors the existing **Bank H2H drop-folder** pattern (`src/lib/bank-statement-inbox.js`).

## 1. Windows extractor — `tools/busy-bridge/extract-busy.ps1`

Reads a Busy company folder read-only and writes one `busy-extract_<company>_<stamp>.json`
(`busy-mirror/v1`) to a drop folder. It computes, **exactly as Busy does** (see
`D:\busy21-re\format\03-accounting-semantics.md` and `scripts/reports.ps1`):

- **Masters**: every `Master1` group (MasterType 1) + ledger (MasterType 2) with the
  self-referencing `ParentGrp` group tree, plus alias / print name / HSN.
- **Trial Balance**: `SELECT MasterCode1, SUM(Value1) FROM Tran2 WHERE RecType=1 GROUP BY
  MasterCode1` (the one rule). `Value1 < 0` = Debit, `> 0` = Credit. Classified up the group
  tree using Busy's fixed primary group codes.
- **P&L + Balance Sheet**, and whole-book integrity (`SUM(Value1)` over all RecType=1 = 0).
- **Openings**: going-concern opening balances in Busy are posted as RecType=1 entries, so
  they are already inside the movement (the `openings[]` channel is reserved for books that
  store them elsewhere).

```powershell
# sample company
.\tools\busy-bridge\extract-busy.ps1 -CompanyDir 'D:\busy21-re\samples\COMP0004' -OutDir 'D:\DHOWN_BUSY_INBOX'
# live company (explicit FY file)
.\tools\busy-bridge\extract-busy.ps1 -CompanyDir 'C:\BusyWin\COMP0001' -FyDb 'db12026.bds' -OutDir 'D:\DHOWN_BUSY_INBOX'
```

Requires the 64-bit Microsoft Access Database Engine (ships with Busy/Office). Read-only
(`Mode=Read`, SELECT only) — it never writes to Busy.

> **PowerShell gotchas (fixed, do not reintroduce):**
> - never write `R2($x) -eq 0` — PowerShell parses it as the command `R2` swallowing `-eq 0` as
>   arguments. Use `[math]::Round($x,2) -eq 0`. This bug silently zeroed every non-zero account.
> - write the JSON with `[System.IO.File]::WriteAllText(..., UTF8Encoding $false)`, NOT
>   `Out-File -Encoding UTF8` — the latter prepends a UTF-8 BOM that breaks a strict `JSON.parse`
>   on the ingest side (the poller also strips a leading BOM defensively).

## 2. MES mirror + importer — `backend/src/lib/accounting/busy-mirror.js`

- **Tables (in `acct`, created by `ensureAccountingSchema`):** `busy_imports` (one row per
  snapshot: source dir, FY file, SHA-256, control totals, stored reconciliation, `reconciled_ok`),
  `busy_masters`, `busy_trial_balance`. Tagged `source='BUSY'`. **Isolated from the native
  books** — no triggers, no link to `acct.journal_*` / `acct.vouchers`.
- `importExtract(json, …)` — validates `busy-mirror/v1`, snapshots masters + TB, dedupes by
  `(company, db_sha256, extracted_at)`, stores the reconciliation. History is kept; the latest
  import is the current mirror.
- **`reconcileExtract(extract)` is a pure function** (no DB): it rebuilds a MES-side TB by
  **independently re-classifying** every ledger up the imported group tree (MES's own copy of
  Busy's fixed primary-group logic — not trusting the extractor's labels), then checks, in
  integer paise: `Dr == Cr`, `== Busy's stated totals`, net profit `== Busy`, balance sheet
  balances, and that MES's classification matches the extractor's on every ledger. Any mismatch
  is a flagged variance.

## 3. Poller — `backend/src/lib/accounting/busy-inbox.js`

Polls `BUSY_INBOX_DIR` (env) every `BUSY_INBOX_INTERVAL_MIN` minutes (default 10), ingests each
`*.json`, moves it to `processed/` or `error/`. **No-op until `BUSY_INBOX_DIR` is set.**
Wired in `server.js` next to the bank inbox poller.

```
# backend/.env (NOT committed)
BUSY_INBOX_DIR=D:\DHOWN_BUSY_INBOX
BUSY_INBOX_INTERVAL_MIN=10
```

## 3a. Automating the refresh (hands-off daily mirror)

Two halves: the backend **poller** ingests whatever JSON is dropped, and a scheduled
**extractor** produces a fresh drop. Enable both:

1. **Poller** — set in `backend/.env` (already done on this PC) and restart the MES service:
   ```
   BUSY_INBOX_DIR=D:/DHOWN_BUSY_INBOX
   BUSY_INBOX_INTERVAL_MIN=30
   ```
   Restart (elevated): `Restart-Service dhownmes` (the backend loads `.env` at boot).
2. **Extractor** — `tools/busy-bridge/extract-busy.bat` runs the extractor against the live
   DHOWN company (COMP0004) into the drop folder. Schedule it daily (run once, elevated):
   ```
   schtasks /Create /TN "DHOWN Busy Mirror Extract" /TR "D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\tools\busy-bridge\extract-busy.bat" /SC DAILY /ST 01:30 /F
   ```
   (Matches the existing "DHOWN Git Offsite Backup" / "DHOWN CI Nightly" tasks. Remove with
   `schtasks /Delete /TN "DHOWN Busy Mirror Extract" /F`.)

Each run drops a timestamped extract → the poller ingests it as a new `busy_imports` snapshot
(history kept) and reconciles. Proven live: fresh extract → import ingested → MES TB == Busy TB.

## 4. API + UI

Routes under `/api/acct/busy` (`accounting.routes.js`; reads = SUPERVISOR/ACCOUNTS, import = SUPERVISOR+):

| Method | Path | Purpose |
|---|---|---|
| GET  | `/busy/imports` | list snapshots |
| POST | `/busy/import` | ingest a pasted `busy-mirror/v1` extract |
| POST | `/busy/poll` | trigger a drop-folder sweep now |
| GET  | `/busy/reconcile[?import_id=]` | reconcile latest (or one) |
| GET  | `/busy/reconcile/:id` | reconcile a specific import |
| GET  | `/busy/masters[?import_id=&groups_only=true]` | mirrored masters |

UI: **Finance & Accounts → Busy Reconciliation** (`/busy-reconcile`, `BusyReconcile.jsx`) —
PASS/FAIL banner, MES vs Busy TB, net profit, balance sheet, per-primary-group breakdown,
variances, imports history, and a paste-to-import box.

## 5. Validation (COMP0004, repeatable)

`backend/tests/busy-mirror.e2e.js` (in the gate) reconciles the committed extract
`backend/tests/fixtures/busy-comp0004.json`:

- **MES TB = Busy TB = ₹36,85,17,703.04** (Dr = Cr, diff 0.00, variance 0.00 both sides)
- **Net profit = ₹1,23,88,105.18** (variance 0.00)
- **Balance sheet balances** (assets ₹11,37,46,826.18 = liabilities + capital + profit)
- MES's independent classification matches Busy on **all 170 TB accounts**.

Also verified live against the `dhown_mes` database (import landed in the `acct.busy_*` mirror,
reconciled OK; native books untouched).

## Not in scope here (later roadmap phases)

Voucher-level import (Phase 5 `migration.js`, the eventual cutover path), Busy-parity voucher
entry/reports, GST filing-grade, wiring production/inventory into the ledger, and the CA-signed
cutover. This bridge is **read/mirror + reconcile only**.
