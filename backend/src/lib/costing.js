// Costing/ledger helpers — cost entries, stock-ledger postings, yarn rate.
// addCostEntry/postToLedger take an open pg client (they run inside transactions).

const pool = require("../../config/database");

// Helper: get yarn rate for a fabric_type (falls back to 'Default')
async function getYarnRate(fabric_type) {
  const r = await pool.query(
    `SELECT price_per_kg FROM cost_rates WHERE yarn_type=$1 OR yarn_type='Default' ORDER BY (yarn_type=$1) DESC LIMIT 1`,
    [fabric_type || 'Default']
  );
  return r.rows.length ? parseFloat(r.rows[0].price_per_kg) : 170;
}

// Helper: coerce form values to numeric or NULL (Postgres rejects '' for numeric columns)
function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

// Helper: insert a cost entry
async function addCostEntry(client, { reference_type, reference_id, cost_component, amount_rs, quantity_kg, rate_used, fabric_type, color_name, notes }) {
  await client.query(
    `INSERT INTO cost_entries (reference_type,reference_id,cost_component,amount_rs,quantity_kg,rate_used,fabric_type,color_name,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [reference_type, String(reference_id), cost_component, amount_rs, quantity_kg||null, rate_used||null, fabric_type||null, color_name||null, notes||null]
  );
}

// Writes one stock_ledger row on the given transaction client. It deliberately
// does NOT swallow errors: every caller runs this inside a BEGIN/COMMIT, and a
// silently-dropped ledger write would let the enclosing transaction commit the
// business change (roll approved, goods dispatched, GRN received) WITHOUT the
// matching stock movement — the ledger would then drift from reality with no
// error anywhere. Letting it throw makes the whole transaction roll back, which
// is the only safe behaviour. (Audit P1-1 root cause.)
async function postToLedger(client, { doc_type, doc_id, item_id, item_desc, warehouse_id, movement_type, quantity, uom_code, unit_cost, partner_id, notes, created_by }) {
  const total_cost = (unit_cost && quantity) ? parseFloat(unit_cost) * parseFloat(quantity) : null;
  await client.query(
    `INSERT INTO stock_ledger (doc_type,doc_id,item_id,item_desc,warehouse_id,movement_type,quantity,uom_code,unit_cost,total_cost,partner_id,notes,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [doc_type, String(doc_id), item_id||null, item_desc||null, warehouse_id||null,
     movement_type, quantity, uom_code||'KG', unit_cost||null, total_cost,
     partner_id||null, notes||null, created_by||'system']
  );
}

module.exports = { getYarnRate, numOrNull, addCostEntry, postToLedger };
