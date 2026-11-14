// Busy read bridge (Phase 1) — a READ-ONLY MIRROR of Busy figures inside the MES DB.
//
// Busy remains the book of accounts. This is a cache of what Busy reports —
// outstanding, bank balance/transactions, stock, trial balance — so the AI
// Accountant can show real numbers and reconcile MES against them. It is NEVER a
// second ledger and never writes back to Busy.
//
// SOURCE-AGNOSTIC by design: rows arrive already normalised (from a Busy export
// file parsed at the edge, or later from the Busy partner API). Every row carries
// a `source` and an `as_of` so the UI can say "as of <when>, from <where>", and a
// stale mirror is obvious rather than silently wrong.
//
// The mirror tables are all prefixed `busy_` and hold only derived/importable data,
// so they can be dropped and re-imported at any time.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const KINDS = ['outstanding', 'bank_balance', 'bank_txns', 'stock', 'trial_balance'];

let ensured = false;

module.exports = (pool) => {
  async function ensure() {
    if (ensured) return;
    await pool.query(`
      -- Party outstanding from Busy (receivables and payables). kind = 'receivable' | 'payable'.
      CREATE TABLE IF NOT EXISTS busy_outstanding (
        party_name   TEXT NOT NULL,
        kind         TEXT NOT NULL DEFAULT 'receivable',
        gstin        TEXT,
        outstanding  NUMERIC(16,2) NOT NULL DEFAULT 0,
        overdue      NUMERIC(16,2) NOT NULL DEFAULT 0,
        as_of        DATE,
        source       TEXT,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (party_name, kind)
      );
      -- Bank/cash account balances from Busy.
      CREATE TABLE IF NOT EXISTS busy_bank_balance (
        account    TEXT PRIMARY KEY,
        balance    NUMERIC(16,2) NOT NULL DEFAULT 0,
        as_of      DATE,
        source     TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      -- Bank transactions from Busy's bank book (for bank-vs-ledger reconciliation).
      CREATE TABLE IF NOT EXISTS busy_bank_txns (
        txn_key     TEXT PRIMARY KEY,     -- stable hash of date|amount|ref|account
        account     TEXT,
        txn_date    DATE,
        description TEXT,
        amount      NUMERIC(16,2) NOT NULL DEFAULT 0,
        direction   TEXT,                 -- 'credit' | 'debit'
        ref         TEXT,
        as_of       DATE,
        source      TEXT,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      -- Stock valuation from Busy.
      CREATE TABLE IF NOT EXISTS busy_stock (
        item       TEXT PRIMARY KEY,
        qty        NUMERIC(16,3) NOT NULL DEFAULT 0,
        uom        TEXT,
        value      NUMERIC(16,2) NOT NULL DEFAULT 0,
        as_of      DATE,
        source     TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      -- Trial balance from Busy (also yields output/input GST + P&L heads).
      CREATE TABLE IF NOT EXISTS busy_trial_balance (
        ledger     TEXT PRIMARY KEY,
        parent     TEXT,
        debit      NUMERIC(16,2) NOT NULL DEFAULT 0,
        credit     NUMERIC(16,2) NOT NULL DEFAULT 0,
        as_of      DATE,
        source     TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS busy_sync_log (
        kind        TEXT PRIMARY KEY,
        as_of       DATE,
        rows        INTEGER,
        source      TEXT,
        imported_by TEXT,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE busy_sync_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);
    ensured = true;
  }

  const hash = (s) => require('crypto').createHash('sha1').update(String(s)).digest('hex').slice(0, 24);
  const num = (v) => Number(String(v == null ? 0 : v).replace(/[₹,\s]/g, '')) || 0;
  const str = (v) => (v == null ? null : String(v).trim());

  // Import normalised rows for one kind. Replaces that kind's mirror wholesale
  // (a fresh Busy export is the full current picture), inside a transaction.
  async function importRows(kind, rows, { as_of = null, source = 'import', by = null } = {}) {
    await ensure();
    if (!KINDS.includes(kind)) return { error: `unknown kind: ${kind}. One of ${KINDS.join(', ')}.` };
    if (!Array.isArray(rows)) return { error: 'rows must be an array' };
    const asOf = as_of || new Date().toISOString().slice(0, 10);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      let n = 0;
      if (kind === 'outstanding') {
        await c.query(`DELETE FROM busy_outstanding`);
        for (const x of rows) {
          const name = str(x.party_name || x.party || x.name); if (!name) continue;
          await c.query(
            `INSERT INTO busy_outstanding (party_name, kind, gstin, outstanding, overdue, as_of, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (party_name, kind) DO UPDATE SET
               gstin=EXCLUDED.gstin, outstanding=EXCLUDED.outstanding, overdue=EXCLUDED.overdue,
               as_of=EXCLUDED.as_of, source=EXCLUDED.source, updated_at=NOW()`,
            [name, (x.kind === 'payable' ? 'payable' : 'receivable'), str(x.gstin),
             r2(num(x.outstanding ?? x.balance)), r2(num(x.overdue)), asOf, source]);
          n++;
        }
      } else if (kind === 'bank_balance') {
        await c.query(`DELETE FROM busy_bank_balance`);
        for (const x of rows) {
          const acc = str(x.account || x.ledger || x.name); if (!acc) continue;
          await c.query(`INSERT INTO busy_bank_balance (account, balance, as_of, source) VALUES ($1,$2,$3,$4)
             ON CONFLICT (account) DO UPDATE SET balance=EXCLUDED.balance, as_of=EXCLUDED.as_of, source=EXCLUDED.source, updated_at=NOW()`,
            [acc, r2(num(x.balance)), asOf, source]);
          n++;
        }
      } else if (kind === 'bank_txns') {
        for (const x of rows) {
          const amount = r2(num(x.amount)); if (!amount) continue;
          const dir = (x.direction === 'debit' || num(x.debit) > 0) ? 'debit' : 'credit';
          const account = str(x.account); const date = str(x.txn_date || x.date); const ref = str(x.ref);
          const key = hash([account, date, amount, ref, str(x.description)].join('|'));
          await c.query(`INSERT INTO busy_bank_txns (txn_key, account, txn_date, description, amount, direction, ref, as_of, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (txn_key) DO UPDATE SET as_of=EXCLUDED.as_of, source=EXCLUDED.source, updated_at=NOW()`,
            [key, account, date, str(x.description), amount, dir, ref, asOf, source]);
          n++;
        }
      } else if (kind === 'stock') {
        await c.query(`DELETE FROM busy_stock`);
        for (const x of rows) {
          const item = str(x.item || x.name); if (!item) continue;
          await c.query(`INSERT INTO busy_stock (item, qty, uom, value, as_of, source) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (item) DO UPDATE SET qty=EXCLUDED.qty, uom=EXCLUDED.uom, value=EXCLUDED.value, as_of=EXCLUDED.as_of, source=EXCLUDED.source, updated_at=NOW()`,
            [item, num(x.qty), str(x.uom), r2(num(x.value)), asOf, source]);
          n++;
        }
      } else if (kind === 'trial_balance') {
        await c.query(`DELETE FROM busy_trial_balance`);
        for (const x of rows) {
          const ledger = str(x.ledger || x.name); if (!ledger) continue;
          await c.query(`INSERT INTO busy_trial_balance (ledger, parent, debit, credit, as_of, source) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (ledger) DO UPDATE SET parent=EXCLUDED.parent, debit=EXCLUDED.debit, credit=EXCLUDED.credit, as_of=EXCLUDED.as_of, source=EXCLUDED.source, updated_at=NOW()`,
            [ledger, str(x.parent || x.group), r2(num(x.debit)), r2(num(x.credit)), asOf, source]);
          n++;
        }
      }
      await c.query(`INSERT INTO busy_sync_log (kind, as_of, rows, source, imported_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (kind) DO UPDATE SET as_of=EXCLUDED.as_of, rows=EXCLUDED.rows, source=EXCLUDED.source, imported_by=EXCLUDED.imported_by, imported_at=NOW()`,
        [kind, asOf, n, source, by]);
      await c.query('COMMIT');
      return { ok: true, kind, imported: n, as_of: asOf };
    } catch (e) { await c.query('ROLLBACK'); return { error: e.message }; }
    finally { c.release(); }
  }

  async function status() {
    await ensure();
    const log = (await pool.query(`SELECT kind, as_of, rows, source, imported_at FROM busy_sync_log ORDER BY kind`)).rows;
    const has = log.length > 0;
    return { connected: has, kinds: log,
      note: has ? 'Busy mirror populated from imports. Busy remains the book of accounts.' : 'No Busy data imported yet — the "In Busy" fields stay unavailable until a Busy export is imported.' };
  }

  // Getters the finance layer uses to fill the "In Busy" fields when present.
  async function bankBalance() {
    await ensure();
    const r = (await pool.query(`SELECT COALESCE(SUM(balance),0) total, MAX(as_of) as_of, COUNT(*) n FROM busy_bank_balance`)).rows[0];
    if (!Number(r.n)) return null;
    return { total: r2(r.total), as_of: r.as_of, accounts: Number(r.n) };
  }
  async function payablesTotal() {
    await ensure();
    const r = (await pool.query(`SELECT COALESCE(SUM(outstanding),0) total, COALESCE(SUM(overdue),0) overdue, MAX(as_of) as_of, COUNT(*) n FROM busy_outstanding WHERE kind='payable'`)).rows[0];
    if (!Number(r.n)) return null;
    return { total: r2(r.total), overdue: r2(r.overdue), as_of: r.as_of, suppliers: Number(r.n) };
  }
  async function gstFromTrialBalance() {
    await ensure();
    const rows = (await pool.query(`SELECT ledger, debit, credit FROM busy_trial_balance
       WHERE ledger ILIKE '%gst%' OR ledger ILIKE '%igst%' OR ledger ILIKE '%cgst%' OR ledger ILIKE '%sgst%' OR ledger ILIKE '%itc%'`)).rows;
    if (!rows.length) return null;
    // Input credit (debit balances) vs output (credit balances) — approximate from the TB heads.
    const input = rows.filter(r => /input|itc/i.test(r.ledger)).reduce((s, r) => s + Number(r.debit || 0), 0);
    const output = rows.filter(r => /output|payable/i.test(r.ledger)).reduce((s, r) => s + Number(r.credit || 0), 0);
    return { input_itc: r2(input), output_tax: r2(output), net: r2(output - input), ledgers: rows.length };
  }

  return { ensure, importRows, status, bankBalance, payablesTotal, gstFromTrialBalance, KINDS };
};
