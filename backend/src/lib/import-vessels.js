// Vessel master (spec §9) + honest "last known position" for the map.
//
// A vessel is a reusable master record (IMO/MMSI/flag/operator). Shipments point
// at a vessel via import_shipments.vessel_id.
//
// THE MAP RULE: a real position is NEVER stored or invented. A genuine fix comes only
// from a real tracking event (import_tracking_events) carrying latitude AND longitude —
// entered manually by a human or pulled from a configured provider — and is always used
// as-is while fresh. When a ship is still at sea and has no fresh real fix, the map may
// show an AUTO-ESTIMATED position: a point interpolated along the great-circle route from
// the last anchor to the destination port by elapsed time toward ETA. An estimate is
// NEVER passed off as a real fix — it carries source 'ESTIMATE' and estimated:true so the
// UI labels it plainly. If a ship has neither a real fix nor enough data to estimate
// (no destination port / no ETA / no anchor), the map plots nothing for it.

const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
const r2 = (v) => Math.round(Number(v) * 1e4) / 1e4;

// Minimal port gazetteer for the lanes Dhown actually imports on (China/SE-Asia/Gulf →
// west India). Used ONLY to anchor/aim the auto-estimate; matched by case-insensitive
// substring on the free-text port name. Add ports here as new lanes appear.
const PORTS = [
  ['ningbo', 29.87, 121.98], ['shanghai', 31.34, 121.65], ['qingdao', 36.08, 120.33],
  ['nantong', 31.98, 120.89], ['zhoushan', 29.99, 122.21], ['yangshan', 30.63, 122.06], ['taicang', 31.45, 121.11],
  ['yantian', 22.56, 114.27], ['shenzhen', 22.54, 114.06], ['shekou', 22.48, 113.92],
  ['hong kong', 22.30, 114.17], ['hongkong', 22.30, 114.17], ['xiamen', 24.45, 118.07],
  ['guangzhou', 23.09, 113.49], ['nansha', 22.73, 113.63], ['tianjin', 38.98, 117.78],
  ['busan', 35.10, 129.04], ['kaohsiung', 22.55, 120.27],
  ['singapore', 1.26, 103.84], ['port klang', 3.00, 101.40], ['klang', 3.00, 101.40],
  ['tanjung pelepas', 1.36, 103.55], ['laem chabang', 13.08, 100.89], ['colombo', 6.94, 79.84],
  ['jebel ali', 25.01, 55.06], ['dubai', 25.01, 55.06], ['port qasim', 24.77, 67.34],
  ['qasim', 24.77, 67.34], ['karachi', 24.80, 66.98], ['salalah', 16.95, 54.01],
  ['nhava sheva', 18.95, 72.95], ['jnpt', 18.95, 72.95], ['nhava', 18.95, 72.95],
  ['mumbai', 18.94, 72.84], ['bombay', 18.94, 72.84], ['mundra', 22.74, 69.70],
  ['pipavav', 20.92, 71.52], ['kandla', 23.02, 70.22], ['hazira', 21.10, 72.62],
  ['kattupalli', 13.28, 80.34], ['chennai', 13.10, 80.30], ['ennore', 13.26, 80.34],
  ['tuticorin', 8.75, 78.20], ['cochin', 9.97, 76.26], ['kochi', 9.97, 76.26],
  ['kolkata', 22.54, 88.31], ['haldia', 22.03, 88.09], ['visakhapatnam', 17.68, 83.28],
];
function portLatLon(name) {
  if (!name) return null;
  const s = String(name).toLowerCase();
  for (const [key, lat, lon] of PORTS) if (s.includes(key)) return [lat, lon];
  return null;
}

