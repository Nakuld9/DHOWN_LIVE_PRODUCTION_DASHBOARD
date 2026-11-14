// Analytics / trend read tools — served from the warehouse rollup (dw_* tables,
// built nightly by src/lib/warehouse-rollup.js). These answer the "over time",
// "this week", "by machine", "trend" questions that would otherwise scan the raw
// transaction tables. All read-only; every figure comes straight from the
// pre-aggregated rows, so the agent reports only what the mill actually recorded.
//
// The window is a day count (default 7), clamped so a question can't ask for an
// unbounded scan. Financial trends (receivables aging) are gated SUPERVISOR+,
// mirroring how costing is gated by the caller's role.

module.exports = function registerTrendTools(registry, { pool }) {
  // Import material-shortage analysis (spec §25) — analysis only, never purchases.
  registry.register({
    name: 'get_import_shortage',
    description: 'Material-shortage risk for imported materials: current stock, consumption, incoming shipments + ETAs, and whether a shortage is projected before the next shipment arrives. Analysis/recommendation only — it never places a PO or changes stock. Use for "which materials are at shortage risk / will we run out before the shipment arrives". Args: {}',
    minRole: 'OPERATOR',
    handler: async () => require('../../lib/import-shortage')(pool).analyzeAll(),
  });

  const clampDays = (d) => {
    const n = parseInt(d, 10);
    if (!Number.isFinite(n) || n <= 0) return 7;
    return Math.min(n, 180);
  };
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // Production over a period, by day and by machine — the "how much did we make
  // this week / which machine is underperforming" tool.
  registry.register({
    name: 'get_production_trend',
    description: 'Production output over the last N days from the daily rollup: total kg, kg per day, and per-machine totals (best and worst machines). Args: {days?: number (default 7)}',
    minRole: 'OPERATOR',
    handler: async ({ days } = {}) => {
      const d = clampDays(days);
      const [byDay, byMachine, totals] = await Promise.all([
        pool.query(
          `SELECT day, SUM(production_kg)::numeric(14,3) AS kg
             FROM dw_machine_day
            WHERE day >= CURRENT_DATE - ($1::int)
            GROUP BY day ORDER BY day`, [d]),
        pool.query(
          `SELECT machine_id, SUM(production_kg)::numeric(14,3) AS kg,
                  ROUND(AVG(NULLIF(rpm_avg,0))::numeric,1) AS avg_rpm,
                  COUNT(*) FILTER (WHERE active) AS active_days
             FROM dw_machine_day
            WHERE day >= CURRENT_DATE - ($1::int)
            GROUP BY machine_id ORDER BY kg DESC`, [d]),
        pool.query(
          `SELECT COALESCE(SUM(production_kg),0)::numeric(14,3) AS kg,
                  COUNT(DISTINCT day) AS days_with_data
             FROM dw_machine_day WHERE day >= CURRENT_DATE - ($1::int)`, [d]),
      ]);
      const machines = byMachine.rows.map(m => ({
        machine_id: m.machine_id, kg: r2(m.kg),
        avg_rpm: m.avg_rpm != null ? Number(m.avg_rpm) : null,
        active_days: Number(m.active_days),
      }));
      const total_kg = r2(totals.rows[0].kg);
      return {
        window_days: d,
        total_kg,
        days_with_data: Number(totals.rows[0].days_with_data),
        per_day: byDay.rows.map(x => ({ day: x.day, kg: r2(x.kg) })),
        per_machine: machines,
        best_machine: machines[0] || null,
        worst_machine: machines.length ? machines[machines.length - 1] : null,
        note: total_kg === 0 ? 'No production recorded in this window (rollup is empty for these days).' : undefined,
      };
    },
  });

  // Operator output ranking over a period (from approved rolls).
  registry.register({
    name: 'get_operator_output_trend',
    description: 'Operator output over the last N days from the daily rollup: rolls and kg per operator, ranked. Args: {days?: number (default 7)}',
    minRole: 'OPERATOR',
    handler: async ({ days } = {}) => {
      const d = clampDays(days);
      const rows = (await pool.query(
        `SELECT o.operator_id, op.operator_name,
                SUM(o.rolls_count)::int AS rolls, SUM(o.weight_kg)::numeric(14,3) AS kg
           FROM dw_operator_day o
           LEFT JOIN operators op ON op.operator_id::text = o.operator_id
          WHERE o.day >= CURRENT_DATE - ($1::int)
          GROUP BY o.operator_id, op.operator_name
          ORDER BY kg DESC LIMIT 20`, [d])).rows;
      return {
        window_days: d,
        operators: rows.map(x => ({ operator_id: x.operator_id, name: x.operator_name || x.operator_id, rolls: Number(x.rolls), kg: r2(x.kg) })),
        note: rows.length === 0 ? 'No operator-tagged production in this window.' : undefined,
      };
    },
  });

  // Quality reject trend — reject % by day over a period.
  registry.register({
    name: 'get_reject_trend',
    description: 'Fabric reject trend over the last N days from the daily rollup: inspected, rejects and reject % per day, plus the period average. Args: {days?: number (default 7)}',
    minRole: 'OPERATOR',
    handler: async ({ days } = {}) => {
      const d = clampDays(days);
      const rows = (await pool.query(
        `SELECT day, inspected, rejects, reject_pct, avg_points
           FROM dw_quality_day
          WHERE day >= CURRENT_DATE - ($1::int)
          ORDER BY day`, [d])).rows;
      const insp = rows.reduce((s, x) => s + Number(x.inspected), 0);
      const rej = rows.reduce((s, x) => s + Number(x.rejects), 0);
      return {
        window_days: d,
        total_inspected: insp,
        total_rejects: rej,
        avg_reject_pct: insp > 0 ? r2((rej * 100) / insp) : 0,
        per_day: rows.map(x => ({ day: x.day, inspected: Number(x.inspected), rejects: Number(x.rejects), reject_pct: x.reject_pct != null ? Number(x.reject_pct) : 0, avg_points: x.avg_points != null ? Number(x.avg_points) : null })),
        note: insp === 0 ? 'No fabric inspections recorded in this window.' : undefined,
      };
    },
  });

  // Yarn consumed vs received per day over a period.
  registry.register({
    name: 'get_yarn_flow_trend',
    description: 'Yarn movement over the last N days from the daily rollup: kg consumed vs kg received per day, and net. Args: {days?: number (default 7)}',
    minRole: 'OPERATOR',
    handler: async ({ days } = {}) => {
      const d = clampDays(days);
      const rows = (await pool.query(
        `SELECT day, consumed_kg, received_kg
           FROM dw_yarn_day WHERE day >= CURRENT_DATE - ($1::int) ORDER BY day`, [d])).rows;
      const consumed = rows.reduce((s, x) => s + Number(x.consumed_kg), 0);
      const received = rows.reduce((s, x) => s + Number(x.received_kg), 0);
      return {
        window_days: d,
        total_consumed_kg: r2(consumed),
        total_received_kg: r2(received),
        net_kg: r2(received - consumed),
        per_day: rows.map(x => ({ day: x.day, consumed_kg: r2(x.consumed_kg), received_kg: r2(x.received_kg) })),
        note: rows.length === 0 ? 'No yarn movements recorded in this window.' : undefined,
      };
    },
  });

  // Receivables aging — current snapshot, ranked by overdue. Financial → SUPERVISOR+.
  registry.register({
    name: 'get_receivables_aging',
    description: 'Who owes us and how overdue: the latest receivables-aging snapshot per customer, ranked by overdue amount. Financial — SUPERVISOR+. Args: {} ',
    minRole: 'SUPERVISOR',
    handler: async () => {
      const snap = (await pool.query(`SELECT MAX(snapshot_date) AS d FROM dw_order_aging_snapshot`)).rows[0]?.d;
      // Prefer the latest snapshot; fall back to the live view if the rollup has
      // not run yet, so the answer is never empty just because the job is new.
      const rows = snap
        ? (await pool.query(
            `SELECT a.partner_id, p.company_name, a.outstanding, a.overdue,
                    a.open_invoices, a.oldest_overdue_days
               FROM dw_order_aging_snapshot a
               LEFT JOIN partners p ON p.partner_id = a.partner_id
              WHERE a.snapshot_date = $1 AND (a.outstanding > 0 OR a.overdue > 0)
              ORDER BY a.overdue DESC, a.outstanding DESC LIMIT 25`, [snap])).rows
        : (await pool.query(
            `SELECT o.partner_id, p.company_name, o.outstanding, o.overdue,
                    o.open_invoices, o.oldest_overdue_days
               FROM v_partner_outstanding o
               LEFT JOIN partners p ON p.partner_id = o.partner_id
              WHERE o.outstanding > 0 OR o.overdue > 0
              ORDER BY o.overdue DESC, o.outstanding DESC LIMIT 25`)).rows;
      return {
        as_of: snap || 'live',
        total_outstanding: r2(rows.reduce((s, x) => s + Number(x.outstanding || 0), 0)),
        total_overdue: r2(rows.reduce((s, x) => s + Number(x.overdue || 0), 0)),
        customers: rows.map(x => ({
          partner_id: x.partner_id, customer: x.company_name || `#${x.partner_id}`,
          outstanding: r2(x.outstanding), overdue: r2(x.overdue),
          open_invoices: Number(x.open_invoices || 0), oldest_overdue_days: Number(x.oldest_overdue_days || 0),
        })),
        note: rows.length === 0 ? 'No outstanding balances recorded.' : 'Amounts in ₹. INTERNAL — for management, not to be quoted to customers.',
      };
    },
  });
};
