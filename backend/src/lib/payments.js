// Payments, allocation and ageing.
//
// Outstanding used to be "sum of invoices whose status is ISSUED", so an invoice
// was either wholly unpaid or wholly paid. A customer paying ₹50,000 against a
// ₹200,000 invoice could not be recorded, ageing was approximate, and the credit
// gate blocked customers who had in fact paid most of what they owed.
//
// Money is handled in a transaction throughout, and an allocation can never
// exceed either the payment or the invoice balance — over-allocation would
// silently manufacture money.

const obs = require('./observability');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = (pool, { nextInvSeq } = {}) => {

  // db defaults to the pool, but callers inside a transaction MUST pass their
  // client. This runs in the middle of record()'s transaction, and taking a
  // second connection there while holding one is what deadlocked the pool —
  // worse than the version in the return value, because it happens before
  // COMMIT while the advisory lock is held.
  async function receiptNo(db = pool) {
    // The shared nextInvSeq helper uses its own pool handle, so it cannot be
    // used from inside a transaction. The same numbering is done here on the
    // caller's connection.
    const yr = new Date().getFullYear();
    const r = await db.query(
      `SELECT receipt_no FROM payments WHERE receipt_no LIKE $1 ORDER BY receipt_no DESC LIMIT 1`,
      [`RCP-${yr}-%`]);
    if (!r.rows.length) return `RCP-${yr}-001`;
    const n = parseInt(String(r.rows[0].receipt_no).split('-').pop(), 10) + 1;
    return `RCP-${yr}-${String(n).padStart(3, '0')}`;
  }

  // Open invoices oldest first — the order money should be applied in.
  async function openInvoices(partnerId) {
    const r = await pool.query(
      `SELECT invoice_id, invoice_number, invoice_date, due_date, grand_total,
              allocated, balance, days_overdue
         FROM v_invoice_balances
        WHERE partner_id = $1 AND balance > 0.009
        ORDER BY invoice_date, invoice_id`, [partnerId]);
    return r.rows.map(x => ({ ...x, grand_total: r2(x.grand_total), allocated: r2(x.allocated), balance: r2(x.balance) }));
  }

  async function outstanding(partnerId) {
    const r = await pool.query(`SELECT * FROM v_partner_outstanding WHERE partner_id = $1`, [partnerId]);
    const o = r.rows[0];
    if (!o) {
      return { outstanding: 0, overdue: 0, open_invoices: 0, oldest_overdue_days: 0,
               ageing: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 } };
    }
    return {
      outstanding: r2(o.outstanding), overdue: r2(o.overdue),
      open_invoices: Number(o.open_invoices), oldest_overdue_days: Number(o.oldest_overdue_days),
      ageing: {
        current: r2(o.current_amt), d1_30: r2(o.bucket_1_30), d31_60: r2(o.bucket_31_60),
        d61_90: r2(o.bucket_61_90), d90_plus: r2(o.bucket_90_plus),
      },
    };
  }

  // Record money received. `allocations` may be supplied explicitly, or auto=true
  // applies it oldest-invoice-first, which is what a mill actually does.
  async function record({ partner_id, amount, payment_date, mode, reference, bank, notes,
                          allocations, auto = true, created_by }) {
    const amt = r2(amount);
    if (!partner_id) return { error: 'partner_id is required', code: 400 };
    if (!(amt > 0)) return { error: 'amount must be positive', code: 400 };

    let result;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialise per customer so two receipts cannot both allocate the same
      // invoice balance and over-apply it.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`pay:${partner_id}`]);

      const pay = await client.query(
        `INSERT INTO payments (receipt_no, partner_id, amount, payment_date, mode, reference, bank, notes, created_by)
         VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9) RETURNING *`,
        [await receiptNo(client), partner_id, amt, payment_date || null, mode || null,
         reference || null, bank || null, notes || null, created_by || null]);
      const paymentId = pay.rows[0].payment_id;

      let remaining = amt;
      const applied = [];

      const targets = Array.isArray(allocations) && allocations.length
        ? allocations
        : (auto ? (await client.query(
            `SELECT invoice_id, balance FROM v_invoice_balances
              WHERE partner_id=$1 AND balance > 0.009 ORDER BY invoice_date, invoice_id`,
            [partner_id])).rows.map(x => ({ invoice_id: x.invoice_id, amount: null }))
          : []);

      for (const t of targets) {
        if (remaining <= 0.009) break;
        const bal = await client.query(
          `SELECT balance FROM v_invoice_balances WHERE invoice_id=$1 AND partner_id=$2`,
          [t.invoice_id, partner_id]);
        if (!bal.rows.length) continue;
        const invoiceBalance = r2(bal.rows[0].balance);
        if (invoiceBalance <= 0.009) continue;

        // Never allocate more than the invoice owes or the payment holds.
        const want = t.amount != null ? r2(t.amount) : invoiceBalance;
        const use = r2(Math.min(want, invoiceBalance, remaining));
        if (use <= 0.009) continue;

        await client.query(
          `INSERT INTO payment_allocations (payment_id, invoice_id, amount, allocated_by)
           VALUES ($1,$2,$3,$4)`, [paymentId, t.invoice_id, use, created_by || null]);
        remaining = r2(remaining - use);
        applied.push({ invoice_id: t.invoice_id, amount: use });
      }

      // Keep invoice status consistent with the balance, so existing screens that
      // still read status are not left showing 'ISSUED' on a settled invoice.
      await client.query(
        `UPDATE tax_invoices ti SET status='PAID'
          WHERE ti.partner_id=$1 AND ti.status='ISSUED'
            AND (SELECT balance FROM v_invoice_balances b WHERE b.invoice_id=ti.invoice_id) <= 0.009`,
        [partner_id]);

      await client.query('COMMIT');
      obs.inc('payments_recorded_total');

      // Deliberately NOT `outstanding: await outstanding(...)` inside this
      // return. That call needs a connection of its own, and a return expression
      // is evaluated before `finally` releases this one — so at concurrency
      // equal to the pool size every request ended up holding a connection while
      // waiting for one that could never come. The pool deadlocked and the whole
      // application froze, not only payments. Measured: 20 concurrent receipts
      // took 305 seconds and all 20 failed.
      result = { payment: pay.rows[0], allocated: applied, unallocated: remaining };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }

    // Safe now: the transaction's connection is back in the pool.
    result.outstanding = await outstanding(partner_id);
    return result;
  }

  // Money paid in advance, or an overpayment, stays unallocated on the payment
  // rather than being forced onto an invoice that did not exist yet. Advances
  // are routine here, so that credit has to be applyable later — otherwise the
  // customer's outstanding stays overstated and the credit gate blocks someone
  // who has already paid.
  async function creditOnAccount(partnerId) {
    const r = await pool.query(
      `SELECT pm.payment_id, pm.receipt_no, pm.payment_date,
              pm.amount - COALESCE((SELECT SUM(amount) FROM payment_allocations pa
                                     WHERE pa.payment_id = pm.payment_id), 0) AS unallocated
         FROM payments pm
        WHERE pm.partner_id = $1 AND pm.status = 'ACTIVE'
        ORDER BY pm.payment_date, pm.payment_id`, [partnerId]);
    const rows = r.rows.filter(x => Number(x.unallocated) > 0.009)
                       .map(x => ({ ...x, unallocated: r2(x.unallocated) }));
    return { total: r2(rows.reduce((s, x) => s + x.unallocated, 0)), payments: rows };
  }

  // Apply on-account credit to open invoices, oldest first. Same locking and
  // same clamping as record() — an allocation still cannot exceed the invoice
  // balance or what the payment actually has left.
  async function applyCredit(partnerId, { by } = {}) {
    let applyResult;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`pay:${partnerId}`]);

      const creds = (await client.query(
        `SELECT pm.payment_id,
                pm.amount - COALESCE((SELECT SUM(amount) FROM payment_allocations pa
                                       WHERE pa.payment_id = pm.payment_id), 0) AS left_over
           FROM payments pm
          WHERE pm.partner_id = $1 AND pm.status = 'ACTIVE'
          ORDER BY pm.payment_date, pm.payment_id`, [partnerId]
      )).rows.filter(x => Number(x.left_over) > 0.009);

      const applied = [];
      for (const c of creds) {
        let left = r2(c.left_over);
        const invoices = (await client.query(
          `SELECT invoice_id, balance FROM v_invoice_balances
            WHERE partner_id = $1 AND balance > 0.009
            ORDER BY invoice_date, invoice_id`, [partnerId])).rows;

        for (const inv of invoices) {
          if (left <= 0.009) break;
          const use = r2(Math.min(left, r2(inv.balance)));
          if (use <= 0.009) continue;
          await client.query(
            `INSERT INTO payment_allocations (payment_id, invoice_id, amount, allocated_by)
             VALUES ($1,$2,$3,$4)`, [c.payment_id, inv.invoice_id, use, by || null]);
          left = r2(left - use);
          applied.push({ payment_id: c.payment_id, invoice_id: inv.invoice_id, amount: use });
        }
      }

      await client.query(
        `UPDATE tax_invoices ti SET status='PAID'
          WHERE ti.partner_id=$1 AND ti.status='ISSUED'
            AND (SELECT balance FROM v_invoice_balances b WHERE b.invoice_id=ti.invoice_id) <= 0.009`,
        [partnerId]);

      await client.query('COMMIT');
      // Same reason as record(): these two reads each need their own connection,
      // so they must not run while this one is still checked out.
      applyResult = { applied };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }

    applyResult.outstanding = await outstanding(partnerId);
    applyResult.credit = await creditOnAccount(partnerId);
    return applyResult;
  }

  // Cancelling reverses the allocation too. The payment row is kept — cancelled,
  // never deleted — because a receipt that was issued has to stay auditable, but
  // its allocations are removed. Leaving them would mean payment_allocations no
  // longer sums to money actually received, and any report built on that table
  // later would quietly overstate collections.
  async function cancel(paymentId, { by, reason } = {}) {
    const r = await pool.query(
      `UPDATE payments SET status='CANCELLED', cancelled_by=$2, cancelled_at=NOW(),
              notes=COALESCE(notes,'') || ' [cancelled: ' || COALESCE($3,'no reason') || ']'
        WHERE payment_id=$1 AND status='ACTIVE' RETURNING *`,
      [paymentId, by || null, reason || null]);
    if (!r.rows.length) return { error: 'Payment not found or already cancelled', code: 404 };

    await pool.query(`DELETE FROM payment_allocations WHERE payment_id=$1`, [paymentId]);

    // An invoice that was settled by this payment is open again.
    await pool.query(
      `UPDATE tax_invoices ti SET status='ISSUED'
        WHERE ti.partner_id=$1 AND ti.status='PAID'
          AND (SELECT balance FROM v_invoice_balances b WHERE b.invoice_id=ti.invoice_id) > 0.009`,
      [r.rows[0].partner_id]);
    return { ok: true, payment: r.rows[0], outstanding: await outstanding(r.rows[0].partner_id) };
  }

  // Running statement: invoices as debits, payments as credits.
  // Everything that moves a customer's balance, in one place.
  //
  // Credit notes belong here and were missing. v_invoice_balances — which the
  // credit gate, Customer-360 and outstanding all read — nets credit notes off
  // the invoice, so a ledger without them drifts above the real balance the
  // moment anyone approves a sales return. Nobody had noticed because no credit
  // note has been raised yet; the first one would have made the statement we
  // send a customer disagree with what we tell ourselves they owe.
  //
  // A CANCELLED credit note is excluded for the same reason a cancelled invoice
  // and a cancelled payment are.
  const TXN_UNION = `
    SELECT ti.invoice_date AS txn_date, 'INVOICE' AS kind, ti.invoice_number AS ref,
           ti.grand_total AS debit, 0::numeric AS credit, 1 AS seq
      FROM tax_invoices ti WHERE ti.partner_id=$1 AND ti.status <> 'CANCELLED'
    UNION ALL
    SELECT pm.payment_date, 'PAYMENT', pm.receipt_no,
           0::numeric, pm.amount, 2
      FROM payments pm WHERE pm.partner_id=$1 AND pm.status='ACTIVE'
    UNION ALL
    SELECT cn.note_date, 'CREDIT_NOTE', cn.note_number,
           0::numeric, cn.amount, 3
      FROM credit_notes cn
     WHERE cn.partner_id=$1 AND cn.status = 'ACTIVE'`;
  // 'ACTIVE' exactly, not "anything but CANCELLED". v_invoice_balances counts a
  // credit note only when status = 'ACTIVE', so a looser test here would put a
  // note on the statement that the balance views ignore — reintroducing the
  // very drift this union was widened to remove. ACTIVE is the column default,
  // which is why returns.js does not set it explicitly.

  const runningBalance = (rows, opening = 0) => {
    let balance = r2(opening);
    return rows.map(x => {
      balance = r2(balance + Number(x.debit) - Number(x.credit));
      return { date: x.txn_date, kind: x.kind, ref: x.ref,
               debit: r2(x.debit), credit: r2(x.credit), balance };
    });
  };

  async function ledger(partnerId, { limit = 200 } = {}) {
    const r = await pool.query(
      `SELECT * FROM (${TXN_UNION}) t ORDER BY txn_date, seq, ref LIMIT $2`,
      [partnerId, limit]);
    return runningBalance(r.rows);
  }

  // Statement of account for a date range.
  //
  // The opening balance is computed from every transaction before `from`, not
  // by starting at zero — a statement for "this month" that opens at zero would
  // tell the customer they owe only this month's invoices, which is how disputes
  // start. Closing balance is asserted against v_partner_outstanding by the
  // caller-facing `reconciles` flag rather than being quietly trusted.
  async function statement(partnerId, { from = null, to = null } = {}) {
    // The address lives in partner_addresses, not on partners. Prefer the
    // default row, then a billing one, so the statement carries the address
    // invoices are billed to rather than whichever row was entered first.
    const partner = (await pool.query(
      `SELECT p.partner_id, p.company_name, p.gstin, p.credit_days, p.credit_limit,
              a.line1, a.line2, a.city, a.state, a.pincode
         FROM partners p
         LEFT JOIN LATERAL (
           SELECT line1, line2, city, state, pincode FROM partner_addresses pa
            WHERE pa.partner_id = p.partner_id
            ORDER BY pa.is_default DESC NULLS LAST,
                     (pa.address_type = 'BILLING') DESC, pa.address_id
            LIMIT 1
         ) a ON true
        WHERE p.partner_id = $1`, [partnerId])).rows[0];
    if (!partner) return { error: 'Customer not found', code: 404 };

    const opening = Number((await pool.query(
      `SELECT COALESCE(SUM(debit - credit), 0) AS b FROM (${TXN_UNION}) t
        WHERE $2::date IS NOT NULL AND t.txn_date < $2::date`,
      [partnerId, from])).rows[0].b);

    const rows = (await pool.query(
      `SELECT * FROM (${TXN_UNION}) t
        WHERE ($2::date IS NULL OR t.txn_date >= $2::date)
          AND ($3::date IS NULL OR t.txn_date <= $3::date)
        ORDER BY txn_date, seq, ref`,
      [partnerId, from, to])).rows;

    const lines = runningBalance(rows, opening);
    const closing = lines.length ? lines[lines.length - 1].balance : r2(opening);

    const o = await outstanding(partnerId);
    const openEnded = !to;

    // Reconciliation, and why it is NOT `closing === outstanding`.
    //
    // v_partner_outstanding sums only invoice balances above zero. It is what
    // the customer owes, floored — a customer sitting on an advance shows 0,
    // not a negative. The ledger has no such floor: it runs money in against
    // money out, so an overpaid customer legitimately closes negative. Testing
    // the two for equality flags every advance as a discrepancy.
    //
    // The identity that does hold, exactly:
    //
    //   closing = Σ(invoice balances) − unapplied payments − unallocated notes
    //
    // because Σ(balances) already nets the ALLOCATED part of both, and the
    // ledger counts each in full. Anything else is a real inconsistency.
    let reconciles = null;
    if (openEnded) {
      const n = (await pool.query(
        `SELECT
           (SELECT COALESCE(SUM(balance),0) FROM v_invoice_balances WHERE partner_id=$1) AS balances,
           (SELECT COALESCE(SUM(pm.amount),0) - COALESCE(SUM(a.alloc),0)
              FROM payments pm
              LEFT JOIN LATERAL (SELECT SUM(amount) alloc FROM payment_allocations pa
                                  WHERE pa.payment_id = pm.payment_id) a ON true
             WHERE pm.partner_id=$1 AND pm.status='ACTIVE') AS unapplied,
           (SELECT COALESCE(SUM(cn.amount),0) - COALESCE(SUM(c.alloc),0)
              FROM credit_notes cn
              LEFT JOIN LATERAL (SELECT SUM(amount) alloc FROM credit_note_allocations ca
                                  WHERE ca.note_id = cn.note_id) c ON true
             WHERE cn.partner_id=$1 AND cn.status='ACTIVE') AS unallocated_notes`,
        [partnerId])).rows[0];
      const expected = r2(Number(n.balances) - Number(n.unapplied) - Number(n.unallocated_notes));
      reconciles = Math.abs(closing - expected) < 0.011;
    }

    return {
      partner, from, to,
      opening: r2(opening), lines, closing,
      ageing: o.ageing, outstanding: o.outstanding, overdue: o.overdue,
      // Only meaningful for an open-ended statement; a historical range is not
      // expected to describe today's position.
      reconciles,
    };
  }

  async function list({ partner_id, limit = 100 } = {}) {
    const r = await pool.query(
      `SELECT pm.*, p.company_name,
              COALESCE((SELECT SUM(amount) FROM payment_allocations pa WHERE pa.payment_id=pm.payment_id),0) AS allocated
         FROM payments pm LEFT JOIN partners p ON p.partner_id=pm.partner_id
        WHERE ($1::int IS NULL OR pm.partner_id=$1)
        ORDER BY pm.payment_date DESC, pm.payment_id DESC LIMIT $2`,
      [partner_id || null, limit]);
    return r.rows.map(x => ({ ...x, amount: r2(x.amount), allocated: r2(x.allocated),
                              unallocated: r2(Number(x.amount) - Number(x.allocated)) }));
  }

  // Customers holding unapplied credit, across the book.
  //
  // The ageing report only lists customers who owe money, so a customer who has
  // paid an advance and owes nothing is invisible there — their credit sits
  // unapplied with nobody aware of it. This is the other half of the picture.
  async function creditOnAccountAll() {
    const r = await pool.query(
      `SELECT pm.partner_id, p.company_name,
              SUM(pm.amount - COALESCE((SELECT SUM(amount) FROM payment_allocations pa
                                         WHERE pa.payment_id = pm.payment_id), 0)) AS unapplied,
              COUNT(*)::int AS receipts,
              MAX(pm.payment_date) AS latest
         FROM payments pm
         LEFT JOIN partners p ON p.partner_id = pm.partner_id
        WHERE pm.status = 'ACTIVE'
        GROUP BY pm.partner_id, p.company_name
       HAVING SUM(pm.amount - COALESCE((SELECT SUM(amount) FROM payment_allocations pa
                                         WHERE pa.payment_id = pm.payment_id), 0)) > 0.009
        ORDER BY unapplied DESC`);
    return r.rows.map(x => ({ ...x, unapplied: r2(x.unapplied) }));
  }

  // Ageing across all customers — the collections worklist.
  async function ageingReport() {
    const r = await pool.query(
      `SELECT v.*, p.company_name, p.credit_limit
         FROM v_partner_outstanding v
         JOIN partners p ON p.partner_id = v.partner_id
        WHERE v.outstanding > 0.009
        ORDER BY v.overdue DESC, v.outstanding DESC`);
    return r.rows.map(x => ({
      partner_id: x.partner_id, company_name: x.company_name,
      credit_limit: r2(x.credit_limit),
      outstanding: r2(x.outstanding), overdue: r2(x.overdue),
      open_invoices: Number(x.open_invoices), oldest_overdue_days: Number(x.oldest_overdue_days),
      current: r2(x.current_amt), d1_30: r2(x.bucket_1_30), d31_60: r2(x.bucket_31_60),
      d61_90: r2(x.bucket_61_90), d90_plus: r2(x.bucket_90_plus),
    }));
  }

  return { record, cancel, allocate: record, applyCredit, creditOnAccount, creditOnAccountAll,
           outstanding, openInvoices, ledger, statement, list, ageingReport, receiptNo };
};
