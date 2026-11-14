// AI performance reporting and bulk credit terms.
//
// The credit tests matter more than they look. A credit limit of zero is not
// "no credit allowed" — it is "no limit recorded", and the credit gate treats
// it as nothing to enforce. Every customer on this installation is currently in
// that state, so a bulk editor that silently zeroed a field, or applied half a
// batch, would quietly change who can be sold to on credit.
//
//   node tests/perf-credit.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const aiPerf = require('../src/lib/ai-performance')(pool);
const credit = require('../src/lib/credit-terms')(pool);

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const TAG = 'ZZCT' + Date.now().toString().slice(-6);
const made = [];

(async () => {
  try {
    console.log('\nAI performance reads the audit table safely');
    const before = await aiPerf.overview({});
    ok(typeof before.totals.runs === 'number', 'it reports a run count', String(before.totals.runs));
    ok(Array.isArray(before.tools), 'and a tool list');
    ok(before.empty === (before.totals.runs === 0),
      'an empty history is reported as empty rather than as zeros pretending to be data');

    // Write one action so the aggregation is exercised on real shapes.
    const conv = (await pool.query(
      `INSERT INTO wa_conversations (phone, display_name) VALUES ($1,'ZZ Perf Test') RETURNING conversation_id`,
      ['9199' + Date.now().toString().slice(-8)])).rows[0].conversation_id;
    made.push({ conv });

    await pool.query(
      `INSERT INTO wa_ai_actions (conversation_id, request_text, interpretation, tools_called, response_text, auto_sent)
       VALUES ($1,'do you have black lycra',$2,$3,'Yes sir, 240 kg available.',true)`,
      [conv,
       JSON.stringify({ intent: 'stock_enquiry', confidence: 0.9, confidence_reasons: [] }),
       JSON.stringify([{ tool: 'get_customer', result: { known: true } },
                       { tool: 'get_available_stock', result: [{ kg: 240 }] }])]);
    await pool.query(
      `INSERT INTO wa_ai_actions (conversation_id, request_text, interpretation, tools_called, response_text, auto_sent)
       VALUES ($1,'what is my balance',$2,$3,'I will check.',false)`,
      [conv,
       JSON.stringify({ intent: 'payment_enquiry', confidence: 0.35, confidence_reasons: ['tool returned nothing'] }),
       JSON.stringify([{ tool: 'get_outstanding', result: { error: 'no partner' } }])]);

    const after = await aiPerf.overview({});
    ok(after.totals.runs >= 2, 'new runs are counted', String(after.totals.runs));
    ok(after.totals.auto_sent >= 1 && after.totals.held_for_human >= 1,
      'auto-sent and held-for-human are separated',
      `${after.totals.auto_sent} auto, ${after.totals.held_for_human} held`);
    ok(after.tools.some(t => t.tool === 'get_available_stock'),
      'tool usage is unpacked from the recorded array');
    ok(after.tools.find(t => t.tool === 'get_outstanding')?.failed >= 1,
      'and a tool that errored is counted as failed');
    ok(after.intents.some(i => i.intent === 'stock_enquiry'), 'intents are grouped');
    ok(after.confidence.scored >= 2 && after.confidence.low_confidence >= 1,
      'confidence is summarised, with the low ones counted separately',
      `${after.confidence.scored} scored, ${after.confidence.low_confidence} low`);
    ok(after.confidence.average !== null, 'and averaged only over rows that have it');

    const unused = aiPerf.unusedTools(['get_customer', 'never_called_tool'], after.tools);
    ok(unused.includes('never_called_tool') && !unused.includes('get_customer'),
      'a tool the model never chooses is identifiable');

    console.log('\nCredit terms: the state is visible before it is editable');
    const p1 = (await pool.query(
      `INSERT INTO partners (partner_code, company_name) VALUES ($1,'ZZ Credit A') RETURNING partner_id`,
      [TAG + 'A'])).rows[0].partner_id;
    const p2 = (await pool.query(
      `INSERT INTO partners (partner_code, company_name, credit_limit, credit_days)
       VALUES ($1,'ZZ Credit B', 200000, 45) RETURNING partner_id`, [TAG + 'B'])).rows[0].partner_id;
    made.push({ partner: p1 }, { partner: p2 });

    const listed = await credit.list({ q: 'ZZ Credit' });
    const a = listed.customers.find(c => c.partner_id === p1);
    const b = listed.customers.find(c => c.partner_id === p2);
    ok(a && a.no_limit === true,
      'a customer with no limit is flagged — zero means "not recorded", not "no credit"');
    ok(b && b.no_limit === false && b.credit_limit === 200000, 'one with a limit is not');
    ok(listed.summary.no_limit >= 1, 'the summary counts how many have none', String(listed.summary.no_limit));

    const onlyMissing = await credit.list({ q: 'ZZ Credit', missing_only: true });
    ok(onlyMissing.customers.some(c => c.partner_id === p1), 'the missing-only filter includes them');
    ok(!onlyMissing.customers.some(c => c.partner_id === p2), 'and excludes the ones already set');

    console.log('\nBulk edits validate everything before writing anything');
    const bad = await credit.bulkUpdate([
      { partner_id: p1, credit_limit: 100000 },
      { partner_id: p2, credit_days: 900 },       // invalid
    ], { by: 'test' });
    ok(bad.code === 400, 'one bad row rejects the whole batch', bad.error);
    const untouched = await credit.list({ q: 'ZZ Credit' });
    ok(untouched.customers.find(c => c.partner_id === p1).credit_limit === 0,
      'and nothing was half-applied — the good row did not land either');

    ok((await credit.bulkUpdate([{ partner_id: 99999999, credit_limit: 1 }], {})).code === 404,
      'an unknown customer is refused');
    ok((await credit.bulkUpdate([], {})).code === 400, 'an empty batch is refused');
    ok((await credit.bulkUpdate([{ partner_id: p1, credit_limit: -5 }], {})).code === 400,
      'a negative limit is refused');

    console.log('\nA good batch applies, and omitted fields are left alone');
    const good = await credit.bulkUpdate([
      { partner_id: p1, credit_limit: 150000, credit_days: 30 },
      { partner_id: p2, credit_limit: 250000 },     // credit_days deliberately omitted
    ], { by: 'test' });
    ok(good.ok === true && good.updated === 2, 'both rows applied', String(good.updated));

    const done = await credit.list({ q: 'ZZ Credit' });
    const a2 = done.customers.find(c => c.partner_id === p1);
    const b2 = done.customers.find(c => c.partner_id === p2);
    ok(a2.credit_limit === 150000 && a2.credit_days === 30, 'the first customer is set');
    ok(b2.credit_limit === 250000, 'the second has its new limit');
    ok(b2.credit_days === 45,
      'and its existing terms were NOT zeroed by being omitted', String(b2.credit_days));
    ok(a2.no_limit === false, 'neither is flagged as missing any more');

    const audited = await pool.query(
      `SELECT COUNT(*)::int n FROM audit_logs WHERE module='CREDIT_TERMS' AND username='test'`);
    ok(audited.rows[0].n >= 1, 'and the bulk change is in the audit log');

  } finally {
    for (const m of made) {
      if (m.conv) {
        await pool.query(`DELETE FROM wa_ai_actions WHERE conversation_id=$1`, [m.conv]).catch(() => {});
        await pool.query(`DELETE FROM wa_conversations WHERE conversation_id=$1`, [m.conv]).catch(() => {});
      }
      if (m.partner) await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [m.partner]).catch(() => {});
    }
    await pool.query(`DELETE FROM audit_logs WHERE module='CREDIT_TERMS' AND username='test'`).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
