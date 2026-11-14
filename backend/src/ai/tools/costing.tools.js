// Costing read tools — cost per kg and margin by fabric, and the cost breakdown by
// component (yarn / knitting / dyeing / finishing / overhead). Read-only; figures
// come from the costing chain (cost_snapshots + cost_entries), never estimated.

module.exports = function registerCostingTools(registry, { pool }) {
  // Latest cost + margin per fabric (optionally filtered). Uses the computed cost
  // snapshots so the agent reports what the costing engine actually calculated.
  registry.register({
    name: 'get_fabric_cost',
    description: 'Cost per kg, selling price, and margin by fabric (latest cost snapshot). Args: {fabric_type?: string}',
    minRole: 'SUPERVISOR',
    handler: async ({ fabric_type } = {}) => {
      const params = [];
      let where = '';
      if (fabric_type) { params.push(`%${fabric_type}%`); where = `WHERE fabric_type ILIKE $1`; }
      const rows = (await pool.query(
        `SELECT DISTINCT ON (fabric_type, color_name)
                fabric_type, color_name, cost_per_kg, selling_price_kg, margin_rs, total_kg, snapshot_date
           FROM cost_snapshots ${where}
          ORDER BY fabric_type, color_name, snapshot_date DESC
          LIMIT 50`, params)).rows;
      return {
        count: rows.length,
        fabrics: rows.map(r => {
          const cost = Number(r.cost_per_kg || 0);
          const sell = Number(r.selling_price_kg || 0);
          return {
            fabric: r.fabric_type, color: r.color_name,
            cost_per_kg: Math.round(cost * 100) / 100,
            selling_price_kg: sell ? Math.round(sell * 100) / 100 : null,
            margin_per_kg: sell ? Math.round((sell - cost) * 100) / 100 : null,
            margin_pct: sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null,
            as_of: r.snapshot_date,
          };
        }),
        note: rows.length === 0 ? 'No cost snapshot found for that fabric.' : undefined,
      };
    },
  });

  // Cost components — where the cost comes from. Sums cost_entries by component.
  registry.register({
    name: 'get_cost_breakdown',
    description: 'Cost broken down by component (yarn, knitting, dyeing, finishing, overhead) for a fabric or overall. Args: {fabric_type?: string, days?: number}',
    minRole: 'SUPERVISOR',
    handler: async ({ fabric_type, days } = {}) => {
      const params = [];
      const conds = [];
      if (fabric_type) { params.push(`%${fabric_type}%`); conds.push(`fabric_type ILIKE $${params.length}`); }
      if (Number(days) > 0) { params.push(Number(days)); conds.push(`created_at >= (CURRENT_DATE - $${params.length}::int)`); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const rows = (await pool.query(
        `SELECT COALESCE(cost_component,'(unspecified)') AS component,
                SUM(amount_rs) AS amount, SUM(quantity_kg) AS kg
           FROM cost_entries ${where}
          GROUP BY cost_component
          ORDER BY amount DESC`, params)).rows;
      const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
      return {
        total_amount_rs: Math.round(total * 100) / 100,
        components: rows.map(r => ({
          component: r.component,
          amount_rs: Math.round(Number(r.amount || 0) * 100) / 100,
          share_pct: total > 0 ? Math.round((Number(r.amount || 0) / total) * 1000) / 10 : 0,
        })),
        note: rows.length === 0 ? 'No cost entries recorded for that filter.' : undefined,
      };
    },
  });
};
