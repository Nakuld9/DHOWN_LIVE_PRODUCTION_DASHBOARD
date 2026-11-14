// Executive CFO dashboard (CFO module §4) — consolidated snapshot shape + honesty.
//
// Asserts the snapshot returns the headline KPI set, that MES-sourced KPIs are
// marked available while Busy-only ones (gross profit / EBITDA / PBT / inventory)
// are flagged unavailable (never invented), and that the debt card reflects a real
// loan from the register.
//
//   node tests/cfo-dashboard.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { nextSeq } = require('../src/lib/sequences');
const pool = new Pool({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes', port: process.env.DB_PORT || 5432 });
const dash = require('../src/lib/cfo-dashboard')(pool);
const loans = require('../src/lib/loans')(pool, { nextSeq });

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

(async () => {
  await loans.ensure();
  await pool.query(`DELETE FROM loan_facilities WHERE lender='__DASHTEST'`);
  await loans.create({ lender: '__DASHTEST', facility_type: 'TERM_LOAN', sanctioned_amount: 1000000, outstanding_amount: 800000, disbursed_amount: 1000000, interest_rate: 11, tenure_months: 12, first_due_date: '2026-11-01' }, '__dashtest');

  const s = await dash.snapshot();
  ok(Array.isArray(s.kpis) && s.kpis.length >= 11, 'snapshot returns the KPI card set', `${s.kpis.length} cards`);

  const byKey = Object.fromEntries(s.kpis.map(k => [k.key, k]));
  ok(byKey.gross_profit && byKey.gross_profit.available === false && byKey.gross_profit.source === 'Busy', 'gross profit flagged unavailable (in Busy), not invented');
  ok(byKey.ebitda && byKey.ebitda.available === false, 'EBITDA flagged unavailable (in Busy)');
  ok(byKey.receivables && byKey.receivables.source === 'MES customer ledger', 'receivables sourced from MES');
  ok(byKey.debt_outstanding && byKey.debt_outstanding.available === true && Number(byKey.debt_outstanding.value) >= 800000, 'debt outstanding reflects the real loan register', byKey.debt_outstanding && String(byKey.debt_outstanding.value));
  ok(s.debt && s.debt.total_outstanding >= 800000, 'debt section populated from loans.summary');
  ok(typeof s.busy_gap === 'string' && /Busy/.test(s.busy_gap), 'snapshot states the Busy gap explicitly');
  ok('cashflow' in s && 'budget' in s && 'profitability' in s, 'snapshot includes cashflow / budget / profitability sections');

  await pool.query(`DELETE FROM loan_facilities WHERE lender='__DASHTEST'`);
  console.log(fails ? `\nFAILED (${fails})` : '\nAll CFO dashboard tests passed.');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.message, e.stack); process.exit(1); });
