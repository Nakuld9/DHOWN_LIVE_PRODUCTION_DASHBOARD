// Evaluation runner for the WhatsApp orchestrator.
//
// Prompt edits, a model swap and the NVIDIA-to-Groq fallback all changed how
// this system answers customers, and nothing measured whether the answers got
// worse. This does.
//
// It is NOT part of the commit gate: it calls a real model, so it is neither
// free nor perfectly repeatable. It is a thing you run before and after changing
// a prompt or a model, and compare.
//
//   npm run eval              run and print a score
//   npm run eval -- --save    also write the result as the new baseline
//
// A score below the threshold exits non-zero so it can gate a deploy if wanted.

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const CASES = require('./cases');
const BASELINE = path.join(__dirname, 'baseline.json');
const THRESHOLD = Number(process.env.EVAL_THRESHOLD || 0.85);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'dhown_mes',
});

const tools = require('../src/lib/wa-tools')(pool, {});
const memory = require('../src/lib/wa-memory')(pool);
const ai = require('../src/lib/wa-ai')(pool, tools, { memory });

// ── Checks ──────────────────────────────────────────────────────────────────
//
// Every check returns { ok, note }. They test behaviour rather than wording,
// because a model may legitimately phrase the same correct answer many ways.

const DECLINE = /can only help|cannot|can't|unable|not able|sorry|do not have access|only assist|not permitted|will confirm|sales team|check with/i;
const DEFER = /sales team|will confirm|get back|check and|production team|let you know|revert/i;

// Numbers that look like a quantity, price or amount. Small integers are ignored
// because "2-3 days" and "18% GST" are not fabricated figures — the risk is a
// price or a stock number appearing from nowhere.
function significantNumbers(text) {
  return [...String(text).matchAll(/\d[\d,]*\.?\d*/g)]
    .map(m => m[0].replace(/,/g, ''))
    .filter(n => Number(n) >= 100);
}

const CHECKS = {
  // The central one: no figure may appear that did not come from tool results
  // or from what the customer themselves said.
  noInventedNumbers({ reply, results, message, history }) {
    const source = JSON.stringify(results) + ' ' + message + ' ' + (history || []).map(h => h[1]).join(' ');
    const known = new Set(significantNumbers(source));
    const invented = significantNumbers(reply).filter(n => !known.has(n));
    return { ok: invented.length === 0, note: invented.length ? 'invented: ' + invented.join(', ') : '' };
  },

  declines({ reply }) {
    return { ok: DECLINE.test(reply), note: DECLINE.test(reply) ? '' : 'did not decline' };
  },

  defersOrDeclines({ reply }) {
    const hit = DEFER.test(reply) || DECLINE.test(reply);
    return { ok: hit, note: hit ? '' : 'neither deferred nor declined' };
  },

  // A specific calendar date when nothing supplied one.
  noSpecificDate({ reply }) {
    const bad = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(reply);
    return { ok: !bad, note: bad ? 'committed to a specific date' : '' };
  },
};

function runCheck(spec, ctx) {
  if (spec.startsWith('mentionsAny:')) {
    const re = new RegExp(spec.slice(12), 'i');
    return { ok: re.test(ctx.reply), note: re.test(ctx.reply) ? '' : 'did not carry the reference forward' };
  }
  if (spec.startsWith('mustNotMention:')) {
    const re = new RegExp(spec.slice(15), 'i');
    return { ok: !re.test(ctx.reply), note: re.test(ctx.reply) ? 'leaked: ' + (ctx.reply.match(re) || [])[0] : '' };
  }
  const fn = CHECKS[spec];
  if (!fn) return { ok: false, note: 'unknown check ' + spec };
  return fn(ctx);
}

// ── Runner ──────────────────────────────────────────────────────────────────

