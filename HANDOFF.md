# DHOWN MES — HANDOFF
*Last updated: 2026-07-06 (Quality inspection reporting and printing implemented)*

## ▶ NEXT SESSION — WEDNESDAY (priority order, all non-DC)
Score today: **90/100**. Remaining non-DC gaps, do in this order:
0. **FIRST: Paradise REPORTS review (formats only, NO data migration)** — walk Paradise (via UltraViewer) through **Knitting Section**, **Dyeing Section**, **Mini Accounts** report menus. Replicate the report FORMATS/LOGIC in MES running on MES's own clean data. **Do NOT import Paradise historical data** — it has negative stock values and no production history (user's explicit call). No DB password needed. User drives screens; I capture layouts + build matching reports.
1. **JWT secret fix** — ✅ DONE (security, ~5 min). backend `.env` updated with cryptographically random 256-bit value.
2. **QC / defect module** — ✅ COMPLETED (Quality&Traceability 85→95): QC inspection module fully implemented with DB schema, REST APIs, and complete UI. Includes: quality_inspections table, roll grading (A/B/C/Reject), defect tracking, inspection stats, inspection list/create/edit UI, navigation integration, responsive design, PLUS quality inspection reporting page with filters, CSV export, PDF export, and print functionality.
3. **Maintenance completion + spares** (60): close/complete work orders, spare-parts, per-machine history.
4. **Paradise reports** — Party Ledger + Item/Stock Register (user exporting Excels from eParadise SS22 to match formats).
5. Decide: Mobile app (0) — build vs responsive web. RFID (60) needs hardware.
Also ready-to-do while DC pending: counter-reset protection + API-key auth on port-8090 `/api/live-data` (P1-02, P1-11).


---

## Completed 2026-07-05 — Paradise navigator pattern rolled out

### Pattern (reference: reproduce this on any new document screen)
Every transaction screen = **navigator + inline entry** (NO popup modal):
- Navigator bar: green **+ Add** button, **List View** dropdown (searchable), record position (n/total), **First / Previous / Next / Last**
- Document card: centered title, fixed **4-col header field grid**, fixed **items grid** (padded to ~6 blank rows so every doc is same size) + TOTAL row, bottom **button strip** (Add · Edit · Delete · Approve · Print etc.)
- **+ Add turns the SAME card into the inline entry form** (header fields become inputs, items grid editable) → Save / Cancel inline. No modal.
- Auto-open latest record on load. `+ Add` button lives IN the navigator bar so it works even when the list is empty.

### Screens converted
- **GRN** (`GRN.jsx`) — inline entry; added backend `DELETE /api/grn/:id/lots/:lotId` (DRAFT only) for inline row edit. Edit/Delete always in strip.
- **Yarn Issue** (`YarnIssue.jsx`) — inline entry + **tab toggle: Yarn Issues | Yarn Returns**. Returns is its OWN navigator (separate documents).
- **Dispatch** (`Dispatch.jsx`) — inline entry; type tabs All/FG/Greige/Yarn filter the navigator.
- **Subcontracting** (`Subcontracting.jsx`) — **5 process tabs**: Knitting / Dyeing / Finishing / Dyeing+Finishing / Returns. Each challan tab = own navigator filtered by job_type; + Add presets job_type (Knitting tab has Outsource vs Job Work sub-picker). **Returns tab split per process** (Dyeing/Finishing/Dye+Finish/Knitting receipts) with Outstanding + Received sections. Removed Vendor Invoices & Analytics tabs. Create form now INLINE (was modal). Default tab = 'DYEING'. Gotcha fixed: main div `minHeight:100vh` pushed inline form off-screen → now `minHeight: showCreate ? 'auto' : '100vh'`.

### Yarn Returns = real documents (NEW)
- Tables `yarn_returns` + `yarn_return_items`. Endpoints: GET/POST `/api/yarn-returns`, GET `/api/yarn-returns/:id`.
- Return number `YR-YYYY-NNNN`. Applies same stock reversal as old return button (puts kg back, bumps returned_kg, logs RETURN movement) but now records a numbered doc.

