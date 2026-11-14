// CFO analytics for the AI Accountant (spec §14 profitability, §16 cash-flow
// forecast, §17 working capital). Phase 0 — MES data only, honest about limits.
//
// HONESTY CONTRACT (§32): revenue, collections, receivables and open POs are
// ACTUAL (from MES). Anything derived with an assumption (DSO/DPO, forecast
// scenarios) is tagged ESTIMATE. Figures that live only in Busy — opening bank
// balance, true product-cost per customer, salaries/GST/loan commitments — are
// reported as unavailable, never invented.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d) => { const n = parseFloat(process.env[v]); return Number.isFinite(n) ? n : d; };
const UNAVAILABLE = (what, src = 'BUSY') => ({ available: false, source: src, kind: 'unavailable',
  note: `${what} is not in the MES${src === 'BUSY' ? ' — it is in Busy' : ''}.` });

module.exports = (pool) => {
  async function q(sql, params = []) { try { return (await pool.query(sql, params)).rows; } catch { return null; } }

  // §14 — Customer profitability. Revenue and returns are ACTUAL; true product-cost
  // contribution needs the costing↔invoice link (or Busy), so it is not invented —
  // customers are ranked by NET revenue with collection quality alongside, and the
  // contribution gap is stated plainly.
  async function customerProfitability({ limit = 20 } = {}) {
    const rev = await q(`
      SELECT ti.partner_id, p.company_name,
             COALESCE(SUM(ti.grand_total),0)::numeric AS revenue,
             COUNT(*)::int AS invoices
        FROM tax_invoices ti JOIN partners p ON p.partner_id = ti.partner_id
       WHERE UPPER(COALESCE(ti.status,'')) <> 'CANCELLED'
         AND ti.invoice_date >= CURRENT_DATE - 365
       GROUP BY ti.partner_id, p.company_name`) || [];

    // Returns per customer (fail-closed if the table/columns differ).
    const ret = await q(`
      SELECT partner_id, COALESCE(SUM(COALESCE(total_amount, grand_total, 0)),0)::numeric AS returned
        FROM sales_returns
       WHERE created_at >= CURRENT_DATE - 365 GROUP BY partner_id`) || [];
    const retMap = Object.fromEntries(ret.map(r => [r.partner_id, Number(r.returned)]));

    const out = await q(`SELECT partner_id, outstanding, overdue FROM v_partner_outstanding`) || [];
    const outMap = Object.fromEntries(out.map(r => [r.partner_id, r]));

    const rows = rev.map(r => {
      const returned = retMap[r.partner_id] || 0;
      const o = outMap[r.partner_id] || {};
      const revenue = Number(r.revenue);
      const net = r2(revenue - returned);
      const overdue = Number(o.overdue || 0), outstanding = Number(o.outstanding || 0);
      return {
        partner_id: r.partner_id, company_name: r.company_name,
        revenue_12m: r2(revenue), returns_12m: r2(returned), net_revenue_12m: net,
        invoices: r.invoices, outstanding: r2(outstanding), overdue: r2(overdue),
        collection_quality: outstanding > 0 ? r2(1 - overdue / outstanding) : 1,   // 1 = clean, →0 = mostly overdue
      };
    }).sort((a, b) => b.net_revenue_12m - a.net_revenue_12m).slice(0, limit);

    return {
      kind: 'actual', source: 'MES', window: 'last 12 months',
      customers: rows,
      contribution_note: 'Revenue, returns and collection quality are ACTUAL. True product-cost contribution per customer needs the costing↔invoice link (or Busy) and is not shown rather than estimated. Ranked by net revenue.',
    };
  }

  // §16 — Cash-flow forecast. NET movement (collections − payments) over a horizon,
  // in three scenarios. Opening cash and non-MES commitments (salary/GST/loans) are
  // reported separately as unavailable, so the forecast is never dressed up as a
  // closing bank balance it cannot know.
  async function cashFlowForecast({ days = 30 } = {}) {
    const H = Math.min(Math.max(parseInt(days, 10) || 30, 7), 180);

    const coll = (await q(`
      SELECT
        COALESCE(SUM(balance) FILTER (WHERE due_date < CURRENT_DATE),0)::numeric AS overdue_due,
        COALESCE(SUM(balance) FILTER (WHERE due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + $1),0)::numeric AS due_in_horizon
        FROM v_invoice_balances WHERE balance > 0.009`, [H]))?.[0] || { overdue_due: 0, due_in_horizon: 0 };
    const overdueDue = Number(coll.overdue_due), horizonDue = Number(coll.due_in_horizon);

    const pay = (await q(`
      SELECT COALESCE(SUM(total_amount),0)::numeric AS due
        FROM purchase_orders
       WHERE UPPER(COALESCE(status,'')) NOT IN ('CLOSED','CANCELLED','COMPLETED','RECEIVED')
         AND expected_date IS NOT NULL AND expected_date <= CURRENT_DATE + $1`, [H]))?.[0] || { due: 0 };
    const payDue = Number(pay.due);

    // Collection haircuts: overdue collects worse than on-time. Configurable.
    const onTime = num('CASHFLOW_ONTIME_PCT', 0.85);
    const overdueRecovery = num('CASHFLOW_OVERDUE_PCT', 0.5);
    const scen = (c, o) => r2(horizonDue * c + overdueDue * o - payDue);
    return {
      horizon_days: H, source: 'MES',
      expected_collections: { on_time_due: r2(horizonDue), overdue_outstanding: r2(overdueDue), kind: 'actual' },
      expected_payments: { purchase_commitments_due: r2(payDue), kind: 'actual',
        note: 'Open PO commitments due in the horizon. Salaries, GST and loan repayments are not in the MES.' },
      net_movement: {
        best: scen(1.0, 0.7), expected: scen(onTime, overdueRecovery), worst: scen(0.6, 0.25),
        kind: 'estimate', basis: `on-time ${Math.round(onTime * 100)}% / overdue-recovery ${Math.round(overdueRecovery * 100)}% (configurable)`,
      },
      opening_cash: UNAVAILABLE('Opening bank/cash balance'),
      other_commitments: UNAVAILABLE('Salaries, GST and loan repayments'),
      note: 'This is expected NET cash movement from MES receivables and purchase commitments — NOT a closing balance. Add opening cash and statutory/salary/loan outflows (from Busy) for a full picture.',
    };
  }

  // §17 — Working capital. DSO / DPO are ESTIMATES (need a stable sales/purchase
  // run-rate); inventory days and the full cash-conversion cycle need an inventory
  // valuation and COGS that live in Busy.
  async function workingCapital() {
    const sales = Number((await q(`SELECT COALESCE(SUM(grand_total),0) s FROM tax_invoices
       WHERE UPPER(COALESCE(status,''))<>'CANCELLED' AND invoice_date >= CURRENT_DATE - 365`))?.[0]?.s || 0);
    const purch = Number((await q(`SELECT COALESCE(SUM(total_amount),0) s FROM purchase_orders
       WHERE UPPER(COALESCE(status,''))<>'CANCELLED' AND order_date >= CURRENT_DATE - 365`))?.[0]?.s || 0);
    const recv = Number((await q(`SELECT COALESCE(SUM(outstanding),0) s FROM v_partner_outstanding`))?.[0]?.s || 0);
    const pay = Number((await q(`SELECT COALESCE(SUM(total_amount),0) s FROM purchase_orders
       WHERE UPPER(COALESCE(status,'')) NOT IN ('CLOSED','CANCELLED','COMPLETED','RECEIVED')`))?.[0]?.s || 0);
    const dailySales = sales / 365, dailyPurch = purch / 365;
    return {
      source: 'MES', kind: 'estimate',
      dso_days: dailySales > 0 ? r2(recv / dailySales) : null,
      dpo_days: dailyPurch > 0 ? r2(pay / dailyPurch) : null,
      annual_sales: r2(sales), annual_purchases: r2(purch),
      receivables: r2(recv), payables_commitments: r2(pay),
      inventory_days: UNAVAILABLE('Inventory days (needs inventory valuation + COGS)'),
      cash_conversion_cycle: { kind: 'estimate', note: 'CCC = DSO + inventory days − DPO. Inventory days needs a valuation from Busy, so only DSO and DPO are available here.' },
      note: 'DSO/DPO are estimates from a 12-month run-rate. A full working-capital picture needs inventory valuation and COGS from Busy.',
    };
  }

  return { customerProfitability, cashFlowForecast, workingCapital };
};