// Great-circle (spherical) interpolation: point a fraction f (0..1) of the way from
// (lat1,lon1) to (lat2,lon2) along the shortest arc. Returns [lat, lon] in degrees.
function gcInterp(lat1, lon1, lat2, lon2, f) {
  const toR = (d) => (d * Math.PI) / 180, toD = (r) => (r * 180) / Math.PI;
  const p1 = toR(lat1), l1 = toR(lon1), p2 = toR(lat2), l2 = toR(lon2);
  const dP = p2 - p1, dL = l2 - l1;
  const a = Math.sin(dP / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dL / 2) ** 2;
  const d = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (d === 0) return [lat1, lon1];
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return [toD(Math.atan2(z, Math.sqrt(x * x + y * y))), toD(Math.atan2(y, x))];
}

// Rough great-circle distance (km), used to weight the legs of a route.
function gcDist(lat1, lon1, lat2, lon2) {
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Maritime waypoints so an estimate follows the sea lane instead of cutting over
// land. East Asia (lon>100) → India/Gulf (lon<82) sails via the Singapore/Malacca
// Strait and south of Sri Lanka — never straight across the Himalayas.
function seaWaypoints(aLat, aLon, dLat, dLon) {
  const wp = [];
  if (aLon > 100 && dLon < 82) { wp.push([1.26, 103.84]); wp.push([5.9, 80.6]); }   // Singapore, south of Sri Lanka
  return wp;
}
// Interpolate a fraction f along the polyline anchor → waypoints → destination,
// weighted by leg length, so the estimated dot lands where a ship actually is.
function routeInterp(aLat, aLon, dLat, dLon, f) {
  const pts = [[aLat, aLon], ...seaWaypoints(aLat, aLon, dLat, dLon), [dLat, dLon]];
  const legs = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const d = gcDist(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); legs.push(d); total += d; }
  if (total === 0) return [aLat, aLon];
  const target = Math.max(0, Math.min(1, f)) * total; let acc = 0;
  for (let i = 0; i < legs.length; i++) {
    if (acc + legs[i] >= target || i === legs.length - 1) {
      const segF = legs[i] > 0 ? (target - acc) / legs[i] : 0;
      return gcInterp(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], segF);
    }
    acc += legs[i];
  }
  return [dLat, dLon];
}

