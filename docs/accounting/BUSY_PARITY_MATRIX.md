# Busy 21 Standard — Parity Matrix (honest, evidence-based)

Busy is used only as a lawful black-box behavioural reference. "Parity" is claimed only where
a documented differential fixture confirms it. Status: done / partial / not-started.

| Capability | DHOWN MES | Status | Notes |
|---|---|---|---|
| Account groups (primary + sub) | `acct.account_groups` | done | 27 standard groups seeded; sub-groups inherit nature. |
| Ledger masters + opening balances | `acct.ledgers`, `ledger_openings` | done | Type/state inferred from group/GSTIN. |
| Double-entry posting | `service.postVoucher` | done | Atomic, idempotent, immutable, concurrency-safe. |
| Voucher types (Receipt/Payment/Contra/Journal) | voucher_types | done | Fully functional accounting vouchers. |
| Voucher types (Sales/Purchase/DN/CN) | voucher_types | partial | Post as accounting vouchers now; item/tax document layer = Phase 2. |
| Financial-year & period control | `acct.periods` | done | Open/Close/Lock; reopen audited with reason. |
| Trial Balance | `/reports/trial-balance` | done | Opening/movement/closing + group roll-up + opening difference. |
| Ledger / Day Book | `/reports/ledger`, `/day-book` | done | Running balance, particulars (contra-account). |
| Cash/Bank book | derivable from ledger | partial | Dedicated view Phase 3. |
| P&L / Balance Sheet | - | not-started | Phase 3. |
| Outstanding / ageing | existing MES ageing | partial | Reconcile to GL control accounts in Phase 3. |
| GST registers / returns | existing GSTR prep + Phase 2 tax engine | partial | Post to Output/Input GST ledgers in Phase 2. |
| Inventory valuation / COGS | MES stock ledger | not-started | Phase 4; MES qty authoritative. |
| Bank reconciliation | existing `bank_*` | partial | Reuse H2H recon; link to GL Phase 3. |
| Audit trail / approval | `acct.audit_log`, maker-checker | done | Append-only; every action logged. |
| Busy historical migration | - | not-started | Phase 5 (Busy XML export). |

Differences are documented, never concealed. Complete-parity claims require the differential test harness (Phase 5).
