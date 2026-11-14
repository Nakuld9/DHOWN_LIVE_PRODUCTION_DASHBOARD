// Automatic tracking sync (spec §16). Finds active shipments, asks the configured
// tracking provider for updates, normalises them, and — only for genuinely NEW,
// CHANGED data — records a tracking event and updates ETA/location. It NEVER
// fabricates: with no provider configured it is a clean no-op that reports why.
//
// Runs on a jobLock schedule (server.js), interval configurable via
// TRACKING_SYNC_INTERVAL_MIN. Duplicate events are prevented by the unique
// (provider, provider_event_id) index and by comparing before writing.

const provider = require('./tracking-provider');

// Best-effort map of a shipment's shipping-line name to a TrackingMore carrier code.
// Unknown → null (the provider may auto-detect, or return available:false honestly).
// Extend as needed; codes follow TrackingMore's container carrier list.
const CARRIER_CODES = {
  'msc': 'msc', 'mediterranean shipping': 'msc',
  'maersk': 'maersk', 'maersk line': 'maersk',
  'cma cgm': 'cma-cgm', 'cma-cgm': 'cma-cgm', 'cma': 'cma-cgm',
  'hapag': 'hapag-lloyd', 'hapag-lloyd': 'hapag-lloyd', 'hapag lloyd': 'hapag-lloyd',
  'cosco': 'cosco', 'cosco shipping': 'cosco',
  'one': 'one-line', 'ocean network express': 'one-line',
  'evergreen': 'evergreen', 'hmm': 'hmm', 'yang ming': 'yang-ming', 'yangming': 'yang-ming',
  'zim': 'zim', 'oocl': 'oocl', 'pil': 'pil', 'wan hai': 'wanhai', 'wanhai': 'wanhai',
};
const carrierCode = (line) => {
  if (!line) return null;
  return CARRIER_CODES[String(line).toLowerCase().trim()] || null;
};

