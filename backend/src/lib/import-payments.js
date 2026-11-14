// Import payments (spec §35) — advance + balance TTs, EACH at its own exchange
// rate. A payment is STANDALONE and ALLOCATED across one or more imports, because a
// single advance can cover 2-3 containers whose shipments arrive separately.
//
// An import's INR cost = SUM of its allocations' actual INR (real blended rate),
// never a single assumed rate. This module owns the payment + allocation records;
// import-costing reads paidInInr(). Busy remains the book of accounts.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const num = (v) => (v == null || v === '' || isNaN(Number(String(v).replace(/[, ]/g, ''))) ? 0 : Number(String(v).replace(/[, ]/g, '')));

module.exports = (pool) => {
  const audit = async (c, username, action, newVal) => {
    try { await (c || pool).query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'IMPORTS',$3)`,
      [username || null, action, newVal ? JSON.stringify(newVal).slice(0, 4000) : null]); } catch {}
  };

  // Create a payment and its allocation(s). allocations: [{import_id, allocated_fc, allocated_inr}].
  // If none given but importId passed, the whole payment allocates to that one import.
  async function addPayment(body, user, defaultImportId = null) {
    const b = body || {};
    const fc = num(b.amount_fc), rate = num(b.exchange_rate);
    const inr = num(b.amount_inr) || r2(fc * rate);
    const effRate = rate || (fc > 0 ? r4(inr / fc) : 0);
    if (fc <= 0 && inr <= 0) return { error: 'Enter the payment amount (foreign currency and/or INR).', code: 400 };

    let allocs = Array.isArray(b.allocations) && b.allocations.length ? b.allocations
      : (defaultImportId ? [{ import_id: defaultImportId, allocated_fc: fc, allocated_inr: inr }] : []);
    // Guard: allocations cannot exceed the payment.
    const aFc = r2(allocs.reduce((s, a) => s + num(a.allocated_fc), 0));
    const aInr = r2(allocs.reduce((s, a) => s + num(a.allocated_inr), 0));
    if (aFc - fc > 0.01 || aInr - inr > 0.01) return { error: `Allocations (${aFc} ${b.currency || 'USD'} / ₹${aInr}) exceed the payment (${fc} / ₹${inr}).`, code: 400 };

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      if (b.tt_reference) {
        const dup = await c.query(`SELECT payment_id FROM import_payments WHERE tt_reference=$1`, [b.tt_reference]);
        if (dup.rows.length) { await c.query('ROLLBACK'); return { error: `TT ${b.tt_reference} is already recorded.`, code: 409 }; }
      }
      const pay = (await c.query(
        `INSERT INTO import_payments (kind, supplier_id, amount_fc, currency, exchange_rate, amount_inr, bank_charges,
           swift_charges, advance_import_charges, fx_conversion_charges, tt_reference, tt_date, invoice_ref, bank, remarks, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [['ADVANCE', 'BALANCE', 'OTHER'].includes(b.kind) ? b.kind : 'ADVANCE', b.supplier_id || null, fc, b.currency || 'USD',
         effRate, inr, num(b.bank_charges), num(b.swift_charges), num(b.advance_import_charges), num(b.fx_conversion_charges),
         b.tt_reference || null, b.tt_date || null, b.invoice_ref || null, b.bank || null, b.remarks || null, user?.username || null])).rows[0];
      for (const a of allocs) {
        if (!a.import_id) continue;
        await c.query(`INSERT INTO import_payment_allocations (payment_id, import_id, allocated_fc, allocated_inr) VALUES ($1,$2,$3,$4)`,
          [pay.payment_id, a.import_id, num(a.allocated_fc), num(a.allocated_inr) || r2(num(a.allocated_fc) * effRate)]);
      }
      await audit(c, user?.username, 'IMPORT_PAYMENT_ADD', { tt: pay.tt_reference, kind: pay.kind, amount_inr: inr, rate: effRate, allocations: allocs.length });
      await c.query('COMMIT');
      // Auto-generate a PO for each funded import that has none yet — paying the
      // supplier creates the PO on its own. Idempotent + best-effort (never fails
      // the payment). Runs after commit so a PO hiccup can't roll back the TT.
      // One advance covering several containers → a SINGLE PO with a line per FCL.
      let pos = null;
      try {
        const ids = allocs.map(a => a.import_id).filter(Boolean);
        if (ids.length) pos = (await require('./imports')(pool).ensurePoForImports(ids, user)).pos || null;
      } catch { /* PO auto-gen is best-effort */ }
      await refreshCosting(allocs.map(a => a.import_id));
      return { ok: true, payment: pay, pos_created: pos };
    } catch (e) { await c.query('ROLLBACK'); return { error: e.message, code: 500 }; }
    finally { c.release(); }
  }

  // Recompute + persist costing for the affected imports so landed cost adjusts the
  // instant a payment is added, re-split or deleted (getCosting write-through). Best-effort.
  async function refreshCosting(ids) {
    try {
      const cs = require('./import-costing')(pool);
      for (const id of [...new Set((ids || []).filter(Boolean))]) await cs.getCosting(id);
    } catch { /* best-effort */ }
  }

  // Replace a payment's allocations (re-split across imports).
  async function reallocate(paymentId, allocations, user) {
    const pay = (await pool.query(`SELECT * FROM import_payments WHERE payment_id=$1`, [paymentId])).rows[0];
    if (!pay) return { error: 'Payment not found', code: 404 };
    const allocs = Array.isArray(allocations) ? allocations : [];
    const aFc = r2(allocs.reduce((s, a) => s + num(a.allocated_fc), 0));
    if (aFc - num(pay.amount_fc) > 0.01) return { error: `Allocations exceed the payment amount (${pay.amount_fc} ${pay.currency}).`, code: 400 };
    const prev = (await pool.query(`SELECT import_id FROM import_payment_allocations WHERE payment_id=$1`, [paymentId])).rows.map(r => r.import_id);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`DELETE FROM import_payment_allocations WHERE payment_id=$1`, [paymentId]);
      for (const a of allocs) if (a.import_id) await c.query(
        `INSERT INTO import_payment_allocations (payment_id, import_id, allocated_fc, allocated_inr) VALUES ($1,$2,$3,$4)`,
        [paymentId, a.import_id, num(a.allocated_fc), num(a.allocated_inr) || r2(num(a.allocated_fc) * num(pay.exchange_rate))]);
      await audit(c, user?.username, 'IMPORT_PAYMENT_REALLOCATE', { payment_id: paymentId, allocations: allocs.length });
      await c.query('COMMIT');
      await refreshCosting([...prev, ...allocs.map(a => a.import_id)]);
      return { ok: true };
    } catch (e) { await c.query('ROLLBACK'); return { error: e.message, code: 500 }; }
    finally { c.release(); }
  }

  async function deletePayment(paymentId, user) {
    const affected = (await pool.query(`SELECT import_id FROM import_payment_allocations WHERE payment_id=$1`, [paymentId])).rows.map(r => r.import_id);
    const r = await pool.query(`DELETE FROM import_payments WHERE payment_id=$1 RETURNING tt_reference`, [paymentId]);
    if (!r.rows.length) return { error: 'Payment not found', code: 404 };
    await audit(null, user?.username, 'IMPORT_PAYMENT_DELETE', { payment_id: paymentId, tt: r.rows[0].tt_reference });
    await refreshCosting(affected);
    return { ok: true };
  }

  // Payments (allocations) touching one import.
  const listForImport = (importId) => pool.query(
    `SELECT a.id AS allocation_id, a.allocated_fc, a.allocated_inr, p.*
       FROM import_payment_allocations a JOIN import_payments p ON p.payment_id=a.payment_id
      WHERE a.import_id=$1 ORDER BY COALESCE(p.tt_date, p.created_at), p.payment_id`, [importId]).then(r => r.rows);

  // All payments with allocation totals + unallocated remainder (for the payments desk).
  const listAll = () => pool.query(
    `SELECT p.*, COALESCE(SUM(a.allocated_fc),0) AS allocated_fc_total, COALESCE(SUM(a.allocated_inr),0) AS allocated_inr_total,
            (p.amount_fc - COALESCE(SUM(a.allocated_fc),0)) AS unallocated_fc, COUNT(a.id) AS import_count
       FROM import_payments p LEFT JOIN import_payment_allocations a ON a.payment_id=p.payment_id
      GROUP BY p.payment_id ORDER BY COALESCE(p.tt_date, p.created_at) DESC`).then(r => r.rows);

  // One payment with its allocations (each showing the import it targets).
  async function getPayment(paymentId) {
    const pay = (await pool.query(`SELECT * FROM import_payments WHERE payment_id=$1`, [paymentId])).rows[0];
    if (!pay) return null;
    const allocations = (await pool.query(
      `SELECT a.*, i.import_no, p.company_name AS supplier
         FROM import_payment_allocations a JOIN imports i ON i.import_id=a.import_id
         LEFT JOIN partners p ON p.partner_id=i.supplier_id
        WHERE a.payment_id=$1 ORDER BY a.id`, [paymentId])).rows;
    return { payment: pay, allocations };
  }

  // Actual INR allocated to an import (excludes bank charges).
  async function paidInInr(importId) {
    const r = (await pool.query(`SELECT COALESCE(SUM(allocated_inr),0) inr, COALESCE(SUM(allocated_fc),0) fc, COUNT(*) n FROM import_payment_allocations WHERE import_id=$1`, [importId])).rows[0];
    return { inr: r2(r.inr), fc: r2(r.fc), count: Number(r.n) };
  }

  // Bank/forex charges attributable to an import (INR). Each payment's itemised
  // charges (SWIFT/remittance, foreign advance-import, FX-conversion, other bank) are
  // apportioned to this import by its share of that payment's foreign-currency amount,
  // so an advance split across containers charges each its fair part. These are real
  // remittance costs and are added to landed cost.
  async function chargesForImport(importId) {
    const rows = (await pool.query(
      `SELECT p.amount_fc, a.allocated_fc,
              COALESCE(p.swift_charges,0)          AS swift,
              COALESCE(p.advance_import_charges,0) AS advance,
              COALESCE(p.fx_conversion_charges,0)  AS fx,
              COALESCE(p.bank_charges,0)           AS other
         FROM import_payment_allocations a JOIN import_payments p ON p.payment_id=a.payment_id
        WHERE a.import_id=$1`, [importId])).rows;
    let swift = 0, advance = 0, fx = 0, other = 0;
    for (const r of rows) {
      const share = num(r.amount_fc) > 0 ? Math.min(num(r.allocated_fc) / num(r.amount_fc), 1) : 1;
      swift += num(r.swift) * share; advance += num(r.advance) * share;
      fx += num(r.fx) * share; other += num(r.other) * share;
    }
    swift = r2(swift); advance = r2(advance); fx = r2(fx); other = r2(other);
    return { swift_charges: swift, advance_import_charges: advance, fx_conversion_charges: fx, other_bank_charges: other,
             total: r2(swift + advance + fx + other) };
  }

  async function summary(importId) {
    const paid = await paidInInr(importId);
    const charges = await chargesForImport(importId);
    const inv = (await pool.query(`SELECT invoice_value, currency FROM imports WHERE import_id=$1`, [importId])).rows[0] || {};
    const invFc = num(inv.invoice_value);
    return {
      tranches: paid.count, total_fc: paid.fc, total_inr: paid.inr,
      blended_rate: paid.fc > 0 ? r4(paid.inr / paid.fc) : 0,
      invoice_value_fc: invFc, currency: inv.currency || 'USD',
      outstanding_fc: r2(Math.max(invFc - paid.fc, 0)),
      fully_paid: invFc > 0 && paid.fc >= invFc - 0.01,
      charges,
    };
  }

  // Payables — per-import outstanding foreign-currency balance (invoice − paid), for
  // the live payables dashboard. Open imports only (not CLOSED). INR is left to the UI
  // (applied at a chosen planning rate) since the balance isn't paid yet.
  async function payables() {
    const imps = (await pool.query(
      `SELECT i.import_id, i.import_no, i.commercial_invoice_number, i.proforma_invoice_number,
              i.invoice_value, i.currency, i.incoterm, i.status, i.current_eta,
              p.company_name AS supplier
         FROM imports i LEFT JOIN partners p ON p.partner_id=i.supplier_id
        WHERE i.deleted_at IS NULL AND i.status <> 'CLOSED'
        ORDER BY i.import_id DESC`)).rows;
    const rows = [];
    const tot = { invoice_fc: 0, paid_fc: 0, paid_inr: 0, outstanding_fc: 0 };
    for (const im of imps) {
      const paid = await paidInInr(im.import_id);
      const inv = num(im.invoice_value);
      const outstanding = r2(Math.max(inv - paid.fc, 0));
      tot.invoice_fc += inv; tot.paid_fc += paid.fc; tot.paid_inr += paid.inr; tot.outstanding_fc += outstanding;
      rows.push({
        import_id: im.import_id, import_no: im.import_no, supplier: im.supplier,
        invoice_ref: im.commercial_invoice_number || im.proforma_invoice_number,
        currency: im.currency || 'USD', incoterm: im.incoterm, status: im.status, current_eta: im.current_eta,
        invoice_fc: r2(inv), paid_fc: paid.fc, paid_inr: paid.inr,
        outstanding_fc: outstanding, fully_paid: outstanding <= 0.01,
      });
    }
    return { rows, totals: { invoice_fc: r2(tot.invoice_fc), paid_fc: r2(tot.paid_fc), paid_inr: r2(tot.paid_inr), outstanding_fc: r2(tot.outstanding_fc) } };
  }

  return { addPayment, reallocate, deletePayment, getPayment, listForImport, listAll, paidInInr, chargesForImport, summary, payables };
};
