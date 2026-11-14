// QC and AUDITOR role semantics, tested at the middleware boundary.
//
// The two roles exist for opposite reasons and the risks are opposite too:
//   QC      — must reach a few SUPERVISOR-gated quality decisions, and NOTHING
//             else that a supervisor can do (no GRN/roll approval, no user admin).
//   AUDITOR — must READ everything, including ACCOUNTS/ADMIN-gated reports a
//             plain VIEWER cannot, and WRITE nothing, anywhere.
//
//   node tests/roles.e2e.js

const { requireRole, auditorWriteBlock, ROLE_HIERARCHY } = require('../src/middleware/auth');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; };

// Run a middleware and report what it did: 'next' | <http status>.
function run(mw, { role, method = 'GET', url = '/api/x' }) {
  let outcome = 'next';
  const req = { user: { role }, method, originalUrl: url, url };
  const res = { status: (s) => ({ json: () => { outcome = s; } }) };
  mw(req, res, () => { outcome = 'next'; });
  return outcome;
}

// ── Rank sanity ────────────────────────────────────────────────────────────
console.log('\nRank placement');
ok(ROLE_HIERARCHY.QC === ROLE_HIERARCHY.OPERATOR, 'QC ranks with OPERATOR, not above it');
ok(ROLE_HIERARCHY.AUDITOR === ROLE_HIERARCHY.VIEWER, 'AUDITOR ranks with VIEWER — earns no write power from the ladder');

// ── QC ─────────────────────────────────────────────────────────────────────
console.log('\nQC reaches quality decisions and nothing more');
ok(run(requireRole('OPERATOR'), { role: 'QC' }) === 'next',
  'QC clears an OPERATOR gate (quarantine list, quality reports)');
ok(run(requireRole('SUPERVISOR', { also: ['QC'] }), { role: 'QC', method: 'POST' }) === 'next',
  'QC clears a SUPERVISOR gate that explicitly opts QC in (quarantine release, inspections)');
ok(run(requireRole('SUPERVISOR'), { role: 'QC', method: 'PUT' }) === 403,
  'QC is refused a SUPERVISOR gate that did NOT opt it in (GRN/roll approval)');
ok(run(requireRole('ADMIN'), { role: 'QC', method: 'POST' }) === 403,
  'QC cannot reach ADMIN work (user admin)');

// ── AUDITOR: reads everything ────────────────────────────────────────────────
console.log('\nAUDITOR reads everything, including finance');
ok(run(requireRole('OPERATOR'), { role: 'AUDITOR' }) === 'next', 'AUDITOR reads operational GETs');
ok(run(requireRole('ACCOUNTS'), { role: 'AUDITOR' }) === 'next', 'AUDITOR reads ACCOUNTS-gated financial reports');
ok(run(requireRole('ADMIN'), { role: 'AUDITOR' }) === 'next', 'AUDITOR reads ADMIN-gated reports a VIEWER cannot');
ok(run(requireRole('ADMIN'), { role: 'VIEWER' }) === 403, '(contrast) a plain VIEWER is refused those same reports');

// ── AUDITOR: writes nothing ──────────────────────────────────────────────────
console.log('\nAUDITOR writes nothing, anywhere');
ok(run(auditorWriteBlock, { role: 'AUDITOR', method: 'POST' }) === 403, 'a POST is refused globally');
ok(run(auditorWriteBlock, { role: 'AUDITOR', method: 'PUT' }) === 403, 'a PUT is refused globally');
ok(run(auditorWriteBlock, { role: 'AUDITOR', method: 'DELETE' }) === 403, 'a DELETE is refused globally');
ok(run(auditorWriteBlock, { role: 'AUDITOR', method: 'GET' }) === 'next', 'a GET passes the write block');
// The read pass in requireRole must never let a write through on its own.
ok(run(requireRole('ACCOUNTS'), { role: 'AUDITOR', method: 'POST' }) === 403,
  'the requireRole read-pass does NOT apply to an unsafe method');
// The write block leaves everyone else alone.
ok(run(auditorWriteBlock, { role: 'ADMIN', method: 'POST' }) === 'next', 'the write block does not touch other roles');

console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
process.exit(fails ? 1 : 0);