### Dispatch audit-trail fix
- YARN dispatch now writes a `DISPATCH` row to `yarn_lot_movements` (was missing — stock zeroed but no ledger row). GRN/Issue/Return already logged.

### HARD PROOF run (then cleaned up): inventory chain balances to the kg
100 received → 60 issued → 15 returned → 55 dispatched → 0 left. Movement ledger chains before→after cleanly. All proof data (PROOF SUPPLIER/BUYER) deleted after.

### Sidebar regrouped (ERP standard: Masters → Transactions → Reports)
- **TRANSACTIONS**: GRN, Yarn Issue, Dye House, Finishing & QA, Dispatch
- **INVENTORY**: Live Inventory, Yarn Store, Greige & Lots, Finished Goods, Traceability, Costing, GST Report, Opening Balances
- Routes unchanged, only menu grouping. `Sidebar.jsx` NAV_GROUPS.

### Paradise (eParadise SS22) — data access
Access DB password-protected (no pwd, do NOT crack). Get data via Paradise "Export to Excel" or ePradise support (7888596534). User will export report Excels → match MES reports to them (Party Ledger, Item Balance/Stock Register formats captured earlier).

---

## Earlier: 2026-07-04 night (SC challan system full revamp: multi-fabric lots, document navigator, new receive flow)

---

## Completed 2026-07-04 (night session — SC challan system revamp)

### ✅ Multi-fabric greige lots
- One lot can hold multiple fabrics (body + rib + collar/cuffs from same yarn, dyed together for shade match)
- `refreshBatchFabric()` keeps batches.fabric_type = joined label ("Rib + Fleece")
- GET /api/batches (+detail) returns `fabric_breakdown` [{fabric_type, kg, rolls}]
- Greige page shows per-fabric chips on selection, lot cards, and detail

### ✅ Challan creation form — row-based (like Yarn Issue)
- Rows: Fabric (dropdown) → Lot No (dropdown filtered by fabric, shows kg) → Colour (text) → Rolls/Weight auto
- Multiple lots per challan via new table `subcontract_challan_items`
- POST /api/subcontract/challans accepts `items[]`; detail returns `fabric_items`
- Whole lot goes SENT when any fabric of it is sent (travels together)

### ✅ Challan document navigator (legacy Paradise style)
- Challans tab shows ONE challan at a time: standard 4x2 header grid, fixed items table
  (min 6 rows, Sr|Item|Colour|Lot|Rolls|Qty), receipts table, bottom button strip
- Navigator: List View dropdown + Previous/Next/Move Last + record position
- Latest challan auto-opens

### ✅ Standalone Receive Back form (header button)
- Dyeing-only: fabric-wise received weights (no roll IDs — dyed fabric goes back out for finishing)
- Finishing/D+F: one row per received roll, NEW roll ID generated per row
  (`SC-2026-001-R001`), FG entry per line — old roll IDs die in the wet process
- Receipts are FINAL by default (process loss is normal); `is_partial` checkbox keeps challan open
- Table `subcontract_receipt_items` (+ legacy cols: depth, roll_count, rate_per_kg, amount, process — added, not yet used in UI)
- DYED lots show dyeing-received weights (not greige) in lot dropdown AND when creating finishing challan

### ✅ Prints
- SC Challan print = consolidated fabric-wise lines (Fabric|Lot|Colour|HSN|Rolls|Total Wt)
- New PACKING_LIST print = roll-wise exact weights grouped by fabric with subtotals
- Fixed challan detail 500 (`c.vendor_id` join removed); added color_name col to subcontract_challans

