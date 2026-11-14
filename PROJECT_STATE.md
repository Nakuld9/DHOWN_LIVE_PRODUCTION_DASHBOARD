# DHOWN MES — PROJECT STATE
*Last updated: 2026-10-09 (CFO MODULE Slices 1-5 live: Debt & Loans, Budgets+scenarios, 13-wk cash-flow, Mfg Profitability, Executive CFO dashboard. Audit ~91. Latest `890653a`; 171 unit + 43 e2e green.)*

> **2026-10-09 — CFO MODULE COMPLETE (buildable slices 1-5), both firms.** New finance
> decision-support layer built per the CFO master spec, extending (not rebuilding) the AI
> Accountant: **Debt & Loan register + amortization** (`/debt-management`), **Budgeting &
> base/upside/downside scenarios** (`/budgets`), **rolling 13-week cash-flow forecast**
> (`/cash-flow`), **manufacturing contribution/kg profitability** (`/profitability`), and a
> consolidated **Executive CFO dashboard** (`/cfo`). Every module is decimal-safe, RBAC-gated,
> audited, tested in the gate, and **honest about Busy** — figures that live in Busy (gross
> profit, EBITDA, PBT, inventory valuation, cash-in-hand) are labelled "In Busy", never
> invented. **Busy sync (§3) is parked** on BUSY PARTNER DEV API access. Mfg profitability will
> show real numbers only once the shop-floor collectors (`DC_API_KEY`) feed `rolls`. See
> `HANDOFF.md` 2026-10-09 block. Also this session: import shortage false-positive fixed, HA
> warm-standby kit (`ha/`), audit report → 2026-10-10 (91/100).

*2026-10-08 (Audit ~91/100. JWT revocation list + session-revocation-on-credential-change; local push CI. `927f2e5`; 171 unit + 39 e2e green.)*

> **2026-10-08 — audit ~91/100.** Today's buildable Engineering items shipped: a **JWT
> revocation list** (per-token blocklist + per-user cutoff; logout/password-change/
> deactivate/delete now end sessions) and **local push CI** (self-hosted bare-repo `ci`
> remote + post-receive gate, nothing leaves the box — see `LOCAL_CI.md`). These close the
> two buildable audit items (JWT revocation + pushed CI) → **Engineering ~93-94** (from 92).
> **No software work remains toward 100** — the rest is external: collectors + `DC_API_KEY`
> (live production data, biggest), RFID, keys (ZHIPU/Data Docked/WhatsApp), the HA decision,
> and the blocked Busy read bridge. 39 e2e suites now.

> **FRESH AUDIT 2026-10-07 — platform health 90/100** (up from 88 on 2026-09-29).
> Dimensions: **Features 96** (↑94), **Engineering 92** (↑90), **Operations 82** (↑80).
> Evidence: 51 commits since last audit; 171 unit (15 suites) + 38 e2e all green (run fresh);
> 178 tables / 1,192 check constraints; 0 real stubs/TODOs. New since last audit: Bank H2H
> (inbound live + outbound draft-only), AI Accountant → ~95% (bank feed, GSTR-3B/2B, AR
> collections, month-end close), DC GST Rule 55 + job-work, BoE reader + extraction guardrails,
> Prospective Buyers CRM. **Overall is capped by the live-data/ops gap** — collectors + `DC_API_KEY`
> not wired (dashboards/AI read 0 production; ~4-5 pts), single-site infra / no pushed CI, and the
> blocked Busy read bridge. Software quality & breadth sit at ~92-96; ops drags the total, not weak
> code. (NB: the "~95/100" completion figure below is feature-completeness, a different lens than
> this audit-health score.)

> **2026-09-18 — Import Tracking & Control Tower module COMPLETE (all 10 slices, both firms).**
> CIF-default import lifecycle under `/api/imports`, extending (never duplicating) the existing
> supplier/material/PO/GRN/inventory/warehouse/RBAC/audit masters. Covers: CIF-protected landed
> costing (freight/insurance never double-counted, recoverable IGST excluded as ITC) → Control
> Tower + partial shipments → GRN/inventory link (inventory stays authoritative) → customs/docs/
> logistics → tracking (replaceable provider, never fabricates; dormant until keys set) → exception
> engine → AI shortage analysis (analysis only, never auto-purchases) → reports + management view +
> est-vs-actual variance → vessel master + honest position map (verified coords only) → Busy posting
> readiness (MES never writes to Busy). 3 sidebar pages under PROCUREMENT. See `HANDOFF.md` top block
> and memory `project_dhown_import_tower`.
>
> Between 2026-08-03 and now the platform also gained (see `HANDOFF.md`): the AI-native fabric MES
> (Phases 1–4), the 10-agent AI fleet + approvals queue + governed write tools, and the AI
> Accountant (Phase 0). PROJECT_STATE dimension scores below predate those; treat HANDOFF.md as the
> authoritative recent record.

