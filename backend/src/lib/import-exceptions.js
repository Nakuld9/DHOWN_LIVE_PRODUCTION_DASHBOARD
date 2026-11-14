// Import exception engine (spec §23-24). Scans active imports and raises/updates/
// auto-resolves exceptions. Each scan RECONCILES: a condition still true keeps its
// open exception (its human status is preserved), a condition that has cleared
// auto-resolves, a new condition opens a fresh exception. One active auto-detected
// exception per (import, type) — enforced by a partial unique index.
//
// All figures come from live import/customs/GRN/document data — nothing invented.

const num = (v, d) => { const n = parseFloat(process.env[v]); return Number.isFinite(n) ? n : d; };
const STATUS_ORDER = ['PLANNED', 'BOOKED', 'LOADED', 'IN_TRANSIT', 'AT_TRANSSHIPMENT', 'ARRIVED_PORT', 'CUSTOMS', 'RELEASED', 'INLAND_TRANSIT', 'WAREHOUSE', 'GRN_COMPLETED', 'CLOSED'];
const stage = (s) => STATUS_ORDER.indexOf(s);
const RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

module.exports = (pool) => {
  const audit = async (username, action, newVal) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'IMPORTS',$3)`,
      [username || null, action, newVal ? JSON.stringify(newVal).slice(0, 4000) : null]); } catch {}
  };

  // Detect the exception conditions for one import row (from the scan query).
  function detect(r) {
    const out = [];
    const CRIT_DELAY = num('IMPORT_CRITICAL_DELAY_DAYS', 7);
    const ETA_APPROACH = num('IMPORT_ETA_APPROACH_DAYS', 3);
    const MIN_DOCS = num('IMPORT_MIN_DOCS', 5);
    const SHORTAGE_ETA = num('IMPORT_SHORTAGE_ETA_DAYS', 10);
    const SHORTAGE_STOCK = num('IMPORT_SHORTAGE_STOCK_KG', 500);
    const delay = Number(r.delay_days) || 0;
    const daysToEta = r.days_to_eta == null ? null : Number(r.days_to_eta);
    const st = stage(r.status);

    // Delay / critical delay (mutually exclusive).
    if (delay > CRIT_DELAY) out.push({ type: 'CRITICAL_DELAY', severity: 'CRITICAL', description: `${delay} days late (ETA ${r.current_eta} vs original ${r.original_eta}).` });
    else if (delay > 0) out.push({ type: 'DELAY', severity: delay >= 3 ? 'HIGH' : 'MEDIUM', description: `${delay} day(s) behind original ETA.` });

    // ETA approaching (before it has arrived).
    if (daysToEta != null && daysToEta >= 0 && daysToEta <= ETA_APPROACH && st < stage('ARRIVED_PORT'))
      out.push({ type: 'ETA_APPROACHING', severity: 'LOW', description: `Arriving in ${daysToEta} day(s) — prepare clearance & transport.` });

    // Customs pending: at/after port arrival but not cleared.
    if (st >= stage('ARRIVED_PORT') && st <= stage('CUSTOMS')) {
      const cs = (r.customs_status || 'NOT_FILED');
      if (!['OUT_OF_CHARGE', 'RELEASED'].includes(cs))
        out.push({ type: 'CUSTOMS_PENDING', severity: 'HIGH', description: `At port, customs ${cs} — not yet cleared.` });
    }

    // Documents missing once the goods are moving.
    if (st >= stage('LOADED') && Number(r.docs_present) < MIN_DOCS)
      out.push({ type: 'DOCUMENT_MISSING', severity: 'MEDIUM', description: `Only ${r.docs_present} document(s) on file — key import documents may be missing.` });

    // GRN pending: released/at warehouse but not fully received.
    if (st >= stage('RELEASED') && Number(r.received) < Number(r.quantity) - 0.01)
      out.push({ type: 'GRN_PENDING', severity: st >= stage('WAREHOUSE') ? 'HIGH' : 'MEDIUM', description: `Received ${Number(r.received)} of ${Number(r.quantity)} — GRN not complete.` });

    // Stock shortage risk: a material actually BEING CONSUMED is running low while the
    // replenishing shipment is still far out — i.e. it may run out before the goods land.
    // Low/zero stock alone is NOT a shortage: an imported material simply not yet received
    // (0 stock, no consumption) is goods-in-transit, not a shortage. So this requires real
    // consumption in the window; with none, no shortage is asserted (matches import-shortage.js).
    const consumedKg = Number(r.material_consumed_kg) || 0;
    if (r.material_id && consumedKg > 0 && daysToEta != null && daysToEta > SHORTAGE_ETA && Number(r.material_stock) < SHORTAGE_STOCK && st < stage('WAREHOUSE'))
      out.push({ type: 'STOCK_SHORTAGE_RISK', severity: 'MEDIUM', description: `Material stock ${Number(r.material_stock)} kg is low (consuming ~${consumedKg} kg recently) and this shipment is ${daysToEta} days out.` });

    return out;
  }

  async function scan() {
    const rows = (await pool.query(`
      SELECT i.import_id, i.import_no, i.status, i.priority, i.quantity, i.material_id,
             i.original_eta, i.current_eta,
             (i.current_eta - i.original_eta) AS delay_days,
             (i.current_eta - CURRENT_DATE) AS days_to_eta,
             c.customs_status,
             COALESCE((SELECT SUM(yl.net_weight_kg) FROM import_grn_links k JOIN grn g ON g.grn_id=k.grn_id
                        JOIN yarn_lots yl ON yl.grn_id=g.grn_id
                       WHERE k.import_id=i.import_id AND UPPER(COALESCE(g.status,''))='APPROVED'),0) AS received,
             (SELECT COUNT(DISTINCT doc_type) FROM import_documents d
               WHERE d.import_id=i.import_id AND d.status IN ('UPLOADED','VERIFIED')) AS docs_present,
             COALESCE((SELECT SUM(current_stock_kg) FROM yarn_lots WHERE item_id=i.material_id),0) AS material_stock,
             COALESCE((SELECT SUM(ABS(m.quantity_kg)) FROM yarn_lot_movements m JOIN yarn_lots yl ON yl.lot_id=m.lot_id
                        WHERE yl.item_id=i.material_id
                          AND m.created_at >= CURRENT_DATE - 30
                          AND m.movement_type ILIKE ANY (ARRAY['%issue%','%consume%','%out%'])),0) AS material_consumed_kg
        FROM imports i
        LEFT JOIN import_customs c ON c.import_id=i.import_id
       WHERE i.deleted_at IS NULL AND i.status NOT IN ('GRN_COMPLETED','CLOSED')`)).rows;

    let opened = 0, updated = 0, resolved = 0;
    for (const r of rows) {
      const detected = detect(r);
      const active = (await pool.query(
        `SELECT exception_id, exception_type FROM import_exceptions
          WHERE import_id=$1 AND auto_detected=true AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`, [r.import_id])).rows;
      const activeTypes = new Map(active.map(a => [a.exception_type, a.exception_id]));
      const detectedTypes = new Set(detected.map(d => d.type));

      for (const d of detected) {
        if (activeTypes.has(d.type)) {
          await pool.query(`UPDATE import_exceptions SET severity=$1, description=$2, updated_at=NOW() WHERE exception_id=$3`,
            [d.severity, d.description, activeTypes.get(d.type)]);
          updated++;
        } else {
          await pool.query(
            `INSERT INTO import_exceptions (import_id, exception_type, severity, description, auto_detected)
             VALUES ($1,$2,$3,$4,true)`, [r.import_id, d.type, d.severity, d.description]);
          opened++;
        }
      }
      for (const a of active) {
        if (!detectedTypes.has(a.exception_type)) {
          await pool.query(`UPDATE import_exceptions SET status='RESOLVED', resolved_at=NOW(),
            resolution=COALESCE(resolution,'Auto: condition cleared'), updated_at=NOW() WHERE exception_id=$1`, [a.exception_id]);
          resolved++;
        }
      }
    }
    return { scanned: rows.length, opened, updated, auto_resolved: resolved };
  }

  async function list({ status, severity, import_id } = {}) {
    const where = []; const params = [];
    if (status) { params.push(status); where.push(`e.status=$${params.length}`); }
    else where.push(`e.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`);
    if (severity) { params.push(severity); where.push(`e.severity=$${params.length}`); }
    if (import_id) { params.push(import_id); where.push(`e.import_id=$${params.length}`); }
    const rows = (await pool.query(
      `SELECT e.*, i.import_no, i.status AS import_status, p.company_name AS supplier
         FROM import_exceptions e JOIN imports i ON i.import_id=e.import_id
         LEFT JOIN partners p ON p.partner_id=i.supplier_id
        WHERE ${where.join(' AND ')}
        ORDER BY CASE e.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END, e.created_at DESC
        LIMIT 200`, params)).rows;
    return rows;
  }

  async function summary() {
    const r = (await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS'))::int AS open,
             COUNT(*) FILTER (WHERE severity='CRITICAL' AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS'))::int AS critical,
             COUNT(*) FILTER (WHERE severity='HIGH' AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS'))::int AS high
        FROM import_exceptions`)).rows[0];
    return { open: r.open, critical: r.critical, high: r.high };
  }

  async function setStatus(exceptionId, status, body, user) {
    const ALLOWED = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'];
    if (!ALLOWED.includes(status)) return { error: 'Invalid status', code: 400 };
    const r = await pool.query(
      `UPDATE import_exceptions SET status=$1, owner=COALESCE($2,owner), resolution=COALESCE($3,resolution),
         acknowledged_at=CASE WHEN $1='ACKNOWLEDGED' AND acknowledged_at IS NULL THEN NOW() ELSE acknowledged_at END,
         resolved_at=CASE WHEN $1 IN ('RESOLVED','DISMISSED') THEN NOW() ELSE resolved_at END,
         updated_at=NOW()
       WHERE exception_id=$4 RETURNING exception_type, import_id`, [status, body?.owner || user?.username || null, body?.resolution || null, exceptionId]);
    if (!r.rows.length) return { error: 'Exception not found', code: 404 };
    await audit(user?.username, 'IMPORT_EXCEPTION_' + status, { exception_id: exceptionId, type: r.rows[0].exception_type });
    return { ok: true };
  }

  // For the ai-insights feed: the worst open exceptions, in insight shape.
  async function insights() {
    const rows = await list({});
    const bySev = {};
    for (const e of rows) bySev[e.severity] = (bySev[e.severity] || 0) + 1;
    const out = [];
    if (bySev.CRITICAL) out.push({ id: 'import-exc-critical', category: 'Imports', severity: 'crit',
      title: `${bySev.CRITICAL} critical import exception(s)`,
      evidence: rows.filter(e => e.severity === 'CRITICAL').slice(0, 3).map(e => `${e.import_no}: ${e.description}`).join(' '),
      action: { label: 'Control Tower', to: '/import-control-tower' }, ask: 'Which imports have critical exceptions and why?' });
    if (bySev.HIGH) out.push({ id: 'import-exc-high', category: 'Imports', severity: 'warn',
      title: `${bySev.HIGH} high-priority import exception(s)`,
      evidence: rows.filter(e => e.severity === 'HIGH').slice(0, 3).map(e => `${e.import_no}: ${e.exception_type.replace(/_/g, ' ')}`).join('; '),
      action: { label: 'Control Tower', to: '/import-control-tower' }, ask: 'What import exceptions need attention?' });
    return out;
  }

  return { scan, list, summary, setStatus, insights };
};
