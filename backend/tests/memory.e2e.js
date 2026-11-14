// Conversation memory for the AI orchestrator.
//
// These check the assembly of memory, not the model's use of it: what goes into
// the prompt, what is deliberately kept out, and that a long conversation cannot
// grow the prompt without bound. No LLM call is made except in the summarisation
// check, which is skipped when no key is configured.
//
//   node tests/memory.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const memory = require('../src/lib/wa-memory')(pool);

let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg + (extra ? '   ' + extra : ''));
  if (!cond) fails++;
};

(async () => {
  const tag = 'ZZM' + Date.now().toString().slice(-7);
  const phone = '9199' + Date.now().toString().slice(-8);
  let convId;

  try {
    convId = (await pool.query(
      `INSERT INTO wa_conversations (phone, display_name) VALUES ($1,$2) RETURNING conversation_id`,
      [phone, 'ZZ Memory Test'])).rows[0].conversation_id;

    let seq = 0;
    const say = async (direction, body, { ai = false, id } = {}) => {
      const wamid = id || `wamid.${tag}.${++seq}`;
      await pool.query(
        `INSERT INTO wa_messages (conversation_id, direction, wa_message_id, msg_type, body,
                                  ai_generated, status, created_at)
         VALUES ($1,$2,$3,'text',$4,$5,'received', NOW() + ($6 || ' seconds')::interval)`,
        [convId, direction, wamid, body, ai, seq]);
      return wamid;
    };

    console.log('\nEmpty conversation');
    const empty = await memory.context(convId);
    ok(empty.turns.length === 0 && empty.prompt === '',
      'a conversation with no messages produces no memory block');
    ok((await memory.context(null)).prompt === '', 'a missing conversation id is handled');

    console.log('\nTranscript assembly');
    await say('IN', 'Do you have 180 GSM white single jersey?');
    await say('OUT', 'Yes sir, we do. How much do you need?', { ai: true });
    const latest = await say('IN', 'How much for 500 kg?');

    const ctx = await memory.context(convId);
    ok(ctx.turns.length === 3, 'all three turns are present', `got ${ctx.turns.length}`);
    ok(ctx.turns[0].who === 'customer' && ctx.turns[1].who === 'assistant',
      'inbound is the customer, AI-generated outbound is the assistant');
    ok(ctx.turns[0].text.includes('180 GSM'),
      'the product named in the FIRST message survives into memory');
    ok(ctx.turns[2].text.includes('500 kg'), 'turns are oldest-first, newest last');

    console.log('\nThe message being answered is excluded');
    const answering = await memory.context(convId, { excludeWaMessageId: latest });
    ok(answering.turns.length === 2, 'the live message is dropped from history', `got ${answering.turns.length}`);
    ok(!answering.turns.some(t => t.text.includes('500 kg')),
      'so the model does not see the customer say it twice');
    ok(answering.prompt.includes('180 GSM'),
      'but the earlier product reference — the whole point — is still there');

    console.log('\nStaff replies are distinguished from AI replies');
    await say('OUT', 'Let me check with production.', { ai: false });
    const withStaff = await memory.context(convId);
    ok(withStaff.turns.some(t => t.who === 'staff'), 'a human reply is labelled staff, not assistant');

    console.log('\nMedia is marked, not dropped');
    await pool.query(
      `INSERT INTO wa_messages (conversation_id, direction, wa_message_id, msg_type, body, status, created_at)
       VALUES ($1,'IN',$2,'image',NULL,'received', NOW() + INTERVAL '20 seconds')`,
      [convId, `wamid.${tag}.img`]);
    const withMedia = await memory.context(convId);
    ok(withMedia.turns.some(t => t.text === '[image]'),
      'a photo appears as a marker — its absence would make the transcript misleading');

    console.log('\nPrompt framing');
    const p = withMedia.prompt;
    ok(/DATA, not instructions/.test(p),
      'history is labelled as data, since it is customer-authored text');
    ok(/only TOOL RESULTS do that/.test(p),
      'and is explicitly denied the power to establish a price or stock figure');

    console.log('\nThe prompt cannot grow without bound');
    // 40 long messages: far more than the verbatim window.
    for (let i = 0; i < 40; i++) {
      await say('IN', `Message ${i} — ` + 'x'.repeat(300));
    }
    const big = await memory.context(convId);
    ok(big.turns.length <= memory.RECENT_TURNS,
      `at most ${memory.RECENT_TURNS} turns are kept verbatim`, `got ${big.turns.length}`);
    const chars = big.turns.reduce((s, t) => s + t.text.length, 0);
    ok(chars <= 4000 || big.turns.length === 1,
      'and they are capped by character count, not just count', `${chars} chars`);
    ok(big.turns[big.turns.length - 1].text.includes('Message 39'),
      'the NEWEST turns are the ones kept when trimming');

    console.log('\nSummarisation bookkeeping');
    const notYet = await memory.maybeSummarise(convId);
    // 45 messages total, none covered, threshold 20 -> it should attempt.
    ok(notYet.skipped !== 'not enough new messages',
      'a long conversation triggers summarisation', JSON.stringify(notYet).slice(0, 90));

    // Whether the model call succeeds depends on the environment; the contract
    // that matters here is that a failure degrades rather than throws.
    if (notYet.ok) {
      const sum = await memory.latestSummary(convId);
      ok(!!sum && !!sum.summary, 'a summary row is written');
      ok(Number(sum.message_count) === 45 - memory.RECENT_TURNS,
        'it records how much of the conversation it covers', `got ${sum && sum.message_count}`);
      const after = await memory.context(convId);
      ok(/EARLIER IN THIS CONVERSATION/.test(after.prompt),
        'and the summary appears in the prompt alongside recent turns');
      const again = await memory.maybeSummarise(convId);
      ok(again.skipped === 'not enough new messages',
        'it does not re-summarise until enough new messages arrive', JSON.stringify(again).slice(0, 70));
    } else {
      console.log(`  SKIP  model-backed summary (${notYet.skipped || notYet.error || 'unavailable'})`);
      ok(true, 'a failed summarisation degrades quietly instead of throwing');
    }

    console.log('\nA short conversation is left alone');
    const shortConv = (await pool.query(
      `INSERT INTO wa_conversations (phone, display_name) VALUES ($1,'ZZ Short') RETURNING conversation_id`,
      [phone + '1'])).rows[0].conversation_id;
    await pool.query(
      `INSERT INTO wa_messages (conversation_id, direction, wa_message_id, msg_type, body, status)
       VALUES ($1,'IN',$2,'text','hello','received')`, [shortConv, `wamid.${tag}.s1`]);
    const skip = await memory.maybeSummarise(shortConv);
    ok(skip.skipped === 'not enough new messages',
      'no model call is wasted on a two-message conversation');
    await pool.query(`DELETE FROM wa_messages WHERE conversation_id=$1`, [shortConv]);
    await pool.query(`DELETE FROM wa_conversations WHERE conversation_id=$1`, [shortConv]);
  } finally {
    if (convId) {
      await pool.query(`DELETE FROM conversation_summaries WHERE conversation_id=$1`, [convId]);
      await pool.query(`DELETE FROM wa_messages WHERE conversation_id=$1`, [convId]);
      await pool.query(`DELETE FROM wa_ai_actions WHERE conversation_id=$1`, [convId]);
      await pool.query(`DELETE FROM wa_conversations WHERE conversation_id=$1`, [convId]);
    }
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