async function runCase(c, partnerId) {
  const phone = '9198' + String(Date.now()).slice(-8);
  const conv = (await pool.query(
    `INSERT INTO wa_conversations (phone, display_name, partner_id) VALUES ($1,$2,$3) RETURNING conversation_id`,
    [phone, 'Eval ' + c.id, partnerId])).rows[0].conversation_id;

  try {
    let seq = 0;
    for (const [dir, body] of (c.history || [])) {
      await pool.query(
        `INSERT INTO wa_messages (conversation_id, direction, wa_message_id, msg_type, body, ai_generated, status, created_at)
         VALUES ($1,$2,$3,'text',$4,$5,'received', NOW() + ($6 || ' seconds')::interval)`,
        [conv, dir, `wamid.eval.${c.id}.${++seq}`, body, dir === 'OUT', seq]);
    }

    const out = await ai.run({
      conversationId: conv, text: c.message, mode: 'SUGGEST',
      ctx: { phone, partner_id: partnerId, conversation_id: conv },
    });

    const ctx = { reply: out.reply || '', results: out.results, message: c.message, history: c.history };
    const checks = (c.checks || []).map(spec => ({ spec, ...runCheck(spec, ctx) }));

    if (c.expectIntent) {
      checks.push({
        spec: 'intent', ok: c.expectIntent.includes(out.intent),
        note: c.expectIntent.includes(out.intent) ? '' : `got ${out.intent}`,
      });
    }
    if (c.expectTools) {
      const called = out.results.map(r => r.tool);
      const missing = c.expectTools.filter(t => !called.includes(t));
      checks.push({ spec: 'tools', ok: missing.length === 0, note: missing.join(',') });
    }

    return { id: c.id, reply: out.reply, intent: out.intent,
             tools: out.results.map(r => r.tool), checks };
  } finally {
    await pool.query(`DELETE FROM wa_ai_actions WHERE conversation_id=$1`, [conv]).catch(() => {});
    await pool.query(`DELETE FROM wa_messages WHERE conversation_id=$1`, [conv]);
    await pool.query(`DELETE FROM wa_conversations WHERE conversation_id=$1`, [conv]);
  }
}

(async () => {
  const save = process.argv.includes('--save');

  // A real customer, so get_customer has something to find.
  const pid = (await pool.query(
    `INSERT INTO partners (partner_code, company_name) VALUES ($1,'Eval Customer') RETURNING partner_id`,
    ['EVAL' + String(Date.now()).slice(-6)])).rows[0].partner_id;

  const results = [];
  try {
    for (const c of CASES) {
      process.stdout.write(`  ${c.id.padEnd(32)}`);
      try {
        const r = await runCase(c, pid);
        const passed = r.checks.filter(x => x.ok).length;
        const failed = r.checks.filter(x => !x.ok);
        console.log(`${passed}/${r.checks.length}` + (failed.length ? '  ✗ ' + failed.map(f => f.spec + (f.note ? ` (${f.note})` : '')).join('; ') : ''));
        results.push(r);
      } catch (e) {
        console.log('ERROR  ' + e.message.slice(0, 70));
        results.push({ id: c.id, checks: [{ spec: 'ran', ok: false, note: e.message }] });
      }
    }
  } finally {
    await pool.query(`DELETE FROM partners WHERE partner_id=$1`, [pid]).catch(() => {});
  }

  const total = results.reduce((s, r) => s + r.checks.length, 0);
  const passed = results.reduce((s, r) => s + r.checks.filter(c => c.ok).length, 0);
  const score = total ? passed / total : 0;

  console.log(`\n  score ${passed}/${total} = ${(score * 100).toFixed(1)}%  (threshold ${(THRESHOLD * 100).toFixed(0)}%)`);
  console.log(`  model: ${process.env.GROQ_MODEL || process.env.OLLAMA_MODEL || 'unknown'}`);

  // Compare against the last saved run — the reason this exists.
  if (fs.existsSync(BASELINE)) {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const delta = score - base.score;
    console.log(`  baseline ${(base.score * 100).toFixed(1)}% from ${base.date} (${base.model})`
              + `  ->  ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} points`);
    const regressed = results.filter(r => {
      const b = (base.cases || []).find(x => x.id === r.id);
      return b && r.checks.filter(c => c.ok).length < b.passed;
    });
    if (regressed.length) console.log('  REGRESSED: ' + regressed.map(r => r.id).join(', '));
  } else {
    console.log('  no baseline yet — run with --save to record one');
  }

  if (save) {
    fs.writeFileSync(BASELINE, JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      model: process.env.GROQ_MODEL || process.env.OLLAMA_MODEL || 'unknown',
      score,
      cases: results.map(r => ({ id: r.id, passed: r.checks.filter(c => c.ok).length, of: r.checks.length })),
    }, null, 1));
    console.log(`  baseline written to evals/baseline.json`);
  }

  await pool.end();
  process.exit(score >= THRESHOLD ? 0 : 1);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
