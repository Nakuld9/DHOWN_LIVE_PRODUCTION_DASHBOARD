# DHOWN MES — Full Audit Report

**Date:** 2026-10-10 (revision of the 2026-10-07 report)
**Overall score:** **91 / 100** (2026-10-07: 90 · 2026-09-29: 88)
**Verdict:** Operationally live in production for two firms (DHOWN `:4000`/`dhown_mes`,
VD Knits `:4100`/`vdknits_mes`) on one shared codebase. Software breadth and quality are
high and well-tested; **all buildable software items flagged by prior audits are now
closed**, so the overall is held below the mid-90s entirely by one operational gap (live
shop-floor data not yet wired) plus single-site infrastructure and an externally blocked
integration — not by weak or missing code.

### What changed since 2026-10-07 (→ +1 overall, Engineering 92→94)

The two buildable Engineering gaps the last audit named are both closed:

- **JWT revocation list** (`238e73c`, `0c7c4a3`) — was "revocation is secret-rotation-only".
  Per-token blocklist (`jti`) + per-user cutoff (`users.tokens_valid_from`), in-memory cache
  backed by the `revoked_tokens` table (verifyToken stays synchronous; cache reloads at boot
  so revocations survive restart). Logout now actually ends the session; password change /
  deactivation / deletion revoke all of a user's tokens; admin can "log out everywhere".
- **Local push CI** (`927f2e5`) — was "no pushed CI". A self-hosted bare `ci` remote whose
  `post-receive` hook runs the full gate (171 unit + 39 e2e) against an isolated checkout on
  every push to `main`, logging PASS/FAIL. Entirely on-box (honors the never-push-to-GitHub
  rule); promotable to Gitea later. See `LOCAL_CI.md`.

---

## 1. Methodology & scope

Evidence-based audit, grounded in:

- **Test execution (fresh)** — **171 unit tests (15 Jest suites) + 39 e2e suites**, all green.
- **Static inventory** — 77 route modules, 112 lib modules, 100 frontend pages.
- **Schema inspection** — 179 tables, 1,195 CHECK constraints in `dhown_mes`.
- **Change history** — commits reviewed through `9bfc396`; the delta since 2026-10-07 is the
  JWT-revocation + local-CI work above.
