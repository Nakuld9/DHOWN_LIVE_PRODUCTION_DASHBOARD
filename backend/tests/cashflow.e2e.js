// Rolling cash-flow forecast (CFO module §5) — roll-forward math, loan integration,
// overrides with preserved originals, buffer alerts, and scenario effects.
//
// Opening cash comes from the real bank feed; the test asserts the mechanics
// (closing = opening + inflow - outflow each week, overrides apply and keep the
// original, loan schedules land in the right week, buffer breaches alert).
//
//   node tests/cashflow.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { nextSeq } = require('../src/lib/sequences');
const pool = new Pool({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes', port: process.env.DB_PORT || 5432 });
const cf = require('../src/lib/cashflow')(pool);
const loans = require('../src/lib/loans')(pool, { nextSeq });

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };
const r2 = (n) => Math.round(n * 100) / 100;
const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

(async () => {
  await cf.ensure();
  await loans.ensure();
  await pool.query(`DELETE FROM cashflow_forecasts WHERE name LIKE '__TEST%'`);
  await pool.query(`DELETE FROM loan_facilities WHERE lender='__CFTEST'`);

  // A loan whose first installment is ~2 weeks out, so it should land in week 2 or 3.
  const firstDue = ymd(new Date(Date.now() + 15 * 864e5));
  const lf = await loans.create({ lender: '__CFTEST', facility_type: 'TERM_LOAN', sanctioned_amount: 600000, disbursed_amount: 600000, interest_rate: 12, tenure_months: 6, first_due_date: firstDue }, '__cftest');

  // Forecast with a fixed opening override (so math is deterministic) + weekly wages.
  const made = await cf.create({ name: '__TEST CF', horizon_weeks: 13, min_buffer: 100000, opening_cash_override: 500000,
    assumptions: { weekly_wages: 20000, weekly_other_receipts: 10000 } }, '__cftest');
  ok(made.row && made.row.forecast_id, 'forecast created');
  const id = made.row.forecast_id;

  const fc = await cf.compute(id, { scenario: 'BASE' });
  ok(fc.weeks.length === 13, '13 weekly buckets');
  ok(fc.opening_cash === 500000 && fc.opening_source === 'override', 'opening cash respects the override', fc.opening_source);

  // Roll-forward identity holds for every week: closing = opening + inflow - outflow.
  const rollOk = fc.weeks.every(w => Math.abs(w.closing - r2(w.opening + w.total_inflow - w.total_outflow)) < 0.011);
  ok(rollOk, 'closing = opening + inflow - outflow every week');
  // Each week's opening equals the previous week's closing.
  const chainOk = fc.weeks.every((w, i) => i === 0 ? w.opening === 500000 : Math.abs(w.opening - fc.weeks[i - 1].closing) < 0.011);
  ok(chainOk, 'each week opens at the prior week closing');

  // Wages recur every week; other_receipts inflow recurs every week.
  ok(fc.weeks.every(w => w.lines.WAGES === 20000), 'weekly wages recur in every week');
  ok(fc.weeks.every(w => w.lines.OTHER_RECEIPTS === 10000), 'weekly other-receipts recur');

  // The loan installment lands in a single week (principal + interest > 0 exactly once).
  const loanWeeks = fc.weeks.filter(w => w.lines.LOAN_PRINCIPAL > 0 || w.lines.LOAN_INTEREST > 0);
  ok(loanWeeks.length >= 1 && loanWeeks[0].week >= 2 && loanWeeks[0].week <= 4, 'loan installment lands ~2-3 weeks out', loanWeeks.map(w => w.week).join(','));

  // Override week-1 COLLECTIONS to a big number; original preserved; closing reflects it.
  const ovr = await cf.setOverride(id, { week_index: 1, line_key: 'COLLECTIONS', amount: 250000, reason: 'confirmed customer commitment' }, '__cftest');
  ok(ovr.row && Number(ovr.row.amount) === 250000 && ovr.row.original_amount != null, 'override saved with preserved original', `orig ${ovr.row.original_amount}`);
  const fc2 = await cf.compute(id, { scenario: 'BASE' });
  ok(fc2.weeks[0].lines.COLLECTIONS === 250000, 'override applied to the forecast');

  // An override can be a signed adjustment (e.g. a negative correction).
  const neg = await cf.setOverride(id, { week_index: 2, line_key: 'OTHER_OUTFLOW', amount: -5000, reason: 'refund expected' }, '__cftest');
  ok(neg.row && Number(neg.row.amount) === -5000, 'a negative override is allowed (signed adjustment)');

  // Buffer alert: a tiny opening makes early weeks breach the 100000 buffer.
  await cf.update(id, { opening_cash_override: 10000 }, '__cftest');
  const fc3 = await cf.compute(id, { scenario: 'BASE' });
  ok(fc3.alerts.length >= 1 && fc3.summary.weeks_below_buffer === fc3.alerts.length, 'weeks below the minimum buffer raise alerts', `${fc3.alerts.length} alerts`);

  // Scenario: DOWNSIDE should not produce higher total collections than BASE (haircut + delay).
  const base = await cf.compute(id, { scenario: 'BASE' });
  const down = await cf.compute(id, { scenario: 'DOWNSIDE' });
  const sumColl = (f) => r2(f.weeks.reduce((s, w) => s + w.lines.COLLECTIONS, 0));
  ok(sumColl(down) <= sumColl(base) + 0.01, 'downside collections <= base (haircut applied)', `base ${sumColl(base)} down ${sumColl(down)}`);

  // cleanup
  await pool.query(`DELETE FROM cashflow_forecasts WHERE name LIKE '__TEST%'`);
  await pool.query(`DELETE FROM loan_facilities WHERE lender='__CFTEST'`);

  console.log(fails ? `\nFAILED (${fails})` : '\nAll cash-flow forecast tests passed.');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
