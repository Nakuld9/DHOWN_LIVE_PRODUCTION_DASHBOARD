// The AI tool registry — the ONLY way an agent touches data (blueprint §7, §9).
//
// A tool is typed, permissioned and audited. The model never emits SQL; it names a
// registered tool, and this layer decides whether the caller may run it and then
// runs it. An agent's data scope is enforced by which tools it holds, not by prompt
// text — so this registry, not a prompt, is the security boundary.
//
// Read tools are `safe` and run immediately. Write tools are NOT added in this first
// slice (agents start read-only); when they are, `safe:false` marks them and the
// runtime will route them through the approval queue rather than executing.

const { ROLE_HIERARCHY } = require('../middleware/auth');

function createRegistry() {
  const tools = new Map();

  // Read tool:  { name, description, minRole, handler(args, ctx) }         (safe, runs now)
  // Write tool: { name, description, minRole, safe:false, approveRole,
  //               propose(args, ctx) -> {ok,summary,payload}|{error},
  //               execute(payload, ctx) -> result }                        (proposes, then a
  //               human approves and execute() runs — see the approvals queue)
  function register(tool) {
    if (!tool || !tool.name) throw new Error('register: a tool needs a name');
    const safe = tool.safe !== false;
    if (safe && typeof tool.handler !== 'function') throw new Error(`read tool ${tool.name} needs a handler`);
    if (!safe && (typeof tool.propose !== 'function' || typeof tool.execute !== 'function')) {
      throw new Error(`write tool ${tool.name} needs propose() and execute()`);
    }
    tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      minRole: tool.minRole || 'OPERATOR',       // who may PROPOSE / read
      approveRole: tool.approveRole || 'SUPERVISOR', // who must APPROVE a write
      safe,
      handler: tool.handler,
      propose: tool.propose,
      execute: tool.execute,
    });
  }

  const get = (name) => tools.get(name);
  const isWrite = (name) => { const t = tools.get(name); return !!t && t.safe === false; };

  const has = (name) => tools.has(name);

  const canUse = (name, role) => {
    const t = tools.get(name);
    if (!t) return false;
    return (ROLE_HIERARCHY[role] || 0) >= (ROLE_HIERARCHY[t.minRole] || 99);
  };

  // The {name, description} list an agent may show the model — filtered to the
  // agent's allowed tools AND the caller's role. The model cannot ask for a tool
  // it was never told exists.
  function definitionsFor(allowedNames, role) {
    const allow = new Set(allowedNames || []);
    return [...tools.values()]
      .filter(t => allow.has(t.name) && (ROLE_HIERARCHY[role] || 0) >= (ROLE_HIERARCHY[t.minRole] || 99))
      .map(t => ({ name: t.name, description: t.description, safe: t.safe }));
  }

  // Execute a tool. Refuses if the tool is unknown, not permitted for the role, or
  // not in the agent's allow-list. Never throws to the model — an error becomes a
  // result the answer pass can see and hedge on.
  async function call(name, args, { role, allowed, ctx } = {}) {
    const t = tools.get(name);
    if (!t) return { error: `unknown tool: ${name}` };
    if (allowed && !allowed.includes(name)) return { error: `tool not available to this agent: ${name}` };
    if ((ROLE_HIERARCHY[role] || 0) < (ROLE_HIERARCHY[t.minRole] || 99)) {
      return { error: `not permitted: ${name} requires ${t.minRole}` };
    }
    try {
      return await t.handler(args || {}, ctx || {});
    } catch (e) {
      return { error: e.message };
    }
  }

  return { register, has, get, isWrite, canUse, definitionsFor, call, _size: () => tools.size };
}

module.exports = { createRegistry };
