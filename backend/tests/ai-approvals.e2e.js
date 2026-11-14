// The approvals queue end to end: an agent DRAFTS a write action, nothing is
// mutated, a SUPERVISOR approves, and only then does the work order get created.
// The whole safety contract of agent write actions lives here.
//
//   node tests/ai-approvals.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { ensureAiAgentsSchema, ensureAiApprovalsSchema } = require('../src/db/schema');
const { createRegistry } = require('../src/ai/tool-registry');
const { makeRuntime } = require('../src/ai/runtime');
const makeApprovals = require('../src/ai/approvals');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

// Mock model: plan the write tool with a machine + issue.
const chat = (machine) => async (sys, user, { task } = {}) =>
  task === 'fast'
    ? `{"calls":[{"name":"raise_maintenance_wo","args":{"machine_id":"${machine}","issue":"test bearing noise","priority":"HIGH"}}]}`
    : 'Drafted a work order that needs approval.';

(async () => {
  await ensureAiAgentsSchema();
  await ensureAiApprovalsSchema();
  const MACH = 'ZZAP' + Date.now().toString().slice(-5);
  await pool.query(`INSERT INTO machines (machine_id, machine_name) VALUES ($1,'ZZ Approvals Test') ON CONFLICT DO NOTHING`, [MACH]);

  const registry = createRegistry();
  require('../src/ai/tools/maintenance.tools')(registry, { pool });
  const approvals = makeApprovals({ pool, registry });
  const runtime = makeRuntime({ registry, chat: chat(MACH), pool, approvals });
  const agent = { name: 'maintenance', title: 'Maintenance assistant', tools: ['raise_maintenance_wo'] };

  const woCount = async () => Number((await pool.query(`SELECT COUNT(*) n FROM maintenance_work_orders WHERE machine_id=$1`, [MACH])).rows[0].n);
  let approvalId, rejectId, actionIds = [];
  try {
    console.log('\nAn agent DRAFTS the action — nothing is created');
    const before = await woCount();
    const run = await runtime.run({ agent, question: 'raise a WO for a bearing noise', user: { role: 'OPERATOR', username: 'op' } });
    actionIds.push(run.action_id);
    const proposal = run.results[0].result;
    ok(proposal.proposed === true && proposal.approval_id, 'the write tool returns a PROPOSAL, not a result');
    approvalId = proposal.approval_id;
    ok(await woCount() === before, 'NO work order was created by the agent');
    const row = await approvals.get(approvalId);
    ok(row && row.status === 'PENDING' && row.required_role === 'SUPERVISOR', 'a PENDING approval awaits a SUPERVISOR', row?.status);

    console.log('\nApproval is permission-checked, independent of who proposed');
    const byOp = await approvals.approve(approvalId, { role: 'OPERATOR', username: 'op' });
    ok(byOp.code === 403, 'an OPERATOR cannot approve it', byOp.error);
    ok(await woCount() === before, 'still no work order after a refused approval');

    console.log('\nA SUPERVISOR approves — and only now does it execute');
    const bySup = await approvals.approve(approvalId, { role: 'SUPERVISOR', username: 'sup' });
    ok(bySup.ok === true && bySup.result && bySup.result.work_order_id, 'approval executes the tool and returns the WO id');
    ok(await woCount() === before + 1, 'the work order now exists');
    const done = await approvals.get(approvalId);
    ok(done.status === 'EXECUTED' && done.decided_by === 'sup', 'the approval is EXECUTED and records who approved');

    console.log('\nApproving again is refused; a rejection creates nothing');
    ok((await approvals.approve(approvalId, { role: 'SUPERVISOR', username: 'sup' })).code === 409, 'a second approval is refused (already EXECUTED)');
    const run2 = await runtime.run({ agent, question: 'raise another WO', user: { role: 'OPERATOR', username: 'op' } });
    actionIds.push(run2.action_id);
    rejectId = run2.results[0].result.approval_id;
    const rej = await approvals.reject(rejectId, { role: 'SUPERVISOR', username: 'sup' }, 'duplicate');
    ok(rej.ok === true, 'a pending proposal can be rejected');
    ok(await woCount() === before + 1, 'rejection created no work order');
    ok((await approvals.get(rejectId)).status === 'REJECTED', 'the rejected proposal is REJECTED');

  } finally {
    await pool.query(`DELETE FROM maintenance_work_orders WHERE machine_id=$1`, [MACH]).catch(() => {});
    for (const id of [approvalId, rejectId]) if (id) await pool.query(`DELETE FROM ai_approvals WHERE approval_id=$1`, [id]).catch(() => {});
    for (const id of actionIds) if (id) await pool.query(`DELETE FROM ai_agent_actions WHERE action_id=$1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM machines WHERE machine_id=$1`, [MACH]).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