- **Stub scan** — 0 real TODO/FIXME/stub markers (the 5 keyword hits are benign: anomaly
  prose, a UI `placeholder` attribute, the tracking provider's honest "not implemented until
  configured" guard).
- **Local CI** — 3 recorded PASS runs since it was stood up.

It is **not** a line-by-line re-read of all 179 tables / 100 pages; it is a calibrated
reassessment against the 88/100 baseline, weighted by verified test coverage, schema
discipline, and the delta of work since.

### Scoring dimensions

| Dimension | 09-29 | 10-07 | **10-10** | Driver |
|---|---|---|---|---|
| **Features** | 94 | 96 | **96** | Bank H2H, AI Accountant (~95%), DC Rule 55 + job-work, Prospective Buyers CRM |
| **Engineering** | 90 | 92 | **94** | **JWT revocation + pushed CI closed** (both named gaps); 39 e2e; 1,195 checks |
| **Operations** | 80 | 82 | **82** | Still capped by missing shop-floor collectors; local CI ≠ off-site resilience |
| **Overall** | **88** | **90** | **91** | |

---

## 2. Module-by-module assessment

Scores are 0–100 per domain. "Tests" lists the e2e/unit suites that exercise the domain.

### 2.1 Core platform — auth, users, settings, audit, security — **95** (↑93)
- **Modules:** `auth`, `users`, `settings`, `audit-logs`, `trash`, `health`, `public`.
- **Status:** Bearer-JWT auth, role hierarchy enforced via `requireRole`; global auth gate
  with per-route exceptions. Admin seed hardened; JWT_SECRET + DB_PASSWORD rotated; `.env` +
  local settings purged from all git history; GitHub remote removed (never pushed).
  **NEW: JWT revocation** — tokens carry a `jti`; verifyToken rejects revoked tokens or
  tokens issued before a user's cutoff. Logout ends the session; password change /
  deactivate / delete revoke all of a user's sessions; admin `POST /api/auth/revoke-user/:id`
  + `GET /api/auth/revocations`. Cache-backed (no per-request DB hit), survives restart.
- **Gaps:** Revocation covers the real cases; a leaked display token is handled by revoking
  user 0 + reissuing.
- **Tests:** `token-revocation` (12 assertions), `roles`, `sales-role`, `soft-delete`;
  `rate-limit-key` unit.

### 2.2 Manufacturing / shop floor — **80** ⚠ (the ceiling)
- **Modules:** `machines`, `machine-settings`, `production`, `production-entry`,
  `production-plans`, `planning`, `work-orders`, `downtime`, `shift-handovers`,
  `active-operators`, `operators`, `assignments`, `attendance`, `rfid`, `live-data`,
  `data-collectors`.
- **Status:** Software complete and tested — shift entry, MTO/MTS planning, downtime, OEE,
  operator assignment, attendance. **Live production data is NOT flowing:** the ESP32
  collectors + `DC_API_KEY` ingest path is built but not wired, so dashboards/AI read 0 real
  output.
- **Gaps (score-capping):** No live ingest → the single biggest operational gap (~4–5 pts).
  RFID hardware also pending.
- **Tests:** `production-entry`, `oee-quality` unit, `shift` unit.

### 2.3 Inventory & materials — **95**
- Yarn store, greige, FG, opening balances, GRN, yarn issue/returns, batching, stock
  statement, 8-tab reports; every stock entry point has Edit/Delete/Cancel. FIFO valuation;
  roll/lot traceability.
- **Tests:** `matrix-valuation`, `line-weights`, `finished-entry`, `medium-batch`,
  `allocation`, `constraints`, `integrity`.

### 2.4 Quality & traceability — **95**
- Full inspection module (schema/APIs/UI/report/export/print), defect types, roll/lot
  traceability, multi-fabric batching.
- **Tests:** `fabric-inspection`, `defect-types`, `fabric-grade` unit.

### 2.5 Subcontracting — **98**
- Most complete domain: challans, receipts, party report, vendor invoices, overdue alerts,
  analytics, rate auto-fill, wastage calc, multi-process chaining, edit/delete/cancel, layered.

### 2.6 Costing & finance — **96**
- FIFO yarn + knitting cost on GRN/issue/roll approval; BOM; variance; GST report; cost
  snapshots; AI costing. Tax invoices (GST intra/inter, print). Payroll attendance-driven.
- **Tests:** `financial`, `gst` unit, `payroll` unit, `perf-credit`.

### 2.7 Banking (H2H) — **85**
- **Phase A LIVE** — read-only MT940/CAMT.053/CSV/Union Bank `.xls` ingestion + auto-recon +
  drop-folder poller. **Phase B built, DRAFT-ONLY** — outbound supplier payments: approve-gated
  IFSC-validated beneficiaries, pain.001 XML + CSV builders, per-txn/per-batch limits, RTGS
  floor / IMPS cap, maker-checker release/cancel. **MES never sends money.**
- **Tests:** `bank-recon`, `bank-files`, `bank-payouts`.

### 2.8 AI Accountant — **93** (~95% feature-complete)
- Finance brain + audit, anomaly + daily report, draft vouchers, bank reconciliation, CFO
  analytics, purchase/sales-invoice AI, supplier intel. Bank feed wired in; GSTR-3B + GSTR-2B
  (ITC via uploaded 2B JSON); AR/AP collections; month-end close checklist. Approval-gated,
  no-hallucination.
- **Gaps (blocked):** last ~5% = Busy read bridge (proprietary `.BDS`, live API only via
  BUSY PARTNER DEV). Cash / ITC / supplier ledger stay "in Busy".
- **Tests:** `financial`, `gst-returns`, `gstr1`, `collections`, `ai-guardrails`,
  `ai-write-tools`, `ai-approvals`, `ai-agent`.

### 2.9 Procurement & imports — **96**
- Import Tracking & Control Tower complete (10 slices) + deepened: CIF-default landed costing
  (no double-count; IGST as recoverable ITC with per-import toggle), Control Tower + partial
  shipments, GRN/inventory link, customs/docs/logistics, tracking (replaceable provider,
  never fabricates), exception engine, AI shortage analysis, reports + est-vs-actual variance,
  vessel master + honest position map, Busy posting readiness. Auto-PO on advance/proforma,
  vessel sea-lane route estimate, BoE AI reader with duty/assessable guardrails.
- **Gaps:** live AIS positions need Data Docked credits; scanned-doc OCR needs `ZHIPU_API_KEY`
  (both external; digital PDFs work keyless).
- **Tests:** `logistics`, `payments`, `mrp`, `dispatch-invoice`.

### 2.10 Sales & dispatch — **92**
- Sales orders, tax invoices with dispatch link, dispatch challans with commercial pricing +
  auto-invoice. DC GST Rule 55 fields + **job-work DC** (free-text lines, no stock coupling,
  no tax invoice, return recording). Latent `nextSeq('DC',…)` bug fixed.
- **Tests:** `dispatch-dc`, `dispatch-invoice`, `sales-role`.

### 2.11 Maintenance & spares — **90**
- Needle capacity + change log, model-specific spare parts, GRN receipts; needle cost ex-GST
  (ITC); full fleet mapped, multi-gauge toggle, prices set.

### 2.12 WhatsApp / CRM / web-chat — **92**
- Cloud API live, Meta app published, quality GREEN, default AI mode AUTO. Idempotency,
  delivery status, 24h window, consent, observability, durable queue, job locks (128 WA
  tests). Marketing campaigns, opt-in capture, re-engagement fallback. Prospective Buyers CRM
  (now shows all prospects, not just Yarnex). Web-chat widget published to the website repo.
- **Gaps (hygiene):** regenerate the WhatsApp token + APP_SECRET.
- **Tests:** `wa-webhook-ai`, `wa-approvals`, `wa-consent`, `wa-margin`, `wa-quote`,
  `wa-score` units; `complaints`.

### 2.13 Reporting, dashboards & monitoring — **89** (↑88)
- Broad reporting + management dashboards; System Monitor (`/system-monitor`, grouped error
  tracking, health/metrics, backup freshness, process-level handlers). Local pre-commit gate
  + nightly CI runner + **NEW local push CI** (post-receive gate on every push).
- **Gaps:** production dashboards read 0 until collectors are wired. Busy sync read-bridge
  pending.
- **Tests:** `reports-extra`, `busy-production`.

---

## 3. Engineering quality — **94** (↑92)

- **Testing (strong):** 171 unit + 39 e2e, all green; blocking pre-commit gate; nightly CI
  runner; **plus local push CI** (independent post-push checkpoint against an isolated
  checkout). Risk/money/execution/auth paths are the best-covered.
- **Architecture:** layered `src/` (repo→service→controller→routes) with DI; `server.js` 791
  lines. New modules follow the pattern.
- **Schema discipline (strong):** 179 tables, 1,195 CHECK constraints; FK-index integrity
  test-enforced; soft-delete + audit standardized.
- **Security (now a clear strength):** **JWT revocation** (blocklist + per-user cutoff),
  BoE duty/assessable cross-checks, bank outbound draft-only with hard limits, tracking never
  fabricates, AI write-tools approval-gated, MES never writes to Busy, secrets purged from
  history + rotated.
- **Cleanliness:** 0 real stubs/TODOs.
- **Remaining gaps:** CI is local-only (no off-site runner beyond the git bundle — a
  deliberate single-site call); single-node, no HA.

---

## 4. Operations — **82**

- **Live:** both firms healthy; WhatsApp Cloud API; bank inbound feed; off-site git-bundle
  backup (daily to Google Drive); staging on `:4001`; nightly CI + local push CI.
- **Capping gaps:**
  1. **Shop-floor collectors + `DC_API_KEY` not wired** → 0 live production data (~4–5 pts).
  2. **Single-site infra / no off-site CI runner.**
  3. **Busy read bridge blocked** on partner API.
  4. **External keys pending:** `ZHIPU_API_KEY`, Data Docked top-up, WhatsApp token/secret
     regeneration.
- **Operational note (2026-10-08):** `restart-services.bat` `net stop/start` did not reliably
  cycle the DHOWN service's node child (stray node processes accumulated); a targeted
  Stop-Service + free-port-4000 + Start-Service cleared it. Worth checking the service wrapper's
  child-kill behaviour if it recurs.

---

## 5. Top risks (prioritised)

1. **No live production data (P1).** The manufacturing core's value is latent until collectors
   feed it. ~4–5 points and the biggest single win.
2. **Single point of failure (P2).** One node, one site; recovery relies on local backups +
   the off-site git bundle.
3. **Busy dependency (P2, external).** Full financial truth lives in Busy; bridge needs the
   partner API.
4. **Secret hygiene (P3).** Regenerate the WhatsApp token/APP_SECRET.

---

## 6. Recommendations

- **Wire the collectors + `DC_API_KEY`** — single highest-leverage action; lifts Operations
  materially and converts the manufacturing modules from "built" to "live".
- **Regenerate the WhatsApp token + APP_SECRET.**
- **Top up Data Docked** + **set `ZHIPU_API_KEY`** to unblock already-built import features.
- **Busy read bridge** stays parked until BUSY PARTNER DEV access lands.
- **No remaining pure-software work** toward 100 — JWT revocation and pushed CI (the two
  buildable items) are done.

---

## 7. Score summary

| Domain | Score |
|---|---|
| Subcontracting | 98 |
| Procurement & imports | 96 |
| Costing & finance | 96 |
| Inventory & materials | 95 |
| Quality & traceability | 95 |
| Core platform / security | 95 ↑ |
| AI Accountant | 93 |
| Sales & dispatch | 92 |
| WhatsApp / CRM | 92 |
| Maintenance & spares | 90 |
| Reporting / monitoring | 89 ↑ |
| Banking (H2H) | 85 |
| Manufacturing / shop floor | 80 ⚠ |
| **Overall (Features 96 / Engineering 94 / Operations 82)** | **91** |

*Evidence: 171 unit + 39 e2e green (run 2026-10-10); 179 tables / 1,195 checks; 0 real stubs;
local push CI with 3 PASS runs. Both firms live and healthy. All work committed locally;
nothing pushed to GitHub.*
