// Partner scorecards — supplier & customer performance from data the MES already
// holds. Honest: metrics that need data the MES doesn't have (e.g. true on-time %
// needs a PO↔GRN link, which doesn't exist; supplier payables live in Busy) are
// omitted or labelled, never faked.
module.exports = (pool) => {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const DONE_PO = `('RECEIVED','CLOSED','CANCELLED','COMPLETED')`;

  async function suppliers() {
    const rows = (await pool.query(`
      SELECT p.partner_id, p.company_name, p.rating, p.payment_terms, p.credit_days,
             p.msme_category,
             (SELECT COUNT(*) FROM purchase_orders po WHERE po.partner_id = p.partner_id)::int AS po_count,
             (SELECT COALESCE(SUM(po.total_amount),0) FROM purchase_orders po WHERE po.partner_id = p.partner_id) AS spend,
             (SELECT COUNT(*) FROM purchase_orders po WHERE po.partner_id = p.partner_id
                AND po.status NOT IN ${DONE_PO})::int AS open_pos,
             (SELECT COUNT(*) FROM purchase_orders po WHERE po.partner_id = p.partner_id
                AND po.expected_date < CURRENT_DATE AND po.status NOT IN ${DONE_PO})::int AS overdue_pos,
             (SELECT MAX(po.order_date) FROM purchase_orders po WHERE po.partner_id = p.partner_id) AS last_order,
             (SELECT COUNT(*) FROM grn g WHERE g.partner_id = p.partner_id)::int AS grn_count,
             (SELECT COUNT(*) FROM imports i WHERE i.supplier_id = p.partner_id)::int AS import_count
        FROM partners p
       WHERE EXISTS (SELECT 1 FROM purchase_orders po WHERE po.partner_id = p.partner_id)
          OR EXISTS (SELECT 1 FROM grn g WHERE g.partner_id = p.partner_id)
          OR EXISTS (SELECT 1 FROM imports i WHERE i.supplier_id = p.partner_id)
       ORDER BY spend DESC NULLS LAST`)).rows;
    return rows.map((x) => {
      const po = Number(x.po_count) || 0;
      const reliability = po > 0 ? r2(((po - Number(x.overdue_pos)) / po) * 100) : null;
      return {
        partner_id: x.partner_id, name: x.company_name, rating: x.rating || null,
        payment_terms: x.payment_terms || null, credit_days: x.credit_days != null ? Number(x.credit_days) : null,
        msme: x.msme_category || null,
        po_count: po, spend: r2(x.spend), open_pos: Number(x.open_pos), overdue_pos: Number(x.overdue_pos),
        reliability_pct: reliability, grn_count: Number(x.grn_count),
        import_count: Number(x.import_count),
        last_order: x.last_order,
      };
    });
  }

  async function customers() {
    const rows = (await pool.query(`
      SELECT p.partner_id, p.company_name, p.rating, p.credit_limit, p.credit_days, p.customer_category,
             (SELECT COUNT(*) FROM sales_orders so WHERE so.partner_id = p.partner_id)::int AS so_count,
             (SELECT COALESCE(SUM(ti.grand_total),0) FROM tax_invoices ti
               WHERE ti.partner_id = p.partner_id AND ti.status NOT IN ('CANCELLED','DRAFT')) AS billed,
             (SELECT COUNT(*) FROM dispatch_challans d WHERE d.partner_id = p.partner_id)::int AS dispatch_count,
             (SELECT COUNT(*) FROM sales_returns r WHERE r.partner_id = p.partner_id)::int AS return_count,
             (SELECT COALESCE(SUM(r.total_value),0) FROM sales_returns r WHERE r.partner_id = p.partner_id) AS return_value,
             (SELECT MAX(so.order_date) FROM sales_orders so WHERE so.partner_id = p.partner_id) AS last_order
        FROM partners p
       WHERE EXISTS (SELECT 1 FROM sales_orders so WHERE so.partner_id = p.partner_id)
          OR EXISTS (SELECT 1 FROM tax_invoices ti WHERE ti.partner_id = p.partner_id)
          OR EXISTS (SELECT 1 FROM dispatch_challans d WHERE d.partner_id = p.partner_id)
       ORDER BY billed DESC NULLS LAST`)).rows;

    // Receivables (outstanding/overdue) from the AR ageing view, keyed by partner.
    let ageing = {};
    try {
      const rep = await require('./payments')(pool).ageingReport();
      for (const a of rep) ageing[a.partner_id] = a;
    } catch {}

    return rows.map((x) => {
      const billed = r2(x.billed);
      const retVal = r2(x.return_value);
      const ag = ageing[x.partner_id] || {};
      return {
        partner_id: x.partner_id, name: x.company_name, rating: x.rating || null,
        credit_limit: x.credit_limit != null ? r2(x.credit_limit) : null,
        credit_days: x.credit_days != null ? Number(x.credit_days) : null,
        category: x.customer_category || null,
        so_count: Number(x.so_count), billed,
        dispatch_count: Number(x.dispatch_count),
        return_count: Number(x.return_count), return_value: retVal,
        return_rate_pct: billed > 0 ? r2((retVal / billed) * 100) : null,
        outstanding: ag.outstanding != null ? r2(ag.outstanding) : 0,
        overdue: ag.overdue != null ? r2(ag.overdue) : 0,
        oldest_overdue_days: ag.oldest_overdue_days || 0,
        over_limit: (x.credit_limit != null && Number(x.credit_limit) > 0 && ag.outstanding != null)
          ? ag.outstanding > Number(x.credit_limit) : false,
        last_order: x.last_order,
      };
    });
  }

  return { suppliers, customers };
};
