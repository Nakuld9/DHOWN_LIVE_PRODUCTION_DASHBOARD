# Accounting Engine — Data Model (`acct` schema)

All amounts `NUMERIC(18,2)`. UUID PKs (`gen_random_uuid()`), except serial line/audit ids.
Reuses `public.financial_years`, `public.partners`, `public.cost_centres`, `public.app_settings`.

| Table | Purpose / key columns |
|---|---|
| `companies` | legal entity. `is_default` (one per DB). name, gstin, state_code, base_currency. |
| `periods` | one row per month per FY. `status OPEN/CLOSED/LOCKED`. FK `fy_id -> public.financial_years`. Unique (company, fy, period_no). |
| `account_groups` | chart-of-accounts groups, self-referencing `parent_id`. `nature ASSET/LIABILITY/INCOME/EXPENSE`, `report BS/PL`. |
| `ledgers` | accounts. `group_id`, `ledger_type GENERAL/PARTY/BANK/CASH/TAX/STOCK`, optional `partner_id -> public.partners`, gstin, state. Unique name per company. |
| `ledger_openings` | opening balance per (company, fy, ledger): one-sided dr_amount/cr_amount. |
| `voucher_types` | SALES, PURCHASE, RECEIPT, PAYMENT, CONTRA, JOURNAL, DEBIT_NOTE, CREDIT_NOTE, SALES_RETURN, PURCHASE_RETURN, REVERSAL. prefix, requires_approval. |
| `voucher_series` | per (company, fy, type) `next_no`, row-locked at post. |
| `vouchers` | header. status DRAFT/VALIDATED/APPROVED/POSTED/REVERSED/CANCELLED. date, party_ledger_id, reference, narration, idempotency_key, reversal links, actor/time audit columns. |
| `voucher_lines` | editable draft lines: ledger_id, dr/cr (one-sided CHECK), cost_centre_id, narration. |
| `journal_entries` | immutable GL header. 1:1 voucher. period_id, posting_date. |
| `journal_lines` | immutable GL lines. ledger_id, posting_date, dr/cr, cost_centre_id. Indexed (company, ledger, date). |
| `audit_log` | append-only event trail: entity, action, actor, detail jsonb. |

### Invariants (DB-enforced)
- journal/audit append-only (triggers); sum(dr)=sum(cr)>0 per JE (deferred trigger);
  no journal into a non-OPEN period (trigger); posted voucher immutable & undeletable (trigger);
  lines editable only in DRAFT/VALIDATED (trigger); dr XOR cr, both >= 0 (CHECK).
