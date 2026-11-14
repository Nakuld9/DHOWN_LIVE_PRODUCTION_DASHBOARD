// The SALES role, end to end against the running server.
//
// test/sales-role.test.js proves the guard function is right. This proves the
// wiring is right, which is a different question: that a SALES token is
// accepted, that the routes granted to sales really answer, and — the part
// worth the trouble — that production approval really does refuse.
//
// A role that quietly grants too much looks identical to a correct one until
// the day a salesperson signs stock into the factory, so the refusals below are
// asserted as specifically as the permissions.
//
//   node tests/sales-role.e2e.js     (server must be running)

require('dotenv').config({ quiet: true });
const jwt = require('jsonwebtoken');

const BASE = process.env.LOAD_BASE || 'http://localhost:4000';
const tok = (role) => jwt.sign({ id: 999, username: 'roletest', role }, process.env.JWT_SECRET, { expiresIn: '5m' });
const H = (role) => ({ Authorization: 'Bearer ' + tok(role), 'Content-Type': 'application/json' });

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

// A route "refuses" when it answers 403. Anything else — including a 500 from a
// handler that ran, or a 200 — means the guard did not stop the request.
const status = async (method, path, role, body) => {
  const r = await fetch(BASE + path, {
    method,
    headers: H(role),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.status;
};

(async () => {
  const up = await fetch(BASE + '/api/health').then(r => r.ok).catch(() => false);
  if (!up) { console.error(`\nServer not reachable at ${BASE} — start it first.\n`); process.exit(1); }

  console.log('\nSALES can do sales work');
  ok(await status('GET', '/api/wa/conversations', 'SALES') === 200,
    'read the CRM inbox');
  ok(await status('GET', '/api/wa/assignees', 'SALES') === 200,
    'see who a conversation can be assigned to');
  ok(await status('GET', '/api/sales-orders', 'SALES') === 200,
    'read sales orders');

  console.log('\nSALES is refused production authority');
  // The central claim of the design. Each of these is a SUPERVISOR route that
  // was deliberately NOT granted to sales.
  for (const [m, p] of [['POST', '/api/grn'], ['POST', '/api/wa/prices'], ['POST', '/api/wa/payments']]) {
    const s = await status(m, p, 'SALES', {});
    ok(s === 403, `${m} ${p} is refused`, `got ${s}`);
  }
  const dispatch = await status('PUT', '/api/sales-orders/999999/dispatch', 'SALES', {});
  ok(dispatch === 403, 'dispatch stays with the supervisor who can see the loading bay', `got ${dispatch}`);

  console.log('\nThe grant did not widen anyone else');
  // If `also: ['SALES']` had been written as a general escape hatch, an
  // OPERATOR would slip through the same routes.
  const opOrder = await status('POST', '/api/sales-orders', 'OPERATOR', {});
  ok(opOrder === 403, 'OPERATOR still cannot create a sales order', `got ${opOrder}`);
  const opGrn = await status('POST', '/api/grn', 'OPERATOR', {});
  ok(opGrn === 403, 'OPERATOR still cannot post a GRN', `got ${opGrn}`);

  console.log('\nSupervisors kept everything they had');
  const supOrder = await status('POST', '/api/sales-orders', 'SUPERVISOR', {});
  ok(supOrder !== 403, 'SUPERVISOR can still create a sales order', `got ${supOrder}`);

  console.log('\nAuthentication still comes first');
  const anon = await fetch(BASE + '/api/sales-orders').then(r => r.status);
  ok(anon === 401, 'no token is rejected before any role check', `got ${anon}`);

  console.log('\nACCOUNTS can do the money job');
  // These were behind SUPERVISOR and ADMIN, which put them out of reach of the
  // person whose job they are. Not 403 is the assertion — a 400 from the
  // handler means the guard let the request through, which is what is tested.
  for (const [m, p] of [
    ['POST', '/api/wa/payments'],
    ['POST', '/api/wa/payments/999999/cancel'],
    ['POST', '/api/wa/customers/999999/apply-credit'],
    ['POST', '/api/logistics/returns/999999/approve'],
  ]) {
    const s = await status(m, p, 'ACCOUNTS', {});
    ok(s !== 403, `${m} ${p} is reachable`, `got ${s}`);
  }
  ok(await status('GET', '/api/bank/accounts', 'ACCOUNTS') === 200, 'reconcile the bank');
  ok(await status('GET', '/api/reports/financial-dashboard', 'ACCOUNTS') === 200, 'read the financial dashboard');
  ok(await status('GET', '/api/reports/gstr1?from=2026-03-01&to=2026-03-31', 'ACCOUNTS') === 200,
    'read GSTR-1 — accounts prepares the return');

  console.log('\nACCOUNTS is refused everything else');
  const accGrn = await status('POST', '/api/grn', 'ACCOUNTS', {});
  ok(accGrn === 403, 'cannot post a GRN', `got ${accGrn}`);
  const accUser = await status('POST', '/api/users', 'ACCOUNTS', {});
  ok(accUser === 403, 'cannot create users', `got ${accUser}`);
  const accBankAcct = await status('POST', '/api/bank/accounts', 'ACCOUNTS', {});
  ok(accBankAcct === 403, 'cannot create a bank account — rare and structural', `got ${accBankAcct}`);
  const accOrder = await status('POST', '/api/sales-orders', 'ACCOUNTS', {});
  ok(accOrder === 403, 'cannot raise a sales order — that is the sales job', `got ${accOrder}`);

  console.log('\nThe two roles stay separate');
  // The person who agrees a price should not be the one who records the money.
  const salesCancel = await status('POST', '/api/wa/payments/999999/cancel', 'SALES', {});
  ok(salesCancel === 403, 'SALES cannot cancel a receipt', `got ${salesCancel}`);
  const accQuote = await status('POST', '/api/wa/prices', 'ACCOUNTS', {});
  ok(accQuote === 403, 'ACCOUNTS cannot set prices', `got ${accQuote}`);

  console.log('\nEvery report endpoint requires a token');
  // 34 of the 35 handlers on /api/reports had no guard at all: production
  // records, machine data, operator names and attendance, stock and costing
  // answered anyone who could reach the port. It stayed that way because the
  // download buttons used window.open(), which cannot send a header, so adding
  // the guard broke them. Those call sites fetch a blob now.
  //
  // A sample across the router rather than one route, because the failure mode
  // is a single handler being added or moved above the guard.
  const reportPaths = [
    '/api/reports/', '/api/reports/daily-production-report', '/api/reports/machine-log',
    '/api/reports/gst-summary', '/api/reports/gstr1', '/api/reports/financial-dashboard',
    '/api/reports/production-pdf', '/api/reports/machine-log-excel',
  ];
  const open = [];
  for (const p of reportPaths) {
    const s = await fetch(BASE + p).then(r => r.status).catch(() => 0);
    if (s !== 401) open.push(`${p}=${s}`);
  }
  ok(open.length === 0, 'no report endpoint answers without a token', open.join(', ') || 'all 401');

  // ...and the guard did not lock out legitimate users.
  const withToken = await status('GET', '/api/reports/daily-production-report', 'ADMIN');
  ok(withToken === 200, 'reports still answer for an authenticated user', `got ${withToken}`);

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');

  // Not process.exit(). This suite is the only one that drives the server over
  // HTTP, and Node's fetch holds keep-alive sockets open afterwards; exiting on
  // top of them trips a libuv assertion on Windows
  // (!(handle->flags & UV_HANDLE_CLOSING)) which crashes with a non-zero code
  // AFTER every check has passed — the pre-commit hook then aborts a good
  // commit. Setting exitCode and closing the connection pool lets the loop
  // drain and the process exit on its own.
  process.exitCode = fails ? 1 : 0;
  await closeSockets();
})().catch((e) => { console.error('CRASH', e.message); process.exitCode = 1; });

// Ask undici to tear down its keep-alive pool if it is reachable; otherwise
// just give the sockets their idle timeout. Either way the process ends.
async function closeSockets() {
  try {
    const undici = require('undici');
    if (undici?.getGlobalDispatcher) await undici.getGlobalDispatcher().close();
  } catch { /* not installed — the idle timeout will do it */ }
}
