// Sales returns and credit notes.
//
// A return has two consequences that must happen together or not at all: goods
// come back into stock, and the customer stops owing money for them. Doing only
// the first leaves the customer chased for a bill they have already settled by
// sending the fabric back; doing only the second loses the stock.
//
// So a return is DRAFT until it is approved, and approval is a single
// transaction that writes the stock ledger, raises a credit note, and allocates
// that note against the invoice. The credit note is netted off the invoice by
// v_invoice_balances, which is the same view the credit gate and Customer-360
// read — there is no second opinion about what the customer owes.

const obs = require('./observability');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const q3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

// SALEABLE goods go back to sellable stock. REWORK and SCRAP do not — putting
// damaged fabric back into sellable stock is how it gets dispatched twice.
const DISPOSITIONS = ['SALEABLE', 'REWORK', 'SCRAP'];
const REASONS = ['QUALITY', 'SHADE_MISMATCH', 'SHORT_SUPPLY', 'DAMAGED',
                 'WRONG_ITEM', 'EXCESS_SUPPLY', 'CUSTOMER_REFUSED', 'OTHER'];

module.exports = (pool, { nextInvSeq, approvals } = {}) => {

  // db must be the transaction client when called inside one.
  //
  // nextInvSeq is skipped in that case even though it is available: it holds its
  // own pool handle, so calling it from inside a transaction takes a SECOND
  // connection while the first is still checked out. At concurrency equal to the
  // pool size that deadlocks the pool and freezes the whole application — the
  // same fault a load test found in payments. When no client is passed the
  // shared helper is used as before.
  async function nextNumber(db, prefix, table, col) {
    if (db === pool && nextInvSeq) {
      try { return await nextInvSeq(prefix, table, col); } catch { /* fall through */ }
    }
    const yr = new Date().getFullYear();
    const r = await db.query(
      `SELECT ${col} FROM ${table} WHERE ${col} LIKE $1 ORDER BY ${col} DESC LIMIT 1`,
      [`${prefix}-${yr}-%`]);
    if (!r.rows.length) return `${prefix}-${yr}-001`;
    const n = parseInt(String(r.rows[0][col]).split('-').pop(), 10) + 1;
    return `${prefix}-${yr}-${String(n).padStart(3, '0')}`;
  }

  const returnNo     = (db = pool) => nextNumber(db, 'SRN', 'sales_returns', 'return_number');
  const creditNoteNo = (db = pool) => nextNumber(db, 'CN',  'credit_notes',  'note_number');

  // How much of each invoice line has already come back. A customer returning
  // 40 kg of a 50 kg line twice would otherwise be credited for 80 kg.
  async function alreadyReturned(invoiceId) {
    const r = await pool.query(
      `SELECT sri.item_name, COALESCE(SUM(sri.quantity),0) AS qty
         FROM sales_return_items sri
         JOIN sales_returns sr ON sr.return_id = sri.return_id
        WHERE sr.invoice_id = $1 AND sr.status IN ('DRAFT','APPROVED')
        GROUP BY sri.item_name`, [invoiceId]);
    const m = new Map();
    for (const x of r.rows) m.set(String(x.item_name || '').toLowerCase(), Number(x.qty));
    return m;
  }

  // What can still come back on an invoice, line by line.
  //
  // The same rule the validator uses — invoiced quantity less what has already
  // been returned — exposed so the form shows a ceiling instead of computing its
  // own. Two implementations of this would eventually disagree, and the one on
  // screen is the one people would trust.
  async function returnable(invoiceId) {
    const inv = (await pool.query(
      `SELECT ti.invoice_id, ti.invoice_number, ti.invoice_date, ti.partner_id, ti.status,
              p.company_name
         FROM tax_invoices ti
         LEFT JOIN partners p ON p.partner_id = ti.partner_id
        WHERE ti.invoice_id = $1`, [invoiceId])).rows[0];
    if (!inv) return { error: 'Invoice not found', code: 404 };

    const lines = (await pool.query(
      `SELECT item_id, item_name, hsn_code, uom, rate, gst_rate,
              SUM(quantity) AS quantity
         FROM tax_invoice_items WHERE invoice_id = $1
        GROUP BY item_id, item_name, hsn_code, uom, rate, gst_rate
        ORDER BY item_name`, [invoiceId])).rows;

    const back = await alreadyReturned(invoiceId);
    return {
      ...inv,
      lines: lines.map(l => {
        const sold = q3(l.quantity);
        const returned = q3(back.get(String(l.item_name || '').toLowerCase()) || 0);
        return {
          item_id: l.item_id, item_name: l.item_name, hsn_code: l.hsn_code,
          uom: l.uom || 'KG', rate: r2(l.rate), gst_rate: Number(l.gst_rate) || 0,
          invoiced: sold, already_returned: returned,
          returnable: q3(Math.max(0, sold - returned)),
        };
      }),
    };
  }

  // Create a return in DRAFT. Nothing moves and no money changes until approval.
  async function create({ partner_id, invoice_id, dispatch_id, reason, detail,
                          disposition, return_date, items, created_by }) {
    if (!Array.isArray(items) || !items.length) return { error: 'A return needs at least one line', code: 400 };

    const disp = String(disposition || 'SALEABLE').toUpperCase();
    if (!DISPOSITIONS.includes(disp)) {
      return { error: `Disposition must be one of ${DISPOSITIONS.join(', ')}`, code: 400 };
    }
    const rsn = String(reason || 'OTHER').toUpperCase();
    if (!REASONS.includes(rsn)) return { error: `Reason must be one of ${REASONS.join(', ')}`, code: 400 };

    let pid = partner_id;
    let inv = null;
    if (invoice_id) {
      inv = (await pool.query(`SELECT * FROM tax_invoices WHERE invoice_id=$1`, [invoice_id])).rows[0];
      if (!inv) return { error: 'Invoice not found', code: 404 };
      if (inv.status === 'CANCELLED') return { error: 'That invoice is cancelled', code: 409 };
      pid = pid || inv.partner_id;
    }
    if (!pid) return { error: 'A customer is required', code: 400 };

    // Validate quantities against what was actually invoiced, net of earlier
    // returns. Crediting more than was sold is the expensive failure here.
    if (invoice_id) {
      const lines = (await pool.query(
        `SELECT item_name, quantity FROM tax_invoice_items WHERE invoice_id=$1`, [invoice_id])).rows;
      const sold = new Map();
      for (const l of lines) {
        const k = String(l.item_name || '').toLowerCase();
        sold.set(k, (sold.get(k) || 0) + Number(l.quantity));
      }
      const back = await alreadyReturned(invoice_id);
      for (const it of items) {
        const k = String(it.item_name || '').toLowerCase();
        if (!sold.has(k)) {
          return { error: `"${it.item_name}" was not on invoice ${inv.invoice_number}`, code: 400 };
        }
        const available = q3(sold.get(k) - (back.get(k) || 0));
        if (q3(it.quantity) > available + 0.0005) {
          return { error: `Cannot return ${q3(it.quantity)} of "${it.item_name}" — only ${available} remains on invoice ${inv.invoice_number}`, code: 400 };
        }
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hdr = await client.query(
        `INSERT INTO sales_returns (return_number, return_date, partner_id, invoice_id, dispatch_id,
                                    reason, detail, disposition, created_by)
         VALUES ($1,COALESCE($2,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [await returnNo(client), return_date || null, pid, invoice_id || null, dispatch_id || null,
         rsn, detail || null, disp, created_by || null]);
      const rid = hdr.rows[0].return_id;

      let totQty = 0, totTaxable = 0, totTax = 0;
      for (const it of items) {
        const qty = q3(it.quantity);
        if (!(qty > 0)) { await client.query('ROLLBACK'); return { error: 'Every line needs a positive quantity', code: 400 }; }
        const rate = r2(it.rate);
        const gst = Number(it.gst_rate) || 0;
        const taxable = r2(qty * rate);
        const tax = r2(taxable * gst / 100);
        totQty = q3(totQty + qty); totTaxable = r2(totTaxable + taxable); totTax = r2(totTax + tax);

        await client.query(
          `INSERT INTO sales_return_items (return_id, item_id, item_name, hsn_code, lot_number, roll_id,
                                           quantity, uom, rate, gst_rate, taxable_value, tax_amount, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [rid, it.item_id || null, it.item_name || null, it.hsn_code || null,
           it.lot_number || null, it.roll_id || null, qty, it.uom || 'KG',
           rate, gst, taxable, tax, r2(taxable + tax)]);
      }

      await client.query(
        `UPDATE sales_returns SET total_qty=$2, taxable_value=$3, tax_amount=$4, total_value=$5
          WHERE return_id=$1`, [rid, totQty, totTaxable, totTax, r2(totTaxable + totTax)]);

      await client.query('COMMIT');
      return await get(rid);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }

  async function get(returnId) {
    const h = await pool.query(
      `SELECT sr.*, p.company_name, ti.invoice_number, d.dispatch_number,
              cn.note_number, cn.amount AS credit_amount, cn.status AS credit_status
         FROM sales_returns sr
         LEFT JOIN partners p          ON p.partner_id = sr.partner_id
         LEFT JOIN tax_invoices ti     ON ti.invoice_id = sr.invoice_id
         LEFT JOIN dispatch_challans d ON d.dispatch_id = sr.dispatch_id
         LEFT JOIN credit_notes cn     ON cn.return_id = sr.return_id AND cn.status = 'ACTIVE'
        WHERE sr.return_id = $1`, [returnId]);
    if (!h.rows.length) return null;
    const items = await pool.query(
      `SELECT * FROM sales_return_items WHERE return_id=$1 ORDER BY line_id`, [returnId]);
    return { ...h.rows[0], items: items.rows };
  }

  async function list({ partner_id, status, limit = 100 } = {}) {
    const r = await pool.query(
      `SELECT sr.*, p.company_name, ti.invoice_number, cn.note_number
         FROM sales_returns sr
         LEFT JOIN partners p      ON p.partner_id = sr.partner_id
         LEFT JOIN tax_invoices ti ON ti.invoice_id = sr.invoice_id
         LEFT JOIN credit_notes cn ON cn.return_id = sr.return_id AND cn.status='ACTIVE'
        WHERE ($1::int IS NULL OR sr.partner_id = $1)
          AND ($2::text IS NULL OR sr.status = $2)
        ORDER BY sr.return_date DESC, sr.return_id DESC LIMIT $3`,
      [partner_id || null, status || null, limit]);
    return r.rows;
  }

  // Approve: stock back in, credit note out, allocated against the invoice.
  // One transaction — a half-applied return is worse than no return at all.
  async function approve(returnId, { by } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sr = (await client.query(
        `SELECT * FROM sales_returns WHERE return_id=$1 FOR UPDATE`, [returnId])).rows[0];
      if (!sr) { await client.query('ROLLBACK'); return { error: 'Return not found', code: 404 }; }
      if (sr.status !== 'DRAFT') { await client.query('ROLLBACK'); return { error: `Return is already ${sr.status}`, code: 409 }; }

      // Serialise against payments for the same customer — both change what is
      // owed, and they must not interleave while allocating the same invoice.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`pay:${sr.partner_id}`]);

      const items = (await client.query(
        `SELECT * FROM sales_return_items WHERE return_id=$1`, [returnId])).rows;

      // Stock comes back only if it is sellable. Rework and scrap are recorded
      // against the return but deliberately not added to sellable stock.
      if (sr.disposition === 'SALEABLE') {
        for (const it of items) {
          await client.query(
            `INSERT INTO stock_ledger (txn_date, doc_type, doc_id, item_id, item_desc,
                                       movement_type, quantity, uom_code, unit_cost, total_cost,
                                       partner_id, notes, created_by)
             VALUES (CURRENT_DATE,'SALES_RETURN',$1,$2,$3,'IN',$4,$5,$6,$7,$8,$9,$10)`,
            [String(sr.return_number), it.item_id || null, it.item_name,
             it.quantity, it.uom || 'KG', it.rate, r2(Number(it.quantity) * Number(it.rate)),
             sr.partner_id, `Return ${sr.return_number} (${sr.reason})`, by || null]);
        }
      }

      // Credit note for the full value of the return, including tax — the
      // customer was charged tax on goods they no longer have.
      const note = await client.query(
        `INSERT INTO credit_notes (note_number, partner_id, return_id, invoice_id, reason,
                                   taxable_value, tax_amount, amount, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [await creditNoteNo(client), sr.partner_id, returnId, sr.invoice_id || null, sr.reason,
         sr.taxable_value, sr.tax_amount, sr.total_value, by || null]);
      const noteId = note.rows[0].note_id;

      // Allocate: the originating invoice first, then any other open invoice
      // oldest-first. Clamped to each invoice's balance, so a credit note can
      // never push an invoice negative.
      let remaining = r2(sr.total_value);
      const applied = [];
      const targets = (await client.query(
        `SELECT invoice_id, balance FROM v_invoice_balances
          WHERE partner_id=$1 AND balance > 0.009
          ORDER BY (invoice_id = $2) DESC, invoice_date, invoice_id`,
        [sr.partner_id, sr.invoice_id || -1])).rows;

      for (const t of targets) {
        if (remaining <= 0.009) break;
        const use = r2(Math.min(remaining, r2(t.balance)));
        if (use <= 0.009) continue;
        await client.query(
          `INSERT INTO credit_note_allocations (note_id, invoice_id, amount, allocated_by)
           VALUES ($1,$2,$3,$4)`, [noteId, t.invoice_id, use, by || null]);
        remaining = r2(remaining - use);
        applied.push({ invoice_id: t.invoice_id, amount: use });
      }

      await client.query(
        `UPDATE tax_invoices ti SET status='PAID'
          WHERE ti.partner_id=$1 AND ti.status='ISSUED'
            AND (SELECT balance FROM v_invoice_balances b WHERE b.invoice_id=ti.invoice_id) <= 0.009`,
        [sr.partner_id]);

      await client.query(
        `UPDATE sales_returns SET status='APPROVED' WHERE return_id=$1`, [returnId]);

      await client.query('COMMIT');
      obs.inc('sales_returns_approved_total');

      return {
        ok: true, return_id: returnId, credit_note: note.rows[0],
        allocated: applied,
        // Nothing was open to absorb it, so it stays as usable credit rather
        // than being written off.
        unallocated: remaining,
        stock_restored: sr.disposition === 'SALEABLE',
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }

  async function reject(returnId, { by, reason } = {}) {
    const r = await pool.query(
      `UPDATE sales_returns SET status='REJECTED',
              detail = COALESCE(detail,'') || ' [rejected by ' || COALESCE($2,'?') || ': ' || COALESCE($3,'no reason') || ']'
        WHERE return_id=$1 AND status='DRAFT' RETURNING *`,
      [returnId, by || null, reason || null]);
    if (!r.rows.length) return { error: 'Return not found or not in DRAFT', code: 404 };
    return { ok: true, return: r.rows[0] };
  }

  // Cancelling an approved return reverses both halves: the credit note is
  // cancelled (restoring the receivable) and the stock goes back out.
  async function cancel(returnId, { by, reason } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sr = (await client.query(
        `SELECT * FROM sales_returns WHERE return_id=$1 FOR UPDATE`, [returnId])).rows[0];
      if (!sr) { await client.query('ROLLBACK'); return { error: 'Return not found', code: 404 }; }
      if (sr.status !== 'APPROVED') { await client.query('ROLLBACK'); return { error: `Only an approved return can be cancelled (this one is ${sr.status})`, code: 409 }; }

      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`pay:${sr.partner_id}`]);

      const notes = (await client.query(
        `SELECT note_id FROM credit_notes WHERE return_id=$1 AND status='ACTIVE'`, [returnId])).rows;
      for (const n of notes) {
        // Same rule as a cancelled payment: keep the note for audit, drop its
        // allocations so the allocation table still sums to real credit.
        await client.query(`DELETE FROM credit_note_allocations WHERE note_id=$1`, [n.note_id]);
        await client.query(
          `UPDATE credit_notes SET status='CANCELLED', cancelled_at=NOW(), cancelled_by=$2
            WHERE note_id=$1`, [n.note_id, by || null]);
      }

      if (sr.disposition === 'SALEABLE') {
        const items = (await client.query(
          `SELECT * FROM sales_return_items WHERE return_id=$1`, [returnId])).rows;
        for (const it of items) {
          await client.query(
            `INSERT INTO stock_ledger (txn_date, doc_type, doc_id, item_id, item_desc,
                                       movement_type, quantity, uom_code, unit_cost, total_cost,
                                       partner_id, notes, created_by)
             VALUES (CURRENT_DATE,'SALES_RETURN_CANCEL',$1,$2,$3,'OUT',$4,$5,$6,$7,$8,$9,$10)`,
            [String(sr.return_number), it.item_id || null, it.item_name,
             it.quantity, it.uom || 'KG', it.rate, r2(Number(it.quantity) * Number(it.rate)),
             sr.partner_id, `Reversal of return ${sr.return_number}`, by || null]);
        }
      }

      // Invoices settled by the cancelled credit note are open again.
      await client.query(
        `UPDATE tax_invoices ti SET status='ISSUED'
          WHERE ti.partner_id=$1 AND ti.status='PAID'
            AND (SELECT balance FROM v_invoice_balances b WHERE b.invoice_id=ti.invoice_id) > 0.009`,
        [sr.partner_id]);

      await client.query(
        `UPDATE sales_returns SET status='CANCELLED',
                detail = COALESCE(detail,'') || ' [cancelled: ' || COALESCE($2,'no reason') || ']'
          WHERE return_id=$1`, [returnId, reason || null]);

      await client.query('COMMIT');
      return { ok: true, return_id: returnId, notes_cancelled: notes.length };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  }

  async function listCreditNotes({ partner_id, limit = 100 } = {}) {
    const r = await pool.query(
      `SELECT cn.*, p.company_name, sr.return_number,
              COALESCE((SELECT SUM(amount) FROM credit_note_allocations ca
                         WHERE ca.note_id = cn.note_id),0) AS allocated
         FROM credit_notes cn
         LEFT JOIN partners p       ON p.partner_id = cn.partner_id
         LEFT JOIN sales_returns sr ON sr.return_id = cn.return_id
        WHERE ($1::int IS NULL OR cn.partner_id = $1)
        ORDER BY cn.note_date DESC, cn.note_id DESC LIMIT $2`, [partner_id || null, limit]);
    return r.rows.map(x => ({ ...x, amount: r2(x.amount), allocated: r2(x.allocated),
                              unallocated: r2(Number(x.amount) - Number(x.allocated)) }));
  }

  return { create, get, list, approve, reject, cancel, listCreditNotes, returnable,
           DISPOSITIONS, REASONS };
};
