// Order production tracking (§10) and inventory intelligence (§11).
//
// Every number and date here comes from MES tables. ETAs are taken from dates the
// factory actually committed to — subcontract expected_return_date, the production
// plan's planned_end, or the order's delivery_date — and the source is always
// reported so the reply can say where it came from. When none exists we return
// null rather than guessing, and the AI is told to promise a callback instead.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// The physical route a job takes through the factory.
const STAGES = ['Knitting', 'Batching', 'Dyeing', 'Finishing', 'Inspection', 'Packing', 'Dispatch'];

module.exports = (pool) => {

  // Full stage picture for one order. partnerId is mandatory so a customer can
  // never track another customer's order.
  async function orderProgress(partnerId, orderNo) {
    if (!partnerId) return { found: false, note: 'No customer on record.' };

    const so = (await pool.query(
      `SELECT so_id, so_number, order_date, delivery_date, status, total_amount
         FROM sales_orders
        WHERE partner_id = $1 AND ($2 = '' OR so_number ILIKE '%'||$2||'%')
        ORDER BY order_date DESC LIMIT 1`,
      [partnerId, String(orderNo || '').trim()])).rows[0];
    if (!so) return { found: false, note: 'No such order for this customer.' };

    // Production plan(s) for the order — the authoritative target vs produced.
    const plans = (await pool.query(
      `SELECT plan_number, item_name, target_qty_kg, produced_qty_kg, status,
              planned_start, planned_end, machine_id
         FROM production_plans
        WHERE so_id = $1 OR so_number = $2`, [so.so_id, so.so_number])).rows;

    const target = round2(plans.reduce((s, p) => s + Number(p.target_qty_kg || 0), 0));
    const produced = round2(plans.reduce((s, p) => s + Number(p.produced_qty_kg || 0), 0));

    // Work out where the job physically is. Subcontract challans that are still
    // out mean the fabric is at the dye house / finisher right now.
    const openSc = (await pool.query(
      `SELECT sc.challan_number, sc.job_type, sc.vendor_name, sc.sent_date,
              sc.expected_return_date, sc.sent_weight_kg, sc.status
         FROM subcontract_challans sc
        WHERE sc.status NOT IN ('RECEIVED','CLOSED','CANCELLED')
          AND sc.customer_name = (SELECT customer_name FROM sales_orders WHERE so_id = $1)
        ORDER BY sc.expected_return_date NULLS LAST LIMIT 5`, [so.so_id])).rows;

    const dispatched = (await pool.query(
      `SELECT dc.dispatch_number, dc.dispatch_date, dc.status, dc.total_weight_kg
         FROM dispatch_challans dc
        WHERE dc.partner_id = $1
        ORDER BY dc.dispatch_date DESC LIMIT 3`, [partnerId])).rows;

    // Current stage, inferred from the strongest available signal.
    let stage = 'Knitting';
    if (dispatched.length && String(so.status).toUpperCase().includes('DISPATCH')) stage = 'Dispatch';
    else if (openSc.length) {
      const jt = String(openSc[0].job_type || '').toLowerCase();
      stage = jt.includes('dye') ? 'Dyeing' : jt.includes('finish') || jt.includes('stenter') ? 'Finishing' : 'Dyeing';
    } else if (produced > 0 && target > 0 && produced >= target) stage = 'Finishing';
    else if (produced > 0) stage = 'Knitting';

    // ETA — first real committed date we can find, never invented.
    let eta = null, etaSource = null;
    const scEta = openSc.map(s => s.expected_return_date).filter(Boolean).sort()[0];
    const planEta = plans.map(p => p.planned_end).filter(Boolean).sort().reverse()[0];
    if (scEta) { eta = day(scEta); etaSource = `subcontract expected return (${openSc[0].vendor_name || 'vendor'})`; }
    else if (planEta) { eta = day(planEta); etaSource = 'production plan end date'; }
    else if (so.delivery_date) { eta = day(so.delivery_date); etaSource = 'order delivery date'; }

    return {
      found: true,
      order_no: so.so_number,
      order_status: so.status,
      current_stage: stage,
      stages: STAGES,
      target_kg: target || null,
      completed_kg: produced || null,
      pending_kg: target ? round2(Math.max(0, target - produced)) : null,
      estimated_completion: eta,
      eta_source: etaSource,
      at_vendor: openSc.map(s => ({
        job: s.job_type, vendor: s.vendor_name, sent: day(s.sent_date),
        expected_back: day(s.expected_return_date), weight_kg: round2(s.sent_weight_kg),
      })),
      recent_dispatches: dispatched.map(d => ({
        dispatch_no: d.dispatch_number, date: day(d.dispatch_date),
        status: d.status, weight_kg: round2(d.total_weight_kg),
      })),
      note: eta
        ? 'estimated_completion is a real MES date — state it as an estimate, not a promise.'
        : 'No committed date in MES. Do NOT give a date; say the team will confirm the schedule.',
    };
  }

  // Dispatch status for this customer's orders only.
  async function dispatchStatus(partnerId, orderNo) {
    if (!partnerId) return { found: false };
    const r = await pool.query(
      `SELECT dc.dispatch_number, dc.dispatch_date, dc.status, dc.vehicle_number,
              dc.total_weight_kg
         FROM dispatch_challans dc
        WHERE dc.partner_id = $1
        ORDER BY dc.dispatch_date DESC LIMIT 5`, [partnerId]);
    if (!r.rows.length) return { found: false, note: 'Nothing dispatched to this customer yet.' };
    return {
      found: true,
      dispatches: r.rows.map(d => ({
        dispatch_no: d.dispatch_number, date: day(d.dispatch_date), status: d.status,
        vehicle: d.vehicle_number, weight_kg: round2(d.total_weight_kg),
      })),
      order_hint: orderNo || null,
    };
  }

  // §11 — stock across the chain, with physical / reserved / available separated.
  async function inventorySummary(query) {
    const q = `%${String(query || '').trim()}%`;
    const [fg, greige, wip] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(weight_kg),0) AS physical,
                COALESCE(SUM(weight_kg) FILTER (WHERE status='RESERVED'),0) AS reserved,
                COALESCE(SUM(weight_kg) FILTER (WHERE status IN ('AVAILABLE','IN_STOCK')),0) AS available
           FROM finished_goods
          WHERE ($1 = '%%' OR fabric_type ILIKE $1 OR color_name ILIKE $1)`, [q]),
      pool.query(
        `SELECT COALESCE(SUM(COALESCE(actual_weight_kg, weight_kg)),0) AS greige_kg, COUNT(*) AS rolls
           FROM rolls
          WHERE status IN ('CLOSED','APPROVED')
            AND (warehouse_status IS NULL OR warehouse_status='GREIGE')
            AND ($1 = '%%' OR fabric_type ILIKE $1)`, [q]),
      pool.query(
        `SELECT COALESCE(SUM(sent_weight_kg),0) AS wip_kg, COUNT(*) AS challans
           FROM subcontract_challans
          WHERE status NOT IN ('RECEIVED','CLOSED','CANCELLED')`),
    ]);
    return {
      finished_goods: {
        physical_kg: round2(fg.rows[0].physical),
        reserved_kg: round2(fg.rows[0].reserved),
        available_kg: round2(fg.rows[0].available),
      },
      greige_kg: round2(greige.rows[0].greige_kg),
      greige_rolls: Number(greige.rows[0].rolls),
      wip_at_vendor_kg: round2(wip.rows[0].wip_kg),
      wip_challans: Number(wip.rows[0].challans),
      note: 'Available = finished goods free to sell. Greige is undyed; WIP is out at a vendor — neither is sellable today.',
    };
  }

  return { orderProgress, dispatchStatus, inventorySummary, STAGES };
};
