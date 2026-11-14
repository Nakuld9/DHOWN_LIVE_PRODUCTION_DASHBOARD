# DHOWN MES — HANDOFF
*Last updated: 2026-11-13 — **ACCOUNTING RESTORED** (removal reversed). `34bcdc7` ci/main PASS. Both firms rebuilt (SW v74) + restarted + healthy; accounting routes verified 200. Gate 252 unit + 38 e2e green.*

> 🔄 **2026-11-13 — ACCOUNTING RESTORED INTO MES (reverted `889b70b`).** Nakul reversed the 2026-11-02 removal. Full stack back: double-entry engine, AI Accountant, TDS, GST returns, CFO, bank, in-MES billing, Busy mirror/migration. `acct` schema recreated on both firms + staging (fresh data; Busy stays book of record). The removal banner below is now HISTORICAL. Removed-state safety bundle: `D:\DHOWN_BACKUPS\pre-accounting-RESTORE_20261112_210413.bundle`.

> ⛔ **2026-11-02 — ACCOUNTING REMOVED FROM MES.** Direction (Nakul): the MES tracks **production**; **all accounting is done in Busy**. Deleted (120 files): accounting engine (`lib/accounting/*`), AI Accountant, TDS, GST returns, CFO (loans/budgets/cashflow/profitability), bank (recon/payouts/statement ingest/Busy read-bridge), in-MES billing (tax-invoices routes + dispatch auto-invoice), Busy mirror/migration. `acct` schema DROPPED on both DBs. **Kept:** costing (FIFO+knitting), production reports, imports + `import-busy` posting-preview, `busy-sync` CSV + `busy-production` (one-way MES→Busy feeds), AskAI (ai.routes = assistant-core only), WhatsApp quotes (`tax-invoices.service` kept as GST-math util, no UI), `invoice-ocr`. Sidebar "FINANCE & ACCOUNTS"→"COSTING & BUSY". Backup: `D:\DHOWN_BACKUPS\pre-accounting-removal_20261102_165111.bundle`. The accounting/CFO/audit notes below are now HISTORICAL. **Open question (undecided): whether MES should export more production/stock data to Busy (MES→Busy feed scope).**

---

*Older — pre-accounting-removal:*
*Last updated: 2026-10-09 EOD (CFO MODULE Slices 1-5 built: Debt & Loans, Budgets+scenarios, 13-wk cash-flow, Mfg Profitability, Executive CFO dashboard. Also: import shortage fix, HA warm-standby kit, VD IMP-006 shipment update. Latest `890653a`. Both firms healthy. 171 unit + 43 e2e green.)*

> **AUDIT ~91/100.** Features 96, Engineering ~93-94, Operations 82. The CFO module below is new SOFTWARE value (not yet re-scored). **Capped by the same external gaps:** collectors + `DC_API_KEY` → live production data (biggest; also what makes Mfg Profitability show real numbers), RFID, keys (ZHIPU/Data Docked/WhatsApp regen), HA (kit now prepped, needs a 2nd machine), and the blocked Busy read bridge.

---

## 🗓️ SESSION 2026-10-30 (cont.) — BUSY UI/FEATURE PARITY + DEPLOY

**Direction (from Nakul):** staff are used to Busy; the goal is to **replicate Busy's UI +
features inside MES** so they feel at home, then do a **one-time data transfer** at cutover —
NOT ongoing Busy fetching. The read bridge (above) stays only for the one-time migration +
the cutover "MES == Busy to the rupee" check; its auto-refresh (scheduled task) is NOT needed.

Built on the existing Busy-style `/accounting` workspace (which already had the keyboard-first
voucher grid + F-keys + document/GST entry + TB/P&L/BS/ledger/daybook/ageing/GST/stock reports):

- **Entry aids:** current balance + party outstanding on account selection; next Vch No preview
  up front (`service.nextVoucherNo`, read-only); amount in words (Indian). `43db6e1`, `29e1906`.
- **Debit/Credit Note** vouchers (reuse return posting; `posting-rules`/`documents`). `6ea3b18`.
- **Ledger** To/By + Opening b/f / Closing c/f; **Day Book** day-wise with per-voucher To/By legs
  (`service.dayBook` returns legs); **group-wise Trial Balance** (ledgers nested). `4341649`,`d963aea`,`d7b5054`.
- **Busy-format voucher print** (company+GSTIN header, Dr/Cr table, words, signatures; scoped CSS). `64c8424`.
- **Inline bill-wise allocation** on a posted receipt/payment (reuses /allocations). `9e4f9f4`.
- **Stock Items** master in the accounting shell (reuses `/api/erp/items`). `8a69b00`.
- **Sales & Purchase GST Registers** (`service.salesPurchaseRegister`). `85b7b6d`.
- **Bill-wise Outstanding** statement, all parties + aged (`allocations.openItemsAll`). `b282df7`.

**DEPLOY STATE (DHOWN only; VD not touched):**
- **Frontend is LIVE** — rebuilt to `main.8aa25f55.js`, SW `v72` (`2cffbc4`). All the UI above is live after a reload.
- **Backend NOT restarted** — the service can't be stopped from a non-elevated shell. These need
  **`Restart-Service dhownmes.exe`** (elevated) to activate: Day Book legs, next-Vch-No, Credit/Debit
  Note posting, Sales/Purchase registers, bill-wise Outstanding, and the Busy read-bridge routes.
  Verify after: `curl -s http://localhost:4000/api/health` (uptime resets). Until then, don't save a
  Credit/Debit Note (old backend rejects the type); the Day Book falls back to its summary line.
- Full pre-commit gate green on every commit (252 unit + e2e). **Next = restart, then staff feedback**
  drives the remaining Busy screens (stock-item ledger, cost-centre reports, niche registers).

---

## 🗓️ SESSION 2026-10-30 — BUSY READ BRIDGE (Phase 1): mirror + reconcile to the rupee

**The blocker is gone.** Busy was unreadable without the partner-dev API — until `D:\busy21-re`
reverse-engineered the `.bds` as **Access JET 4.0** (password `<set via BUSY_BDS_PASSWORD env var>`), readable read-only
via **ACE OLEDB (Windows-only)**. So Phase 1 of replacing Busy is built: a **read/mirror** of
Busy's masters + Trial Balance into the `acct` schema, reconciled to Busy **to the rupee**.
Busy stays the statutory book; MES never writes to Busy. All committed locally (not pushed).

**Architecture (decided with Nakul):** Windows extractor → JSON drop folder → MES poller/importer
(mirrors the Bank H2H pattern), and a **dedicated `acct.busy_*` mirror** (never the native books).

- **Extractor** `tools/busy-bridge/extract-busy.ps1` — reads a Busy company `.bds` read-only,
  writes `busy-extract_*.json` (`busy-mirror/v1`): Master1 groups+ledgers with the group tree,
  TB (`SUM(Value1)` per `MasterCode1`, RecType=1), P&L, BS, integrity. Config for company folder.
- **Mirror + reconcile** `backend/src/lib/accounting/busy-mirror.js` + 3 tables in `schema.js`
  (`busy_imports`/`busy_masters`/`busy_trial_balance`, tagged `source='BUSY'`, isolated).
  `reconcileExtract()` is a **pure fn** that independently re-classifies every ledger up the tree
  and checks (integer paise) Dr=Cr, == Busy totals, net profit, BS balances, classification match.
- **Poller** `backend/src/lib/accounting/busy-inbox.js` — polls `BUSY_INBOX_DIR` (env), ingests,
  archives to processed/error. Wired in `server.js`. No-op until `BUSY_INBOX_DIR` is set.
- **API** `/api/acct/busy/*` (imports/import/poll/reconcile/masters). **UI** Finance & Accounts →
  **Busy Reconciliation** (`/busy-reconcile`).
