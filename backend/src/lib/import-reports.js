// Import reports + management view (spec §48, §49) + cost-variance report (§32).
// All read-only; every figure from live import/customs/cost/GRN data.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = (pool) => {
  const { REQUIRED_DOCS } = require('./import-clearance')(pool);
  const rows = async (sql, p = []) => (await pool.query(sql, p)).rows;
  const OPEN = `i.status NOT IN ('GRN_COMPLETED','CLOSED')`;

  // ── §48 Reports ─────────────────────────────────────────────────────────────
  const register = () => rows(`
    SELECT i.import_no, po.po_number, p.company_name AS supplier, it.item_name AS material,
           i.quantity, i.unit, i.currency, i.invoice_value, i.incoterm, i.current_eta, i.status
      FROM imports i
      LEFT JOIN partners p ON p.partner_id=i.supplier_id
      LEFT JOIN items it ON it.item_id=i.material_id
      LEFT JOIN purchase_orders po ON po.po_id=i.purchase_order_id
     WHERE i.deleted_at IS NULL ORDER BY i.import_id DESC`);

  const shipmentReport = () => rows(`
    SELECT i.import_no, s.booking_number, s.bl_number, s.shipping_line, s.voyage_number,
           s.etd, s.eta, s.actual_arrival, s.status,
           GREATEST(COALESCE(s.actual_arrival, s.eta) - s.eta, 0) AS delay_days,
           (SELECT COUNT(*) FROM import_containers c WHERE c.shipment_id=s.shipment_id AND c.deleted_at IS NULL) AS containers
      FROM import_shipments s JOIN imports i ON i.import_id=s.import_id
     WHERE s.deleted_at IS NULL AND i.deleted_at IS NULL ORDER BY s.eta NULLS LAST`);

  const pendingCustoms = () => rows(`
    SELECT i.import_no, p.company_name AS supplier, c.boe_number, c.boe_date, c.customs_status,
           c.customs_duty, c.igst, (CURRENT_DATE - COALESCE(c.boe_date, i.actual_arrival)) AS days_pending
      FROM imports i
      LEFT JOIN import_customs c ON c.import_id=i.import_id
      LEFT JOIN partners p ON p.partner_id=i.supplier_id
     WHERE i.deleted_at IS NULL AND i.status IN ('ARRIVED_PORT','CUSTOMS')
       AND COALESCE(c.customs_status,'NOT_FILED') NOT IN ('OUT_OF_CHARGE','RELEASED')
     ORDER BY days_pending DESC NULLS LAST`);

  async function pendingDocuments() {
    const imps = await rows(`
      SELECT i.import_id, i.import_no, i.status, (CURRENT_DATE - i.created_at::date) AS age_days,
             ARRAY(SELECT DISTINCT doc_type FROM import_documents d WHERE d.import_id=i.import_id AND d.status IN ('UPLOADED','VERIFIED')) AS present
        FROM imports i WHERE i.deleted_at IS NULL AND ${OPEN} AND i.status <> 'PLANNED'`);
    return imps.map(x => {
      const present = new Set(x.present || []);
      const missing = REQUIRED_DOCS.filter(d => !present.has(d));
      return { import_no: x.import_no, status: x.status, age_days: Number(x.age_days), missing_count: missing.length, missing };
    }).filter(x => x.missing_count > 0).sort((a, b) => b.age_days - a.age_days);
  }

  // Landed cost is computed LIVE per import (actual TT rates + forex charges + received
  // qty), not read from the cached columns — so it never shows a stale/zero value after
  // a payment, re-base or GRN. One getCosting call per import (volume is small).
  const landedCost = async () => {
    const costing = require('./import-costing')(pool);
    const imps = await rows(`
      SELECT i.import_id, i.import_no, it.item_name AS material, i.quantity, i.unit
        FROM imports i JOIN import_costs cst ON cst.import_id=i.import_id
        LEFT JOIN items it ON it.item_id=i.material_id
       WHERE i.deleted_at IS NULL ORDER BY i.import_id DESC`);
    const out = [];
    for (const im of imps) {
      let cc; try { cc = await costing.getCosting(im.import_id); } catch { continue; }
      if (!cc || !cc.breakdown) continue;
      const qty = Number(im.quantity) || 0;
      const cifInr = Number(cc.breakdown.cif_value_in_inr) || 0;
      const duty = Number(cc.cost && cc.cost.customs_duty) || 0;
      const total = Number(cc.breakdown.total_landed_cost) || 0;
      if (total <= 0) continue;
      out.push({
        import_no: im.import_no, material: im.material, quantity: im.quantity, unit: im.unit,
        cif_value_in_inr: cifInr, customs_duty: duty,
        total_landed_cost: total, landed_cost_per_kg: cc.landed_cost_per_kg,
        is_actual: !!(cc.cost && cc.cost.is_actual),
        cif_per_kg: qty > 0 ? Math.round((cifInr / qty) * 100) / 100 : 0,
        duty_per_kg: qty > 0 ? Math.round((duty / qty) * 100) / 100 : 0,
      });
    }
    return out;
  };

  const expectedArrival = () => rows(`
    SELECT it.item_name AS material, i.import_no, i.quantity, i.unit, i.current_eta,
           (i.current_eta - CURRENT_DATE) AS days_remaining
      FROM imports i LEFT JOIN items it ON it.item_id=i.material_id
     WHERE i.deleted_at IS NULL AND ${OPEN} AND i.current_eta IS NOT NULL
     ORDER BY i.current_eta`);

  const delayed = () => rows(`
    SELECT i.import_no, it.item_name AS material, i.quantity, i.unit, i.currency, i.invoice_value,
           i.original_eta, i.current_eta, (i.current_eta - i.original_eta) AS delay_days
      FROM imports i LEFT JOIN items it ON it.item_id=i.material_id
     WHERE i.deleted_at IS NULL AND ${OPEN} AND i.current_eta > i.original_eta
     ORDER BY (i.current_eta - i.original_eta) DESC`);

  // ── §32 Cost variance (estimate → actual) ──────────────────────────────────
  const costVariance = () => rows(`
    SELECT i.import_no, it.item_name AS material, cst.estimated_landed_cost, cst.total_landed_cost AS actual_landed_cost,
           (cst.total_landed_cost - cst.estimated_landed_cost) AS variance,
           CASE WHEN cst.estimated_landed_cost>0 THEN ROUND(((cst.total_landed_cost-cst.estimated_landed_cost)/cst.estimated_landed_cost*100)::numeric,2) ELSE 0 END AS variance_pct
      FROM imports i JOIN import_costs cst ON cst.import_id=i.import_id
      LEFT JOIN items it ON it.item_id=i.material_id
     WHERE i.deleted_at IS NULL AND cst.is_actual = true AND cst.estimated_landed_cost > 0
     ORDER BY ABS(cst.total_landed_cost - cst.estimated_landed_cost) DESC`);

  // ── §49 Management view ────────────────────────────────────────────────────
  async function managementSummary() {
    const agg = (await rows(`
      SELECT COALESCE(SUM(i.invoice_value) FILTER (WHERE ${OPEN}),0) AS cif_in_transit,
             COALESCE(SUM(i.quantity) FILTER (WHERE i.status IN ('LOADED','IN_TRANSIT','AT_TRANSSHIPMENT')),0) AS qty_in_transit,
             COALESCE(SUM(i.quantity) FILTER (WHERE i.status='ARRIVED_PORT'),0) AS qty_at_port,
             COALESCE(SUM(i.quantity) FILTER (WHERE i.status='CUSTOMS'),0) AS qty_in_customs,
             COALESCE(SUM(i.quantity) FILTER (WHERE i.status IN ('WAREHOUSE','GRN_COMPLETED','CLOSED')),0) AS qty_delivered,
             COALESCE(SUM(i.invoice_value) FILTER (WHERE ${OPEN} AND i.current_eta BETWEEN CURRENT_DATE AND CURRENT_DATE+7),0) AS value_this_week,
             COALESCE(SUM(i.invoice_value) FILTER (WHERE ${OPEN} AND i.current_eta BETWEEN CURRENT_DATE AND CURRENT_DATE+30),0) AS value_this_month
        FROM imports i WHERE i.deleted_at IS NULL`))[0];
    const customs_value = (await rows(`SELECT COALESCE(SUM(c.customs_duty+c.igst+c.other_taxes),0) v FROM import_customs c JOIN imports i ON i.import_id=c.import_id WHERE i.deleted_at IS NULL AND ${OPEN}`))[0].v;
    const topMaterials = await rows(`
      SELECT it.item_name AS material, SUM(i.quantity) AS qty, SUM(i.invoice_value) AS value
        FROM imports i LEFT JOIN items it ON it.item_id=i.material_id
       WHERE i.deleted_at IS NULL AND ${OPEN} GROUP BY it.item_name ORDER BY value DESC NULLS LAST LIMIT 5`);
    const suppliers = await rows(`
      SELECT p.company_name AS supplier, COUNT(*) AS shipments, SUM(i.invoice_value) AS value
        FROM imports i JOIN partners p ON p.partner_id=i.supplier_id
       WHERE i.deleted_at IS NULL AND ${OPEN} GROUP BY p.company_name ORDER BY value DESC NULLS LAST LIMIT 5`);
    const upcoming = await rows(`
      SELECT i.import_no, it.item_name AS material, i.quantity, i.current_eta, (i.current_eta - CURRENT_DATE) AS days_remaining
        FROM imports i LEFT JOIN items it ON it.item_id=i.material_id
       WHERE i.deleted_at IS NULL AND ${OPEN} AND i.current_eta BETWEEN CURRENT_DATE AND CURRENT_DATE+14 ORDER BY i.current_eta LIMIT 8`);
    const variances = await costVariance();
    let shortage = { at_risk: 0 };
    try { shortage = await require('./import-shortage')(pool).analyzeAll(); } catch { /* optional */ }
    return {
      cif_value_in_transit: r2(agg.cif_in_transit),
      customs_value: r2(customs_value),
      value_expected_this_week: r2(agg.value_this_week),
      value_expected_this_month: r2(agg.value_this_month),
      qty_in_transit: r2(agg.qty_in_transit), qty_at_port: r2(agg.qty_at_port),
      qty_in_customs: r2(agg.qty_in_customs), qty_delivered: r2(agg.qty_delivered),
      top_materials_in_transit: topMaterials.map(x => ({ material: x.material, qty: r2(x.qty), value: r2(x.value) })),
      suppliers_active: suppliers.map(x => ({ supplier: x.supplier, shipments: Number(x.shipments), value: r2(x.value) })),
      upcoming_arrivals: upcoming,
      major_cost_variances: variances.filter(v => Math.abs(Number(v.variance_pct)) >= 5).slice(0, 8),
      material_shortage_risks: shortage.at_risk || 0,
    };
  }

  return { register, shipmentReport, pendingCustoms, pendingDocuments, landedCost, expectedArrival, delayed, costVariance, managementSummary };
};
