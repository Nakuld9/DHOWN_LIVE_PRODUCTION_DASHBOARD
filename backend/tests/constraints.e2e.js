// Domain CHECK constraints.
//
// The audit found 15 CHECKs across 118 tables — quantities, money and statuses
// were validated in JavaScript and nowhere else. That holds only while every
// write goes through the app. A manual SQL fix, a future service, or a bug in
// one handler could put a negative invoice into the books, and nothing would
// complain until someone read a report that did not add up.
//
// So these tests bypass the application entirely and write straight to the
// database. That is the point: if the constraint only exists in JavaScript,
// every assertion below fails.
//
//   node tests/constraints.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

// Try a write and report whether the DATABASE refused it (23514 = check_violation).
async function refused(sql, params = []) {
  try {
    await pool.query(sql, params);
    return { refused: false };
  } catch (e) {
    return { refused: e.code === '23514', code: e.code, msg: e.message.split('\n')[0] };
  }
}

const TAG = 'ZZCK' + Date.now().toString().slice(-6);
let pid;

(async () => {
  pid = (await pool.query(
    `INSERT INTO partners (partner_code, company_name) VALUES ($1,'ZZ Constraint Test') RETURNING partner_id`,
    [TAG])).rows[0].partner_id;

  try {
    console.log('\nMoney cannot go negative');
    const negInvoice = await refused(
      `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
       VALUES ($1,$2,CURRENT_DATE,-5000,'ISSUED')`, [TAG + '-NEG', pid]);
    ok(negInvoice.refused, 'an invoice with a negative total is rejected by the database',
      negInvoice.code || 'ACCEPTED — the constraint is missing');

    const negPayment = await refused(
      `INSERT INTO payments (receipt_no, partner_id, amount, payment_date, status)
       VALUES ($1,$2,-1000,CURRENT_DATE,'ACTIVE')`, [TAG + '-NEGPAY', pid]);
    ok(negPayment.refused, 'a negative receipt is rejected', negPayment.code || 'ACCEPTED');

    console.log('\nBut zero and positive are fine');
    const zero = await refused(
      `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
       VALUES ($1,$2,CURRENT_DATE,0,'ISSUED')`, [TAG + '-ZERO', pid]);
    ok(zero.refused === false, 'a zero-value invoice is allowed — it is unusual, not impossible');

    console.log('\nStatus values are constrained where the set is known');
    const badStatus = await refused(
      `INSERT INTO payments (receipt_no, partner_id, amount, payment_date, status)
       VALUES ($1,$2,100,CURRENT_DATE,'PROBABLY')`, [TAG + '-BADST', pid]);
    ok(badStatus.refused, 'an invented payment status is rejected', badStatus.code || 'ACCEPTED');

    const goodStatus = await refused(
      `INSERT INTO payments (receipt_no, partner_id, amount, payment_date, status)
       VALUES ($1,$2,100,CURRENT_DATE,'CANCELLED')`, [TAG + '-OKST', pid]);
    ok(goodStatus.refused === false, 'a real one is accepted', goodStatus.msg || '');

    console.log('\nBalances are deliberately NOT constrained');
    // An overdraft is a real thing. Constraining a balance to be positive would
    // be wrong, not merely inconvenient.
    const acctId = (await pool.query(
      `INSERT INTO bank_accounts (account_name, opening_balance) VALUES ($1,-25000) RETURNING account_id`,
      ['ZZ Overdraft ' + TAG])).rows[0].account_id;
    ok(!!acctId, 'a bank account can open with a negative balance (overdraft)');
    await pool.query(`DELETE FROM bank_accounts WHERE account_id=$1`, [acctId]);

    console.log('\nNULL is not the same as negative');
    // A CHECK is only violated by a definite false, so an unknown quantity is
    // still allowed — that is a different problem from a negative one.
    const nullQty = await refused(
      `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
       VALUES ($1,$2,CURRENT_DATE,NULL,'ISSUED')`, [TAG + '-NULL', pid]);
    ok(nullQty.refused === false, 'an unknown total is allowed through');

    console.log('\nCoverage');
    const n = (await pool.query(`SELECT COUNT(*)::int n FROM pg_constraint WHERE contype='c'`)).rows[0].n;
    ok(n >= 150, 'the schema carries real domain constraints now', `${n} CHECK constraints (was 18)`);

    const money = (await pool.query(`
      SELECT COUNT(*)::int n FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
       WHERE c.contype='c' AND c.conname LIKE 'ck_%_nonneg'
         AND t.relname IN ('tax_invoices','payments','credit_notes','sales_orders','dispatch_challans')`)).rows[0].n;
    ok(money >= 5, 'including the money tables', `${money} on the financial tables`);

    console.log('\nNo negative duration can be stored');
    // This one had a real violation: a stored duration of -0.0000153 minutes
    // from two NOW() calls interleaving. The source query now clamps at zero.
    const negDur = await refused(
      `INSERT INTO machine_status_log (machine_id, status, shift, start_time, duration_minutes)
       VALUES ('ZZ01','OFFLINE','A',NOW(),-1)`);
    ok(negDur.refused, 'a negative duration is rejected', negDur.code || 'ACCEPTED');

    console.log('\nA refusal reads as a decision, not a database error');
    // "That value is not allowed" tells an operator nothing about which of
    // twenty fields on the form to fix. The constraint names carry that.
    const { friendly } = require('../src/lib/db-errors');
    let caught = null;
    try {
      await pool.query(
        `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
         VALUES ($1,$2,CURRENT_DATE,-1,'ISSUED')`, [TAG + '-MSG', pid]);
    } catch (e) { caught = e; }
    const f = caught && friendly(caught);
    ok(!!f && f.status === 400, 'a check violation maps to a 400, not a 500');
    ok(!!f && /grand total cannot be negative/i.test(f.error),
      'and the message names the field and the reason', f ? f.error : 'no message');

    let badStatusErr = null;
    try {
      await pool.query(
        `INSERT INTO payments (receipt_no, partner_id, amount, payment_date, status)
         VALUES ($1,$2,10,CURRENT_DATE,'NONSENSE')`, [TAG + '-MSG2', pid]);
    } catch (e) { badStatusErr = e; }
    const f2 = badStatusErr && friendly(badStatusErr);
    ok(!!f2 && /not a valid status/i.test(f2.error),
      'and an invalid domain value says so plainly', f2 ? f2.error : 'no message');

  } finally {
    await pool.query(`DELETE FROM payments WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM tax_invoices WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM machine_status_log WHERE machine_id='ZZ01'`).catch(() => {});
    await pool.query(`DELETE FROM bank_accounts WHERE account_name LIKE 'ZZ Overdraft%'`).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
