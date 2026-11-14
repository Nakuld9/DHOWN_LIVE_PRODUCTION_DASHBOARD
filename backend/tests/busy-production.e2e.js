// Pushing production to Busy, shift by shift.
//
// Busy is a ledger, so the failure that matters is the same production reaching
// it twice — that double-stocks the books and is invisible until a stock-take.
// Most of what is asserted here is therefore that a roll is exported AT MOST
// ONCE, no matter how the export is run, while the output still aggregates by
// shift the way Busy wants it.
//
//   node tests/busy-production.e2e.js

require('dotenv').config({ quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'dhown_mes',
  port: process.env.DB_PORT || 5432,
});

const busy = require('../src/lib/busy-production')(pool);

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

const TAG = 'ZZB' + Date.now().toString().slice(-6);
let machineId, catId;
const rollIds = [];

// Rolls the test creates, closed on a date so they count as produced.
async function mkRoll({ shift, fabric, kg, day }) {
  const id = String(99900000 + rollIds.length + 1 + (Date.now() % 90000));
  await pool.query(
    `INSERT INTO rolls (roll_id, machine_id, fabric_type, actual_weight_kg, shift, warehouse_status,
                        quarantine_status, closed_at, created_at)
     VALUES ($1,$2,$3,$4,$5,'IN_STOCK','NONE',$6::timestamp,$6::timestamp)`,
    [id, machineId, fabric, kg, shift, day]);
  rollIds.push(id);
  return id;
}

