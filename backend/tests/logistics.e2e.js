// End-to-end checks for e-way bills, proof of delivery and sales returns.
//
// The expensive failures here are quiet ones: a consignment moving on an expired
// bill, or a return that puts fabric back in the warehouse while still leaving
// the customer owing money for it. Both are checked against the real database on
// throwaway records, cleaned up at the end.
//
//   node tests/logistics.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const logistics = require('../src/lib/logistics')(pool);
const returns = require('../src/lib/returns')(pool);
const payments = require('../src/lib/payments')(pool);
const approvals = require('../src/lib/wa-approvals')(pool);

let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};

(async () => {
  const tag = 'ZZL' + Date.now().toString().slice(-7);
  const pid = (await pool.query(
    `INSERT INTO partners (partner_code, company_name, credit_limit, credit_days)
     VALUES ($1,'ZZ Logistics Test',500000,30) RETURNING partner_id`, [tag])).rows[0].partner_id;

  let transporterId, ewayId, dispatchId, invoiceId, returnId;

  try {
    console.log('\nValidity and thresholds');
    ok(logistics.validityDays(0) === 1, 'a zero-distance move is still valid for one day');
    ok(logistics.validityDays(200) === 1, '200 km is one day');
    ok(logistics.validityDays(201) === 2, '201 km rolls over to two days');
    ok(logistics.validityDays(650) === 4, '650 km is four days');

    const req1 = await logistics.requirement({ value: 45000, interstate: true });
    ok(req1.required === false, 'a 45k inter-state consignment needs no e-way bill');
    const req2 = await logistics.requirement({ value: 60000, interstate: true });
    ok(req2.required === true, 'a 60k inter-state consignment does need one');
    const req3 = await logistics.requirement({ value: 60000, interstate: false });
    ok(req3.required === false, 'the same 60k intra-state is under the Punjab 1L limit', `threshold ${req3.threshold}`);
    const req4 = await logistics.requirement({ value: 120000, interstate: false });
    ok(req4.required === true, 'a 1.2L intra-state consignment needs one');

    console.log('\nTransporters');
    const badT = await logistics.saveTransporter({ name: 'ZZ Roadways' });
    ok(badT.code === 400, 'a transporter with neither GSTIN nor transporter ID is rejected');
    const t = await logistics.saveTransporter({ name: 'ZZ Roadways ' + tag, gstin: '03AAAAA0000A1Z5', by: 'test' });
    transporterId = t.transporter_id;
    ok(!!transporterId, 'transporter created');

    console.log('\nE-way bill');
    const d = await pool.query(
      `INSERT INTO dispatch_challans (dispatch_number, customer_name, dispatch_date, partner_id, grand_total)
       VALUES ($1,'ZZ Logistics Test',CURRENT_DATE,$2,180000) RETURNING dispatch_id`, ['DC-' + tag, pid]);
    dispatchId = d.rows[0].dispatch_id;

    ok((await logistics.recordEway({ eway_no: '123', dispatch_id: dispatchId, by: 'test' })).code === 400,
      'a short e-way number is rejected');
    ok((await logistics.recordEway({ eway_no: '123456789012', dispatch_id: dispatchId, vehicle_number: 'NOTAVEHICLE', by: 'test' })).code === 400,
      'a malformed vehicle number is rejected');
    ok((await logistics.recordEway({ eway_no: '123456789012', dispatch_id: dispatchId, by: 'test' })).code === 400,
      'road movement without a vehicle number is rejected');

    const ew = await logistics.recordEway({
      eway_no: '881234567890', dispatch_id: dispatchId, partner_id: pid, doc_value: 180000,
      distance_km: 450, vehicle_number: 'pb-10 ab 1234', transporter_id: transporterId,
      lr_number: 'LR/' + tag, by: 'test' });
    ewayId = ew.eway_id;
    ok(!!ewayId, 'e-way bill recorded');
    ok(ew.vehicle_number === 'PB10AB1234', 'vehicle number is normalised', `got ${ew.vehicle_number}`);
    ok(ew.validity_days === 3, '450 km gives three days validity', `got ${ew.validity_days}`);
    ok(new Date(ew.valid_until).getHours() === 23, 'validity runs to end of the last day');

    ok((await logistics.recordEway({ eway_no: '881234567890', dispatch_id: dispatchId, vehicle_number: 'PB10AB1234', by: 'test' })).code === 409,
      'the same e-way number cannot be recorded twice');

    const dc = (await pool.query(`SELECT vehicle_number, transporter_id, lr_number FROM dispatch_challans WHERE dispatch_id=$1`, [dispatchId])).rows[0];
    ok(dc.vehicle_number === 'PB10AB1234' && dc.transporter_id === transporterId,
      'transport details are copied onto the dispatch');

    console.log('\nPart-B vehicle change');
    ok((await logistics.updateVehicle(ewayId, { vehicle_number: 'JUNK', by: 'test' })).code === 400,
      'a malformed replacement vehicle is rejected');
    const upd = await logistics.updateVehicle(ewayId, { vehicle_number: 'PB65XY9999', reason: 'BREAKDOWN', from_place: 'Ludhiana', by: 'test' });
    ok(upd.ok && upd.eway.vehicle_number === 'PB65XY9999', 'the vehicle is changed on the bill');
    ok((await pool.query(`SELECT COUNT(*)::int n FROM eway_vehicle_updates WHERE eway_id=$1`, [ewayId])).rows[0].n === 1,
      'the old vehicle stays on record as a Part-B update');

    console.log('\nCompliance alerts');
    let al = await logistics.complianceAlerts();
    ok(!al.expired.some(x => x.eway_id === ewayId), 'a live bill is not reported as expired');
    // Age the bill past its validity without touching the goods.
    await pool.query(`UPDATE eway_bills SET valid_until = NOW() - INTERVAL '5 hours' WHERE eway_id=$1`, [ewayId]);
    al = await logistics.complianceAlerts();
    const exp = al.expired.find(x => x.eway_id === ewayId);
    ok(!!exp, 'an expired bill on undelivered goods is flagged');
    ok(exp && exp.hours_expired >= 4, 'the alert says how long it has been expired', exp ? `${exp.hours_expired}h` : '');

    const d2 = await pool.query(
      `INSERT INTO dispatch_challans (dispatch_number, customer_name, dispatch_date, partner_id, grand_total)
       VALUES ($1,'ZZ Logistics Test',CURRENT_DATE,$2,250000) RETURNING dispatch_id`, ['DC2-' + tag, pid]);
    al = await logistics.complianceAlerts();
    ok(al.missing.some(x => x.dispatch_id === d2.rows[0].dispatch_id),
      'a dispatch over the threshold with no bill is flagged as missing');

    console.log('\nCancellation window');
    await pool.query(`UPDATE eway_bills SET generated_at = NOW() - INTERVAL '30 hours' WHERE eway_id=$1`, [ewayId]);
    ok((await logistics.cancelEway(ewayId, { by: 'test' })).code === 409,
      'a bill older than 24 hours cannot be cancelled');
    await pool.query(`UPDATE eway_bills SET generated_at = NOW() - INTERVAL '2 hours' WHERE eway_id=$1`, [ewayId]);
    ok((await logistics.cancelEway(ewayId, { reason: 'test', by: 'test' })).ok === true,
      'a bill inside the 24-hour window can be cancelled');
    ok((await logistics.cancelEway(ewayId, { by: 'test' })).code === 409, 'and cannot be cancelled twice');

    console.log('\nProof of delivery');
    ok((await logistics.recordPod(dispatchId, { condition: 'SHORT', shortage_kg: 0, by: 'test' })).code === 400,
      'a short delivery without a shortage quantity is rejected');
    ok((await logistics.recordPod(dispatchId, { condition: 'MAYBE', by: 'test' })).code === 400,
      'an unknown condition is rejected');
    ok((await logistics.pendingDeliveries()).some(x => x.dispatch_id === dispatchId),
      'an unconfirmed dispatch shows as pending delivery');

    const pod = await logistics.recordPod(dispatchId, { received_by: 'Store Manager', condition: 'OK', by: 'test' });
    ok(pod.ok && pod.delivery_status === 'DELIVERED', 'recording a POD marks the dispatch delivered');
    ok(!(await logistics.pendingDeliveries()).some(x => x.dispatch_id === dispatchId),
      'and it drops off the pending list');

    const refused = await logistics.recordPod(d2.rows[0].dispatch_id, { condition: 'REFUSED', remarks: 'shade off', by: 'test' });
    ok(refused.delivery_status === 'REFUSED', 'a refused consignment is not marked delivered');
    ok((await logistics.getPod(dispatchId)).received_by === 'Store Manager', 'the POD can be read back');

    console.log('\nSales return against an invoice');
    const inv = await pool.query(
      `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
       VALUES ($1,$2,CURRENT_DATE,118000,'ISSUED') RETURNING invoice_id`, ['ZZINV-' + tag, pid]);
    invoiceId = inv.rows[0].invoice_id;
    await pool.query(
      `INSERT INTO tax_invoice_items (invoice_id, item_name, quantity, uom, rate, gst_rate, taxable_value)
       VALUES ($1,'ZZ Single Jersey 100kg',100,'KG',1000,18,100000)`, [invoiceId]);

    ok((await payments.outstanding(pid)).outstanding === 118000, 'the invoice is outstanding');

    const overRet = await returns.create({
      invoice_id: invoiceId, reason: 'QUALITY',
      items: [{ item_name: 'ZZ Single Jersey 100kg', quantity: 150, rate: 1000, gst_rate: 18 }],
      created_by: 'test' });
    ok(overRet.code === 400, 'returning more than was invoiced is rejected', overRet.error || '');

    const unknown = await returns.create({
      invoice_id: invoiceId, reason: 'QUALITY',
      items: [{ item_name: 'Something Else', quantity: 1, rate: 100, gst_rate: 18 }],
      created_by: 'test' });
    ok(unknown.code === 400, 'returning an item that was never on the invoice is rejected');

    const ret = await returns.create({
      invoice_id: invoiceId, dispatch_id: dispatchId, reason: 'SHADE_MISMATCH', disposition: 'SALEABLE',
      items: [{ item_name: 'ZZ Single Jersey 100kg', quantity: 20, uom: 'KG', rate: 1000, gst_rate: 18 }],
      created_by: 'test' });
    returnId = ret.return_id;
    ok(!!returnId && ret.status === 'DRAFT', 'a return starts in DRAFT');
    ok(Number(ret.total_value) === 23600, 'return value includes tax', `got ${ret.total_value}`);
    ok((await payments.outstanding(pid)).outstanding === 118000,
      'a DRAFT return changes nothing — no stock moved, no credit given');

    console.log('\nApproving the return');
    const ap = await returns.approve(returnId, { by: 'test' });
    ok(ap.ok === true, 'approval succeeds');
    ok(ap.credit_note && Number(ap.credit_note.amount) === 23600, 'a credit note is raised for the return value');
    ok(ap.allocated.some(x => x.invoice_id === invoiceId && x.amount === 23600),
      'the credit note is allocated against the originating invoice');
    ok(ap.stock_restored === true, 'saleable goods are restored to stock');
    ok((await pool.query(
      `SELECT COUNT(*)::int n FROM stock_ledger WHERE doc_type='SALES_RETURN' AND doc_id=$1 AND movement_type='IN'`,
      [ret.return_number])).rows[0].n === 1, 'a stock IN movement is written');

    const after = await payments.outstanding(pid);
    ok(after.outstanding === 94400, 'the customer now owes the invoice less the credit note', `got ${after.outstanding}`);
    const gate = await approvals.creditCheck(pid, 0);
    ok(gate.outstanding === 94400, 'the credit gate sees the same reduced figure', `got ${gate.outstanding}`);

    ok((await returns.approve(returnId, { by: 'test' })).code === 409, 'a return cannot be approved twice');

    console.log('\nA second return cannot re-credit the same goods');
    const second = await returns.create({
      invoice_id: invoiceId, reason: 'QUALITY',
      items: [{ item_name: 'ZZ Single Jersey 100kg', quantity: 90, rate: 1000, gst_rate: 18 }],
      created_by: 'test' });
    ok(second.code === 400, 'only the 80 kg not already returned may come back', second.error || '');

    console.log('\nCancelling the return');
    const cx = await returns.cancel(returnId, { by: 'test', reason: 'e2e' });
    ok(cx.ok === true && cx.notes_cancelled === 1, 'cancelling the return cancels its credit note');
    ok((await payments.outstanding(pid)).outstanding === 118000,
      'the receivable is restored', `got ${(await payments.outstanding(pid)).outstanding}`);
    ok((await pool.query(
      `SELECT COUNT(*)::int n FROM stock_ledger WHERE doc_type='SALES_RETURN_CANCEL' AND doc_id=$1`,
      [ret.return_number])).rows[0].n === 1, 'the stock is taken back out');
    ok((await pool.query(
      `SELECT COUNT(*)::int n FROM credit_note_allocations ca
         JOIN credit_notes cn ON cn.note_id=ca.note_id WHERE cn.partner_id=$1`, [pid])).rows[0].n === 0,
      'no orphan allocations are left behind by the cancelled note');

    console.log('\nRework does not go back to sellable stock');
    const rw = await returns.create({
      invoice_id: invoiceId, reason: 'DAMAGED', disposition: 'REWORK',
      items: [{ item_name: 'ZZ Single Jersey 100kg', quantity: 10, rate: 1000, gst_rate: 18 }],
      created_by: 'test' });
    const rwAp = await returns.approve(rw.return_id, { by: 'test' });
    ok(rwAp.stock_restored === false, 'damaged goods are credited but not restored to sellable stock');
    ok((await pool.query(
      `SELECT COUNT(*)::int n FROM stock_ledger WHERE doc_id=$1`, [rw.return_number])).rows[0].n === 0,
      'no stock IN movement is written for rework');
    ok((await payments.outstanding(pid)).outstanding === 106200,
      'but the customer is still credited for it', `got ${(await payments.outstanding(pid)).outstanding}`);
  } finally {
    await pool.query(`DELETE FROM stock_ledger WHERE partner_id=$1`, [pid]);
    await pool.query(`DELETE FROM credit_note_allocations WHERE note_id IN (SELECT note_id FROM credit_notes WHERE partner_id=$1)`, [pid]);
    await pool.query(`DELETE FROM credit_notes WHERE partner_id=$1`, [pid]);
    await pool.query(`DELETE FROM sales_returns WHERE partner_id=$1`, [pid]);
    await pool.query(`DELETE FROM delivery_proofs WHERE dispatch_id IN (SELECT dispatch_id FROM dispatch_challans WHERE partner_id=$1)`, [pid]);
    await pool.query(`DELETE FROM eway_bills WHERE partner_id=$1 OR dispatch_id IN (SELECT dispatch_id FROM dispatch_challans WHERE partner_id=$1)`, [pid]);
    await pool.query(`DELETE FROM dispatch_challans WHERE partner_id=$1`, [pid]);
    await pool.query(`DELETE FROM tax_invoice_items WHERE invoice_id IN (SELECT invoice_id FROM tax_invoices WHERE partner_id=$1)`, [pid]);
    await pool.query(`DELETE FROM tax_invoices WHERE partner_id=$1`, [pid]);
    if (transporterId) await pool.query(`DELETE FROM transporters WHERE transporter_id=$1`, [transporterId]);
    await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]);
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