> **2026-08-03 hardening:** the two engineering gaps from the 2026-07-31 audit are now
> closed. **(1)** First automated tests landed — a **money-math Jest suite** (25 tests:
> GST, payroll, shift) via `cd backend && npm test`. **(2)** The **10 unauthenticated
> routers** (dashboard, charts, analytics/OEE, production, greige, traceability,
> command-center, alerts, active-operators, inventory-views) now require a JWT —
> verified live (no token → 401, valid token → 200, login + dashboard unaffected).
> Also: admin credential hardened (no hardcoded `admin123` default; rotate script),
> full `git bundle` backup taken, and **`server-refractor` merged into `main`** (active
> branch is now `main`). Engineering-readiness ~90 (was ~84).
>
> **2026-07-31 audit:** `server.js` refactor essentially complete (7,914 → 791 lines;
> 57 layered mounts, 1 inline). See `AUDIT_REPORT.md` 2026-07-31 addendum.

---

## Overall Completion: ~95 / 100

Up from 92 (2026-08-03). Since then: AI-native fabric MES (Phases 1–4), 10-agent AI fleet +
approvals queue, AI Accountant (Phase 0), and the **Import Tracking & Control Tower module
(complete 2026-09-18)**. Score now capped mainly by DC integration (collector hardware) and
external blockers (WhatsApp Meta publish, Busy partner-dev API), not by missing software.

Up from 87 (2026-07-15). Entire commercial/ERP backlog built on 2026-07-30:
Purchase Orders, Sales Orders, Production Planning (with Make-to-Order /
Make-to-Stock), Payroll (attendance-driven), Tax Invoice (GST CGST/SGST/IGST).
Workforce master (worker types + auto IDs + wages), manual attendance for
non-RFID staff, PWA installable. Score now capped mainly by DC integration
(collector vendor-blocked) and RFID hardware, not by missing software.

