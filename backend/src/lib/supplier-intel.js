// Supplier intelligence (spec §15) — price trends, purchase volume and
// price-increase alerts from the MES GRN/yarn purchase history.
//
// Yarn purchases land as yarn_lots (rate_per_kg) under an approved GRN (supplier).
// This compares each supplier+yarn's recent rate against its own earlier average
// and surfaces meaningful moves, plus 12-month purchase volume per supplier.
//
// All from MES purchase data; payment-terms performance and the supplier LEDGER
// balance are Busy's (deferred to the Busy bridge).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d) => { const n = parseFloat(process.env[v]); return Number.isFinite(n) ? n : d; };
const ALERT_PCT = num('SUPPLIER_PRICE_ALERT_PCT', 5);
const RECENT_DAYS = num('SUPPLIER_PRICE_RECENT_DAYS', 60);

module.exports = (pool) => {
  const q = async (sql, p = []) => { try { return (await pool.query(sql, p)).rows; } catch { return null; } };

  // Price moves: recent avg rate vs the earlier avg, per supplier + yarn.
  async function priceAlerts() {
    const rows = await q(`
      WITH lots AS (
        SELECT COALESCE(g.supplier_name,'?') supplier,
               COALESCE(NULLIF(TRIM(yl.yarn_type),''),'?') yarn,
               yl.rate_per_kg rate, yl.created_at,
               (yl.created_at >= NOW() - ($1 || ' days')::interval) AS is_recent
          FROM yarn_lots yl JOIN grn g ON g.grn_id = yl.grn_id
         WHERE g.status='APPROVED' AND yl.rate_per_kg > 0
      )
      SELECT supplier, yarn,
             AVG(rate) FILTER (WHERE is_recent)     AS recent_rate,
             AVG(rate) FILTER (WHERE NOT is_recent) AS prior_rate,
             COUNT(*)  FILTER (WHERE is_recent)     AS recent_n,
             COUNT(*)  FILTER (WHERE NOT is_recent) AS prior_n
        FROM lots GROUP BY supplier, yarn
       HAVING COUNT(*) FILTER (WHERE is_recent) > 0 AND COUNT(*) FILTER (WHERE NOT is_recent) > 0`,
      [String(RECENT_DAYS)]) || [];
    const alerts = [];
    for (const r of rows) {
      const recent = Number(r.recent_rate), prior = Number(r.prior_rate);
      if (!(prior > 0)) continue;
      const pct = r2(((recent - prior) / prior) * 100);
      if (Math.abs(pct) >= ALERT_PCT) alerts.push({
        supplier: r.supplier, yarn: r.yarn,
        recent_rate: r2(recent), prior_rate: r2(prior), change_pct: pct,
        direction: pct > 0 ? 'INCREASE' : 'DECREASE',
        message: `${r.supplier} — ${r.yarn} rate ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% (₹${r2(prior)} → ₹${r2(recent)}/kg).`,
      });
    }
    return alerts.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));
  }

  // 12-month purchase volume and last-purchase per supplier.
  async function suppliers({ limit = 20 } = {}) {
    const rows = await q(`
      SELECT COALESCE(g.supplier_name,'?') supplier,
             COUNT(*)::int lots,
             COALESCE(SUM(yl.net_weight_kg),0)::numeric kg,
             COALESCE(SUM(yl.net_weight_kg * yl.rate_per_kg),0)::numeric value,
             MAX(g.receipt_date) last_purchase
        FROM yarn_lots yl JOIN grn g ON g.grn_id = yl.grn_id
       WHERE g.status='APPROVED' AND g.receipt_date >= CURRENT_DATE - 365
       GROUP BY g.supplier_name ORDER BY value DESC LIMIT $1`, [limit]) || [];
    return rows.map(r => ({
      supplier: r.supplier, lots: r.lots, kg: r2(r.kg), value_12m: r2(r.value),
      last_purchase: r.last_purchase,
    }));
  }

  async function summary() {
    const [alerts, sup] = await Promise.all([priceAlerts(), suppliers({ limit: 10 })]);
    return {
      source: 'MES', price_alerts: alerts, top_suppliers: sup,
      note: alerts.length ? undefined : 'No significant supplier price moves in the window (or not enough purchase history).',
      ledger_note: 'Purchase volumes are from MES GRNs. Supplier ledger balances and payment-terms performance are in Busy.',
    };
  }

  return { priceAlerts, suppliers, summary };
};
