// Outbound payments (H2H Phase B) — file builders + the safety guardrails.
//
// This is REAL MONEY, so the asserts focus on what the batch builder REFUSES: an
// unapproved beneficiary, an over-limit payment, an RTGS below the floor. Plus the
// pain.001 / CSV builders produce a correct, escaped, balanced file. Stub pool / no DB.
//
//   node tests/bank-payouts.e2e.js

const payouts = require('../src/lib/bank-payments-out');
const { buildCsv, buildPain001 } = payouts.builders;

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

const data = {
  batch: { batch_no: 'PAYB-26-27-001', payment_method: 'NEFT', total_amount: 150000, value_date: '2026-10-10' },
  lines: [
    { line_id: 1, beneficiary_name: 'ACME YARN', account_no: '1234567890', ifsc: 'HDFC0001234', amount: 100000, purpose: 'Yarn payment', invoice_ref: 'INV-1' },
    { line_id: 2, beneficiary_name: 'B & C, Textiles', account_no: '9876543210', ifsc: 'ICIC0005678', amount: 50000, purpose: 'Payment', reference: 'R2' },
  ],
};
const debtor = { account_name: 'DHOWN HOSIERY', account_no: '508001010034066', ifsc: 'UBIN0535008' };

// ── CSV ───────────────────────────────────────────────────────────────────────
const csv = buildCsv(data, debtor);
const csvLines = csv.split('\r\n');
ok(csvLines.length === 3, 'CSV: header + 2 rows', `got ${csvLines.length}`);
ok(csvLines[0].startsWith('Beneficiary Name,Account Number,IFSC,Amount'), 'CSV: header row');
ok(csvLines[1].includes('ACME YARN,1234567890,HDFC0001234,100000.00,NEFT'), 'CSV: line 1 fields', csvLines[1]);
ok(csvLines[2].includes('"B & C, Textiles"'), 'CSV: comma field quoted', csvLines[2]);

// ── pain.001 ──────────────────────────────────────────────────────────────────
const xml = buildPain001(data, debtor);
ok(xml.includes('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">'), 'pain.001: correct namespace');
ok(xml.includes('<NbOfTxs>2</NbOfTxs>'), 'pain.001: NbOfTxs = 2');
ok(xml.includes('<CtrlSum>150000.00</CtrlSum>'), 'pain.001: control sum = batch total');
ok(xml.includes('<MmbId>HDFC0001234</MmbId>'), 'pain.001: creditor IFSC present');
ok(xml.includes('<Id>1234567890</Id>'), 'pain.001: creditor account present');
ok(xml.includes('<Id>508001010034066</Id>'), 'pain.001: debtor account present');
ok(xml.includes('B &amp; C, Textiles'), 'pain.001: XML ampersand escaped');
// Sum of InstdAmt equals control sum.
const amts = [...xml.matchAll(/<InstdAmt Ccy="INR">([\d.]+)<\/InstdAmt>/g)].map(m => Number(m[1]));
ok(amts.length === 2 && amts.reduce((a, b) => a + b, 0) === 150000, 'pain.001: line amounts sum to control sum', amts.join('+'));

// ── createBatch guardrails (stub pool; all return before any DB write) ─────────
const benRow = (approved) => ({ beneficiary_id: 7, beneficiary_name: 'TEST SUPP', account_no: '1', ifsc: 'HDFC0001234', approved, is_active: true, partner_id: 1 });
const stub = (approved) => ({ query: async (sql) => (/bank_beneficiaries WHERE beneficiary_id/i.test(sql) ? { rows: [benRow(approved)] } : { rows: [] }) });
const svc = (approved) => payouts(stub(approved));

(async () => {
  let r = await svc(false).createBatch({ payment_method: 'NEFT', lines: [{ beneficiary_id: 7, amount: 1000 }] }, {});
  ok(r.error && /not approved/i.test(r.error), 'refuses an UNAPPROVED beneficiary', r.error);

  r = await svc(true).createBatch({ payment_method: 'NEFT', lines: [{ beneficiary_id: 7, amount: 20000000 }] }, {});
  ok(r.error && /per-payment limit/i.test(r.error), 'refuses a payment over the per-txn limit', r.error);

  r = await svc(true).createBatch({ payment_method: 'RTGS', lines: [{ beneficiary_id: 7, amount: 50000 }] }, {});
  ok(r.error && /RTGS minimum/i.test(r.error), 'refuses RTGS below the ₹2,00,000 floor', r.error);

  r = await svc(true).createBatch({ payment_method: 'NEFT', lines: [{ beneficiary_id: 7, amount: 0 }] }, {});
  ok(r.error && /greater than 0/i.test(r.error), 'refuses a zero/negative amount', r.error);

  console.log(fails ? `\nFAILED (${fails})` : '\nAll outbound-payment tests passed.');
  process.exit(fails ? 1 : 0);
})();
