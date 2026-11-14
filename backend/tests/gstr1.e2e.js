// GSTR-1 summary.
//
// A return that quietly drops an invoice, or files one under the wrong head,
// is not caught by anything downstream — the portal accepts it and the error
// surfaces months later as a mismatch notice. So what is checked here is that
// every invoice lands in exactly one section, that the sections add back to the
// invoice total, and that rate-wise figures come from the lines rather than the
// header.
//
// Fixtures are built here because tax_invoices is empty on this installation.
//
//   node tests/gstr1.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const gstr1 = require('../src/lib/gstr1')(pool);

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const TAG = 'ZZGST' + Date.now().toString().slice(-6);
const FROM = '2026-03-01';
const TO = '2026-03-31';

(async () => {
  const pid = (await pool.query(
    `INSERT INTO partners (partner_code, company_name) VALUES ($1,'ZZ GST Test') RETURNING partner_id`,
    [TAG])).rows[0].partner_id;

  // invoice + its lines; header figures are derived from the lines so the
  // reconciliation check is meaningful rather than tautological.
  const mkInvoice = async ({ no, gstin, state, pos, lines, date = '2026-03-15' }) => {
    const t = lines.reduce((s, l) => s + l.taxable, 0);
    const inter = pos !== '33';
    const cgst = inter ? 0 : lines.reduce((s, l) => s + l.taxable * l.rate / 200, 0);
    const sgst = cgst;
    const igst = inter ? lines.reduce((s, l) => s + l.taxable * l.rate / 100, 0) : 0;
    const total = t + cgst + sgst + igst;
    const id = (await pool.query(
      `INSERT INTO tax_invoices (invoice_number, invoice_date, partner_id, customer_name,
         customer_gstin, customer_state, place_of_supply, status,
         taxable_value, cgst_amount, sgst_amount, igst_amount, total_tax, grand_total)
       VALUES ($1,$2,$3,'ZZ GST Test',$4,$5,$6,'ISSUED',$7,$8,$9,$10,$11,$12) RETURNING invoice_id`,
      [no, date, pid, gstin, state, pos, t, cgst, sgst, igst, cgst + sgst + igst, total])).rows[0].invoice_id;

    for (const l of lines) {
      await pool.query(
        `INSERT INTO tax_invoice_items (invoice_id, item_name, hsn_code, quantity, uom, rate,
           taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, line_total)
         VALUES ($1,'Fabric',$2,$3,'KG',$4,$5,$6,$7,$8,$9,$10)`,
        [id, l.hsn, l.qty, l.taxable / l.qty, l.taxable, l.rate,
         inter ? 0 : l.taxable * l.rate / 200, inter ? 0 : l.taxable * l.rate / 200,
         inter ? l.taxable * l.rate / 100 : 0,
         l.taxable + l.taxable * l.rate / 100]);
    }
    return { id, total };
  };

  try {
    // B2B, intra-state, two different rates on one invoice — the case that
    // breaks any implementation summing the header instead of the lines.
    const b2bInv = await mkInvoice({
      no: TAG + '-B2B', gstin: '33AABCS1234F1Z5', state: 'Tamil Nadu', pos: '33',
      lines: [{ hsn: '6006', qty: 100, taxable: 50000, rate: 5 },
              { hsn: '6104', qty: 20, taxable: 30000, rate: 12 }],
    });

    // B2CL: no GSTIN, inter-state, over 2.5 lakh.
    await mkInvoice({
      no: TAG + '-B2CL', gstin: null, state: 'Karnataka', pos: '29',
      lines: [{ hsn: '6006', qty: 500, taxable: 300000, rate: 5 }],
    });

    // B2CS: no GSTIN, small. Two of them, to prove consolidation.
    await mkInvoice({
      no: TAG + '-B2CS1', gstin: '', state: 'Tamil Nadu', pos: '33',
      lines: [{ hsn: '6006', qty: 10, taxable: 5000, rate: 5 }],
    });
    await mkInvoice({
      no: TAG + '-B2CS2', gstin: null, state: 'Tamil Nadu', pos: '33',
      lines: [{ hsn: '6006', qty: 20, taxable: 9000, rate: 5 }],
    });

    // Cancelled — must not appear anywhere. A cancelled invoice is not a
    // supply, and including it would pay tax on a sale that never happened.
    const cancelled = await mkInvoice({
      no: TAG + '-CANC', gstin: '33AABCS1234F1Z5', state: 'Tamil Nadu', pos: '33',
      lines: [{ hsn: '6006', qty: 999, taxable: 999999, rate: 5 }],
    });
    await pool.query(`UPDATE tax_invoices SET status='CANCELLED' WHERE invoice_id=$1`, [cancelled.id]);

    // Outside the period — must not appear either.
    await mkInvoice({
      no: TAG + '-OLD', gstin: '33AABCS1234F1Z5', state: 'Tamil Nadu', pos: '33',
      date: '2026-01-10', lines: [{ hsn: '6006', qty: 5, taxable: 7777, rate: 5 }],
    });

    // A credit note against the B2B invoice.
    await pool.query(
      `INSERT INTO credit_notes (note_number, note_date, partner_id, invoice_id,
         taxable_value, tax_amount, amount)
       VALUES ($1,'2026-03-20',$2,$3,10000,500,10500)`,
      [TAG + '-CN', pid, b2bInv.id]);

    const g = await gstr1.summary({ from: FROM, to: TO });

    console.log('\nClassification');
    ok(g.b2b.length === 2, 'a two-rate B2B invoice produces one row per rate', `${g.b2b.length} rows`);
    ok(g.b2b.every(x => x.gstin), 'every B2B row carries a GSTIN');
    const rates = g.b2b.map(x => x.gst_rate).sort((a, b) => a - b);
    ok(rates[0] === 5 && rates[1] === 12,
      'the rates come from the lines, not the header', rates.join('/'));
    ok(g.b2b.find(x => x.gst_rate === 5).taxable === 50000 &&
       g.b2b.find(x => x.gst_rate === 12).taxable === 30000,
      'and each rate carries its own taxable value');

    ok(g.b2cl.length === 1 && g.b2cl[0].taxable === 300000,
      'a large inter-state unregistered sale is B2CL', `${g.b2cl.length} rows`);
    ok(g.b2cs.length === 1 && g.b2cs[0].invoice_count === 2,
      'small unregistered sales consolidate into one B2CS row', JSON.stringify(g.b2cs));
    ok(g.b2cs[0].taxable === 14000, 'and their values are summed', `got ${g.b2cs[0].taxable}`);
    ok(!g.b2cs[0].invoice_number, 'B2CS is not itemised by invoice');

    console.log('\nExclusions');
    const everywhere = JSON.stringify([g.b2b, g.b2cl, g.b2cs, g.hsn]);
    ok(!everywhere.includes('999999'), 'a cancelled invoice appears in no section');
    ok(!everywhere.includes('7777'), 'an invoice outside the period appears in no section');
    ok(g.totals.invoices === 4, 'only the four live in-period invoices are counted', `got ${g.totals.invoices}`);

    console.log('\nCredit notes');
    ok(g.cdnr.length === 1 && g.cdnr[0].taxable === 10000,
      'a note against a registered customer is CDNR', `${g.cdnr.length} rows`);
    ok(g.cdnur.length === 0, 'and is not double-counted as CDNUR');
    ok(g.cdnr[0].against_invoice === TAG + '-B2B', 'the note names the invoice it reverses');

    console.log('\nIt adds up');
    ok(g.reconciles === true,
      'the sections add back to the invoice totals', JSON.stringify(g.drift));
    ok(g.totals.taxable === 394000,
      'total taxable is the sum of the live in-period invoices', `got ${g.totals.taxable}`);
    ok(g.sections.taxable === g.totals.taxable,
      'nothing fell between the sections', `${g.sections.taxable} vs ${g.totals.taxable}`);
    ok(r2(g.totals.cgst + g.totals.sgst + g.totals.igst) === g.totals.total_tax,
      'total tax is the sum of its three components');

    console.log('\nHSN and warnings');
    ok(g.hsn.length === 2, 'HSN summary groups by code and rate', `${g.hsn.length} groups`);
    ok(g.hsn.reduce((s, h) => s + h.taxable, 0) === g.totals.taxable,
      'the HSN summary covers the whole taxable value');
    ok(g.warnings.length === 0, 'clean data raises no warnings', JSON.stringify(g.warnings));

    // A missing HSN must be reported, not silently filed.
    await pool.query(
      `UPDATE tax_invoice_items SET hsn_code = NULL
        WHERE invoice_id = $1`, [b2bInv.id]);
    const g2 = await gstr1.summary({ from: FROM, to: TO });
    ok(g2.warnings.some(w => /HSN/.test(w)), 'a missing HSN code is reported', JSON.stringify(g2.warnings));
    ok(g2.reconciles === true, 'and does not break the reconciliation');

  } finally {
    await pool.query(
      `DELETE FROM credit_notes WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(
      `DELETE FROM tax_invoice_items WHERE invoice_id IN (SELECT invoice_id FROM tax_invoices WHERE partner_id=$1)`,
      [pid]).catch(() => {});
    await pool.query(`DELETE FROM tax_invoices WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });

function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