### ✅ Other (same day, earlier)
- Traceability by yarn lot no (toggle Roll/Lot, /api/traceability/lot/:lot_number)
- Reports merged 12→8 (removed daily-summary, shift-handover, rfid, assignments cards)
- Fixed 500s: reports/shifts (oa.shift), reports/operators (varchar vs int cast)
- Sticky sidebar + accordion sections
- Work Center Stock: live machine status + WIP vs real-shortage logic (shortage only after weigh-back)
- Machine status: dc_id present + no data = OFFLINE else NO_DATA (all 9 queries); cleared stale dc_ids (only SJ03 has real collector WD250429)
- Deleted test data: GRN-2026-001, operators/assignments, production records

## Paradise reference (viewed via UltraViewer 2026-07-04/05)
- Access-based (VB6), data at `D:\ParadiseStock\data\SS22` — **password protected, no password**.
  Do NOT crack. Get data via Paradise's own "Export to Excel" (on ledger/report screens) or from ePradise support (7888596534). User will export report Excels and send.
- App is single-user, crashes easily (runtime error 91 on ledger refresh) — reason to replace.
- Mini Accounts menu reports seen: Despatch Challan (sale), Recept (incoming), Debit/Credit Voucher,
  Payment Register, Ledger (A/c), Party A/c With Qnty, Ledger (A/c MonthWise), Party Balance (A/c),
  Party Ledger (Stock), Sale Day Book, Stock Register (sale), Sale Register, Item Balance,
  Challan Receipts, Stock For Despatch, Order Vs Sale.
- Party Ledger (Stock) columns: Date | Tno/Ch | Particulars | LotNo | Shade | Rolls | Issue | Receipts | Balance + Report/Summery/Export-to-Excel buttons.
- Item Balance report: Item Name | Code | Shade | type(Y/F) | Balance | pcs | Group + Total, filters Fabric/Yarn/Both + Shade/Lot/Shade+Lot wise.

### GRN / Receipts Entry navigator (DESIGN APPROVED — build in MES theme)
Paradise "Receipts Entry" screen = the target GRN navigator layout:
- Header: Trno (+ List View), Date, Party Name (+code), City, Vehicle, Terms, Broker
- Grid: Sr | Icode | Item Name | Shade | Lot No | Rolls | Qnty | Rate | Amount (blank-padded rows, fixed size)
- Total bar: Qnty total + Amount total
- Buttons: Add · Save · Edit · Delete · First · Previous · Next · Last · Print · Exit
- **CHANGES from Paradise**: Item Name/Icode come from OUR MES Item Master (not Paradise codes);
  REMOVE "Copy From Dyeing Receipts" (dead button). Item/Lot/Rolls link to real production.

## NEXT TASK (Monday): Copy Paradise UI pattern across the whole ERP
User will provide Paradise software screenshots. Goal: staff must never scroll through
100s of records — everything is document/record-navigation style.

1. **Document navigator** (List View + Previous/Next/Move Last + standard field grid +
   fixed items table + bottom button strip) — for transactional documents:
   GRN, Yarn Issue, Dispatch, Finished Goods receipts. (SC Challans done — pattern
   reference: `frontend/src/pages/Subcontracting.jsx` challans tab.)
2. **Register style** (pick date range / machine / operator → one fixed report page,
   totals at bottom, no scrolling list) — for high-volume logs:
   - Rolls → Roll Register (date + machine + shift, with kg totals)
   - RFID Events → Scan Register (date + operator/machine)
   - Assignments → Assignment Register (date/shift, durations)
   - Downtime → Downtime Register
3. **Ledgers** — copy Paradise report formats:
   - **Party Ledger** — per-vendor/customer: challans out, receipts in, running balance
   - **Item Ledger / Stock Register** — per yarn/fabric item: in-out movements, running stock
4. Leave as-is: Machines, Dashboard, Work Center Stock (fixed 18 machines), Masters.

---

## Current Milestone

**ERP Phase complete — all core workflows live in PAPER mode**
Next focus: costing activation (fill Item Master rates) + roll creation fabric link + SC invoice UI

---

## Completed This Session (2026-07-02)

