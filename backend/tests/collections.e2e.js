// Collections — reminder guardrails + activity validation.
//
// The one OUTWARD action here is sending a WhatsApp reminder, so what matters most
// is what it REFUSES to do: no send path configured, nothing overdue, no number on
// file, or consent withheld must all stop before a message goes out. These run
// against a stub pool (no DB) so they assert the guard logic directly.
//
//   node tests/collections.e2e.js

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

// A stub pool: SELECT returns the row we inject; everything else is a no-op.
function makePool(row) {
  return { query: async (sql) => (/^\s*SELECT/i.test(sql) && /v_partner_outstanding/i.test(sql)) ? { rows: row ? [row] : [] } : { rows: [{}] } };
}
const consentYes = { canSend: async () => ({ allowed: true }) };
const consentNo = { canSend: async () => ({ allowed: false, reason: 'opted out' }) };

(async () => {
  const build = (pool, deps) => require('../src/lib/collections')(pool, deps);

  // 1. No send path configured → 503, nothing sent.
  let r = await build(makePool({ overdue: 5000, phone: '919812345678', company_name: 'X' }), { sendTemplate: null, consent: consentYes }).remind(1, {});
  ok(r.error && r.code === 503, 'refuses when WhatsApp not configured', `code ${r.code}`);

  // 2. Nothing overdue → 400.
  let sent = 0; const send = async () => { sent++; return { messages: [{ id: 'm1' }] }; };
  r = await build(makePool({ overdue: 0, phone: '919812345678', company_name: 'X' }), { sendTemplate: send, consent: consentYes }).remind(1, {});
  ok(r.error && r.code === 400, 'refuses when nothing overdue', `code ${r.code}`);
  ok(sent === 0, 'no message sent when nothing overdue');

  // 3. No phone on file → 400.
  r = await build(makePool({ overdue: 5000, phone: null, company_name: 'X' }), { sendTemplate: send, consent: consentYes }).remind(1, {});
  ok(r.error && r.code === 400, 'refuses when no WhatsApp number', `code ${r.code}`);

  // 4. Consent withheld → 403, nothing sent.
  sent = 0;
  r = await build(makePool({ overdue: 5000, phone: '919812345678', company_name: 'X' }), { sendTemplate: send, consent: consentNo }).remind(1, {});
  ok(r.error && r.code === 403, 'refuses when consent withheld', `code ${r.code}`);
  ok(sent === 0, 'no message sent without consent');

  // 5. Customer not found → 404.
  r = await build(makePool(null), { sendTemplate: send, consent: consentYes }).remind(999, {});
  ok(r.error && r.code === 404, 'refuses when customer not found', `code ${r.code}`);

  // 6. Happy path → sends once, returns ok with masked amount.
  sent = 0;
  r = await build(makePool({ overdue: 12345, phone: '919812345678', oldest_overdue_days: 20, company_name: 'ACME' }), { sendTemplate: send, consent: consentYes }).remind(1, { by: 'tester' });
  ok(r.ok === true && sent === 1, 'sends exactly one reminder on the happy path', JSON.stringify(r));
  ok(r.amount === '12,345', 'reminder amount formatted in Indian grouping', r.amount);

  console.log(fails ? `\nFAILED (${fails})` : '\nAll collections guardrail tests passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
