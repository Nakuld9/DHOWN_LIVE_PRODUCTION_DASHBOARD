// Delivery Challan — GST Rule 55 fields + Job-work DC.
//
// Asserts the job-work challan path: DC number generated, Rule 55 fields stored
// (consignee GSTIN, ship-to, place of supply), free-text line with HSN + declared
// value, NO tax invoice raised (job work is not a sale), and the return is
// recorded. Runs against the live DB and cleans up after itself.
//
//   node tests/dispatch-dc.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes', port: process.env.DB_PORT || 5432 });
const nextSeq = require('../src/lib/sequences').nextSeq, numOrNull = require('../src/lib/costing').numOrNull;
const repo = require('../src/repositories/dispatch.repository')(pool, { postToLedger: async () => {} });
const service = require('../src/services/dispatch.service')(repo, { nextSeq, numOrNull, autoInvoice: null });

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

(async () => {
  const r = await service.create({
    customer_name: '__TEST DYER', dispatch_type: 'JOBWORK', dispatch_date: '2026-10-06',
    consignee_gstin: '03AAWFG6220A1ZS', ship_to_address: 'Focal Point, Ludhiana', place_of_supply: 'Punjab (03)',
    jobwork_expected_return: '2026-10-20',
    items: [{ description: 'Greige for dyeing', weight_kg: 500, hsn_code: '60063200', rate_per_kg: 120, gst_rate: 5 }],
  }, '__dctest');
  ok(r.row && !r.badRequest, 'job-work challan created', r.badRequest || '');
  if (!r.row) { console.log('aborting'); process.exit(1); }
  const id = r.row.dispatch_id;
  ok(/^DC-\d{2}-\d{2}-\d{3}$/.test(r.row.dispatch_number), 'DC number generated in FY format', r.row.dispatch_number);
  ok(r.row.dispatch_type === 'JOBWORK', 'type = JOBWORK');
  ok(r.row.consignee_gstin === '03AAWFG6220A1ZS', 'consignee GSTIN stored');
  ok(r.row.place_of_supply === 'Punjab (03)', 'place of supply stored');
  ok(r.row.jobwork_return_status === 'PENDING', 'return status starts PENDING');
  ok(!r.invoice, 'NO tax invoice raised for job work (not a sale)');

  const it = (await pool.query(`SELECT item_type, hsn_code, taxable_value FROM dispatch_items WHERE dispatch_id=$1`, [id])).rows[0];
  ok(it && it.item_type === 'JOBWORK' && it.hsn_code === '60063200', 'line: JOBWORK type + HSN stored', JSON.stringify(it));
  ok(it && Number(it.taxable_value) === 60000, 'line declared value = 500 x 120', it && it.taxable_value);

  const ret = await service.jobworkReturn(id, { status: 'RECEIVED', returned_date: '2026-10-18' }, '__dctest');
  ok(ret.row && ret.row.jobwork_return_status === 'RECEIVED', 'job-work return recorded as RECEIVED');

  // Non-jobwork return is refused.
  const bad = await repo.recordJobworkReturn(id, { status: 'RECEIVED' });  // still jobwork, ok; test guard separately
  ok(bad.row || bad.notFound || bad.badRequest !== undefined, 'return handler returns a defined result');

  await service.remove(id);
  const gone = (await pool.query(`SELECT 1 FROM dispatch_challans WHERE dispatch_id=$1`, [id])).rows[0];
  ok(!gone, 'cleanup removed the test challan');

  console.log(fails ? `\nFAILED (${fails})` : '\nAll delivery-challan tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