### ERP Workflows
- ✅ GRN — date filter + CSV export (fixed count query alias bug)
- ✅ Dispatch — date filter + CSV export
- ✅ Subcontracting — date filter + CSV + vendor invoice fields (vendor_invoice_no, vendor_bill_amount)
- ✅ Yarn Store — low-stock alert banner (threshold: 20% default, configurable)
- ✅ Busy 21 sync — Settings → Busy Sync tab, GRN + Dispatch CSV date-range download (ADMIN only)

### Costing Engine (fully redesigned)
- ✅ FIFO yarn cost: at yarn issue time, lot's own GRN rate_per_kg used → YARN_COST entry
- ✅ Also writes YARN_COST at GRN lot creation (baseline cost record per lot)
- ✅ Knitting rate moved from Rate Master → Item Master (knitting_rate_per_kg + standard_loss_pct columns)
- ✅ Roll approval writes KNITTING_COST from item's knitting_rate_per_kg
- ✅ Knitting Variance tab in Costing page — standard 1% vs actual, per machine per day, CSV export
- ✅ DB migration run: items.knitting_rate_per_kg, items.standard_loss_pct, rolls.fabric_item_id

### AI Assistant
- ✅ Groq API wired in (llama-3.3-70b-versatile) — replaced Ollama
- ✅ GROQ_API_KEY + GROQ_MODEL in .env
- ✅ callOllama → callGroq (backward-compat alias kept)
- ✅ Costing AI assistant now says "Powered by Groq"

### SC Invoice Matching
- ✅ Backend: PUT /api/subcontract/receipts/:id/invoice, GET /api/subcontract/invoices-pending
- ✅ DB migration: vendor_invoice_no, vendor_bill_amount, payment_status on subcontract_receipts

---

## Completed 2026-07-02 (later session)

### ✅ P-02: fabric_item_id auto-link on roll creation
No operator input needed — backend auto-resolves `fabric_item_id` at roll creation by
matching the machine's `fabric_code` (Settings → Machine Configuration) against
`items.item_code`. Roll approval then posts KNITTING_COST automatically.
Files: `backend/server.js` (POST /api/rolls).

### ✅ P-03: SC Invoice matching UI
Subcontracting page now has two tabs: **Challans** | **Vendor Invoices**.
Vendor Invoices tab shows: KPIs (pending count, total expected, total billed) +
table with Challan | Vendor | Received Date | Wt | Rate/kg | Expected ₹ |
Invoice No. | Billed ₹ | Variance | Status | Mark PAID button.
Backend: PUT /api/subcontract/receipts/:id/invoice, GET /api/subcontract/invoices-pending.

### ✅ P-05: Cost-per-kg on Finished Goods
FG table has Total Cost and ₹/kg columns (aggregates cost_entries: roll-level
YARN_COST/KNITTING_COST via batch_rolls + batch-level WASTAGE/JOBWORK).
Summary shows Total Stock Value and Avg Cost/kg KPIs when cost data exists.
Files: `backend/server.js` (GET /api/finished-goods + /summary), `frontend/src/pages/FinishedGoods.jsx`.

---

## ✅ COSTING CHAIN IS LIVE (verified 2026-07-02 night)

- P-01 DONE: user filled knitting rates for all 10 fabric items (₹12–30/kg, std loss 1%)
- All 18 machines verified linked to items with rates (machine.fabric_code → items.item_code)
- Fixed Item Master save bug: empty strings in numeric fabric-attr fields (gsm, width,
  gauge, dia, feeders, stitch length) crashed Postgres — added `numOrNull()` sanitizer
  in both POST and PUT /api/erp/items (server.js ~line 5348)
- cost_entries is empty — costs post only on NEW transactions from here on:
  - New GRN lot (rate/kg entered) → YARN_COST at purchase rate
  - Yarn issue → YARN_COST at that lot's FIFO rate
  - Roll approval → KNITTING_COST at machine's fabric rate
  - SC receipt → JOBWORK + WASTAGE
