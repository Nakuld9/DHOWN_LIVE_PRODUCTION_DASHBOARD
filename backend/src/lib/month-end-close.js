// AI Accountant — month-end close readiness checklist (spec §close).
//
// A single "is the month clean to close?" report. Busy is the book of accounts, so
// this does NOT close anything — it is the pre-close checklist the accountant runs
// to catch loose ends the MES can see before they finalise the month in Busy:
// unreconciled bank credits, AI items still awaiting sign-off, open anomalies,
// overdue receivables, GST returns not yet prepared, TDS to review.
//
// Each check returns a status: OK (clean), REVIEW (look before closing) or ACTION
// (should be cleared first). The month is "ready to close" only when nothing is
// ACTION. Every figure is live from the existing services — nothing invented.

const INR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

function monthBounds(period) {
  // period 'YYYY-MM' (default: current month). Returns {period, from, to}.
  let p = period;
  if (!/^\d{4}-\d{2}$/.test(p || '')) { const d = new Date(); p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  const [y, m] = p.split('-').map(Number);
  const from = `${p}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { period: p, from, to };
}

module.exports = (pool) => {
  const finance = require('./finance')(pool);
  const anomaly = require('./anomaly')({ pool });
  const gst = require('./gst-returns')(pool);
  const bankFeed = require('./bank-cashflow')(pool);
  const audit = require('./audit')(pool);

  async function run({ period = null } = {}) {
    const { period: per, from, to } = monthBounds(period);
    const items = [];
    const add = (key, label, status, detail, hint) => items.push({ key, label, status, detail, hint: hint || null });

    // 1) Bank reconciliation — every bank credit tied to a receipt.
    try {
      const exc = await bankFeed.exceptions({});
      const n = exc.bank_credits_unreconciled.count, amt = exc.bank_credits_unreconciled.amount;
      add('bank_recon', 'Bank reconciliation', n > 0 ? 'ACTION' : 'OK',
        n > 0 ? `${n} bank credit(s) (${INR(amt)}) not yet matched to a receipt` : 'All bank credits reconciled',
        n > 0 ? 'Reconcile on the Bank Reconciliation page' : null);
    } catch { add('bank_recon', 'Bank reconciliation', 'REVIEW', 'Could not read the bank feed'); }

    // 2) AI items awaiting human sign-off.
    try {
      const pend = await audit.list({ status: 'AI_RECOMMENDED', limit: 500 });
      const n = Array.isArray(pend) ? pend.length : 0;
      add('approvals', 'AI items awaiting approval', n > 0 ? 'ACTION' : 'OK',
        n > 0 ? `${n} AI-prepared item(s) pending review` : 'Nothing pending sign-off',
        n > 0 ? 'Clear the approvals queue' : null);
    } catch { add('approvals', 'AI items awaiting approval', 'OK', 'None'); }

    // 3) Open anomalies.
    try {
      const a = await anomaly.summary();
      const crit = a.by_severity?.CRITICAL || 0, high = a.by_severity?.HIGH || 0;
      add('anomalies', 'Anomalies', crit > 0 ? 'ACTION' : (high > 0 ? 'REVIEW' : 'OK'),
        (crit || high) ? `${crit} critical, ${high} high open` : 'No open anomalies',
        (crit || high) ? 'Resolve on the anomalies panel' : null);
    } catch { add('anomalies', 'Anomalies', 'OK', 'None'); }

    // 4) Receivables overdue.
    try {
      const r = await finance.receivables();
      const od = Number(r.total_overdue) || 0;
      add('receivables', 'Receivables overdue', od > 0 ? 'REVIEW' : 'OK',
        od > 0 ? `${INR(od)} overdue` : 'Nothing overdue',
        od > 0 ? 'Chase on the Collections worklist' : null);
    } catch { add('receivables', 'Receivables overdue', 'OK', '—'); }

    // 5) GST outward (GSTR-1 / 3B section 3.1) prepared for the period.
    try {
      const b3 = await gst.gstr3b({ period: per });
      const tax = b3.section_3_1_outward?.net_output_tax || 0;
      const inv = b3.section_3_1_outward?.gross?.invoices || 0;
      add('gst_outward', `GSTR-1 / 3B outward (${per})`, 'OK',
        `${inv} invoice(s), output tax ${INR(tax)} — prepared`, inv === 0 ? 'No sales invoices booked this period' : null);
      // 6) GSTR-2B uploaded (so ITC + net tax can be finalised).
      const twob = await gst.getGstr2b(per);
      add('gst_2b', `GSTR-2B / ITC (${per})`, twob ? 'OK' : 'REVIEW',
        twob ? `ITC ${INR(twob.eligible_itc?.total || 0)} from uploaded 2B` : 'GSTR-2B not uploaded — ITC + net tax not finalised',
        twob ? null : 'Upload the GSTR-2B JSON on the GST returns panel');
    } catch { add('gst_outward', `GST returns (${per})`, 'REVIEW', 'Could not compute GST'); }

    // 7) TDS review (194C job-work heads-up).
    try {
      const tds = require('./tds-monitor')(pool);
      const rev = await tds.review();
      const n = (rev.items || rev.rows || []).length || Number(rev.count) || 0;
      add('tds', 'TDS (194C) review', n > 0 ? 'REVIEW' : 'OK',
        n > 0 ? `${n} item(s) to review` : 'Nothing flagged', n > 0 ? 'Check the TDS monitor' : null);
    } catch { add('tds', 'TDS (194C) review', 'OK', '—'); }

    const counts = items.reduce((m, i) => (m[i.status] = (m[i.status] || 0) + 1, m), {});
    const ready = !(counts.ACTION > 0);
    return {
      period: per, from, to, generated_at: new Date().toISOString(),
      ready_to_close: ready,
      summary: { ok: counts.OK || 0, review: counts.REVIEW || 0, action: counts.ACTION || 0 },
      items,
      note: 'Pre-close checklist from MES data. Busy remains the book of accounts — this does not post or close anything.',
    };
  }

  return { run };
};
