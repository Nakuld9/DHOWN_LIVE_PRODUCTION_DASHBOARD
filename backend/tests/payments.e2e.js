// End-to-end checks for payments, allocation and ageing.
//
// These run against the real database on an isolated throwaway customer, and
// clean up after themselves. They exist because the failure mode here is money
// quietly being wrong rather than anything crashing: an over-allocation, an
// ageing bucket computed on the invoice total instead of the balance, or the
// credit gate disagreeing with what Customer-360 shows the same person.
//
//   node tests/payments.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const pay = require('../src/lib/payments')(pool);
const approvals = require('../src/lib/wa-approvals')(pool);

const R = (n) => Math.round(Number(n) * 100) / 100;
let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};

(async () => {
  const pid = (await pool.query(
    `INSERT INTO partners (partner_code, company_name, credit_limit, credit_days)
     VALUES ($1,'ZZ Payment Test',500000,30) RETURNING partner_id`,
    ['ZZPAY' + Date.now().toString().slice(-6)])).rows[0].partner_id;

  const mkInvoice = async (total, daysAgo) => (await pool.query(
    `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
     VALUES ($1,$2,CURRENT_DATE - $3::int,$4,'ISSUED') RETURNING invoice_id`,
    ['ZZTEST-' + Math.random().toString(36).slice(2, 9), pid, daysAgo, total])).rows[0].invoice_id;

  try {
    const oldInv = await mkInvoice(200000, 75); // 45 days past 30-day terms
    await mkInvoice(100000, 5);                 // still within terms

    console.log('\nBaseline');
    let o = await pay.outstanding(pid);
    ok(o.outstanding === 300000, 'outstanding is the sum of unpaid invoices', `got ${o.outstanding}`);
    ok(o.overdue === 200000, 'only the past-terms invoice is overdue', `got ${o.overdue}`);
    ok(o.ageing.d31_60 === 200000 && o.ageing.current === 100000,
      'ageing bucketed by days past due', JSON.stringify(o.ageing));

    console.log('\nPart payment');
    const r1 = await pay.record({ partner_id: pid, amount: 50000, mode: 'NEFT', created_by: 'test' });
    ok(r1.allocated.length === 1 && r1.allocated[0].invoice_id === oldInv,
      'auto-allocation applies to the oldest invoice first');
    ok(r1.outstanding.outstanding === 250000, 'part-payment reduces outstanding', `got ${r1.outstanding.outstanding}`);
    ok(r1.outstanding.overdue === 150000, 'part-payment reduces overdue too, not just outstanding', `got ${r1.outstanding.overdue}`);
    ok((await pool.query(`SELECT status FROM tax_invoices WHERE invoice_id=$1`, [oldInv])).rows[0].status === 'ISSUED',
      'a part-paid invoice stays ISSUED');

    console.log('\nOver-allocation');
    const r2 = await pay.record({ partner_id: pid, amount: 999999, created_by: 'test' });
    ok(r2.unallocated === 749999, 'excess is held on account, not forced onto invoices', `got ${r2.unallocated}`);
    const alloc = await pool.query(
      `SELECT i.grand_total, COALESCE(SUM(pa.amount),0) a
         FROM tax_invoices i
         LEFT JOIN payment_allocations pa ON pa.invoice_id = i.invoice_id
        WHERE i.partner_id=$1 GROUP BY i.invoice_id, i.grand_total`, [pid]);
    ok(alloc.rows.every(x => Number(x.a) <= Number(x.grand_total) + 0.009),
      'no invoice is ever allocated more than it is worth',
      alloc.rows.map(x => `${R(x.a)}/${R(x.grand_total)}`).join(' '));
    o = await pay.outstanding(pid);
    ok(o.outstanding === 0 && o.overdue === 0, 'fully settled leaves nothing outstanding', `got ${o.outstanding}/${o.overdue}`);
    ok((await pool.query(`SELECT COUNT(*)::int n FROM tax_invoices WHERE partner_id=$1 AND status='PAID'`, [pid])).rows[0].n === 2,
      'settled invoices flip to PAID');

    console.log('\nCredit gate agrees with the ledger');
    const c1 = await approvals.creditCheck(pid, 10000);
    ok(c1.ok === true, 'a fully-paid customer is cleared', JSON.stringify(c1.reason || 'ok'));
    ok(c1.outstanding === 0, 'the gate reads the same outstanding Customer-360 shows', `got ${c1.outstanding}`);

    console.log('\nCancellation');
    const cx = await pay.cancel(r2.payment.payment_id, { by: 'test', reason: 'e2e' });
    ok(cx.ok === true, 'cancel succeeds');
    ok(cx.outstanding.outstanding === 250000, 'cancelling restores the balance', `got ${cx.outstanding.outstanding}`);
    ok((await pool.query(`SELECT COUNT(*)::int n FROM tax_invoices WHERE partner_id=$1 AND status='PAID'`, [pid])).rows[0].n === 0,
      'reopened invoices flip back to ISSUED');
    const c2 = await approvals.creditCheck(pid, 10000);
    ok(c2.ok === false && c2.reason === 'OVERDUE', 'the credit gate re-blocks after cancellation', `got ${c2.reason}`);
    ok((await pay.cancel(r2.payment.payment_id, { by: 'test' })).code === 404, 'a payment cannot be cancelled twice');

    console.log('\nLedger and guards');
    const led = await pay.ledger(pid);
    ok(R(led[led.length - 1].balance) === 250000, 'ledger closing balance matches outstanding', `got ${led[led.length - 1].balance}`);
    ok(!led.some(x => x.kind === 'PAYMENT' && x.credit === 999999), 'a cancelled payment is excluded from the ledger');
    ok((await pay.record({ partner_id: pid, amount: -5 })).code === 400, 'a negative amount is rejected');
    ok((await pay.record({ partner_id: pid, amount: 0 })).code === 400, 'a zero amount is rejected');
    ok((await pay.record({ amount: 100 })).code === 400, 'a payment with no customer is rejected');

    console.log('\nCollections worklist');
    const row = (await pay.ageingReport()).find(x => x.partner_id === pid);
    ok(row && row.overdue === 150000, 'ageing report reports balance, not invoice total', row ? `got ${row.overdue}` : 'customer missing');

    console.log('\nAdvance payment, then an invoice for it');
    // r2 left 749999 sitting on account after settling everything, then was
    // cancelled above. Take a clean advance and bill against it.
    const adv = await pay.record({ partner_id: pid, amount: 400000, mode: 'RTGS', created_by: 'test' });
    ok(adv.unallocated === 150000, 'advance beyond the open balance stays unapplied', `got ${adv.unallocated}`);
    let cr = await pay.creditOnAccount(pid);
    ok(cr.total === 150000, 'unapplied money is visible as on-account credit', `got ${cr.total}`);

    const future = await mkInvoice(90000, 0);
    ok((await pay.outstanding(pid)).outstanding === 90000, 'the new invoice is outstanding until credit is applied');
    const ap = await pay.applyCredit(pid, { by: 'test' });
    ok(ap.applied.some(x => x.invoice_id === future && x.amount === 90000),
      'on-account credit is applied to the new invoice');
    ok(ap.outstanding.outstanding === 0, 'outstanding clears without new money changing hands', `got ${ap.outstanding.outstanding}`);
    ok(ap.credit.total === 60000, 'the unused remainder stays on account', `got ${ap.credit.total}`);
    ok((await pay.applyCredit(pid, { by: 'test' })).applied.length === 0,
      'applying credit again with nothing open is a no-op');
    const allocTotal = (await pool.query(
      `SELECT COALESCE(SUM(pa.amount),0) a FROM payment_allocations pa
         JOIN payments pm ON pm.payment_id = pa.payment_id WHERE pm.partner_id=$1`, [pid])).rows[0].a;
    const payTotal = (await pool.query(
      `SELECT COALESCE(SUM(amount),0) a FROM payments WHERE partner_id=$1 AND status='ACTIVE'`, [pid])).rows[0].a;
    ok(Number(allocTotal) <= Number(payTotal) + 0.009,
      'total allocated never exceeds total money received', `${R(allocTotal)} of ${R(payTotal)}`);
    console.log('\nConcurrent receipts do not deadlock or over-allocate');
    // A load test found record() holding one pool connection while asking for a
    // second, which deadlocked the whole pool: 20 concurrent receipts took 305
    // seconds and all 20 failed. This asserts both halves of the fix — they
    // complete quickly, and the advisory lock still makes the arithmetic exact.
    const cInv = (await pool.query(
      `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
       VALUES ($1,$2,CURRENT_DATE,20000,'ISSUED') RETURNING invoice_id`,
      ['ZZCONC-' + Math.random().toString(36).slice(2, 9), pid])).rows[0].invoice_id;
    const started = Date.now();
    const posted = await Promise.all(Array.from({ length: 20 }, () =>
      pay.record({ partner_id: pid, amount: 1000, mode: 'NEFT', created_by: 'conc' })));
    const took = Date.now() - started;
    ok(posted.every(r => r && r.payment), 'all 20 concurrent receipts complete', `${took}ms`);
    ok(took < 30000, 'and finish quickly rather than deadlocking the pool', `${took}ms`);
    const allocated = Number((await pool.query(
      `SELECT COALESCE(SUM(amount),0) a FROM payment_allocations WHERE invoice_id=$1`, [cInv])).rows[0].a);
    ok(allocated === 20000, 'exactly the invoice total is allocated, never more', `got ${allocated}`);
    const cBal = Number((await pool.query(
      `SELECT balance FROM v_invoice_balances WHERE invoice_id=$1`, [cInv])).rows[0].balance);
    ok(cBal === 0, 'and the balance is zero, never negative', `got ${cBal}`);

    console.log('\nStatement of account');
    // The statement is what gets sent to a customer who disputes a balance, so
    // the two things that must hold are that it opens from real history and
    // that it agrees with the outstanding figure the credit gate uses.
    const st = await pay.statement(pid, {});
    // Not "closing === outstanding": this customer is sitting on 60,000 of
    // advance, so the ledger closes negative while outstanding floors at zero.
    // reconciles checks the identity that actually holds — see statement().
    ok(st.reconciles === true,
      'closing balance reconciles with the invoice-balance ledger',
      `closing ${st.closing}, outstanding ${st.outstanding}`);
    ok(st.lines.length > 0 && st.opening === 0,
      'an open-ended statement opens at zero and lists the history', `${st.lines.length} lines`);
    ok(st.lines[st.lines.length - 1].balance === st.closing,
      'the running balance ends at the closing balance');

    // A statement for a window must carry the prior balance forward. Opening at
    // zero would tell the customer they owe only this period's invoices.
    // A far-future date, not "tomorrow" computed in Node: the server runs in IST
    // and Node's toISOString is UTC, so around midnight the two disagree about
    // what day it is and the boundary case silently stops being tested.
    const later = await pay.statement(pid, { from: '2099-01-01' });
    ok(later.lines.length === 0, 'a period with no activity lists nothing');
    ok(later.opening === st.closing && later.closing === st.closing,
      'and still carries the balance forward as its opening', `opening ${later.opening}`);

    // Credit notes were missing from the ledger union. v_invoice_balances nets
    // them off, so without them a statement drifts above the real balance the
    // first time a sales return is approved.
    const cnInv = await mkInvoice(50000, 10);
    // status is left to default to ACTIVE, exactly as returns.js does. Writing
    // some other value here would test a note the balance views never count.
    const noteId = (await pool.query(
      `INSERT INTO credit_notes (note_number, note_date, partner_id, invoice_id, amount, taxable_value, tax_amount)
       VALUES ($1, CURRENT_DATE, $2, $3, 5000, 5000, 0) RETURNING note_id`,
      ['ZZCN-' + Math.random().toString(36).slice(2, 8), pid, cnInv])).rows[0].note_id;

    const unallocated = await pay.statement(pid, {});
    ok(unallocated.lines.some(l => l.kind === 'CREDIT_NOTE'),
      'a credit note appears on the statement');
    ok(unallocated.reconciles === true,
      'an unallocated credit note still reconciles', `closing ${unallocated.closing}`);

    // Allocating it against the invoice must not change the customer's overall
    // position — the money was already credited to them when the note was
    // raised. If allocation moved the closing balance, the note would be
    // counted twice.
    const before = unallocated.closing;
    await pool.query(
      `INSERT INTO credit_note_allocations (note_id, invoice_id, amount) VALUES ($1,$2,5000)`,
      [noteId, cnInv]);
    const afterAlloc = await pay.statement(pid, {});
    ok(afterAlloc.closing === before,
      'allocating the note leaves the closing balance unchanged', `${before} then ${afterAlloc.closing}`);
    ok(afterAlloc.reconciles === true,
      'and it still reconciles once allocated', `closing ${afterAlloc.closing}`);

    ok((await pay.statement(99999999, {})).code === 404, 'an unknown customer is a 404');

  } finally {
    await pool.query(`DELETE FROM credit_note_allocations WHERE note_id IN (SELECT note_id FROM credit_notes WHERE partner_id=$1)`, [pid]);
    await pool.query(`DELETE FROM credit_notes WHERE partner_id=$1`, [pid]);
    await pool.query(`DELETE FROM payment_allocations WHERE payment_id IN (SELECT payment_id FROM payments WHERE partner_id=$1)`, [pid]);
    await pool.query(`DELETE FROM payments WHERE partner_id=$1`, [pid]);
    await pool.query(`DELETE FROM tax_invoices WHERE partner_id=$1`, [pid]);
    await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]);
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
