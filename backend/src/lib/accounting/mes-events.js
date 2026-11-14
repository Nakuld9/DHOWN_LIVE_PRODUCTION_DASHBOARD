// Phase 4 (wiring) — bridge the REAL MES operational tables to the accounting
// outbox. Non-invasive: instead of hooking the operational write paths, this
// reads the authoritative MES records and emits idempotent outbox events, so a
// re-run can never double-post and the operational code is untouched. Shadow
// DRAFT by default (Busy stays the book of record).
//
// Sources wired:
//   grn (+ yarn_lots)                    -> GRN_RECEIPT  (yarn purchase value, Cr supplier)
//   cost_entries WASTAGE                 -> WASTAGE      (Dr Wastage / Cr Inventory)
//   cost_entries JOBWORK_*               -> JOBWORK_CHARGES
//   dispatch_challans (+ items/cost)     -> DISPATCH_COGS (Dr COGS / Cr Inventory)
//                                           at the ACTUAL accumulated cost of the
//                                           dispatched rolls (FIFO yarn already
//                                           baked into cost_entries).
const JOBWORK_COMPONENTS = ['JOBWORK_DYEING', 'JOBWORK_FINISHING', 'JOBWORK_DYEING_FINISHING'];

module.exports = (pool) => {
  const outbox = require('./outbox')(pool);

  // Approved GRNs with a non-zero yarn value, as GRN_RECEIPT events.
  async function syncGrns({ from, to, mode, limit = 500 } = {}, user) {
    const p = []; const w = [`g.status = 'APPROVED'`];
    if (from) { p.push(from); w.push(`g.receipt_date >= $${p.length}`); }
    if (to) { p.push(to); w.push(`g.receipt_date <= $${p.length}`); }
    p.push(limit);
    const rows = (await pool.query(
      `SELECT g.grn_id, g.grn_number, g.partner_id, g.receipt_date,
              COALESCE((SELECT SUM(yl.net_weight_kg * yl.rate_per_kg) FROM yarn_lots yl
                          WHERE yl.grn_id = g.grn_id AND COALESCE(yl.status,'') <> 'CANCELLED'), 0) AS value
         FROM grn g WHERE ${w.join(' AND ')} ORDER BY g.grn_id LIMIT $${p.length}`, p)).rows;
    const out = { source: 'grn', total: rows.length, emitted: 0, skipped: 0, failed: 0, details: [] };
    for (const r of rows) {
      const value = Number(r.value) || 0;
      if (value <= 0) { out.skipped++; continue; }
      try {
        const res = await outbox.emit({ event_type: 'GRN_RECEIPT', source_ref: `GRN:${r.grn_id}`, event_date: r.receipt_date,
          payload: { value: value.toFixed(2), partner_id: r.partner_id || null, ref: r.grn_number } }, { mode }, user);
        out.emitted++; out.details.push({ grn: r.grn_number || r.grn_id, action: res.action, voucher_no: res.voucher_no });
      } catch (e) { out.failed++; out.details.push({ grn_id: r.grn_id, error: e.message }); }
    }
    return out;
  }

  // Wastage + job-work + knitting-conversion cost entries, as their events.
  async function syncCostEntries({ from, to, mode, limit = 1000 } = {}, user) {
    const comps = ['WASTAGE', 'KNITTING_COST', ...JOBWORK_COMPONENTS];
    const p = [comps]; const w = [`cost_component = ANY($1)`, `amount_rs > 0`];
    if (from) { p.push(from); w.push(`created_at >= $${p.length}`); }
    if (to) { p.push(to); w.push(`created_at <= $${p.length}`); }
    p.push(limit);
    const rows = (await pool.query(
      `SELECT entry_id, cost_component, amount_rs, reference_type, reference_id, created_at
         FROM cost_entries WHERE ${w.join(' AND ')} ORDER BY entry_id LIMIT $${p.length}`, p)).rows;
    const out = { source: 'cost_entries', total: rows.length, emitted: 0, failed: 0, details: [] };
    for (const r of rows) {
      const comp = r.cost_component;
      const event_type = comp === 'WASTAGE' ? 'WASTAGE' : comp === 'KNITTING_COST' ? 'CONVERSION_APPLIED' : 'JOBWORK_CHARGES';
      const amt = Number(r.amount_rs).toFixed(2);
      const ref = `${r.reference_type} ${r.reference_id}`;
      // JOBWORK carries input GST (value); the others are pure cost.
      const payload = event_type === 'JOBWORK_CHARGES' ? { value: amt, ref } : { cost: amt, ref };
      try {
        const res = await outbox.emit({ event_type, source_ref: `CE:${r.entry_id}`, event_date: r.created_at, payload }, { mode }, user);
        out.emitted++; out.details.push({ entry_id: r.entry_id, event: event_type, action: res.action });
      } catch (e) { out.failed++; out.details.push({ entry_id: r.entry_id, error: e.message }); }
    }
    return out;
  }

  // Yarn issues to production, as ISSUE_TO_WIP at FIFO lot cost (net of returns).
  async function syncIssues({ from, to, mode, limit = 500 } = {}, user) {
    const p = []; const w = [`i.status NOT IN ('DRAFT','CANCELLED')`];
    if (from) { p.push(from); w.push(`i.issue_date >= $${p.length}`); }
    if (to) { p.push(to); w.push(`i.issue_date <= $${p.length}`); }
    p.push(limit);
    const rows = (await pool.query(
      `SELECT i.issue_id, i.issue_number, i.issue_date,
              COALESCE((SELECT SUM((ii.issued_kg - COALESCE(ii.returned_kg,0)) * COALESCE(yl.rate_per_kg,0))
                          FROM yarn_issue_items ii JOIN yarn_lots yl ON yl.lot_id = ii.lot_id
                         WHERE ii.issue_id = i.issue_id), 0) AS cost
         FROM yarn_issues i WHERE ${w.join(' AND ')} ORDER BY i.issue_id LIMIT $${p.length}`, p)).rows;
    const out = { source: 'yarn_issues', total: rows.length, emitted: 0, skipped: 0, failed: 0, details: [] };
    for (const r of rows) {
      const cost = Number(r.cost) || 0;
      if (cost <= 0) { out.skipped++; continue; }
      try {
        const res = await outbox.emit({ event_type: 'ISSUE_TO_WIP', source_ref: `ISS:${r.issue_id}`, event_date: r.issue_date,
          payload: { cost: cost.toFixed(2), ref: r.issue_number } }, { mode }, user);
        out.emitted++; out.details.push({ issue: r.issue_number || r.issue_id, action: res.action });
      } catch (e) { out.failed++; out.details.push({ issue_id: r.issue_id, error: e.message }); }
    }
    return out;
  }

  // Finished goods produced, as PRODUCTION_OUTPUT at accumulated roll cost.
  async function syncProduction({ from, to, mode, limit = 1000 } = {}, user) {
    const p = []; const w = [`COALESCE(f.status,'') NOT IN ('CANCELLED')`];
    if (from) { p.push(from); w.push(`f.created_at >= $${p.length}`); }
    if (to) { p.push(to); w.push(`f.created_at <= $${p.length}`); }
    p.push(limit);
    const rows = (await pool.query(
      `SELECT f.fg_id, f.created_at,
              COALESCE((SELECT SUM(ce.amount_rs) FROM cost_entries ce
                          WHERE ce.reference_type='ROLL' AND ce.reference_id = f.roll_id::text), 0) AS cost
         FROM finished_goods f WHERE ${w.join(' AND ')} ORDER BY f.fg_id LIMIT $${p.length}`, p)).rows;
    const out = { source: 'finished_goods', total: rows.length, emitted: 0, skipped: 0, failed: 0, details: [] };
    for (const r of rows) {
      const cost = Number(r.cost) || 0;
      if (cost <= 0) { out.skipped++; continue; }
      try {
        const res = await outbox.emit({ event_type: 'PRODUCTION_OUTPUT', source_ref: `FG:${r.fg_id}`, event_date: r.created_at,
          payload: { cost: cost.toFixed(2), ref: `FG ${r.fg_id}` } }, { mode }, user);
        out.emitted++; out.details.push({ fg_id: r.fg_id, action: res.action });
      } catch (e) { out.failed++; out.details.push({ fg_id: r.fg_id, error: e.message }); }
    }
    return out;
  }

  // Dispatches, as DISPATCH_COGS at the actual accumulated cost of the rolls
  // dispatched (sum of ROLL cost_entries — FIFO yarn + conversion already in it).
  // Sale value is NOT used for COGS. A dispatch with no costed rolls is skipped
  // (never fabricate a cost).
  async function syncDispatch({ from, to, mode, limit = 500 } = {}, user) {
    const p = []; const w = [`d.status NOT IN ('DRAFT','CANCELLED')`];
    if (from) { p.push(from); w.push(`d.dispatch_date >= $${p.length}`); }
    if (to) { p.push(to); w.push(`d.dispatch_date <= $${p.length}`); }
    p.push(limit);
    const rows = (await pool.query(
      `SELECT d.dispatch_id, d.dispatch_number, d.dispatch_date,
              COALESCE((SELECT SUM(ce.amount_rs) FROM cost_entries ce
                          WHERE ce.reference_type='ROLL'
                            AND ce.reference_id IN (SELECT DISTINCT di.roll_id::text FROM dispatch_items di
                                                      WHERE di.dispatch_id = d.dispatch_id AND di.roll_id IS NOT NULL)), 0) AS cost
         FROM dispatch_challans d WHERE ${w.join(' AND ')} ORDER BY d.dispatch_id LIMIT $${p.length}`, p)).rows;
    const out = { source: 'dispatch_challans', total: rows.length, emitted: 0, skipped: 0, failed: 0, details: [] };
    for (const r of rows) {
      const cost = Number(r.cost) || 0;
      if (cost <= 0) { out.skipped++; out.details.push({ dispatch: r.dispatch_number || r.dispatch_id, skipped: 'no costed rolls' }); continue; }
      try {
        const res = await outbox.emit({ event_type: 'DISPATCH_COGS', source_ref: `DISP:${r.dispatch_id}`, event_date: r.dispatch_date,
          payload: { cost: cost.toFixed(2), ref: r.dispatch_number } }, { mode }, user);
        out.emitted++; out.details.push({ dispatch: r.dispatch_number || r.dispatch_id, action: res.action, voucher_no: res.voucher_no });
      } catch (e) { out.failed++; out.details.push({ dispatch_id: r.dispatch_id, error: e.message }); }
    }
    return out;
  }

  async function syncAll({ from, to, mode } = {}, user) {
    const grns = await syncGrns({ from, to, mode }, user);
    const issues = await syncIssues({ from, to, mode }, user);
    const ce = await syncCostEntries({ from, to, mode }, user);
    const production = await syncProduction({ from, to, mode }, user);
    const dispatch = await syncDispatch({ from, to, mode }, user);
    return { grns, issues, cost_entries: ce, production, dispatch };
  }

  return { syncGrns, syncIssues, syncCostEntries, syncProduction, syncDispatch, syncAll };
};
