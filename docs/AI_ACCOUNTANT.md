# DHOWN AI ACCOUNTANT — Build Plan & Architecture

Source-of-truth for the AI Accountant. The full master system prompt (the product
spec) is the authority on behaviour; this document maps it to the DHOWN MES
codebase and tracks the build.

## Mandate (non-negotiable)

- **Busy is the accounting source of truth. MES is the operational source of truth.**
  The AI database is the **intelligence + workflow + audit layer** — never a second ledger.
- The AI is an **assistant, not the statutory accountant**. Any action that creates,
  modifies, deletes or posts an accounting transaction **requires human approval**
  unless explicitly configured as an approved automation.
- **No hallucination (§32).** Never invent balances, GST, invoice numbers, stock,
  P&L, or party balances. If data is unavailable, say so. Label every figure:
  **ACTUAL / CALCULATED / ESTIMATE / RECOMMENDATION / UNAVAILABLE.**
- **Never silently alter financial data (§21).** Every AI-prepared action is written
  to the immutable audit trail first.
- Secrets (Busy/bank/GST credentials, API keys) never reach the LLM — only the
  secure backend tool layer touches them.

## Approval lifecycle (§20)

`DRAFT → AI_RECOMMENDED → PENDING_APPROVAL → APPROVED → POSTED → REJECTED → REVERSED`

Configurable value-based approval ladder (defaults, not fixed):
`< ₹25k Accountant · ₹25k–₹2L Finance Manager · ₹2L–₹10L Director · > ₹10L Promoter`.

## What already existed in the MES (reused, not rebuilt)

| Spec area | Existing module |
|---|---|
| AI model router (§27) | `src/ai/providers.js`, `src/ai/model.js` |
| Approval engine (§20) | `src/ai/approvals.js` + fleet write-tool pattern |
| NL assistant / agents (§4, §18, §31) | `src/ai/fleet.js`, Ask-AI, WhatsApp |
| Document/Invoice AI (§5, §28) | `src/lib/invoice-ocr.js`, InvoiceOCR page |
| Bank reconciliation (§7) | `src/lib/bank-recon.js`, `bank.routes.js` |
| Receivables + ageing (§8) | `src/lib/payments.js`, `v_partner_outstanding` |
| GST reporting (§10) | `src/lib/gstr1.js` |
| Cost & margin (§13, §14) | `src/lib/costing.js`, `wa-margin.js`, `cost_entries` |
| Per-answer audit + confidence (§21, §22) | `ai_agent_actions` |
| Busy export (one-way) (§26) | `src/lib/busy-production.js`, `busy-sync` |

## The gating dependency: the Busy read/write bridge

Today only **one-way CSV export (MES → Busy, manual)** exists. There is **no read
path from Busy**. Therefore:

- **Phase 0 — MES data only (NO Busy read):** dashboard, NL finance assistant + CFO,
  receivables/payables, cost & customer profitability, cash-flow forecast, anomaly
  detection, daily finance report, draft vouchers via CSV export, audit log.
- **Phase 1 — needs a Busy READ bridge** (read-only SQL replica or scheduled export
  import): MES↔Busy reconciliation, bank-vs-Busy matching, GST intelligence from
  Busy, trial balance / P&L / balance sheet reads.
- **Phase 2 — needs a Busy WRITE API** (Busy's own team builds their side):
  autonomous posting of approved vouchers.

**Honesty in Phase 0:** anything that lives only in Busy — bank/cash balance,
supplier ledger, input GST/ITC, posted P&L — is returned `{available:false,
source:'BUSY'}` and reported as "in Busy, not the MES", never a number.

## Build status

### Slice 1 — Finance brain ✅ (done)
- `src/lib/audit.js` — immutable `ai_audit_log` (append-only; record/list; ensured at boot).
- `src/lib/finance.js` — deterministic finance service (cash position, receivables
  ageing, payables/commitments, sales, purchases, output GST, combined snapshot);
  every figure tagged; Busy-only figures marked unavailable.
- `src/ai/tools/finance.tools.js` — 7 read tools, all SUPERVISOR+.
- `src/ai/fleet.js` — new **`accountant`** and **`cfo`** agents (read-only, honesty rules).
- `src/routes/ai.routes.js` — `GET /api/ai/finance/snapshot`, `GET /api/ai/audit` (SUPERVISOR+).
- Verified: routing, role-gating, no-hallucination (LLM reports Busy figures as unavailable).

### Slice 2 — Anomaly engine + daily finance report (next)
Duplicate invoices/payments, round-number & backdated entries, price spikes;
`jobLock` daily report → dashboard/WhatsApp (§19, §29).

### Slice 3 — AI Accountant dashboard (frontend)
Cards (cash/receivables/payables/GST/pending approvals) + severity alerts + NL box (§3).

### Slice 4 — Draft vouchers + bank-statement Document AI
Purchase voucher from GRN, production stock-in, receipt drafting → approvals queue
→ Busy CSV; manual bank-statement upload → OCR → reconciliation (§5, §7, §28).

## Decisions on record
- Start scope: **Phase 0 MVP** (Nakul, 2026-09-16).
- Busy access: **to be checked** — Phase 0 runs on MES data; Busy bridge designed once access is confirmed.
- Bank feed: **manual statement upload** (Document AI extraction), no live bank API.
- Live Busy write API: **Busy's own technical team** builds their side.
