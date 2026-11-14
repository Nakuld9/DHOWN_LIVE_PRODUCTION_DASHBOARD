# Repository Audit — Accounting Engine Integration

*Audit performed 2026-10-17 against commit `df8975b` (baseline tests: unit 171/171, e2e 44/44 — PASS).*

This records what the DHOWN MES repository actually is, so the accounting engine
extends it rather than duplicating or fighting it. Verified by inspection, not assumed.

## Stack (confirmed)
- **Backend:** Node.js + Express. **Not** Docker in production — runs as Windows services (`node-windows`). `server.js` wires modules; domain code lives under `backend/src/` as `lib/` (services), `routes/`, `controllers/`, `middleware/`, `db/`.
- **Frontend:** React (Create React App), installable PWA. Pages in `frontend/src/pages/`, shared components in `frontend/src/components/`. Routing is plain React Router; nav in `components/Sidebar.jsx`. Design tokens in `src/styles/theme.css` (white/green/gold, light+dark).
- **Database:** PostgreSQL 18, single `public` schema, raw `pg` (no ORM), parameterised queries throughout. `gen_random_uuid()` available (built-in on PG18).
- **Two firms, one codebase:** DHOWN (`:4000` / `dhown_mes`) and VD Knits (`:4100` / `vdknits_mes`), mirror tree at `D:\VDKNITS_MES`. Scratch/staging copy `dhown_mes_staging`.

## Schema conventions (confirmed)
- **Idempotent `ensure*()` functions** in `src/db/schema.js` run on every boot and bring a new tenant DB to shape. A numbered `migrations/*.js` file is used only for one-off, non-idempotent changes (`migrations/README.md`). **New additive schema → an ensure function, not a migration.**
- Money columns are `NUMERIC(14,2)`; the repo already uses `NUMERIC` everywhere (no float money).
- **Boot-time auto-constraint scanner** (`ensureCheckConstraints`) adds `col >= 0` CHECKs to money/qty-named columns **in `public` only**. This is the reason the accounting engine lives in its **own `acct` schema** — the scanner never touches it, and signed ledger balances are safe.

## Auth / RBAC (confirmed — reused as-is)
- JWT (HS256) + revocation list; central `apiAuthGate`; `requireRole(minRole, { also:[...] })` in `src/middleware/auth.js`.
- Ladder: `VIEWER/AUDITOR=1, OPERATOR/SALES/ACCOUNTS/QC=2, SUPERVISOR=3, ADMIN=4, SUPER_ADMIN=5`. **ACCOUNTS** is a peer of OPERATOR that opts into finance routes via `also:['ACCOUNTS']`. **AUDITOR** is read-everything/write-nothing (enforced once in `auditorWriteBlock`). The accounting routes reuse exactly this model.

## Existing finance surface (confirmed — reused, not duplicated)
- `public.financial_years` (FY 2025-26 closed, 2026-27 active), `cost_centres`, `tax_rates`, `partners` (customers+suppliers, with GSTIN/state), `app_settings` (company_name, gst_number, state).
- Operational finance already present (kept, not replaced): `tax_invoices`, `payments`/`payment_allocations`, `credit_notes`, `bank_*` (H2H ingestion + recon), `loan_*`, `budget_*`, costing (`cost_*`, `stock_ledger`), GST prep (`gst_2b_imports`, GSTR libs), ITC-04.
- **There is no general ledger, chart of accounts, or double-entry posting today.** That is exactly the gap this engine fills — it is additive, not a rewrite.

## Testing (confirmed)
- Jest unit tests in `test/*.test.js`; node-driven e2e in `tests/*.e2e.js`. Gate = pre-commit hook (`.githooks/pre-commit`) running unit + a list of e2e suites; a self-hosted push-CI runner (`scripts/ci-run.js`) runs **all** `tests/*.e2e.js`. The accounting suites were added to both.

## Conflicts identified & resolution
| Risk | Resolution |
|---|---|
| Auto `>=0` CHECK scanner would break signed balances | Engine isolated in `acct` schema (scanner is `public`-only). |
| Destructive probes have deleted live rows before (CLAUDE.md) | No probes; integration tests run only on `dhown_mes_staging`, and refuse `dhown_mes`/`vdknits_mes`. |
| Duplicating partners/FY/cost centres | `acct.ledgers.partner_id → public.partners`, `acct.periods.fy_id → public.financial_years`, `acct.*.cost_centre_id → public.cost_centres`. No duplication. |
| Two books of account (Busy is statutory) | Engine is additive and does not post from MES events yet; Busy remains the record until a documented cutover. |
