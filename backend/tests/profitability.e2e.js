// Manufacturing profitability (CFO module §7) — contribution-per-kg math + honesty.
//
// Seeds one controlled roll (100 kg) with yarn+knitting cost and a matching dispatch
// line (realisation), then asserts: direct cost/kg, realisation/kg, contribution/kg,
// margin %, overhead allocation, and the data-quality flag. Also asserts the engine
// is honest when there is no production in a window (it says so, no invented margin).
//
//   node tests/profitability.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes', port: process.env.DB_PORT || 5432 });
const prof = require('../src/lib/profitability')(pool);

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };
const FAB = '__PROFTEST_FAB';

async function cleanup() {
  await pool.query(`DELETE FROM cost_entries WHERE reference_id LIKE '__PROFTEST%'`);
  await pool.query(`DELETE FROM rolls WHERE roll_id LIKE '__PROFTEST%'`);
  await pool.query(`DELETE FROM dispatch_items WHERE fabric_type=$1`, [FAB]);
  await pool.query(`DELETE FROM dispatch_challans WHERE dispatch_number LIKE '__PROFTEST%'`);
  await pool.query(`UPDATE profit_config SET overhead_monthly=0, allocation_basis='PRODUCTION_KG' WHERE config_id=1`);
}

(async () => {
  await prof.ensure();
  await cleanup();

  // Seed: 100 kg roll of FAB, yarn 1000 + knitting 500 (direct 1500 -> 15/kg).
  const mid = (await pool.query(`SELECT machine_id FROM machines ORDER BY machine_id LIMIT 1`)).rows[0]?.machine_id ?? null;
  await pool.query(`INSERT INTO rolls (roll_id, machine_id, fabric_type, weight_kg, quality_grade, created_at) VALUES ($1,$2,$3,$4,$5,NOW())`,
    ['__PROFTEST_R1', mid, FAB, 100, 'A']);
  await pool.query(`INSERT INTO cost_entries (reference_type, reference_id, cost_component, amount_rs, quantity_kg) VALUES ('ROLL','__PROFTEST_R1','YARN_COST',1000,100)`);
  await pool.query(`INSERT INTO cost_entries (reference_type, reference_id, cost_component, amount_rs, quantity_kg) VALUES ('ROLL','__PROFTEST_R1','KNITTING_COST',500,100)`);
  // Realisation: sold 100 kg at 30/kg -> taxable 3000.
  const dc = (await pool.query(`INSERT INTO dispatch_challans (dispatch_number, customer_name, dispatch_date) VALUES ('__PROFTEST_DC1','__PROFTEST CUST',CURRENT_DATE) RETURNING dispatch_id`)).rows[0];
  await pool.query(`INSERT INTO dispatch_items (dispatch_id, fabric_type, weight_kg, rate_per_kg, taxable_value, created_at) VALUES ($1,$2,100,30,3000,NOW())`, [dc.dispatch_id, FAB]);

  const res = await prof.byDimension('fabric', {});
  const row = res.rows.find(r => r.dim === FAB);
  ok(row, 'fabric row present for the seeded production');
  ok(row && row.produced_kg === 100, 'produced kg = 100', row && String(row.produced_kg));
  ok(row && row.direct_cost === 1500 && row.direct_cost_per_kg === 15, 'direct cost = 1500 (15/kg)', row && `${row.direct_cost}/${row.direct_cost_per_kg}`);
  ok(row && row.realisation_per_kg === 30, 'realisation = 30/kg', row && String(row.realisation_per_kg));
  ok(row && row.contribution_per_kg === 15, 'contribution/kg = realisation - cost = 15', row && String(row.contribution_per_kg));
  ok(row && row.margin_pct === 50, 'contribution margin = 50%', row && String(row.margin_pct));
  ok(row && row.data_quality === 'complete', 'data quality = complete (cost + realisation)');

  // Overhead allocation: set a monthly pool; the only dimension absorbs the window's share.
  await prof.setConfig({ overhead_monthly: 30000, allocation_basis: 'PRODUCTION_KG' }, '__proftest');
  const res2 = await prof.byDimension('fabric', {});
  const row2 = res2.rows.find(r => r.dim === FAB);
  ok(row2 && row2.overhead_per_kg > 0, 'overhead allocated per kg once a pool is set', row2 && String(row2.overhead_per_kg));
  ok(row2 && Math.abs(row2.op_profit_per_kg - (row2.contribution_per_kg - row2.overhead_per_kg)) < 0.011, 'operating profit/kg = contribution - overhead');

  // Cost-only honesty: a dimension with cost but no realisation is flagged, not guessed.
  const resMachine = await prof.byDimension('machine', {});
  const mrow = resMachine.rows.find(r => String(r.dim) === String(mid));
  ok(mrow && mrow.data_quality === 'cost_only' && mrow.contribution_per_kg === null, 'machine dim: cost known, realisation not linked -> cost_only, no invented contribution');

  // Honest empty window: a future window has no production and says so.
  const empty = await prof.byDimension('fabric', { from: '2099-01-01', to: '2099-01-31' });
  ok(empty.has_production === false && /collectors/i.test(empty.note), 'empty window reported honestly (points to the collectors gap)');

  // Config roundtrip.
  const cfg = await prof.getConfig();
  ok(Number(cfg.overhead_monthly) === 30000 && cfg.allocation_basis === 'PRODUCTION_KG', 'config persisted');

  await cleanup();
  console.log(fails ? `\nFAILED (${fails})` : '\nAll profitability tests passed.');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch(async e => { console.error('ERR', e.message, e.stack); try { await cleanup(); await pool.end(); } catch {} process.exit(1); });