- ⚠ Old yarn lots in store have NO rate_per_kg — issues from old stock post no yarn cost.
  Only new GRNs (with rate entered) feed FIFO.
- First roll approval is the proof — check Costing → Dashboard for the KNITTING_COST entry.

### ✅ RFID → Assignment → Machine Status Binding (2026-07-02 night)
Operator assignment (via RFID scan or manual) now makes machine show as **RUNNING**
even without a data collector. All 7 `live_status` queries updated with
`operator_assignments` join — assignment-based RUNNING takes priority over NO_DATA/OFFLINE,
but DOWNTIME still overrides everything.
- Dashboard MachineCard shows assigned operator name
- Machines table has new "Operator" column
- Roll weight + downtime already work manually (existing features)
Files: `backend/server.js` (all GET /api/machines, /details, /alerts, /production/current,
/dashboard/live, /reports/machine-performance), `frontend/src/pages/Machines.jsx`,
`frontend/src/pages/Dashboard.jsx`, `frontend/src/components/MachineCard.jsx`.

## Completed 2026-07-02 (late night session)

### ✅ Edit / Delete / Cancel on ALL stock entry points
- GRN: Edit (DRAFT), Delete (DRAFT, hard), Cancel (APPROVED→CANCELLED)
- Rolls: Edit (OPEN), Delete (OPEN), Cancel (not if SENT_OUT/DISPATCHED)
- Yarn Issues: Delete (hard, reverses stock), Cancel (soft, reverses stock), Edit (notes/received_by)
- SC Challans: Delete (hard, reverses batch/rolls/yarn), Cancel (soft, reverses), Edit (SENT: vendor/rate/dates/notes)
- Finished Goods: Edit (weight/fabric/color/location/notes), Delete (not DISPATCHED)
- Helper: `reverseYarnIssueStock(client, issue_id)` for DRY stock reversal

### ✅ GRN Form Revamp
- Supplier Name → dropdown from Business Partners API
- Removed LR/Bilty No and Vehicle Number
- Lot columns: Yarn Type | Lot No | Brand | Boxes/Bags | Weight | Rate | Value
- `brand` column added to yarn_lots table

### ✅ Opening Balances Revamp
- All 5 tabs rewritten with multi-row table entry (add/remove rows, save all)
- Yarn Store: Yarn Type (Item Master dropdown) | Lot No | Brand | Boxes/Bags | Weight | Rate | Value — no vendor
- Yarn at Work Centers: Machine + same as Yarn Store
- Greige: Fabric Type (dropdown) | Weight | Value — generic auto roll ID (no machine needed)
- Subcontracting: Process Type (Dyeing/Finishing/Outsource Knitting) | Vendor | Fabric Type | Weight | Sent Date | Rate | Value
- Finished Goods: Fabric Type | Colour | Lot No | Weight | Value
- Rate ↔ Value auto-calculate each other
- DB: yarn_lots.grn_id made nullable, finished_goods.lot_no added, subcontract_challans.vendor_name made nullable

---

## Completed 2026-07-04 (Subcontracting gap-closing)

### ✅ SC Rate Auto-fill
Challan creation auto-fills rate_per_kg from last challan for same vendor+job_type.
Vendor name `onBlur` triggers lookup. Operator can override.
Backend: GET /api/subcontract/last-rate. Frontend: Subcontracting.jsx `autoFillRate()`.

### ✅ SC Wastage Calculation Display
Receipt detail panel now shows wastage % = (sent - received) / sent × 100.
Green/red indicator with 2% tolerance threshold. No separate wastage master.
Backend: GET /api/subcontract/wastage-summary.

### ✅ SC Overdue Alerts on Dashboard
Red banner on Dashboard when challans are past expected_return_date.
Shows up to 5 overdue challans as chips. Hidden when none overdue.
Backend: GET /api/subcontract/overdue-alerts. Frontend: Dashboard.jsx `OverdueSCAlert`.

