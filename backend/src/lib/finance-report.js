// DHOWN Daily Finance Report (spec §29) + the top-5 recommendations (§29/§30).
//
// Composes the finance snapshot + anomalies + receivables into one management
// brief. Runs daily (jobLock in server.js). It:
//   1. builds a structured report and a WhatsApp-friendly text version,
//   2. persists the latest to app_settings so the dashboard/route can show it,
//   3. best-effort WhatsApps it to staff (works inside the 24h window; the
//      dashboard copy is always current regardless).
//
// Read-only: it reports and recommends. It never posts, pays, or alters the books.

const INR = (n) => { const v = Math.round(Number(n) || 0); return (v < 0 ? '-₹' : '₹') + Math.abs(v).toLocaleString('en-IN'); };
const num = (v, d) => { const n = parseInt(process.env[v], 10); return Number.isFinite(n) ? n : d; };

module.exports = ({ pool, sendText } = {}) => {
  const finance = require('./finance')(pool);
  const anomaly = require('./anomaly')({ pool });

  // Derive the day's top actions from the actual data — never generic advice.
  function recommend({ recv, pay, anomalies, bankExc }) {
    const recs = [];
    const crit = anomalies.filter(a => a.severity === 'CRITICAL');
    if (crit.length) recs.push(`Resolve ${crit.length} CRITICAL item(s) first: ${crit[0].title}.`);
    if (bankExc && bankExc.bank_credits_unreconciled.count > 0) {
      recs.push(`Reconcile ${bankExc.bank_credits_unreconciled.count} bank credit(s) (${INR(bankExc.bank_credits_unreconciled.amount)}) not yet tied to a receipt.`);
    }
    if (recv.total_overdue > 0) recs.push(`Chase ${INR(recv.total_overdue)} overdue from ${recv.customers.filter(c => c.overdue > 0).length} customer(s); start with ${recv.customers[0]?.company_name || 'the largest'}.`);
    const breaches = anomalies.filter(a => a.category === 'Credit breach');
    if (breaches.length) recs.push(`Review ${breaches.length} customer(s) past their credit terms.`);
    if (pay.overdue_amount > 0) recs.push(`${INR(pay.overdue_amount)} of purchase commitments are past their expected date — confirm supplier status.`);
    if (pay.due_this_week > 0) recs.push(`Plan ${INR(pay.due_this_week)} of supplier payments due this week against expected collections.`);
    const dups = anomalies.filter(a => a.category.startsWith('Duplicate'));
    if (dups.length) recs.push(`Check ${dups.length} possible duplicate invoice/payment item(s) before month close.`);
    return recs.slice(0, 5);
  }

  const bankFeed = require('./bank-cashflow')(pool);

  async function build() {
    const [snap, anom, bankExc] = await Promise.all([finance.snapshot(), anomaly.summary(), bankFeed.exceptions({}).catch(() => null)]);
    const recv = snap.receivables, pay = snap.payables;
    const recommendations = recommend({ recv, pay, anomalies: anom.items, bankExc });

    const bb = snap.cash.bank_balance, mv = snap.cash.bank_movements_7d;
    const cashLines = (bb && bb.available)
      ? [
          `• Bank balance: ${INR(bb.value)} (as of ${bb.as_of ? new Date(bb.as_of).toLocaleDateString('en-GB') : '—'}, ${bb.accounts?.length || 0} a/c)`,
          ...(mv && mv.available ? [`• Bank last 7d: in ${INR(mv.money_in)} / out ${INR(mv.money_out)}`] : []),
        ]
      : ['• Bank/cash balance: in Busy (not in MES)'];

    const text = [
      '📊 *DHOWN DAILY FINANCE REPORT*',
      `_${new Date().toLocaleDateString('en-GB')}_`,
      '',
      '*CASH*',
      `• Collections today: ${INR(snap.cash.collections_today.value)} (${snap.cash.collections_today.count})`,
      ...cashLines,
      '',
      '*RECEIVABLES*',
      `• Outstanding: ${INR(recv.total_outstanding)} | Overdue: ${INR(recv.total_overdue)}`,
      ...(recv.customers.slice(0, 3).filter(c => c.overdue > 0).map(c => `   – ${c.company_name}: ${INR(c.overdue)} overdue`)),
      '',
      '*PAYABLES (open commitments)*',
      `• Open: ${INR(pay.total_open)} | Overdue: ${INR(pay.overdue_amount)} | Due this week: ${INR(pay.due_this_week)}`,
      '',
      '*SALES / PURCHASE*',
      `• Sales MTD: ${INR(snap.sales.month_to_date.value)} (${snap.sales.month_to_date.invoices} inv)`,
      `• Purchases ordered MTD: ${INR(snap.purchases.month_to_date.value)}`,
      '',
      '*GST*',
      `• Output tax (sales): ${INR((snap.gst.output_tax.total) || 0)} — ITC is in Busy`,
      '',
      '*ALERTS*',
      `• Critical ${anom.by_severity.CRITICAL} | High ${anom.by_severity.HIGH} | Medium ${anom.by_severity.MEDIUM}`,
      ...(anom.items.slice(0, 3).map(a => `   – [${a.severity}] ${a.title}`)),
      '',
      '*TOP ACTIONS TODAY*',
      ...(recommendations.length ? recommendations.map((r, i) => `${i + 1}. ${r}`) : ['   Nothing pressing — books look clean on MES data.']),
      '',
      '_Prepared by DHOWN AI Accountant from MES data. No payment or posting has been made._',
    ].join('\n');

    return { generated_at: new Date().toISOString(), snapshot: snap, anomalies: anom, recommendations, text };
  }

  // Persist the latest report so the dashboard and /report route always have it.
  async function persist(report) {
    try {
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('ai_finance_report_latest', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(report)]);
    } catch (e) { require('./observability').log('error', 'finance_report.persist', { error: e.message }); }
  }

  async function latest() {
    try {
      const r = await pool.query(`SELECT value, updated_at FROM app_settings WHERE key = 'ai_finance_report_latest'`);
      if (!r.rows.length) return null;
      const v = r.rows[0].value;
      return typeof v === 'string' ? JSON.parse(v) : v;
    } catch { return null; }
  }

  // Staff recipients for the WhatsApp copy (same env the alerts use).
  const recipients = () => (process.env.WHATSAPP_TO || '').split(',').map(s => s.trim()).filter(Boolean);

  async function run() {
    if (process.env.FINANCE_REPORT_ENABLED === 'false') return { skipped: 'disabled' };
    const report = await build();
    await persist(report);
    // Best-effort WhatsApp — only lands inside the 24h window; the dashboard copy
    // is authoritative and always current.
    let sent = 0;
    if (sendText && process.env.FINANCE_REPORT_WHATSAPP !== 'false') {
      for (const to of recipients()) {
        try { await sendText(to, report.text); sent++; } catch { /* window/API — non-fatal */ }
      }
    }
    return { ok: true, sent, recipients: recipients().length, alerts: report.anomalies.total };
  }

  return { build, run, latest, persist };
};
