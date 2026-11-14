// Financial dashboard — receivables, collections and credit exposure.
//
// The figures already existed, scattered: ageing on the receipts screen, credit
// limits on the partner record, payments in a list. What nobody could see was
// the three together, which is the view that answers the only questions asked
// on a Monday morning — how much is owed, how much came in, and who is over
// their limit.
//
// Everything reads the same views the credit gate reads (v_invoice_balances,
// v_partner_outstanding), so the dashboard cannot tell a happier story than the
// gate that blocks orders. A dashboard with its own arithmetic would eventually
// disagree with the screen the operator is standing in front of.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = (pool) => {

  // Money received in a window, and what it was applied to.
  async function collections({ from, to }) {
    const t = (await pool.query(
      `SELECT COUNT(*)::int AS receipts,
              COALESCE(SUM(amount),0) AS received,
              COALESCE(SUM(allocated),0) AS applied
         FROM (
           SELECT pm.amount,
                  COALESCE((SELECT SUM(amount) FROM payment_allocations pa
                             WHERE pa.payment_id = pm.payment_id),0) AS allocated
             FROM payments pm
            WHERE pm.status='ACTIVE'
              AND ($1::date IS NULL OR pm.payment_date >= $1::date)
              AND ($2::date IS NULL OR pm.payment_date <= $2::date)
         ) x`, [from, to])).rows[0];

    const byMode = (await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(mode),''),'Unspecified') AS mode,
              COUNT(*)::int AS receipts, COALESCE(SUM(amount),0) AS amount
         FROM payments
        WHERE status='ACTIVE'
          AND ($1::date IS NULL OR payment_date >= $1::date)
          AND ($2::date IS NULL OR payment_date <= $2::date)
        GROUP BY 1 ORDER BY amount DESC`, [from, to])).rows
      .map(x => ({ mode: x.mode, receipts: Number(x.receipts), amount: r2(x.amount) }));

    return {
      receipts: Number(t.receipts),
      received: r2(t.received),
      applied: r2(t.applied),
      // Money in the bank that is not yet against an invoice. Not an error —
      // advances are routine here — but it overstates outstanding until applied.
      on_account: r2(Number(t.received) - Number(t.applied)),
      by_mode: byMode,
    };
  }

  // Twelve months of invoiced-vs-collected, for trend.
  async function monthly(months = 12) {
    const rows = (await pool.query(
      `WITH m AS (
         SELECT date_trunc('month', CURRENT_DATE) - (n || ' months')::interval AS mth
           FROM generate_series(0, $1::int - 1) n
       )
       SELECT to_char(m.mth, 'YYYY-MM') AS month,
              COALESCE((SELECT SUM(grand_total) FROM tax_invoices ti
                         WHERE ti.status <> 'CANCELLED'
                           AND date_trunc('month', ti.invoice_date) = m.mth),0) AS invoiced,
              COALESCE((SELECT SUM(amount) FROM payments pm
                         WHERE pm.status='ACTIVE'
                           AND date_trunc('month', pm.payment_date) = m.mth),0) AS collected
         FROM m ORDER BY m.mth`, [months])).rows;
    return rows.map(x => ({ month: x.month, invoiced: r2(x.invoiced), collected: r2(x.collected) }));
  }

  // Who owes what, against what they are allowed to owe.
  async function exposure({ limit = 10 } = {}) {
    const rows = (await pool.query(
      `SELECT p.partner_id, p.company_name, p.credit_limit, p.credit_days,
              COALESCE(o.outstanding,0) AS outstanding,
              COALESCE(o.overdue,0)     AS overdue,
              COALESCE(o.oldest_overdue_days,0) AS oldest_overdue_days,
              COALESCE(o.open_invoices,0)::int  AS open_invoices
         FROM partners p
         JOIN v_partner_outstanding o ON o.partner_id = p.partner_id
        WHERE COALESCE(o.outstanding,0) > 0.009
        ORDER BY o.outstanding DESC`)).rows;

    const shape = (x) => {
      const lim = Number(x.credit_limit) || 0;
      const out = r2(x.outstanding);
      return {
        partner_id: x.partner_id, company_name: x.company_name,
        credit_limit: r2(lim), credit_days: Number(x.credit_days) || 0,
        outstanding: out, overdue: r2(x.overdue),
        oldest_overdue_days: Number(x.oldest_overdue_days),
        open_invoices: Number(x.open_invoices),
        // No limit set is not the same as a limit of zero. Reporting 0 as
        // "infinitely over limit" would bury the customers who really are.
        utilisation: lim > 0 ? Math.round((out / lim) * 100) : null,
        over_limit: lim > 0 && out > lim + 0.009,
      };
    };

    const all = rows.map(shape);
    return {
      top_debtors: all.slice(0, limit),
      over_limit: all.filter(x => x.over_limit),
      no_limit_set: all.filter(x => x.credit_limit <= 0).length,
      customers_owing: all.length,
    };
  }

  async function overview({ from = null, to = null } = {}) {
    // Receivables as a whole, from the same view the credit gate uses.
    const ag = (await pool.query(
      `SELECT COALESCE(SUM(outstanding),0) AS outstanding,
              COALESCE(SUM(overdue),0)     AS overdue,
              COALESCE(SUM(current_amt),0) AS current_amt,
              COALESCE(SUM(bucket_1_30),0) AS d1_30,
              COALESCE(SUM(bucket_31_60),0) AS d31_60,
              COALESCE(SUM(bucket_61_90),0) AS d61_90,
              COALESCE(SUM(bucket_90_plus),0) AS d90_plus,
              COALESCE(SUM(open_invoices),0)::int AS open_invoices
         FROM v_partner_outstanding`)).rows[0];

    // Unapplied money across the book — invisible on the ageing report, because
    // that only lists customers who owe.
    const unapplied = (await pool.query(
      `SELECT COALESCE(SUM(pm.amount - COALESCE(a.alloc,0)),0) AS total
         FROM payments pm
         LEFT JOIN LATERAL (SELECT SUM(amount) alloc FROM payment_allocations pa
                             WHERE pa.payment_id = pm.payment_id) a ON true
        WHERE pm.status='ACTIVE'`)).rows[0];

    const [coll, trend, exp] = await Promise.all([
      collections({ from, to }),
      monthly(12),
      exposure({ limit: 10 }),
    ]);

    const outstanding = r2(ag.outstanding);
    const overdue = r2(ag.overdue);

    // Days Sales Outstanding, approximated over the last 90 days of invoicing.
    // Called out as an approximation because a mill's sales are lumpy and a
    // single slow month moves it a long way — it is a trend line, not a KPI to
    // manage to.
    const sales90 = Number((await pool.query(
      `SELECT COALESCE(SUM(grand_total),0) v FROM tax_invoices
        WHERE status <> 'CANCELLED' AND invoice_date >= CURRENT_DATE - 90`)).rows[0].v);
    const dso = sales90 > 0 ? Math.round((outstanding / sales90) * 90) : null;

    return {
      period: { from, to },
      receivables: {
        outstanding, overdue,
        not_overdue: r2(outstanding - overdue),
        open_invoices: Number(ag.open_invoices),
        overdue_pct: outstanding > 0 ? Math.round((overdue / outstanding) * 100) : 0,
        ageing: {
          current: r2(ag.current_amt), d1_30: r2(ag.d1_30), d31_60: r2(ag.d31_60),
          d61_90: r2(ag.d61_90), d90_plus: r2(ag.d90_plus),
        },
        unapplied_credit: r2(unapplied.total),
        dso_days: dso,
      },
      collections: coll,
      exposure: exp,
      trend,
    };
  }

  return { overview, collections, monthly, exposure };
};