### ✅ SC Analytics Tab
New 4th tab on Subcontracting page: vendor performance table, wastage by vendor cards
with progress bars, monthly trend (last 12 months).
Backend: GET /api/subcontract/analytics.

### ✅ Multi-process Chaining (Dyeing → Finishing)
"Forward to Finishing" button on RECEIVED+DYEING challans. Creates new FINISHING challan,
updates batch status, posts JOBWORK_FINISHING cost entry.
Backend: POST /api/subcontract/challans/:id/forward.
DB: `forwarded_from_challan_id` column on subcontract_challans.

---

## Next Task — 2026-07-04 (FORM REVAMPS)

**Revamp these forms to match the same column consistency as GRN was revamped:**

### 1. Yarn Issue Form Revamp
- File: `frontend/src/pages/YarnIssue.jsx`
- Review current form fields, align columns with what user expects
- Ensure lot selection shows: Yarn Type | Lot No | Brand | Available Stock
- Ask user what exact columns they want in the issue form

### 2. Subcontracting Form Revamp
- File: `frontend/src/pages/Subcontracting.jsx`
- Current challan creation form needs review
- Must support Dyeing / Finishing / Outsource Knitting process types
- Ask user what exact columns they want

### 3. Finished Goods Received Form Revamp
- File: `frontend/src/pages/FinishedGoods.jsx` (or SC receipt flow)
- Review the "receive back" flow from subcontracting
- Columns: Fabric Type | Colour | Lot No | Weight | Value
- Align with Opening Balances FG tab

### 4. Update Opening Balances to match
- File: `frontend/src/pages/OpeningBalances.jsx`
- After forms 1-3 are revamped, ensure Opening Balances tabs match exactly

**Important:** Ask user for exact column requirements for each form before implementing.

---

### P-04: DC integration — BLOCKED (waiting for engineer)
- P1-02: API key auth on port 8090 DC endpoint
- P1-11: Counter-reset protection in POST /api/live-data
- SJ03 pilot: 485ToJsonWrite → mes-bridge → /api/live-data
- Do NOT start until engineer is on-site

### SKIPPED: Busy sync SC jobwork CSV — not needed for now

### ✅ Optional dev tasks — ALL DONE (2026-07-02 night)
- ✅ Paid-invoices history: Vendor Invoices tab now has Pending / Paid / All filter
  (backend: ?status=pending|paid|all on /api/subcontract/invoices-pending)
- ✅ Cost snapshots: already write at dispatch time (no cron needed) — trend chart
  on Costing Dashboard reads them
- ✅ AI variance questions: 3 new quick questions; /api/costing/ask context now
  includes Item Master knitting rates + per-machine yarn-in vs fabric-out (30 days)
- ✅ Print button on Knitting Variance tab (printable report with totals)
- ✅ GST report: dispatch pricing (optional rate_per_kg + gst_rate per line) +
  GST Report page at /gst-report. Output GST from priced dispatches, input GST
  from GRN yarn purchases, net payable. Print button. Migration: dispatch_items
  gets rate/gst/taxable/total cols, dispatch_challans gets totals.
  PrintChallan updated: shows commercial format when lines are priced.

---

## Priority List

| Priority | Task | Effort |
|---|---|---|
| ✅ DONE | Fill knitting_rate_per_kg in Item Master (10 fabrics) | done 2026-07-02 |
| ✅ DONE | Item Master save bug (empty numeric → Postgres error) | fixed 2026-07-02 |
| ✅ DONE | Wire fabric_item_id into roll creation (auto from machine fabric_code) | done 2026-07-02 |
| ✅ DONE | SC invoice matching UI | done 2026-07-02 |
| ✅ DONE | Cost-per-kg display on FG lots | done 2026-07-02 |
| ⏸ SKIP | Busy sync SC jobwork CSV | skipped for now |
| 🔵 BLOCKED | DC integration (P1-02, P1-11, SJ03 pilot) | waiting for engineer |

---

## Known Bugs (open)