- **Validated to the rupee on COMP0004** (DHOWN's own book, FY 26-27): **MES TB = Busy TB =
  ₹36,85,17,703.04**, net profit ₹1,23,88,105.18, BS balanced, all 170 accounts classified
  identically. `tests/busy-mirror.e2e.js` (fixture `tests/fixtures/busy-comp0004.json`) is in the
  gate (full `npm run check` green). Also verified live against `dhown_mes` (mirror only).
- **Docs:** `docs/accounting/BUSY_READ_BRIDGE.md`. **Gotcha logged:** never `R2($x) -eq 0` in
  PowerShell (parses as a command swallowing `-eq 0`) — use `[math]::Round($x,2) -eq 0`.

**To run against the LIVE Busy** (at the factory): set `BUSY_INBOX_DIR` in `backend/.env`, run the
extractor on `C:\BusyWin\<COMP*>` into that folder, then the poller ingests + reconciles on its own.
**Next (Phase 2+, when asked):** Busy-parity voucher entry/reports, then production/inventory →
ledger wiring, parallel run, CA-signed cutover. Phase-5 `migration.js` is the voucher-level cutover
path (separate from this read bridge).

---

## 🗓️ SESSION 2026-10-30 — BUSY PARITY (Phase 2): voucher entry — Debit/Credit Note gap filled

**Phase 2 was already ~90% built** by the accounting engine (Phases 1-6): the `acct` voucher
model (`acct.vouchers`/`voucher_lines`/`voucher_items`, 11 voucher types), the posting core
(`createDraft→validate→approve→post→reverse`), and a **Busy-style desktop workspace** at
`/accounting` — keyboard-first `VoucherEntry` Dr/Cr grid (F5 Payment, F6 Receipt, F4 Contra,
F7 Journal) + `DocumentEntry` with GST (F8 Sales, F9 Purchase, + Sales/Purchase Return). So of
the 8 Busy voucher types requested, **6 were live**; the only missing ones were **Debit Note +
Credit Note** (backend types `DN`/`CR` seeded but no posting rule or entry path).

Filled exactly that gap, reusing the return posting (no duplication):
- `posting-rules.js` `documentVoucherLines` — `CREDIT_NOTE` posts sale-side like a return
  (Dr Sales + Output GST / Cr Customer); `DEBIT_NOTE` posts purchase-side (Dr Supplier /
  Cr Purchase + Input GST). Type-aware narration.
- `documents.js` — `DOC_TYPES` += CREDIT_NOTE/DEBIT_NOTE; sale-side system-ledger set fixed
  (credit note → Sales, debit note → Purchase).
- `DocumentEntry.jsx` — handles both notes (credit note = customer-side, debit note =
  supplier-side); header/hint reflect the note type.
- `AccountingWorkspace.jsx` — Credit Note / Debit Note added to the Transactions menu.
- Unit tests `test/accounting-posting.test.js` (+2, balanced + correct Dr/Cr signs). Full gate green.

**Ledger effect vs Busy (reconciled):** CREDIT_NOTE → customer Cr (`Value1>0`), Sales+Output GST
Dr (`Value1<0`); DEBIT_NOTE → supplier Dr, Purchase+Input GST Cr — matches Busy's credit/debit
note posting. Vouchers write MES's OWN native `acct` postings (shadow); Busy stays statutory.
Did NOT create live test vouchers in the native shadow ledger (pure unit test is the proof).
**Next (Phase 3+):** reports parity, GST filing-grade, production/inventory→ledger, parallel run.

---

## ⭐ STANDING RULE — import tracking: inland rail leg = inland-port portal (2026-10-28)

Once an import is **INLAND_TRANSIT** (railed out of the sea port toward the ICD), track its
**rail-out + current rail status on the related inland-port / rail-operator portal** by container
number — not just the ocean carrier's tracker.
- **Gateway Rail Freight (GRFL) — ICD Ludhiana / Sahnewal** (the final destination for DHOWN + VD):
  public, no login, by container no → **https://tracking.gatewayrail.in/trace-your-container.php**
  (submitting opens `container_view_import_rail.php?cntno=<CTR>`). Shows Rail-Out Date/Time,
  From/To, **Current Location**, **Status** (e.g. LOAD STABLED), Arrival-at-Port, ETA. Source =
  Indian Railways FOIS. NOTE: the `gatewayrail.in` root has a TLS cert the built-in browser rejects
  → use Claude-in-Chrome; the `tracking.` subdomain loads fine.
- **CONCOR trains:** `concorindia.co.in/track-n-trace` (International + container no → Search → Expand).
- The ocean carrier (CMA "GATE OUT FROM RAMP" → HUB Sahnewal, OOCL "cargo available ICD" date,
  MSC "Shipped To Ludhiana") confirms the rail leg exists but usually not the live inland position —
  the inland-port portal is authoritative for that.

---

## 🗓️ SESSION 2026-10-22 — Busy-parity reports + GL↔inventory/production (Path C) + WIP absorption

Extended the native accounting engine ([[project_dhown_accounting_engine]]) toward full Busy parity,
all wired into inventory + machine production. Deployed both firms; 230 tests green; latest `ad64f6f`.

- **GL ↔ inventory/production wired (FIFO lot cost):** `mes-events.js` now bridges ALL operational
  tables → accounting outbox (shadow DRAFT): `grn`+`yarn_lots`→GRN, `yarn_issues`→ISSUE_TO_WIP,
  `cost_entries` KNITTING_COST→CONVERSION_APPLIED, `finished_goods`→PRODUCTION_OUTPUT,
  `dispatch_challans`→DISPATCH_COGS (actual roll cost), WASTAGE/JOBWORK. Routes `/api/acct/link/mes/sync/*`.
- **Full WIP cost cycle:** Raw → WIP → Finished Goods → COGS. New ledgers WIP / Finished Goods /
  Conversion Absorbed; DISPATCH_COGS relieves Finished Goods. Boot refreshes `system-seed` policy rules.
- **Valued Stock Status** (`stock-valuation.js`) — yarn FIFO + FG roll cost, reconciled to the 3 GL stock ledgers.
- **Busy GST Summary** (`gst-summary.js`) — two-sided (Output+Input × rate × Local/Inter/Import), **statutory
  ITC set-off (Rule 88A) → cash payable + ITC c/f**, Import block from Import Control Tower customs IGST.
- **GSTR-9** (`gstr9.js`), **Interest Calculation** (`accounting/interest.js`, overdue bills via allocation
  layer), **Depreciation Chart** (`accounting/depreciation.js` + `acct.fixed_assets`, WDV 180-day / SLM).
- **Bill-wise allocation** (`accounting/allocations.js` + `acct.bill_allocations`) — true open-item ageing.
- UI: Display → Stock Status, GST Summary, GSTR-9, Interest, Depreciation, Bill Allocation, MES Auto-Post; Tools → Busy XML Migration.

### ⛔ Remaining Busy features = EXTERNAL-GATED (need a government API, not code)
1. **e-Invoice / IRN generation** — requires the **NIC IRP (Invoice Registration Portal) API** via a GSP/direct
   integration + GSTIN e-invoice enablement + auth credentials. Would attach to the MES tax-invoice / acct
   sales-voucher flow (generate IRN + signed QR on invoice). NOT buildable without those creds.
2. **e-Way Bill from the GL/accounting** — requires the **NIC EWB API** (same GSP/creds). NOTE: the MES already
   has an *operational* e-way flow elsewhere; this item is specifically generating EWB off an accounting voucher.
Both are the ONLY Busy features not replicated. Everything else (accounting, inventory, production costing,
GST Summary+set-off, GSTR-1/2B/3B/9, TB/P&L/BS, interest, depreciation, registers) is BUILT.
Unblock = obtain GSP (GST Suvidha Provider) or direct NIC API credentials + enable e-invoicing on the GSTIN.

### Still the overarching reality (unchanged)
All accounting/GST/stock screens are CORRECT but **empty live** — both DBs have 0 GRN/yarn/rolls/invoices
(production collectors not live = `DC_API_KEY`/ESP32 gap; finance in Busy). They populate when real data flows
(collectors live / GRN+invoices entered in MES / Busy XML export imported = Path B, needs a real export).

---

## 🗓️ SESSION 2026-10-19 — Boot-ensure resilience (VD startup connection-timeout fix)

- **Problem:** On VD (:4100) the boot-time schema `ensure*()` funcs stampeded the shared
  25-conn pool and timed out ("Connection terminated due to connection timeout"), so newly
  deployed tables/columns/seeds silently did NOT get created on `vdknits_mes` (hit while
  deploying accounting Phase 4 — `acct.posting_policies`/`acct.mes_event_outbox`/new ledgers
  were missing until `ensureAccountingSchema` was re-run by hand). DHOWN (:4000) boots fine.
- **Fix (deployed to BOTH the git tree and `D:\VDKNITS_MES\backend`):**
  - **NEW `src/lib/boot-ensure.js`** — `withDbRetry()` (exp backoff on *transient* conn errors
    only, never real SQL bugs) + a failed-ensure registry + `rerunFailed()` post-boot health
    check that re-runs stragglers and logs loudly.
  - **server.js** — moved the two module-load fire-and-forget ensures (`shade-approvals`,
    `ensureAccountingSchema`) out of concurrent route-registration into the SERIAL boot block;
    wrapped that block's ensures in `withDbRetry`; added `rerunFailed()` at the end.
  - **collections.js** — fixed the real silent-failure bug (a timed-out ensure was swallowed
    and its memo cached as "done" forever → never created, never retried); now retries +
    clears memo on failure. **gst-returns.js** — ensure now retries transient timeouts.
- **Verified:** `vdknitsmes` restarted (needs ADMIN elevation — my shell got AccessDenied;
  Nakul ran elevated `Start-Service vdknitsmes.exe`). Boot logged "Accounting schema ready",
  no new timeout errors. Confirmed in `vdknits_mes`: `acct.posting_policies`, `acct.mes_event_outbox`,
  `collection_activity`, `gst_2b_imports` all present; `acct` schema has 17 tables.
- **DHOWN (:4000) NOT restarted** — boots fine; identical shared code on disk, picks it up next restart.
- **Related (out of scope):** same boot pressure also times out scheduled joblocks
  (`pm-scheduler`, `morning-briefing`, import scans) — they self-recover on next interval.

---

## 🗓️ SESSION 2026-10-19 — Accounting engine COMPLETE (Phases 1–6, all code-doable work)

Built the full double-entry accounting engine in its own isolated `acct` Postgres schema
(so the public-schema auto-CHECK scanner never touches signed ledger balances). All through
ONE authoritative service (createDraft→validate→[approve]→post / reverse); DB-level guards
(append-only journals/audit, deferred Σdr=Σcr, period lock, posted-voucher immutability).
Shadow DRAFT everywhere — **Busy stays the statutory book of record until a reviewed cutover.**
Deployed both firms; 223 unit + full e2e green; pushed `ci/main` (latest `f82904f`).

- **Phase 1** posting core · **Phase 2** Sales/Purchase/returns document vouchers + paise-exact GST
- **Phase 3** Trial Balance, P&L, Balance Sheet, Cash/Bank book, receivables/payables ageing (control-reconciled)
- **Phase 4** MES auto-post: versioned approved posting policies + transactional outbox
  (`acct.mes_event_outbox`, UNIQUE event+source_ref + per-voucher idempotency key → a retried/concurrent
  MES event can't double-post). **Wired to REAL MES tables** (`mes-events.js`): `grn`+`yarn_lots`→GRN_RECEIPT,
  `cost_entries` WASTAGE/JOBWORK_*→events.
- **Bill-wise allocation** (`acct.bill_allocations`) — true open-item receivables/payables.
- **Phase 5** Busy XML migration importer (`migration.js` + dependency-free `xml-lite.js`): dry-run +
  reconciliation, dedupe/restartable (`acct.migration_map`), batch rollback. Shadow DRAFT.
- **Phase 6** AI-accountant hooks (`ai-accountant.js`): propose DRAFT / explain read-only ONLY — no
  post/approve/reverse path, so an AI integration cannot write the ledger.
- UI: full Busy-style desktop workspace at `/accounting` (keyboard-first, scoped `.acct`), menus
  Masters/Transactions/Display/Periods/Tools incl. Cash-Bank, Ageing, Bill Allocation, MES Auto-Post,
  Busy XML Migration. Routes under `/api/acct`. See `docs/accounting/IMPLEMENTATION_ROADMAP.md`.

### ⛔ ONLY work left on accounting = BLOCKED ON EXTERNAL INPUT (no more code to write unprompted)
1. **Real Busy XML export** — the migration parser's tag aliases are tolerant but unverified against an
   actual Busy "Data Export/Import (XML)" file. Need one real export to confirm/adjust + build the
   `BUSY_PARITY_MATRIX.md` differential fixtures. (ties to [[project_dhown_busy_bridge]])
2. **CA sign-off + cutover** — a CA must review policies + statutory outputs (GST/P&L/BS), then the
   documented freeze-Busy→final-export→import→reconcile→go-live (with rollback). Human/statutory gate.
3. **DISPATCH_COGS wiring** — the 4th MES event is NOT wired (event + policy exist). Needs Nakul's decision
   on the **cost basis** for relieving dispatched stock: (a) FIFO lot cost, (b) batch weighted-average, or
   (c) the `cost_entries` roll/batch total the MES already computes. Once chosen → small add to `mes-events.js`.

## 🗓️ SESSION 2026-10-13 — Theme "Auto" option, Owner Morning Briefing, challan-numbering bug fix

- **Theme "Auto (system)" option (`9915810`).** Top-bar toggle now cycles Light → Dark → Auto;
  Auto follows OS `prefers-color-scheme` + live-updates; boot script resolves it pre-paint. Both firms.
- **Owner Morning Briefing (`8710ecf`).** Daily dashboard snapshot: `src/lib/morning-briefing.js`
  composes production (yesterday rolls/kg), bank cash (position + 7d flow), in-transit imports with
  ETAs + days-to-arrival, and alerts (import-exceptions + ai-insights) — **honest, empty sections say
  so**. Cached once per IST day in `morning_briefings`; 15-min tick (re)generates at ≥09:00 IST;
  `getToday()` generates on first view. Route `/api/briefing/today` + `/regenerate`
  (SUPERVISOR/ACCOUNTS/AUDITOR). `MorningBriefing.jsx` panel above AI Insights (themed, hidden for
  non-finance roles). Both firms.
- **More features (2026-10-13 cont.):**
  - **Statutory due-date calendar (`93b3325`)** on the Compliance Board — GSTR-1/3B, TDS pay+return, PF/ESI, advance tax; auto date math, urgency-coded.
  - **QR on all labels + dispatch (`9821eb3`)** — roll/batch/finished labels generate a QR (traceability deep link); `/traceability?roll=|lot=` opens from a scan. Dispatch packing list gets a verify QR. `qrcode` dep added.
  - **Role-based landing (`de03de5`)** — login drops each role on their screen (OPERATOR→Operations, QC→Fabric QC, SALES→WhatsApp, ACCOUNTS→CFO, AUDITOR→Reports); fixed blank TopBar name (login now sets `dhown_user`).
  - **Partner Scorecard (`d2d82ba`)** — `/partner-scorecard` (Reports): supplier spend/overdue-PO reliability/imports, customer billed/receivables/returns/credit. Honest (payables in Busy; no PO↔GRN link so reliability = overdue POs).
  - **Reusable DataTable (`a4f5d6d`)** — `components/DataTable.jsx` sticky header + click-sort + CSV; adopted on Scorecard. For incremental adoption (action-heavy pages left as-is).
  - **Shade Approvals (`e6e1350`)** — `/shade-approvals` (Sales): sample sent→approved/rejected, tie to SO; summary tiles, stale>7d. `shade_approvals` table.
  - **ITC-04 job-work return (`4dfc35f`)** — `/itc04` (Finance): Table 4 (sent) + 5A (received back, loss/waste) from subcontract challans/receipts + deemed-supply (>1yr) risk + CSV. Half-yearly (both firms >₹5cr: DHOWN ~50cr, VD ~37cr). HSN default 6006, taxable value = qty×caller goods-rate (challan has only dyeing rate).
  - **SKIPPED deliberately:** density toggle (low value with inline styles), shop-floor multilingual (big, deferred). **Operator tablet mode = still requested, NOT yet built (next).**
- **DECISION — Trial Balance / Ledgers / Registers ("Busy-like views"):** build via **Option B = mirror Busy's real ledgers/TB read-only once the Busy partner-dev API bridge exists** (NOT a parallel MES ledger — would be a 2nd partial, drift-prone book). Nakul OK to wait. Unblock = BUSY PARTNER DEV / API creds. See [[project_dhown_ai_accountant]].
- **WhatsApp Opt-in Growth kit (`ef8869a`).** `/optin-growth` (Sales & CRM): QR + `wa.me/<number>?text=<keyword>`
  deep link so prospects opt THEMSELVES in (compliant — customer sends first msg → existing keyword flow →
  marketing consent). Print branded poster, download QR PNG, copy link, live opt-in count. `src/routes/
  wa-optin.routes.js` (GET /api/wa-optin, POST /number). Number per-firm in `app_settings.wa_optin_number`
  (DHOWN seeded 917055600009; VD blank until it has its own WA number). Added `qrcode` dep to both frontends.
  Solves the "can't bulk-message prospective buyers" problem → drive inbound opt-ins, then use WhatsApp Campaigns.
- **BUG FIX (latent since FY-numbering `b95bae9`):** `nextSeq` does `WHERE <col> LIKE`, but
  `create_subcontract_challan` (jobwork.tools.js) + **3 subcontract routes** passed `challan_id`
  (integer PK) not the varchar `challan_number` → "operator does not exist: integer ~~ unknown". This
  **500'd both the AI tool AND UI subcontract-challan creation**. Fixed all 4 call sites. Same class as
  the DC fix in a0f6b8f — **when adding a `nextSeq(prefix, table, col)` call, `col` MUST be the varchar
  document-number column, never the integer `*_id` PK.**

---

## 🗓️ SESSION 2026-10-12 — UI recolour: white/green/gold + light/dark themes (`f2974d6`)

Replaced the black+yellow identity with a **white/green/gold dual-theme** system
(green = primary/action, gold = accent) + a **light/dark toggle** (☾/☀ in the TopBar,
persisted to `localStorage.dhown_theme`; boot script in `index.html` applies it pre-paint).
- `styles/theme.css`: full token set defined twice — LIGHT on `:root` (default), DARK under
  `[data-theme="dark"]`. Deep-green **sidebar shell** fixed across both themes.
- **Codemod** (scratchpad `recolor*.js`) converted **~4,350 hardcoded dark hexes across 130+
  page/component files** into `var(--token)` refs so inline styles swap with the theme
  (dark bg→surface, light text→text, accents→green/gold/crit tokens). Sidebar recoloured
  manually (excluded from codemod). `App.css` card/report selectors tokenized. SW cache v43→v44.
- Gotcha logged: a shell heredoc/`node -e` collapses `\\b` in a regex to a backspace char —
  codemods that need `\b` must be run from a Write-created file, not a heredoc.
- Deployed + verified both firms (same bundle `main.bda7aa14.js`); pre-commit gate + local CI green.
- **Adding a new themeable colour:** reference a `var(--token)`; if a brand-new hue is needed, add
  the token to BOTH blocks in `theme.css`. Don't hardcode hex in pages.

---

## 🗓️ SESSION 2026-10-09 — CFO MODULE (Slices 1-5), import shortage fix, HA kit, VD IMP-006

**All committed locally (never pushed to GitHub). Both firms healthy; pre-commit gate + local push CI green on every commit.**

**CFO MODULE** — built per a master spec (the big CFO dashboard prompt). ~60% already existed as the AI Accountant; this fills the gaps WITHOUT Busy. **Busy sync (§3) stays parked** — Busy is proprietary `.BDS`, no API until BUSY PARTNER DEV; every module honestly labels Busy-only figures "In Busy" and never fabricates. Each slice: own lib (self-ensuring schema) + routes + page + e2e in the gate, deployed both firms, decimal-safe money.
- **Slice 1 — Debt & Loans (`b1b2583`):** `loans.js` + `/api/loans`. Facility register (term/machinery/WC/CC-OD/other/project) + amortization engine (reducing-balance EMI, moratorium, balloon, freq; integer-paise, exact), debt-service calendar, portfolio summary, scheduled-vs-actual. Page `/debt-management`. `loan_facilities`/`loan_schedules`.
- **Slice 2 — Budgets & scenarios (`93aafef`,`703345d`):** `budgets.js` + `/api/budgets`. Monthly budgets per FY × BASE/UPSIDE/DOWNSIDE, preserved versions, derive-from-base by %-delta, budget-vs-actual with REAL actuals (revenue/collections/debt) + "needs Busy" flags. Page `/budgets`. `budget_versions/lines/assumptions`.
- **Slice 3 — Rolling cash-flow (`785bacb`):** `cashflow.js` + `/api/cashflow`. Weekly (13) forecast: real bank opening cash + exact loan dues + modelled collections/supplier-payments + recurring assumptions; per-cell overrides (keep original+reason), buffer alerts, scenarios. Page `/cash-flow`. `cashflow_forecasts/overrides`.
- **Slice 4 — Mfg Profitability (`cb8e8db`):** `profitability.js` + `/api/profitability`. Contribution/kg by fabric/machine/grade from rolls + cost_entries (per-roll agg, no fan-out) + dispatch realisation; overhead allocation; honest when `rolls` empty (no collectors). Page `/profitability`. `profit_config`.
- **Slice 5 — Executive CFO dashboard (`890653a`):** `cfo-dashboard.js` + `/api/cfo/dashboard`. Consolidates all of the above + finance brain into one KPI snapshot; Busy-only KPIs marked "In Busy". Page `/cfo` (top of Finance group).
- **GOTCHA recorded:** the boot `ensureCheckConstraints` auto-adds `col >= 0` on money-named columns; SIGNED columns broke it (`budget_assumptions.aval` renamed from `avalue`; dropped nonneg on `budget_lines.amount` [neg EBITDA], `cashflow_overrides.amount`). Pattern: drop the auto-constraint in the module's own `ensure()` (runs after ensureCheckConstraints). **Local push CI caught one of these that the pre-commit gate missed** (boot-ordering fluke) — the CI earned its keep.

**OTHER THIS SESSION:**
- **Import shortage fix (`4e89290`):** STOCK_SHORTAGE_RISK no longer fires for goods-in-transit (0 stock, no consumption). Now requires real recent consumption. Both firms.
- **HA warm-standby kit (`dc3a094`):** `ha/` — setup-primary.sql, rebuild-standby.bat, promote-to-primary.bat, HA_RUNBOOK.md. PG18 streaming replication (one stream covers both firms), manual failover. Needs a 2nd LAN machine to go live.
- **Audit report refreshed to 2026-10-10 revision, 91/100 (`3bd882e`).**
- **VD IMP-26-27-006 (RHZ20260813-B2) updated:** invoice actuals (CIF 1.9319, 21,360 kg, $41,265.38), House BL BKSH26029155, status IN_TRANSIT, 25-Sep invoice, $7,348.50 advance; 5 docs attached (image-only HBL/CO/insurance stored, not parsed — vessel/container/ETA still blank). **"32s Fake Cotton Stretch" (YRN-32SFCS) = technically Polyester DTY 166D** (trade name vs spec — SAME material; recorded in the item description). Non-RHZ VD imports (Huamao/Tongkun/Xingji) still 32s FCS — unverified.

---

## 🗓️ SESSION 2026-10-08 — JWT revocation + local push CI (buildable audit items)

**All committed locally (never pushed to GitHub). Both firms healthy; pre-commit gate green on every commit.**

- **JWT revocation list (`238e73c`).** Tokens were stateless → a leaked token (esp. a ≤730-day display token) could only be killed by rotating JWT_SECRET (logs everyone out). Added `src/lib/token-revocation.js`: an **in-memory blocklist backed by `revoked_tokens` + per-user `users.tokens_valid_from` cutoff** (verifyToken stays synchronous — checks the in-process cache, no per-request DB hit; cache reloads at boot so revocations survive restart). Every token now carries a `jti` (jwt `jwtid`). verifyToken rejects a revoked jti or a token issued before its user's cutoff. **Logout now actually ends the session.** Admin: `POST /api/auth/revoke-user/:id` (log out everywhere), `GET /api/auth/revocations`. For a leaked TV token, revoke user 0 (shared tv-display id) + reissue.
- **Session revocation on credential change (`0c7c4a3`).** Wired into `users.service`: **password change, deactivation (active→false), and deletion** call `revokeAllForUser` → all that user's tokens die immediately. A plain profile edit does NOT. Closes the audit's "JWT revocation is secret-rotation-only" gap.
- **Local push CI (`927f2e5`).** Self-hosted, **nothing leaves the box** (honors never-push-to-GitHub). Bare repo `D:\DHOWN_CI\dhown_mes.git` wired as remote **`ci`**; a `post-receive` hook runs the **full gate (171 unit + 39 e2e)** against an isolated checkout on every `git push ci main`, logging PASS/FAIL to `D:\DHOWN_CI\runs\`. Independent post-push checkpoint on top of the blocking pre-commit gate. Promotable to Gitea (web UI) later if wanted. See `LOCAL_CI.md`. **New workflow: after committing, `git push ci main`.**
- **Tests:** `tests/token-revocation.e2e.js` (12 assertions) added to the gate → now 39 e2e suites.
- **Ops note:** `restart-services.bat` `net stop/start` did not reliably cycle the DHOWN service's node child this session (stray node processes piled up); a targeted Stop-Service + free-port-4000 + Start-Service cleared it. If it recurs, the service wrapper's child-kill is worth a look. Process list is clean now (2 node per service).

---

## 🗓️ SESSION 2026-10-05→07 — Bank H2H, AI Accountant to ~95%, DC module, BoE reader

**All committed locally (never pushed). Both firms healthy; pre-commit gate green on every commit.**

- **Bank H2H — Phase A LIVE + Phase B built (draft-only).** Phase A (`8574f90`/`e973d7e`): read-only MT940/CAMT.053/CSV statement ingestion + auto-recon + drop-folder poller (`D:\DHOWN_BANK_INBOX\union-current`). Phase B (`4bdd06a`, `bank-payments-out.js`): **outbound supplier payments, DRAFT-ONLY — MES never sends money.** Beneficiary master (approve-gated, IFSC validated), pain.001 XML + CSV file builders, per-txn/per-batch limits (`BANK_PAY_MAX_PER_TXN` 1 Cr / `_PER_BATCH` 5 Cr), RTGS floor 200000, IMPS cap 500000, maker-checker release/cancel. Bank's own channel approves every debit. `tests/bank-payouts.e2e.js` (16 assertions pass).
- **AI Accountant → ~95%.** Bank feed WIRED IN (`8e353b7`, `bank-cashflow.js`) → real bank balance/7d money-in-out/recon gap from persisted statements. GSTR-3B + GSTR-2B (`9c18c5d`, `gst-returns.js`, uploaded 2B JSON → ITC rollup in `gst_2b_imports`). AR/AP collections (`collections.js` — chase worklist, promise-to-pay, 1-click WhatsApp reminder) + month-end close checklist (`month-end-close.js`, route `GET /api/ai/finance/month-end-close`). **Only remaining gap = Busy read bridge (blocked on partner API).**
- **Delivery Challan module — GST Rule 55 + Job-work (`a0f6b8f`).** Rule 55 fields (consignee GSTIN, ship-to, place of supply, per-line HSN); Job-work DC (free-text lines, no stock coupling, **no tax invoice** — not a sale), expected-return date + `recordJobworkReturn` / `POST /api/dispatch/:id/jobwork-return`. Fixed latent `nextSeq('DC',…)` bug (was keyed on integer PK). `tests/dispatch-dc.e2e.js` (12 assertions) in the gate.
- **BoE (Bill of Entry) reader — crash fixed + hardened (`a0f6b8f`+`cd5b0d0`).** `analyzeBoe` referenced an undefined `r2()` → "Read BoE" crashed on EVERY BoE. Fixed. ICEGATE BoEs are dense tabular forms and the AI was swapping the total-duty figure into `assessable_value` → tightened BOE_SYS prompt + server-side `warnings[]` (cross-checks assessable vs import's invoice_value × BoE rate → suggests `expected_assessable`, never auto-overwrites; flags assessable≈duty, duty-sum mismatch, empty breakdown). Verified live in the VD UI against real BoE `4249936 VD KNIT.pdf`.
- **VD imports data entry (vdknits_mes).** IMP-26-27-005 (Xingji) customs recorded from its BoE: assessable ₹74,76,008.40, BCD ₹3,73,800.40, SWS ₹37,380, IGST ₹3,94,359 (total duty ₹8,05,539.40). **Per user: IGST set NON-recoverable for IMP-005 (`igst_recoverable=false`) → IGST added to landed cost → ₹8,05,539.40 (duties only; CIF-in-INR still ₹0 until the 80% balance TT is recorded).**

**Still pending (ALL external / operator / your-input — no code work):**
- **Imports (VD):** balance (80%) TT payments (ref+rate+date) → costing flips to actual; IMP-005 clearance at ICD Ludhiana; BL/vessel/container for planned shipments 006/007/008/009; Data Docked key not set on VD (needed for VD vessel map).
- **DHOWN external:** P1 collectors + `DC_API_KEY` (live production data — biggest win); P1 `ZHIPU_API_KEY`+`DOC_VISION_PROVIDER=glm` (scanned docs, optional); regenerate WhatsApp token+APP_SECRET (pasted in chat).
- **Blocked:** P3 Busy partner-dev API (caps AI Accountant at ~95%).

---

## 🩺 AUDIT + REMEDIATION (2026-09-28/29) — platform audited at 88/100, 6 of 10 items closed

Full audit done (user-requested). Scorecard artifact: overall **88/100** (Features ~94, Engineering ~90, Ops ~80). **6 of 10 remediation items closed this pass; the 4 remaining are ALL external (keys/devices) — no pending code work.**

**Closed:**
- **Off-site git backup** (`0d32d92`) — `backup-git-offsite.ps1` → daily verified git bundle to `G:\My Drive\DHOWN_BACKUPS\git` (keep 14), scheduled task "DHOWN Git Offsite Backup" @ 20:30, restore = `git clone <bundle>`. Runs as logged-in user (G: not visible to LocalSystem).
- **Security hardening** — **purged `backend/.env` + `.claude/settings.local.json` from ALL git history** (filter-branch, 445 commits, repo local-only so safe; pre-rewrite safety bundle at `D:\DHOWN_BACKUPS\pre-history-rewrite`). **Removed the unused GitHub `origin` remote** (never pushed — confirmed). **Rotated JWT_SECRET + DB_PASSWORD both firms** (verify-before-commit + rollback; sessions invalidated → re-login once). `.gitignore` now blocks `.env.bak*`.
- **Monitoring & error tracking** (`16d9f14`) — `error-tracker.js` (`system_errors`, grouped by signature, occurrences, resolve/reopen) wired into global error handler + process-level unhandledRejection/uncaughtException (process never crashes). `monitor.js` status (uptime, DB latency, error summary, local backup freshness, AI providers, metrics). `/api/monitor/*`. **System Monitor page** `/system-monitor` (ADMIN, 🩺).
- **Local CI runner** (`78048f8`+`33574f8`) — `scripts/ci-run.js` runs 171 unit + ALL 33 e2e (more than the 25-suite pre-commit gate), records to `ci_runs`, exit=pass/fail. `/api/monitor/ci` + Run-now in System Monitor. **Nightly task "DHOWN CI Nightly" @ 02:30** via `run-ci.bat` (needs absolute node path + `cd backend` for .env). Verified scheduled run recorded PASS.
- **Minor debt** — console.log→obs.log structured-logging sweep (`73dafa0`); /maintainence typo, dead supervisors code, TV hardcode were already fixed.
- **WhatsApp / Meta templates** — all 6 APPROVED (checked via Graph API); `greeting_reengage` (MARKETING, 1 var) **wired into the re-engagement fallback** (`WA_REENGAGE_TEMPLATE` in .env) and **proven with a live test-send to 917355699999**.
- **LIVE vessel tracking (`8a76e1b`/`e8c1163`)** — **Data Docked (datadocked.com, FREE tier)** instead of paid MarineTraffic. `TRACKING_PROVIDER=datadocked` + `TRACKING_API_KEY` (Nakul's key) in DHOWN .env. Verified live: COSCO FORTUNE plots on the map. Fixed a latent ON-CONFLICT-vs-partial-index bug in import-tracking-sync. Sync job runs hourly.
- **Financial-year numbering (`b95bae9`)** — all doc series now `PREFIX-26-27-NNN` (Indian FY, Apr–Mar) via `sequences.finYearShort()`; per-FY reset; fixed prior calendar-year bug. IMP-2026-001 → IMP-26-27-001 (only existing doc; rest empty). Both firms.
- **Staging instance (`3c3f224`)** — on-demand prod-copy on **:4001 / dhown_mes_staging**; `STAGING=true` disables ALL jobs/backups/tracking/WhatsApp. `staging-refresh.ps1` (rebuild from prod) + `start-staging.bat`. See `STAGING.md`. HA deliberately NOT built (overkill for single site).

**Still pending (ALL external — Next Task is on the operator, not code):**
1. **P1** collectors + `DC_API_KEY` → live production data (dashboards/AI read 0 until wired) — **biggest remaining win**
2. **P1** `ZHIPU_API_KEY` + `DOC_VISION_PROVIDER=glm` → scanned import docs / TT advices (optional; digital PDFs already work)
3. **P3** Busy partner-dev API (blocked on Busy's side)

**Session-close note (2026-09-29):** working tree clean, all committed, both firms healthy. Secrets rotated (JWT+DB) → **may need to re-login**. New scheduled tasks: "DHOWN Git Offsite Backup" @20:30, "DHOWN CI Nightly" @02:30. Data Docked key is live in DHOWN .env only (not VD). Audit scorecard artifact tracks the 8/10.

---

## 📦 IMPORT DOC AI + MULTI-RATE PAYMENTS (2026-09-18→21, both firms) — extends the Import module

- **AI Import Intake** (`/import-intake`): drop PI/invoice/BL/CO/insurance PDFs → AI classifies + extracts + reconciles → editable draft → approve → creates import + docs + costing. Native-PDF (Claude) → GLM vision (render page→image, DORMANT till `ZHIPU_API_KEY`) → text-layer. Multi-page (`DOC_VISION_MAX_PAGES`, default 3). Also repointed old Invoice OCR to GLM.
- **Multi-rate payments** (`fb01165`+): `import_payments` (own fx rate per TT) + `import_payment_allocations` (one advance splits across 2-3 containers). Import INR cost = SUM(allocated_inr) = real blended rate. **Payments Desk** `/import-payments`; per-import **Payments tab** with "Read a bank TT advice" (parses Union Bank TT format). Costing uses actual paid INR. **Advance voucher** added to Busy readiness. LIVE import IMP-2026-001 (RHZ shipment) created.
- Sidebar group **IMPORTS & LOGISTICS**: AI Import Intake · Control Tower · Vessels & Map · Payments Desk · Import Reports.

## 💬 WHATSAPP AUTO + CAMPAIGNS + OPT-IN (2026-09-21→29)

- **AUTO mode**: functional (replies delivered+read). Org-wide **default AI mode** for new chats (`wa_default_ai_mode`, default AUTO) + inbox toggle (`fd7d825`). "Unsupported" inbound handled + resend nudge (`e75739c`). **Out-of-24h re-engagement template fallback** (`2339bf8`, now armed with `greeting_reengage`).
- **Marketing campaigns** (`47afece`): `wa-campaigns.js` (consent-gated bulk MARKETING template sends, only explicit opt-ins, throttled, idempotent). `/whatsapp-campaigns`.
- **Opt-in capture** (`2de0151`): customer keyword (`OFFERS`/`WA_MARKETING_OPTIN_KEYWORDS`) → marketing consent; "📣 Invite offers" inbox button; manual/offline opt-in already existed. (0 real opt-ins yet — adoption.)

---

## 📦 IMPORT TRACKING & CONTROL TOWER — COMPLETE (2026-09-18, all 10 slices live, both firms)

CIF-default import lifecycle module inside the MES. Extends, never duplicates: reuses
`partners` (suppliers), `items` (materials), `purchase_orders`/`grn`/`yarn_lots`/`stock_ledger`
(GRN + inventory stay authoritative), `warehouses`, `sequences.nextSeq`, `audit_logs`, the
role-hierarchy RBAC and the global auth gate. All under `/api/imports`. Memory:
[[project_dhown_import_tower]]. Dates render DD-MM-YYYY.

**Slices (each tested + committed, DHOWN git + VD Knits mirror built):**
1. `0b60ca9` — schema (self-ensured), CRUD, **CIF-protected landed costing** (freight/insurance
   only added when treated ADDITIONAL + confirm; recoverable IGST excluded as ITC).
2. `a4f0d21` — Control Tower UI + import detail + partial shipments/containers.
3. `93336b1` — GRN + inventory link (non-invasive; received qty read live from `yarn_lots`).
4. `70fc489` — customs + documents (completeness %) + post-port logistics. No govt API claimed.
5. `78002c7` — tracking: replaceable provider abstraction (**never fabricates**; dormant until
   `TRACKING_PROVIDER`+`TRACKING_API_KEY` set) + manual events + ETA history + sync job.
6. `ef870cb` — exception engine (delay/customs/docs/GRN/shortage) → `import_exceptions` +
   ai-insights feed; scan reconciles at boot + every 30 min.
7. `24577ef` — AI material-shortage **analysis only** (never PO/stock/plan writes).
8. `8e365d4` — reports + management view + estimated-vs-actual cost variance
   (`estimated_landed_cost` snapshot). `/import-reports` page.
9. `700f170` — vessel master + **honest position map** (last verified position only, derived live
   from real tracking coords; imports with no coordinate simply absent — no fake coords).
   `/import-vessels` page.
10. `58c8d2f` — **Busy posting readiness (FINAL).** MES **never writes to Busy** (proprietary
    `.BDS`; partner-dev API pending). `import-busy.js`: balanced double-entry voucher PREVIEW
    from finalised landed cost (recoverable IGST a separate ITC debit, not inventory);
    readiness buckets; `recordPosting` stores the human-entered Busy voucher ref only. Panel on
    `/import-reports`.

**Sidebar (PROCUREMENT):** Import Control Tower · Import Reports · Vessels & Map.

**Next task:** none pending on this module. Future, only if asked — wire a real tracking-provider
normaliser (drop-in in `tracking-provider.js`); wire the Busy partner-dev write API when available
(readiness layer already built). Otherwise resume the broader backlog (knit scheduling, job-work
reconciliation depth, per-role dashboards, wiring real collectors).

---

## 🎨 UI REDESIGN — Black+Yellow "Command Center" identity (DONE, deployed both instances)

Premium MES redesign in the real DHOWN brand (near-black + bold yellow, mono-uppercase
headers, stat tiles, status pills, enterprise tables). Non-breaking: presentation only,
all APIs/logic/routes intact. Foundations:
- `src/styles/theme.css` — design tokens (CSS variables) + shell ground; imported after App.css.
- Shell: redesigned `Sidebar` + real `TopBar` (global search + **⌘K command palette**, shift/
  unit/alerts/AI/profile), mounted once above all routes.
- **Deep-redesigned pages:** Command Center dashboard, Machine grid + Machine Detail, Work Orders
  (table **+ Kanban**), Production, Fabric Quality, Inventory (WarehouseOverview), Maintenance,
  Dispatch, Production Planning (**+ Gantt timeline**).
- **AI-native:** proactive **AI Insights** feed on the dashboard (`src/lib/ai-insights.js` +
  `GET /api/ai/insights`, deterministic rules, fail-closed) + contextual **AskAIButton** (Machine
  Detail / Production / Quality) → hands questions to the agent fleet (AskAI auto-asks via
  sessionStorage `dhown_ai_q`).
- All other ~70 pages: token sweep + mono-uppercase headers for consistency.
- **Build caveat:** CRA builds get KILLED when backgrounded on this box (corrupts `frontend/build`,
  briefly 404s the app). ALWAYS build **foreground with a long timeout** (`CI=true npm run build`,
  600000ms), verify `index.html` + `Compiled successfully`, then commit/sync.
- **Deferred (only remaining brief item):** Phase 13 dedicated tablet/operator large-touch mode.

## ⚖️ Job-work reconciliation screen — DONE (deployed both instances)

Greige sent to dye house/finisher vs received back, per challan and per vendor.
- Backend: `/api/subcontract/party-report` extended with `total_rejected_kg` + `receipt_count`.
- Frontend: **Job-work Reconciliation** page (Procurement, after Dye House) — totals bar
  (sent/received/at-vendor/loss/overdue), per-vendor rollup (loss % on closed), per-challan
  detail with filters (vendor/job/status/overdue/search); overdue rows highlighted.
- Balance = at-vendor for open challans (SENT/PARTIALLY_RECEIVED), process loss once closed.
  Verified on seeded data (100/90/3→7 loss; 50/0→50 at vendor, overdue).

## 🎨 Shade card generator — DONE (deployed both instances)

Colour master + branded shade-card export.
- Backend: `shade_swatches` table (self-heal) + `/api/shade-swatches` CRUD (read OPERATOR+,
  write SUPERVISOR+; hex validated `#RRGGBB`). Distinct from `shade_cards` (WhatsApp product catalog).
- Frontend: **Shade Cards** page under Sales & CRM — add shades (name/code/hex picker), pick which
  to include, generate a branded DHOWN card (logo + company header + true-colour swatch grid)
  rendered on a canvas → **Download PNG** / **Print–Save PDF**. Colours are real hex, not AI-invented.
- Approach chosen deliberately over diffusion image-gen (which can't reproduce exact shades).
- Follow-up (optional): send the card over WhatsApp (needs the WA token refreshed); per-fabric
  shade cards; import shades from a spreadsheet.

## 🧾 Auto-invoice on dispatch — DONE (deployed both instances)

Every **priced** (commercial) FG dispatch now auto-raises a **DRAFT** tax invoice
(reusing the tax-invoices GST service), linked by `dispatch_challans.invoice_id`.
- DRAFT on purpose — a human reviews + ISSUES it on the Tax Invoices screen.
- Idempotent (one invoice per dispatch); unpriced dispatches (job-work/samples) skipped.
- INTRA vs INTER (CGST+SGST vs IGST) from the customer GSTIN prefix vs our state
  (`app_settings.state` = Punjab/03). `src/lib/dispatch-invoice.js`, hooked in
  `dispatch.service.create`, wired in server.js. Never fails the dispatch on an invoicing error.
- e2e `tests/dispatch-invoice.e2e.js` (11 checks) in the pre-commit gate.
- To switch from DRAFT to auto-ISSUED, transition the invoice after create (deliberately not done).

## 🧠 Invoice OCR — DONE (deployed both instances)

Upload a supplier invoice/order **PDF** → AI extracts supplier, GSTIN, invoice no/date
(DD-MM-YYYY), line items (HSN/qty/rate/amount), subtotal/tax/total → review/edit →
**Draft GRN** (header via existing `POST /api/grn`; lots added on the GRN screen).
- Backend: `pdf-parse` text-layer extraction + model-gateway structuring. `src/lib/invoice-ocr.js`,
  `POST /api/ocr/invoice` (base64 PDF in body, no multer; aiLimiter-gated). Scanned/unreadable/
  non-PDF fail cleanly. 6 jest tests (`test/invoice-ocr.test.js`).
- Frontend: **Invoice OCR** page under Procurement (nav + route wired).
- **NOTE:** `pdf-parse` is a new dep — installed in BOTH `backend/node_modules` and
  `VDKNITS_MES/backend/node_modules` (node_modules is gitignored; `npm install` needed per tree).
- Follow-up: image OCR for scanned (image-only) PDFs (Tesseract or a vision model).

## 🗓 App-wide DD-MM-YYYY date format — DONE (commit `6202938`)

All on-screen dates now render **DD-MM-YYYY** and date-times **DD-MM-YYYY HH:mm**.
Codemod (`toLocaleDateString`→`en-GB`+dash; `new Date(...).toLocaleString`→datetime dash)
across 55 frontend files, receiver-preserving so date **inputs** (toISOString/slice) and
money `toLocaleString` are untouched. Built (`main.af916b71.js`), synced to VD Knits.
**Printed docs now DONE too:** frontend printed GST invoice / e-way / challan already went
through the codemod; backend-generated docs converted separately — credit-note PDF, statement
PDF, WhatsApp quote PDF, customer-notify WhatsApp messages, quality-report CSV, reports
'Generated' timestamp. Money `toLocaleString('en-IN')` left untouched. Zero non-`en-GB` date
renderings remain in frontend or backend.

## 📌 AI-MES BUILD STARTED 2026-08-14 — Phase 1 (Fabric quality)

Building the AI-native fabric MES per `docs/AI_MES_BLUEPRINT.md` (extend, don't
greenfield; active scope Phases 0-4; MVP = P0-P2). See memory `project_ai_mes_build`.

**Phase 1 — Fabric 4-point quality & grading — FIRST SLICE DONE (commit `60accd7`):**
- `src/lib/fabric-grade.js` — pure 4-point maths (configurable A/B thresholds,
  default 40/80 pts per 100 sq yd, seeded in app_settings). 10 unit tests.
- `fabric_inspection` (header) + `fabric_inspection_defect` (lines) tables; grade
  computed & stored, raw inputs kept for re-grade/audit.
- `/api/fabric-inspection` — preview / create / list / get / void / report. Create
  computes the grade and **quarantines the roll on REJECT** (reuses roll quarantine).
- UI: **Fabric 4-Point QC** page (nav under Procurement & Processing) — roll,
  dimensions, defect lines, live grade, history. Live on :4000.
- Tests: `fabric-grade.test.js` (unit) + `fabric-inspection.e2e.js`. Full gate green
  (156 unit / 13 suites + 22 e2e). Synced to VD Knits.

**Quality dashboard — DONE (commit `24fbc91`):** `/fabric-quality` page + `/report`
now returns grade distribution, defect Pareto, AND per-machine breakdown (grade split
+ reject % + points per machine, so a recurring machine fault is visible). KPI tiles,
CSS bars, stage/date filters. Live on :4000.

**Grade → allocation — DONE (commit `2ddcb29`):** an inspection writes its grade onto
`rolls.quality_grade` (A/B, and REJECT→'R' since the column is VARCHAR(1); inspection
keeps full 'REJECT'). lot-allocation already offers only grade-A, unquarantined stock,
so a REJECT roll is excluded twice (grade 'R' + quarantine). **No pricing differentiation**
(per Nakul — B is not priced differently, just not sold as A by default).

**Defect-type management — DONE (commit `3234f47`):** `/defect-types` page +
`/api/defect-types` (list/create/update/activate). Mill maintains its own fabric defect
list; deactivate hides from new inspections, history keeps the name (defect stored as
text). Active-only list stays at `/api/quality-defect-types` for the inspection screen.

**Inspection worklist — DONE (commit `670518e`). PHASE 1 COMPLETE.** `/api/fabric-inspection/pending?stage=`
+ "Awaiting inspection" worklist on the Fabric QC page (greige = knit rolls uninspected;
finished = finished_goods uninspected; click to prefill). Optional shade approval on finished
is deferred (not needed now).

**Working through user request "complete 2,3,4 one by one":**
- 2 = Phase 1 last item (inspection worklist) ✅ DONE.
- 3 = Phase 3 Planning & MRP-lite ✅ DONE (commit `dbe718b`). `src/lib/mrp.js` yarnRequirement:
  open orders → BOM (bom_lines fabric→yarn by %) → gross yarn need × (1+standard_loss_pct),
  netted vs yarn_lots on-hand + open POs on-order → shortfall. `/api/planning/yarn-requirement`
  + Planning page (nav "Yarn Requirement (MRP)"). e2e mrp.e2e.js. (Knit scheduling + job-work
  reconciliation depth deferred — the yarn-requirement MRP is the high-value core.)
- 4 = Phase 4 dashboards ✅ DONE (commit `467fa86`). Cross-domain **Operations Dashboard**
  (`/operations`): production/machines/quality/inventory/orders/purchase/MRP-shortfall tiles
  (attention items red) + live machine board, 60s auto-refresh. `GET /api/dashboard/operations`
  (`src/lib/dashboard-kpi.js`, reuses mrp + fabric-inspection). Machine-focused dashboards
  (Dashboard, MasterDashboard, /api/dashboard/kpis|oee|live) already existed — this adds the
  cross-domain view they lacked.

**✅ Items 2, 3, 4 all DONE.** Phase 1 complete; Phase 3 (MRP-lite) done; Phase 4 (ops
dashboard) done. Deferred (backlog, lower value until data flows): knit scheduling, job-work
reconciliation screen, per-role dashboards beyond the ops view.

**Manual production entry — DONE (commit `adfdcbf`).** `/shift-entry` page + `POST /api/production-entry`
(`src/lib/production-entry.js`): record a shift's rolls by hand → each becomes a CLOSED greige
roll (source=MANUAL, IN_STOCK) with live-format ids ('M' seq marker). Flows into production
summary, Operations Dashboard, greige stock, inspection worklist. So **data can flow without a
collector** — the AI/dashboards show real numbers as soon as shifts are entered (or collectors
are wired). e2e production-entry.e2e.js.

**Where things stand:** Phase 1 ✅ · Phase 2 (**10 agents** + approvals queue + **7 write tools**) ✅ ·
Phase 3 (MRP-lite) ✅ · Phase 4 (ops dashboard) ✅ · manual production entry ✅. Phases 5-6
suspended (no hardware). Open backlog: knit scheduling; job-work reconciliation screen;
wire real collectors when ready.

**More agent write tools — DONE (commit `53ba9ae`, deployed + synced to VD Knits).** Three more
governed write tools behind the approvals queue (propose → SUPERVISOR-approve → execute),
each reusing existing mechanisms:
- **open_capa** (Quality) — new small `capa` table (`ensureCapaSchema`); corrective/preventive ticket.
- **create_subcontract_challan** (Job-work) — outward greige challan via `nextSeq` + `stock_ledger`
  OUT to In-Transit, same footprint as a human quick-challan.
- **stock_transfer** (Inventory) — two `stock_ledger` lines (OUT source, IN dest); warehouses
  resolved by code/name.
Wired into quality/jobwork/inventory agents (tools + keywords + answer rules). Fixed a greedy-`.*`
routing regression and tightened inventory/purchase keyword ties.

**Sales agent + create_followup — DONE (commit `1528e64`, deployed + synced).** 10th agent
in the fleet. Read tool `get_open_followups` (pending customer follow-ups, overdue first) +
write tool **create_followup** (drafts into the existing `crm_followups` table, `kind='MANUAL'`,
optional customer resolved against `partners`; SUPERVISOR approves). Management also gets
`get_open_followups`. Routing verified (follow-up/remind/lead → sales). `tests/ai-write-tools.e2e.js`
now **32/32**.

**Manual finished-goods entry — DONE (commit `f46c16a`).** `/finished-entry` + `POST /api/finished-entry`
(`src/lib/finished-entry.js`): record dyed/finished fabric returned from job-work → each roll a
finished_goods row (own roll_id, source=MANUAL, IN_STOCK) → counts as finished stock AND appears
in the FINISHED inspection worklist. MERGED into the existing Finished Goods page (commit `4d19e1d`) as an inline
"+ Add finished goods" form (standalone page/route/nav removed; `/api/finished-entry` stays as
the create API). Now BOTH manual data paths exist: greige via Shift Production Entry, finished
via the Finished Goods page's add form — the full loop runs without a collector.

Phase 1 done so far: 4-point grading engine · inspection screen · quality dashboard ·
grade→allocation · defect-type management. Commits 60accd7, 24fbc91, 2ddcb29, 3234f47.

## 📌 PHASE 2 KICKED OFF 2026-08-14 — AI agent fleet

**Shared runtime + Production agent — DONE (commit `60eb1fe`).** The reusable AI
infrastructure is built once; agents plug in.
- `src/ai/`: `model.js` (provider-abstracted gateway, Groq today), `tool-registry.js`
  (typed/permissioned/allow-listed tool boundary — scope enforced here, NOT in prompts),
  `runtime.js` (two-pass plan→run tools→answer, grounded, confidence-scored, logs every
  turn to `ai_agent_actions`), `tools/production.tools.js` (get_production_summary,
  get_machine_status), `fleet.js` (wires it, defines Production agent + keyword router).
- `/api/ai/ask` + `/api/ai/actions` (rate-limited, permissioned). UI: **Ask AI** chat
  page (sidebar top) — shows answer + tools used + confidence.
- Verified live with real Groq: "how much production today" → "0 kg; all 18 machines
  offline" — grounded, no invented figure. Tests: ai-runtime.test.js (6) + ai-agent.e2e.js.

**Inventory agent — DONE (commit `8fc2239`).** get_stock_summary + get_low_stock.
**Quality agent — DONE (commit `de86562`).** get_quality_summary + get_defect_pareto.
Router scores keyword hits so shared words don't misroute.
**Job-work agent — DONE (commit `9f1a43a`).** get_jobwork_outstanding/overdue/process_loss.
**Maintenance agent — DONE (commit `a7b1e61`).** get_open_maintenance (open WOs + machines
down), get_pm_due, get_low_spares. Same commit fixed a router bug: keyword regexes had a
trailing `\b` that blocked plural/prefix matches (breakdowns/maintenance/spares), misrouting
to Production on ties — dropped it, removed over-broad "down" from Production. 7/7 routing
cases pass.

**Also live:** floating 🤖 Ask-AI button on every page + full Ask AI page.

**Adding the next agent = register its read tools + add a def to `AGENTS` in fleet.js.**
**Costing agent — DONE (commit `e48edcf`).** get_fabric_cost (cost/kg, selling, margin) +
get_cost_breakdown (by component), on cost_snapshots + cost_entries. Tools SUPERVISOR-gated;
e2e proves an OPERATOR is refused them THROUGH the agent (registry permissioning works).

**Purchase agent — DONE (commit `780a94d`).** get_open_purchase_orders (by supplier,
overdue count) + get_overdue_purchase_orders, on purchase_orders.

**Dispatch agent — DONE (commit `dfc0961`).** get_open_sales_orders/overdue_deliveries/recent_dispatches.
**Management agent — DONE (commit `70a0903`). READ-ONLY FLEET COMPLETE (9 agents + WhatsApp CS).**
Management composes across the fleet's read tools (no new tools); runtime gained
`agent.maxCalls` (Management=6) so a brief pulls several domains per turn. Registry still
gates cost tools by the caller's role, so an operator's brief omits cost.

**✅ Build order DONE:** Production · Inventory · Quality · Job-work · Maintenance · Costing ·
Purchase · Dispatch · Management. All live on `/api/ai/ask` + Ask AI page + floating 🤖 button.

**APPROVALS QUEUE — DONE (commit `7ecbbdf`). Agents can now propose WRITE actions.**
- `ai_approvals` table; write tools (`safe:false`) carry `propose()` + `execute()` + `approveRole`.
- `src/ai/approvals.js`: propose (validate + queue PENDING, NO mutation) → approve (permission-
  checked vs the tool's approveRole, runs execute(), records result) → reject. Runtime PROPOSES
  on a write-tool call, never executes; the answer says "drafted, awaits approval".
- API: `/api/ai/approvals` (list) + `/:id/approve` + `/:id/reject` (SUPERVISOR/ACCOUNTS).
  UI: **AI Approvals** page + nav. Tests: 9 write-tool unit + tests/ai-approvals.e2e.js (12).
- **First write tool: `raise_maintenance_wo`** (Maintenance agent) — proves the whole path.
- NEVER-class actions (ledger/price/invoice/money/permissions) get NO write tool → can't reach
  the queue. Safety by construction.

**Write tools so far (behind the queue):** raise_maintenance_wo (Maintenance), open_capa
(Quality — corrective/preventive ticket), create_subcontract_challan (Job-work — outward greige
challan + ledger OUT), stock_transfer (Inventory — OUT+IN ledger lines), create_followup
(Sales — customer follow-up into crm_followups), hold_roll
(Quality — quarantine a roll), create_purchase_order (Purchase — draft PO via the real PO
service). Commits: 7ecbbdf, 44fe607. Pattern: register a `safe:false` tool with propose()/
execute()+approveRole, add to the agent's tools list; reuse an existing service where possible.
**More to add if wanted:** create_subcontract_challan (Job-work), open_capa (Quality),
create_followup / draft+send message (Sales), stock transfer (Inventory). Keep amounts/
commitments at approveRole SUPERVISOR+; never build a tool for a NEVER-class action
(ledger/price/invoice/money/permissions).

**Also remember:** the honest daily numbers stay 0 until production DATA flows (collectors wired
or manual shift entry) — the AI is ready, it just needs data.

**NOTE:** the honest daily number needs production DATA flowing — collectors are offline,
so today reads 0. Wiring collectors (or manual shift entry) is what makes the Production
agent answer real figures.

---

## 📌 SESSION 2026-08-12 — Low backlog: roles + UI fetch handling

| Work | Commit |
|---|---|
| QC role + read-only AUDITOR role | `c2b9ccb` |
| Vendor Stock / Yarn Store: surface fetch failures instead of a blank "no data" | `c1bd4b9` |
| Sidebar group headers indented right; service-worker cache v1→v2 (bust stale bundle) | `761103f` |
| Both backends as auto-start Windows services (node-windows) | `210cfa6` |
| Cloudflare tunnel folded into the same installer | `2f1aeda` |
| cloudflared run-command fix + start/repair helpers | `ef28b49` |
| VD Knits opened on LAN + tunnel (vdknits.dhownhosiery.com) | `e7b49d0` |
| restart-services.bat (reload backend .env) | `327a662` |
| MES invoice relabelled PROFORMA (record only) | `90c42b4` |
| "Tax Invoices" → "Invoices (record)" throughout | `4c36bfc` |

### 🧾 Invoicing / e-way / e-invoice — DECIDED (2026-08-12)
**Busy is the single official source** for the GST invoice, e-invoice (IRN) and e-way
bill — generated in Busy via its own **Webtel Electrosoft + Pinnacle** GSP (both
companies hold both). Therefore the **MES builds NO GSP integration, NO NIC/GST
export, and NO MES→Busy invoice push** — that whole Medium item is dropped.
- The MES still lets you raise invoices, but they are **internal records only**. The
  printable now reads **PROFORMA INVOICE / "not a GST tax invoice"** with a footer
  that the official docs come from Busy; the screen + nav read **Invoices (record)**.
  Prevents two documents looking like the statutory invoice for one sale.
- MES→Busy still feeds **production/stock** (production→Busy export is live). See
  [[project-dhown-busy]] memory for the full boundary.

### ✅ VD Knits brought up as the 2nd company (2026-08-12)
Runs the same code against `vdknits_mes` on :4100. Done this session:
- **Frontend rebuilt** — was stale (Aug 7, 6 leftover bundles); now the same clean
  bundle as dhown (`main.39479d9a.js`). Served on :4100.
- **Company identity** written to `vdknits_mes.app_settings`: VD KNITS, D-150 Phase
  VI Focal Point Ludhiana, GSTIN 03AROPD5351L1ZQ, PAN AROPD5351L (derived), Punjab,
  pincode 141010 (**inferred — confirm**), SBI A/C 44564675511 / SBIN0006265,
  +919876700180. Resolver: `src/lib/company.js` (60s cache).
- **Access**: LAN `http://192.168.1.252:4100` (firewall rule added) and public
  `https://vdknits.dhownhosiery.com` (cloudflared ingress → :4100, DNS CNAME).
  ⚠️ **NOT PIN-gated** — no Zero Trust Access app on the subdomain (dhown=302,
  vdknits=200). Setup: `setup-vdknits-access.bat`.
- **7 machines** registered offline: IL1-IL4, IL6, IL7 (IL), RB5 (RIB). They compute
  OFFLINE via `computeLiveStatus` because `machine_live_data` is empty — go live
  only when a collector reports.
- **Scripts** added to `VDKNITS_MES/backend/scripts/`: `set-admin-password.js`,
  `seed-users.js`, `seed-machines.js` (all env/list-driven, no secrets in files).

**VD Knits pending (operator):** admin password **reset ✅ (2026-08-12) — admin login
works**. Remaining: add users (seed-users.js or the UI), PIN-gate the subdomain,
confirm the pincode, wire collectors.

### 📋 Server split + VD Knits independence — PLANNED (not executed; awaits hardware)
Decision (2026-08-12): put **DHOWN on the Dell T160** and **VD Knits on a separate
2nd server**, full isolation (each its own Postgres, cloudflared tunnel, backups,
services), **ports kept 4000/4100**. VD Knits will become a **fully independent
tenant** — its own **domain**, own **tunnel**, own **WhatsApp Business** number/app.
`vdknits.dhownhosiery.com` is interim, retired once its own domain is live. dhown's
WhatsApp keys never cross over.

- **Runbook:** [`SERVER_MIGRATION.md`](SERVER_MIGRATION.md) — per-server prereqs,
  DHOWN→T160 and VD Knits→2nd-server steps, DB dump/restore, the key gotcha (VD Knits
  needs a NEW tunnel + DNS repoint), cutover sequence, rollback, and the new
  per-server deploy model (no more mirror `cp` — each server is its own deployment,
  keep both on the same git commit).
- **Acquisition checklist:** [`GO_LIVE_CHECKLIST.md`](GO_LIVE_CHECKLIST.md) §D —
  buy in lead-time order: **WhatsApp Business (start first, Meta verification is
  slow)**, then **domain**, then **2nd server** (RAID 1 + redundant PSU, static IP).
- **Still to decide:** the two static LAN IPs, confirm the T160 build, 2nd-server
  spec/date, the VD Knits domain + WhatsApp number.
- **Nothing to execute** until hardware/domain/number arrive — I drive each piece then.

### ✅ Auto-start services — DONE and LIVE (2026-08-12)
All three services are registered and **Running**: DHOWN MES (:4000, health 200),
VD Knits MES (:4100), Cloudflared (mes.dhownhosiery.com → 302 Access gate). They
auto-start on boot. `start-services.bat` starts them, `uninstall-services.bat`
removes them. Two gotchas hit and fixed during first install (both now baked into
`install-services.bat`): node-windows does not reliably auto-start on first
install (hence `start-services.bat`), and cloudflared's `service install` on this
build registers a no-arg binPath that exits 1067 — the service binPath must be set
to `cloudflared.exe tunnel run` (config in the LocalSystem profile). The
`pg_dump`-under-LocalSystem worry is a non-issue: `backend/src/lib/backup.js` uses
the absolute path `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe` (override with
`PG_BIN`), not a PATH lookup, so backups work regardless of the service account.

<details><summary>Original install instructions (for the server migration)</summary>

**Double-click `install-services.bat` (repo root) and approve UAC.** It registers
three auto-start Windows services in one go:
- **DHOWN MES** (:4000) and **VD Knits MES** (:4100) via node-windows — each runs
  `server.js` from its own backend dir, loading its own `.env` (distinct ports,
  DBs, JWT secrets). Respawn on crash, capped at 40 restarts.
- **Cloudflared** — the tunnel for `mes.dhownhosiery.com`, via cloudflared's native
  `service install`. Runs as LocalSystem, so its config is copied into the system
  profile's `.cloudflared` where that account looks for it.

`uninstall-services.bat` removes all three. Scripts: `backend/scripts/win-service.js`.

**Verify after registering:**
1. `services.msc` shows all three **Running**.
2. Load `https://mes.dhownhosiery.com` once — confirms the tunnel reconnected under
   the service account (system-profile config found).
3. First backup cycle still finds `pg_dump` — LocalSystem's PATH may not include the
   PostgreSQL `bin` folder. If it fails, use a full path to `pg_dump` or add Postgres
   to the system PATH.

</details>

### QC and AUDITOR are opposite shapes — see Addendum 19 in `PRODUCTION_GAP_ANALYSIS.md`
- **QC** ranks with OPERATOR and opts into three SUPERVISOR-gated quality
  decisions via `requireRole(..., { also: ['QC'] })`: quarantine release/hold
  and create/update inspection. **No GRN or roll approval** — that stays
  SUPERVISOR.
- **AUDITOR** is read-everything / write-nothing. It keeps VIEWER's rank but gets
  a blanket read-pass for safe methods (so it reaches ACCOUNTS/ADMIN-gated
  reports a VIEWER cannot), while `auditorWriteBlock` in the global gate refuses
  every unsafe method for the role. **This is the role for a CA/external
  auditor** — VIEWER does not expose finance.
- Both in the user validator + User Management UI. `tests/roles.e2e.js` (16).

### Decision not to reverse without understanding it
- **AUDITOR's write ban is central, not per-route.** It lives once in
  `apiAuthGate` so a future router cannot forget it — the same reasoning as the
  auth gate itself. Do not scatter write checks back into routes.

### Not done, on purpose
The last Low item ("18 pages lack a loading spinner") was left alone: only 2 of
those pages had genuinely unhandled *errors* (now fixed); the rest just lack a
spinner and load instantly on the LAN. Mass-editing 18 working pages for cosmetic
spinners days before go-live is churn with regression risk, not a fix.

### Mirror
All changed files synced to the VD Knits tree (`D:\VDKNITS_MES`), which is
currently stopped and will pick them up on next start.

---

## 📌 SESSION 2026-08-07 (later) — Medium backlog, 40 → 7

Every Critical and High item remains closed. The Medium backlog went from 40
open rows to **7**, and the 7 left are listed at the bottom with why.

| Work | Commit |
|---|---|
| Quality gate, timestamps, retention screen, /batching nav | `28766da` |
| AI confidence scoring | `8045f88` |
| Approval-matrix editor, stock valuation as at a date | `e62b1b5` |
| AI performance, bulk credit terms, operations runbook | `4cfa740` |
| UoM conversion into sales orders and invoices | `5622fa5` |

### ⚠️ A real bug was found: greige dispatch was broken
`rolls` had `created_at` but **no `updated_at`**, and two dispatch paths write
`UPDATE rolls SET ... updated_at = NOW()`. Every greige dispatch and
dispatch-cancel would have thrown and rolled back. Nothing caught it because the
table *did* have a timestamp — a "does this table have timestamps" check passes
on exactly that shape. Fixed for both shapes across 52 tables.

### Decisions not to reverse without understanding them
- **The quality gate is a block with an audited override, not an absolute bar.**
  A customer accepting B-grade at a discount is normal here. Refusing outright
  would strand real dispatches; what was removed is the *silent* case.
- **An unconvertible order line does NOT block the order.** It is stored with a
  null weight and the warning is returned on the result. Refusing would push the
  order back into a WhatsApp thread.
- **Approval bands refuse overlaps.** Two matching bands resolve arbitrarily via
  `ORDER BY min_value DESC LIMIT 1`, which looks decisive and is not.
- **Stock valuation past-dates carry a `reliable` flag.** The ledger starts
  2026-08-06; anything earlier cannot be reconstructed and says so.
- **AI confidence below 0.6 blocks AUTO send**, never a human send.

### Worth acting on
**No customer has a credit limit set**, so the credit gate has nothing to
enforce for anyone. The new **Credit Limits** screen leads with that count.

### New screens
Compliance Board, Complaints, Trash, Data Retention, Approval Matrix, Stock
Valuation, Credit Limits, AI Performance, GSTR-1, Financial, Bank Reconciliation.
Plus `docs/RUNBOOK.md`.

### The 7 Medium rows left, and why
| Item | Why not done |
|---|---|
| NIC e-way portal | Needs a GSP account and a commercial API contract |
| GST portal filing export | Needs portal credentials |
| Tally / Busy sync | Needs Busy's file spec from you |
| Secrets in plaintext `.env` | A purchasing decision; documented as accepted in the runbook |
| N+1 patterns | Analysis says "fine at current volumes" — editing money paths for no current benefit |
| Inconsistent response envelopes | Cross-cutting refactor across ~475 routes; piecemeal would add inconsistency |
| Missing validation layer | Same — wants one dedicated pass, not scattered edits |

---

## 📌 SESSION 2026-08-07 — the last four High items

**Every High item in PRODUCTION_GAP_ANALYSIS.md is now closed.** Details and the
reasoning are in **addendum 11**; this is the short version.

| Item | Commit |
|---|---|
| SALES role | `9e76cfa` |
| Customer statement of account PDF | `fb7f7a7` |
| GSTR-1 summary | `0e14579` |
| Financial dashboard | `b55554e` |
| ⛔ **Critical found doing them** | `9dd7339` |

### ⛔ Read this one first
**34 of 35 handlers on `/api/reports` required no authentication** — production
records, machine data, operator names and attendance, stock, costing, open to
anyone who could reach the port. The earlier sweep missed this router because it
could not be fixed alone: the download buttons used `window.open()`, which cannot
send an auth header, so guarding the router broke them. `utils/download.js`
(fetch → blob) fixes the call sites; the guard then went at the router level.

### Defects found while building the features
- **Quote rate silently dropped.** The handler deletes `body.rate` for
  unprivileged callers, so a SALES user's price would vanish and the quote go out
  at list price with no error.
- **Credit notes were missing from the customer ledger** while
  `v_invoice_balances` nets them off — would have diverged on the first approved
  sales return.
- **The GST Report page has never displayed anything.** It reads `output_lines`;
  the API returns `output.lines`. Empty tables and em-dashes, silently, forever.
- **₹4.1 lakh of fake invoices** from interrupted test runs were sitting in
  `dhown_mes` counting toward debtors. Backed up to
  `DHOWN_BACKUPS/removed_test_rows_*.json` and deleted. `integrity.e2e` now fails
  if artifacts are left behind.

### Design note worth keeping
SALES ranks at **OPERATOR** level, not SUPERVISOR. Sales work sits behind
SUPERVISOR guards, so promoting SALES to 3 would also grant GRN approval — a
ladder cannot separate the two. Routes opt in with
`requireRole('SUPERVISOR', { also: ['SALES'] })`; grep `also` to audit.
**Do not "simplify" this by moving SALES to 3 — tests will fail, correctly.**

### New surfaces
`/financial`, `/gstr1` in the sidebar; statement button on the Receipts panel.
New e2e suites: `sales-role`, `gstr1`, `financial`.

### Then: bank reconciliation (`da2d80b`) — the largest remaining finance gap
Payments were recorded but never proved against the bank. New: `bank_accounts`,
`bank_statement_lines`, `bank_reconciliation_matches`; `/api/bank/*`;
**Bank Reconciliation** in the sidebar with a CSV importer.

Two things not to "improve" without understanding them:
- **Auto-match only fires on a single candidate.** Two plausible receipts are
  left for a human on purpose. A wrong auto-match looks settled, credits the
  wrong customer, and leaves the right one being chased.
- **The row hash includes the occurrence number within the import.** That is
  what lets a statement be re-uploaded safely while two identical ₹10,000
  credits on one day both survive. Hashing content alone would delete one.

### Then: soft delete + Trash (`444c01d`)
Prompted by the incident above. **Trash** is under ADMIN in the sidebar.

Covers only the tables the API genuinely hard-deletes: `users`, `fabric_types`,
`knitting_structures`, `spare_parts`, `data_collectors`. Everything else was
already safe — partners/items/operators/machines have no delete at all
(`is_active`), and invoices/orders/payments use a `CANCELLED` status.

Three things not to undo:
- **`users.username` and `spare_parts.sku` now use PARTIAL unique indexes**
  (`WHERE deleted_at IS NULL`). Restoring a plain UNIQUE constraint would mean a
  deleted username could never be reused.
- **The last super admin cannot be deleted.** With soft delete this is now a
  permanent lockout risk, not a temporary one — the seeder sees the trashed row
  and does nothing, and Trash is behind the login screen.
- **Enrichment JOINs are intentionally unfiltered.** Adding `deleted_at IS NULL`
  to an inner join would hide a live machine whose fabric type was deleted.

### Next
Only Medium and Low items remain, none blocking. Candidates: ACCOUNTS role
(small — the `also:` mechanism exists), CHECK constraints, complaint workflow,
debtors ageing export, credit-note print view, compliance dashboard, OpenAPI spec.

Two Mediums that are **decisions, not code**: secrets in plaintext `.env` (needs a
secrets manager — your call whether that is proportionate here) and the
single-host/single-Postgres point of failure.

---

## 📌 SESSION 2026-08-06 (latest) — load testing + IPv6 rate-limit bypass

Every "High" item from the gap analysis is now closed except four features.

### Load testing — `npm run loadtest` (commit 82c4412)
`backend/loadtest/run.js` drives the running server over HTTP: read paths,
collector ingest, concurrency past the pool ceiling, and a correctness scenario
where 20 receipts land simultaneously on one invoice. Plain Node, no new deps.

⚠️ **It found a production-stopping defect on the first run.** 20 concurrent
receipts took **305 seconds and all 20 failed**. `pg_stat_activity` showed ten
advisory locks against a pool of ten: several paths held one pool connection
while asking for a second, which can never arrive.

- `payments.record()` / `applyCredit()` — `outstanding: await outstanding(...)`
  in the return expression, evaluated **before** `finally` released the client
- `lot-allocation.js` — helpers queried the pool inside `commit()`'s transaction
- `receiptNo` / `returnNo` / `creditNoteNo` — own connection **mid-transaction,
  while the advisory lock was held**

**This was never only a payments bug.** Ten stuck requests froze *everything* —
machines, dashboards, collector ingest. `connectionTimeoutMillis` was unset, so
exhaustion waited forever instead of erroring; that is why it presented as a
dead application rather than a failed request.

Fixed: follow-up reads moved after `client.release()`; a `db` parameter threaded
so transactions use their own client; `nextInvSeq` skipped when a client is
passed (it holds its own pool handle). `config/database.js`: `max` 10 → 25,
`connectionTimeoutMillis` 10s. **After: 240ms, 20/20, exactly 100000 allocated,
balance 0.** No scenario over 1s p95, no errors. Regression test in
`tests/payments.e2e.js` asserts both halves — fast *and* still exact.

### IPv6 rate-limit bypass (commit 359d945)
`aiLimiter` keyed on `req.user?.username || req.ip`. Over IPv6 a client holds a
whole prefix, so rotating the address bought a fresh 20-call budget every time —
the cap was decorative, at two LLM round-trips per call. `ipKeyGenerator` now
folds IPv6 to its /56; IPv4 unchanged; logged-in users still keyed by username
so one runaway script cannot lock out the office behind a shared NAT.
`loginLimiter`/`pinLimiter` were **not** affected (library default already folds).
Four tests in `test/rate-limit-key.test.js`; the first fails against the old code.

### Notes for next session
- Both instances restarted and healthy: dhown :4000, vdknits :4100.
  **VD Knits is a mirrored copy at `D:\VDKNITS_MES` — backend changes must be
  copied there too** (`START_VDKNITS.bat` runs from that tree, not this one).
- Addenda 9 and 10 in `PRODUCTION_GAP_ANALYSIS.md`.
- Both commits are **local only, not pushed** (standing rule).

### ✅ All four now DONE (2026-08-07) — see the session block above this one
| Item | Commit |
|---|---|
| SALES role | `9e76cfa` |
| Customer statement of account PDF | `fb7f7a7` |
| GSTR-1 summary | `0e14579` |
| Financial dashboard | `b55554e` |
| ⛔ Critical found doing them: `/api/reports` unauthenticated | `9dd7339` |

---

## 📌 SESSION 2026-08-06 (late) — production gap analysis + both Criticals closed

Full architectural review in **PRODUCTION_GAP_ANALYSIS.md** (evidence-based: the
database was queried and the running server probed, not read for intent).

### ⛔ Both Critical items CLOSED
1. **14 endpoints answered unauthenticated** — costing rates (yarn price, labour
   per shift), invoices, sales/purchase orders, operators + attendance (PII),
   settings, machines, rolls, batches, downtime, live-data, assignments.
   Guard applied at ROUTER level so new routes are protected by default.
   `POST /api/live-data` deliberately excluded — collector ingest, API-key guarded.
   No frontend changes needed: `src/utils/authFetch.js` already attaches the token
   globally (my audit wrongly predicted 58 broken call sites).
2. **Restore never tested** — rehearsed into a scratch DB, 286 tests passed against
   it. Procedure + measured figures in **docs/DISASTER_RECOVERY.md**.

### Also done (discretionary)
- **RPO 24h → ~1h**: hourly dumps kept 48h + nightly kept 7d.
  ⚠️ Found doing it: the nightly job wrote to `backend/src/lib/backups` while the
  admin screen listed `backend/backups` — the UI showed backups 3 weeks stale and
  **retention had never actually run**. Both now use `tenant.backupDir`.
  Dhown dumps found sitting in VD Knits backup folder → moved to
  `DHOWN_BACKUPS/recovered_from_vdknits_folder`.
- **TV dashboard** now has a scoped long-lived credential (Settings → Display
  token). `scope:display` is restricted server-side to `/api/dashboard/live` only —
  a plain VIEWER token would have read invoices and costing.

### 🔜 Highest-value remaining (from the gap analysis)
> **Superseded — see the latest session block at the top of this file.** All but
> the SALES role are now CLOSED; kept here as the record of what was found.

| Item | Severity | |
|---|---|---|
| 33 mutating endpoints with no role check (POST /users, PUT /settings, GRN approve) | High | ✅ closed |
| No schema migration mechanism — no version, no rollback | High | ✅ closed |
| Core financial tables have ZERO foreign keys | High | ✅ closed |
| 53 unindexed FK columns | High | ✅ closed |
| No AI evaluation harness | High | ✅ closed |
| No SALES role (CRM assigns to admins) | High | ⬜ open |
| Older frontend pages unverified since 34/100 in June | High | ✅ closed |
| Never load-tested | High | ✅ closed |

## 📌 SESSION 2026-08-06 — CTO audit + all 8 critical blockers + Phase 2 start

### Context
Ran an adversarial production-readiness audit of the WhatsApp CRM spec **and the
running system** (artifact published; findings verified against live code, not
theory). Verdict: the spec had **no non-functional requirements at all** — no
volumes, no latency targets, no availability objective, no retention policy — so
every architectural decision had been made by default. Scores: enterprise 41,
scalability 22, security 38, commercial 29. Then fixed all 8 criticals.

### ✅ All 8 CRITICAL blockers closed
1. **CRIT-02 idempotency** (`22c8d07`) — `wa_messages.wa_message_id` had no unique
   index, so every Meta retry duplicated a message, re-ran vision+LLM and in AUTO
   sent the customer a second reply. Now: `wa_processed_events` claim table (the
   INSERT *is* the claim, so concurrent retries can't both win) + partial unique
   index + `ON CONFLICT DO NOTHING` skipping all side-effects.
2. **CRIT-04/05 delivery + 24h window** (`91a1a87`) — `statuses` events were
   ignored entirely, so a quote that failed to deliver still read as *sent*.
   Now sent/delivered/read/failed tracked (a late `sent` cannot downgrade `read`),
   failures raise a SEND_FAILED follow-up, `window_expires_at` tracked and
   free-form sends refused 409 when closed. **Prereq fixed:** `sendText` discarded
   Meta's response so no outbound row had a wamid to match on.
3. **CRIT-03 consent** (`34ee296`) — purpose-aware (SERVICE/TRANSACTIONAL/
   MARKETING), `wa_consent` + append-only log, STOP/START handled **before the
   AI**, guard at the send layer on all 4 outbound paths, staff opt-in requires
   `proof_ref`. Keywords cover Hinglish and match whole messages ("dont stop
   production" is not an opt-out).
4. **CRIT-07 observability** (`21ba80d`) — `observability.js` (counters/gauges/
   timings/JSON logs/provider health, dependency-free), `/api/health/*`,
   `health-watch` alerting on provider down, send-failure rate, token expiry.
5. **CRIT-08 + CRIT-06** (`e4ac480`) — media now in the backup (was in NONE),
   dump self-verifies, `integration_credentials` tracks expiry (never values),
   `job_locks` leases make scheduled work safe on >1 instance.
6. **CRIT-01 durable queue** (`49320f0`) — webhook now **persists then acks**;
   `wa_webhook_events` + worker with backoff, DLQ, replay, stuck-recovery.
   Postgres-backed by deliberate choice (no Redis on this host).

### ✅ Phase 2 started
- **HIGH-02 stock reservations + ATP** (`6d5d498`) — SOFT/HARD holds, ATP =
  physical − hard − unexpired soft, advisory lock so concurrent quotes can't both
  pass (verified: 5 simultaneous, exactly 1 won). Soft holds expire every 15 min.
- **HIGH-05 credit re-check + approval matrix** (`6d5d498`) — credit re-evaluated
  at **confirmation**, overdue blocks regardless of headroom, value-banded
  approvals with a requests queue.
- **HIGH-12 quote revisions, validity, margin** (`7f86733`) — revisions snapshot
  history, quotes expire and release their stock, margin from real production
  cost with BELOW_COST/THIN/OK bands.

### 🐞 Real bugs found by testing (do not reintroduce)
- **Costing was HALVED**: cost/kg divided by `SUM(quantity_kg)` across cost
  components, but each component repeats the same batch qty. ₹260 vs true cost
  ₹268 reported **+48% margin instead of −3%**. Now rolled up per batch first.
- **Credit hold inherited the ORDER value band** — a supervisor could clear a
  customer with ₹200k overdue because that order was small. Credit reasons now
  use the CREDIT band (ADMIN).
- **Retry path was silently broken**: the idempotency claim was recorded before
  processing, so a queue retry saw its own claim and dropped the message.
  `claimEvent` now takes the queue event id and lets a retry of the *same* event
  through.
- **`process` shadowed Node's global** in wa-processor (module-scope function
  named `process` → every `process.env` resolved to the function).
- **Login stores `dhown_token`, not `token`** — 6 pages read the wrong key and
  sent `Bearer null`. 4 were pre-existing.
- **Alerting had no recipient** → monitoring that silently did nothing. Falls back
  to WHATSAPP_TO and warns at boot.
- **TDZ crashes** twice from `const` used before declaration in server.js/JSX.
- Windows bash mangles UTF-8 — post non-ASCII test payloads from Node.

### ✅ Done — Payments, allocation, ageing (commit 63a310c)
`payments` + `payment_allocations` tables; `v_invoice_balances` and
`v_partner_outstanding` views. **Outstanding used to be computed in 7 places** as
`SUM(grand_total) WHERE status='ISSUED'` — all 7 now read the views, so the credit
gate and Customer-360 can no longer disagree. Allocation is oldest-invoice-first,
advisory-locked per customer, and clamped so it can never exceed the invoice
balance or the payment. Advances stay as on-account credit and are applyable
later. Cancelling keeps the payment row for audit but deletes its allocations.
Ageing is bucketed on **balance**, not invoice total.

Routes (all under `/api/wa`): `GET/POST /payments`, `POST /payments/:id/cancel`,
`GET /customers/:id/outstanding|ledger|credit-on-account`,
`POST /customers/:id/apply-credit`, `GET /ageing`.

Tests: `npm run test:payments` (30 checks, all passing). `npm test` still 128/128.

**Not done here:** no frontend screen yet — receipts must be posted via API.
On-account credit is applied manually; raising an invoice does not auto-apply it.

### ✅ Done — E-way bills, transporters, POD, sales returns (commit 2b78138)
8 tables: `transporters`, `eway_bills`, `eway_vehicle_updates`, `delivery_proofs`,
`sales_returns` + items, `credit_notes` + allocations. Routes under
`/api/logistics`. **Does not talk to the NIC portal** — numbers are generated
there and recorded here.

- `GET /eway/requirement` answers "does this need a bill" *before* the vehicle
  leaves. Thresholds are env-configurable: `EWAY_INTERSTATE_THRESHOLD` (50k) and
  `EWAY_INTRASTATE_THRESHOLD` (1L — **Punjab's intra-state limit, not 50k**).
- Validity derived at 1 day per 200 km, to midnight of the last day.
- Cancellation refused past 24h (matches the portal).
- `GET /eway/alerts` = the compliance worklist: **expired bills on undelivered
  goods**, and **dispatches over threshold with no bill at all**.
- Part-B vehicle changes keep history. POD is one per dispatch; `REFUSED` is
  deliberately *not* marked delivered.
- Returns are DRAFT → approve. Approval is one transaction: stock back + credit
  note + allocation. **Credit notes net off in `v_invoice_balances`**, so the
  credit gate and Customer-360 see the reduced balance. Over-returning is blocked
  counting earlier returns. `REWORK`/`SCRAP` are credited but **not** restored to
  sellable stock.

Tests: `npm run test:logistics` (55 checks). **`npm run test:all` now runs
everything: 128 jest + 30 payments + 55 logistics.**

**Not done here:** no frontend screens — all of it is API-only so far. E-way
numbers are entered by hand (no portal API integration).

### ✅ Done — Lot allocation, quarantine, UoM (commit 6bfac10)
`/api/allocation`. Rules in order: **repeat customer gets their previous dye lot**
→ else **one lot, oldest that covers it** → else **split across fewest lots,
flagged `shade_risk`, ADMIN must approve before dispatch**.

- ⚠️ **The dye batch is `batch_rolls`, NOT `rolls.lot_id`** — that column is the
  *yarn* lot. Using it groups by the wrong thing and silently produces shade
  splits while reporting single-lot picks.
- A unique index makes double-committing a roll impossible, not just unlikely.
- Quarantining a roll **releases it from its live allocation** and annotates that
  allocation as short. REWORK/SCRAP are separate states; every transition logged.
- **UoM refuses to guess.** kg↔m is derived per item from its own GSM and width;
  roll weight from measured history; a **global kg↔m factor is rejected outright**
  (the ratio depends on the fabric). Unknown pair = error, never a guess.
- Views moved to `ensureFinancialViews()`, run last. They were defined twice; the
  second `CREATE OR REPLACE` tried to drop a column, which errors and was
  silently aborting the rest of that schema block.

### ✅ Done — AI conversation memory (commit 5af4bda)
Three layers: durable facts → rolling summary → last 12 turns verbatim (capped by
chars too). The message being answered is **excluded** from history (it is stored
before the orchestrator runs, so it appeared twice). Summarisation runs **after**
the reply, failures degrade quietly.

Fixed: `$2 - $3` untyped in the summarise query = "unknown minus unknown", so
summarisation had **failed on every call** — invisibly, because that path
degrades quietly.

Verified live: *"What about 500 kg?"* (no product in it) now resolves to
180 GSM white single jersey from the earlier turn.

**Phase 2 backend is complete.**

### ✅ PHASE 2 COMPLETE — backend + all 5 screens

| # | Screen | Route | Commit |
|---|--------|-------|--------|
| 1 | ✅ Receipts & Outstanding | `/receipts` | 193e931 |
| 2 | ✅ E-way & Compliance | `/eway` | 0fcc456 |
| 3 | ✅ Proof of Delivery | `/m/pod` + `/pod` | 594dfe7 |
| 4 | ✅ Sales Returns | `/returns` | e1286f5 |
| 5 | ✅ Lot Allocation & Shade | `/allocation` | 845ca63 |

**POD is one component at two routes** — `/m/pod` standalone with its own login
(like `/m/qc`) for the gate, `/pod` in the office layout.

**Three API gaps found ONLY by building the UI** (all fixed). Worth noting the
pattern: each was something falling into a gap *between* two lists, invisible
from the endpoint list alone.
- `GET /api/wa/credit-on-account` — `/ageing` lists only customers who *owe*, so
  an unapplied advance appeared **nowhere**.
- `GET /api/logistics/pod/unresolved` — refusing a delivery removes it from
  pending (correct), but the goods are coming back and **nothing showed them**.
- `GET /api/logistics/returns/returnable/:invoiceId` — the returnable ceiling
  existed only inside the validator; the form would have had to recompute it and
  could drift.

⚠️ Both new sub-routes are declared **before** their `/:id` sibling or the
parameterised route swallows them.

**Testing note:** every screen was driven in a real browser against seeded data,
not just compiled. That is what surfaced the gaps above plus three display bugs
(settled-vs-part-paid wording, stale open-invoice count, cancelled receipt shown
as on-account credit). Demo data was removed after each.

### ⚠️ Known, not fixed
- **CORS allows `localhost` but not `127.0.0.1`.** Harmless for real users (LAN
  IP + localhost both allowed) but POSTs from `127.0.0.1` return HTML instead of
  JSON, which is a confusing failure while testing. `server.js` ~line 40.

### 🚧 Phase 3 — 2 of 3 done

**1. ✅ Tenant-aware codebase** (1935c9f, b715c6f) — the code no longer contains
the firm's identity, so a second firm is a second `.env`, not a second copy.
- `backend/config/tenant.js` = INFRASTRUCTURE (backup dir, origins, QR base).
- `app_settings` = DISPLAY identity (company_name, gst_number…) — it **already
  existed** and is already per-database. `src/lib/company.js` reads it, cached
  60s, invalidated on Settings save. Deliberately NOT duplicated into `.env`.
- Fixed: backup.repository.js had **two** backup dirs (listing read one,
  createDump wrote a hardcoded absolute path) — an on-demand dump never appeared
  in the list, and a 2nd instance would write into Dhown's folder.
- Fixed: DB password no longer defaults to a real one in source.
- CORS now accepts 127.0.0.1 (the gap noted last session).

✅ **FORK RETIRED (2026-08-06).** `D:\VDKNITS_MES` now runs THIS codebase.
- **Risk was far lower than assumed:** `vdknits_mes` had 71 tables and **23 rows
  total** (17 settings, 5 audit, 1 user). It was never used for production. The
  cutover was a code swap, not a data migration.
- Schema self-upgraded on boot: **71 → 117 tables**, all Phase 2 objects + both
  views, no errors.
- Backups taken first: `D:\DHOWN_BACKUPS\vdknits_mes_pre-cutover_*.dump` and
  `vdknits_config_pre-cutover_*\backend.env`.
- ⚠️ `D:\VDKNITS_MES` could **not be renamed** (locked by a stale handle), so the
  old tree was overwritten in place. Legacy dirs (`backend/controllers`,
  `models`, `routes`, `migration_*.js`) are still there and **inert** — the new
  833-line server.js does not require them. Safe to delete when convenient.
- Both instances verified running side by side: :4000 dhown_mes, :4100
  vdknits_mes. Different JWT secrets — a Dhown token is **401 on VD Knits**.
  286 tests pass against *each* database.

**Three bugs only a second instance could reveal** (all fixed):
1. `config/tenant.js` didn't load dotenv itself — anything reaching it before
   server.js called dotenv silently got **Dhown defaults**, so VD Knits prefixed
   its backups `dhown_backup`.
2. **The tenant DB had no reference data.** All of uom/item_categories/tax_rates/
   doc_series/financial_years/warehouses/defect_types were empty — structurally
   complete, functionally unusable (no UoM = no items; no doc_series = no invoice
   numbers). `ensureReferenceData()` seeds them, only when empty, FY derived from
   today. No-op on Dhown (verified: 0 seed lines, counts unchanged).
3. **The UI was still branded DHOWN.** Now fetched at runtime from
   `GET /api/public/tenant` — one build, both firms. Build-time vars were
   rejected: a bundle per firm is the fork problem again.

### VD Knits operating notes
- Ports **4100** (HTTP), 4543 (HTTPS), 8190 (DC ingest). DB `vdknits_mes`.
- `app_settings` identity is **EMPTY** → falls back to `COMPANY_NAME` in .env.
  **Set company name/address/GSTIN in Settings** before issuing any document.
- Only user is `admin` (SUPER_ADMIN).
- No machines registered, so the dashboard is empty until they are added.

**2. ✅ Pre-commit test gate** (db40820) — `.githooks/pre-commit`. Chosen over
GitHub Actions because this repo is never pushed, so a workflow would never run.
Unit tests block; e2e are **skipped** if Postgres is down (blocking on that
trains people to use `--no-verify`). Proven to block by breaking marginPct.
⚠️ `core.hooksPath` is local config — after a clone run `npm run hooks:install`.

**3. ✅ Retention** (56488a2) — nightly 03:00, an hour after the backup.
⚠️ **machine_live_data is NOT a time series** — it has UNIQUE(machine_id) and is
upserted, one current-state row per machine. Ageing it out would blank an idle
machine's dashboard tile. Excluded, and the test asserts it stays excluded.
Eligible: audit_logs (730d), machine_status_log (365d), rfid_events (180d),
wa_webhook_events + wa_processed_events (30d). Financial/stock/aggregate tables
and wa_messages cannot be added by config. `run()` dry-runs by default.

### 🔜 Next task — Phase 3 is COMPLETE
Open items, none blocking:
- **VD Knits go-live prep**: set company identity in Settings, register machines,
  create users. Decide whether it needs its own launcher/autostart.
- Delete the inert legacy dirs under `D:\VDKNITS_MES\backend` (`controllers`, `models`,
  `routes`, `migration_*.js`) once the folder lock clears.
- Partitioning deliberately scoped out: at these row counts retention suffices,
  and partitioning a live table is a bigger change than the growth justifies.
- Still open from Phase 2: should the ageing worklist feed the WhatsApp
  collections flow?

**Still open for Nakul:** should the ageing worklist feed the WhatsApp
collections flow? Data is there; wiring "chase this customer" into the CRM is a
separate decision.

**Operational, unchanged:** NVIDIA endpoint dead (all AI on Groq fallback);
WhatsApp go-live blocked on Meta publish; ESP32 collector awaiting technician;
wage rates on 18 operators; TSC printer; Paradise reports (need Excel samples).

Then Phase 3: multi-tenancy (VD Knits fork), CI/CD, partitioning/retention.
Then Phase 3: multi-tenancy (VD Knits fork), CI/CD, partitioning/retention.

### ⚠️ Operational notes
- **NVIDIA endpoint is dead** (ECONNRESET) — all AI runs on the Groq fallback.
  Now visible on the health screen. Fix the key or drop the integration.
- Tests: **128 passing** at that time (286 as of 2026-08-06 — 128 unit + 158 e2e).

---

## 📌 SESSION 2026-08-05 — WhatsApp AI CRM (all 5 phases)

### Done today
- **★ Built the complete WhatsApp AI CRM module** — 5 phases, 10 commits, `3091912`→`ce57a3a`. Architecture + phase log: **`docs/WHATSAPP_CRM_DESIGN.md`** (read this, don't re-derive). Deep notes in memory `project_dhown_wa_crm.md`.
  1. **Foundation** — `wa_conversations/wa_messages/wa_ai_actions/crm_leads/crm_followups`; webhook splits staff-alert-ack from customer CRM; phone→partner match; auto-lead for unknown numbers; 3-pane inbox `/whatsapp-inbox`; AI OFF/SUGGEST/AUTO; full audit trail.
  2. **Media + shade cards** — inbound media downloaded to `backend/uploads/wa` (gitignored, Meta URLs expire); JWT-gated media serve with `basename()` anti-traversal; UI fetches as authenticated blobs; `shade_cards` library + `get_shade_card` (stock read LIVE, never stored on card) + one-click send.
  3. **Quotes + approvals + draft orders** — `wa_quotes/wa_quote_approvals/wa_draft_orders`; price auto-set ONLY from customer's own last billed rate else `PENDING_PRICE_APPROVAL`; credit gate (§19); customer confirm → DRAFT only, employee confirm → real SO.
  4. **Production + inventory** — stage tracker (rolls→batches→subcontract→QA→FG→dispatch); **ETA only from real committed MES dates**, `eta_source` reported, null when none; inventory physical/reserved/available + greige + WIP.
  5. **Intelligence** — lead scoring (HOT/WARM/COLD), opportunity engine (1.5× customer's own order gap), dashboard `/whatsapp-insights`, 12-stage pipeline, conversation search, image understanding (vision).
- **Tests 44 → 70** (26 new: quote guardrails 14, scoring 12). All passing.
- **Also earlier today:** delete buttons for racks + bins in Admin Masters → Location (`c745b42`, `821dcc7`), with a 409 guard when the location has stock movements.

### 🔜 Next task (WhatsApp CRM — module is ~72/100)
1. **Quote/invoice PDF** generation + send (quotes currently go as formatted text) — biggest functional gap.
2. **AI copilot summary + recommended-action buttons** (§15) and `conversation_summaries` table.
3. Customer-360 remaining tabs: INVENTORY, DOCUMENTS, AI INSIGHTS.
4. Pipeline **drag-and-drop** (stage change works via click/API today).
5. Freight rules in quotes; sample-request flow; complaint workflow.
- **BLOCKED on Meta (not code):** customer-facing AUTO needs app **Published** + 24h session window + permanent System User token + new SIM. **Internal SUGGEST mode works today.**
- **Rollout advice:** run SUGGEST-only ~1 week, review `wa_ai_actions` audit rows, then enable AUTO per conversation.

---

## 📌 SESSION 2026-08-03

### Done today
- **★ Money-math test suite built** (audit's #1 gap: 0 automated tests). **25 tests, 3 suites, all passing** via Jest (`cd backend && npm test`). Commit `b058a34` on `server-refractor`.
  - `test/gst.test.js` (8) — `computeTax`: intra CGST+SGST split, inter IGST, mixed rates, 0%, round-off, per-line totals, bad-input safety.
  - `test/payroll.test.js` (7) — `computePay`: DAILY days×rate, MONTHLY flat, net w/ OT/bonus/deductions/advance, negative net, rounding, defaults.
  - `test/shift.test.js` (10) — `parseHHMM` + `detectCurrentShift` 2-shift/3-shift boundaries via jest fake timers.
  - Enabling refactor (behavior unchanged): exported `computeTax`/`r2` from `tax-invoices.service.js`; extracted pure `computePay()` into `src/lib/payroll-calc.js`, now used by `payroll.repository.updateItem()`. Added `jest` devDep + `"test":"jest"` script.
- **★ Full git-bundle backup** of the whole repo (all ~109 commits + every branch) → `D:\DHOWN_BACKUPS\dhown_mes_20260803_125819.bundle` (14 MB, `git bundle verify` = complete history). ⚠️ Still on the **same disk** — copy the .bundle to a USB / another drive for true disaster safety.
- **★ Admin credential hardened** (commit `ef768d7`). Removed the hardcoded `admin123` seed default → fresh installs take `ADMIN_DEFAULT_PASSWORD` from env or a random password printed once at first startup. Added `backend/scripts/set-admin-password.js` to rotate an existing account from an env var (never written to a file). Documented `ADMIN_DEFAULT_PASSWORD` in `.env.example`.
  - **✅ DONE:** live `admin` password rotated by Nakul 2026-08-03 (via founder account) — `admin123` no longer accepted (verified 401). Full `git bundle` backup also copied off-disk.

- **★ Guarded 10 unauthenticated API routers** (audit gap closed, commit `29dae0c`). production, analytics(OEE), inventory-views, greige, traceability, dashboard, charts, command-center, alerts, active-operators now require a JWT. `analytics` + `inventory-views` mount at bare `/api` so they're guarded **per-route** (a router-level guard there would have blocked `/api/auth/login` — caught and fixed during testing); the other 8 use `router.use(verifyToken)`. Verified live: no token → 401, valid token → 200, login works, `/api/live-data` still on its DC api-key guard, `/api/public` untouched. Backend restarted to load it.
  - **⚠️ Eyeball after next login:** the live **Dashboard / Charts / Command Center** pages are now auth-gated. The app sends the JWT after login so they should render normally — just confirm the main dashboard still loads once. (No logged-out TV/kiosk should rely on these — user confirmed.)

- **★ Merged `server-refractor` → `main`** (clean fast-forward; `main` was 0 ahead / 112 behind, a direct ancestor — no conflicts possible). `main` now == the full refactor + all recent work at `c1053dd`. **Active branch is now `main`** (switched; `server-refractor` kept as a duplicate pointer, delete later if desired). Nothing pushed — `main` is 112 commits ahead of `origin/main`, still local-only per Nakul's rule.

- **VD Knits (2nd firm instance) — planned full re-sync (NOT started).** VDK at `D:\VDKNITS_MES` is frozen 2026-07-11, far behind: `server.js` 5,248 lines (DHOWN 788), 16 route files (DHOWN 56), no `src/lib`/`src/db`/`scripts`. Today's changes can't be file-copied. **Decision 2026-08-03: hold; do a full re-sync later as its own session** — replace VDK backend with DHOWN current, keep only its `.env` (ports 4100/8190, own JWT, DB `vdknits_mes`), then re-brand frontend + rotate its admin off admin123. Not date-scheduled.

### 🔜 Next task
- ESP32 collector remains **SUSPENDED** pending the other technician (firmware v2.0.0 + wiring PDF + Amazon parts list all ready).
- WhatsApp go-live blocked on Meta (6 templates in review, permanent System User token, new production SIM).
- Operational: set wage rates on the 18 operators; TSC printer + labels → bulk stock entry; Paradise reports (need Excel samples).
- Remaining audit item: 🟠 confirm/guard the **unauthenticated routes**; plan the **`main` merge** of `server-refractor`.

---

## 📌 SESSION 2026-07-31

### Done today
- **PIVOTED collector strategy to the self-hosted ESP32 path** (user: "forget the vendor collector, fabricate our own" — the Yindu collector never read the revolution sensor). Parts **ordered** (ESP32 38-pin, W5500, PC817×20, 1k through-hole resistors, buck converter, enclosure, dupont, DIP sockets).
- **Firmware rewritten → v1.2.0** (`firmware/esp32-collector/esp32-collector.ino`, commit `2a4d1b8`). Two fixes vs the prior repo firmware:
  1. Networking: dropped the Arduino `<Ethernet.h>` library (Arduino-board-only, **not installable for ESP32** — this is why it "couldn't be found" in Library Manager) → **built-in `ETH.h`** W5500 driver. **Needs the W5500 INT pin wired → GPIO35** (new wire; add 10k pull-up INT→3V3 if no IP).
  2. Tower-light semantics corrected for these machines: **green (T16) = roll-complete/doff, NOT running**; run/stop derived from the **count pulse (rpm>0)**, matching the server.
  - Aligned to the existing contract: `POST :8090/api/live-data`, header `x-api-key`, body `{machine_id, rpm, dc_status:"online", production_counter, stoppage_reason}`. README updated.
- **Endpoint enhanced** (`src/routes/live-data.routes.js`, same commit) — the "offered but NOT built" item from 2026-07-29 is now **built**: reads optional `stoppage_reason`/`status_reason` and uses it for the AUTO downtime `reason` instead of `'Reason Pending'`; backfills an already-open pending downtime once the fault signal appears. Additive, backward-compatible, `node --check` clean.
- **Full-project audit** → `AUDIT_REPORT.md` 2026-07-31 addendum. Headline: features ~92, engineering-readiness ~84. Big win: **server.js refactor complete (7,914 → 791 lines)**. Top gaps: 🔴 zero automated tests; 🟠 unauthenticated routes (production/analytics/inventory-views/greige/traceability — confirm intent); 🟠 `main` is 100 commits behind `server-refractor`.

### 🔜 Next task (when the ESP32 board arrives — Prime ~1 Aug)
1. **Register SJ03** in `machines` (`kg_per_counter`, `rpm_target`) + `data_collectors`, or production shows 0 kg.
2. Arduino IDE + ESP32 core already installed; **no Ethernet library needed** (ETH.h built-in). Open `.ino`, edit the 4 config lines (`MACHINE_ID`, `MES_HOST`, `DC_API_KEY`, `ACTIVE_LOW`), Upload, watch Serial for `[eth] got IP` then `[post] … 200`.
3. **Measure at the machine** before soldering: terminal voltages vs T22 (sets 1k/2.2k resistor + `ACTIVE_LOW`), and pulses-per-rev on T23 (sets `PULLS_PER_REV` for rpm).
4. Bench-test (USB + CAT6, simulate signals) → build opto channels → go live 23+07 first, add reasons.

### Priority backlog (from audit)
- Confirm/guard the **unauthenticated routes**.
- Seed a **test harness** on money + `/api/live-data` paths (biggest risk reducer).
- Plan the **`main` merge** of `server-refractor`.

---

## 📌 SESSION 2026-07-29

### Done today
- **SUSPENDED: self-hosted ESP32 collector (alternative to the dead vendor path).** Vendor could not get Yindu collector→cloud working; built a full DIY alternative. Firmware `firmware/esp32-collector/` (`d591046`, wired CAT6 rewrite `9e43a18`): ESP32 + W5500 Ethernet taps the XH-600S signals via optocouplers, POSTs to MES `/api/live-data:8090` with `x-api-key`. Reads T23 count→RPM/production, lamps 16/07/08→run/stop/warn, alarm terminals 21/29/25/24/28/34→stoppage reason. Wiring PDF generated (scratchpad `DHOWN_ESP32_XH600S_wiring.pdf`). **Key wiring note:** tap at the machine base distribution box (配电箱) terminal block — same terminal numbers as the controller back, proper screw terminals; parallel tap via PC817 optocouplers (no active splitter needed), common return = terminal 22; measure voltages+polarity first. **PAUSED — user consulting another technician.** Offered but NOT built: MES ingest extension to auto-log downtime from `status_reason`.
- **WhatsApp feature suite (4 features) built on the Cloud API** (`20ad0d8`,`ff88d59`,`e77a10c`,`82ed06c`). All reuse a generic `sendTemplate()` in alerts.js.
  1. **Shift/daily production summary** — auto at shift-end (`WHATSAPP_SUMMARY_TIMES` 20:00/08:00) + "Send Shift Summary" button in Report Center. Template `shift_summary` (6 params).
  2. **Customer invoice + dispatch notify** — `customer_mobile` on tax_invoices; WhatsApp button on Tax Invoices. Templates `invoice_notify` (4), `dispatch_notify` (4). `/api/notify/invoice/:id`, `/dispatch`.
  3. **PO to supplier + low-stock alert** — `supplier_mobile` on purchase_orders; WhatsApp button on POs; low-stock watcher (yarn_lots per yarn_type < `WHATSAPP_LOWSTOCK_KG` 100kg, once/day). Templates `po_notify` (4), `low_stock` (3). `/api/notify/po/:id`.
  4. **Two-way status + escalation** — reply "status"/"summary" → live summary (free-form, no template); unacked machine alert > `WHATSAPP_ESCALATE_MIN` (15) → escalates to `WHATSAPP_ESCALATE_TO` (reuses machine_alert template).
  - **⏳ TEMPLATES TO CREATE/APPROVE IN META (all Utility, English/en, end with static text):** `machine_alert`✓submitted, `shift_summary`✓submitted, **`invoice_notify`, `dispatch_notify`, `po_notify`, `low_stock` (4 more to create)**. Each feature sends only once its template is Active. Config all in `.env` (`WHATSAPP_*`); tokens are temp 24h — **still need System User permanent token**.
- **WhatsApp alerts — switched to official Cloud API + built two-way acknowledge** (commits `1dc7986`, `11d1b30`, `7094788`). Replaced flaky CallMeBot with Meta WhatsApp Cloud API (template `machine_alert`, 3 params machine/status/time). Multi-recipient (`WHATSAPP_TO` comma-list of 5 numbers, or all active supervisors/admins). **Two-way**: `/api/whatsapp/webhook` (verified live, subscribed to `messages`) — supervisor replies OK/on-it → logs to `machine_alert_acks` + suppresses re-alerts until machine recovers. `.env` has token/phone-id/template/lang/recipients/verify-token (WHATSAPP_VERIFY_TOKEN=dhown-wa-b5e3f4ac11a89e8378). Meta app = "business" (App ID 27408475122114109, Dhownhosierymills).
  - **⏳ BLOCKED ON META (resume tomorrow):** (1) template `machine_alert` still **In review** — when Active, run a test send. (2) **Step 3 Business Verification** in progress (needs GST cert + business reg docs) — required to **Publish** the app, which unlocks two-way reply delivery + sending to non-test numbers. (3) For an immediate dev-mode test: add the 5 numbers as **test recipients** in Step 1 API Setup. **Sending works in dev once template approved + numbers are test recipients; reply-to-ack needs the app Published.** All code done/tested/committed; only Meta approvals remain.
- **PWA install prompt added** (`f2b81ba`). PWA scaffolding (manifest, service worker, icons, SW registration) already existed from Jul 16; added an in-app install banner (Android beforeinstallprompt one-tap; iOS Share→Add-to-Home hint; dismissible). Install on phones via the **HTTPS Cloudflare URL** `mes.dhownhosiery.com`. Mobile-optimized pages (MobileRoll, MobileQC) already exist. **Mobile dimension now solid.**
- **Production Planning: Make-to-Order vs Make-to-Stock** (`b853c1c`). `plan_type` (MTO/MTS) — auto-derives MTO when a sales order is linked, MTS otherwise; type badge + filter. Factory runs both modes.
- **Tax Invoice module built** (GST invoices — final backlog item). `tax_invoices`+`tax_invoice_items` (self-heal); INV-YYYY-NNN. Server-side GST: INTRA→CGST+SGST, INTER→IGST; lifecycle DRAFT→ISSUED→PAID/CANCELLED; Print action → formatted GST invoice. Commit `ca7cd22`. Tested (intra 40000→CGST 1000+SGST 1000; inter→IGST 2000). **★ ENTIRE SOFTWARE BACKLOG NOW COMPLETE: PO, SO, Production Planning, Payroll, Tax Invoice all built.**
- **Collector remapped WD250429→WD250430 for SJ03** (SJ03's collector was physically swapped). Updated `data_collectors` + `machines.dc_id`; poller auto-refreshes the map (no restart needed).
- **★ COLLECTOR FINAL STATE (2026-07-30):** WD250430 is **connected & communicating** — Settings → Data Collectors shows it **ONLINE** (set by ingest `live-data.routes.js:168` on every successful poll), and **`working_hours` increments live** (06H32M53S→06H33M18S in 25s), proving the collector reads the machine's on-state in real time. **BUT rpm=0, revolution=0, machine_status=3 (offline) — CORRECT** (user confirmed status 3 = offline). Meaning: the collector detects power/uptime but is **NOT reading the revolution/speed pickup sensor** on the machine → no rpm, no production count, so it correctly reports offline. **This is the ONLY remaining gap and it is a VENDOR job:** wire/align the **rotation pickup sensor** from WD250430 to the SJ03 machine. Network + WiFi + mapping + MES are all ready — the instant the revolution sensor reads rotation, SJ03 goes live automatically, no further code/config. Vendors left before doing this. **Do NOT change the status=3→offline mapping (confirmed correct).** Tell vendor: *"WD250430 online and reading uptime, but revolution/speed sensor reads 0 — rotation pickup on SJ03 not connected."*
- Router client list check (to confirm WD250430's DHCP lease) — Tenda admin at `http://192.168.1.1` needs admin login (browser tools blocked from it). Network scan showed a collector took a fresh lease at 192.168.1.2 (`00-4a-e1-9d-ef-3d`).
- **Purchase Orders module built** (highest-value backlog item). Supplier POs for yarn/materials → feeds GRN. `purchase_orders` + `purchase_order_items` (self-heal on boot); PO numbering from `doc_series 'PO'`; layered backend at `/api/purchase-orders` with DRAFT→SENT→PARTIALLY_RECEIVED→RECEIVED/CANCELLED lifecycle (illegal transitions guarded); frontend page (list+filters, create form with dynamic line items + live totals, Send/Receive/Cancel/Delete) + sidebar link under TRANSACTIONS. Commit `8c6e89b`. Backend lifecycle/cascade tested; page verified live.
- **Sales Orders module built** (customer-side mirror of PO → feeds dispatch). `sales_orders` + `sales_order_items` (self-heal on boot); SO numbering via `nextInvSeq` (SO-YYYY-NNN); layered backend at `/api/sales-orders` with DRAFT→CONFIRMED→PARTIALLY_DISPATCHED→DISPATCHED/CANCELLED lifecycle (guarded); frontend page + sidebar link under TRANSACTIONS. Commit `9a4868c`. Tested (SO-2026-001, totals correct); page verified live.
- **Production Planning module built** (connects demand→shop floor). `production_plans` (self-heal on boot); plan numbering via `nextInvSeq` (PP-YYYY-NNN); layered backend at `/api/production-plans` with PLANNED→IN_PROGRESS→COMPLETED lifecycle + ON_HOLD/CANCELLED (guarded), inline progress update (produced vs target), priority ordering, optional Sales Order link; frontend board (filters, create form, progress bars click-to-edit, Start/Complete/Hold/Resume/Cancel) + sidebar link under SHOP FLOOR. Commit `18745dc`. Tested (PP-2026-001, lifecycle/progress/guards); page verified live.
- **Payroll module built** (attendance-driven wages). Operators gained `wage_type`+`wage_rate` (form + repo). `payroll_runs`+`payroll_items` (self-heal); PR-YYYY-NNN numbering. A run auto-generates a line per active worker with days from `operator_attendance`, gross (DAILY days×rate / flat MONTHLY), net = gross+OT+bonus−deduct−advance; lifecycle DRAFT→FINALIZED→PAID (edits locked after finalize); reads/writes SUPERVISOR, pay/delete ADMIN. Frontend Payroll page (run list + editable per-worker detail) + sidebar link under MANAGEMENT. Also fixed sidebar highlighting /production on /production-planning (added to EXACT_ONLY). Commit `7ac4a74`. Tested full chain (wage→3 days→gross 1500→net 1400→finalize lock, PR-2026-001); page live. **Backlog now: only Tax invoice remains.**
- **Hourly Machine Utilization Log now totals per shift.** The Total Running/Stop/Revolution columns were accumulating continuously across the whole date range; now they **reset at each machine+date+shift boundary** (day shift climbs 1h→12h, night shift restarts at 1h). `windowRow` takes an explicit `cumKey`; the Shift view keeps its period-wide totals. Backend-only, verified live. Commit `e910b14`.
- **Verified the Yindu poller is active & healthy** — running (PID from Jul 25), cookie valid, posting `WD250429→SJ03 … → MES 200` every cycle. Cloud device `0000028` in the log is **sample/test — ignore it** (user confirmed).

### 🔴 Collector — configured, STILL OFFLINE (unresolved)
- User configured SJ03's collector via 485ToJson and Wrote: SSID `Tenda_F7F5E0`, pwd `admin@123`, server `161.117.46.211`, port `8098`, device `WD250429`. Screen showed all fields correct.
- After Write + power-cycle, **5-minute poller watch = all 20 checks `status=3` (offline)**. Still offline.
- **WiFi password confirmed CORRECT** — user connected the laptop with `admin@123`.
- **WiFi is NOT the problem**: ARP/ping sweep of the Tenda `192.168.1.x` subnet found **~10 collector-type devices already connected with IPs** (MAC prefixes `00-70-f6`, `00-70-f7`, `00-71-c9`, `00-6d-66`, `00-4a-e1` at .4/.5/.9/.10/.12/.44/.46/.50/.63/.111). So the collector fleet joins the WiFi fine. Laptop on `Tenda_F7F5E0_5G` @ 192.168.1.13, gateway 192.168.1.1.
- **Leading hypothesis: the server IP/port did not persist to SJ03's collector** (connects to WiFi but has nowhere to send data). **NEXT STEP: click 读取 (Read) on the collector and check** — if Server IP blank / port 0 → re-Write; if filled → server-reachability/another power-cycle. Alternatively open Tenda admin `http://192.168.1.1` → client list.

---

## 📌 SESSION 2026-07-27

### Done today
- **Utilization metric fixed (front + back).** Dashboard showed 22% because the **frontend** `Dashboard.jsx` computed its own `(total − offline)/total`, counting downtime machines as utilized. Rewrote to `running / available` where `available = total − no_data − downtime` — now matches the backend rule in `dashboard.routes.js`. Verified live = 0% (no machines running). **Business rule: downtime is NOT utilization** (excluded from denominator). Commit `9372762`.
- **New report: Machine Utilization Log (cloud-format).** Reproduces the machine vendor's cloud portal export (the 13-column `exportData.xlsx`) from MES data — running/stop time, revolutions, stop details, shutdown counts.
  - **Hourly view (default)**: one row per machine/hour from `production_history` (real `HOURLY` buckets, `hour_bucket`/`period_start/end`/`counter_start/end`); adds an **Hour** column (14 cols).
  - **Shift view**: one row per machine/shift, original 13-column layout from `oee_records`.
  - Endpoints: `GET /api/reports/machine-log` (JSON), `/api/reports/machine-log-excel` (real .xlsx via **exceljs**, sheet `sheet1`), param `?granularity=hourly|shift`.
  - Frontend: card in `ReportsDashboard.jsx` + renderer & **Hourly/Shift toggle** in `ReportPreview.jsx`. Commit `1686306`.
  - ⚠️ **Caveat**: with no downtime records, running time = full interval (hour/shift) even at 0 revolutions — reads correctly only once the collector feeds real running/stop signals.
- **485ToJsonWrite desktop shortcut** created (ClickOnce `.appref-ms` copied to Desktop).
- **Google Business Profile** content pack delivered (description, review-request WhatsApp EN/Hindi, reply templates, photo shot-list, 5 Google Posts) — Google domains are blocked in the tooling, so user applies them manually.
- **Operators page → workforce master.** Added **worker types** (Operator/Helper/Supervisor/Master/Driver). **OP ID + Employee ID now auto-generated**: role-specific code with own sequence (`OP/HP/SV/MS/DR + NNN`) + company-wide `EMP + NNN`; manual code entry removed. **Shift field removed** from operator record (shifts rotate weekly → tracked via assignments/attendance). Commits `d4f5cda` (feature) + `435364f` (`ensureOperatorsSchema` auto-migrates `worker_type` on boot — VD Knits/fresh deploys self-heal).
- **Attendance: manual mark-present for non-RFID staff.** Attendance was RFID-only/read-only (records only on card scan) — supervisors/helpers/drivers/masters couldn't be marked. Added `POST /api/attendance` (upsert on operator+date+shift, idempotent) + `DELETE /api/attendance/:id`, protected with verifyToken + requireRole('SUPERVISOR'). Frontend: **"Mark Present (no RFID card)"** panel + per-row Remove in the Attendance tab. RFID auto-recording unchanged. Commit `24afba6`.
- **Note on current data**: operators table has 1 real operator (`OP001 / EMP001 / BIRJAN YADAV`, Knitting) after go-live wipe. Collectors will be fitted to **every machine** (not just SJ03) — each new collector reports a distinct device number; **record device-no → machine_id mapping** and update the poller so all machines route correctly.

### 🔴 Collector — FAULTY, being replaced today
- Root cause of all "no live data" symptoms today = **faulty collector hardware** (confirmed by user; unit being swapped 2026-07-27). Not a config/network problem.
- Cloud portal (`161.117.46.211:8098`) showed `WD250429` **Offline**, 0 circle, 0 kg — device online at radio level but never reporting.
- **USB-485 adapter also flaky**: `[System.IO.Ports.SerialPort]::GetPortNames()` returned empty; CH340 shows as ghost entries on COM3/4/5 (none live). Windows never enumerated a live COM port → "the port is closed" error in 485ToJson.
- 485ToJson config tool (圆机 window) reads/writes collector over RS-485: 路由器名称=SSID, 路由器密码=WiFi pwd, 服务器Ip, 服务器端口, device dropdown 输入设备号. Wire converter to **A/B only** (never V/power). Old device no. `0000028`.

### For the REPLACEMENT collector (next session)
1. Plug USB-485 in → have me confirm a **live COM port** appears before Read/Write.
2. Configure via 485ToJson: SSID `Tenda_F7F5E0` (**2.4GHz**), WiFi pwd, server `161.117.46.211`, port `8098` → Write → power-cycle.
3. **Note the NEW device number** (differs from `0000028`) → update MES poller mapping so rows land under the right `machine_id` (MES id `WD250429`/`SJ03`).
4. Ask whoever brings it whether the **RS-485 adapter** is also being swapped (it was flaky).

---

## 🔑 YINDU COOKIE REFRESH (do this if machine data stops)
The Yindu poller (`backend/scripts/yindu-poller.js`) authenticates with a **session cookie** in `backend/.env` (`YINDU_COOKIE`). It stays alive while the poller runs continuously, but **dies after a long PC shutdown or a vendor server reboot**. Symptom: `backend/yindu-poller.log` shows `bad response ... session cookie may have expired`, and machine data stops updating in MES.
**To refresh (~2 min):**
1. Open the portal in Chrome: `http://161.117.46.211:8098/cm_yindu/` (login `DHOWNHOSMILLS` / `admin@123`).
2. F12 → **Network** tab → click **Fetch/XHR** → open **Loom Monitoring** so a `list?t=...` request appears.
3. Click a `list?...` row → **Cookies** tab (or **Headers → Request Headers → Cookie**).
4. Copy the **`JSESSIONID`** and **`token`** values.
5. In `backend/.env`, update the line:
   `YINDU_COOKIE=JSESSIONID=<new>; token=<new>; language=en`
6. Restart the poller: kill the running `node scripts/yindu-poller.js` (Task Manager, or `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? {$_.CommandLine -like '*yindu-poller*'} | Stop-Process -Force`), then re-launch via Desktop **"Machine Data Poller"** icon (or it auto-starts next logon).
- **Auto-login NOT implemented** — `/sys/login` exists but the password is encrypted client-side (md5/hmac) and the login request wouldn't capture cleanly; the manual refresh above is the workaround. Full auto-login needs one clean capture of the login POST payload (try Incognito with DevTools Network recording BEFORE navigating).

---

## CURRENT STATE (as of 2026-07-15 full audit)

### Overall: 87/100 (up from 56/100 on 2026-06-22)

### What changed since last HANDOFF (2026-07-11):
- **All P1 security items fixed**: PIN rate limiter, rbAC enforcement, audit middleware (real username), random JWT secret, counter-reset protection, dcApiKeyGuard
- **12 missing textile modules built**: quality inspection, attendance, shift handover, maintenance schedule, spare parts, work orders, knitting library, yarn management (GRN/issue/returns), dispatch, supplier/partner management, wastage tracking, batching/lots
- **Misc refactors DONE (5)**: analytics, charts, greige, finishing, busy-sync (commits 95239ce 68bc93a d2e086e f9568db 2377adc)
- Refactor queue total: **25+ modules extracted from server.js** — it's now 4,161 lines (down from 8,701 peak)
- **Cloudflare Tunnel + Access LIVE**: mes.dhownhosiery.com with PIN gate, /m/* and /api/public bypassed
- **Yindu poller LIVE**: SJ03 every 5s (machine OFFLINE — collector IP blocked on OEM)
- **Daily backups verified**: 7-day retention + Google Drive secondary

### Current codebase metrics:
| Metric | Value |
|---|---|
| server.js | 4,161 lines, 78 inline endpoint calls |
| Layered src/ | 25+ modules (routes/services/repositories/controllers) |
| Frontend pages | 50 |
| Frontend components | 25 |
| Frontend total | 24,041 lines |
| API endpoints | ~243 total |
| DB tables | 50+ |

---

## ▶ NEXT SESSION (priority order)

Score today: **87/100**. Remaining gaps to close:

### Quick wins (< 30 min each):
1. **Delete dead supervisors endpoints** (`server.js` ~lines 1471-1485, never used by frontend)
2. **Set `DC_API_KEY` in `.env`** — live-data ingest protection exists but dormant
3. **Delete dead `supervisors` table** — orphaned since users table took over
4. **Fix `/maintainence` route typo** → `/maintenance` (filename + App.jsx route)

### Verify old audit items (30 min):
5. **Verify Production.jsx data source** — old audit said it shows 0, check it uses correct KG rollup
6. **Verify DB indexes exist** — machine_status_log, machine_downtime, rfid_events, operator_assignments
7. **OEE quality from real QC data** — currently uses `quality_target_pct` from settings, not actual defect counts from quality_inspections

### server.js refactoring (~3-4 sessions):
8. **Remaining inline groups (~78 endpoints)** — target server.js ~2,500 lines:
   - Quality inspection (~10 endpoints)
   - Inventory reports (8)
   - Dashboard/KPIs/OEE/live/command-center (5)
   - Traceability (4)
   - Finished goods (5)
   - Opening balances (5)
   - Downtime (6)
   - Data collectors (4)
   - Warehouse/inventory/QR/work-center (5)
   - Attendance (2)
   - Shift handovers (2)
   - Backup (2)
   - Production (3)
   - Assignments (3)
   - RFID (3)
   - Machines (3)
   - Auth login/PIN/logout (3) — keep inline
   - Live data (2) — keep inline (hot path)
   - Supervisors (2) — delete instead
   - Remaining small groups

### Medium effort (1-3 days):
9. **Wire OEE quality dimension from real inspection data** — quality_inspections table has defect counts, OEE still uses settings default
10. **Pagination on list endpoints** — all return full result sets currently
11. **TV Dashboard responsive viewport** — still hardcoded 1920×1080
12. **API versioning** (`/api/v1/`)

### BLOCKED (not in our control):
13. **SJ03 collector IP fix** — OEM escalation, collector on wrong subnet (192.168.2.x vs 192.168.1.x)
14. **mes-bridge live connection** — blocked on collector
15. **Hardware sensors** (needle-break, camera) — out of scope, no hardware exists

---

## Server.js remaining inline endpoints (78 calls)

| Section | Endpoints | Status |
|---|---|---|
| Auth + helpers | verifyToken, requireRole, rate limiters, helpers | Keep inline |
| Machines | GET list, PUT :id, GET :id/details | Inline |
| Live data | GET, POST (dcApiKeyGuard) | Keep inline (hot path) |
| Assignments | GET, POST, PUT :id/release | Inline |
| RFID | GET /:tag, GET /events, POST /scan | Inline |
| Downtime | GET, POST, PUT /close, GET /open, GET /stats, PUT /reason | Inline |
| Alerts | GET | Inline |
| Dashboard | GET /kpis, /oee, /production-trend, /live, /oee/live, /command-center | Inline |
| Data collectors | POST, GET, PUT, DELETE | Inline |
| Supervisors | GET, POST | DELETE (dead code) |
| Production | GET /current, /daily, /shift | Inline |
| Attendance | GET, GET /summary | Inline |
| Machine settings | GET, PUT /:id | Inline |
| Shift handovers | GET, POST | Inline |
| Audit logs | GET | Inline |
| Auth | POST /login, /supervisor-pin, /logout | Keep inline |
| RFID scan | POST /scan | Inline |
| Backup | POST, GET /admin/backups, POST /admin/backup | Inline |
| Fabric types | mounted — layered | ✅ DONE |
| Work orders | mounted — layered | ✅ DONE |
| Spare parts | mounted — layered | ✅ DONE |
| Knitting structures | mounted — layered | ✅ DONE |
| Greige | mounted — layered | ✅ DONE |
| Batches | mounted — layered | ✅ DONE |
| Subcontract | mounted — layered | ✅ DONE |
| Finished goods | GET, GET /summary, PUT /:id/location, DELETE, PUT | Inline |
| Dispatch | mounted — layered | ✅ DONE |
| Opening balances | POST /yarn, /yarn-at-machine, /greige, /subcontract, /finished-goods | Inline |
| Warehouse | GET /overview | Inline |
| Inventory | GET /dashboard, GET /qr/:code | Inline |
| GRN | mounted — layered | ✅ DONE |
| Yarn | mounted — layered | ✅ DONE |
| Finishing | mounted — layered | ✅ DONE |
| Quality insp. | 10 endpoints (CRUD + stats + defect types + report/filter/CSV/PDF) | Inline |
| Costing helpers | getYarnRate, numOrNull, addCostEntry, callOllama/callGroq/callGLM | Keep inline |
| Costing routes | mounted — layered | ✅ DONE |
| Traceability | GET /:roll_id, /lot/:lot_number, /lot-search, / | Inline |
| Inventory reports | 8 GETs (yarn/ledger/consumption/flow/greige/knitting/dyeing/finished) | Inline |
| GST summary | POST | Inline |
| Work center stock | GET | Inline |
| WhatsApp alerts | Inline cron | Keep inline |
| Backup cron | Inline | Keep inline |
| ERP items/partners/masters | mounted — layered | ✅ DONE |
| Busy sync | mounted — layered | ✅ DONE |
| ERP stock ledger | inline | Inline |

---

## Known Bugs / Issues

| Bug | File | Status |
|---|---|---|
| OEE quality still uses settings default (100) not real defect data | server.js:1136 | Open |
| Supervisors endpoints dead code (table not used) | server.js:1471-1485 | Open — delete |
| `/maintainence` route typo | Maintainence.jsx | Open — rename |
| TV Dashboard hardcoded 1920×1080 | TVDashboard.jsx | Open |
| DC_API_KEY not set in .env | backend/.env | Open — set when DC ready |
| No pagination on any list endpoint | All GETs | Open |
| 38+ GET endpoints no auth | server.js | Open — read-only data on LAN |

---

## Security Checklist

| Item | Done? |
|---|---|
| JWT secret random 256-bit | ✅ |
| PIN rate limiting (5/5min) | ✅ |
| RBAC middleware (requireRole) | ✅ |
| Audit middleware (real username) | ✅ |
| dcApiKeyGuard on live-data | ✅ (dormant — set DC_API_KEY) |
| Counter-reset protection | ✅ |
| Delete dead supervisors code | ❌ |
| Set DC_API_KEY | ❌ |
| Review 38 unauth'd GETs on public domain | ❌ |

---

## File Locations

| File | Purpose |
|---|---|
| `backend/server.js` | 4,161 lines — remaining inline endpoints + middleware + mounts |
| `backend/src/routes/` | 25 layered route modules |
| `backend/src/services/` | Business logic per domain |
| `backend/src/repositories/` | DB queries per domain |
| `backend/src/controllers/` | Request handling per domain |
| `backend/src/middleware/audit.js` | Global audit safety net |
| `backend/scripts/yindu-poller.js` | Yindu cloud poller (SJ03 every 5s) |
| `frontend/src/pages/` | 50 React pages |
| `frontend/src/components/` | 25 shared components |
| `C:\Users\nakul\Desktop\New folder\mes-bridge` | DC integration bridge (FastAPI) |
| `C:\Users\nakul\.cloudflared` | Cloudflare tunnel config |

---

## Hard Rules

- Never give mes-bridge write access to vendor DB — read-only user only
- Never expose PostgreSQL port 5432 outside 127.0.0.1
- Test on SJ03 pilot before connecting all 18 machines
- Restart backend after any server.js change: `node server.js` in `backend/`
- Build frontend before deploying: `cd frontend && npm run build && copy build to backend/frontend/build`
### 4 quick wins DONE (2026-07-15, post-audit) — commit 13ff594
1. Deleted dead GET/POST /api/supervisors (supervisors table never existed; frontend never used them).
2. #3 (drop supervisors table) — MOOT, table did not exist.
3. Enabled DC_API_KEY in backend/.env → /api/live-data now requires x-api-key. Poller reads the same key and still posts (verified: no key→401, key→200, poller→200). Both MES + poller restarted.
4. Fixed maintenance typo: renamed Maintainence.jsx→Maintenance.jsx, dropped /maintainence route, kept /maintenance.
Security posture now: DC_API_KEY enforced (was dormant); orphan supervisors code removed. Also earlier: roll QR base URL fixed to domain + regenerated; Cloudflare /static bypass added; roll page rebranded (DHOWN HOSIERY MILLS + call/WhatsApp) + zoomed 25%.

### mes-bridge RETIRED (2026-07-15) — decision
Data collection strategy = CLOUD (Yindu poller). mes-bridge (local path: 485ToJson → local PostgreSQL CM_Data_Acquisition @192.168.2.129 → poller.py → /api/live-data) is officially RETIRED / fallback-only. It was never connected to server.js. Do NOT run or maintain it as part of the live architecture. KEEP the code/folder archived — it's the escape hatch for the cloud path's two weaknesses: (1) YINDU_COOKIE manual refresh, (2) internet-outage dependency. If cookie refresh becomes a recurring pain, revisit the local bridge. Active path = yindu-poller.js (cloud) only.

### Misc refactor — 13 of 15 groups DONE (2026-07-15, big session)
DONE: analytics, charts, greige, finishing, busy-sync, attendance(+fixed pre-existing 500), shift-handovers, backup, alerts, active-operators, audit-logs, command-center(22-query aggregate), inventory-views(warehouse/inventory-dashboard/inventory-qr/work-center — mounted around shared helpers). Commits through a2178bb. server.js now 3654 lines.
REMAINING misc (2, the hard ones — do carefully, NOT rushed):
  1. quality-report (5 endpoints: quality-defect-types, /quality-inspection-report + /filters + /csv + /pdf). ~308 lines incl a 144-line PDFDocument generator — transcribe verbatim carefully. All verifyToken+OPERATOR. PDFDocument injected (see reports mount).
  2. rfid (3 endpoints INTERLEAVED with assignments): /api/rfid/:tag (~460), /api/rfid-events (~608), /api/rfid-scan (~1889). Extract each block individually via brace-matcher; do NOT touch the assignments POST between rfid/:tag and rfid-events.
Also tiny: /api/public/roll/:rollId (~395) could move to a 'public' module (optional).

### MISC REFACTOR COMPLETE — 15/15 (2026-07-15)
All misc endpoint groups extracted to layered src/. Final two done: quality-report (5 endpoints incl PDF; commit ddcf2b6) and rfid (3 interleaved; commit 8e845c5). server.js: 3,183 lines (from ~8,700 peak / ~5,300 session start).
Bonus — 3 PRE-EXISTING bugs found & fixed while testing (all silently 500'd before):
  1. /api/attendance list — JOIN varchar operator_id = integer operator_id (cast ::text).
  2. /api/quality-inspection-report (+csv+pdf) — selected r.machine_name but rolls has none (join machines m, use m.machine_name).
  3. quality PDF export — const { PDFDocument } = require('pdfkit') was undefined ('not a constructor') -> const PDFDocument = require('pdfkit'). PDF export now works for the first time.
NEXT in refactor queue (bigger modules): quality-inspection (CRUD, ~6), downtime (~6), finished-goods (~5), opening (~5), data-collectors (~4), traceability (~4), machines+settings, assignments, dashboard, auth, production, live-data (last).

### Audit follow-ups DONE (2026-07-15) — commit bcbb2f4
1. DB indexes: operator_assignments had only PK but is hammered by LATERAL joins — added idx_oa_machine_status(machine_id,status) + idx_oa_status_assigned(status,assigned_at DESC), live + in boot ensure fn. Dropped 2 duplicate indexes (idx_downtime_machine_status, idx_status_log_machine_date). Other hot tables (machine_status_log, machine_downtime, rfid_events) already well-indexed.
2. Production.jsx — NOT a bug. today_production_kg is correctly wired (machines endpoint line 139, sums production_records for today). Shows 0 only because machines are OFFLINE (collector blocked) → real, not a data-source defect.
3. OEE quality — NOT using settings default as primary. updateOEE() computes quality = goodRolls/(good+bad) from real roll APPROVED/REJECTED status; settings quality_target_pct is fallback ONLY when 0 rolls that shift. OPTIONAL future enhancement: base quality on quality_inspections (grade/passed/defect_count) instead of roll status — needs a scoring-design decision, deferred.

### quality-inspections refactor DONE (2026-07-15) — commit bf786b0
6 CRUD+stats endpoints moved to src/routes/quality-inspections.routes.js (programmatic verbatim move; /stats before /:id preserved; pool/verifyToken/requireRole/io injected). server.js now 2,905 lines (under 3k, target ~2,500).
Refactor queue NEXT (bigger modules): downtime, finished-goods, opening, data-collectors, traceability, machines+settings, assignments, dashboard, auth, production, live-data (last).

### downtime refactor DONE (2026-07-15) — commit d922ee1
6 endpoints from 2 scattered spots moved to src/routes/downtime.routes.js (programmatic verbatim move; ?page pagination preserved; deps pool/verifyToken/requireRole/io/getShiftSettings/detectCurrentShift). server.js now 2,723 lines (target ~2,500 — close!).
Refactor queue NEXT: finished-goods, opening, data-collectors, traceability, machines+settings, assignments, dashboard, auth, production, live-data (last).

## ✅ BACKEND REFACTOR COMPLETE (2026-07-15/16)
**ZERO inline API routes left in server.js.** Every endpoint now lives in a layered module under `src/routes/` (49 route modules). server.js = **1,346 lines** of wiring/helpers/bootstrap only (was ~8,700 peak, ~5,300 at session start).

Final modules done this session: yarn, costing, users, 15 misc (analytics, charts, greige, finishing, busy-sync, attendance, shift-handovers, backup, alerts, active-operators, audit-logs, command-center, inventory-views, quality-report, rfid), quality-inspections, downtime, finished-goods, opening, data-collectors+machine-settings+assignments, traceability, machines+production+dashboard, auth, live-data, public.

### What remains IN server.js (intentionally — not routes):
imports/config/CORS/JWT, middleware (verifyToken, requireRole, dcApiKeyGuard, audit, limiters), shared helpers (nextInvSeq/nextSeq/nextDocNumber/addCostEntry/postToLedger/getYarnRate/generateQR/rollQRContent/callOllama/computeLiveStatus/updateOEE/getShiftSettings/detectCurrentShift), schema-ensure fns, backup scheduler, WhatsApp alert loop, socket.io, the 49 app.use mounts, React catch-all, server.listen.
FUTURE (optional): move those shared helpers to src/lib/ + schema to src/db/ -> server.js could drop to ~400-600 lines.

### PRE-EXISTING BUGS FOUND & FIXED while refactoring (all silently broken before):
1. /api/attendance list — varchar/integer operator_id JOIN -> 500. Fixed (::text cast).
2. /api/quality-inspection-report (+csv+pdf) — selected r.machine_name (rolls has none) -> 500. Fixed (join machines).
3. Quality PDF export — `const { PDFDocument } = require('pdfkit')` -> "not a constructor". Fixed. PDF export works for the first time.
4. /api/traceability/:roll_id — operators.operator_id(int) = rolls.operator_id(varchar) -> 500. THE WHOLE TRACEABILITY PAGE WAS BROKEN. Fixed (::text cast).
5. /api/traceability/lot-search — was shadowed by /:roll_id (registered first) -> unreachable. Fixed (/:roll_id now registered LAST).
6. operator_assignments had only a PK despite heavy LATERAL joins -> added idx_oa_machine_status + idx_oa_status_assigned (also in boot ensure fn); dropped 2 duplicate indexes.
7. live-data POST used computeLiveStatus (missed by dep scan) -> ReferenceError. Injected; then audited ALL modules vs every server.js function+const helper: all clean.

### Verification
Full smoke test: 20+ endpoints across every module -> all 200. Real login test (temp user created, logged in -> valid JWT, user deleted). Yindu poller still ingesting -> MES 200. QR path 200 via mes.dhownhosiery.com.

### MOBILE APP = PWA (2026-07-16) — commit d0f6d6d
Decision: PWA (installable web app), NOT React Native/Capacitor. Rationale: app already served over HTTPS at mes.dhownhosiery.com with mobile pages (MobileRoll/MobileQC); PWA = home-screen icon, no app store, no APK redistribution, updates on rebuild.
Added: public/manifest.json (standalone, theme #081426, shortcuts Scan//rfid, QC//m/qc, Machines//machines); real icons 192/512 + maskable (generated from the 1024 logo via pngjs box-filter — 21KB/112KB); public/service-worker.js; SW registration in src/index.js (production+HTTPS only).
SW CACHING RULE (important): app shell ONLY (index.html + content-hashed /static + icons). **/api/* and /socket.io are NEVER cached** — stale factory data is worse than none. Navigations network-first w/ offline shell fallback. Never caches redirected/cross-origin responses (prevents caching a Cloudflare Access 302).
BUG FIXED: index.html had NO viewport meta → phones reported ~980px → App.css @media(max-width:768px) mobile layout (mobile-topbar/mobile-drawer vs desktop-sidebar) NEVER fired. The mobile design existed but was dead on every phone. Added width=device-width + dropped 120% base font to 100% on phones.

HOW TO INSTALL (supervisors): open https://mes.dhownhosiery.com in Chrome on the phone → pass the Cloudflare email PIN → log in → Chrome menu → "Add to Home Screen"/"Install app" → DHOWN MES icon appears.
NOTE: root-level PWA files (/manifest.json, /service-worker.js, /icon-*.png) are behind the Cloudflare Access gate, so they 302 for unauthenticated visitors. Authenticated users are unaffected. Scan-only users on /m/roll still work fine (page + /static + /api/public are bypassed) but can't "install" — if you ever want install from the public scan page, add /manifest.json, /service-worker.js and /icon- to the MOBILE SCAN bypass app in Cloudflare (it currently has /m, /api/public, /static; max 5 destinations per app).
TODO (optional, not done): desktop-oriented data-entry pages (production/rolls) aren't mobile-optimised — only needed if operators must enter data on phones.

### DECISION: do NOT bypass PWA files in Cloudflare (2026-07-16)
Considered adding /manifest.json + /service-worker.js + /icon- to the MOBILE SCAN bypass so scan-only (non-Access) users could install the PWA icon. DECIDED: SKIP. Rationale: QR scanning already works for them (page + /static + /api/public are bypassed) — an icon adds nothing when you arrive by scanning a code, and /m/roll needs a roll id so there's no useful landing page. Keeps attack surface smaller. Supervisors (who pass the Access gate) can already install.
REVISIT ONLY IF: floor staff start using /m/qc as a daily tap-to-open tool — then add those 3 paths to the MOBILE SCAN bypass app (2-min change; it has 3 of 5 destinations used).

### src/lib REFACTOR DONE (2026-07-16) — commit e756f2f
All 29 shared helpers extracted verbatim out of server.js. Signatures unchanged, so server.js still injects them into the mounts and the 49 route modules were NOT touched.
  src/db/schema.js        — seedDefaultAdmin, ensure{ProductionHistory,Maintenance,Users}Schema
  src/middleware/auth.js  — verifyToken, requireRole, dcApiKeyGuard, JWT_SECRET, JWT_EXPIRES, ROLE_HIERARCHY, loginLimiter, pinLimiter
  src/middleware/audit.js — (pre-existing)
  src/lib/shift.js        — getShiftSettings, parseHHMM, detectCurrentShift
  src/lib/machine.js      — computeLiveStatus, updateOEE (updateOEE still takes pool as 1st arg)
  src/lib/sequences.js    — nextSeq, nextInvSeq, nextDocNumber
  src/lib/costing.js      — getYarnRate, numOrNull, addCostEntry, postToLedger (addCostEntry/postToLedger take an open client)
  src/lib/qr.js           — generateQR, rollQRContent
  src/lib/ai.js           — callGroq, callOllama
  src/lib/alerts.js       — getSupervisorMobile, sendWhatsAppAlert, checkMachineAlerts + CALLMEBOT_APIKEY/ALERT_COOLDOWN_MS/machineAlertState
  src/lib/backup.js       — runDailyBackup, scheduleDailyBackup + BACKUP_DIR
Dead code removed (orphaned by the route refactor): MACHINE_SORT_SQL, FRONTEND_ORIGIN, and unused requires (bcrypt, jwt, rateLimit, exec, QRCode).
Pool: modules require ../../config/database directly (config/database.js already existed).

**server.js = 771 lines** (from 1,346 → 771; ~8,700 at peak). It is now: dotenv/pool/requires, CORS+json+audit+static, socket.io, PG_BIN, 50 app.use mounts, React catch-all, DC:8090 + HTTPS:4443 servers, server.listen bootstrap. Nothing else.

GOTCHA for future scripted edits: server.js has CRLF line endings — regexes anchored with `$` won't match after `;` (there's a trailing \r). Use .trim() comparisons.
Verified: clean boot; smoke test of every helper path all 200; live-data ingest 200 + poller still posting; REAL login -> valid JWT (temp user created + deleted, 0 leftover).

## 📋 POST-GO-LIVE BACKLOG — missing features (identified 2026-07-21)
Verified by checking doc_series, DB tables, route modules (49) and pages (49). No broken/orphan pages found; GST report works (served by reports.routes.js as /api/reports/gst-summary). These are genuine absences, NOT bugs. **Deliberately NOT built before the Aug 1 inventory cutover** — adding modules days before a go-live is how go-lives get derailed.

### 1. Purchase Orders — HIGHEST VALUE GAP
`PO` series already exists in doc_series, but there is NO purchase_orders table, module, or page.
Impact: GRN records yarn receipt with nothing to match against — no "ordered vs received vs rate agreed" check, no pending-PO view, no supplier price accountability. Most defensible gap now that real yarn stock is being loaded.
Build: purchase_orders + purchase_order_items tables; PO CRUD module (follow the layered pattern in src/routes/); link grn.po_id; show variance (ordered qty/rate vs received qty/rate) on GRN.

### 2. Sales / Customer Orders
No table/module/page. Dispatch happens with no order to fulfil — no order book, no pending-order or partial-fulfilment view.
Lower priority IF orders arrive by phone/WhatsApp (common at this scale). Raise priority if customers start expecting order acknowledgements/backorder tracking.

### 3. Production planning / scheduling
Nothing exists. No "what should each machine run next" — allocation is verbal. Would pair with knitting_structures (machine settings per fabric already exist) + sales orders to auto-suggest machine assignment.

### 4. Wages / payroll
operator_attendance captures scans (clock_in/last_seen/scan_count) but never converts to wages/piece-rate. No wages/payroll table. Note: attendance only populates via RFID scan, which isn't deployed — so this is blocked behind RFID anyway.

### 5. Tax invoice document
GST *report* exists (input/output summary). No GST tax-invoice print. USER EXPLICITLY DEFERRED THIS EARLIER ("well skip gst invoice") — listed only for completeness.

### Built but blocked on hardware (not missing code)
- RFID (65/100) — endpoints + events page work; hardware not deployed; operators assigned MANUALLY for now (user's decision, correct call).
- DC integration (20/100) — cloud poller live; collector stranded on a WiFi network that no longer exists (see WiFi diagnosis below).

## 🔌 COLLECTOR ROOT CAUSE FOUND (2026-07-21) — it's WiFi, not IP
Chased this as an "IP problem" for days. It is NOT. Diagnosis:
- Collector screen says "connected to Tenda" — but that is a REMEMBERED SSID, not a live connection.
- `netsh wlan show networks mode=bssid` on both bands shows NO Tenda SSID exists anymore. Only: Airtel_Zerotouch (2.4GHz) + Airtel_Zerotouch_5G (5GHz) — both BSSID prefix 90:67:17, i.e. the Alphion router broadcasting both bands itself — plus neighbours (Airtel_suni_4045, Kanav, 1 hidden).
- No Tenda-style gateway responds: 192.168.0.1 / 192.168.0.254 / 192.168.2.1 all unreachable.
- Full ARP sweep of 192.168.1.0/24 → 21 devices (router .1, NVR .2, ~9 CCTV cameras, 3 wireless bridges .15/.200/.201, 2 PCs, ~6 phones). **Collector absent.**
- Cloud still reports WD250429 status=3 (OFFLINE), rpm=null, rev=0 — while `work_time` shows a CURRENT timestamp, proving the Yindu cloud is alive and it is specifically the collector not checking in.
CONCLUSION: the collector is trying to join a WiFi network that no longer transmits. It never gets an IP, so it can never reach the cloud.
CORRECTION to earlier notes: 192.168.2.129 was the PostgreSQL host in 485ToJsonWrite.exe.config (the PC running that local software), NOT the collector's address. The collector uses a DYNAMIC IP — which is fine and correct; nothing on our side ever dials it by IP (it pushes outbound to the cloud, we poll the cloud). Stop chasing its IP.
MESSAGE FOR OEM: "Our WiFi changed. The old Tenda AP is gone — a scan shows no Tenda SSID on 2.4 or 5 GHz. The collector still has the Tenda network saved so it never connects. Please reconfigure the collector's WiFi to SSID `Airtel_Zerotouch` (2.4GHz, WPA2) — preferred, better wall/machinery penetration — or `Airtel_Zerotouch_5G`, set to DHCP."
FASTER ALTERNATIVE: if the physical Tenda unit still exists, re-configure IT with the old SSID+password — the collector would reconnect with NO change to the collector at all.
485ToJsonWrite install path (ClickOnce, launch from Start menu only): C:\Users\nakul\AppData\Local\Apps\2.0\B61Y6ZBQ.HM0\PLVJAGYH.73G\485t..tion_309f066565cb010a_0001.0000_47aaa5f8d56d81ac\485ToJsonWrite.exe

## Utilization metric — BUSINESS RULE (2026-07-21)
utilization_pct = running / (total - no_data - in_downtime). Both exclusions are deliberate:
- no_data: no collector reporting at all — can't claim a machine was idle when we never heard from it.
- in_downtime: FLOOR RULE from owner — a machine under an open downtime record was not available to run, so it must not count against utilization. Downtime is tracked separately (downtime reports + OEE availability).
Response also exposes `available_machines` so the denominator is visible. Commits bdd6ca7 (no_data) + 9453a04 (downtime).
CAUTION: two OTHER "utilization" figures exist and were left unchanged — reports.routes.js uses AVG(oee.availability) (time-based per machine), and /api/utilization uses run_minutes/planned_minutes from machine_status_log. They will legitimately differ from the dashboard KPI. Decide before someone asks why.
