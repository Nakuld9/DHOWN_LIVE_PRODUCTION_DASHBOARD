// Referential integrity on the money tables.
//
// The failure these guard against is silent: an orphaned payment does not error,
// it simply stops appearing in a balance, because outstanding is computed from a
// join. So what is asserted here is that the database now REFUSES the writes
// that would create one — and that a refusal reads as a decision rather than a
// crash.
//
//   node tests/integrity.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { friendly } = require('../src/lib/db-errors');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};

// Run a statement expecting it to be rejected; return the pg error.
async function expectReject(sql, params) {
  try { await pool.query(sql, params); return null; }
  catch (e) { return e; }
}

(async () => {
  const tag = 'ZZI' + Date.now().toString().slice(-7);
  let pid, invId;

  try {
    console.log('\nOrphans are refused');
    const e1 = await expectReject(
      `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
       VALUES ($1, 99999999, CURRENT_DATE, 100, 'ISSUED')`, ['ZZ-ORPHAN-' + tag]);
    ok(e1 && e1.code === '23503', 'an invoice for a non-existent customer is rejected', e1 ? e1.code : 'ACCEPTED');

    const e2 = await expectReject(
      `INSERT INTO payments (receipt_no, partner_id, amount) VALUES ($1, 99999999, 100)`, ['ZZ-P-' + tag]);
    ok(e2 && e2.code === '23503', 'a receipt for a non-existent customer is rejected', e2 ? e2.code : 'ACCEPTED');

    // Set up a real customer + invoice for the delete tests.
    pid = (await pool.query(
      `INSERT INTO partners (partner_code, company_name) VALUES ($1,'ZZ Integrity Test') RETURNING partner_id`,
      [tag])).rows[0].partner_id;
    invId = (await pool.query(
      `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
       VALUES ($1,$2,CURRENT_DATE,1000,'ISSUED') RETURNING invoice_id`, ['ZZINV-' + tag, pid])).rows[0].invoice_id;

    const e3 = await expectReject(
      `INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (99999999, $1, 10)`, [invId]);
    ok(e3 && e3.code === '23503', 'an allocation against a non-existent receipt is rejected');

    console.log('\nFinancial history cannot be deleted out from under itself');
    const e4 = await expectReject(`DELETE FROM partners WHERE partner_id=$1`, [pid]);
    // ON DELETE RESTRICT raises 23001 (restrict_violation), not 23503.
    ok(e4 && (e4.code === '23001' || e4.code === '23503'), 'a customer holding invoices cannot be deleted', e4 ? '' : 'DELETED — protection missing');
    ok(!!(await pool.query(`SELECT 1 FROM partners WHERE partner_id=$1`, [pid])).rows.length,
      'and the customer is still there');

    console.log('\nA refusal reads as a decision, not a crash');
    const f = friendly(e4);
    ok(f && f.status === 409, 'mapped to 409 rather than 500', f ? String(f.status) : 'not mapped');
    ok(f && /Cannot delete/.test(f.error) && /invoices/.test(f.error),
      'and names what is blocking it', f ? f.error.slice(0, 80) : '');
    ok(!/violates foreign key constraint/.test(f?.error || ''),
      'without leaking raw Postgres text');

    console.log('\nCascade still applies where it should');
    await pool.query(
      `INSERT INTO tax_invoice_items (invoice_id, item_name, quantity, uom, rate, gst_rate, taxable_value)
       VALUES ($1,'ZZ Line',1,'KG',100,18,100)`, [invId]);
    await pool.query(`DELETE FROM tax_invoices WHERE invoice_id=$1`, [invId]);
    ok((await pool.query(`SELECT COUNT(*)::int n FROM tax_invoice_items WHERE invoice_id=$1`, [invId])).rows[0].n === 0,
      'deleting an invoice takes its own lines with it');
    invId = null;

    console.log('\nOnce free of history, the customer deletes normally');
    await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]);
    ok((await pool.query(`SELECT COUNT(*)::int n FROM partners WHERE partner_id=$1`, [pid])).rows[0].n === 0,
      'the protection is conditional, not absolute');
    pid = null;

    console.log('\nEvery money-table foreign key is present and indexed');
    const expected = [
      'tax_invoices_partner_id_fk', 'payments_partner_id_fk', 'payment_allocations_invoice_id_fk',
      'sales_returns_partner_id_fk', 'sales_returns_invoice_id_fk', 'sales_returns_dispatch_id_fk',
      'credit_notes_partner_id_fk', 'credit_notes_invoice_id_fk', 'credit_note_allocations_invoice_id_fk',
      'lot_allocations_partner_id_fk', 'lot_allocation_rolls_roll_id_fk',
      'eway_bills_dispatch_id_fk', 'eway_bills_invoice_id_fk', 'eway_bills_partner_id_fk',
      'delivery_proofs_dispatch_id_fk',
    ];
    const have = (await pool.query(
      `SELECT conname FROM pg_constraint WHERE contype='f' AND conname = ANY($1)`, [expected]))
      .rows.map(r => r.conname);
    const missing = expected.filter(n => !have.includes(n));
    ok(missing.length === 0, `all ${expected.length} constraints present`, missing.join(', ') || '');

    // An unindexed foreign key makes every parent delete scan the child.
    const unindexed = await pool.query(`
      SELECT c.conrelid::regclass::text AS child, a.attname AS col
        FROM pg_constraint c
        JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
       WHERE c.contype='f' AND c.conname = ANY($1)
         AND NOT EXISTS (SELECT 1 FROM pg_index i
                          WHERE i.indrelid=c.conrelid AND i.indkey[0]=a.attnum)`, [expected]);
    ok(unindexed.rows.length === 0, 'and every one has a supporting index',
      unindexed.rows.map(r => `${r.child}.${r.col}`).join(', ') || 'all indexed');

    console.log('\nEvery foreign key in the schema is indexed');
    // Stated as a whole-schema invariant rather than a list, so a key added
    // later fails here instead of waiting for the next audit to notice.
    // Postgres indexes the parent side automatically but never the child, so
    // without this a parent delete scans the entire child table.
    const anyUnindexed = await pool.query(`
      SELECT c.conrelid::regclass::text AS child, a.attname AS col
        FROM pg_constraint c
        JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.contype = 'f'
         AND c.connamespace = 'public'::regnamespace
         AND NOT EXISTS (SELECT 1 FROM pg_index i
                          WHERE i.indrelid = c.conrelid AND i.indkey[0] = a.attnum)`);
    ok(anyUnindexed.rows.length === 0,
      'no foreign key anywhere lacks a leading-column index',
      anyUnindexed.rows.map(r => `${r.child}.${r.col}`).join(', ') || 'all covered');

    console.log('\nRESTRICT, not CASCADE, on the money tables');
    const cascading = await pool.query(
      `SELECT conname FROM pg_constraint
        WHERE conname = ANY($1) AND confdeltype = 'c'`, [expected]);
    ok(cascading.rows.length === 0,
      'no money-table key silently cascades a delete',
      cascading.rows.map(r => r.conname).join(', ') || 'none');
  } finally {
    if (invId) await pool.query(`DELETE FROM tax_invoices WHERE invoice_id=$1`, [invId]).catch(() => {});
    if (pid) await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM tax_invoices WHERE invoice_number LIKE $1`, ['ZZ%' + tag]).catch(() => {});
  }

  // ── No test data left behind in a real database ─────────────────────────
  //
  // Every suite here creates throwaway customers prefixed ZZ and deletes them
  // in a finally. That is not enough on its own: if a run is interrupted — a
  // killed process, a crash before the finally — the rows survive, and nothing
  // ever complains. They are not harmless. A leftover ZZ customer carries real
  // invoice rows, so it lands in the ageing report, the debtors total and the
  // GST summary; 410,000 of fabricated invoices was found sitting in dhown_mes
  // exactly this way, backed up to DHOWN_BACKUPS/removed_test_rows_*.json and
  // deleted.
  //
  // Asserting it here turns silent pollution of the financial reports into a
  // failing test.
  console.log('\nNo test artifacts left in the database');
  const junk = await pool.query(
    `SELECT partner_id, partner_code, company_name FROM partners
      WHERE company_name LIKE 'ZZ %' OR partner_code LIKE 'ZZ%' OR partner_code LIKE 'LOAD%'
      ORDER BY partner_id`);
  ok(junk.rows.length === 0,
    'no leftover ZZ/LOAD test customers',
    junk.rows.map(r => `${r.partner_id}:${r.company_name}`).join(', ') || 'none');

  const junkInv = await pool.query(
    `SELECT COUNT(*)::int n, COALESCE(SUM(grand_total),0) v FROM tax_invoices
      WHERE invoice_number LIKE 'ZZ%' OR invoice_number LIKE 'LT-LOAD%'`);
  ok(junkInv.rows[0].n === 0,
    'no leftover test invoices inflating the debtors total',
    `${junkInv.rows[0].n} invoices worth ${junkInv.rows[0].v}`);

  // Machines are worse than most artifacts because they show up in the machine
  // grid, the shop-floor screens and the OEE reports — the operator sees them.
  // A quality-gate test once left 13 "ZZ QC Machine" rows here because its
  // cleanup keyed on a roll id that was recomputed differently at teardown; the
  // machine delete then failed silently on the roll foreign key. This check
  // turns that whole class of leak into a failing test rather than a support
  // question ("why are there machines with ZZ names?").
  const junkMc = await pool.query(
    `SELECT machine_id FROM machines WHERE machine_id LIKE 'ZZ%' OR machine_name LIKE 'ZZ %'`);
  ok(junkMc.rows.length === 0,
    'no leftover ZZ test machines in the machine list',
    junkMc.rows.map(r => r.machine_id).join(', ') || 'none');

  const junkRoll = await pool.query(
    `SELECT COUNT(*)::int n FROM rolls WHERE roll_id ~ '^999[0-9]{5}$' OR machine_id LIKE 'ZZ%'`);
  ok(junkRoll.rows[0].n === 0,
    'no leftover test rolls on the shop floor', `${junkRoll.rows[0].n}`);

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
