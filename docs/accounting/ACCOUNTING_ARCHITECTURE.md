# Accounting Engine — Architecture

A double-entry accounting subsystem inside DHOWN MES, built independently and
inspired by Busy's *behaviour* (black-box), not its code or assets.

## Shape
A modular monolith inside the existing Express app. One PostgreSQL schema `acct`,
reusing `public.{financial_years, partners, cost_centres, app_settings}`.

```
backend/src/lib/accounting/
  schema.js    ensureAccountingSchema(pool) — tables, triggers, seed COA/voucher-types/periods (idempotent, boot-time)
  rules.js     PURE functions (no DB): money (integer paise), line validation, state machine, reversal. Unit-tested.
  service.js   THE authoritative service — the only writer of journals. Transactions, row locks, idempotency.
backend/src/routes/accounting.routes.js   thin HTTP at /api/acct — validate input, check role, call service
backend/test/accounting-rules.test.js     16 unit tests (pure rules)
backend/tests/accounting.e2e.js            47 integration tests (scratch DB only)
```

## Layering rules (enforced by construction)
- React never computes authoritative balances/tax — it calls `/api/acct`.
- Express handlers contain **no** posting logic — they delegate to `service.js`.
- MES modules do **not** write to `acct.*`. (When operational→accounting posting
  is added, it will go through `service.createDraft/postVoucher` behind a
  transactional outbox, never a direct journal insert.)

## The posting path (single source of truth)
`createDraft → validate → [approve] → post`, or `reverse`.

`postVoucher` runs in one transaction and:
1. locks the voucher row (`FOR UPDATE`) — a second concurrent post sees POSTED and returns idempotently;
2. re-loads lines and **re-validates** (never trusts the caller's maths);
3. takes `FOR SHARE` on the period row — blocks a concurrent period-close;
4. locks the numbering series row (`FOR UPDATE`) and allocates a gap-free number;
5. writes the immutable `journal_entries` + `journal_lines`;
6. flips the voucher to POSTED and records the number + audit row.

## Defence in depth (database-level, independent of the app)
- `journal_entries`, `journal_lines`, `audit_log` have `BEFORE UPDATE/DELETE` triggers that raise — **append-only**.
- A **deferred constraint trigger** re-checks Σdr = Σcr (> 0) at COMMIT.
- A trigger refuses any journal into a non-`OPEN` period.
- Voucher-line changes are refused once the voucher leaves DRAFT/VALIDATED.
- A posted voucher may only transition to REVERSED (nothing else may change), and posted/reversed vouchers cannot be deleted.
- Line-level CHECKs: one-sided (`dr XOR cr`), non-negative.

These were verified by tests that try to tamper via raw SQL and are rejected.

## Corrections
History is never edited. A correction posts a REVERSAL voucher (Dr/Cr swapped)
and marks the original REVERSED, pointing at its reversal.

## Isolation & safety
- `acct` schema keeps the engine clear of the `public` auto-`>=0` CHECK scanner (signed balances safe).
- `company_id` on every row; tests prove another company's ledger cannot be used.
- Integration tests run only on `dhown_mes_staging` and refuse production DBs.
- Busy remains the statutory book of record; this engine posts nothing from live
  MES events until a documented cutover.
