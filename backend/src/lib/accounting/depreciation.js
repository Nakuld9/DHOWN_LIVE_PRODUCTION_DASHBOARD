// Depreciation Chart (Busy-style) over a fixed-asset register. WDV block method
// with the 180-day rule (half-rate on assets put to use under 180 days in the
// year), or straight-line (SLM) on original cost. Opening WDV is entered once per
// asset; additions are assets bought within the year, deductions are disposals.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const { ymd } = require('./schema');
const ms = (d) => Date.parse(ymd(d) + 'T00:00:00Z');

module.exports = (pool) => {
  const svc = require('./service')(pool);
  async function cid() { return svc.companyId(); }

  async function listAssets() {
    return (await pool.query(`SELECT * FROM acct.fixed_assets WHERE company_id=$1 ORDER BY block NULLS FIRST, name`, [await cid()])).rows;
  }

  async function saveAsset(b, user) {
    if (!b.name || !b.purchase_date || b.cost == null || b.rate_pct == null) throw new Error('name, purchase_date, cost and rate_pct are required');
    const r = await pool.query(
      `INSERT INTO acct.fixed_assets (company_id, name, block, purchase_date, cost, rate_pct, method, opening_wdv, disposal_date, disposal_value, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [await cid(), b.name, b.block || null, b.purchase_date, b.cost, b.rate_pct, b.method === 'SLM' ? 'SLM' : 'WDV',
        b.opening_wdv != null ? b.opening_wdv : null, b.disposal_date || null, b.disposal_value != null ? b.disposal_value : null, b.notes || null, (user && user.username) || 'system']);
    return r.rows[0];
  }

  async function deleteAsset(id) {
    await pool.query(`DELETE FROM acct.fixed_assets WHERE company_id=$1 AND asset_id=$2`, [await cid(), id]);
    return { removed: id };
  }

  async function schedule({ from, to } = {}) {
    if (!from || !to) throw new Error('from and to (financial year) are required');
    const fromMs = Date.parse(from + 'T00:00:00Z'); const toMs = Date.parse(to + 'T00:00:00Z');
    const assets = await listAssets();
    const rows = []; const T = { opening: 0, additions: 0, deductions: 0, depreciation: 0, closing: 0 };
    for (const a of assets) {
      const purMs = ms(a.purchase_date);
      if (purMs > toMs) continue; // not acquired yet
      const inFY = purMs >= fromMs && purMs <= toMs;
      const disposed = a.disposal_date && (() => { const d = ms(a.disposal_date); return d >= fromMs && d <= toMs; })();
      const cost = Number(a.cost) || 0; const rate = Number(a.rate_pct) || 0;
      const opening = inFY ? 0 : (a.opening_wdv != null ? Number(a.opening_wdv) : cost);
      const additions = inFY ? cost : 0;
      const deductions = disposed ? (Number(a.disposal_value) || 0) : 0;
      let dep = 0;
      if (a.method === 'SLM') {
        dep = rate / 100 * cost;
      } else { // WDV block + 180-day rule on this year's additions
        const daysUsed = Math.floor((toMs - purMs) / 864e5);
        if (inFY && daysUsed < 180) dep = rate / 100 * Math.max(opening - deductions, 0) + rate / 200 * additions;
        else dep = rate / 100 * Math.max(opening + additions - deductions, 0);
      }
      dep = r2(dep);
      const closing = r2(opening + additions - deductions - dep);
      rows.push({ asset: a.name, block: a.block || '—', method: a.method || 'WDV', rate_pct: rate,
        opening_wdv: r2(opening).toFixed(2), additions: r2(additions).toFixed(2), deductions: r2(deductions).toFixed(2), depreciation: dep.toFixed(2), closing_wdv: closing.toFixed(2) });
      T.opening += opening; T.additions += additions; T.deductions += deductions; T.depreciation += dep; T.closing += closing;
    }
    return {
      period: { from, to }, rows,
      totals: { opening_wdv: r2(T.opening).toFixed(2), additions: r2(T.additions).toFixed(2), deductions: r2(T.deductions).toFixed(2), depreciation: r2(T.depreciation).toFixed(2), closing_wdv: r2(T.closing).toFixed(2) },
      note: 'WDV uses the 180-day rule (half rate on additions used < 180 days). Opening WDV is as entered on each asset. Not a substitute for your CA’s computation.',
    };
  }

  return { listAssets, saveAsset, deleteAsset, schedule };
};
