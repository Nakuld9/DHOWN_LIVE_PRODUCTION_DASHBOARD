// Executive CFO dashboard for the CFO module (spec §4) — a single consolidated
// snapshot that pulls the headline numbers from every CFO module and the finance
// brain into one place: cash, revenue, receivables/payables, debt (Slice 1),
// budget (Slice 2), cash-flow forecast (Slice 3), profitability (Slice 4), and
// working capital. Every KPI carries its source and an availability flag; figures
// that genuinely live in Busy (gross profit, EBITDA, PBT, inventory valuation) are
// shown as "in Busy", never invented. Nothing is read from or written to Busy.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = (pool) => {
  const finance = require('./finance')(pool);
  const bankCf = require('./bank-cashflow')(pool);
  const cfo = require('./cfo-analytics')(pool);
  const loans = require('./loans')(pool, {});
  const cashflow = require('./cashflow')(pool);
  const budgets = require('./budgets')(pool);
  const prof = require('./profitability')(pool);
  let finYearShort; try { finYearShort = require('./sequences').finYearShort; } catch { finYearShort = () => '26-27'; }

  const kpi = (key, label, value, unit, source, available, note) => ({ key, label, value: value == null ? null : (unit === 'INR' || unit === 'PCT' || unit === 'DAYS' ? r2(value) : value), unit, source, available: !!available, note: note || null });

  async function snapshot() {
    const [snap, bank, wc, debt] = await Promise.all([
      finance.snapshot().catch(() => ({})),
      bankCf.bankPosition().catch(() => null),
      cfo.workingCapital().catch(() => null),
      loans.summary().catch(() => null),
    ]);

    const recv = snap.receivables || {};
    const pay = snap.payables || {};
    const sales = snap.sales || {};
    const cashReal = bank && bank.has_data;

    // Headline KPI cards (§4). Busy-only metrics are present but flagged unavailable.
    const kpis = [
      kpi('revenue_mtd', 'Revenue (month to date)', sales.month_to_date?.value ?? null, 'INR', 'MES tax invoices', sales.month_to_date != null),
      kpi('gross_profit', 'Gross profit', null, 'INR', 'Busy', false, 'Needs COGS from Busy.'),
      kpi('ebitda', 'EBITDA', null, 'INR', 'Busy', false, 'Needs the full P&L from Busy.'),
      kpi('pbt', 'Profit before tax', null, 'INR', 'Busy', false, 'Needs the full P&L from Busy.'),
      kpi('cash_bank', 'Cash & bank', cashReal ? bank.total : null, 'INR', cashReal ? `Bank feed (as of ${new Date(bank.as_of).toISOString().slice(0, 10)})` : 'Busy', cashReal, cashReal ? null : 'No bank statement loaded; cash-in-hand is in Busy.'),
      kpi('receivables', 'Total receivables', recv.total_outstanding ?? null, 'INR', 'MES customer ledger', recv.total_outstanding != null),
      kpi('overdue_receivables', 'Overdue receivables', recv.total_overdue ?? null, 'INR', 'MES customer ledger', recv.total_overdue != null),
      kpi('payables', 'Payables (open POs)', pay.total_open ?? null, 'INR', 'MES purchase orders', pay.total_open != null, 'Open purchase commitments; the supplier ledger is in Busy.'),
      kpi('net_working_capital', 'Net working capital (approx)', (recv.total_outstanding != null && pay.total_open != null) ? (recv.total_outstanding - pay.total_open) : null, 'INR', 'MES (approx)', recv.total_outstanding != null && pay.total_open != null, 'Receivables − open payables; a full figure needs inventory valuation from Busy.'),
      kpi('inventory', 'Inventory value', null, 'INR', 'Busy', false, 'Needs stock valuation from Busy.'),
      kpi('debt_outstanding', 'Debt outstanding', debt ? debt.total_outstanding : null, 'INR', 'Loan register', !!debt),
      kpi('debt_service_30d', 'Debt service (next 30 days)', debt ? debt.service_next_30d : null, 'INR', 'Loan schedules', !!debt),
    ];

    // Cash-flow forecast headline (most recent forecast, if any).
    let cashflowCard = { available: false, note: 'No cash-flow forecast set up yet.' };
    try {
      const fcs = await cashflow.list();
      if (fcs.length) {
        const fc = await cashflow.compute(fcs[0].forecast_id, { scenario: 'BASE' });
        cashflowCard = { available: true, name: fcs[0].name, horizon_weeks: fc.horizon_weeks,
          opening_cash: fc.opening_cash, min_closing: fc.summary.min_closing, closing_cash: fc.summary.closing_cash,
          weeks_below_buffer: fc.summary.weeks_below_buffer, alerts: fc.alerts.slice(0, 3), opening_source: fc.opening_source };
        kpis.push(kpi('forecast_min_cash', 'Forecast minimum cash', fc.summary.min_closing, 'INR', 'Cash-flow forecast', true, `Lowest weekly closing over ${fc.horizon_weeks} weeks.`));
      }
    } catch { /* ignore */ }

    // Budget vs actual headline (active version for the current FY).
    let budgetCard = { available: false, note: 'No budget version for the current FY yet.' };
    try {
      const fy = finYearShort();
      const versions = await budgets.listVersions();
      const active = versions.find(v => v.fy === fy && v.status === 'ACTIVE') || versions.find(v => v.fy === fy);
      if (active) {
        const v = await budgets.variance(active.version_id, 'BASE');
        const rev = v.rows.find(r => r.line_item === 'REVENUE');
        budgetCard = { available: true, version: active.name, fy, revenue_budget: rev?.budget_total ?? null, revenue_actual: rev?.actual_total ?? null, revenue_variance: rev?.variance ?? null, revenue_variance_pct: rev?.variance_pct ?? null };
      }
    } catch { /* ignore */ }

    // Profitability highlights (best/worst contribution per kg by fabric), if production exists.
    let profCard = { available: false, note: 'No production recorded yet (wire the collectors).' };
    try {
      const pr = await prof.byDimension('fabric', {});
      if (pr.has_production) {
        const withContrib = pr.rows.filter(r => r.contribution_per_kg != null);
        profCard = { available: true, total_produced_kg: pr.total_produced_kg,
          best: withContrib[0] || null, worst: withContrib.length ? withContrib[withContrib.length - 1] : null, rows: withContrib.length };
      }
    } catch { /* ignore */ }

    return {
      as_of: new Date().toISOString(),
      kpis,
      working_capital: wc ? { dso_days: wc.dso_days, dpo_days: wc.dpo_days, note: wc.note } : null,
      debt: debt || null,
      cashflow: cashflowCard,
      budget: budgetCard,
      profitability: profCard,
      busy_gap: 'Gross profit, EBITDA, PBT, inventory valuation and cash-in-hand come from Busy and are shown as unavailable until the Busy read bridge is connected. Everything else is live MES data.',
    };
  }

  return { snapshot };
};
