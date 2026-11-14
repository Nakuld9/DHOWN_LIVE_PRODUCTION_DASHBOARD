// Finance intelligence service for the AI Accountant (Phase 0 — MES data only).
//
// This computes the financial picture from what the MES actually knows:
// receivables (from the customer ledger), open purchase commitments, sales
// invoiced, collections received, and output GST. It is deterministic — the AI
// reads THROUGH these functions and never computes money itself.
//
// HONESTY CONTRACT (spec §32): figures that live only in BUSY — bank/cash
// balances, the supplier ledger, input GST/ITC, posted P&L — are NOT in the MES.
// Those are returned as { available: false, source: 'BUSY' } with a note, never
// invented. Every returned figure is tagged actual | estimate | unavailable.
//
// When the Busy read bridge exists (Phase 1), the unavailable fields get filled
// from Busy; nothing else here has to change.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const UNAVAILABLE_BUSY = (what) => ({ available: false, source: 'BUSY', kind: 'unavailable',
  note: `${what} lives in Busy (the book of accounts), not the MES. Needs the Busy read bridge.` });

module.exports = (pool, { payments, gstr1 } = {}) => {
  const pay = payments || require('./payments')(pool);
  const gst = gstr1 || require('./gstr1')(pool);
  const busy = require('./busy-bridge')(pool);
  const bankFeed = require('./bank-cashflow')(pool);

  // Fill an "In Busy" field from the mirror when it has been imported, else keep
  // it unavailable — never invented.
  const fromBusy = async (getter, shape, what) => {
    try { const v = await getter(); return v ? { available: true, source: 'BUSY', kind: 'actual', ...shape(v) } : UNAVAILABLE_BUSY(what); }
    catch { return UNAVAILABLE_BUSY(what); }
  };

  // Money in vs out for a day (default today). Collections are ACTUAL (MES records
  // customer receipts). Outgoing supplier payments and true bank/cash balances are
  // Busy's — reported as unavailable, not guessed.
  async function cashPosition({ date } = {}) {
    const d = date || null;
    const coll = (await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n
         FROM payments
        WHERE COALESCE(status,'ACTIVE') <> 'CANCELLED'
          AND payment_date::date = COALESCE($1::date, CURRENT_DATE)`, [d])).rows[0];
    // Bank balance + money in/out now come from the ACTUAL bank statement feed
    // (H2H ingestion) when any statement has been loaded — real bank data, tagged
    // with the date of the latest statement so a stale feed reads as stale. Only
    // when no statement exists do we fall back to Busy's (unavailable) figure. The
    // physical cash-in-hand balance a statement cannot know stays Busy's.
    let bank_balance, bank_movements_7d = null;
    try {
      const [pos, mv] = await Promise.all([bankFeed.bankPosition(), bankFeed.movements({ days: 7 })]);
      if (pos.has_data) {
        bank_balance = {
          available: true, source: 'BANK', kind: 'actual', value: pos.total, as_of: pos.as_of,
          accounts: pos.accounts.filter(a => a.lines > 0).map(a => ({ name: a.name, balance: a.balance, as_of: a.last_statement, stale_days: a.stale_days })),
          note: pos.stalest_days > 3 ? `From loaded bank statements; latest ${pos.stalest_days} day(s) old — load a newer statement to refresh.` : 'From loaded bank statements.',
        };
        bank_movements_7d = { available: true, source: 'BANK', kind: 'actual', money_in: mv.money_in, money_out: mv.money_out, in_count: mv.in_count, out_count: mv.out_count };
      }
    } catch { /* fall through to Busy */ }
    if (!bank_balance) bank_balance = await fromBusy(() => busy.bankBalance(), (v) => ({ value: v.total, as_of: v.as_of, accounts: v.accounts }), 'Bank balance');

    return {
      date: d || 'today',
      collections_today: { value: r2(coll.total), count: Number(coll.n), kind: 'actual', source: 'MES' },
      payments_today: UNAVAILABLE_BUSY('Supplier/other outgoing payments'),
      bank_balance,
      bank_movements_7d,
      cash_balance: UNAVAILABLE_BUSY('Cash balance'),
    };
  }

  // Receivables ageing — ACTUAL, straight from the customer ledger view.
  async function receivables() {
    const rows = await pay.ageingReport();
    const sum = (k) => r2(rows.reduce((s, x) => s + Number(x[k] || 0), 0));
    return {
      kind: 'actual', source: 'MES',
      total_outstanding: sum('outstanding'),
      total_overdue: sum('overdue'),
      buckets: {
        current: sum('current'), d1_30: sum('d1_30'), d31_60: sum('d31_60'),
        d61_90: sum('d61_90'), d90_plus: sum('d90_plus'),
      },
      customers: rows.slice(0, 25),
      customer_count: rows.length,
    };
  }

  // Payables = OPEN purchase commitments recorded as POs in the MES. This is not
  // the supplier ledger balance (that is Busy's) — labelled as such so no one
  // reads it as the amount actually owed on the books.
  async function payables() {
    const rows = (await pool.query(
      `SELECT po_id, po_number, supplier_name, order_date, expected_date, status,
              COALESCE(total_amount,0) AS amount
         FROM purchase_orders
        WHERE UPPER(COALESCE(status,'')) NOT IN ('CLOSED','CANCELLED','COMPLETED','RECEIVED')
        ORDER BY expected_date NULLS LAST, order_date`)).rows;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = rows.filter(x => x.expected_date && String(x.expected_date).slice(0, 10) < today);
    const dueWeek = rows.filter(x => x.expected_date && String(x.expected_date).slice(0, 10) >= today
      && String(x.expected_date).slice(0, 10) <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
    const total = (a) => r2(a.reduce((s, x) => s + Number(x.amount), 0));
    return {
      kind: 'actual', source: 'MES',
      basis: 'Open purchase commitments (MES purchase orders). Supplier ledger balances are in Busy.',
      total_open: total(rows), open_count: rows.length,
      overdue_amount: total(overdue), overdue_count: overdue.length,
      due_this_week: total(dueWeek), due_this_week_count: dueWeek.length,
      orders: rows.slice(0, 25),
      supplier_ledger: await fromBusy(() => busy.payablesTotal(), (v) => ({ total: v.total, overdue: v.overdue, as_of: v.as_of, suppliers: v.suppliers }), 'Actual supplier ledger balances'),
    };
  }

  // Sales invoiced — ACTUAL, from tax invoices. Yesterday + month-to-date.
  async function salesSummary() {
    const q = (whereDate) => pool.query(
      `SELECT COALESCE(SUM(grand_total),0) AS amt, COALESCE(SUM(taxable_value),0) AS taxable, COUNT(*) AS n
         FROM tax_invoices
        WHERE UPPER(COALESCE(status,'')) <> 'CANCELLED' AND ${whereDate}`);
    const [today, yest, mtd] = await Promise.all([
      q(`invoice_date::date = CURRENT_DATE`),
      q(`invoice_date::date = CURRENT_DATE - 1`),
      q(`date_trunc('month', invoice_date) = date_trunc('month', CURRENT_DATE)`),
    ]);
    const shape = (row) => ({ value: r2(row.rows[0].amt), taxable: r2(row.rows[0].taxable), invoices: Number(row.rows[0].n) });
    return { kind: 'actual', source: 'MES', today: shape(today), yesterday: shape(yest), month_to_date: shape(mtd) };
  }

  // Purchases ordered — from POs. Labelled as ORDERED value, not received/booked
  // (GRN-based actuals and the purchase ledger are Busy's once the bridge exists).
  async function purchaseSummary() {
    const q = (whereDate) => pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS amt, COUNT(*) AS n
         FROM purchase_orders
        WHERE UPPER(COALESCE(status,'')) <> 'CANCELLED' AND ${whereDate}`);
    const [yest, mtd] = await Promise.all([
      q(`order_date::date = CURRENT_DATE - 1`),
      q(`date_trunc('month', order_date) = date_trunc('month', CURRENT_DATE)`),
    ]);
    const shape = (row) => ({ value: r2(row.rows[0].amt), orders: Number(row.rows[0].n) });
    return { kind: 'actual', source: 'MES', basis: 'Purchase ORDER value (not GRN-booked).',
      yesterday: shape(yest), month_to_date: shape(mtd),
      purchase_ledger: UNAVAILABLE_BUSY('Booked purchases / input tax') };
  }

  // GST — output tax is ACTUAL (from sales invoices, via the GSTR-1 summary).
  // Input tax / ITC and the net payable are Busy's, so the net liability is an
  // ESTIMATE clearly marked as output-only until the Busy bridge supplies ITC.
  async function gstSummary() {
    let output = null;
    try {
      const s = await gst.summary({});
      const t = s.totals || {};
      output = { taxable: r2(t.taxable), cgst: r2(t.cgst), sgst: r2(t.sgst), igst: r2(t.igst),
        total: r2((t.cgst || 0) + (t.sgst || 0) + (t.igst || 0)) };
    } catch { output = null; }
    // If Busy's trial balance is mirrored, we can show real ITC and a net figure.
    const busyGst = await busy.gstFromTrialBalance().catch(() => null);
    return {
      output_tax: output ? { ...output, kind: 'actual', source: 'MES (sales invoices)' }
        : { kind: 'unavailable', note: 'No sales-tax data for this period.' },
      input_tax_itc: busyGst ? { value: busyGst.input_itc, kind: 'actual', source: 'BUSY (trial balance)' }
        : UNAVAILABLE_BUSY('Input GST / ITC on purchases'),
      net_liability: busyGst
        ? { value: busyGst.net, kind: 'actual', source: 'BUSY (trial balance)', note: 'Output − ITC from the Busy trial balance. Confirm against the GST portal before filing.' }
        : { kind: 'estimate', note: 'Net GST = output − ITC. ITC is in Busy, so only output tax is known here; treat as an upper bound, not the filed liability.' },
    };
  }

  // One combined snapshot for the AI Accountant dashboard / daily report.
  async function snapshot() {
    const [cash, recv, pay_, sales, purch, gstx] = await Promise.all([
      cashPosition({}), receivables(), payables(), salesSummary(), purchaseSummary(), gstSummary(),
    ]);
    return {
      as_of: new Date().toISOString(),
      cash, receivables: recv, payables: pay_, sales, purchases: purch, gst: gstx,
      note: 'Phase 0: computed from MES data. Bank/cash balances, supplier ledger and ITC come from Busy and are marked unavailable until the Busy read bridge is connected.',
    };
  }

  return { cashPosition, receivables, payables, salesSummary, purchaseSummary, gstSummary, snapshot };
};