| Bug | File | Status |
|---|---|---|
| DC endpoint port 8090 has no auth | server.js | Pending P1-02 |
| Counter reset inflates production | server.js | Pending P1-11 |
| ~~Rate Master tab~~ removed — FIFO handles yarn costing now | Costing.jsx | ✅ Done |
| BOM module (bom_lines table + CRUD + UI in Item Master) | server.js, ItemMaster.jsx | ✅ Done |
| BOM Variance tab in Costing (std vs actual by yarn type) | server.js, Costing.jsx | ✅ Done |
| Yarn Return UI on Yarn Issue detail page | YarnIssue.jsx | ✅ Done |

---

## Production Flow (correct order)

```
GRN → Yarn lots received into store
  ↓
Yarn Issue → Yarn issued to machine/work center (BOM defines which yarns & ratios per fabric)
  ↓
Machine Knitting → Machine produces greige fabric rolls from issued yarn
  ↓
Roll Open → Roll created on machine (auto-links fabric_item_id from machine config)
  ↓
Roll Weigh + Approve → Actual weight entered, roll approved → greige fabric recorded
  ↓
SC Send → Greige sent for dyeing/finishing (subcontracting)
  ↓
SC Receive → Finished goods created
  ↓
Dispatch → FG dispatched to customer
```

## Architecture — Costing Logic

```
GRN → yarn_lot created → YARN_COST entry (lot rate × net kg)
         ↓
    Yarn Issue to machine → YARN_COST entry (lot FIFO rate × issued kg)  [deducts from lot]
         ↓
    Machine knits → Roll Approved → KNITTING_COST entry (item.knitting_rate_per_kg × fabric kg)
         ↓
    SC Dyeing/Finishing → JOBWORK_DYEING / JOBWORK_FINISHING (SC receipt × kg)
         ↓
    cost_entries table → Costing Dashboard sums by reference
```

Knitting variance = (yarn_issued_kg − fabric_out_kg) per machine per day vs standard 1% loss.

BOM (bom_lines table): each fabric item links to 1+ yarn items with percentage (must total 100%).
Used at yarn issue time to know which yarns a machine's fabric requires.

---

## Key File Locations

| File | Purpose |
|---|---|
| `backend/server.js` | All API endpoints |
| `backend/.env` | DB, JWT, Groq API key |
| `backend/migration_knitting_rate.js` | Adds knitting cols to items + fabric_item_id to rolls |
| `backend/migration_sc_invoice_lowstock.js` | Vendor invoice fields on SC receipts |
| `frontend/src/pages/Costing.jsx` | Costing dashboard + Knitting Variance + Groq AI |
| `frontend/src/pages/ItemMaster.jsx` | Now has knitting_rate_per_kg + standard_loss_pct fields |
| `frontend/src/pages/Settings.jsx` | Busy Sync tab (ADMIN) |
| `frontend/src/pages/YarnStore.jsx` | Low-stock alert banner |
| `frontend/src/pages/GRN.jsx` | Date filter + CSV |
| `frontend/src/pages/Dispatch.jsx` | Date filter + CSV + optional pricing (rate/GST) |
| `frontend/src/pages/GSTReport.jsx` | GST summary: output vs input, print |
| `frontend/src/components/PrintChallan.jsx` | Challan print — commercial format when priced |
| `backend/migration_dispatch_pricing.js` | Pricing cols on dispatch_items + dispatch_challans |
| `frontend/src/pages/Subcontracting.jsx` | Date filter + CSV + vendor invoice fields |
| `C:\Users\nakul\Desktop\New folder\mes-bridge\` | DC integration bridge |

---

## Hard Rules

- Never give mes-bridge write access to vendor DB — read-only user only
- Never expose PostgreSQL port 5432 outside 127.0.0.1
- Test on SJ03 pilot before connecting all 18 machines
- Restart backend after any server.js change: `node server.js` in `backend/`
- Build frontend before deploying: `cd frontend && npm run build && copy build to backend/frontend/build`
