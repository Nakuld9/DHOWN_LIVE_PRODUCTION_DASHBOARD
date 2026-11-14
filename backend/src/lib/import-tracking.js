// Import tracking — manual events, ETA history, and provider status.
//
// Manual entries are always tagged SOURCE=MANUAL so a human-entered position can
// never be confused with externally-sourced (AIS/shipping-line) tracking. ETA
// changes are preserved in import_eta_history so the original→current progression
// is auditable (spec §22).

const provider = require('./tracking-provider');

const daysBetween = (a, b) => a && b ? Math.round((new Date(b) - new Date(a)) / 86400000) : null;
// Format a DATE (pg returns it as a Date at LOCAL midnight) to YYYY-MM-DD using
// LOCAL parts — toISOString would shift it a day back in +ve-offset zones (IST).
const ymd = (d) => { if (!d) return null; const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

module.exports = (pool) => {
  const audit = async (client, username, action, newVal) => {
    try { await (client || pool).query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'IMPORTS',$3)`,
      [username || null, action, newVal ? JSON.stringify(newVal).slice(0, 4000) : null]); } catch {}
  };

  // Record an ETA change (on the given client if inside a txn). old→new, with delay.
  async function recordEta(client, { importId, shipmentId = null, oldEta, newEta, source = 'MANUAL', user, remarks }) {
    const delay = daysBetween(oldEta, newEta);
    await (client || pool).query(
      `INSERT INTO import_eta_history (import_id, shipment_id, old_eta, new_eta, delay_days, source, changed_by, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [importId, shipmentId, oldEta || null, newEta || null, delay, source, user?.username || null, remarks || null]);
  }

  async function etaHistory(importId) {
    return (await pool.query(`SELECT * FROM import_eta_history WHERE import_id=$1 ORDER BY created_at`, [importId])).rows;
  }

  // Manual tracking entry (spec §43). Optionally carries an ETA update.
  async function manualEvent(importId, b, user) {
    const imp = (await pool.query(`SELECT import_id, import_no, current_eta FROM imports WHERE import_id=$1 AND deleted_at IS NULL`, [importId])).rows[0];
    if (!imp) return { error: 'Import not found', code: 404 };
    b = b || {};
    if (!b.event_type && !b.location && !b.new_eta) return { error: 'Provide an event_type, location or new_eta.', code: 400 };
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const ev = (await c.query(
        `INSERT INTO import_tracking_events (import_id, shipment_id, container_id, event_type, event_status,
           event_timestamp, location, latitude, longitude, source, remarks)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6, NOW()),$7,$8,$9,'MANUAL',$10) RETURNING *`,
        [importId, b.shipment_id || null, b.container_id || null, b.event_type || 'UPDATE', b.event_status || null,
         b.event_timestamp || null, b.location || null, b.latitude || null, b.longitude || null, b.remarks || null])).rows[0];
      // ETA update, if supplied.
      if (b.new_eta) {
        const oldEta = ymd(imp.current_eta);
        if (oldEta !== b.new_eta) {
          await c.query(`UPDATE imports SET current_eta=$1, updated_at=NOW() WHERE import_id=$2`, [b.new_eta, importId]);
          await recordEta(c, { importId, shipmentId: b.shipment_id, oldEta, newEta: b.new_eta, source: 'MANUAL', user, remarks: b.remarks });
        }
      }
      await audit(c, user?.username, 'IMPORT_MANUAL_TRACKING', { import_no: imp.import_no, event: b.event_type || 'UPDATE' });
      await c.query('COMMIT');
      return { ok: true, event: ev };
    } catch (e) { await c.query('ROLLBACK'); return { error: e.message, code: 500 }; }
    finally { c.release(); }
  }

  function providerStatus() { return provider.status(); }

  return { manualEvent, etaHistory, recordEta, providerStatus };
};