module.exports = (pool) => {
  const audit = async (username, action, oldVal, newVal) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, old_value, new_value) VALUES ($1,$2,'IMPORTS',$3,$4)`,
      [username || null, action, oldVal ? JSON.stringify(oldVal).slice(0, 4000) : null, newVal ? JSON.stringify(newVal).slice(0, 4000) : null]); } catch {}
  };

  // ── Vessel master CRUD ──────────────────────────────────────────────────────
  const list = async (q = {}) => {
    const params = []; let where = 'deleted_at IS NULL';
    if (q.search) { params.push(`%${q.search}%`); where += ` AND (vessel_name ILIKE $${params.length} OR imo_number ILIKE $${params.length} OR operator ILIKE $${params.length})`; }
    return (await pool.query(`SELECT * FROM import_vessels WHERE ${where} ORDER BY vessel_name`, params)).rows;
  };

  const get = async (id) => (await pool.query(`SELECT * FROM import_vessels WHERE vessel_id=$1 AND deleted_at IS NULL`, [id])).rows[0] || null;

  async function create(b, user) {
    b = b || {};
    if (!b.vessel_name || !String(b.vessel_name).trim()) return { error: 'Vessel name is required.', code: 400 };
    if (b.imo_number) {
      const dup = (await pool.query(`SELECT vessel_id FROM import_vessels WHERE imo_number=$1 AND deleted_at IS NULL`, [String(b.imo_number).trim()])).rows[0];
      if (dup) return { error: `A vessel with IMO ${b.imo_number} already exists.`, code: 409 };
    }
    const row = (await pool.query(
      `INSERT INTO import_vessels (vessel_name, imo_number, mmsi, call_sign, flag, vessel_type, operator, gross_tonnage, built_year, remarks, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [String(b.vessel_name).trim(), b.imo_number || null, b.mmsi || null, b.call_sign || null, b.flag || null,
       b.vessel_type || null, b.operator || null, num(b.gross_tonnage) || 0, num(b.built_year), b.remarks || null, user?.username || null])).rows[0];
    await audit(user?.username, 'IMPORT_VESSEL_CREATE', null, { vessel_id: row.vessel_id, vessel_name: row.vessel_name });
    return { ok: true, vessel: row };
  }

  // ── Bulk import (spec §9) ────────────────────────────────────────────────────
  // Accepts an array of { vessel_name, imo_number?, mmsi?, call_sign?, flag?,
  // vessel_type?, operator?, gross_tonnage?, built_year?, remarks? }. Matches an
  // existing vessel by IMO (preferred) or exact name; updates it in place (filling
  // only blank fields, never clobbering set values), otherwise creates it. Nothing
  // is invented — every value comes from the supplied rows.
  async function bulkImport(rows, user) {
    if (!Array.isArray(rows) || !rows.length) return { error: 'No rows to import.', code: 400 };
    if (rows.length > 5000) return { error: 'Too many rows (max 5000 per import).', code: 400 };
    let created = 0, updated = 0, skipped = 0;
    const errors = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < rows.length; i++) {
        const b = rows[i] || {};
        const name = String(b.vessel_name || '').trim();
        const imo = b.imo_number ? String(b.imo_number).trim() : null;
        const mmsi = b.mmsi ? String(b.mmsi).trim() : null;
        if (!name && !imo) { skipped++; continue; }               // blank line
        if (!name) { errors.push({ row: i + 1, reason: 'Missing vessel name' }); continue; }
        try {
          let cur = null;
          if (imo) cur = (await client.query(`SELECT * FROM import_vessels WHERE imo_number=$1 AND deleted_at IS NULL`, [imo])).rows[0];
          if (!cur) cur = (await client.query(`SELECT * FROM import_vessels WHERE LOWER(vessel_name)=LOWER($1) AND deleted_at IS NULL`, [name])).rows[0];
          if (cur) {
            // fill blanks only
            const keep = (k, v) => (cur[k] == null || cur[k] === '' ? (v ?? cur[k]) : cur[k]);
            await client.query(
              `UPDATE import_vessels SET vessel_name=$2, imo_number=$3, mmsi=$4, call_sign=$5, flag=$6,
                 vessel_type=$7, operator=$8, gross_tonnage=$9, built_year=$10, remarks=$11, updated_at=NOW()
               WHERE vessel_id=$1`,
              [cur.vessel_id, cur.vessel_name || name, keep('imo_number', imo), keep('mmsi', mmsi),
               keep('call_sign', b.call_sign), keep('flag', b.flag), keep('vessel_type', b.vessel_type),
               keep('operator', b.operator), cur.gross_tonnage || num(b.gross_tonnage) || 0,
               keep('built_year', num(b.built_year)), keep('remarks', b.remarks)]);
            updated++;
          } else {
            await client.query(
              `INSERT INTO import_vessels (vessel_name, imo_number, mmsi, call_sign, flag, vessel_type, operator, gross_tonnage, built_year, remarks, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [name, imo, mmsi, b.call_sign || null, b.flag || null, b.vessel_type || null,
               b.operator || null, num(b.gross_tonnage) || 0, num(b.built_year), b.remarks || null, user?.username || null]);
            created++;
          }
        } catch (e) { errors.push({ row: i + 1, reason: e.message }); }
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); return { error: e.message, code: 500 }; }
    finally { client.release(); }
    await audit(user?.username, 'IMPORT_VESSEL_BULK', null, { created, updated, skipped, errors: errors.length });
    return { ok: true, created, updated, skipped, errors };
  }

  async function update(id, b, user) {
    const cur = await get(id);
    if (!cur) return { error: 'Vessel not found', code: 404 };
    b = b || {};
    if (b.imo_number && b.imo_number !== cur.imo_number) {
      const dup = (await pool.query(`SELECT vessel_id FROM import_vessels WHERE imo_number=$1 AND deleted_at IS NULL AND vessel_id<>$2`, [String(b.imo_number).trim(), id])).rows[0];
      if (dup) return { error: `A vessel with IMO ${b.imo_number} already exists.`, code: 409 };
    }
    const f = (k, d) => (b[k] === undefined ? cur[k] : d === undefined ? b[k] : d);
    const row = (await pool.query(
      `UPDATE import_vessels SET vessel_name=$2, imo_number=$3, mmsi=$4, call_sign=$5, flag=$6, vessel_type=$7,
         operator=$8, gross_tonnage=$9, built_year=$10, remarks=$11, updated_at=NOW() WHERE vessel_id=$1 RETURNING *`,
      [id, f('vessel_name'), f('imo_number'), f('mmsi'), f('call_sign'), f('flag'), f('vessel_type'),
       f('operator'), b.gross_tonnage === undefined ? cur.gross_tonnage : (num(b.gross_tonnage) || 0),
       b.built_year === undefined ? cur.built_year : num(b.built_year), f('remarks')])).rows[0];
    await audit(user?.username, 'IMPORT_VESSEL_UPDATE', { vessel_id: id }, { vessel_name: row.vessel_name });
    return { ok: true, vessel: row };
  }

  async function softDelete(id, user) {
    const cur = await get(id);
    if (!cur) return { error: 'Vessel not found', code: 404 };
    const inUse = (await pool.query(`SELECT COUNT(*)::int n FROM import_shipments WHERE vessel_id=$1 AND deleted_at IS NULL`, [id])).rows[0].n;
    if (inUse > 0) return { error: `Vessel is linked to ${inUse} shipment(s); unlink before deleting.`, code: 409 };
    await pool.query(`UPDATE import_vessels SET deleted_at=NOW(), updated_at=NOW() WHERE vessel_id=$1`, [id]);
    await audit(user?.username, 'IMPORT_VESSEL_DELETE', { vessel_id: id, vessel_name: cur.vessel_name }, null);
    return { ok: true };
  }

  // ── Last known position — derived LIVE, never fabricated ────────────────────
  // The most recent tracking event carrying real coordinates for an import.
  async function importPosition(importId) {
    return (await pool.query(
      `SELECT event_id, event_type, event_status, location, latitude, longitude, source, provider, event_timestamp
         FROM import_tracking_events
        WHERE import_id=$1 AND latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY COALESCE(event_timestamp, created_at) DESC LIMIT 1`, [importId])).rows[0] || null;
  }

  // Map feed: every OPEN import's last-known position. A genuine recent AIS fix is used
  // as-is; otherwise, for a ship still at sea, the position is AUTO-ESTIMATED along the
  // great-circle route from the last anchor to the destination port by elapsed time to
  // ETA (free, no provider). Estimates are clearly flagged (source ESTIMATE) so the UI
  // never passes a guess off as a real fix. Nothing is ever plotted at 0,0.
  async function mapPositions() {
    const rows = (await pool.query(`
      SELECT DISTINCT ON (i.import_id)
             i.import_id, i.import_no, i.status, i.current_eta,
             it.item_name AS material, v.vessel_name,
             te.location, te.latitude, te.longitude, te.source, te.provider,
             COALESCE(te.event_timestamp, te.created_at) AS position_time
        FROM imports i
        JOIN import_tracking_events te ON te.import_id=i.import_id
                                       AND te.latitude IS NOT NULL AND te.longitude IS NOT NULL
        LEFT JOIN items it ON it.item_id=i.material_id
        LEFT JOIN import_shipments s ON s.import_id=i.import_id AND s.deleted_at IS NULL
        LEFT JOIN import_vessels v ON v.vessel_id=s.vessel_id
       WHERE i.deleted_at IS NULL
         -- Only plot a sea position while the cargo is still AT SEA. Once the ship
         -- has arrived / discharged and the cargo is at port or on inland transport,
         -- the vessel has left the shipment — don't keep drawing it at its last sea fix.
         AND i.status NOT IN ('ARRIVED_PORT','CUSTOMS','RELEASED','INLAND_TRANSIT','WAREHOUSE','GRN_COMPLETED','CLOSED','CANCELLED')
       ORDER BY i.import_id, COALESCE(te.event_timestamp, te.created_at) DESC`)).rows;

    const result = new Map();
    for (const r of rows) result.set(String(r.import_id), {
      import_id: r.import_id, import_no: r.import_no, status: r.status, current_eta: r.current_eta,
      material: r.material, vessel_name: r.vessel_name || null,
      location: r.location, latitude: Number(r.latitude), longitude: Number(r.longitude),
      source: r.source, provider: r.provider || null, position_time: r.position_time,
      is_external: r.source !== 'MANUAL' && r.source !== 'ESTIMATE', estimated: r.source === 'ESTIMATE',
    });

    // Auto-estimate for ships still at sea (free, no provider). A fresh real AIS fix wins.
    const AT_SEA = ['PLANNED', 'BOOKED', 'LOADED', 'IN_TRANSIT', 'AT_TRANSSHIPMENT'];
    const STALE_MS = 12 * 3600e3;
    const inTransit = (await pool.query(`
      SELECT DISTINCT i.import_id, i.import_no, i.status, i.current_eta, i.etd,
             i.port_of_loading, i.port_of_discharge, it.item_name AS material, v.vessel_name
        FROM imports i
        LEFT JOIN items it ON it.item_id=i.material_id
        JOIN import_shipments s ON s.import_id=i.import_id AND s.deleted_at IS NULL
        JOIN import_vessels v ON v.vessel_id=s.vessel_id AND v.deleted_at IS NULL
       WHERE i.deleted_at IS NULL AND i.status = ANY($1)`, [AT_SEA])).rows;
    const now = Date.now();
    for (const imp of inTransit) {
      const id = String(imp.import_id);
      const rec = result.get(id);
      const dest = portLatLon(imp.port_of_discharge);
      const eta = imp.current_eta ? new Date(imp.current_eta).getTime() : null;
      // A genuine recent AIS fix is authoritative — don't overwrite with an estimate.
      if (rec && rec.is_external && (now - new Date(rec.position_time).getTime()) < STALE_MS) continue;
      // Anchor = last recorded point (any source), else port of loading.
      let aLat, aLon, aTime;
      if (rec) { aLat = rec.latitude; aLon = rec.longitude; aTime = new Date(rec.position_time).getTime(); }
      else { const pol = portLatLon(imp.port_of_loading); if (pol) { [aLat, aLon] = pol; aTime = imp.etd ? new Date(imp.etd).getTime() : null; } }
      if (!dest || !eta || aLat == null || !aTime || eta <= aTime) continue;   // can't estimate → leave as-is
      const f = now >= eta ? 1 : Math.max(0, Math.min(1, (now - aTime) / (eta - aTime)));
      const [eLat, eLon] = routeInterp(aLat, aLon, dest[0], dest[1], f);
      result.set(id, {
        import_id: imp.import_id, import_no: imp.import_no, status: imp.status, current_eta: imp.current_eta,
        material: imp.material, vessel_name: imp.vessel_name || null,
        location: `En route to ${imp.port_of_discharge || 'destination'} (auto-estimated, ${Math.round(f * 100)}%)`,
        latitude: r2(eLat), longitude: r2(eLon), source: 'ESTIMATE', provider: null,
        position_time: new Date().toISOString(), is_external: false, estimated: true, est_progress: Math.round(f * 100),
      });
    }
    return [...result.values()];
  }

  return { list, get, create, bulkImport, update, softDelete, importPosition, mapPositions };
};