| Dimension | Score | Notes |
|---|---|---|
| Procurement (Purchase Orders) | 90 | Supplier POs → GRN; header+items, DRAFT→SENT→RECEIVED lifecycle, PO-YY-NNN (2026-07-30) |
| Import Tracking & Control Tower | 95 | **COMPLETE 2026-09-18 (all 10 slices).** CIF-default landed costing (no double-count, IGST as ITC), Control Tower + partial shipments, GRN/inventory link, customs/docs/logistics, tracking (replaceable provider, never fabricates), exception engine, AI shortage analysis, reports + mgmt view + est-vs-actual variance, vessel master + honest position map, Busy posting readiness (MES never writes to Busy). Reuses partners/items/PO/GRN/warehouses; `/api/imports`, RBAC-gated |
| Sales & Orders | 90 | Sales Orders (DRAFT→CONFIRMED→DISPATCHED), Tax Invoices (GST intra/inter, print), dispatch link (2026-07-30) |
| Production Planning | 88 | Fabric targets per machine, MTO/MTS, progress vs target, SO link, priority board (2026-07-30) |
| Payroll & Wages | 85 | Attendance-driven runs (days×rate / monthly), OT/bonus/deduction/advance, DRAFT→FINALIZED→PAID, wage rates on workers (2026-07-30) |
| Subcontracting | 98 | Challans, receipts, party report, vendor invoices, overdue alerts, analytics, rate auto-fill, wastage calc, multi-process chaining, edit/delete/cancel, layered module |
| Costing & Finance | 95 | FIFO yarn, knitting cost, BOM, variance, AI (Groq + GLM-5.2), GST report, cost snapshots, layered module |
| Inventory Management | 95 | Yarn Store, Greige, FG, Opening Balances (5 tabs), 8-tab Reports, Stock Statement, GRN, Yarn Issue, Yarn Returns, Dispatch w/ pricing |
| Quality & Traceability | 95 | Traceability page (roll/lot), batching (multi-fabric lots), quality inspection module (DB schema, APIs, UI, report page, CSV/PDF export, print), defect types |
| Print & Documents | 93 | GRN, Dispatch (commercial), SC yarn + roll challans, SC receipts w/ history, packing lists, roll labels, finished-goods labels |
| Downtime Management | 92 | Full CRUD, reasons, duration, audit logging, auth, open/stats/reason endpoints, auto-detection |
| Reports & Analytics | 92 | 8-tab inventory, production reports, report preview, CSV/PDF exports, OEE + utilization + shift analytics (layered), charts (layered) |
| Master Data | 90 | Item Master + BOM, Partners, machine config + fabric link, Settings + Busy sync, Admin Masters, UOM/HSN/Categories |
| User Security & Access | 92 | RBAC enforced (requireRole), PIN rate limiter (5/5min), JWT (random 256-bit secret), audit middleware (logs real username), logout endpoint; **10 previously-open routers now JWT-guarded (2026-08-03)**; admin seed no longer defaults to `admin123` (env or random) + rotate script |
| Core Machine Monitoring | 86 | Dashboard, Machines, MachineDetails, TV Dashboard, OEE (quality now from real QC inspections → roll approve/reject → target) — needs live DC data |
| Production Tracking | 83 | Rolls CRUD, weighing, approval, auto fabric link, batches/lots, edit/delete/cancel — needs DC for real-time |
| Operator & Shift Mgmt | 90 | Workforce master (Operator/Helper/Supervisor/Master/Driver, auto OP/EMP IDs, wage rates), manual attendance for non-RFID staff, assignments, shift handover |
| Knitting Library | 85 | Structure CRUD, yarn/feeder/cam/needle config, reference images, PDF export, machine binding |
| Maintenance | 80 | PM schedule, work orders (OPEN→IN_PROGRESS→COMPLETED/CANCELLED, lifecycle), spare parts (CRUD + movements), layered modules |
| RFID Integration | 65 | Scan endpoint (fixed — POST /api/rfid-scan works), events page — hardware not fully deployed |
| DC Integration | 35 | **PIVOTED to self-hosted ESP32 collector** (vendor Yindu path abandoned — never read the revolution sensor). Ingest `POST /api/live-data:8090` (dcApiKeyGuard `x-api-key`) mature + now captures `stoppage_reason` into downtime. Firmware **v1.2.0** (`firmware/esp32-collector/`, ETH.h/W5500, correct XH-600S tower-light semantics) code-complete. Parts ordered 2026-07-31. **Pending hardware only** — flash + bench-test on arrival, then wire per machine. |
| Mobile App (PWA) | 70 | Installable PWA — manifest, offline app-shell service worker (never caches live API), maskable icons, in-app install prompt (Android + iOS hint); mobile pages MobileRoll/MobileQC. Native app not needed |

---

## Codebase Size

| Metric | Count |
|---|---|
| Backend (server.js) | ~4,200 lines; 30+ layered modules in src/ (incl. purchase-orders, sales-orders, production-plans, payroll, tax-invoices) |
| Frontend (pages + components) | ~26,000 lines |
| API Endpoints | ~290 total (layered src/ majority) |
| Pages | 55 (+PurchaseOrders, SalesOrders, ProductionPlanning, Payroll, TaxInvoices) |
| Components | 26 (+InstallPrompt) |
| DB tables | 60+ (+purchase_orders/items, sales_orders/items, production_plans, payroll_runs/items, tax_invoices/items) |

---

## System Status

