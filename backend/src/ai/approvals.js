// The approvals queue — how an agent's WRITE action becomes real, safely.
//
//   propose  → a write tool validates the request and returns a summary + a frozen
//              payload; a PENDING row is written. NOTHING is mutated yet.
//   approve  → the owning role approves; the tool's execute() runs the payload via
//              the same service a human would use; the row becomes EXECUTED (or
//              FAILED) with the result recorded.
//   reject   → the row becomes REJECTED with a reason.
//
// The payload is frozen at propose time and kept, so "what exactly was approved"
// is always answerable. Approval is permission-checked against the tool's
// approveRole, independently of who proposed it.

const { ROLE_HIERARCHY } = require('../middleware/auth');
const rank = (r) => ROLE_HIERARCHY[r] || 0;

module.exports = function makeApprovals({ pool, registry }) {
  // Called by the runtime when an agent plans a write tool. Validates via the
  // tool's propose() and queues a PENDING approval — never mutates.
  async function propose({ agent, toolName, args, user }) {
    const tool = registry.get(toolName);
    if (!tool || tool.safe !== false) return { error: `not a write tool: ${toolName}` };
    // The proposer must at least hold the tool's minRole to propose it at all.
    if (rank(user?.role) < rank(tool.minRole)) return { error: `not permitted to propose ${toolName}` };

    let p;
    try { p = await tool.propose(args || {}, { user }); }
    catch (e) { return { error: e.message }; }
    if (!p || p.error) return { error: (p && p.error) || 'proposal rejected' };

    const row = (await pool.query(
      `INSERT INTO ai_approvals (agent, tool, summary, payload, required_role, proposed_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING approval_id`,
      [agent || null, toolName, p.summary || null, JSON.stringify(p.payload || args || {}),
       tool.approveRole, user?.username || null])).rows[0];

    return { proposed: true, approval_id: row.approval_id, summary: p.summary,
             needs_approval_by: tool.approveRole };
  }

  async function list({ status } = {}) {
    const conds = []; const params = [];
    if (status) { params.push(status); conds.push(`status = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    return (await pool.query(
      `SELECT approval_id, agent, tool, summary, required_role, proposed_by, status,
              decided_by, decided_at, reason, executed_at, created_at
         FROM ai_approvals ${where} ORDER BY created_at DESC LIMIT 200`, params)).rows;
  }

  async function get(id) {
    return (await pool.query(`SELECT * FROM ai_approvals WHERE approval_id=$1`, [id])).rows[0] || null;
  }

  // Approve → run the tool's execute() with the frozen payload. Permission checked
  // against the tool's approveRole (stored on the row), not the proposer's.
  async function approve(id, approver) {
    const row = await get(id);
    if (!row) return { code: 404, error: 'Approval not found' };
    if (row.status !== 'PENDING') return { code: 409, error: `Already ${row.status}` };
    if (rank(approver?.role) < rank(row.required_role)) {
      return { code: 403, error: `Requires ${row.required_role} to approve` };
    }
    const tool = registry.get(row.tool);
    if (!tool || tool.safe !== false) return { code: 400, error: 'Write tool no longer available' };

    let result, ok = true, errMsg = null;
    try { result = await tool.execute(row.payload || {}, { user: approver }); if (result && result.error) { ok = false; errMsg = result.error; } }
    catch (e) { ok = false; errMsg = e.message; }

    await pool.query(
      `UPDATE ai_approvals SET status=$2, decided_by=$3, decided_at=NOW(),
             result=$4, executed_at=NOW() WHERE approval_id=$1`,
      [id, ok ? 'EXECUTED' : 'FAILED', approver?.username || null, JSON.stringify(result || { error: errMsg })]);

    return ok ? { ok: true, result } : { code: 500, error: errMsg || 'Execution failed' };
  }

  async function reject(id, approver, reason) {
    const row = await get(id);
    if (!row) return { code: 404, error: 'Approval not found' };
    if (row.status !== 'PENDING') return { code: 409, error: `Already ${row.status}` };
    if (rank(approver?.role) < rank(row.required_role)) {
      return { code: 403, error: `Requires ${row.required_role} to reject` };
    }
    await pool.query(
      `UPDATE ai_approvals SET status='REJECTED', decided_by=$2, decided_at=NOW(), reason=$3
         WHERE approval_id=$1`, [id, approver?.username || null, reason || null]);
    return { ok: true };
  }

  return { propose, list, get, approve, reject };
};
