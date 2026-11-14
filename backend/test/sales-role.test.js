// The SALES role — what it reaches, and what it must never reach.
//
// The temptation was to rank SALES at 3, level with SUPERVISOR, because sales
// work (quotes, orders, customer categories) sits behind SUPERVISOR guards.
// That would also have handed every salesperson the authority to approve a GRN
// — to sign stock into the factory — because a ladder cannot tell the two
// apart. So SALES ranks at OPERATOR level and sales routes opt in explicitly.
//
// These tests exist to keep that distinction honest. The negative cases are the
// point: if someone later "simplifies" the hierarchy by moving SALES to 3, the
// production-authority tests below fail.

const { ROLE_HIERARCHY, requireRole } = require('../src/middleware/auth');

// Drive the middleware the way Express does, and report what happened.
function attempt(role, guard) {
  const req = { user: { role, username: 'tester' } };
  let status = null; let body = null; let passed = false;
  const res = {
    status(s) { status = s; return this; },
    json(b) { body = b; return this; },
  };
  guard(req, res, () => { passed = true; });
  return { passed, status, body };
}

describe('SALES role', () => {
  it('ranks at operator level, not supervisor level', () => {
    // The whole design rests on this one number.
    expect(ROLE_HIERARCHY.SALES).toBe(ROLE_HIERARCHY.OPERATOR);
    expect(ROLE_HIERARCHY.SALES).toBeLessThan(ROLE_HIERARCHY.SUPERVISOR);
  });

  it('cannot reach a plain SUPERVISOR route — production authority', () => {
    // e.g. approving a GRN, approving a roll, closing downtime.
    const r = attempt('SALES', requireRole('SUPERVISOR'));
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
  });

  it('reaches a SUPERVISOR route that explicitly grants sales', () => {
    // e.g. creating a sales order, setting a customer category.
    const r = attempt('SALES', requireRole('SUPERVISOR', { also: ['SALES'] }));
    expect(r.passed).toBe(true);
  });

  it('reaches ordinary OPERATOR routes', () => {
    expect(attempt('SALES', requireRole('OPERATOR')).passed).toBe(true);
  });

  it('is still refused ADMIN routes even when sales is granted', () => {
    // A grant must not become a backdoor to a higher tier.
    const r = attempt('SALES', requireRole('ADMIN', { also: ['SUPERVISOR'] }));
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
  });

  it('does not widen any existing role', () => {
    // The `also` option is opt-in; without it nothing changes for anyone.
    expect(attempt('OPERATOR', requireRole('SUPERVISOR')).passed).toBe(false);
    expect(attempt('SUPERVISOR', requireRole('SUPERVISOR')).passed).toBe(true);
    expect(attempt('ADMIN', requireRole('SUPERVISOR')).passed).toBe(true);
    // An OPERATOR must not ride in on a grant aimed at SALES.
    expect(attempt('OPERATOR', requireRole('SUPERVISOR', { also: ['SALES'] })).passed).toBe(false);
  });

  it('rejects an unknown role rather than defaulting it open', () => {
    const r = attempt('MARKETING', requireRole('OPERATOR'));
    expect(r.passed).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe('ACCOUNTS role', () => {
  it('ranks at operator level, like SALES', () => {
    expect(ROLE_HIERARCHY.ACCOUNTS).toBe(ROLE_HIERARCHY.OPERATOR);
    expect(ROLE_HIERARCHY.ACCOUNTS).toBeLessThan(ROLE_HIERARCHY.SUPERVISOR);
  });

  it('cannot reach production authority', () => {
    // An accounts clerk must not be able to sign stock into the factory.
    expect(attempt('ACCOUNTS', requireRole('SUPERVISOR')).passed).toBe(false);
  });

  it('cannot reach plain ADMIN routes', () => {
    // Cancelling a receipt is granted explicitly; creating users is not.
    expect(attempt('ACCOUNTS', requireRole('ADMIN')).passed).toBe(false);
  });

  it('reaches money routes granted to it, including ADMIN-level ones', () => {
    // e.g. POST /payments/:id/cancel, returns approve — both were ADMIN.
    expect(attempt('ACCOUNTS', requireRole('ADMIN', { also: ['ACCOUNTS'] })).passed).toBe(true);
    expect(attempt('ACCOUNTS', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] })).passed).toBe(true);
  });

  it('and SALES cannot do each other\'s job', () => {
    // The separation that matters: the person who agrees a price is not the
    // person who records the money against it.
    expect(attempt('SALES', requireRole('ADMIN', { also: ['ACCOUNTS'] })).passed).toBe(false);
    expect(attempt('ACCOUNTS', requireRole('SUPERVISOR', { also: ['SALES'] })).passed).toBe(false);
  });

  it('does not let an OPERATOR ride in on an accounts grant', () => {
    expect(attempt('OPERATOR', requireRole('SUPERVISOR', { also: ['ACCOUNTS'] })).passed).toBe(false);
  });

  it('still requires authentication before any role check', () => {
    const res = { status(s) { this.s = s; return this; }, json(b) { this.b = b; return this; } };
    let passed = false;
    requireRole('OPERATOR', { also: ['SALES'] })({}, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.s).toBe(401);
  });
});
