// Purchase Invoice AI (spec §5) — the validation + price-intelligence layer on top
// of the OCR extraction (src/lib/invoice-ocr.js).
//
// Given the extracted invoice fields, it runs MES-side checks — duplicate invoice,
// GST arithmetic, GSTIN format, HSN presence, supplier/PO recognition — and price
// intelligence (this rate vs the yarn's own purchase history), then prepares a
// PROPOSED entry. It NEVER posts: the caller queues the draft for human approval.
//
// HONESTY: every check reports what MES can see. It never asserts statutory
// non-compliance — a GST arithmetic mismatch is "check the tax figures", not
// "GST violation". Confirming ITC/GSTIN status against the portal is out of scope.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d) => { const n = parseFloat(process.env[v]); return Number.isFinite(n) ? n : d; };
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PRICE_ALERT_PCT = num('PURCHASE_PRICE_ALERT_PCT', 5);   // flag rate change beyond this %
const tok = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);

module.exports = (pool) => {
  const audit = require('./audit')(pool);
  const q = async (sql, p = []) => { try { return (await pool.query(sql, p)).rows; } catch { return null; } };

  // Previous purchase rate for a yarn-like description, from approved GRN lines.
  async function previousRate(description) {
    const toks = tok(description);
    if (!toks.length) return null;
    const score = toks.map((_, i) => `(CASE WHEN LOWER(COALESCE(yl.yarn_type,'')||' '||COALESCE(yl.count,'')) LIKE '%'||$${i + 1}||'%' THEN 1 ELSE 0 END)`).join(' + ');
    const rows = await q(`
      SELECT yl.rate_per_kg, yl.created_at, (${score}) AS s
        FROM yarn_lots yl JOIN grn g ON g.grn_id = yl.grn_id
       WHERE g.status = 'APPROVED' AND yl.rate_per_kg > 0 AND (${score}) > 0
       ORDER BY s DESC, yl.created_at DESC LIMIT 5`, toks);
    if (!rows || !rows.length) return null;
    const avg = rows.reduce((a, x) => a + Number(x.rate_per_kg), 0) / rows.length;
    return { avg_rate: r2(avg), samples: rows.length, last_rate: r2(rows[0].rate_per_kg) };
  }

  async function review(extracted, { by } = {}) {
    if (!extracted) return { error: 'No extracted invoice data to review.' };
    const e = extracted;
    const checks = [];
    const add = (key, status, message) => checks.push({ key, status, message });

    // 1. Duplicate invoice — same supplier + supplier invoice number already received.
    if (e.invoice_no) {
      const dup = await q(`
        SELECT grn_number FROM grn
         WHERE COALESCE(status,'') <> 'CANCELLED'
           AND RIGHT(REGEXP_REPLACE(LOWER(COALESCE(supplier_invoice,'')),'[^a-z0-9]','','g'), 20)
             = RIGHT(REGEXP_REPLACE(LOWER($1),'[^a-z0-9]','','g'), 20)
           AND ($2 = '' OR LOWER(supplier_name) LIKE '%'||LOWER($2)||'%')
         LIMIT 1`, [e.invoice_no, e.supplier_name || '']);
      if (dup && dup.length) add('duplicate', 'fail', `Invoice ${e.invoice_no} already received on GRN ${dup[0].grn_number} — possible duplicate.`);
      else add('duplicate', 'ok', 'No existing GRN carries this supplier invoice number.');
    } else add('duplicate', 'warn', 'No invoice number extracted — cannot check for duplicates.');

    // 2. GST arithmetic — subtotal + tax should equal total (within ₹1).
    if (e.subtotal != null && e.tax_amount != null && e.total_amount != null) {
      const drift = r2(e.subtotal + e.tax_amount - e.total_amount);
      if (Math.abs(drift) <= 1) add('gst_math', 'ok', `Totals reconcile (subtotal ${e.subtotal} + tax ${e.tax_amount} = ${e.total_amount}).`);
      else add('gst_math', 'warn', `Subtotal + tax (${r2(e.subtotal + e.tax_amount)}) does not match the stated total (${e.total_amount}); off by ₹${drift}. Check the tax figures.`);
    } else add('gst_math', 'warn', 'Subtotal/tax/total not all present — GST arithmetic not verified.');

    // 3. GSTIN format (format only — not a portal validity check).
    if (e.supplier_gstin) {
      add('gstin', GSTIN_RE.test(e.supplier_gstin.toUpperCase()) ? 'ok' : 'warn',
        GSTIN_RE.test(e.supplier_gstin.toUpperCase()) ? `GSTIN ${e.supplier_gstin} has a valid format.` : `GSTIN ${e.supplier_gstin} does not match the standard 15-character format — verify.`);
    } else add('gstin', 'warn', 'No supplier GSTIN extracted.');

    // 4. HSN presence on line items.
    const noHsn = (e.items || []).filter(it => !it.hsn).length;
    if (!e.items || !e.items.length) add('hsn', 'warn', 'No line items extracted.');
    else if (noHsn) add('hsn', 'info', `${noHsn} of ${e.items.length} line(s) have no HSN code.`);
    else add('hsn', 'ok', 'All line items carry an HSN code.');

    // 5. Supplier recognised in the partner master?
    if (e.supplier_name || e.supplier_gstin) {
      const p = await q(`
        SELECT company_name FROM partners
         WHERE (($1 <> '' AND LOWER(company_name) LIKE '%'||LOWER($1)||'%')
             OR ($2 <> '' AND UPPER(COALESCE(gstin,'')) = UPPER($2)))
         LIMIT 1`, [e.supplier_name || '', e.supplier_gstin || '']);
      if (p && p.length) add('supplier', 'ok', `Supplier recognised: ${p[0].company_name}.`);
      else add('supplier', 'info', 'Supplier not found in the partner master — add them, or map on import.');
    }

    // 6. Open PO for this supplier?
    if (e.supplier_name) {
      const po = await q(`
        SELECT po_number FROM purchase_orders
         WHERE LOWER(supplier_name) LIKE '%'||LOWER($1)||'%'
           AND UPPER(COALESCE(status,'')) NOT IN ('CLOSED','CANCELLED','COMPLETED')
         ORDER BY order_date DESC LIMIT 1`, [e.supplier_name]);
      if (po && po.length) add('po', 'ok', `Open PO ${po[0].po_number} exists for this supplier — match the invoice against it.`);
      else add('po', 'info', 'No open PO found for this supplier.');
    }

    // 7. Price intelligence — each line's rate vs its own purchase history.
    const price_intelligence = [];
    for (const it of (e.items || [])) {
      if (!(it.rate > 0)) continue;
      const prev = await previousRate(it.description);
      if (!prev) { price_intelligence.push({ item: it.description, rate: r2(it.rate), previous: null, note: 'No prior purchase of a similar item to compare.' }); continue; }
      const changePct = prev.avg_rate > 0 ? r2(((it.rate - prev.avg_rate) / prev.avg_rate) * 100) : 0;
      price_intelligence.push({
        item: it.description, rate: r2(it.rate), previous_avg: prev.avg_rate, last_rate: prev.last_rate,
        change_pct: changePct,
        flag: Math.abs(changePct) >= PRICE_ALERT_PCT ? (changePct > 0 ? 'INCREASE' : 'DECREASE') : 'OK',
        note: Math.abs(changePct) >= PRICE_ALERT_PCT
          ? `Rate ${changePct > 0 ? 'increased' : 'decreased'} ${Math.abs(changePct)}% vs the recent average (₹${prev.avg_rate}/kg over ${prev.samples} lot(s)).`
          : `In line with recent purchases (₹${prev.avg_rate}/kg).`,
      });
    }

    const fails = checks.filter(c => c.status === 'fail').length;
    const warns = checks.filter(c => c.status === 'warn').length;
    const priceFlags = price_intelligence.filter(p => p.flag && p.flag !== 'OK').length;
    const verdict = fails ? 'REVIEW_REQUIRED' : (warns || priceFlags ? 'REVIEW_SUGGESTED' : 'LOOKS_CLEAN');

    const summary = {
      supplier: e.supplier_name, invoice_no: e.invoice_no, total: e.total_amount,
      verdict, checks_failed: fails, checks_warned: warns, price_flags: priceFlags,
    };

    await audit.record({
      actor: by || null, agent: 'accountant', action: 'REVIEW_PURCHASE_INVOICE',
      entity_type: 'purchase_invoice', entity_id: e.invoice_no || null,
      after: summary, reason: `Reviewed purchase invoice: ${verdict}`, status: 'AI_RECOMMENDED',
    });

    return {
      summary, checks, price_intelligence,
      proposed_entry: {
        type: 'PURCHASE_VOUCHER', supplier: e.supplier_name, supplier_gstin: e.supplier_gstin,
        invoice_no: e.invoice_no, invoice_date: e.invoice_date,
        taxable: e.subtotal, tax: e.tax_amount, total: e.total_amount, lines: e.items,
        note: 'Draft only. Review the checks, then post into Busy via the normal GRN/purchase flow — nothing has been posted.',
      },
    };
  }

  return { review, previousRate };
};
