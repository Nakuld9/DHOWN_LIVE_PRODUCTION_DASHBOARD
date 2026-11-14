// Bank cash-flow for the AI Accountant — reads the PERSISTED H2H statement feed.
//
// Phase 0's finance brain had to mark bank/cash balances "in Busy (not in MES)"
// because the MES genuinely did not know them. Now that real bank statements are
// ingested (bank-statement-files.js → bank_statement_lines), the actual bank
// balance, money in/out, and the reconciliation gap ARE knowable from real bank
// data — not from Busy's derived ledger. This exposes them honestly:
//   - a figure is ACTUAL bank data, tagged with the date of the last statement
//     loaded (as_of), so a stale feed reads as stale rather than as truth.
//   - it is still read-only: it reports; it never posts, pays, or touches Busy.
//
// The physical CASH-in-hand balance stays Busy's — a bank statement cannot know it.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = (pool) => {

  // Per-account balance = opening balance + every credit − every debit. A
  // cash-credit / overdraft account legitimately comes out negative.
  async function bankPosition() {
    const rows = (await pool.query(`
      SELECT a.account_id, a.account_name, a.bank_name, a.opening_balance,
             COALESCE(SUM(l.credit),0) AS cr, COALESCE(SUM(l.debit),0) AS dr,
             MAX(l.txn_date) AS last_txn, COUNT(l.line_id)::int AS lines
        FROM bank_accounts a
        LEFT JOIN bank_statement_lines l ON l.account_id = a.account_id
       WHERE COALESCE(a.is_active, true) = true
       GROUP BY a.account_id
       ORDER BY a.account_name`)).rows;
    const accounts = rows.map(a => ({
      account_id: a.account_id, name: a.account_name, bank: a.bank_name || null,
      balance: r2(Number(a.opening_balance) + Number(a.cr) - Number(a.dr)),
      last_statement: a.last_txn, lines: a.lines,
      stale_days: a.last_txn ? Math.floor((Date.now() - new Date(a.last_txn).getTime()) / 864e5) : null,
    }));
    const withData = accounts.filter(a => a.lines > 0);
    const as_of = withData.reduce((m, a) => (a.last_statement && (!m || a.last_statement > m) ? a.last_statement : m), null);
    return {
      accounts, total: r2(accounts.reduce((s, a) => s + a.balance, 0)),
      has_data: withData.length > 0, accounts_with_data: withData.length, as_of,
      stalest_days: withData.reduce((m, a) => Math.max(m, a.stale_days || 0), 0),
    };
  }

  // Money in/out over the last N days of LOADED statement data (not "today" —
  // the feed is periodic, so a dated window is the honest unit).
  async function movements({ days = 7 } = {}) {
    const d = Math.max(1, Math.min(Number(days) || 7, 180));
    const q = (await pool.query(`
      SELECT COALESCE(SUM(credit),0) AS cr, COALESCE(SUM(debit),0) AS dr,
             COUNT(*) FILTER (WHERE credit > 0)::int AS in_n,
             COUNT(*) FILTER (WHERE debit  > 0)::int AS out_n,
             MAX(txn_date) AS last_txn
        FROM bank_statement_lines
       WHERE txn_date >= CURRENT_DATE - $1::int`, [d])).rows[0];
    return { window_days: d, money_in: r2(q.cr), money_out: r2(q.dr), in_count: Number(q.in_n), out_count: Number(q.out_n), last_txn: q.last_txn };
  }

  // The reconciliation gap, straight from the feed:
  //   - bank credits with no receipt matched → money arrived, not yet recorded.
  //   - recorded receipts (recent) with no bank line → money we think we have.
  async function exceptions({ recentDays = 60 } = {}) {
    const d = Math.max(1, Math.min(Number(recentDays) || 60, 365));
    const credits = (await pool.query(`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(l.credit),0) AS amt
        FROM bank_statement_lines l
       WHERE l.credit > 0
         AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_matches m WHERE m.line_id = l.line_id)`)).rows[0];
    const receipts = (await pool.query(`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(p.amount),0) AS amt
        FROM payments p
       WHERE COALESCE(p.status,'ACTIVE') <> 'CANCELLED'
         AND p.payment_date >= CURRENT_DATE - $1::int
         AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_matches m WHERE m.payment_id = p.payment_id)`, [d])).rows[0];
    return {
      bank_credits_unreconciled: { count: Number(credits.n), amount: r2(credits.amt) },
      receipts_unreconciled: { count: Number(receipts.n), amount: r2(receipts.amt), window_days: d },
    };
  }

  // One combined read for the dashboard / daily report.
  async function summary() {
    const [position, mv, exc] = await Promise.all([bankPosition(), movements({ days: 7 }), exceptions({})]);
    return { position, movements: mv, exceptions: exc };
  }

  return { bankPosition, movements, exceptions, summary };
};
