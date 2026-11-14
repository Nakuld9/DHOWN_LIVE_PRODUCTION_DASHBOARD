// Manufacturing profitability & contribution engine for the CFO module (spec §7).
//
// Contribution per kg by dimension (fabric, knitting machine, quality grade) from
// REAL production + cost data: produced kg from rolls, direct cost (yarn/knitting/
// other) from the costing chain (cost_entries), and sales realisation per kg from
// dispatch pricing. Contribution is shown ONLY where both cost and realisation are
// known; where one is missing the row is flagged (cost-only / realisation-only)
// rather than inventing a margin. Overheads are allocated by a configurable, stated
// basis (production kg) and the resulting operating profit is labelled an estimate.
//
// NOTE: until the shop-floor collectors are wired (DC_API_KEY), `rolls` is empty and
// the production side returns nothing — the engine reports that honestly.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const DIMENSIONS = {
  fabric: { col: 'r.fabric_type', label: 'Fabric type' },
  machine: { col: 'r.machine_id', label: 'Machine' },
  grade: { col: "COALESCE(r.quality_grade,'(ungraded)')", label: 'Quality grade' },
};
const ALLOC_BASES = ['PRODUCTION_KG', 'EQUAL'];

module.exports = (pool) => {
  async function ensure() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profit_config (
        config_id       INT PRIMARY KEY DEFAULT 1,
        overhead_monthly NUMERIC(16,2) NOT NULL DEFAULT 0,
        allocation_basis VARCHAR(20) NOT NULL DEFAULT 'PRODUCTION_KG',
        notes           TEXT,
        updated_by      VARCHAR(60),
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT profit_alloc_ck CHECK (allocation_basis IN ('PRODUCTION_KG','EQUAL')),
        CONSTRAINT profit_singleton_ck CHECK (config_id = 1)
      );
      INSERT INTO profit_config (config_id) VALUES (1) ON CONFLICT (config_id) DO NOTHING;
    `);
  }

  const audit = async (user, action, val) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'PROFITABILITY',$3)`,
      [user || null, action, val ? JSON.stringify(val).slice(0, 4000) : null]); } catch {}
  };

  async function getConfig() {
    const r = (await pool.query(`SELECT * FROM profit_config WHERE config_id=1`)).rows[0];
    return r || { overhead_monthly: 0, allocation_basis: 'PRODUCTION_KG' };
  }
  async function setConfig(body, user) {
    const basis = ALLOC_BASES.includes(body.allocation_basis) ? body.allocation_basis : 'PRODUCTION_KG';
    const r = (await pool.query(`UPDATE profit_config SET overhead_monthly=$1, allocation_basis=$2, notes=$3, updated_by=$4, updated_at=NOW() WHERE config_id=1 RETURNING *`,
      [num(body.overhead_monthly) || 0, basis, body.notes || null, user || null])).rows[0];
    await audit(user, 'profit config updated', { overhead_monthly: body.overhead_monthly, basis });
    return { row: r };
  }

  // Sales realisation per fabric from dispatch pricing (taxable value / kg).
  async function realisationByFabric(from, to) {
    const rows = (await pool.query(`
      SELECT COALESCE(fabric_type,'(unspecified)') AS dim,
             COALESCE(SUM(taxable_value),0) AS revenue, COALESCE(SUM(weight_kg),0) AS sold_kg
        FROM dispatch_items
       WHERE created_at::date BETWEEN $1 AND $2 AND COALESCE(rate_per_kg,0) > 0
       GROUP BY 1`, [from, to])).rows;
    const map = {};
    for (const r of rows) map[r.dim] = { revenue: r2(r.revenue), sold_kg: r2(r.sold_kg), realisation_per_kg: Number(r.sold_kg) > 0 ? r2(r.revenue / r.sold_kg) : null };
    return map;
  }

  // Profitability by dimension over [from,to] (default last 90 days).
  async function byDimension(dim = 'fabric', { from, to } = {}) {
    const d = DIMENSIONS[dim] ? dim : 'fabric';
    const f = from || ymd(new Date(Date.now() - 90 * 864e5));
    const t = to || ymd(new Date());
    const cfg = await getConfig();

    // Aggregate cost per ROLL first (a roll has many cost_entries — summing the roll
    // weight across that join would multiply it), then roll up to the dimension.
    const prod = (await pool.query(`
      WITH per_roll AS (
        SELECT r.roll_id, ${DIMENSIONS[d].col} AS dim, MAX(r.weight_kg) AS weight_kg,
               COALESCE(SUM(CASE WHEN ce.cost_component ILIKE '%yarn%' THEN ce.amount_rs ELSE 0 END),0) AS yarn_cost,
               COALESCE(SUM(CASE WHEN ce.cost_component ILIKE '%knit%' THEN ce.amount_rs ELSE 0 END),0) AS knitting_cost,
               COALESCE(SUM(CASE WHEN ce.cost_component NOT ILIKE '%yarn%' AND ce.cost_component NOT ILIKE '%knit%' THEN ce.amount_rs ELSE 0 END),0) AS other_cost
          FROM rolls r
          LEFT JOIN cost_entries ce ON ce.reference_type='ROLL' AND ce.reference_id = r.roll_id::text
         WHERE r.created_at::date BETWEEN $1 AND $2
         GROUP BY r.roll_id, ${DIMENSIONS[d].col}
      )
      SELECT dim, COALESCE(SUM(weight_kg),0) AS produced_kg,
             COALESCE(SUM(yarn_cost),0) AS yarn_cost,
             COALESCE(SUM(knitting_cost),0) AS knitting_cost,
             COALESCE(SUM(other_cost),0) AS other_cost
        FROM per_roll GROUP BY dim`, [f, t])).rows;

    // Realisation is keyed on fabric; join when the dimension is fabric, else skip.
    const realMap = d === 'fabric' ? await realisationByFabric(f, t) : {};

    const totalKg = r2(prod.reduce((s, p) => s + Number(p.produced_kg), 0));
    const overheadForWindow = r2(Number(cfg.overhead_monthly) * (Math.max(1, (new Date(t) - new Date(f)) / 864e5) / 30));

    const rows = prod.map(p => {
      const produced_kg = r2(p.produced_kg);
      const yarn = r2(p.yarn_cost), knit = r2(p.knitting_cost), other = r2(p.other_cost);
      const direct_cost = r2(yarn + knit + other);
      const direct_cost_per_kg = produced_kg > 0 ? r2(direct_cost / produced_kg) : null;
      const real = realMap[p.dim] || null;
      const realisation_per_kg = real ? real.realisation_per_kg : null;
      const contribution_per_kg = (realisation_per_kg != null && direct_cost_per_kg != null) ? r2(realisation_per_kg - direct_cost_per_kg) : null;
      const margin_pct = (contribution_per_kg != null && realisation_per_kg) ? r2(contribution_per_kg / realisation_per_kg * 100) : null;
      // Overhead allocation.
      let overhead_alloc = 0;
      if (cfg.allocation_basis === 'EQUAL' && prod.length) overhead_alloc = r2(overheadForWindow / prod.length);
      else if (totalKg > 0) overhead_alloc = r2(overheadForWindow * (produced_kg / totalKg));
      const overhead_per_kg = produced_kg > 0 ? r2(overhead_alloc / produced_kg) : null;
      const op_profit_per_kg = (contribution_per_kg != null && overhead_per_kg != null) ? r2(contribution_per_kg - overhead_per_kg) : null;
      const quality = direct_cost_per_kg != null && realisation_per_kg != null ? 'complete'
        : direct_cost_per_kg != null ? 'cost_only' : realisation_per_kg != null ? 'realisation_only' : 'none';
      return {
        dim: p.dim, produced_kg, yarn_cost: yarn, knitting_cost: knit, other_cost: other,
        direct_cost, direct_cost_per_kg, sold_kg: real ? real.sold_kg : null, revenue: real ? real.revenue : null,
        realisation_per_kg, contribution_per_kg, margin_pct,
        overhead_alloc, overhead_per_kg, op_profit_per_kg, data_quality: quality,
      };
    }).sort((a, b) => (b.contribution_per_kg ?? -1e9) - (a.contribution_per_kg ?? -1e9));

    return {
      dimension: d, dimension_label: DIMENSIONS[d].label, from: f, to: t,
      allocation_basis: cfg.allocation_basis, overhead_monthly: Number(cfg.overhead_monthly), overhead_for_window: overheadForWindow,
      total_produced_kg: totalKg, rows,
      has_production: prod.length > 0,
      note: prod.length === 0
        ? 'No production recorded in this window. Wire the shop-floor collectors (DC_API_KEY) to populate rolls, then contribution per kg will compute here.'
        : 'Contribution per kg = realisation − direct cost, shown only where both are known. Overhead is allocated by the stated basis and operating profit is an estimate. Realisation is linked by fabric type.',
    };
  }

  return { ensure, getConfig, setConfig, byDimension, realisationByFabric, DIMENSIONS, ALLOC_BASES };
};
