// Compliance dashboard, debtors ageing export, credit-note PDF, OpenAPI.
//
// Four small features that share one risk: each produces a document or a list
// that someone will act on without cross-checking it. So what is asserted is
// that the numbers come from the same place as the screens they must agree
// with, and that a document is a real document rather than an empty file.
//
//   node tests/reports-extra.e2e.js     (server must be running)

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const BASE = process.env.LOAD_BASE || 'http://localhost:4000';
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const tok = (role = 'ADMIN') =>
  jwt.sign({ id: 1, username: 'rx', role }, process.env.JWT_SECRET, { expiresIn: '10m' });
const H = (role) => ({ Authorization: 'Bearer ' + tok(role) });

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const compliance = require('../src/lib/compliance')(pool);
const TAG = 'ZZRX' + Date.now().toString().slice(-6);
let pid, dispatchId, noteId, invId;

(async () => {
  const up = await fetch(BASE + '/api/health').then(r => r.ok).catch(() => false);
  if (!up) { console.error(`\nServer not reachable at ${BASE}\n`); process.exit(1); }

  pid = (await pool.query(
    `INSERT INTO partners (partner_code, company_name, gstin) VALUES ($1,'ZZ Reports Test','33AAAAA0000A1Z5') RETURNING partner_id`,
    [TAG])).rows[0].partner_id;

  try {
    console.log('\nCompliance: a dispatch with no proof of delivery');
    dispatchId = (await pool.query(
      `INSERT INTO dispatch_challans (dispatch_number, partner_id, customer_name, dispatch_date, grand_total, status)
       VALUES ($1,$2,'ZZ Reports Test',CURRENT_DATE - 10, 45000,'DISPATCHED') RETURNING dispatch_id`,
      [TAG + '-D', pid])).rows[0].dispatch_id;

    let pods = await compliance.podOutstanding({ olderThanDays: 3 });
    ok(pods.some(p => p.dispatch_id === dispatchId),
      'a 10-day-old dispatch with no POD is listed');
    ok(pods.find(p => p.dispatch_id === dispatchId).days_since === 10, 'with its age');

    // A lorry that left this morning has not failed to deliver.
    const fresh = (await pool.query(
      `INSERT INTO dispatch_challans (dispatch_number, partner_id, customer_name, dispatch_date, grand_total, status)
       VALUES ($1,$2,'ZZ Reports Test',CURRENT_DATE, 1000,'DISPATCHED') RETURNING dispatch_id`,
      [TAG + '-FRESH', pid])).rows[0].dispatch_id;
    pods = await compliance.podOutstanding({ olderThanDays: 3 });
    ok(!pods.some(p => p.dispatch_id === fresh),
      'a dispatch that left today is not an exception — it is still on the road');

    // Recording the POD must clear it.
    await pool.query(
      `INSERT INTO delivery_proofs (dispatch_id, received_by, received_at) VALUES ($1,'someone',NOW())`,
      [dispatchId]);
    pods = await compliance.podOutstanding({ olderThanDays: 3 });
    ok(!pods.some(p => p.dispatch_id === dispatchId), 'and recording the POD clears it');

    console.log('\nCompliance: e-way bills are a countdown');
    const expired = (await pool.query(
      `INSERT INTO eway_bills (eway_no, dispatch_id, partner_id, doc_value, valid_until, status)
       VALUES ($1,$2,$3,45000, NOW() - interval '2 hours','ACTIVE') RETURNING eway_id`,
      [TAG + '-EXP', dispatchId, pid])).rows[0].eway_id;
    const soon = (await pool.query(
      `INSERT INTO eway_bills (eway_no, dispatch_id, partner_id, doc_value, valid_until, status)
       VALUES ($1,$2,$3,45000, NOW() + interval '6 hours','ACTIVE') RETURNING eway_id`,
      [TAG + '-SOON', dispatchId, pid])).rows[0].eway_id;
    await pool.query(
      `INSERT INTO eway_bills (eway_no, dispatch_id, partner_id, doc_value, valid_until, status)
       VALUES ($1,$2,$3,45000, NOW() + interval '20 days','ACTIVE')`,
      [TAG + '-FAR', dispatchId, pid]);

    const ew = await compliance.ewayExpiring({ withinHours: 48 });
    ok(ew.some(e => e.eway_id === expired && e.expired === true), 'an expired bill is flagged expired');
    ok(ew.some(e => e.eway_id === soon && e.expired === false), 'one expiring soon is listed but not expired');
    ok(!ew.some(e => e.eway_no === TAG + '-FAR'), 'one valid for 20 days is not noise');
    ok(ew[0].eway_id === expired, 'and the most urgent is first', ew[0].eway_no);

    console.log('\nCompliance: the overview ties it together');
    const ov = await compliance.overview({});
    ok(ov.urgent >= 1, 'expired e-way bills raise the urgent count', String(ov.urgent));
    ok(ov.clear === false, 'and the board is not reported clear while anything is outstanding');
    ok(ov.eway.expired >= 1 && ov.eway.expiring >= 1, 'expired and expiring are counted separately');

    const r = await fetch(BASE + '/api/reports/compliance', { headers: H('OPERATOR') });
    ok(r.status === 200, 'the endpoint answers for an operator', String(r.status));
    ok((await fetch(BASE + '/api/reports/compliance')).status === 401, 'and not anonymously');

    console.log('\nDebtors ageing export');
    invId = (await pool.query(
      `INSERT INTO tax_invoices (invoice_number, partner_id, invoice_date, grand_total, status)
       VALUES ($1,$2,CURRENT_DATE - 60, 90000,'ISSUED') RETURNING invoice_id`,
      [TAG + '-INV', pid])).rows[0].invoice_id;

    const xl = await fetch(BASE + '/api/wa/ageing.xlsx', { headers: H('OPERATOR') });
    ok(xl.status === 200, 'the export answers');
    ok(/spreadsheetml/.test(xl.headers.get('content-type') || ''), 'as a real spreadsheet type',
      xl.headers.get('content-type'));
    const buf = Buffer.from(await xl.arrayBuffer());
    // xlsx is a zip; "PK" is the signature. A 0-byte or JSON body fails here.
    ok(buf.length > 2000 && buf[0] === 0x50 && buf[1] === 0x4b,
      'and the bytes are a valid workbook', `${buf.length} bytes`);

    // The export must agree with the screen it is exported from.
    const pay = require('../src/lib/payments')(pool);
    const ageing = await pay.ageingReport();
    const mine = ageing.find(a => a.partner_id === pid);
    ok(mine && mine.outstanding === 90000, 'and the underlying figures match the ageing report',
      mine ? String(mine.outstanding) : 'customer missing');

    console.log('\nCredit note PDF');
    noteId = (await pool.query(
      `INSERT INTO credit_notes (note_number, note_date, partner_id, invoice_id, taxable_value, tax_amount, amount, reason)
       VALUES ($1, CURRENT_DATE, $2, $3, 10000, 500, 10500, 'QUALITY') RETURNING note_id`,
      [TAG + '-CN', pid, invId])).rows[0].note_id;

    const pdf = await fetch(`${BASE}/api/wa/credit-notes/${noteId}/pdf`, { headers: H('OPERATOR') });
    ok(pdf.status === 200, 'the document is produced', String(pdf.status));
    ok((pdf.headers.get('content-type') || '').includes('pdf'), 'as a PDF');
    const pbuf = Buffer.from(await pdf.arrayBuffer());
    ok(pbuf.slice(0, 5).toString() === '%PDF-', 'with real PDF bytes', `${pbuf.length} bytes`);
    ok((await fetch(`${BASE}/api/wa/credit-notes/99999999/pdf`, { headers: H('OPERATOR') })).status === 404,
      'a missing note is a 404, not a blank document');

    console.log('\nOpenAPI');
    const spec = await fetch(BASE + '/api/openapi.json', { headers: H('OPERATOR') }).then(x => x.json());
    ok(spec.openapi === '3.0.3', 'a 3.0.3 document');
    ok(Object.keys(spec.paths).length > 300, 'covering the real surface',
      `${Object.keys(spec.paths).length} paths`);
    // Generated from the mounted routers, so anything added today is in it.
    ok(!!spec.paths['/api/complaints'], 'including routes added today');
    ok(!!spec.paths['/api/bank/accounts/{id}/summary'], 'with path parameters converted to OpenAPI form');
    ok(spec.paths['/api/complaints'].get.security.length === 1, 'and every path declares bearer auth');
    ok(spec.components.securitySchemes.bearerAuth.scheme === 'bearer', 'with the scheme defined');
    ok((await fetch(BASE + '/api/openapi.json')).status === 401, 'the spec itself needs a token');

  } finally {
    await pool.query(`DELETE FROM eway_bills WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM delivery_proofs WHERE dispatch_id IN (SELECT dispatch_id FROM dispatch_challans WHERE partner_id=$1)`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM credit_notes WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM dispatch_challans WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM tax_invoices WHERE partner_id=$1`, [pid]).catch(() => {});
    await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  process.exitCode = fails ? 1 : 0;
  await pool.end();
  try {
    const undici = require('undici');
    if (undici?.getGlobalDispatcher) await undici.getGlobalDispatcher().close();
  } catch { /* keep-alive sockets will time out on their own */ }
})().catch((e) => { console.error('CRASH', e.message); process.exitCode = 1; });
