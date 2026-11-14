// The shared agent runtime + tool registry — deterministic, no model network call
// (a mock chat stands in). Proves the governed loop: the registry permission-checks
// and allow-list-checks every call, and the runtime only lets the model answer from
// tool results. If these break, an agent could reach a tool it shouldn't.

const { createRegistry } = require('../src/ai/tool-registry');
const { makeRuntime } = require('../src/ai/runtime');

function fakeRegistryWithTool() {
  const reg = createRegistry();
  reg.register({
    name: 'get_thing', description: 'returns a thing', minRole: 'OPERATOR',
    handler: async ({ id }) => ({ id: id || 1, value: 42 }),
  });
  reg.register({
    name: 'admin_only', description: 'privileged', minRole: 'ADMIN',
    handler: async () => ({ secret: true }),
  });
  return reg;
}

describe('tool registry — permission & allow-list', () => {
  const reg = fakeRegistryWithTool();

  test('definitionsFor filters by the agent allow-list AND the role', () => {
    const opDefs = reg.definitionsFor(['get_thing', 'admin_only'], 'OPERATOR');
    expect(opDefs.map(d => d.name)).toEqual(['get_thing']); // admin_only filtered out for OPERATOR
    const adminDefs = reg.definitionsFor(['get_thing', 'admin_only'], 'ADMIN');
    expect(adminDefs.map(d => d.name).sort()).toEqual(['admin_only', 'get_thing']);
    const scoped = reg.definitionsFor(['get_thing'], 'ADMIN'); // allow-list wins
    expect(scoped.map(d => d.name)).toEqual(['get_thing']);
  });

  test('call refuses an unknown tool, a role that is too low, and a tool outside the allow-list', async () => {
    expect((await reg.call('nope', {}, { role: 'ADMIN' })).error).toMatch(/unknown/);
    expect((await reg.call('admin_only', {}, { role: 'OPERATOR' })).error).toMatch(/not permitted/);
    expect((await reg.call('get_thing', {}, { role: 'OPERATOR', allowed: ['other'] })).error).toMatch(/not available/);
  });

  test('call runs a permitted tool and never throws to the caller', async () => {
    expect(await reg.call('get_thing', { id: 7 }, { role: 'OPERATOR', allowed: ['get_thing'] })).toEqual({ id: 7, value: 42 });
    const reg2 = createRegistry();
    reg2.register({ name: 'boom', minRole: 'OPERATOR', handler: async () => { throw new Error('kaboom'); } });
    expect((await reg2.call('boom', {}, { role: 'OPERATOR', allowed: ['boom'] })).error).toBe('kaboom');
  });
});

describe('agent runtime — plan → run → answer, grounded', () => {
  const reg = fakeRegistryWithTool();
  // Mock model: on the fast (plan) pass returns a call plan; on the answer pass
  // returns text derived only from what it was given.
  const chat = async (sys, user, { task } = {}) => {
    if (task === 'fast') return '{"calls":[{"name":"get_thing","args":{"id":5}}]}';
    return 'The thing value is 42.'; // answer pass
  };
  const runtime = makeRuntime({ registry: reg, chat, pool: null }); // pool null → skip logging
  const agent = { name: 'test', title: 'Test agent', tools: ['get_thing'] };

  test('executes the planned tool and returns a grounded answer', async () => {
    const out = await runtime.run({ agent, question: 'what is the thing?', user: { role: 'OPERATOR', username: 'u' } });
    expect(out.tools_used).toEqual(['get_thing']);
    expect(out.results[0].result).toEqual({ id: 5, value: 42 });
    expect(out.answer).toMatch(/42/);
    expect(out.confidence).toBeGreaterThan(0.6); // a tool returned real data
  });

  test('a tool the agent may not use is refused even if the model asks for it', async () => {
    const chatAsksAdmin = async (sys, user, { task } = {}) =>
      task === 'fast' ? '{"calls":[{"name":"admin_only","args":{}}]}' : 'answer';
    const rt = makeRuntime({ registry: reg, chat: chatAsksAdmin, pool: null });
    const out = await rt.run({ agent, question: 'give me the secret', user: { role: 'OPERATOR', username: 'u' } });
    // agent.tools does not include admin_only → refused before the handler runs.
    expect(out.results[0].result.error).toMatch(/not available/);
  });

  test('confidence drops when no tool returns usable data', async () => {
    const chatNoCalls = async (sys, user, { task } = {}) => task === 'fast' ? '{"calls":[]}' : 'I am not sure.';
    const rt = makeRuntime({ registry: reg, chat: chatNoCalls, pool: null });
    const out = await rt.run({ agent, question: 'hmm', user: { role: 'OPERATOR' } });
    expect(out.confidence).toBeLessThan(0.6); // no tools + hedging
  });
});

describe('write tools — proposed, never executed by the agent', () => {
  test('registry rejects a write tool missing propose/execute', () => {
    const r = createRegistry();
    expect(() => r.register({ name: 'bad', safe: false, propose: () => {} })).toThrow(/execute/);
  });

  test('the runtime PROPOSES a write tool and never runs its execute()', async () => {
    const reg = createRegistry();
    let executed = false;
    reg.register({
      name: 'do_thing', safe: false, minRole: 'OPERATOR', approveRole: 'SUPERVISOR',
      propose: async () => ({ summary: 'do a thing', payload: { x: 1 } }),
      execute: async () => { executed = true; return { ok: true }; },
    });
    expect(reg.isWrite('do_thing')).toBe(true);

    const proposeCalls = [];
    const approvals = { propose: async (a) => { proposeCalls.push(a); return { proposed: true, approval_id: 7, summary: a.toolName }; } };
    const chat = async (sys, user, { task } = {}) => task === 'fast' ? '{"calls":[{"name":"do_thing","args":{}}]}' : 'drafted';
    const rt = makeRuntime({ registry: reg, chat, pool: null, approvals });
    const agent = { name: 'maint', title: 'Maint', tools: ['do_thing'] };

    const out = await rt.run({ agent, question: 'do the thing', user: { role: 'OPERATOR', username: 'u' } });
    expect(proposeCalls.length).toBe(1);            // it proposed
    expect(executed).toBe(false);                  // it did NOT execute
    expect(out.results[0].result.proposed).toBe(true);
  });

  test('without an approvals queue a write tool is unavailable, still not executed', async () => {
    const reg = createRegistry();
    let executed = false;
    reg.register({ name: 'do_thing', safe: false, minRole: 'OPERATOR',
      propose: async () => ({ summary: 's', payload: {} }), execute: async () => { executed = true; } });
    const chat = async (sys, user, { task } = {}) => task === 'fast' ? '{"calls":[{"name":"do_thing","args":{}}]}' : 'x';
    const rt = makeRuntime({ registry: reg, chat, pool: null }); // no approvals
    const out = await rt.run({ agent: { name: 'm', title: 'M', tools: ['do_thing'] }, question: 'go', user: { role: 'OPERATOR' } });
    expect(out.results[0].result.error).toMatch(/not enabled/);
    expect(executed).toBe(false);
  });
});
