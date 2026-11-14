// AI Accountant read tools — the finance facts the accountant/CFO agents may look
// up. All read-only, all served through the deterministic finance service (which
// itself reads MES tables), so the agent reports only what the system knows.
//
// Every tool is gated SUPERVISOR+ (financial data). The service tags each figure
// actual | estimate | unavailable, and marks anything that lives only in Busy as
// unavailable — so the agent, following its answer rules, never invents a balance.

module.exports = function registerFinanceTools(registry, { pool }) {
  const finance = require('../../lib/finance')(pool);

  const R = 'SUPERVISOR';

  registry.register({
    name: 'get_cash_position',
    description: "Today's money in/out: customer collections received (actual, MES). Bank/cash balances and outgoing supplier payments are in Busy and come back marked unavailable. Args: {date?: 'YYYY-MM-DD'}",
    minRole: R,
    handler: async ({ date } = {}) => finance.cashPosition({ date }),
  });

  registry.register({
    name: 'get_receivables',
    description: 'Customer receivables: total outstanding, total overdue, ageing buckets (current/1-30/31-60/61-90/90+), and the top customers by overdue. Actual, from the MES customer ledger.',
    minRole: R,
    handler: async () => finance.receivables(),
  });

  registry.register({
    name: 'get_payables',
    description: 'Open purchase commitments from MES purchase orders: total open, overdue, and due this week. NOT the supplier ledger balance (that is in Busy). Args: {}',
    minRole: R,
    handler: async () => finance.payables(),
  });

  registry.register({
    name: 'get_sales_summary',
    description: 'Sales invoiced (actual, from tax invoices): today, yesterday, and month-to-date — value, taxable value and invoice count.',
    minRole: R,
    handler: async () => finance.salesSummary(),
  });

  registry.register({
    name: 'get_purchase_summary',
    description: 'Purchases ordered (from POs): yesterday and month-to-date order value. Booked purchases/input tax live in Busy.',
    minRole: R,
    handler: async () => finance.purchaseSummary(),
  });

  registry.register({
    name: 'get_gst_summary',
    description: 'GST position: output tax from sales invoices (actual). Input tax/ITC and the net filed liability are in Busy — only output tax is known here, treat net as an upper-bound estimate. Args: {}',
    minRole: R,
    handler: async () => finance.gstSummary(),
  });

  registry.register({
    name: 'get_finance_snapshot',
    description: 'One combined finance snapshot for a management brief: cash-in, receivables, payables, sales, purchases and GST — each figure tagged actual/estimate/unavailable. Use for "finance overview / how are we doing financially".',
    minRole: R,
    handler: async () => finance.snapshot(),
  });

  const anomaly = require('../../lib/anomaly')({ pool });
  registry.register({
    name: 'get_anomalies',
    description: 'Financial items that need review: duplicate invoices/payments, backdated entries, round-number values, customers past credit terms, negative stock. Returns counts by severity + the items. Use for "find duplicate invoices / unusual transactions / anything suspicious". These are items to REVIEW, never accusations.',
    minRole: R,
    handler: async () => anomaly.summary(),
  });

  const report = require('../../lib/finance-report')({ pool });
  registry.register({
    name: 'get_finance_report',
    description: "The latest DHOWN daily finance report (cash, receivables, payables, sales, GST, alerts, and the day's top recommended actions). Use for 'daily finance report' / 'what needs attention today'.",
    minRole: R,
    handler: async () => (await report.latest()) || report.build(),
  });

  const cfo = require('../../lib/cfo-analytics')(pool);
  registry.register({
    name: 'get_customer_profitability',
    description: 'Customers ranked by net revenue (last 12m) with returns, outstanding, overdue and collection quality. Revenue is actual; true product-cost contribution needs the costing link and is stated as a gap, not invented. Args: {limit?}',
    minRole: R,
    handler: async ({ limit } = {}) => cfo.customerProfitability({ limit }),
  });
  registry.register({
    name: 'get_cashflow_forecast',
    description: 'Expected NET cash movement over the next N days (best/expected/worst) from receivables due and purchase commitments. NOT a closing balance — opening cash and salary/GST/loans are in Busy. Args: {days?: 7|30|90}',
    minRole: R,
    handler: async ({ days } = {}) => cfo.cashFlowForecast({ days }),
  });
  registry.register({
    name: 'get_working_capital',
    description: 'Working-capital metrics: DSO, DPO (estimates from a 12-month run-rate), receivables and payables. Inventory days and full CCC need Busy. Args: {}',
    minRole: R,
    handler: async () => cfo.workingCapital(),
  });

  const tds = require('../../lib/tds-monitor')(pool);
  registry.register({
    name: 'get_tds_monitor',
    description: 'TDS heads-up (§11): job-work vendors whose value this financial year crosses the 194C thresholds. A "confirm with your CA" flag from MES job-work value only — NOT tax advice or a statutory determination, and it cannot see what was already deducted (that is in Busy). Args: {}',
    minRole: R,
    handler: async () => tds.review(),
  });

  const supplier = require('../../lib/supplier-intel')(pool);
  registry.register({
    name: 'get_supplier_intel',
    description: 'Supplier price intelligence: yarn price increases/decreases per supplier vs their own history, plus 12-month purchase volume ranking. Use for "which suppliers raised prices" / "top suppliers". Supplier ledger balances are in Busy. Args: {}',
    minRole: R,
    handler: async () => supplier.summary(),
  });
};
