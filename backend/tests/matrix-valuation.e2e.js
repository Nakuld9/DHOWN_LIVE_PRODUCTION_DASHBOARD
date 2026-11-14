// Approval-matrix editor and stock valuation.
//
// The matrix tests are almost all about what the editor REFUSES. A band set can
// be wrong in two quiet ways and the live lookup hides both: overlapping bands
// resolve by "ORDER BY min_value DESC LIMIT 1" and look decisive, and a gap
// falls through to hardcoded defaults, so the screen shows one policy while the
// system applies another.
//
// The valuation tests are about honesty rather than arithmetic: a past-dated
// figure is only as good as the ledger behind it, and the report has to say so
// instead of returning a confident near-zero.
//
//   node tests/matrix-valuation.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const matrix = require('../src/lib/approval-matrix')(pool);
const valuation = require('../src/lib/stock-valuation')(pool);

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const made = [];

(async () => {
  try {
    console.log('\nThe matrix reports coverage, not just rows');
    const before = await matrix.list();
    ok(!!before.matrix.ORDER, 'ORDER bands are listed');
    ok(before.matrix.ORDER.covered === true,
      'and the seeded set is contiguous from zero with an open top',
      JSON.stringify(before.matrix.ORDER.problems));

    console.log('\nOverlaps are refused, because the winner would be arbitrary');
    // ORDER already has 100000–1000000. This straddles it.
    const clash = await matrix.create(
      { doc_type: 'ORDER', min_value: 500000, max_value: 2000000, required_role: 'ADMIN' }, { by: 'test' });
    ok(clash.code === 409, 'a band overlapping an existing one is refused', clash.error);
    ok(/overlap/i.test(clash.error || ''), 'and the message says which', clash.error);

    console.log('\nBands that can never match are refused');
    ok((await matrix.create({ doc_type: 'ORDER', min_value: 100, max_value: 100, required_role: 'ADMIN' })).code === 400,
      'a band whose top equals its bottom');
    ok((await matrix.create({ doc_type: 'ORDER', min_value: 500, max_value: 100, required_role: 'ADMIN' })).code === 400,
      'and one whose top is below its bottom');
    ok((await matrix.create({ doc_type: 'ORDER', min_value: -5, max_value: 100, required_role: 'ADMIN' })).code === 400,
      'and one starting below zero');

    console.log('\nThe vocabulary is closed');
    ok((await matrix.create({ doc_type: 'INVOICE', min_value: 0, required_role: 'ADMIN' })).code === 400,
      'an unknown document type is refused');
    ok((await matrix.create({ doc_type: 'ORDER', min_value: 0, required_role: 'OPERATOR' })).code === 400,
      'and an approver role that is not an approver');

    console.log('\nA gap is visible rather than silent');
    // Build a deliberately broken set on a type we control, then read it back.
    const gapType = 'QUOTE';
    const q = await matrix.list();
    const quoteBands = q.matrix[gapType].bands;
    // Deactivate the open-ended top band, leaving values above it uncovered.
    const top = quoteBands.find(b => b.max_value === null && b.is_active);
    ok(!!top, 'QUOTE has an open-ended top band to begin with');
    const off = await matrix.deactivate(top.rule_id, { by: 'test' });
    ok(off.ok === true, 'it can be deactivated');
    made.push({ restore: top.rule_id });

    const holed = await matrix.list();
    ok(holed.matrix[gapType].covered === false, 'and the set is now reported as not covered');
    ok(holed.matrix[gapType].problems.some(p => /above/i.test(p)),
      'naming the uncovered range rather than just failing',
      JSON.stringify(holed.matrix[gapType].problems));

    // And the preview shows the consequence: a big quote now matches nothing.
    const fell = await matrix.preview('QUOTE', 9000000);
    ok(fell.falls_back === true, 'a value in the gap matches no band');
    ok(fell.required_role === null, 'so the screen cannot claim a role for it');

    // Put it back.
    await matrix.update(top.rule_id, { is_active: true }, { by: 'test' });
    ok((await matrix.list()).matrix[gapType].covered === true, 'restoring it closes the gap again');

    console.log('\nA covered type has no room for another band');
    // Every doc type is contiguous from zero to open by design, so there is no
    // value a new band could occupy. Refusing is correct — this asserts the
    // refusal rather than treating it as an obstacle.
    const noRoom = await matrix.create(
      { doc_type: 'CREDIT', min_value: 5000000, required_role: 'SUPER_ADMIN' }, { by: 'test' });
    ok(noRoom.code === 409,
      'adding to a fully covered type is refused, not silently accepted', noRoom.error);

    console.log('\nDeactivate, not delete');
    // An approval granted last month was granted under the band as it stood
    // then; deleting the row makes that decision unexplainable. So a retired
    // band is deactivated and the row survives.
    const credit = (await matrix.list()).matrix.CREDIT.bands.find(b => b.is_active);
    ok(!!credit, 'CREDIT has an active band');
    made.push({ restore: credit.rule_id });

    const d = await matrix.deactivate(credit.rule_id, { by: 'test' });
    ok(d.ok === true, 'it can be retired');
    const still = await pool.query(`SELECT is_active FROM approval_matrix WHERE rule_id=$1`, [credit.rule_id]);
    ok(still.rows.length === 1 && still.rows[0].is_active === false,
      'the row survives so past decisions stay explainable');
    ok((await matrix.deactivate(credit.rule_id, { by: 'test' })).code === 404,
      'retiring it twice is a 404, not a silent success');

    // With it retired there IS room, which proves the overlap check is about
    // real coverage rather than a blanket refusal.
    const nowFits = await matrix.create(
      { doc_type: 'CREDIT', min_value: 0, required_role: 'ADMIN' }, { by: 'test' });
    ok(nowFits.ok === true, 'and once retired, a replacement band fits', nowFits.error || '');
    if (nowFits.ok) made.push({ remove: nowFits.band.rule_id });

    console.log('\nPreview shows the policy as APPLIED');
    const p1 = await matrix.preview('ORDER', 50000);
    ok(p1.required_role === 'SUPERVISOR', 'a small order needs a supervisor', p1.required_role);
    const p2 = await matrix.preview('ORDER', 5000000);
    ok(p2.required_role === 'SUPER_ADMIN', 'a very large one needs a super admin', p2.required_role);
    ok(p1.ambiguous === false && p2.ambiguous === false, 'and neither is ambiguous');

    console.log('\nStock valuation: today is reliable');
    const now = await valuation.valuation({});
    ok(now.basis === 'live stock tables', 'today comes from the live tables, not the ledger');
    ok(now.reconstructed === false, 'so nothing is reconstructed');
    ok(typeof now.total_value === 'number', 'it produces a number', String(now.total_value));
    ok(now.total_value === Math.round(
      (now.categories.yarn.value + now.categories.greige.value + now.categories.finished.value) * 100) / 100,
      'and the categories sum to the total');
    ok(!!now.categories.greige.basis, 'each category states its valuation basis',
      now.categories.greige.basis);

    console.log('\nAnd a past date is honest about what it rests on');
    const cov = await valuation.coverage();
    const wayBack = '2020-01-01';
    const old = await valuation.valuation({ as_at: wayBack });
    ok(old.reconstructed === true, 'a past date is reconstructed from the ledger');
    ok(old.reliable === false,
      'and is flagged unreliable when the ledger does not reach back that far',
      `ledger starts ${cov.from_date || 'never'}`);
    ok(old.warnings.some(w => /ledger/i.test(w)),
      'with a warning that says why, rather than a bare number',
      old.warnings[0] || 'no warning');
    ok(!!old.ledger_coverage, 'and the coverage is returned alongside the figure');

  } finally {
    for (const m of made) {
      if (m.remove) await pool.query(`DELETE FROM approval_matrix WHERE rule_id=$1`, [m.remove]).catch(() => {});
      if (m.restore) await pool.query(`UPDATE approval_matrix SET is_active=true WHERE rule_id=$1`, [m.restore]).catch(() => {});
    }
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