| Component | Status |
|---|---|
| Frontend (React) | ✅ Running — full ERP UI live, 50 pages |
| Backend (Node/Express) | ✅ Running — 243 endpoints, RBAC, audit logs, layered architecture |
| Database (PostgreSQL 18) | ✅ Running — 50+ tables |
| Costing Chain | ✅ Live — FIFO yarn + knitting cost posting on new transactions |
| AI Assistant (Groq + GLM-5.2) | ✅ Live — dual-provider (GLM primary, Groq fallback) |
| Cloudflare Tunnel | ✅ LIVE — mes.dhownhosiery.com → :4000 (Access PIN gate). VD Knits added 2026-08-12: vdknits.dhownhosiery.com → :4100 (public-with-login, **NOT PIN-gated** — add a Zero Trust Access app to gate it). LAN: 192.168.1.252:4100 (firewall rule added). Setup: `setup-vdknits-access.bat` |
| Cloudflare Access | ✅ DONE — main site PIN-gated, /m/* and /api/public bypassed |
| Yindu Cloud Poller | ✅ LIVE — auto-refreshing collector map; SJ03 remapped to WD250430 (collector swapped). Machine still reports status=3/offline — collector→machine sensor wiring pending (vendor) |
| Process Supervision / Auto-start | ✅ LIVE (2026-08-12) — DHOWN MES (:4000, health 200), VD Knits MES (:4100), and Cloudflared (mes.dhownhosiery.com → 302 Access gate) all run as auto-start Windows services (node-windows + cloudflared). Registered via `install-services.bat`; `start-services.bat` starts them, `uninstall-services.bat` removes them. cloudflared service binPath had to be set to `tunnel run` explicitly (build expects a token). Backups OK under LocalSystem — backup.js uses the absolute `C:\Program Files\PostgreSQL\18\bin\pg_dump.exe`, not PATH |
| Daily Backups | ✅ Running — 02:00 daily, 7-day retention, Google Drive secondary |
| Data Collectors (DC) | ⚠️ Poller live, mapping correct — SJ03's new collector WD250430 online to WiFi/cloud but not reading the machine (sensor wiring; vendor left). All other machines await collector rollout |
| Mobile App (PWA) | ✅ Installable PWA (open mes.dhownhosiery.com on phone → Install banner). Native app not planned |
| Commercial Modules | ✅ Purchase Orders, Sales Orders, Production Planning (MTO/MTS), Payroll, Tax Invoice (GST) — all live (2026-07-30) |
| VD Knits (2nd company) | ✅ Set up 2026-08-12 — separate DB `vdknits_mes` on :4100. Frontend rebuilt (was stale, now = dhown build). Identity complete: VD KNITS, D-150 Phase VI Focal Point Ludhiana, GSTIN 03AROPD5351L1ZQ, PAN AROPD5351L, Punjab, pincode 141010 (inferred), SBI A/C 44564675511 / SBIN0006265, +919876700180. 7 machines registered offline (IL1-4, IL6-7, RB5). Access: LAN 192.168.1.252:4100 + `vdknits.dhownhosiery.com`. **Admin password reset ✅ (2026-08-12) — admin login works. Pending: add users, PIN-gate the subdomain (currently public-with-login), confirm pincode, wire collectors.** Scripts in `VDKNITS_MES/backend/scripts/`: set-admin-password.js, seed-users.js, seed-machines.js |

---

## Pages Status

| Page | Status |
|---|---|
| Login | ✅ Working — rate-limited, Cloudflare Access PIN |
| Dashboard | ✅ Working — error states, operator assignment status, overdue SC alerts |
| Machines | ✅ Working — operator column, live status |
| Machine Details | ✅ Working — 5-second refresh |
| Production | ✅ Working |
| Rolls | ✅ Working — edit/delete/cancel, shift from settings (no hardcode) |
| Operators | ✅ Working — layered module |
| Assignments | ✅ Working — RFID binding, release |
| RFID Scan | ✅ FIXED — POST /api/rfid-scan now exists, auto-attendance |
| RFID Events | ✅ Working |
| Downtime | ✅ Working — audit, open/stats/reason |
| Yarn Store | ✅ Working — low-stock alerts, layered |
| Yarn Issue | ✅ Working — delete/cancel, yarn return, layered |
| GRN | ✅ Working — edit/delete/cancel, CSV, layered |
| Greige Warehouse | ✅ Working — layered |
| Batching | ✅ Working — multi-fabric lots, layered |
| Subcontracting | ✅ Working — 5 tabs, vendor invoices, wastage, chaining, layered |
| Dispatch | ✅ Working — pricing, GST, packing lists, layered |
| Finished Goods | ✅ Working — cost/kg, edit/delete |
| Opening Balances | ✅ Working — 5 tabs, multi-row entry, roll/finished labels |
| Inventory Reports | ✅ Working — 8 tabs |
| Stock Statement | ✅ Working |
| Warehouse Overview | ✅ Working |
| Work Center Stock | ✅ Working |
| Costing | ✅ Working — dashboard, variance, AI (Groq + GLM), layered |
| GST Report | ✅ Working |
| Item Master | ✅ Working — BOM, knitting rates, HSN |
| Partners | ✅ Working — ERP vendors/customers |
| Admin Masters | ✅ Working |
| Reports | ✅ Working — layered (34 handlers) |
| Report Dashboard | ✅ Working |
| Report Preview | ✅ Working |
| Settings | ✅ Working — Busy sync tab, machine config, layered |
| User Management | ✅ Working — layered |
| Quality Inspection | ✅ Working — defects, grade, pass/fail, CSV/PDF |
| Quality Inspection Report | ✅ Working — filter, print |
| Traceability | ✅ Working — roll/lot/lot-search, QR lookup |
| Finishing | ✅ Working — layered |
| Work Orders | ✅ Working — lifecycle, parts consumption, layered |
| Spare Parts | ✅ Working — movements, low-stock, layered |
| Knitting Library | ✅ Working — PDF export, images, machine binding |
| Maintenance | ✅ Working — layered module |
| Maintenance Schedule | ✅ Working — layered module |
| Shift Handover | ✅ Working |
| MobileRoll | ✅ Working — public QR scan page |
| MobileQC | ✅ Working — scan-driven QC |
| Vendor Stock | ✅ Working |
| MasterDashboard | ✅ Working |
| Alerts | ⚠️ Shows data — no push notification delivery |
| TV Dashboard | ✅ Working — fluid clamp() typography, scales on 1080p/4K/any aspect (2026-08-03) |
| Import Control Tower | ✅ Working — KPIs, exceptions, shortage risk, filter/search/paginated imports, create; import detail (shipments/GRN/customs/docs/logistics/costing/exceptions/timeline) (2026-09-18) |
| Import Reports | ✅ Working — management summary + report picker (register/shipments/pending-customs/pending-docs/arrivals/delayed/landed-cost/variance) + Busy posting readiness (2026-09-18) |
| Vessels & Map | ✅ Working — vessel master CRUD + honest position map (verified coordinates only) (2026-09-18) |

---

## Security Posture

| Finding | Status |
|---|---|
| PIN brute-force (rate limit) | ✅ Fixed — 5 attempts/5 min per IP |
| Port-8090 DC auth | ✅ Fixed — dcApiKeyGuard (enforced when DC_API_KEY set) |
| RBAC / role enforcement | ✅ Fixed — requireRole() throughout |
| JWT secret (random 256-bit) | ✅ Fixed |
| Audit logs (real username) | ✅ Fixed — req.user.username |
| Counter-reset protection | ✅ Fixed — DC_MAX_COUNTER_DELTA |
| Orphaned supervisors table | ✅ Gone — table dropped + endpoints/refs removed (verified 2026-08-03) |
| DC_API_KEY in .env | ❌ Not set — enforcement dormant |
| Unauth'd routers (dashboard/analytics/production/etc.) | ✅ Fixed 2026-08-03 — 10 routers now require JWT (verified live) |
| Hardcoded `admin123` admin default | ✅ Fixed 2026-08-03 — env/random seed + rotate script; **live admin password rotated (admin123 no longer accepted, verified)** |
| Automated tests on money math | ✅ Added 2026-08-03 — 25 Jest tests (GST/payroll/shift) |

---

## Remaining Gaps (priority order)

1. **DC Integration** — self-hosted ESP32 collector (suspended, awaiting technician); set `DC_API_KEY`
2. **WhatsApp go-live** — 6 Meta templates in review + permanent System User token + new SIM

*(All non-blocked engineering gaps closed — only external blockers remain.)*

*Done 2026-08-03: money-math test suite, 10 routers guarded, admin hardening, full backup, `server-refractor`→`main` merge, dead supervisors table/endpoints removed, **OEE quality now from real QC data** (QC inspections → roll approve/reject → target; fixed a bug where the stored quality column used the target instead of the computed value), **TV Dashboard fluid clamp() typography** (scales on any panel), **pagination** — extracted shared helper (`src/lib/pagination.js`) + offset-paged the quality-inspections list (high-growth endpoints rfid/audit/downtime/rolls were already paginated). `server.js` refactor complete (791 lines); test suite now **44**.*