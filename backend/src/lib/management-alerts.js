// Management alerts (spec §30) — the few things leadership should see at a glance,
// aggregated from the MES-side engines. Prioritised, honest, and never a posting.
//
// Cash framing is deliberate: MES cannot see the opening bank balance (that is in
// Busy), so it reports an expected net OUTFLOW over the horizon — not a "shortage",
// which would require the opening balance. The alert says so.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const INR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const num = (v, d) => { const n = parseFloat(process.env[v]); return Number.isFinite(n) ? n : d; };
const RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

module.exports = (pool) => {
  const cfo = require('./cfo-analytics')(pool);
  const anomaly = require('./anomaly')({ pool });
  const finance = require('./finance')(pool);

  async function compute() {
    const alerts = [];
    const OUTFLOW = num('CASH_ALERT_OUTFLOW_RS', 500000);
    const OVERDUE = num('OVERDUE_ALERT_RS', 1000000);

    // 1. Expected net cash outflow over the next 30 days.
    try {
      const cf = await cfo.cashFlowForecast({ days: 30 });
      const expected = Number(cf.net_movement?.expected || 0);
      if (expected < -OUTFLOW) alerts.push({
        severity: 'HIGH', category: 'Cash flow',
        title: `Expected net cash outflow of ${INR(-expected)} over the next 30 days`,
        detail: `Collections due ${INR(cf.expected_collections?.on_time_due)} vs purchase commitments ${INR(cf.expected_payments?.purchase_commitments_due)}. Opening cash and salary/GST/loan outflows are in Busy — add them for the full picture.`,
      });
    } catch { /* fail-closed */ }

    // 2. Critical anomalies (e.g. negative stock, duplicate payments).
    try {
      const an = await anomaly.summary();
      if (an.by_severity?.CRITICAL) alerts.push({
        severity: 'CRITICAL', category: 'Anomaly',
        title: `${an.by_severity.CRITICAL} critical item(s) need review`,
        detail: an.items.filter(i => i.severity === 'CRITICAL').slice(0, 3).map(i => i.title).join('; '),
      });
      const dupPay = (an.items || []).filter(i => i.category === 'Duplicate payment').length;
      if (dupPay) alerts.push({ severity: 'HIGH', category: 'Anomaly', title: `${dupPay} possible duplicate payment(s)`, detail: 'Same amount recorded more than once on a day — check before month close.' });
    } catch { /* fail-closed */ }

    // 3. Large overdue receivables.
    try {
      const recv = await finance.receivables();
      if (recv.total_overdue >= OVERDUE) alerts.push({
        severity: 'HIGH', category: 'Receivables',
        title: `${INR(recv.total_overdue)} overdue from customers`,
        detail: `Across ${recv.customers.filter(c => c.overdue > 0).length} customer(s); largest: ${recv.customers[0]?.company_name || '—'}.`,
      });
    } catch { /* fail-closed */ }

    // 4. Supplier price spikes.
    try {
      const si = await require('./supplier-intel')(pool).priceAlerts();
      const up = si.filter(a => a.direction === 'INCREASE');
      if (up.length) alerts.push({
        severity: 'MEDIUM', category: 'Purchasing',
        title: `${up.length} supplier price increase(s)`,
        detail: up.slice(0, 3).map(a => `${a.supplier} ${a.yarn} +${Math.abs(a.change_pct)}%`).join('; '),
      });
    } catch { /* fail-closed */ }

    alerts.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    const by = alerts.reduce((m, a) => (m[a.severity] = (m[a.severity] || 0) + 1, m), {});
    return { generated_at: new Date().toISOString(), total: alerts.length, by_severity: by, alerts,
      note: alerts.length ? 'No action taken — these are for management attention.' : 'Nothing needs management attention on MES data right now.' };
  }

  return { compute };
};
