// Debt & Loan management (CFO module §10) — amortization math + facility lifecycle.
//
// The amortization engine is the part that must be exactly right: principal must
// amortize fully (sum of principal = disbursed), the balance must reach 0 (or the
// balloon), interest must reduce each period, and moratorium/zero-rate/balloon
// variants must hold. Then the DB-backed facility lifecycle + calendar + summary.
//
//   node tests/loans.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { nextSeq } = require('../src/lib/sequences');
const pool = new Pool({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes', port: process.env.DB_PORT || 5432 });
const loans = require('../src/lib/loans')(pool, { nextSeq });

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };
const r2 = (n) => Math.round(n * 100) / 100;
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

(async () => {
  await loans.ensure();

  // ── 1. Standard reducing-balance EMI ──────────────────────────────────────
  const a = loans._amortize({ principal: 1200000, annual_rate: 12, tenure_months: 12, frequency: 'MONTHLY', first_due_date: '2026-11-01' });
  const sumP = r2(a.rows.reduce((s, r) => s + r.principal_due, 0));
  ok(a.rows.length === 12, '12 monthly installments', `got ${a.rows.length}`);
  ok(sumP === 1200000, 'principal amortizes fully (sum = 1,200,000)', `got ${sumP}`);
  ok(a.rows[11].closing_balance === 0, 'final balance is 0', `got ${a.rows[11].closing_balance}`);
  ok(near(a.emi, 106619.29, 1), 'EMI ≈ 106,619', `got ${a.emi}`);
  ok(a.rows[0].interest_due > a.rows[11].interest_due, 'interest reduces each period');
  ok(near(a.rows[0].total_due, a.rows[5].total_due, 1), 'EMI (total_due) is level across periods');

  // ── 2. Zero-rate loan ─────────────────────────────────────────────────────
  const z = loans._amortize({ principal: 120000, annual_rate: 0, tenure_months: 12, frequency: 'MONTHLY', first_due_date: '2026-11-01' });
  ok(r2(z.rows.reduce((s, r) => s + r.principal_due, 0)) === 120000 && z.total_interest === 0, 'zero-rate: equal principal, no interest', `emi ${z.emi}`);

  // ── 3. Balloon ────────────────────────────────────────────────────────────
  const b = loans._amortize({ principal: 1000000, annual_rate: 12, tenure_months: 12, frequency: 'MONTHLY', balloon_amount: 200000, first_due_date: '2026-11-01' });
  ok(r2(b.rows.reduce((s, r) => s + r.principal_due, 0)) === 1000000, 'balloon: principal incl. balloon sums to 1,000,000');
  ok(b.rows[11].is_balloon && b.rows[11].closing_balance === 0, 'balloon flagged on last row, ends at 0');

  // ── 4. Interest-only moratorium ───────────────────────────────────────────
  const m = loans._amortize({ principal: 1000000, annual_rate: 12, tenure_months: 12, moratorium_months: 3, moratorium_type: 'INTEREST_ONLY', frequency: 'MONTHLY', first_due_date: '2026-11-01' });
  ok(m.rows.slice(0, 3).every(r => r.principal_due === 0 && near(r.interest_due, 10000, 1)), 'moratorium: first 3 rows interest-only (~10,000)');
  ok(r2(m.rows.slice(3).reduce((s, r) => s + r.principal_due, 0)) === 1000000, 'moratorium: principal fully amortized after moratorium');

  // ── 5. Facility lifecycle (DB) ────────────────────────────────────────────
  const c = await loans.create({ lender: '__TEST BANK', facility_type: 'MACHINERY', sanctioned_amount: 600000, disbursed_amount: 600000, interest_rate: 10, tenure_months: 6, first_due_date: '2026-11-15', source: 'LENDER_CONFIRMED' }, '__loantest');
  ok(c.row && /^LOAN-\d{2}-\d{2}-\d{3}$/.test(c.row.loan_code), 'facility created with FY loan code', c.row && c.row.loan_code);
  const id = c.row.facility_id;
  ok(c.schedule.rows.length === 6, 'schedule generated (6 rows)');

  const g = await loans.get(id);
  ok(g.schedule.length === 6 && g.row.lender === '__TEST BANK', 'get returns facility + schedule');

  const pay = await loans.recordPayment(id, { installment_no: 1, amount: g.schedule[0].total_due }, '__loantest');
  ok(pay.row && pay.row.status === 'PAID', 'full payment marks installment PAID');

  const cal = await loans.calendar({ from: '2026-11-01', to: '2027-06-01' });
  ok(cal.installments.some(x => x.facility_id === id) && cal.totals.total > 0, 'debt-service calendar lists the facility', `total ${cal.totals.total}`);

  const sm = await loans.summary();
  ok(sm.total_outstanding >= 0 && sm.remaining_interest >= 0, 'summary returns outstanding + remaining interest');

  // CC/OD: revolving, no amortization schedule.
  const cc = await loans.create({ lender: '__TEST BANK', facility_type: 'CC_OD', sanctioned_amount: 5000000, outstanding_amount: 1200000 }, '__loantest');
  ok(cc.row && cc.schedule.rows.length === 0, 'CC/OD facility has no amortization schedule (revolving)');

  // cleanup
  await pool.query(`DELETE FROM loan_facilities WHERE lender='__TEST BANK'`);

  console.log(fails ? `\nFAILED (${fails})` : '\nAll loan/debt tests passed.');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
