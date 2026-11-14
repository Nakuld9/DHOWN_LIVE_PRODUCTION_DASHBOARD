# Migrations

For schema or data changes that **cannot be expressed idempotently** — backfills,
column type changes, one-off data corrections.

## When NOT to put something here

Most changes do not belong here. If the change is "this table/column should
exist", add it to the relevant `ensure*()` function in `src/db/schema.js`
instead. Those run on every boot, are idempotent, and are what brings a brand-new
tenant database up to the current shape.

Use a migration only when the change must run **exactly once**:

- backfilling a new column from existing rows
- changing a column's type where data must be converted
- correcting bad data
- dropping something that `CREATE ... IF NOT EXISTS` cannot un-create

## Writing one

Name it with a numeric prefix; they apply in filename order.

```js
// migrations/0001-backfill-invoice-due-dates.js
module.exports = {
  async up(client) {
    // client is inside a transaction — throwing rolls the whole migration back.
    await client.query(`UPDATE tax_invoices SET ... WHERE ...`);
  },

  // Optional. See the honesty note below before relying on it.
  async down(client) {},
};
```

Each migration runs in **its own transaction**. A failure stops the run rather
than continuing, because later migrations normally assume earlier ones.

## Running

Applied automatically at boot, after the `ensure*()` steps (a migration that
alters a table needs the table to exist first).

```bash
npm run migrate:status    # what is applied, what is pending, schema fingerprint
npm run migrate           # apply pending
```

## Never edit an applied migration

The runner stores a checksum. If a file changes after being applied it logs a
**drift warning**, because the record then says "applied" without saying *what*
was applied — and two servers can silently differ. Add a new migration instead.

## On rollback

`down()` is supported but is not the real rollback story. A destructive change is
reversed by restoring a backup — see `docs/DISASTER_RECOVERY.md`, which is
rehearsed and timed. A `down()` that drops a column is just another untested
destructive path, and writing one can give false confidence.

## Baseline

The 20 `migration_*.js` scripts in `backend/` predate this runner and were applied
by hand. They are recorded as a single baseline row rather than re-run: the
`ensure*()` functions already build everything they created, so re-running them
would be at best a no-op and at worst destructive.
