// Production agent end to end against the real DB, with a mock model (so the test
// is deterministic and needs no Groq). Proves the real production tools query the
// tables and return a sane shape, that the answer is grounded in them, and that the
// turn is written to the ai_agent_actions audit log.
//
//   node tests/ai-agent.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { ensureAiAgentsSchema } = require('../src/db/schema');
const { createRegistry } = require('../src/ai/tool-registry');
const { makeRuntime } = require('../src/ai/runtime');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

// Mock model: plan pass asks for both production tools; answer pass returns text.
const chat = async (sys, user, { task } = {}) =>
  task === 'fast'
    ? '{"calls":[{"name":"get_production_summary","args":{}},{"name":"get_machine_status","args":{}}]}'
    : 'Production and machine status reported from tool results.';

(async () => {
  await ensureAiAgentsSchema();
  const registry = createRegistry();
  require('../src/ai/tools/production.tools')(registry, { pool });
  require('../src/ai/tools/inventory.tools')(registry, { pool });
  require('../src/ai/tools/quality.tools')(registry, { pool });
  require('../src/ai/tools/jobwork.tools')(registry, { pool });
  require('../src/ai/tools/maintenance.tools')(registry, { pool });
  require('../src/ai/tools/costing.tools')(registry, { pool });
  require('../src/ai/tools/purchase.tools')(registry, { pool });
  require('../src/ai/tools/dispatch.tools')(registry, { pool });
  const runtime = makeRuntime({ registry, chat, pool });
  const agent = { name: 'production', title: 'Production assistant', tools: ['get_production_summary', 'get_machine_status'] };

  let actionId, actionId2, actionId3, actionId4, actionId5, actionId6, actionId7, actionId8, actionId9, actionId10;
  try {
    const out = await runtime.run({ agent, question: 'how much production today and which machines are down?', user: { role: 'SUPERVISOR', username: 'test' } });
    actionId = out.action_id;

    ok(out.tools_used.includes('get_production_summary'), 'the production tool was called');
    const prod = out.results.find(r => r.tool === 'get_production_summary').result;
    ok(prod && typeof prod.total_rolls === 'number' && typeof prod.total_kg === 'number',
      'get_production_summary returns total rolls + kg from the rolls table', `${prod.total_rolls} rolls / ${prod.total_kg} kg`);
    ok(Array.isArray(prod.by_shift), 'and a per-shift breakdown');

    const mach = out.results.find(r => r.tool === 'get_machine_status').result;
    ok(mach && typeof mach.total === 'number' && Array.isArray(mach.machines),
      'get_machine_status returns live machine states', `${mach.total} machines, ${mach.running} running`);

    ok(typeof out.answer === 'string' && out.answer.length > 0, 'an answer is produced');
    ok(typeof out.confidence === 'number', 'a grounding confidence is scored', `${out.confidence}`);

    ok(actionId != null, 'the turn was written to the ai_agent_actions audit log');
    const logged = (await pool.query(`SELECT agent, username, tools_used FROM ai_agent_actions WHERE action_id=$1`, [actionId])).rows[0];
    ok(logged && logged.agent === 'production' && logged.username === 'test', 'the log records the agent and who asked');

    console.log('\nInventory agent');
    const invChat = async (sys, user, { task } = {}) =>
      task === 'fast'
        ? '{"calls":[{"name":"get_stock_summary","args":{}},{"name":"get_low_stock","args":{}}]}'
        : 'Stock reported from tool results.';
    const invRt = makeRuntime({ registry, chat: invChat, pool });
    const invAgent = { name: 'inventory', title: 'Inventory assistant', tools: ['get_stock_summary', 'get_low_stock'] };
    const inv = await invRt.run({ agent: invAgent, question: 'how much yarn stock and what is low?', user: { role: 'SUPERVISOR', username: 'test' } });
    actionId2 = inv.action_id;
    const stock = inv.results.find(r => r.tool === 'get_stock_summary').result;
    ok(stock && stock.yarn && typeof stock.yarn.kg === 'number' && typeof stock.finished.kg === 'number',
      'get_stock_summary returns yarn / greige / finished on hand', `yarn ${stock.yarn.kg}kg, finished ${stock.finished.kg}kg`);
    const low = inv.results.find(r => r.tool === 'get_low_stock').result;
    ok(low && typeof low.count === 'number' && Array.isArray(low.lots), 'get_low_stock returns the reorder list', `${low.count} low`);

    console.log('\nQuality agent');
    const qChat = async (sys, user, { task } = {}) =>
      task === 'fast'
        ? '{"calls":[{"name":"get_quality_summary","args":{}},{"name":"get_defect_pareto","args":{}}]}'
        : 'Quality reported from tool results.';
    const qRt = makeRuntime({ registry, chat: qChat, pool });
    const qAgent = { name: 'quality', title: 'Quality assistant', tools: ['get_quality_summary', 'get_defect_pareto'] };
    const ql = await qRt.run({ agent: qAgent, question: 'what is our reject rate and worst defect?', user: { role: 'SUPERVISOR', username: 'test' } });
    actionId3 = ql.action_id;
    const qs = ql.results.find(r => r.tool === 'get_quality_summary').result;
    ok(qs && typeof qs.reject_rate_pct === 'number' && qs.grade_pct, 'get_quality_summary returns grade split + reject rate', `reject ${qs.reject_rate_pct}%`);
    const par = ql.results.find(r => r.tool === 'get_defect_pareto').result;
    ok(par && Array.isArray(par.top_defects), 'get_defect_pareto returns top defects');

    console.log('\nJob-work agent');
    const jChat = async (sys, user, { task } = {}) =>
      task === 'fast'
        ? '{"calls":[{"name":"get_jobwork_outstanding","args":{}},{"name":"get_jobwork_overdue","args":{}},{"name":"get_process_loss","args":{}}]}'
        : 'Job-work reported from tool results.';
    const jRt = makeRuntime({ registry, chat: jChat, pool });
    const jAgent = { name: 'jobwork', title: 'Job-work assistant', tools: ['get_jobwork_outstanding', 'get_jobwork_overdue', 'get_process_loss'] };
    const jw = await jRt.run({ agent: jAgent, question: 'what is stuck at the dye house and any process loss?', user: { role: 'SUPERVISOR', username: 'test' } });
    actionId4 = jw.action_id;
    const out2 = jw.results.find(r => r.tool === 'get_jobwork_outstanding').result;
    ok(out2 && typeof out2.total_kg === 'number' && Array.isArray(out2.by_vendor), 'get_jobwork_outstanding returns kg at vendors', `${out2.total_kg}kg / ${out2.overdue_challans} overdue`);
    const od = jw.results.find(r => r.tool === 'get_jobwork_overdue').result;
    ok(od && typeof od.count === 'number' && Array.isArray(od.overdue), 'get_jobwork_overdue returns the overdue list', `${od.count} overdue`);
    const pl = jw.results.find(r => r.tool === 'get_process_loss').result;
    ok(pl && typeof pl.sent_kg === 'number' && typeof pl.loss_kg === 'number', 'get_process_loss returns sent vs received', `loss ${pl.loss_kg}kg`);

    console.log('\nMaintenance agent');
    const mChat = async (sys, user, { task } = {}) =>
      task === 'fast'
        ? '{"calls":[{"name":"get_open_maintenance","args":{}},{"name":"get_pm_due","args":{}},{"name":"get_low_spares","args":{}}]}'
        : 'Maintenance reported from tool results.';
    const mRt = makeRuntime({ registry, chat: mChat, pool });
    const mAgent = { name: 'maintenance', title: 'Maintenance assistant', tools: ['get_open_maintenance', 'get_pm_due', 'get_low_spares'] };
    const mn = await mRt.run({ agent: mAgent, question: 'any breakdowns, PM due, or low spares?', user: { role: 'SUPERVISOR', username: 'test' } });
    actionId5 = mn.action_id;
    const om = mn.results.find(r => r.tool === 'get_open_maintenance').result;
    ok(om && typeof om.open_work_orders === 'number' && typeof om.machines_down_now === 'number', 'get_open_maintenance returns open WOs + machines down', `${om.open_work_orders} WOs / ${om.machines_down_now} down`);
    const pm = mn.results.find(r => r.tool === 'get_pm_due').result;
    ok(pm && typeof pm.count === 'number' && Array.isArray(pm.tasks), 'get_pm_due returns due tasks', `${pm.count} due`);
    const sp = mn.results.find(r => r.tool === 'get_low_spares').result;
    ok(sp && typeof sp.count === 'number' && Array.isArray(sp.parts), 'get_low_spares returns low spares', `${sp.count} low`);

    // The scoring router sends questions to the right agent even with shared words.
    const { pickAgent } = require('../src/ai/fleet');
    ok(pickAgent('how much yarn stock do we have?').name === 'inventory', 'router: stock question → inventory');
    ok(pickAgent('how much production today?').name === 'production', 'router: output question → production');
    ok(pickAgent('what is our reject rate and defect pareto?').name === 'quality', 'router: reject/defect question → quality');
    ok(pickAgent('what is stuck at the dye house, any overdue challan?').name === 'jobwork', 'router: dye-house/challan question → jobwork');
    ok(pickAgent('any breakdown or preventive maintenance due?').name === 'maintenance', 'router: breakdown/PM question → maintenance');
    ok(pickAgent('what is the cost per kg and margin on this fabric?').name === 'costing', 'router: cost/margin question → costing');

    console.log('\nCosting agent (SUPERVISOR-gated tools)');
    const cChat = async (sys, user, { task } = {}) =>
      task === 'fast'
        ? '{"calls":[{"name":"get_fabric_cost","args":{}},{"name":"get_cost_breakdown","args":{}}]}'
        : 'Costing reported from tool results.';
    const cRt = makeRuntime({ registry, chat: cChat, pool });
    const cAgent = { name: 'costing', title: 'Costing assistant', tools: ['get_fabric_cost', 'get_cost_breakdown'] };
    // A supervisor gets the numbers.
    const cs = await cRt.run({ agent: cAgent, question: 'cost per kg and breakdown?', user: { role: 'SUPERVISOR', username: 'test' } });
    actionId6 = cs.action_id;
    const fc = cs.results.find(r => r.tool === 'get_fabric_cost').result;
    ok(fc && typeof fc.count === 'number' && Array.isArray(fc.fabrics), 'get_fabric_cost returns cost/margin per fabric', `${fc.count} fabrics`);
    const cb = cs.results.find(r => r.tool === 'get_cost_breakdown').result;
    ok(cb && typeof cb.total_amount_rs === 'number' && Array.isArray(cb.components), 'get_cost_breakdown returns components');
    // An operator is refused the cost tools — cost/margin is SUPERVISOR+.
    const cop = await cRt.run({ agent: cAgent, question: 'cost per kg?', user: { role: 'OPERATOR', username: 'op' } });
    actionId7 = cop.action_id;
    ok(cop.results.every(r => r.result && r.result.error && /not permitted/.test(r.result.error)),
      'an OPERATOR is refused the cost tools (cost/margin is SUPERVISOR+)');

    console.log('\nPurchase agent');
    const pChat = async (sys, user, { task } = {}) =>
      task === 'fast'
        ? '{"calls":[{"name":"get_open_purchase_orders","args":{}},{"name":"get_overdue_purchase_orders","args":{}}]}'
        : 'Purchase reported from tool results.';
    const pRt = makeRuntime({ registry, chat: pChat, pool });
    const pAgent = { name: 'purchase', title: 'Purchase assistant', tools: ['get_open_purchase_orders', 'get_overdue_purchase_orders'] };
    const pu = await pRt.run({ agent: pAgent, question: 'what POs are open and which suppliers are late?', user: { role: 'SUPERVISOR', username: 'test' } });
    actionId8 = pu.action_id;
    const op = pu.results.find(r => r.tool === 'get_open_purchase_orders').result;
    ok(op && typeof op.total_pos === 'number' && Array.isArray(op.by_supplier), 'get_open_purchase_orders returns open POs by supplier', `${op.total_pos} POs / ${op.overdue_pos} overdue`);
    const ov = pu.results.find(r => r.tool === 'get_overdue_purchase_orders').result;
    ok(ov && typeof ov.count === 'number' && Array.isArray(ov.overdue), 'get_overdue_purchase_orders returns the late list', `${ov.count} overdue`);
    ok(pickAgent('which supplier purchase orders are overdue?').name === 'purchase', 'router: PO/supplier question → purchase');

    console.log('\nDispatch agent');
    const dChat = async (sys, user, { task } = {}) =>
      task === 'fast'
        ? '{"calls":[{"name":"get_open_sales_orders","args":{}},{"name":"get_overdue_deliveries","args":{}},{"name":"get_recent_dispatches","args":{}}]}'
        : 'Dispatch reported from tool results.';
    const dRt = makeRuntime({ registry, chat: dChat, pool });
    const dAgent = { name: 'dispatch', title: 'Dispatch assistant', tools: ['get_open_sales_orders', 'get_overdue_deliveries', 'get_recent_dispatches'] };
    const ds = await dRt.run({ agent: dAgent, question: 'what is pending to ship and what shipped this week?', user: { role: 'SUPERVISOR', username: 'test' } });
    actionId9 = ds.action_id;
    const so = ds.results.find(r => r.tool === 'get_open_sales_orders').result;
    ok(so && typeof so.total_orders === 'number' && Array.isArray(so.by_customer), 'get_open_sales_orders returns open orders by customer', `${so.total_orders} orders / ${so.overdue_orders} overdue`);
    const dl = ds.results.find(r => r.tool === 'get_overdue_deliveries').result;
    ok(dl && typeof dl.count === 'number' && Array.isArray(dl.overdue), 'get_overdue_deliveries returns the late list', `${dl.count} late`);
    const rd = ds.results.find(r => r.tool === 'get_recent_dispatches').result;
    ok(rd && typeof rd.dispatches === 'number' && typeof rd.kg === 'number', 'get_recent_dispatches returns count + kg shipped', `${rd.dispatches} / ${rd.kg}kg`);
    ok(pickAgent('what sales orders are pending to ship or overdue for delivery?').name === 'dispatch', 'router: ship/delivery question → dispatch');

    console.log('\nManagement agent (composes across domains)');
    const gChat = async (sys, user, { task } = {}) =>
      task === 'fast'
        ? '{"calls":[{"name":"get_production_summary","args":{}},{"name":"get_quality_summary","args":{}},{"name":"get_open_sales_orders","args":{}},{"name":"get_jobwork_outstanding","args":{}},{"name":"get_open_maintenance","args":{}}]}'
        : 'Weekly brief composed from tool results.';
    const gRt = makeRuntime({ registry, chat: gChat, pool });
    const gAgent = { name: 'management', title: 'Management brief assistant', maxCalls: 6,
      tools: ['get_production_summary', 'get_quality_summary', 'get_open_sales_orders', 'get_jobwork_outstanding', 'get_open_maintenance', 'get_fabric_cost'] };
    const gm = await gRt.run({ agent: gAgent, question: 'how did we do this week?', user: { role: 'SUPERVISOR', username: 'md' } });
    actionId10 = gm.action_id;
    ok(gm.results.length === 5, 'management pulled 5 domains in one turn (call budget > 3)', `${gm.results.length}`);
    ok(gm.tools_used.includes('get_production_summary') && gm.tools_used.includes('get_quality_summary') && gm.tools_used.includes('get_open_sales_orders'),
      'the brief spans production, quality and orders');

    ok(pickAgent('how did we do this week, give me an overview').name === 'management', 'router: overview/brief question → management');
  } finally {
    for (const a of [actionId, actionId2, actionId3, actionId4, actionId5, actionId6, actionId7, actionId8, actionId9, actionId10]) {
      if (a) await pool.query(`DELETE FROM ai_agent_actions WHERE action_id=$1`, [a]).catch(() => {});
    }
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