module.exports = (pool) => {
  const tracking = require('./import-tracking')(pool);

  // Sync one import. Returns an honest availability result.
  async function syncImport(importId) {
    const p = provider.getProvider();                 // AIS vessel-position provider
    const cp = provider.getContainerProvider();       // carrier/BL milestone+ETA provider
    if (!p.configured && !cp.configured) return { ok: false, available: false, ...provider.status() };

    const imp = (await pool.query(
      `SELECT i.import_id, i.import_no, i.status, i.bl_number, i.current_eta,
              s.vessel_id, s.voyage_number, s.bl_number AS ship_bl
         FROM imports i LEFT JOIN import_shipments s ON s.import_id=i.import_id AND s.deleted_at IS NULL
        WHERE i.import_id=$1 AND i.deleted_at IS NULL LIMIT 1`, [importId])).rows[0];
    if (!imp) return { error: 'Import not found', code: 404 };

    let written = 0;
    let bestEta = null; // latest carrier-declared ETA seen this run (ISO date)

    // ── Vessel positions (AIS, by IMO/MMSI) ────────────────────────────────────
    // Only while the cargo is actually on the water. Once the voyage is finished (the
    // ship has arrived/discharged → status ARRIVED_PORT or later) we STOP pulling the
    // vessel's position — it sails on to other ports and its fixes no longer represent
    // this cargo. Each shipment's vessel is queried; a genuinely new fix is recorded.
    const AT_SEA = ['PLANNED', 'BOOKED', 'LOADED', 'IN_TRANSIT', 'AT_TRANSSHIPMENT'];
    const trackVessel = AT_SEA.includes(imp.status);
    const vessels = (p.configured && trackVessel) ? (await pool.query(
      `SELECT DISTINCT s.shipment_id, v.vessel_id, v.vessel_name, v.imo_number, v.mmsi
         FROM import_shipments s JOIN import_vessels v ON v.vessel_id=s.vessel_id
        WHERE s.import_id=$1 AND s.deleted_at IS NULL AND v.deleted_at IS NULL
          AND (v.imo_number IS NOT NULL OR v.mmsi IS NOT NULL)`, [importId])).rows : [];
    for (const v of vessels) {
      let pos;
      try { pos = await p.getVesselPosition(v); } catch { continue; }
      if (!pos || !pos.available || pos.latitude == null || pos.longitude == null || !pos.provider_event_id) continue;
      // Scope the dedup id to this import: one physical AIS fix legitimately belongs to
      // every import carried on the same vessel, but the (provider, provider_event_id)
      // index is global, so an unscoped id would let only the first import record it.
      const eid = `${importId}:${pos.provider_event_id}`;
      const r = await pool.query(
        `INSERT INTO import_tracking_events (import_id, shipment_id, event_type, event_status,
           event_timestamp, location, latitude, longitude, source, provider, provider_event_id, remarks)
         VALUES ($1,$2,'POSITION',$3,$4,$5,$6,$7,'AIS',$8,$9,$10)
         ON CONFLICT (provider, provider_event_id) WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL DO NOTHING RETURNING event_id`,
        [importId, v.shipment_id, pos.status || null, pos.timestamp || null,
         pos.current_port || v.vessel_name || null, pos.latitude, pos.longitude,
         p.name, eid, pos.speed != null ? `speed ${pos.speed} kn` : null]);
      if (r.rows.length) written++;
    }

    // ── Carrier / BL milestones + declared ETA ──────────────────────────────────
    // Ask the CONTAINER provider (e.g. TrackingMore) for the shipping line's own
    // milestones and ETA, by container number and by bill of lading. Any method may
    // return { available:false } — we honour that and write nothing rather than invent.
    if (cp.configured) {
      // Persist a normalised milestone set, deduped per import+key.
      const writeEvents = async (cs, keyPrefix, shipmentId, containerId) => {
        if (!cs || !cs.available || !Array.isArray(cs.events)) return;
        if (cs.eta) bestEta = cs.eta > (bestEta || '') ? cs.eta : bestEta;
        for (const ev of cs.events) {
          if (!ev.provider_event_id) continue;
          const ceid = `${importId}:${keyPrefix}:${ev.provider_event_id}`;
          const r = await pool.query(
            `INSERT INTO import_tracking_events (import_id, shipment_id, container_id, event_type, event_status,
               event_timestamp, location, latitude, longitude, source, provider, provider_event_id, remarks)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (provider, provider_event_id) WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL DO NOTHING RETURNING event_id`,
            [importId, shipmentId || null, containerId || null, ev.event_type || 'MILESTONE', ev.event_status || null,
             ev.timestamp || null, ev.location || null, ev.latitude || null, ev.longitude || null,
             (cs.source || 'CARRIER'), cp.name, ceid, ev.remarks || null]);
          if (r.rows.length) written++;
        }
      };

      // By bill of lading — one lookup per shipment that has a BL.
      const bls = (await pool.query(
        `SELECT s.shipment_id, s.bl_number, s.shipping_line FROM import_shipments s
          WHERE s.import_id=$1 AND s.deleted_at IS NULL AND s.bl_number IS NOT NULL AND s.bl_number<>''`, [importId])).rows;
      for (const s of bls) {
        let cs; try { cs = await cp.getContainerStatus(s.bl_number, { number_type: 'bl', carrier_code: carrierCode(s.shipping_line) }); } catch { cs = null; }
        await writeEvents(cs, `bl:${s.bl_number}`, s.shipment_id, null);
      }

      // By container number.
      const containers = (await pool.query(
        `SELECT c.container_id, c.container_number, s.shipment_id, s.shipping_line FROM import_containers c
           JOIN import_shipments s ON s.shipment_id=c.shipment_id
          WHERE s.import_id=$1 AND c.deleted_at IS NULL AND c.container_number IS NOT NULL`, [importId])).rows;
      for (const c of containers) {
        let cs; try { cs = await cp.getContainerStatus(c.container_number, { carrier_code: carrierCode(c.shipping_line) }); } catch { cs = null; }
        await writeEvents(cs, `cn:${c.container_id}`, c.shipment_id, c.container_id);
      }

      // Update the import's ETA from the carrier's declared arrival, if it changed.
      if (bestEta) {
        const newEta = String(bestEta).slice(0, 10); // YYYY-MM-DD
        const oldEta = imp.current_eta ? new Date(imp.current_eta).toISOString().slice(0, 10) : null;
        if (newEta !== oldEta) {
          await pool.query(`UPDATE imports SET current_eta=$1, updated_at=NOW() WHERE import_id=$2`, [newEta, importId]);
          try { await tracking.recordEta(null, { importId, oldEta, newEta, source: cp.name.toUpperCase(), remarks: 'Carrier-declared ETA (auto)' }); } catch { /* history best-effort */ }
        }
      }
    }
    return { ok: true, available: true, provider: p.name, container_provider: cp.name, eta: bestEta || null, events_written: written };
  }

  // Scheduled sweep over active imports (not yet delivered/closed).
  async function runAll() {
    const p = provider.getProvider();
    const cp = provider.getContainerProvider();
    if (!p.configured && !cp.configured) return { skipped: 'no_provider', reason: p.reason };
    const rows = (await pool.query(
      `SELECT import_id FROM imports
        WHERE deleted_at IS NULL AND status NOT IN ('WAREHOUSE','GRN_COMPLETED','CLOSED')`)).rows;
    let ok = 0, evt = 0;
    for (const r of rows) {
      try { const out = await syncImport(r.import_id); if (out.ok) { ok++; evt += out.events_written || 0; } } catch { /* per-import */ }
    }
    return { imports_synced: ok, events_written: evt };
  }

  return { syncImport, runAll };
};