(async () => {
  machineId = 'QAB' + Date.now().toString().slice(-4);  // non-ZZ so production includes it
  await pool.query(`INSERT INTO machines (machine_id, machine_name) VALUES ($1,'ZZ Busy Test') ON CONFLICT DO NOTHING`, [machineId]);

  try {
    const DAY = '2026-03-15';
    // Day shift: two Single Jersey rolls + one Rib. Night shift: one Single Jersey.
    await mkRoll({ shift: 'A', fabric: 'Single Jersey', kg: 24.5, day: DAY + ' 10:00' });
    await mkRoll({ shift: 'A', fabric: 'Single Jersey', kg: 25.0, day: DAY + ' 11:00' });
    await mkRoll({ shift: 'A', fabric: 'Rib', kg: 30.0, day: DAY + ' 12:00' });
    await mkRoll({ shift: 'B', fabric: 'Single Jersey', kg: 26.0, day: DAY + ' 22:00' });

    console.log('\nPreview aggregates by shift and fabric');
    const pv = await busy.preview({ from: DAY, to: DAY });
    ok(pv.total_rolls === 4, 'all four produced rolls are pending', `${pv.total_rolls}`);
    ok(pv.total_kg === 105.5, 'total kg is the sum of weighed weights', `${pv.total_kg}`);
    ok(pv.lines.length === 3, 'three shift-lines: A/SJ, A/Rib, B/SJ', `${pv.lines.length}`);
    const aSJ = pv.lines.find(l => l.shift === 'A' && l.fabric_type === 'Single Jersey');
    ok(aSJ && aSJ.roll_count === 2 && aSJ.total_kg === 49.5,
      'the A-shift Single Jersey line sums its two rolls', aSJ ? `${aSJ.roll_count} rolls / ${aSJ.total_kg} kg` : 'missing');
    ok(aSJ && aSJ.roll_ids.length === 2, 'and carries its roll ids for traceability');

    console.log('\nExport claims the rolls so they cannot be sent twice');
    const ex = await busy.generate({ from: DAY, to: DAY, by: 'test' });
    ok(ex.ok && !ex.empty, 'export produces a batch');
    ok(ex.total_rolls === 4 && ex.lines.length === 3, 'with all four rolls in three lines');
    const batchId = ex.batch_id;

    // The cardinal rule: run it again, nothing is re-exported.
    const again = await busy.generate({ from: DAY, to: DAY, by: 'test' });
    ok(again.empty === true, 're-running the export finds nothing new — no double-push', JSON.stringify(again.message || ''));
    const pv2 = await busy.preview({ from: DAY, to: DAY });
    ok(pv2.total_rolls === 0, 'and the preview is now empty for that period');

    console.log('\nThe CSV is Busy-shaped and carries roll ids');
    const b = await busy.getBatch(batchId);
    const csv = busy.toCsv(b.lines, batchId);
    ok(/Date,Shift,Item,Qty \(kg\),Rolls,Batch Ref,Roll IDs,Narration/.test(csv), 'header matches the Busy import shape');
    ok(csv.split('\n').length === 4, 'one header + three shift lines', `${csv.split('\n').length} lines`);
    ok(/MES-PROD-/.test(csv), 'each line carries the batch reference');
    ok(csv.includes(rollIds[0]), 'and the actual roll ids travel in the reference column');

    console.log('\nA roll closed after the shift was exported is a top-up, not a loss');
    await mkRoll({ shift: 'A', fabric: 'Single Jersey', kg: 20.0, day: DAY + ' 13:00' });
    const pv3 = await busy.preview({ from: DAY, to: DAY });
    ok(pv3.total_rolls === 1, 'the late roll shows as newly pending', `${pv3.total_rolls}`);
    const top = await busy.generate({ from: DAY, to: DAY, by: 'test' });
    ok(top.total_rolls === 1, 'and exports as its own top-up line', `${top.total_rolls}`);

    console.log('\nConfirm and void');
    const conf = await busy.confirm(batchId, { by: 'test', busy_ref: 'BUSY-VCH-9001' });
    ok(conf.ok === true, 'a batch can be confirmed as imported into Busy');
    ok((await busy.confirm(batchId, { by: 'test' })).code === 404, 'confirming twice is refused');

    // A confirmed batch must NOT be voidable — that is the double-push door.
    const voidConfirmed = await busy.voidBatch(batchId, { by: 'test' });
    ok(voidConfirmed.code === 409, 'a confirmed batch cannot be voided (would allow a double-push)', voidConfirmed.error);

    // But the top-up batch (still EXPORTED) can be voided, releasing its roll.
    const v = await busy.voidBatch(top.batch_id, { by: 'test', reason: 'Busy import failed' });
    ok(v.ok === true && v.released_rolls === 1, 'an unconfirmed batch voids and releases its roll', `${v.released_rolls}`);
    const pv4 = await busy.preview({ from: DAY, to: DAY });
    ok(pv4.total_rolls === 1, 'the released roll is pending again, ready to re-send', `${pv4.total_rolls}`);

    console.log('\nHistory records what happened');
    // batch_id is a bigint, returned by pg as a string — compare as strings.
    const hist = await busy.history({});
    const byId = (id) => hist.find(h => String(h.batch_id) === String(id));
    ok(byId(batchId) && byId(batchId).status === 'CONFIRMED', 'the confirmed batch is in history', byId(batchId)?.status);
    ok(byId(top.batch_id) && byId(top.batch_id).status === 'VOIDED', 'the voided one too', byId(top.batch_id)?.status);

  } finally {
    // Order matters: export rolls, then batches, then rolls, then machine.
    await pool.query(
      `DELETE FROM busy_production_export_rolls WHERE roll_id = ANY($1)`, [rollIds]).catch(() => {});
    await pool.query(
      `DELETE FROM busy_production_batches WHERE generated_by='test'
        AND batch_id NOT IN (SELECT DISTINCT batch_id FROM busy_production_export_rolls)`).catch(() => {});
    // Any batch still referencing test rolls (belt and braces).
    await pool.query(
      `DELETE FROM busy_production_batches WHERE from_date='2026-03-15' AND generated_by='test'`).catch(() => {});
    await pool.query(`DELETE FROM rolls WHERE machine_id=$1`, [machineId]).catch(() => {});
    await pool.query(`DELETE FROM machines WHERE machine_id=$1`, [machineId]).catch(() => {});
  }

  console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
  await pool.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
