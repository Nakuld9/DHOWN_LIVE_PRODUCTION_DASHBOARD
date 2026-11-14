// Anomaly detection for the AI Accountant (spec §19).
//
// Deterministic rules over MES financial data. Cheap enough to run on demand and
// in the daily report. Fail-closed per rule (a missing table or bad query drops
// that ONE finding, never the whole scan) — same discipline as ai-insights.
//
// LANGUAGE RULE (spec §19): these are items to REVIEW, never accusations. Titles
// say "possible duplicate", "requires review" — never "fraud".
//
// Phase 0 is MES-only. Rules that need Busy (bank duplicates, ledger anomalies)
// arrive with the Busy read bridge.

const RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const num = (v, d) => { const n = parseInt(process.env[v], 10); return Number.isFinite(n) ? n : d; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = ({ pool }) => {
  async function q(sql, params = []) {
    try { return (await pool.query(sql, params)).rows; } catch { return null; }
  }

  const ROUND_MIN = num('ANOMALY_ROUND_MIN_RS', 100000);   // flag round amounts at/above this
  const BACKDATE_DAYS = num('ANOMALY_BACKDATE_DAYS', 7);   // entry dated this many days before it was recorded

  async function compute() {
    const out = [];

    // A. Duplicate invoice NUMBER — the same number on more than one live invoice.
    const dupNo = await q(`
      SELECT invoice_number, COUNT(*)::int n, SUM(grand_total)::numeric amt
        FROM tax_invoices
       WHERE UPPER(COALESCE(status,'')) <> 'CANCELLED' AND COALESCE(invoice_number,'') <> ''
       GROUP BY invoice_number HAVING COUNT(*) > 1`);
    for (const r of (dupNo || [])) out.push({
      id: `dup-inv-no-${r.invoice_number}`, category: 'Duplicate invoice', severity: 'HIGH',
      title: `Invoice number ${r.invoice_number} used ${r.n} times`,
      evidence: `${r.n} live invoices share number ${r.invoice_number} (₹${r2(r.amt)} total). Requires review.`,
      refs: [{ type: 'invoice_number', id: r.invoice_number }],
    });

    // B. Possible duplicate invoice — same customer, identical total, within 3 days.
    const dupInv = await q(`
      SELECT partner_id, grand_total, COUNT(*)::int n,
             MIN(invoice_number) a, MAX(invoice_number) b
        FROM tax_invoices
       WHERE UPPER(COALESCE(status,'')) <> 'CANCELLED'
         AND invoice_date >= CURRENT_DATE - 90 AND grand_total > 0
       GROUP BY partner_id, grand_total, (invoice_date::date / 3)
      HAVING COUNT(*) > 1`);
    for (const r of (dupInv || [])) out.push({
      id: `dup-inv-${r.partner_id}-${r.grand_total}`, category: 'Duplicate invoice', severity: 'MEDIUM',
      title: `Possible duplicate: ₹${r2(r.grand_total)} billed ${r.n}× to one customer within days`,
      evidence: `Invoices ${r.a}…${r.b} — same customer, same amount, close dates. Requires review.`,
      refs: [{ type: 'partner_id', id: r.partner_id }],
    });

    // C. Duplicate payment — same customer, same amount, same day.
    const dupPay = await q(`
      SELECT partner_id, amount, payment_date::date d, COUNT(*)::int n
        FROM payments
       WHERE COALESCE(status,'ACTIVE') <> 'CANCELLED' AND amount > 0
         AND payment_date >= CURRENT_DATE - 90
       GROUP BY partner_id, amount, payment_date::date HAVING COUNT(*) > 1`);
    for (const r of (dupPay || [])) out.push({
      id: `dup-pay-${r.partner_id}-${r.amount}-${r.d}`, category: 'Duplicate payment', severity: 'HIGH',
      title: `₹${r2(r.amount)} receipt recorded ${r.n}× on the same day`,
      evidence: `Same customer, same amount (₹${r2(r.amount)}), same date — possible double entry. Requires review.`,
      refs: [{ type: 'partner_id', id: r.partner_id }],
    });

    // D. Large round-number invoice — a value that is suspiciously round AND large
    //    is worth a glance (often a placeholder/estimate posted as final).
    const round = await q(`
      SELECT invoice_number, partner_id, grand_total
        FROM tax_invoices
       WHERE UPPER(COALESCE(status,'')) <> 'CANCELLED'
         AND grand_total >= $1 AND (grand_total::numeric % 10000) = 0
         AND invoice_date >= CURRENT_DATE - 60
       ORDER BY grand_total DESC LIMIT 10`, [ROUND_MIN]);
    for (const r of (round || [])) out.push({
      id: `round-${r.invoice_number}`, category: 'Unusual value', severity: 'LOW',
      title: `Round-number invoice ₹${r2(r.grand_total)} (${r.invoice_number})`,
      evidence: `A large, exactly round total can be a placeholder posted as final. Worth a quick check.`,
      refs: [{ type: 'invoice_number', id: r.invoice_number }],
    });

    // E. Backdated invoice — recorded well after the date it carries.
    const back = await q(`
      SELECT invoice_number, invoice_date, created_at::date recorded,
             (created_at::date - invoice_date::date)::int gap
        FROM tax_invoices
       WHERE UPPER(COALESCE(status,'')) <> 'CANCELLED'
         AND created_at::date - invoice_date::date > $1
         AND invoice_date >= CURRENT_DATE - 120
       ORDER BY gap DESC LIMIT 10`, [BACKDATE_DAYS]);
    for (const r of (back || [])) out.push({
      id: `backdate-${r.invoice_number}`, category: 'Backdated entry', severity: 'MEDIUM',
      title: `Invoice ${r.invoice_number} dated ${r.gap} days before it was recorded`,
      evidence: `Invoice date ${String(r.invoice_date).slice(0, 10)}, recorded ${String(r.recorded).slice(0, 10)}. Requires review.`,
      refs: [{ type: 'invoice_number', id: r.invoice_number }],
    });

    // F. Customer past their own credit period, still unpaid.
    const credit = await q(`
      SELECT v.partner_id, p.company_name, v.overdue, v.oldest_overdue_days, COALESCE(p.credit_days,0) credit_days
        FROM v_partner_outstanding v JOIN partners p ON p.partner_id = v.partner_id
       WHERE v.overdue > 0 AND COALESCE(p.credit_days,0) > 0
         AND v.oldest_overdue_days > p.credit_days
       ORDER BY v.overdue DESC LIMIT 15`);
    for (const r of (credit || [])) out.push({
      id: `credit-${r.partner_id}`, category: 'Credit breach',
      severity: Number(r.overdue) >= 500000 ? 'HIGH' : 'MEDIUM',
      title: `${r.company_name} is ${r.oldest_overdue_days - r.credit_days} days beyond credit terms`,
      evidence: `₹${r2(r.overdue)} overdue; oldest ${r.oldest_overdue_days} days vs ${r.credit_days}-day terms.`,
      refs: [{ type: 'partner_id', id: r.partner_id }],
    });

    // G. Negative finished-goods stock — an impossible balance, always worth a stop.
    const neg = await q(`
      SELECT fabric_type, color_name, SUM(weight_kg)::numeric kg
        FROM finished_goods
       GROUP BY fabric_type, color_name HAVING SUM(weight_kg) < 0`);
    for (const r of (neg || [])) out.push({
      id: `neg-stock-${r.fabric_type}-${r.color_name}`, category: 'Negative stock', severity: 'CRITICAL',
      title: `Negative stock: ${r.fabric_type} ${r.color_name || ''} (${r2(r.kg)} kg)`,
      evidence: `Finished-goods balance is negative — a movement was recorded without the stock existing. Requires review.`,
      refs: [{ type: 'fabric', id: `${r.fabric_type}/${r.color_name || ''}` }],
    });

    // H. Missing GST on a taxable sale — taxable value but zero tax recorded.
    const noGst = await q(`
      SELECT invoice_number, taxable_value
        FROM tax_invoices
       WHERE UPPER(COALESCE(status,'')) <> 'CANCELLED'
         AND COALESCE(taxable_value,0) > 0 AND COALESCE(total_tax,0) = 0
         AND UPPER(COALESCE(supply_type,'')) NOT IN ('EXEMPT','NIL','EXPORT','ZERO')
         AND invoice_date >= CURRENT_DATE - 120
       ORDER BY taxable_value DESC LIMIT 10`);
    for (const r of (noGst || [])) out.push({
      id: `no-gst-${r.invoice_number}`, category: 'GST', severity: 'MEDIUM',
      title: `Invoice ${r.invoice_number} has taxable value but no GST`,
      evidence: `₹${r2(r.taxable_value)} taxable with zero tax and not marked exempt/export — verify the tax.`,
      refs: [{ type: 'invoice_number', id: r.invoice_number }],
    });

    // I. Customer over their credit LIMIT (outstanding exceeds the sanctioned limit).
    const overLimit = await q(`
      SELECT p.company_name, p.credit_limit, v.outstanding
        FROM v_partner_outstanding v JOIN partners p ON p.partner_id = v.partner_id
       WHERE COALESCE(p.credit_limit,0) > 0 AND v.outstanding > p.credit_limit
       ORDER BY (v.outstanding - p.credit_limit) DESC LIMIT 10`);
    for (const r of (overLimit || [])) out.push({
      id: `credit-limit-${r.company_name}`, category: 'Credit breach',
      severity: Number(r.outstanding) - Number(r.credit_limit) >= 500000 ? 'HIGH' : 'MEDIUM',
      title: `${r.company_name} is over their credit limit`,
      evidence: `Outstanding ₹${r2(r.outstanding)} exceeds the ₹${r2(r.credit_limit)} limit by ₹${r2(r.outstanding - r.credit_limit)}.`,
      refs: [{ type: 'company', id: r.company_name }],
    });

    // J. Approved GRN yarn lot with no purchase price — costing/valuation gap.
    const zeroPrice = await q(`
      SELECT COUNT(*)::int n FROM yarn_lots yl JOIN grn g ON g.grn_id = yl.grn_id
       WHERE g.status='APPROVED' AND COALESCE(yl.rate_per_kg,0) = 0
         AND yl.created_at >= CURRENT_DATE - 120`);
    if (zeroPrice && zeroPrice[0].n > 0) out.push({
      id: 'zero-price-yarn', category: 'Data quality', severity: 'LOW',
      title: `${zeroPrice[0].n} yarn lot(s) received with no rate`,
      evidence: 'Approved GRN lots have ₹0/kg — costing and stock valuation will be understated. Add the purchase rate.',
      refs: [{ type: 'grn', id: 'zero-rate' }],
    });

    // K. Large customer receipt with no reference recorded — traceability gap.
    const noRef = await q(`
      SELECT COUNT(*)::int n FROM payments
       WHERE COALESCE(status,'ACTIVE') <> 'CANCELLED' AND amount >= $1
         AND COALESCE(TRIM(reference),'') = '' AND payment_date >= CURRENT_DATE - 90`, [ROUND_MIN]);
    if (noRef && noRef[0].n > 0) out.push({
      id: 'payment-no-ref', category: 'Data quality', severity: 'LOW',
      title: `${noRef[0].n} large receipt(s) with no reference`,
      evidence: `Receipts of ₹${ROUND_MIN.toLocaleString('en-IN')}+ recorded without a UTR/cheque reference — hard to reconcile against the bank.`,
      refs: [{ type: 'payment', id: 'no-ref' }],
    });

    out.sort((a, b) => (RANK[a.severity] - RANK[b.severity]));
    return out;
  }

  // Counts by severity — for the dashboard alert tiles and the daily report header.
  async function summary() {
    const all = await compute();
    const by = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    for (const a of all) by[a.severity] = (by[a.severity] || 0) + 1;
    return { total: all.length, by_severity: by, items: all };
  }

  return { compute, summary };
};
