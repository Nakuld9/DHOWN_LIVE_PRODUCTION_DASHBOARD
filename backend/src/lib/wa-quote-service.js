// Quotation + draft-order service for the WhatsApp CRM.
// GST comes from the existing, unit-tested computeTax in tax-invoices.service —
// one source of truth for money math across the MES.

const { computeTax } = require('../services/tax-invoices.service');
const { decideRate, checkCredit, quoteStatus, r2 } = require('./wa-quote');

module.exports = (pool, { nextInvSeq, io, approvals, inventory, margin } = {}) => {

  async function quoteNo() {
    if (nextInvSeq) { try { return await nextInvSeq('QT'); } catch { /* fall through */ } }
    const r = await pool.query(`SELECT COUNT(*) n FROM wa_quotes`);
    return `QT-${new Date().getFullYear()}-${String(Number(r.rows[0].n) + 1).padStart(3, '0')}`;
  }

  // The customer's own last billed rate for this product (never another customer's).
  async function lastRateFor(partnerId, product) {
    if (!partnerId) return null;
    const r = await pool.query(
      `SELECT ABS(unit_cost) AS rate FROM stock_ledger
        WHERE partner_id = $1 AND movement_type = 'OUT' AND unit_cost IS NOT NULL
          AND ($2 = '' OR item_desc ILIKE '%' || $2 || '%')
        ORDER BY txn_date DESC LIMIT 1`, [partnerId, String(product || '').trim()]);
    return r.rows.length ? Number(r.rows[0].rate) : null;
  }

  // The manager-agreed rate from the customer price list, if one is live today.
  async function authorisedRateFor(partnerId, product, shade) {
    if (!partnerId) return null;
    const toks = (v) => String(v || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
    const tokens = [...toks(product), ...toks(shade)];
    if (!tokens.length) return null;
    const score = tokens.map((_, i) => `(CASE WHEN (product||' '||COALESCE(shade,'')) ILIKE '%'||$${i + 2}||'%' THEN 1 ELSE 0 END)`).join(' + ');
    const r = await pool.query(
      `SELECT rate, ${score} AS match_score FROM customer_prices
        WHERE partner_id = $1 AND is_active = true
          AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
          AND (${score}) > 0
        ORDER BY match_score DESC, valid_from DESC LIMIT 1`, [partnerId, ...tokens]);
    return r.rows.length ? Number(r.rows[0].rate) : null;
  }

  // Create a quote. `managerRate` is only ever supplied by a human via the UI.
  async function createQuote(b, user) {
    // Derive the customer from the conversation whenever we have one: the chat's
    // matched partner is authoritative, so a client (or the model) cannot point a
    // quote at a different customer, and credit checks can't be dodged by omitting
    // partner_id.
    let partnerId = b.partner_id || null;
    if (b.conversation_id) {
      const c = await pool.query(
        `SELECT partner_id FROM wa_conversations WHERE conversation_id = $1`, [b.conversation_id]);
      if (c.rows.length && c.rows[0].partner_id) partnerId = c.rows[0].partner_id;
    }
    let partner = null;
    if (partnerId) {
      partner = (await pool.query(
        `SELECT p.company_name, p.credit_limit, p.payment_terms,
                (SELECT COALESCE(outstanding,0) FROM v_partner_outstanding v
                  WHERE v.partner_id = p.partner_id) AS outstanding
           FROM partners p WHERE p.partner_id = $1`, [partnerId])).rows[0] || null;
    }

    const last = await lastRateFor(partnerId, b.product);
    const authorised = await authorisedRateFor(partnerId, b.product, b.shade);
    const priced = decideRate({ managerRate: b.rate, authorisedRate: authorised, lastRate: last });

    const qty = Number(b.quantity_kg) || 0;
    const gst = Number(b.gst_rate) || 5;
    const supply = b.supply_type === 'INTER' ? 'INTER' : 'INTRA';

    // With no authorised rate there is nothing to compute — the quote is a
    // request for a price, not an offer.
    const t = priced.rate
      ? computeTax([{ item_name: b.product, quantity: qty, rate: priced.rate, gst_rate: gst }], supply).totals
      : { taxable: 0, cgst: 0, sgst: 0, igst: 0, round_off: 0, grand: 0 };

    const credit = checkCredit({
      creditLimit: partner?.credit_limit,
      outstanding: partner?.outstanding,
      orderValue: t.grand,
    });
    const status = quoteStatus({ rateSource: priced.rate_source, creditFlag: credit.flag });

    const r = await pool.query(
      `INSERT INTO wa_quotes (quote_no, conversation_id, partner_id, customer_name, product, shade, gsm,
        quantity_kg, rate, rate_source, gst_rate, supply_type, taxable_value, cgst_amount, sgst_amount,
        igst_amount, round_off, grand_total, payment_terms, credit_flag, credit_note, status, created_by, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [await quoteNo(), b.conversation_id || null, partnerId,
       b.customer_name || partner?.company_name || null, b.product || null, b.shade || null, b.gsm || null,
       qty, priced.rate, priced.rate_source, gst, supply,
       t.taxable, t.cgst, t.sgst, t.igst, t.round_off, t.grand,
       b.payment_terms || partner?.payment_terms || null,
       credit.flag, credit.note, status, user || null, b.notes || null]
    );

    // Validity and margin (HIGH-12). A quote without an expiry is an open-ended
    // offer, and a rate without a margin is one nobody can sanity-check.
    const validDays = Number(process.env.QUOTE_VALID_DAYS) || 7;
    const m = margin ? await margin.assess({ product: b.product, shade: b.shade, rate: priced.rate, quantity_kg: qty }) : {};
    await pool.query(
      `UPDATE wa_quotes SET valid_until = CURRENT_DATE + ($2 || ' days')::interval,
                            unit_cost=$3, margin_pct=$4
        WHERE quote_id=$1`,
      [r.rows[0].quote_id, String(validDays), m.unit_cost ?? null, m.margin_pct ?? null]);
    r.rows[0].valid_until = new Date(Date.now() + validDays * 86400000).toISOString().slice(0, 10);
    r.rows[0].unit_cost = m.unit_cost ?? null;
    r.rows[0].margin_pct = m.margin_pct ?? null;
    const quote = r.rows[0];
    if (io) io.emit('wa_quote', { quote });
    return { quote, price: priced, credit, last_rate: last, margin: m };
  }

  // Manager decision. EDIT_PRICE re-computes GST and re-runs the credit check.
  async function act(quoteId, { action, rate, reason }, user) {
    const q = (await pool.query(`SELECT * FROM wa_quotes WHERE quote_id=$1`, [quoteId])).rows[0];
    if (!q) return { error: 'Quote not found', code: 404 };
    if (['SENT', 'CONVERTED'].includes(q.status)) return { error: `Quote already ${q.status}`, code: 409 };

    if (action === 'REJECT') {
      await pool.query(`UPDATE wa_quotes SET status='REJECTED', approved_by=$1, approved_at=NOW() WHERE quote_id=$2`,
        [user || null, quoteId]);
      await logApproval(quoteId, 'REJECT', q.rate, null, reason, user);
      return { ok: true, status: 'REJECTED' };
    }

    // APPROVE, optionally with an edited rate.
    const newRate = Number(rate);
    const useRate = Number.isFinite(newRate) && newRate > 0 ? r2(newRate) : (q.rate ? Number(q.rate) : null);
    if (!useRate) return { error: 'A rate is required to approve this quote', code: 400 };

    const t = computeTax(
      [{ item_name: q.product, quantity: Number(q.quantity_kg), rate: useRate, gst_rate: Number(q.gst_rate) }],
      q.supply_type).totals;

    const partner = q.partner_id ? (await pool.query(
      `SELECT credit_limit,
              (SELECT COALESCE(outstanding,0) FROM v_partner_outstanding v
                WHERE v.partner_id=$1) AS outstanding
         FROM partners WHERE partner_id=$1`, [q.partner_id])).rows[0] : null;
    const credit = checkCredit({ creditLimit: partner?.credit_limit, outstanding: partner?.outstanding, orderValue: t.grand });

    await pool.query(
      `UPDATE wa_quotes SET rate=$1, rate_source='MANAGER', taxable_value=$2, cgst_amount=$3, sgst_amount=$4,
              igst_amount=$5, round_off=$6, grand_total=$7, credit_flag=$8, credit_note=$9,
              status='APPROVED', approved_by=$10, approved_at=NOW()
        WHERE quote_id=$11`,
      [useRate, t.taxable, t.cgst, t.sgst, t.igst, t.round_off, t.grand,
       credit.flag, credit.note, user || null, quoteId]);

    const changed = q.rate !== null && r2(Number(q.rate)) !== useRate;
    await logApproval(quoteId, changed ? 'EDIT_PRICE' : 'APPROVE', q.rate, useRate, reason, user);
    return { ok: true, status: 'APPROVED', rate: useRate, totals: t, credit };
  }

  // Snapshot the current state before it changes, so a negotiation keeps its
  // full price history instead of overwriting itself (HIGH-12).
  async function snapshotRevision(q, { reason, user } = {}) {
    await pool.query(
      `INSERT INTO wa_quote_revisions
         (quote_id, revision_no, rate, quantity_kg, grand_total, unit_cost, margin_pct, rate_source, status, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [q.quote_id, q.revision_no || 1, q.rate, q.quantity_kg, q.grand_total,
       q.unit_cost, q.margin_pct, q.rate_source, q.status, reason || null, user || null]);
  }

  // Revise a quote: keep the old figures as a revision, then apply the new ones.
  // A SENT or CONVERTED quote can still be revised — that is exactly what
  // "send me a better rate" means — but it starts a new revision rather than
  // silently mutating what the customer already has.
  async function revise(quoteId, { rate, quantity_kg, reason }, user) {
    const q = (await pool.query(`SELECT * FROM wa_quotes WHERE quote_id=$1`, [quoteId])).rows[0];
    if (!q) return { error: 'Quote not found', code: 404 };
    if (q.status === 'CONVERTED') return { error: 'Quote is already an order', code: 409 };

    await snapshotRevision(q, { reason, user });

    const newRate = rate != null ? r2(Number(rate)) : (q.rate ? Number(q.rate) : null);
    const newQty = quantity_kg != null ? Number(quantity_kg) : Number(q.quantity_kg);
    if (!newRate) return { error: 'A rate is required to revise', code: 400 };

    const t = computeTax(
      [{ item_name: q.product, quantity: newQty, rate: newRate, gst_rate: Number(q.gst_rate) }],
      q.supply_type).totals;

    const m = margin ? await margin.assess({ product: q.product, shade: q.shade, rate: newRate, quantity_kg: newQty }) : {};

    const r = await pool.query(
      `UPDATE wa_quotes
          SET revision_no = revision_no + 1,
              rate=$2, rate_source='MANAGER', quantity_kg=$3,
              taxable_value=$4, cgst_amount=$5, sgst_amount=$6, igst_amount=$7,
              round_off=$8, grand_total=$9, unit_cost=$10, margin_pct=$11,
              status='APPROVED', approved_by=$12, approved_at=NOW(), notes=COALESCE($13, notes)
        WHERE quote_id=$1 RETURNING *`,
      [quoteId, newRate, newQty, t.taxable, t.cgst, t.sgst, t.igst, t.round_off, t.grand,
       m.unit_cost ?? null, m.margin_pct ?? null, user || null, reason || null]);

    await logApproval(quoteId, 'EDIT_PRICE', q.rate, newRate, reason, user);
    return { quote: r.rows[0], margin: m, previous_revision: q.revision_no || 1 };
  }

  async function revisions(quoteId) {
    const r = await pool.query(
      `SELECT * FROM wa_quote_revisions WHERE quote_id=$1 ORDER BY revision_no DESC`, [quoteId]);
    return r.rows;
  }

  // Quotes past their validity are no longer offers. Expiring them also frees
  // the stock they were holding — the two must happen together or stock stays
  // reserved against a quote nobody can accept.
  async function expireQuotes() {
    const r = await pool.query(
      `UPDATE wa_quotes SET status='EXPIRED'
        WHERE status IN ('APPROVED','SENT')
          AND valid_until IS NOT NULL AND valid_until < CURRENT_DATE
        RETURNING quote_id`);
    for (const row of r.rows) {
      if (inventory) await inventory.releaseFor('QUOTE', row.quote_id, { by: 'SYSTEM', reason: 'Quote expired' });
    }
    return r.rows.length;
  }

  function logApproval(quoteId, action, oldRate, newRate, reason, user) {
    return pool.query(
      `INSERT INTO wa_quote_approvals (quote_id, action, old_rate, new_rate, reason, acted_by)
       VALUES ($1,$2,$3,$4,$5,$6)`, [quoteId, action, oldRate, newRate, reason || null, user || null]);
  }

  // Human-readable quote text for WhatsApp.
  function quoteText(q) {
    const L = [
      `*Quotation ${q.quote_no}*`,
      `${q.product}${q.shade ? ` — ${q.shade}` : ''}${q.gsm ? ` (${q.gsm} GSM)` : ''}`,
      `Quantity: ${Number(q.quantity_kg)} kg`,
      `Rate: ₹${Number(q.rate)}/kg`,
      `Taxable: ₹${Number(q.taxable_value)}`,
    ];
    if (Number(q.igst_amount) > 0) L.push(`IGST ${q.gst_rate}%: ₹${Number(q.igst_amount)}`);
    else L.push(`CGST ${Number(q.gst_rate) / 2}%: ₹${Number(q.cgst_amount)}`, `SGST ${Number(q.gst_rate) / 2}%: ₹${Number(q.sgst_amount)}`);
    L.push(`*Total: ₹${Number(q.grand_total)}*`);
    if (q.payment_terms) L.push(`Payment terms: ${q.payment_terms}`);
    return L.join('\n');
  }

  // §9 — a confirmation never creates the live order directly.
  async function createDraftOrder(b, user) {
    const q = b.quote_id ? (await pool.query(`SELECT * FROM wa_quotes WHERE quote_id=$1`, [b.quote_id])).rows[0] : null;
    if (b.quote_id && !q) return { error: 'Quote not found', code: 404 };
    if (q && q.status === 'PENDING_PRICE_APPROVAL') return { error: 'Quote price is not approved yet', code: 409 };

    const r = await pool.query(
      `INSERT INTO wa_draft_orders (conversation_id, quote_id, partner_id, customer_name, product, shade, gsm,
        quantity_kg, rate, grand_total, delivery_terms, payment_terms, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [b.conversation_id || q?.conversation_id || null, b.quote_id || null,
       b.partner_id || q?.partner_id || null, b.customer_name || q?.customer_name || null,
       b.product || q?.product || null, b.shade || q?.shade || null, b.gsm || q?.gsm || null,
       Number(b.quantity_kg || q?.quantity_kg) || 0, b.rate ?? q?.rate ?? null,
       Number(b.grand_total || q?.grand_total) || 0,
       b.delivery_terms || null, b.payment_terms || q?.payment_terms || null, user || null]);
    if (io) io.emit('wa_draft_order', { draft: r.rows[0] });
    return { draft: r.rows[0] };
  }

  // Employee confirmation -> real MES sales order.
  async function confirmDraft(draftId, user, { userRole } = {}) {
    const d = (await pool.query(`SELECT * FROM wa_draft_orders WHERE draft_id=$1`, [draftId])).rows[0];
    if (!d) return { error: 'Draft not found', code: 404 };
    if (d.status !== 'PENDING') return { error: `Draft already ${d.status}`, code: 409 };

    // HIGH-05 — re-check credit HERE, not at quotation. A customer can pass the
    // check when quoted and breach it days later by ordering elsewhere or
    // letting an invoice fall overdue.
    if (approvals) {
      const credit = await approvals.creditCheck(d.partner_id, d.grand_total);
      if (!credit.ok) {
        const cleared = await approvals.isApproved('ORDER', draftId, credit.reason);
        if (cleared !== true) {
          const req = await approvals.request({
            docType: 'ORDER', docId: draftId, reason: credit.reason,
            detail: credit.note, value: d.grand_total, requestedBy: user,
          });
          return {
            error: credit.note, code: 409, credit_hold: true,
            approval_request_id: req.request_id, required_role: req.required_role,
          };
        }
      }

      // Value band: a large order needs a senior signature even with clean credit.
      const needed = await approvals.requiredRole('ORDER', d.grand_total);
      if (!approvals.canApprove(userRole, needed)) {
        const cleared = await approvals.isApproved('ORDER', draftId, 'VALUE_BAND');
        if (cleared !== true) {
          const req = await approvals.request({
            docType: 'ORDER', docId: draftId, reason: 'VALUE_BAND',
            detail: `Order value ${Number(d.grand_total)} requires ${needed} approval`,
            value: d.grand_total, requestedBy: user,
          });
          return {
            error: `Orders of this value require ${needed} approval.`, code: 403,
            approval_required: true, approval_request_id: req.request_id, required_role: needed,
          };
        }
      }
    }

    let soNumber;
    if (nextInvSeq) { try { soNumber = await nextInvSeq('SO'); } catch { /* fall through */ } }
    if (!soNumber) {
      const n = await pool.query(`SELECT COUNT(*) c FROM sales_orders`);
      soNumber = `SO-${new Date().getFullYear()}-${String(Number(n.rows[0].c) + 1).padStart(3, '0')}`;
    }

    const so = await pool.query(
      `INSERT INTO sales_orders (so_number, partner_id, customer_name, order_date, status, payment_terms, notes, total_amount, created_by)
       VALUES ($1,$2,$3,CURRENT_DATE,'DRAFT',$4,$5,$6,$7) RETURNING *`,
      [soNumber, d.partner_id, d.customer_name, d.payment_terms,
       `From WhatsApp draft #${draftId}${d.quote_id ? ` (quote ${d.quote_id})` : ''}: ${d.product || ''} ${d.shade || ''} ${Number(d.quantity_kg)}kg`,
       Number(d.grand_total) || 0, user || null]);

    await pool.query(`UPDATE wa_draft_orders SET status='CONFIRMED', so_number=$1, confirmed_by=$2, confirmed_at=NOW() WHERE draft_id=$3`,
      [soNumber, user || null, draftId]);

    // The quote's SOFT hold becomes a firm commitment against the real order.
    if (inventory && d.quote_id) {
      await inventory.promoteToHard('QUOTE', d.quote_id, { newRefType: 'ORDER', newRefId: soNumber, by: user });
    }
    if (d.quote_id) await pool.query(`UPDATE wa_quotes SET status='CONVERTED' WHERE quote_id=$1`, [d.quote_id]);

    return { ok: true, so_number: soNumber, sales_order: so.rows[0] };
  }

  return { createQuote, act, quoteText, createDraftOrder, confirmDraft, lastRateFor, authorisedRateFor,
           revise, revisions, expireQuotes };
};
