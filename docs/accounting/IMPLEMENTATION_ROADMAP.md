# Accounting Engine — Implementation Roadmap & Checklist

Phased, testable. Each phase: inspect → implement → migrate (ensure fn) → test →
run regression → document. Busy stays the book of record throughout; no live
MES event posts to the ledger until a documented cutover.

## Phase 1 — Posting core ✅ DONE (2026-10-17)
- [x] `acct` schema: companies, periods, account_groups, ledgers, ledger_openings, voucher_types, voucher_series, vouchers, voucher_lines, journal_entries, journal_lines, audit_log.
- [x] Seed: 27 standard groups (Busy-style primary groups), system ledgers (Cash, Sales, Purchase, P&L, Output/Input GST, Round Off), 11 voucher types, monthly periods per FY.
- [x] Pure rules (integer-paise money, balance validation, state machine, reversal) + 16 unit tests.
- [x] Service: createDraft/update/validate/approve/post/reverse/cancel; masters (groups, ledgers, openings); periods open/close; reports (trial balance, ledger statement, day book, ledger balance); audit trail.
- [x] DB guards: append-only journals/audit, deferred balance check, period lock, posted-voucher immutability, draft-only line edits.
- [x] Idempotency (post + create key), row-locked numbering, concurrency-safe (proven by tests), company isolation, maker-checker.
- [x] HTTP `/api/acct` (role-gated: read/write ACCOUNTS+SUPERVISOR, approve/reverse SUPERVISOR, periods ADMIN).
- [x] 47 integration tests on scratch DB; added to pre-commit gate + push-CI.

## Phase 2 — Document vouchers & tax engine ✅ DONE (2026-10-18)
- [x] Sales / Purchase / Sales-Return / Purchase-Return document vouchers with item lines, HSN, round-off (discount/freight fields deferred).
- [x] Paise-exact GST engine (CGST/SGST intra vs IGST inter, intra/inter derived from party vs company state) posting Output/Input tax ledgers; the computed split is stored on the voucher.
- [ ] GST registers reconciled to postings; tie to existing GSTR-1/3B prep. (deferred)

## Phase 3 — Financial statements ✅ DONE (2026-10-19)
- [x] P&L and Balance Sheet from posted journals (current-period profit → P&L A/c). Drill-down statement→group→ledger→voucher. (2026-10-18)
- [x] Cash book / Bank book views. Receivables & payables ageing (FIFO over postings) reconciled to control accounts (Sundry Debtors / Creditors). (2026-10-19)
- [ ] Bill-wise allocation (receipt → specific invoice) for true open-item ageing — deferred to Phase 4.

## Phase 4 — Inventory & manufacturing accounting ✅ DONE (2026-10-19)
- [x] Posting policies (approved, versioned) for GRN, dispatch/COGS, job-work, wastage — physical qty stays authoritative in the MES stock ledger; valuation reconciles to the GL.
- [x] Transactional outbox (`acct.mes_event_outbox`, UNIQUE event+source_ref) + per-voucher idempotency key so a retried or concurrent MES event cannot double-post. Shadow DRAFT by default (Busy stays the record); POST only after cutover.
- [x] `MES Auto-Post` monitor UI (policies + outbox). 13 unit + e2e (idempotency, concurrency, GL effect) green.
- [x] Wire real MES tables to `outbox.emit()` (2026-10-19) — `mes-events.js` reads `grn`+`yarn_lots` → GRN_RECEIPT and `cost_entries` (WASTAGE, JOBWORK_*) → WASTAGE/JOBWORK, idempotent + shadow DRAFT. Routes /link/mes/sync/{grn,cost-entries,all}; "Sync from MES" button in the Auto-Post view. DISPATCH_COGS still pending (needs the dispatched-cost basis).
- [x] Bill-wise allocation (receipt → specific invoice) for true open-item ageing (2026-10-19) — `allocations.js` + `acct.bill_allocations`; open-item report, all-or-nothing allocate with over-allocation guards, UI Display → Bill-wise Allocation.

## Phase 5 — Migration, parity & cutover ✅ IMPORTER DONE (2026-10-19)
- [x] Busy XML export importer (masters, opening balances, vouchers): dependency-free tolerant XML parser, dry-run with control-total reconciliation, dedupe + restartable via `acct.migration_map`, batch rollback (reverse posted / cancel drafts). Shadow DRAFT by default; vouchers migrated as JOURNAL preserving the original Busy type/number/date as metadata. UI: Tools → Busy XML Migration. 7 unit + e2e (dry-run, import, idempotent re-import, reconcile, rollback, POST+reverse).
- [ ] Validate the parser against a REAL Busy export (tag names confirmed against live output) — aliases are tolerant but unverified against an actual file. (needs a sample export — `project_dhown_busy_bridge`.)
- [ ] Black-box differential fixtures vs authorised Busy outputs; `BUSY_PARITY_MATRIX.md` kept honest.
- [ ] CA review of policies + statutory outputs; documented cutover + rollback.

## Phase 6 — AI accountant (optional, gated) ✅ HOOKS DONE (2026-10-19)
- [x] `ai-accountant.js`: AI can only (a) propose a voucher/document as a DRAFT through the one authoritative service (source `acct.ai`, flagged requires_human_approval) and (b) explain a balance read-only. It exposes no post/approve/reverse path, so an AI integration cannot write to the ledger. Routes /ai/{propose,propose-document,explain}. The existing MES AI accountant calls these hooks; a human validates + posts.

## UI (parallel track — see BUSY_UI_REFERENCE.md / UI_SCREEN_MAPPING.md)
- [ ] Phase-1 screens: Accounting workspace, Chart of Accounts, Ledger master, Voucher register + entry, Trial Balance, Ledger, Day Book — keyboard-first, Busy-style dense layout. Then screens follow the backend phases.
