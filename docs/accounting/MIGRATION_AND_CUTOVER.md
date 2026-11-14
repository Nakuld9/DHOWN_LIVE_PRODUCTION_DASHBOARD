# Migration & Cutover (Busy -> DHOWN MES Accounting)

Principle: Busy is the statutory book of record until a deliberate, reviewed cutover.
During parallel running, the same live financial event is never independently posted in both systems.

## Source of truth for how to import
Busy 21 Standard (SM) has no live API at this edition; the lawful, supported data-out path is
`Administration -> Data Export/Import (XML) -> Export Data -> {Masters, Transactions}`
(see memory `project_dhown_busy_bridge`). Migration consumes those authorised XML exports.

## Migration pipeline (Phase 5)
1. Parse Busy XML (masters + transactions). Validate completeness; never silently drop records.
2. Map groups -> `acct.account_groups`, ledgers -> `acct.ledgers`, opening balances -> `acct.ledger_openings`.
3. Preview / dry-run with a reconciliation report (counts + control totals vs the export).
4. Duplicate detection; batched, restartable import; source->target id mapping table.
5. Preserve original voucher numbers/dates/references as metadata.
6. Rollback: imports are tagged by batch; a batch can be reversed before go-live.

## Reconciliation gates (must pass before cutover)
- Trial balance from migrated data = Busy trial balance for the same date (differences itemised).
- Receivables/payables = Busy outstanding. Stock valuation = MES stock x policy, tied to GL.

## Cutover
- Choose a clean period boundary (e.g. FY start). Freeze Busy for new entries from the cutover date.
- Final export -> import -> reconcile -> CA sign-off on policies and statutory outputs.
- Keep Busy read-only as reference for one full statutory cycle. Documented rollback: resume Busy, stop MES posting.

## Not yet in scope
Live operational->accounting posting (Phase 4) and the migration tool (Phase 5) are future phases; Phase 1 is the posting core only.
