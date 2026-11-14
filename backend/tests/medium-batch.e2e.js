// The quality gate, timestamps, and the retention viewer's endpoint.
//
// The quality gate is the one with teeth: grade was recorded per roll and
// quarantine blocked allocation, but nothing stopped a roll that FAILED
// inspection from being dispatched if nobody had quarantined it. QC and
// dispatch were linked by convention. This asserts the convention is now a
// check — and that the override still exists, because a customer accepting a
// B-grade lot at a discount is normal here and refusing outright would strand
// real dispatches.
//
//   node tests/medium-batch.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const TAG = 'ZZQC' + Date.now().toString().slice(-6);
// dispatch_items.roll_id is INTEGER while rolls.roll_id is VARCHAR, so roll ids
// must be numeric strings. 999xxxxx is far above anything the mill produces.
const RID = (n) => String(99900000 + (Date.now() % 90000) + n);
const dispatchRepo = require('../src/repositories/dispatch.repository')(pool, { postToLedger: async () => {} });

let rollId, machineId;

(async () => {
  try {
    console.log('\nTimestamps');
    const noTs = (await pool.query(`
      SELECT COUNT(*)::int n FROM information_schema.tables t
       WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
            WHERE c.table_name=t.table_name AND c.table_schema=t.table_schema
              AND c.column_name IN ('created_at','updated_at','timestamp'))`)).rows[0].n;
    ok(noTs === 0, 'every table can now answer "when did this change?"', `${noTs} without any timestamp`);

    // New rows must actually get stamped, not merely have the column.
    const probe = await pool.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name='machines' AND column_name='created_at'`);
    ok(/now\(\)/i.test(probe.rows[0]?.column_default || ''),
      'and new rows are stamped automatically', probe.rows[0]?.column_default || 'no default');

    // A table with created_at but NO updated_at is the dangerous shape, because
    // it looks fine to any "does this table have timestamps" check. `rolls` was
    // exactly that, and two dispatch paths wrote `UPDATE rolls SET ...
    // updated_at = NOW()`, so every greige dispatch threw and rolled back.
    const writesUpdatedAt = ['rolls', 'finished_goods', 'yarn_lots', 'batches', 'machines'];
    for (const t of writesUpdatedAt) {
      const has = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name='updated_at'`, [t]);
      ok(has.rows.length === 1, `${t} has updated_at — code writes it`, has.rows.length ? '' : 'MISSING');
    }

    console.log('\nQuality gate: a failed roll cannot be quietly dispatched');
    machineId = 'ZZM' + Date.now().toString().slice(-4);
    await pool.query(
      `INSERT INTO machines (machine_id, machine_name) VALUES ($1,'ZZ QC Machine')
       ON CONFLICT (machine_id) DO NOTHING`, [machineId]);

    rollId = RID(1);
    await pool.query(
      `INSERT INTO rolls (roll_id, machine_id, fabric_type, actual_weight_kg, shift, warehouse_status, quarantine_status)
       VALUES ($1,$2,'Single Jersey',24.5,'A','IN_STOCK','NONE')`, [rollId, machineId]);

    // The roll failed inspection but nobody quarantined it — the exact hole.
    await pool.query(
      `INSERT INTO quality_inspections (roll_id, inspection_type, inspector, inspection_date, grade,
                                        defect_type, defect_severity, passed)
       VALUES ($1,'FINAL','zz-inspector',NOW(),'C','HOLES','major',false)`, [rollId]);

    const blocked = await dispatchRepo.createDispatch({
      dispatch_number: TAG + '-D1', customer_name: 'ZZ QC Customer', dispatch_date: new Date().toISOString().slice(0, 10),
      dispatch_type: 'GREIGE', items: [{ roll_id: rollId, weight_kg: 24.5 }],
      priced: [{ rate: 0, gst: 0, taxable: 0, gstAmt: 0, total: 0 }],
      total_kg: 24.5, hasPricing: false, totTaxable: 0, totGst: 0, username: 'zztest',
    });
    ok(!!blocked.badRequest, 'dispatching it is refused', blocked.badRequest || 'ALLOWED — the gate is missing');
    ok(/failed inspection/i.test(blocked.badRequest || ''), 'and the refusal says why', blocked.badRequest);
    ok(/grade C|HOLES|major/.test(blocked.badRequest || ''),
      'naming the actual defect, not just "rejected"', blocked.badRequest);

    // The roll must not have been half-dispatched by the failed attempt.
    const after = await pool.query(`SELECT warehouse_status FROM rolls WHERE roll_id=$1`, [rollId]);
    ok(after.rows[0].warehouse_status === 'IN_STOCK', 'and the transaction rolled back cleanly');
    ok((await pool.query(`SELECT COUNT(*)::int n FROM dispatch_challans WHERE dispatch_number=$1`,
      [TAG + '-D1'])).rows[0].n === 0, 'leaving no half-written challan');

    console.log('\nBut an override still works, and is recorded');
    const allowed = await dispatchRepo.createDispatch({
      dispatch_number: TAG + '-D2', customer_name: 'ZZ QC Customer', dispatch_date: new Date().toISOString().slice(0, 10),
      dispatch_type: 'GREIGE', items: [{ roll_id: rollId, weight_kg: 24.5 }],
      priced: [{ rate: 0, gst: 0, taxable: 0, gstAmt: 0, total: 0 }],
      total_kg: 24.5, hasPricing: false, totTaxable: 0, totGst: 0, username: 'zztest',
      qc_override_reason: 'Customer accepted B-grade at an agreed discount',
    });
    ok(!allowed.badRequest, 'with a written reason it goes through', allowed.badRequest || '');
    const audit = await pool.query(
      `SELECT action, new_value FROM audit_logs WHERE action LIKE $1 ORDER BY id DESC LIMIT 1`,
      ['%QC OVERRIDE%' + '']);
    ok(audit.rows.length > 0 && /QC OVERRIDE/.test(audit.rows[0].action),
      'and the override is in the audit log — never silent', audit.rows[0]?.action || 'no entry');
    ok(/agreed discount/.test(String(audit.rows[0]?.new_value || '')),
      'with the reason that was given');

    console.log('\nA passing roll is unaffected');
    const goodRoll = RID(2);
    await pool.query(
      `INSERT INTO rolls (roll_id, machine_id, fabric_type, actual_weight_kg, shift, warehouse_status, quarantine_status)
       VALUES ($1,$2,'Single Jersey',20,'A','IN_STOCK','NONE')`, [goodRoll, machineId]);
    await pool.query(
      `INSERT INTO quality_inspections (roll_id, inspection_type, inspector, inspection_date, grade, passed)
       VALUES ($1,'FINAL','zz-inspector',NOW(),'A',true)`, [goodRoll]);
    const fine = await dispatchRepo.createDispatch({
      dispatch_number: TAG + '-D3', customer_name: 'ZZ QC Customer', dispatch_date: new Date().toISOString().slice(0, 10),
      dispatch_type: 'GREIGE', items: [{ roll_id: goodRoll, weight_kg: 20 }],
      priced: [{ rate: 0, gst: 0, taxable: 0, gstAmt: 0, total: 0 }],
      total_kg: 20, hasPricing: false, totTaxable: 0, totGst: 0, username: 'zztest',
    });
    ok(!fine.badRequest, 'a roll that passed dispatches with no ceremony', fine.badRequest || '');

    // And so is a roll nobody has inspected — this system does not require an
    // inspection to exist, only that a recorded failure is not ignored.
    const uninspected = RID(3);
    await pool.query(
      `INSERT INTO rolls (roll_id, machine_id, fabric_type, actual_weight_kg, shift, warehouse_status, quarantine_status)
       VALUES ($1,$2,'Single Jersey',18,'A','IN_STOCK','NONE')`, [uninspected, machineId]);
    const un = await dispatchRepo.createDispatch({
      dispatch_number: TAG + '-D4', customer_name: 'ZZ QC Customer', dispatch_date: new Date().toISOString().slice(0, 10),
      dispatch_type: 'GREIGE', items: [{ roll_id: uninspected, weight_kg: 18 }],
      priced: [{ rate: 0, gst: 0, taxable: 0, gstAmt: 0, total: 0 }],
      total_kg: 18, hasPricing: false, totTaxable: 0, totGst: 0, username: 'zztest',
    });
    ok(!un.badRequest, 'and so does one nobody inspected — only a recorded failure blocks', un.badRequest || '');

  } finally {
    // Clean up by machine_id, not by RID(). RID() derives from Date.now(), so
    // calling it here returns DIFFERENT ids than the ones created above — which
    // is exactly why an earlier version left 13 test machines and 37 rolls in
    // the live database: the rolls never matched, so they survived, and the
    // machine delete then failed silently on the foreign key. Deleting the
    // children by their parent machine removes whatever this run actually made.
    if (machineId) {
      await pool.query(
        `DELETE FROM quality_inspections WHERE roll_id IN (SELECT roll_id FROM rolls WHERE machine_id=$1)`,
        [machineId]).catch(() => {});
      await pool.query(
        `DELETE FROM dispatch_items WHERE dispatch_id IN (SELECT dispatch_id FROM dispatch_challans WHERE dispatch_number LIKE $1)`,
        [TAG + '%']).catch(() => {});
      await pool.query(`DELETE FROM dispatch_challans WHERE dispatch_number LIKE $1`, [TAG + '%']).catch(() => {});
      await pool.query(`DELETE FROM machine_status_log WHERE machine_id=$1`, [machineId]).catch(() => {});
      await pool.query(`DELETE FROM rolls WHERE machine_id=$1`, [machineId]).catch(() => {});
      await pool.query(`DELETE FROM machines WHERE machine_id=$1`, [machineId]).catch(() => {});
    }
    await pool.query(`DELETE FROM audit_logs WHERE username='zztest'`).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
