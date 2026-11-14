// Import Tracking & Control Tower — core service.
//
// CIF is the default Incoterm. The landed-cost math starts from the CIF value and
// adds ONLY import-side (post-CIF) expenses. Ocean freight and marine insurance
// are added back ONLY when explicitly classified ADDITIONAL (i.e. outside the CIF
// contract) — otherwise they are already inside the supplier's CIF price and are
// never double-counted.
//
// Suppliers/materials/POs/GRN/inventory stay in the existing masters; this service
// only references them. Inventory is never mutated here.

const { nextSeq, nextDocNumber } = require('./sequences');

// Default clearing / CHA charge per container (ex-GST; the 18% GST is recoverable ITC
// and is not added to landed cost). Override with CHA_PER_CONTAINER in .env.
const CHA_PER_CONTAINER = Number(process.env.CHA_PER_CONTAINER) || 8500;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));

// Order-level key of an invoice/PI number: strips a single FCL index that follows a
// LETTER suffix (…-B1, …-C2 → …-B, …-C) so the containers of one order share one PO,
// while a plain number (ZCFVD260811) or a letter-ending ref (XJ26416B) is unchanged.
const orderBase = (inv) => { const s = String(inv || '').trim(); const m = /^(.*[A-Za-z])\d$/.exec(s); return m ? m[1] : s; };

// Controlled status progression. Forward moves are free; skipping stages needs an
// explicit override (recorded in history + audit).
const STATUS_ORDER = ['PLANNED', 'BOOKED', 'LOADED', 'IN_TRANSIT', 'AT_TRANSSHIPMENT',
  'ARRIVED_PORT', 'CUSTOMS', 'RELEASED', 'INLAND_TRANSIT', 'WAREHOUSE', 'GRN_COMPLETED', 'CLOSED'];

