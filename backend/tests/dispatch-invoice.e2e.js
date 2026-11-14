// Auto-invoice on dispatch: a priced dispatch raises a DRAFT tax invoice, linked
// by dispatch_challans.invoice_id, idempotently. Unpriced dispatches are skipped.
// Customer GSTIN prefix vs our state decides INTRA (CGST+SGST) vs INTER (IGST).
// ZZ data, torn down.
//   node tests/dispatch-invoice.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { nextInvSeq } = require('../src/lib/sequences');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

const taxInvoices = require('../src/services/tax-invoices.service')(
  require('../src/repositories/tax-invoices.repository')(pool), { nextInvSeq, io: { emit() {} } });
const invoicer = require('../src/lib/dispatch-invoice')({ pool, taxInvoices });

const tag = Date.now().toString().slice(-5);
const made = { partners: [], dispatches: [], invoices: [] };

async function seedDispatch({ gstin, priced }) {
  const pr = (await pool.query(
    `INSERT INTO partners (partner_code, company_name, gstin, is_active)
     VALUES ($1,$2,$3,true) RETURNING partner_id`,
    [`ZZP${tag}${made.partners.length}`, `ZZ Customer ${tag}`, gstin])).rows[0];
  made.partners.push(pr.partner_id);
  const dn = `ZZDC${tag}${made.dispatches.length}`;
  const d = (await pool.query(
    `INSERT INTO dispatch_challans (dispatch_number, customer_name, partner_id, dispatch_date, dispatch_type, status, created_by)
     VALUES ($1,$2,$3,CURRENT_DATE,'FG','DISPATCHED','zz') RETURNING dispatch_id`,
    [dn, `ZZ Customer ${tag}`, pr.partner_id])).rows[0];
  made.dispatches.push(d.dispatch_id);
  await pool.query(
    `INSERT INTO dispatch_items (dispatch_id, fabric_type, color_name, weight_kg, rate_per_kg, gst_rate)
     VALUES ($1,'Single Jersey','White',100,$2,5)`,
    [d.dispatch_id, priced ? 220 : null]);
  return d.dispatch_id;
}

(async () => {
  try {
    // 1. A priced, same-state (Punjab 03) dispatch → DRAFT invoice, INTRA, linked.
    const d1 = await seedDispatch({ gstin: '03ZZAAAA1234Z1', priced: true });
    const r1 = await invoicer.fromDispatch(d1, 'zz');
    if (r1.invoice_id) made.invoices.push(r1.invoice_id);
    ok(r1.invoice_id && r1.invoice_number, 'priced dispatch raises an invoice', r1.invoice_number);
    ok(r1.supply_type === 'INTRA', 'same-state customer → INTRA');
    const inv = (await pool.query(`SELECT status, supply_type, cgst_amount, sgst_amount, igst_amount, grand_total FROM tax_invoices WHERE invoice_id=$1`, [r1.invoice_id])).rows[0];
    ok(inv.status === 'DRAFT', 'invoice is DRAFT (human issues it)');
    ok(Number(inv.cgst_amount) > 0 && Number(inv.sgst_amount) > 0 && Number(inv.igst_amount) === 0, 'INTRA splits into CGST+SGST', `cgst=${inv.cgst_amount} sgst=${inv.sgst_amount}`);
    ok(Number(inv.grand_total) === 23100, 'totals: 100kg @220 +5% = 23100', String(inv.grand_total));
    const link = (await pool.query(`SELECT invoice_id FROM dispatch_challans WHERE dispatch_id=$1`, [d1])).rows[0];
    ok(Number(link.invoice_id) === Number(r1.invoice_id), 'dispatch is linked to the invoice');

    // 2. Idempotent — a second run does not create a duplicate.
    const r1b = await invoicer.fromDispatch(d1, 'zz');
    ok(r1b.skipped === 'already invoiced', 'second run skips (idempotent)');
    ok(Number((await pool.query(`SELECT COUNT(*) n FROM tax_invoices WHERE invoice_id=$1`, [r1.invoice_id])).rows[0].n) === 1, 'still exactly one invoice');

    // 3. Unpriced dispatch (job-work / sample) → not a sale, skipped.
    const d2 = await seedDispatch({ gstin: '03ZZAAAA1234Z1', priced: false });
    const r2 = await invoicer.fromDispatch(d2, 'zz');
    ok(r2.skipped === 'no priced lines (not a sale)', 'unpriced dispatch is not invoiced');

    // 4. Different-state customer (Delhi 07) → INTER (IGST).
    const d3 = await seedDispatch({ gstin: '07ZZBBBB5678Z1', priced: true });
    const r3 = await invoicer.fromDispatch(d3, 'zz');
    if (r3.invoice_id) made.invoices.push(r3.invoice_id);
    ok(r3.supply_type === 'INTER', 'different-state customer → INTER');
    const inv3 = (await pool.query(`SELECT igst_amount, cgst_amount FROM tax_invoices WHERE invoice_id=$1`, [r3.invoice_id])).rows[0];
    ok(Number(inv3.igst_amount) > 0 && Number(inv3.cgst_amount) === 0, 'INTER uses IGST only');

  } finally {
    for (const id of made.invoices) {
      await pool.query(`DELETE FROM tax_invoice_items WHERE invoice_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM tax_invoices WHERE invoice_id=$1`, [id]).catch(() => {});
    }
    for (const id of made.dispatches) {
      await pool.query(`DELETE FROM dispatch_items WHERE dispatch_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM dispatch_challans WHERE dispatch_id=$1`, [id]).catch(() => {});
    }
    for (const id of made.partners) await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [id]).catch(() => {});
  }
  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
