// Sales Invoice AI (spec §6) — verify a sales invoice BEFORE it is raised.
//
// Given a proposed invoice (customer + SO + lines + tax), it cross-checks the MES:
// customer identity & GSTIN, credit exposure, the sales order (over-billing vs
// ordered/undispatched qty), the authorised customer rate, whether goods were
// actually dispatched, and GST arithmetic. It flags problems for a human to fix
// before invoicing — it never creates or posts the invoice.
//
// HONESTY: reports only what MES shows; a credit-limit breach is "exceeds the
// credit limit — approve or collect first", not a refusal. Nothing here is a
// statutory determination.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d) => { const n = parseFloat(process.env[v]); return Number.isFinite(n) ? n : d; };
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const RATE_TOL = num('SALES_RATE_TOLERANCE_PCT', 2);   // rate below authorised beyond this % = flag
const tok = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);

module.exports = (pool) => {
  const audit = require('./audit')(pool);
  const q = async (sql, p = []) => { try { return (await pool.query(sql, p)).rows; } catch { return null; } };

  // proposed = { partner_id, so_number?, items:[{description, quantity, rate}],
  //              taxable?, tax?, total? }
  async function check(proposed, { by } = {}) {
    if (!proposed || !proposed.partner_id) return { error: 'A partner_id and the proposed invoice are required.' };
    const p = proposed;
    const invoiceValue = Number(p.total) || (Number(p.taxable || 0) + Number(p.tax || 0)) ||
      (p.items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.rate) || 0), 0);
    const checks = [];
    const add = (key, status, message) => checks.push({ key, status, message });

    // 1. Customer + GSTIN.
    const cust = (await q(`SELECT company_name, gstin, credit_limit, credit_days FROM partners WHERE partner_id=$1`, [p.partner_id]))?.[0];
    if (!cust) { add('customer', 'fail', 'Customer not found in the partner master.'); }
    else {
      add('customer', 'ok', `Customer: ${cust.company_name}.`);
      if (cust.gstin) add('gstin', GSTIN_RE.test(String(cust.gstin).toUpperCase()) ? 'ok' : 'warn',
        GSTIN_RE.test(String(cust.gstin).toUpperCase()) ? `GSTIN ${cust.gstin} format valid.` : `GSTIN ${cust.gstin} format looks wrong — verify.`);
      else add('gstin', 'info', 'Customer has no GSTIN on file — B2C, or add it.');
    }

    // 2. Credit exposure — current outstanding + this invoice vs the limit.
    const o = (await q(`SELECT COALESCE(outstanding,0) outstanding, COALESCE(overdue,0) overdue FROM v_partner_outstanding WHERE partner_id=$1`, [p.partner_id]))?.[0] || { outstanding: 0, overdue: 0 };
    const limit = Number(cust?.credit_limit) || 0;
    const exposure = r2(Number(o.outstanding) + invoiceValue);
    if (limit > 0 && exposure > limit) add('credit', 'warn', `This invoice takes exposure to ₹${exposure}, above the ₹${limit} credit limit. Approve or collect first.`);
    else if (Number(o.overdue) > 0) add('credit', 'info', `Customer has ₹${r2(o.overdue)} already overdue — consider before extending more.`);
    else add('credit', 'ok', limit > 0 ? `Within credit limit (exposure ₹${exposure} of ₹${limit}).` : 'No credit limit set.');

    // 3. Sales order — over-billing vs ordered/undispatched quantity.
    if (p.so_number) {
      const so = (await q(`SELECT so_id, so_number, status FROM sales_orders WHERE partner_id=$1 AND so_number ILIKE $2 LIMIT 1`, [p.partner_id, `%${p.so_number}%`]))?.[0];
      if (!so) add('sales_order', 'warn', `No sales order ${p.so_number} found for this customer.`);
      else {
        const lines = await q(`SELECT COALESCE(SUM(quantity),0) ordered, COALESCE(SUM(dispatched_qty),0) dispatched FROM sales_order_items WHERE so_id=$1`, [so.so_id]);
        const ordered = Number(lines?.[0]?.ordered || 0), dispatched = Number(lines?.[0]?.dispatched || 0);
        const invQty = (p.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        if (ordered > 0 && invQty > ordered - dispatched + 0.01)
          add('sales_order', 'warn', `Invoice qty ${r2(invQty)} exceeds the undispatched balance on ${so.so_number} (ordered ${r2(ordered)}, already dispatched ${r2(dispatched)}). Over-billing?`);
        else add('sales_order', 'ok', `Matches ${so.so_number} (ordered ${r2(ordered)}, dispatched ${r2(dispatched)}).`);
      }
    } else add('sales_order', 'info', 'No SO referenced — direct invoice.');

    // 4. Authorised rate — each line vs the customer's authorised price.
    for (const it of (p.items || [])) {
      if (!(Number(it.rate) > 0)) continue;
      const toks = tok(it.description);
      if (!toks.length) continue;
      const score = toks.map((_, i) => `(CASE WHEN (product||' '||COALESCE(shade,'')) ILIKE '%'||$${i + 2}||'%' THEN 1 ELSE 0 END)`).join(' + ');
      const auth = (await q(`SELECT product, rate, (${score}) s FROM customer_prices
         WHERE partner_id=$1 AND is_active=true AND valid_from<=CURRENT_DATE AND (valid_to IS NULL OR valid_to>=CURRENT_DATE) AND (${score})>0
         ORDER BY s DESC, valid_from DESC LIMIT 1`, [p.partner_id, ...toks]))?.[0];
      if (auth) {
        const diffPct = auth.rate > 0 ? r2(((Number(it.rate) - Number(auth.rate)) / Number(auth.rate)) * 100) : 0;
        if (diffPct < -RATE_TOL) add('rate', 'warn', `${it.description}: billed ₹${r2(it.rate)} is ${Math.abs(diffPct)}% BELOW the authorised ₹${r2(auth.rate)}/kg — check discount approval.`);
        else add('rate', 'ok', `${it.description}: ₹${r2(it.rate)} within authorised (₹${r2(auth.rate)}).`);
      }
    }

    // 5. Dispatch cross-check — were goods actually dispatched to this customer?
    const disp = await q(`SELECT COUNT(*)::int n, COALESCE(SUM(di.weight_kg),0) kg
       FROM dispatch_challans d JOIN dispatch_items di ON di.dispatch_id=d.dispatch_id
      WHERE (d.partner_id=$1 OR LOWER(d.customer_name) LIKE '%'||LOWER($2)||'%')
        AND d.dispatch_date >= CURRENT_DATE - 45`, [p.partner_id, cust?.company_name || '']);
    if (disp && disp[0].n > 0) add('dispatch', 'ok', `${disp[0].n} recent dispatch(es) found (${r2(disp[0].kg)} kg) — invoice against them.`);
    else add('dispatch', 'info', 'No recent dispatch found for this customer — invoicing before dispatch? Confirm goods have moved.');

    // 6. GST arithmetic.
    if (p.taxable != null && p.tax != null && p.total != null) {
      const drift = r2(Number(p.taxable) + Number(p.tax) - Number(p.total));
      add('gst_math', Math.abs(drift) <= 1 ? 'ok' : 'warn',
        Math.abs(drift) <= 1 ? 'Taxable + tax = total.' : `Taxable + tax does not equal total; off by ₹${drift}. Check the figures.`);
    }

    const fails = checks.filter(c => c.status === 'fail').length;
    const warns = checks.filter(c => c.status === 'warn').length;
    const verdict = fails ? 'DO_NOT_RAISE' : (warns ? 'REVIEW_BEFORE_RAISING' : 'OK_TO_RAISE');
    const summary = { customer: cust?.company_name, so_number: p.so_number || null, invoice_value: r2(invoiceValue), verdict, checks_failed: fails, checks_warned: warns };

    await audit.record({
      actor: by || null, agent: 'accountant', action: 'CHECK_SALES_INVOICE',
      entity_type: 'sales_invoice', entity_id: p.so_number || null,
      after: summary, reason: `Pre-invoice check: ${verdict}`, status: 'AI_RECOMMENDED',
    });

    return { summary, checks };
  }

  return { check };
};