module.exports = (pool) => {
  const audit = async (client, { username, action, oldVal, newVal }) => {
    try {
      await (client || pool).query(
        `INSERT INTO audit_logs (username, action, module, old_value, new_value)
         VALUES ($1,$2,'IMPORTS',$3,$4)`,
        [username || null, action, oldVal ? JSON.stringify(oldVal).slice(0, 4000) : null,
         newVal ? JSON.stringify(newVal).slice(0, 4000) : null]);
    } catch { /* audit must never break the action */ }
  };

  // ── Create an import (CIF default, linked to an existing PO) ────────────────
  async function create(body, user) {
    const b = body || {};
    if (!b.supplier_id) return { error: 'supplier_id is required', code: 400 };
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // Duplicate guard: same supplier + commercial invoice, or same BL, still open.
      if (b.commercial_invoice_number) {
        const dup = await c.query(
          `SELECT import_no FROM imports WHERE deleted_at IS NULL AND supplier_id=$1
             AND commercial_invoice_number IS NOT NULL
             AND LOWER(commercial_invoice_number)=LOWER($2) LIMIT 1`,
          [b.supplier_id, b.commercial_invoice_number]);
        if (dup.rows.length) { await c.query('ROLLBACK'); return { error: `Commercial invoice already recorded on ${dup.rows[0].import_no}`, code: 409 }; }
      }
      const import_no = await nextSeq('IMP', 'imports', 'import_no');
      const incoterm = (b.incoterm || 'CIF').toUpperCase();
      const qty = num(b.quantity), unitPrice = num(b.unit_price);
      const invoiceValue = num(b.invoice_value) || r2(qty * unitPrice);
      const ins = await c.query(
        `INSERT INTO imports
           (import_no, purchase_order_id, supplier_id, material_id, warehouse_id, country_of_origin,
            proforma_invoice_number, commercial_invoice_number, invoice_date, quantity, unit, currency,
            unit_price, invoice_value, incoterm, port_of_loading, transshipment_port, port_of_discharge,
            final_destination, shipping_line, freight_forwarder, cha, booking_number, bl_number,
            etd, original_eta, current_eta, status, priority, remarks, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$26,'PLANNED',$27,$28,$29)
         RETURNING *`,
        [import_no, b.purchase_order_id || null, b.supplier_id, b.material_id || null, b.warehouse_id || null,
         b.country_of_origin || null, b.proforma_invoice_number || null, b.commercial_invoice_number || null,
         b.invoice_date || null, qty, b.unit || 'KG', b.currency || 'USD', unitPrice, invoiceValue, incoterm,
         b.port_of_loading || null, b.transshipment_port || null, b.port_of_discharge || null,
         b.final_destination || 'Ludhiana', b.shipping_line || null, b.freight_forwarder || null, b.cha || null,
         b.booking_number || null, b.bl_number || null, b.etd || null, b.original_eta || null,
         b.priority || 'NORMAL', b.remarks || null, user?.username || null]);
      const imp = ins.rows[0];
      // Seed the cost row from the CIF invoice value (starting point).
      await c.query(
        `INSERT INTO import_costs (import_id, cif_value, invoice_currency, exchange_rate, cif_value_in_inr)
         VALUES ($1,$2,$3,$4,$5)`,
        [imp.import_id, invoiceValue, b.currency || 'USD', num(b.exchange_rate),
         r2(invoiceValue * num(b.exchange_rate))]);
      await c.query(
        `INSERT INTO import_status_history (import_id, from_status, to_status, changed_by, remarks)
         VALUES ($1,NULL,'PLANNED',$2,'Import created')`, [imp.import_id, user?.username || null]);
      await audit(c, { username: user?.username, action: 'CREATE_IMPORT', newVal: { import_no, supplier_id: b.supplier_id, incoterm, invoiceValue } });
      await c.query('COMMIT');
      // The MES auto-generates/attaches the PO when the import already carries a
      // proforma/commercial invoice. Best-effort — never fails the create.
      try { await autoPoForImport(imp.import_id, user); } catch { /* best-effort */ }
      return { ok: true, import: imp };
    } catch (e) { await c.query('ROLLBACK'); return { error: e.message, code: 500 }; }
    finally { c.release(); }
  }

  // ── List with server-side pagination, filters, search ──────────────────────
  async function list(q = {}) {
    const where = ['i.deleted_at IS NULL']; const params = [];
    const add = (cond, val) => { params.push(val); where.push(cond.replace('?', '$' + params.length)); };
    if (q.supplier_id) add('i.supplier_id = ?', q.supplier_id);
    if (q.material_id) add('i.material_id = ?', q.material_id);
    if (q.status) add('i.status = ?', q.status);
    // active=true hides shipments already delivered / GRN-done (unloaded in factory)
    // from the Control Tower. An explicit status filter overrides this so those
    // shipments remain reachable when specifically asked for.
    if ((q.active === 'true' || q.active === true) && !q.status) where.push(`i.status NOT IN ('WAREHOUSE','GRN_COMPLETED','CLOSED')`);
    if (q.shipping_line) add('i.shipping_line ILIKE ?', `%${q.shipping_line}%`);
    if (q.priority) add('i.priority = ?', q.priority);
    if (q.delayed === 'true' || q.delayed === true) where.push('i.current_eta > i.original_eta');
    if (q.search) {
      params.push(`%${q.search}%`);
      const p = '$' + params.length;
      where.push(`(i.import_no ILIKE ${p} OR i.bl_number ILIKE ${p} OR i.booking_number ILIKE ${p} OR i.commercial_invoice_number ILIKE ${p})`);
    }
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 200);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    const whereSql = where.join(' AND ');
    const total = Number((await pool.query(`SELECT COUNT(*)::int n FROM imports i WHERE ${whereSql}`, params)).rows[0].n);
    const rows = (await pool.query(
      `SELECT i.import_id, i.import_no, i.status, i.priority, i.quantity, i.unit, i.currency, i.invoice_value,
              i.incoterm, i.bl_number, i.booking_number, i.shipping_line, i.port_of_loading, i.port_of_discharge,
              i.proforma_invoice_number, i.commercial_invoice_number, i.invoice_date,
              i.etd, i.original_eta, i.current_eta, i.actual_arrival,
              (i.current_eta - CURRENT_DATE) AS days_remaining,
              GREATEST(COALESCE(i.current_eta,i.original_eta) - i.original_eta, 0) AS delay_days,
              p.company_name AS supplier, it.item_name AS material,
              po.po_number,
              (SELECT COUNT(*) FROM import_shipments s WHERE s.import_id=i.import_id AND s.deleted_at IS NULL) AS shipments,
              cst.cif_value_in_inr, cst.total_landed_cost
         FROM imports i
         LEFT JOIN partners p ON p.partner_id=i.supplier_id
         LEFT JOIN items it ON it.item_id=i.material_id
         LEFT JOIN purchase_orders po ON po.po_id=i.purchase_order_id
         LEFT JOIN import_costs cst ON cst.import_id=i.import_id
        WHERE ${whereSql}
        ORDER BY i.import_id DESC
        LIMIT ${limit} OFFSET ${offset}`, params)).rows;
    return { total, limit, offset, rows };
  }

  async function get(id) {
    const imp = (await pool.query(
      `SELECT i.*, p.company_name AS supplier, p.gstin AS supplier_gstin, it.item_name AS material,
              po.po_number
         FROM imports i
         LEFT JOIN partners p ON p.partner_id=i.supplier_id
         LEFT JOIN items it ON it.item_id=i.material_id
         LEFT JOIN purchase_orders po ON po.po_id=i.purchase_order_id
        WHERE i.import_id=$1 AND i.deleted_at IS NULL`, [id])).rows[0];
    if (!imp) return null;
    const [costs, shipments, containers, history, events] = await Promise.all([
      pool.query(`SELECT * FROM import_costs WHERE import_id=$1`, [id]),
      pool.query(`SELECT s.*, v.vessel_name, v.imo_number, v.mmsi
                    FROM import_shipments s LEFT JOIN import_vessels v ON v.vessel_id=s.vessel_id
                   WHERE s.import_id=$1 AND s.deleted_at IS NULL ORDER BY s.shipment_id`, [id]),
      pool.query(`SELECT c.* FROM import_containers c JOIN import_shipments s ON s.shipment_id=c.shipment_id
                   WHERE s.import_id=$1 AND c.deleted_at IS NULL ORDER BY c.container_id`, [id]),
      pool.query(`SELECT * FROM import_status_history WHERE import_id=$1 ORDER BY created_at`, [id]),
      pool.query(`SELECT * FROM import_tracking_events WHERE import_id=$1 ORDER BY COALESCE(event_timestamp,created_at)`, [id]),
    ]);
    // Partial-shipment rollup. Received comes LIVE from the linked GRNs (existing
    // grn/yarn_lots — authoritative), never duplicated here.
    const grn = require('./import-grn')(pool);
    const [linkedGrns, grnState] = await Promise.all([grn.linkedGrns(id), grn.status(id, imp.quantity)]);
    const ordered = num(imp.quantity);
    const shipped = shipments.rows.reduce((s, x) => s + num(x.quantity), 0);
    const received = grnState.received;
    const quantities = {
      ordered: r2(ordered), shipped: r2(shipped), received: r2(received),
      pending_to_ship: r2(Math.max(ordered - shipped, 0)),
      pending_to_receive: r2(Math.max(ordered - received, 0)),
      grn_status: grnState.grn_status,
      note: 'Received is read live from the linked GRN(s) (existing grn/yarn_lots). Inventory stays authoritative in the stock ledger — this module only links.',
    };
    return { ...imp, costs: costs.rows[0] || null, shipments: shipments.rows, containers: containers.rows,
      status_history: history.rows, tracking_events: events.rows, quantities, linked_grns: linkedGrns };
  }

  // ── Control Tower KPIs — all from live data ────────────────────────────────
  async function controlTower() {
    const row = (await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('LOADED','IN_TRANSIT','AT_TRANSSHIPMENT'))::int AS in_transit,
        COUNT(*) FILTER (WHERE status='ARRIVED_PORT')::int AS at_port,
        COUNT(*) FILTER (WHERE status='CUSTOMS')::int AS customs_pending,
        COUNT(*) FILTER (WHERE status IN ('RELEASED','INLAND_TRANSIT'))::int AS released,
        COUNT(*) FILTER (WHERE status IN ('WAREHOUSE','GRN_COMPLETED','CLOSED'))::int AS delivered,
        COUNT(*) FILTER (WHERE status NOT IN ('WAREHOUSE','GRN_COMPLETED','CLOSED')
                          AND current_eta IS NOT NULL AND original_eta IS NOT NULL
                          AND current_eta > original_eta)::int AS delayed,
        COUNT(*) FILTER (WHERE priority='CRITICAL' AND status NOT IN ('GRN_COMPLETED','CLOSED'))::int AS critical,
        COUNT(*) FILTER (WHERE status NOT IN ('WAREHOUSE','GRN_COMPLETED','CLOSED')
                          AND current_eta BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS expected_this_week,
        COUNT(*) FILTER (WHERE status NOT IN ('WAREHOUSE','GRN_COMPLETED','CLOSED')
                          AND current_eta BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS expected_this_month,
        COALESCE(SUM(invoice_value) FILTER (WHERE status NOT IN ('WAREHOUSE','GRN_COMPLETED','CLOSED')),0) AS cif_value_in_transit
        FROM imports WHERE deleted_at IS NULL`)).rows[0];
    return {
      as_of: new Date().toISOString(),
      kpis: {
        total: row.total, in_transit: row.in_transit, at_port: row.at_port,
        customs_pending: row.customs_pending, released: row.released, delivered: row.delivered,
        delayed: row.delayed, critical: row.critical,
        expected_this_week: row.expected_this_week, expected_this_month: row.expected_this_month,
        cif_value_in_transit: r2(row.cif_value_in_transit),
      },
    };
  }

  // ── Update import; status change goes through the transition + history + audit ─
  async function update(id, body, user) {
    const cur = (await pool.query(`SELECT * FROM imports WHERE import_id=$1 AND deleted_at IS NULL`, [id])).rows[0];
    if (!cur) return { error: 'Import not found', code: 404 };
    const b = body || {};
    const editable = ['country_of_origin', 'proforma_invoice_number', 'commercial_invoice_number', 'invoice_date',
      'quantity', 'unit', 'currency', 'unit_price', 'invoice_value', 'incoterm', 'port_of_loading', 'transshipment_port',
      'port_of_discharge', 'final_destination', 'shipping_line', 'freight_forwarder', 'cha', 'booking_number',
      'bl_number', 'etd', 'original_eta', 'current_eta', 'actual_departure', 'actual_arrival', 'priority', 'remarks',
      'purchase_order_id', 'material_id', 'warehouse_id'];
    const sets = [], params = [];
    for (const f of editable) if (f in b) { params.push(b[f] === '' ? null : b[f]); sets.push(`${f}=$${params.length}`); }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      if (sets.length) {
        params.push(id);
        await c.query(`UPDATE imports SET ${sets.join(', ')}, updated_at=NOW() WHERE import_id=$${params.length}`, params);
      }
      // Preserve ETA history when the current ETA is edited (spec §22).
      if ('current_eta' in b) {
        const ymd = (d) => { if (!d) return null; const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
        const oldEta = ymd(cur.current_eta);
        const newEta = b.current_eta ? String(b.current_eta).slice(0, 10) : null;
        if (oldEta !== newEta) {
          await require('./import-tracking')(pool).recordEta(c, { importId: id, oldEta, newEta, source: 'MANUAL', user, remarks: 'ETA edited' });
        }
      }
      // Status transition (separate, validated).
      if (b.status && b.status !== cur.status) {
        const from = STATUS_ORDER.indexOf(cur.status), to = STATUS_ORDER.indexOf(b.status);
        if (to < 0) { await c.query('ROLLBACK'); return { error: `Unknown status ${b.status}`, code: 400 }; }
        const isOverride = to < from || to > from + 1;   // backward or skipping a stage
        if (isOverride && !b.override) { await c.query('ROLLBACK'); return { error: `Status ${cur.status} → ${b.status} skips stages; pass override:true (authorised) to force`, code: 409 }; }
        await c.query(`UPDATE imports SET status=$1, updated_at=NOW() WHERE import_id=$2`, [b.status, id]);
        await c.query(`INSERT INTO import_status_history (import_id, from_status, to_status, changed_by, is_override, remarks)
                       VALUES ($1,$2,$3,$4,$5,$6)`, [id, cur.status, b.status, user?.username || null, isOverride, b.status_remarks || null]);
        await audit(c, { username: user?.username, action: isOverride ? 'IMPORT_STATUS_OVERRIDE' : 'IMPORT_STATUS_CHANGE', oldVal: { status: cur.status }, newVal: { status: b.status } });
        // Voyage finished → cascade the import status onto its containers (so the
        // container status reflects arrival/clearance/delivery) and log the arrival.
        // Vessel AIS tracking stops on its own once status ≥ ARRIVED_PORT.
        const CONT_STATUS = { ARRIVED_PORT: 'DISCHARGED', CUSTOMS: 'CUSTOMS', RELEASED: 'RELEASED', INLAND_TRANSIT: 'INLAND_TRANSIT', WAREHOUSE: 'DELIVERED', GRN_COMPLETED: 'DELIVERED', CLOSED: 'DELIVERED' };
        const cs = CONT_STATUS[b.status];
        if (cs) {
          await c.query(
            `UPDATE import_containers SET current_status=$1 WHERE shipment_id IN
               (SELECT shipment_id FROM import_shipments WHERE import_id=$2 AND deleted_at IS NULL) AND deleted_at IS NULL`,
            [cs, id]);
          if (b.status === 'ARRIVED_PORT') {
            await c.query(
              `INSERT INTO import_tracking_events (import_id, event_type, event_status, event_timestamp, location, source, provider, provider_event_id, remarks)
               VALUES ($1,'VESSEL_ARRIVED','Arrived & discharged',NOW(),$2,'MANUAL','status','status:${id}:ARRIVED','Voyage finished — vessel arrived; AIS tracking stopped, containers marked discharged')
               ON CONFLICT (provider, provider_event_id) WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL DO NOTHING`,
              [id, cur.port_of_discharge || 'Port of discharge']);
          }
        }
      }
      if (sets.length) await audit(c, { username: user?.username, action: 'UPDATE_IMPORT', oldVal: { import_no: cur.import_no }, newVal: b });
      await c.query('COMMIT');
      // When a proforma/commercial invoice number is set/changed, the MES auto-makes
      // (or appends to) the PO on its own. Best-effort — never fails the update.
      if (('commercial_invoice_number' in b) || ('proforma_invoice_number' in b)) {
        try { await autoPoForImport(id, user); } catch { /* best-effort */ }
      }
      return { ok: true, import: (await pool.query(`SELECT * FROM imports WHERE import_id=$1`, [id])).rows[0] };
    } catch (e) { await c.query('ROLLBACK'); return { error: e.message, code: 500 }; }
    finally { c.release(); }
  }

  async function softDelete(id, user) {
    const r = await pool.query(`UPDATE imports SET deleted_at=NOW(), updated_at=NOW() WHERE import_id=$1 AND deleted_at IS NULL RETURNING import_no`, [id]);
    if (!r.rows.length) return { error: 'Import not found', code: 404 };
    await audit(null, { username: user?.username, action: 'DELETE_IMPORT', oldVal: { import_no: r.rows[0].import_no } });
    return { ok: true };
  }

  // ── Shipments / containers ─────────────────────────────────────────────────
  // Fire-and-forget: the moment a shipment gets a vessel with an IMO/MMSI, pull its
  // live AIS position immediately (via the configured tracking provider) so the map
  // and tracking update at once instead of waiting for the nightly sweep. Best-effort
  // — it never blocks or fails the shipment save, and the nightly sync retries. When
  // no provider is configured or credits are exhausted, it simply records nothing.
  function autoTrack(importId) {
    if (!importId) return;
    setImmediate(async () => {
      try { await require('./import-tracking-sync')(pool).syncImport(importId); }
      catch { /* nightly sync will retry */ }
    });
  }

  // Auto-default the clearing/CHA charge = CHA_PER_CONTAINER × (active container count)
  // on the import's cost row, and refresh its landed cost. Best-effort; runs when a
  // container is added so CHA fills in per container automatically (override on the
  // Costing tab if the actual CHA invoice differs).
  async function applyDefaultCha(importId) {
    try {
      const n = (await pool.query(
        `SELECT COUNT(*)::int c FROM import_containers ct JOIN import_shipments s ON s.shipment_id=ct.shipment_id
          WHERE s.import_id=$1 AND ct.deleted_at IS NULL AND s.deleted_at IS NULL`, [importId])).rows[0].c;
      if (n > 0) {
        await pool.query(`UPDATE import_costs SET cha_charges=$2, updated_at=NOW() WHERE import_id=$1`, [importId, CHA_PER_CONTAINER * n]);
        await require('./import-costing')(pool).getCosting(importId); // refresh landed cost
      }
    } catch { /* best-effort */ }
  }

  async function addShipment(importId, body, user) {
    const imp = (await pool.query(`SELECT import_id FROM imports WHERE import_id=$1 AND deleted_at IS NULL`, [importId])).rows[0];
    if (!imp) return { error: 'Import not found', code: 404 };
    const b = body || {};
    const r = await pool.query(
      `INSERT INTO import_shipments (import_id, booking_number, shipping_line, forwarder, voyage_number,
        master_bl, house_bl, bl_number, port_of_loading, transshipment_port, port_of_discharge, etd, eta, status, quantity, vessel_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,'PLANNED'),$15,$16) RETURNING *`,
      [importId, b.booking_number || null, b.shipping_line || null, b.forwarder || null, b.voyage_number || null,
       b.master_bl || null, b.house_bl || null, b.bl_number || null, b.port_of_loading || null,
       b.transshipment_port || null, b.port_of_discharge || null, b.etd || null, b.eta || null, b.status || null,
       num(b.quantity), b.vessel_id || null]);
    await audit(null, { username: user?.username, action: 'ADD_SHIPMENT', newVal: { import_id: importId, shipment_id: r.rows[0].shipment_id } });
    if (b.vessel_id) autoTrack(importId);
    return { ok: true, shipment: r.rows[0] };
  }

  async function addContainer(shipmentId, body, user) {
    const s = (await pool.query(`SELECT shipment_id, import_id, vessel_id FROM import_shipments WHERE shipment_id=$1 AND deleted_at IS NULL`, [shipmentId])).rows[0];
    if (!s) return { error: 'Shipment not found', code: 404 };
    const b = body || {};
    try {
      const r = await pool.query(
        `INSERT INTO import_containers (shipment_id, container_number, container_type, seal_number,
          gross_weight, net_weight, package_count, cargo_description, current_status, original_eta, current_eta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'PLANNED'),$10,$10) RETURNING *`,
        [shipmentId, b.container_number || null, b.container_type || null, b.seal_number || null,
         num(b.gross_weight), num(b.net_weight), parseInt(b.package_count, 10) || 0, b.cargo_description || null,
         b.current_status || null, b.eta || null]);
      await audit(null, { username: user?.username, action: 'ADD_CONTAINER', newVal: { shipment_id: shipmentId, container_number: b.container_number } });
      if (s.vessel_id) autoTrack(s.import_id);
      await applyDefaultCha(s.import_id);   // auto CHA/clearing = rate × container count
      return { ok: true, container: r.rows[0] };
    } catch (e) {
      if (/uq_import_container_active/.test(e.message)) return { error: `Container ${b.container_number} is already active on another shipment`, code: 409 };
      return { error: e.message, code: 500 };
    }
  }

  // Assign (or clear) the vessel on a shipment — required for AIS tracking, since a
  // container is tracked via its vessel's IMO/MMSI position.
  async function setShipmentVessel(shipmentId, vesselId, user) {
    const s = (await pool.query(`SELECT shipment_id, import_id FROM import_shipments WHERE shipment_id=$1 AND deleted_at IS NULL`, [shipmentId])).rows[0];
    if (!s) return { error: 'Shipment not found', code: 404 };
    await pool.query(`UPDATE import_shipments SET vessel_id=$2, updated_at=NOW() WHERE shipment_id=$1`, [shipmentId, vesselId || null]);
    await audit(null, { username: user?.username, action: 'SET_SHIPMENT_VESSEL', newVal: { shipment_id: shipmentId, vessel_id: vesselId || null } });
    if (vesselId) autoTrack(s.import_id);
    return { ok: true };
  }

  // Auto-generate a Purchase Order when an advance is recorded, so paying a supplier
  // creates the PO on its own. A single advance covering several containers (one TT
  // split across imports) makes ONE PO with a line per FCL — not a PO each. Grouped by
  // supplier (a TT has one beneficiary). Idempotent: imports already on a PO are left
  // as-is, and if some of the group already share a PO the rest join it. The PO is a
  // DRAFT linked back via imports.purchase_order_id. Best-effort; never throws.
  async function ensurePoForImports(importIds, user) {
    const ids = [...new Set((importIds || []).map(Number).filter(Boolean))];
    if (!ids.length) return { ok: false, skipped: 'no_imports' };
    const rows = (await pool.query(
      `SELECT i.*, p.company_name AS supplier_name, it.item_name AS material_name
         FROM imports i
         LEFT JOIN partners p ON p.partner_id=i.supplier_id
         LEFT JOIN items it ON it.item_id=i.material_id
        WHERE i.import_id = ANY($1) AND i.deleted_at IS NULL
        ORDER BY i.import_id`, [ids])).rows;
    if (!rows.length) return { ok: false, skipped: 'not_found' };

    // Group by supplier so one PO never mixes suppliers.
    const bySupplier = new Map();
    for (const r of rows) { const k = r.supplier_id || 0; (bySupplier.get(k) || bySupplier.set(k, []).get(k)).push(r); }

    const created = [];
    for (const group of bySupplier.values()) {
      const needPo = group.filter(r => !r.purchase_order_id);
      if (!needPo.length) { const ex = group.find(r => r.purchase_order_id); if (ex) created.push({ po_id: ex.purchase_order_id, skipped: 'already_linked' }); continue; }
      const existingPoId = group.find(r => r.purchase_order_id)?.purchase_order_id || null;
      const head = group[0];
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        let poId = existingPoId, poNumber = null;
        if (!poId) {
          poNumber = await nextDocNumber('PO');
          const po = (await c.query(
            `INSERT INTO purchase_orders (po_number, partner_id, supplier_name, order_date, expected_date,
               status, payment_terms, notes, total_amount, created_by)
             VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7,0,$8) RETURNING po_id`,
            [poNumber, head.supplier_id || null, head.supplier_name || null,
             head.invoice_date || new Date().toISOString().slice(0, 10), head.current_eta || null,
             head.incoterm || null,
             `Auto-generated on advance payment · ${needPo.length > 1 ? needPo.length + ' FCL' : '1 FCL'} · ${needPo.map(r => r.import_no).join(', ')}`,
             user?.username || null])).rows[0];
          poId = po.po_id;
        }
        for (const imp of needPo) {
          const qty = num(imp.quantity), rate = num(imp.unit_price);
          const amount = num(imp.invoice_value) || r2(qty * rate);
          const itemName = String(imp.material_name || `${imp.import_no} goods`).slice(0, 200);
          const desc = `${imp.import_no} · ${imp.commercial_invoice_number || imp.proforma_invoice_number || ''} · ${imp.material_name || imp.remarks || ''}`.slice(0, 1000);
          await c.query(
            `INSERT INTO purchase_order_items (po_id, item_id, item_name, description, quantity, uom, rate, amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [poId, imp.material_id || null, itemName, desc, qty, imp.unit || 'KG', rate, amount]);
          await c.query(`UPDATE imports SET purchase_order_id=$1, updated_at=NOW() WHERE import_id=$2`, [poId, imp.import_id]);
        }
        // Recompute header total from its line items.
        await c.query(`UPDATE purchase_orders SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM purchase_order_items WHERE po_id=$1), updated_at=NOW() WHERE po_id=$1`, [poId]);
        await audit(c, { username: user?.username, action: 'AUTO_PO_FROM_ADVANCE', newVal: { po_number: poNumber || `(existing ${poId})`, imports: needPo.map(r => r.import_no) } });
        await c.query('COMMIT');
        created.push({ po_id: poId, po_number: poNumber, imports: needPo.map(r => r.import_no) });
      } catch (e) { await c.query('ROLLBACK'); created.push({ error: e.message }); }
      finally { c.release(); }
    }
    return { ok: true, pos: created };
  }

  // Auto-generate (or append to) a DRAFT PO for ONE import the moment it has a
  // proforma/commercial invoice — the MES does this on its own so a PO never has to
  // be asked for. Order-aware: containers of the same order (…-B1/…-B2) land on ONE
  // PO; a different order or supplier gets its own. Idempotent + best-effort.
  async function autoPoForImport(importId, user) {
    const imp = (await pool.query(
      `SELECT i.*, p.company_name AS supplier_name, it.item_name AS material_name
         FROM imports i LEFT JOIN partners p ON p.partner_id=i.supplier_id LEFT JOIN items it ON it.item_id=i.material_id
        WHERE i.import_id=$1 AND i.deleted_at IS NULL`, [importId])).rows[0];
    if (!imp || !imp.supplier_id) return { skipped: 'no_supplier' };
    if (imp.purchase_order_id) return { skipped: 'already_linked', po_id: imp.purchase_order_id };
    const inv = imp.commercial_invoice_number || imp.proforma_invoice_number;
    if (!inv) return { skipped: 'no_invoice' };          // only once a PI/invoice exists
    const base = orderBase(inv);
    // Reuse an open PO of the same supplier whose imports share this order; else new.
    const sibs = (await pool.query(
      `SELECT i.commercial_invoice_number, i.proforma_invoice_number, i.purchase_order_id
         FROM imports i JOIN purchase_orders po ON po.po_id=i.purchase_order_id
        WHERE i.supplier_id=$1 AND i.purchase_order_id IS NOT NULL AND i.deleted_at IS NULL
          AND UPPER(COALESCE(po.status,'')) NOT IN ('CANCELLED','CLOSED')`, [imp.supplier_id])).rows;
    let poId = null;
    for (const s of sibs) { if (orderBase(s.commercial_invoice_number || s.proforma_invoice_number || '') === base) { poId = s.purchase_order_id; break; } }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      let poNumber = null;
      if (!poId) {
        poNumber = await nextDocNumber('PO');
        poId = (await c.query(
          `INSERT INTO purchase_orders (po_number, partner_id, supplier_name, order_date, expected_date, status, payment_terms, notes, total_amount, created_by)
           VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7,0,$8) RETURNING po_id`,
          [poNumber, imp.supplier_id, imp.supplier_name || null, imp.invoice_date || new Date().toISOString().slice(0, 10),
           imp.current_eta || null, imp.incoterm || null, `Auto-generated from proforma/invoice · order ${base}`, user?.username || null])).rows[0].po_id;
      }
      const qty = num(imp.quantity), rate = num(imp.unit_price), amount = num(imp.invoice_value) || r2(qty * rate);
      await c.query(
        `INSERT INTO purchase_order_items (po_id, item_id, item_name, description, quantity, uom, rate, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [poId, imp.material_id || null, String(imp.material_name || `${imp.import_no} goods`).slice(0, 200),
         `${imp.import_no} · ${inv} · ${imp.material_name || ''}`.slice(0, 1000), qty, imp.unit || 'KG', rate, amount]);
      await c.query(`UPDATE imports SET purchase_order_id=$1, updated_at=NOW() WHERE import_id=$2`, [poId, imp.import_id]);
      await c.query(`UPDATE purchase_orders SET total_amount=(SELECT COALESCE(SUM(amount),0) FROM purchase_order_items WHERE po_id=$1), updated_at=NOW() WHERE po_id=$1`, [poId]);
      await audit(c, { username: user?.username, action: 'AUTO_PO_FROM_PROFORMA', newVal: { po: poNumber || `(existing ${poId})`, import_no: imp.import_no, order: base } });
      await c.query('COMMIT');
      return { ok: true, po_id: poId, po_number: poNumber, joined: !poNumber };
    } catch (e) { await c.query('ROLLBACK'); return { error: e.message }; }
    finally { c.release(); }
  }

  // Single-import convenience wrapper.
  const ensurePoForImport = (importId, user) => ensurePoForImports([importId], user);

  return { create, list, get, update, softDelete, addShipment, addContainer, setShipmentVessel, controlTower, ensurePoForImport, ensurePoForImports, autoPoForImport, STATUS_ORDER };
};
