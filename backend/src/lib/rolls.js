// Roll lifecycle helpers used by the machine-collector auto-roll flow.
// The green (roll-complete/doff) pulse from the ESP32 collector drives these:
// on each doff the open roll is CLOSED at the current counter and the next roll
// is OPENED. ID generation mirrors the manual create route (rolls.routes.js POST '/')
// so auto rolls are indistinguishable from hand-made ones (rolls.source='AUTO').

const pool = require("../../config/database");

// Resolve the machine's roll_id + fabric fields exactly like the manual route does.
async function resolveRollDefaults(machine_id, shift) {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const [prefixRow, machineRow, seqRow] = await Promise.all([
    pool.query(`SELECT value FROM app_settings WHERE key='roll_prefix'`),
    pool.query(`SELECT fabric_code, fabric, gauge FROM machines WHERE machine_id=$1`, [machine_id]),
    pool.query(`SELECT COUNT(*) AS cnt FROM rolls WHERE machine_id=$1 AND DATE(created_at)=CURRENT_DATE`, [machine_id]),
  ]);

  const fabricCode = machineRow.rows[0]?.fabric_code || null;
  let fabric_item_id = null;
  if (fabricCode) {
    const itemRow = await pool.query(`SELECT item_id FROM items WHERE item_code=$1 LIMIT 1`, [fabricCode]);
    if (itemRow.rows.length) fabric_item_id = itemRow.rows[0].item_id;
  }

  const prefix = (prefixRow.rows[0]?.value || "DHM-").replace(/[-\s]+$/, "");
  const fabric_type = machineRow.rows[0]?.fabric || null;
  const gaugeVal = machineRow.rows[0]?.gauge ? `G${machineRow.rows[0].gauge}` : null;
  const seq = String(parseInt(seqRow.rows[0].cnt) + 1).padStart(3, "0");
  const fabricPart = fabricCode ? `-${fabricCode}` : "";
  const gaugePart = gaugeVal ? `-${gaugeVal}` : "";
  const roll_id = `${prefix}-${machine_id}${fabricPart}${gaugePart}-${datePart}-${shift}-${seq}`;

  return { roll_id, fabric_type, fabric_item_id };
}

// Open a new OPEN roll. Caller must ensure the machine has no open roll first.
async function openRoll(machine_id, shift, start_counter, operator_id) {
  const { roll_id, fabric_type, fabric_item_id } = await resolveRollDefaults(machine_id, shift);
  const r = await pool.query(
    `INSERT INTO rolls
       (roll_id, machine_id, fabric_type, shift, start_counter, current_counter, status, created_at, operator_id, fabric_item_id, source)
     VALUES ($1,$2,$3,$4,$5,$5,'OPEN',NOW(),$6,$7,'AUTO')
     RETURNING roll_id`,
    [roll_id, machine_id, fabric_type, shift, start_counter || 0, operator_id || null, fabric_item_id || null]
  );
  return r.rows[0].roll_id;
}

// Close the given open roll at end_counter. Fills an ESTIMATED weight from the
// counter delta (kg_per_counter) as a placeholder — the operator overwrites it
// with the real scale weight on approval. Existing weight (if any) is preserved.
async function closeOpenRoll(openRollRow, end_counter, kg_per_counter) {
  const start = parseFloat(openRollRow.start_counter || 0);
  const kpc = parseFloat(kg_per_counter || 0);
  const MAX_ROLL_KG = 150;   // sanity ceiling — a knitting roll is ~15-30kg; above this the
                             // start_counter is stale (e.g. a legacy 0-start roll) → leave blank.
  const estKg = kpc > 0 ? Math.round((end_counter - start) * kpc * 100000) / 100000 : null;
  const safeEst = estKg !== null && estKg >= 0 && estKg <= MAX_ROLL_KG ? estKg : null;
  await pool.query(
    `UPDATE rolls
       SET status='CLOSED',
           current_counter=$1,
           closed_at=NOW(),
           actual_weight_kg=COALESCE(actual_weight_kg, $2)
     WHERE roll_id=$3`,
    [end_counter, safeEst, openRollRow.roll_id]
  );
}

module.exports = { openRoll, closeOpenRoll };
