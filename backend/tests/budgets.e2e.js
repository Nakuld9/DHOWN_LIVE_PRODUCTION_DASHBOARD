// Budget & scenario planning (CFO module §11) — versions, scenarios, derive, variance.
//
// Proves: a version holds monthly BASE lines; UPSIDE/DOWNSIDE derive from BASE by a
// %-delta and the math is exact; budget-vs-actual pulls REAL MES actuals (revenue,
// receipts, debt) and honestly flags Busy-only items as not available; archived
// versions are read-only; status activation archives the previous ACTIVE for the FY.
//
//   node tests/budgets.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes', port: process.env.DB_PORT || 5432 });
const budgets = require('../src/lib/budgets')(pool);

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };
const r2 = (n) => Math.round(n * 100) / 100;

(async () => {
  await budgets.ensure();
  await pool.query(`DELETE FROM budget_versions WHERE name LIKE '__TEST%'`);

  // FY month mapping: Apr=period 1, Mar=period 12.
  const c1 = budgets._periodToCalendar('26-27', 1);
  const c12 = budgets._periodToCalendar('26-27', 12);
  ok(c1.year === 2026 && c1.month === 4, 'period 1 = Apr of the FY start year', JSON.stringify(c1));
  ok(c12.year === 2027 && c12.month === 3, 'period 12 = Mar of the next year', JSON.stringify(c12));

  // Create a version + BASE lines.
  const v = await budgets.createVersion({ fy: '26-27', name: '__TEST Budget', notes: 'test' }, '__budtest');
  ok(v.row && v.row.version_id, 'budget version created');
  const id = v.row.version_id;

  const baseLines = [];
  for (let p = 1; p <= 12; p++) baseLines.push({ line_item: 'REVENUE', period_month: p, amount: 100000 });
  for (let p = 1; p <= 12; p++) baseLines.push({ line_item: 'OPEX', period_month: p, amount: 30000 });
  await budgets.upsertLines(id, { scenario: 'BASE', lines: baseLines }, '__budtest');
  let got = await budgets.getVersion(id);
  ok(got.totals.BASE.REVENUE === 1200000, 'BASE revenue totals to 1,200,000', String(got.totals.BASE.REVENUE));
  ok(got.totals.BASE.OPEX === 360000, 'BASE opex totals to 360,000');

  // Upsert is idempotent (overwrite, not duplicate).
  await budgets.upsertLines(id, { scenario: 'BASE', lines: [{ line_item: 'REVENUE', period_month: 1, amount: 150000 }] }, '__budtest');
  got = await budgets.getVersion(id);
  ok(got.totals.BASE.REVENUE === 1250000, 'upsert overwrites a month (no duplicate rows)', String(got.totals.BASE.REVENUE));

  // A budgeted EBITDA can be NEGATIVE (a planned loss) — amount must be signed.
  await budgets.upsertLines(id, { scenario: 'BASE', lines: [{ line_item: 'EBITDA', period_month: 1, amount: -50000 }] }, '__budtest');
  got = await budgets.getVersion(id);
  ok(got.scenarios.BASE.EBITDA && got.scenarios.BASE.EBITDA[1] === -50000, 'a negative budget amount (loss-making EBITDA) is allowed', String(got.scenarios.BASE.EBITDA && got.scenarios.BASE.EBITDA[1]));

  // Derive UPSIDE = BASE revenue +10%, opex -5%.
  await budgets.deriveScenario(id, { to: 'UPSIDE', deltas: { REVENUE: 10, OPEX: -5 } }, '__budtest');
  got = await budgets.getVersion(id);
  ok(got.totals.UPSIDE.REVENUE === r2(1250000 * 1.10), 'UPSIDE revenue = BASE +10%', String(got.totals.UPSIDE.REVENUE));
  ok(got.totals.UPSIDE.OPEX === r2(360000 * 0.95), 'UPSIDE opex = BASE -5%', String(got.totals.UPSIDE.OPEX));
  ok(got.assumptions.some(a => a.scenario === 'UPSIDE' && a.akey === 'delta_REVENUE'), 'derive records the assumption');

  // Variance: budget vs real MES actuals.
  const varr = await budgets.variance(id, 'BASE');
  const rev = varr.rows.find(r => r.line_item === 'REVENUE');
  const opex = varr.rows.find(r => r.line_item === 'OPEX');
  ok(rev && rev.actual_available === true && rev.source === 'MES tax invoices', 'REVENUE has a sourced MES actual');
  ok(rev && rev.variance !== null && rev.variance === r2(rev.actual_total - rev.budget_total), 'REVENUE variance = actual - budget');
  ok(opex && opex.actual_available === false && opex.source === 'needs Busy', 'OPEX honestly flagged as not sourced (needs Busy)');

  // Status: activating archives other ACTIVE of the same FY.
  const v2 = await budgets.createVersion({ fy: '26-27', name: '__TEST Budget 2' }, '__budtest');
  await budgets.setStatus(id, 'ACTIVE', '__budtest');
  await budgets.setStatus(v2.row.version_id, 'ACTIVE', '__budtest');
  const after = (await pool.query(`SELECT version_id, status FROM budget_versions WHERE version_id IN ($1,$2)`, [id, v2.row.version_id])).rows;
  ok(after.find(x => x.version_id == id).status === 'ARCHIVED' && after.find(x => x.version_id == v2.row.version_id).status === 'ACTIVE',
    'activating v2 archived the previously-active v1 (one ACTIVE per FY)');

  // Archived version is read-only.
  const ro = await budgets.upsertLines(id, { scenario: 'BASE', lines: [{ line_item: 'REVENUE', period_month: 1, amount: 1 }] }, '__budtest');
  ok(ro.badRequest && /read-only/.test(ro.badRequest), 'archived version refuses edits');

  // cleanup
  await pool.query(`DELETE FROM budget_versions WHERE name LIKE '__TEST%'`);

  console.log(fails ? `\nFAILED (${fails})` : '\nAll budget/scenario tests passed.');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
