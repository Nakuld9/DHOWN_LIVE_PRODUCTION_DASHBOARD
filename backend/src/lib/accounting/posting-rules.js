// Posting rules — turn an operational document into balanced accounting lines.
// Pure (no DB), unit-tested. Rupee strings in, {ledger_id, dr_amount, cr_amount}
// lines out. The GST amounts on a MES tax invoice are already computed by the
// invoice flow; we map them to ledgers rather than recomputing, and prove the
// result balances to the invoice grand total.
const R = require('./rules');

const P = (v) => R.toPaise(v) || 0;
const S = (p) => R.fromPaise(p);

// Split a taxable value at a GST rate into CGST/SGST (intra) or IGST (inter).
// Paise-exact: SGST takes the rounding remainder so CGST+SGST = total tax.
function gstSplit(taxablePaise, ratePct, intra) {
  const total = Math.round((taxablePaise * (Number(ratePct) || 0)) / 100);
  if (!intra) return { cgst: 0, sgst: 0, igst: total };
  const cgst = Math.floor(total / 2);
  return { cgst, sgst: total - cgst, igst: 0 };
}

// Build sales-invoice journal lines from a computed MES tax invoice.
//   Dr  Customer           grand_total
//   Cr  Sales              taxable_value
//   Cr  Output CGST/SGST/IGST (as present)
//   Dr/Cr Round Off        (the plug, by sign)
// sys = { SALES, OUTPUT_CGST, OUTPUT_SGST, OUTPUT_IGST, ROUND_OFF } ledger ids.
function salesInvoiceLines(inv, sys, partyLedgerId) {
  if (!partyLedgerId) throw new R.AccountingError('No customer ledger for the invoice party', 'ACCT_INVALID');
  const taxable = P(inv.taxable_value);
  const cgst = P(inv.cgst_amount), sgst = P(inv.sgst_amount), igst = P(inv.igst_amount);
  const grand = P(inv.grand_total);
  if (grand <= 0) throw new R.AccountingError('Invoice has no value to post', 'ACCT_INVALID');

  const lines = [{ ledger_id: partyLedgerId, dr_amount: S(grand), cr_amount: '0', narration: `Being sales vide ${inv.invoice_number}` }];
  const cr = (ledger, p, note) => { if (p > 0) lines.push({ ledger_id: ledger, dr_amount: '0', cr_amount: S(p), narration: note }); };
  cr(sys.SALES, taxable, 'Sales');
  cr(sys.OUTPUT_CGST, cgst, 'Output CGST');
  cr(sys.OUTPUT_SGST, sgst, 'Output SGST');
  cr(sys.OUTPUT_IGST, igst, 'Output IGST');

  // Plug = grand - (taxable + taxes). Equals the invoice round_off by construction.
  const plug = grand - (taxable + cgst + sgst + igst);
  if (plug > 0) lines.push({ ledger_id: sys.ROUND_OFF, dr_amount: '0', cr_amount: S(plug), narration: 'Round off' });
  else if (plug < 0) lines.push({ ledger_id: sys.ROUND_OFF, dr_amount: S(-plug), cr_amount: '0', narration: 'Round off' });

  // Safety: the lines must balance exactly (never post a lopsided journal).
  const dr = lines.reduce((s, l) => s + P(l.dr_amount), 0);
  const crT = lines.reduce((s, l) => s + P(l.cr_amount), 0);
  if (dr !== crT) throw new R.AccountingError(`Sales invoice ${inv.invoice_number} does not balance (Dr ${S(dr)} / Cr ${S(crT)})`, 'ACCT_CONFLICT');
  return lines;
}

// Compute a document (sales/purchase) from item lines. Pure, paise-exact.
//   line: { item_id?, item_name, hsn_code?, quantity, uom?, rate, discount_pct?, gst_rate }
// Returns { items:[...with computed paise+rupee fields], totals:{taxable,cgst,sgst,igst,tax,round_off,grand} }.
// intra => CGST+SGST, else IGST. round=true rounds the grand total to the nearest rupee.
function computeDocument({ lines, intra, round = true } = {}) {
  if (!Array.isArray(lines) || !lines.some((l) => l && (l.item_name || l.item_id))) {
    throw new R.AccountingError('Add at least one item line', 'ACCT_LINES');
  }
  const items = []; let tTaxable = 0, tC = 0, tS = 0, tI = 0;
  lines.forEach((l, i) => {
    if (!l || (!l.item_name && !l.item_id)) return;
    const qty = Number(l.quantity);
    if (!(qty > 0)) throw new R.AccountingError(`Item ${i + 1}: quantity must be greater than 0`, 'ACCT_LINES');
    const ratePaise = P(l.rate);
    const gross = Math.round(qty * ratePaise);
    const discPct = Number(l.discount_pct) || 0;
    if (discPct < 0 || discPct > 100) throw new R.AccountingError(`Item ${i + 1}: discount % must be 0–100`, 'ACCT_LINES');
    const discount = Math.round(gross * discPct / 100);
    const taxable = gross - discount;
    const rate = Number(l.gst_rate) || 0;
    const { cgst, sgst, igst } = gstSplit(taxable, rate, intra);
    const line_total = taxable + cgst + sgst + igst;
    tTaxable += taxable; tC += cgst; tS += sgst; tI += igst;
    items.push({
      line_no: items.length + 1, item_id: l.item_id || null, item_name: l.item_name || '', hsn_code: l.hsn_code || null,
      quantity: qty, uom: l.uom || null, rate: S(ratePaise), discount_pct: discPct || 0,
      taxable_value: S(taxable), gst_rate: rate, cgst_amount: S(cgst), sgst_amount: S(sgst), igst_amount: S(igst), line_total: S(line_total),
      _p: { taxable, cgst, sgst, igst },
    });
  });
  const grandPre = tTaxable + tC + tS + tI;
  const grand = round ? Math.round(grandPre / 100) * 100 : grandPre;
  const round_off = grand - grandPre;
  return {
    items,
    totals: { taxable: S(tTaxable), cgst: S(tC), sgst: S(tS), igst: S(tI), tax: S(tC + tS + tI), round_off: S(round_off), grand: S(grand),
      _p: { taxable: tTaxable, cgst: tC, sgst: tS, igst: tI, round_off, grand } },
  };
}

// Build balanced accounting lines for a document voucher from its totals.
// type: SALES | PURCHASE | SALES_RETURN | PURCHASE_RETURN | CREDIT_NOTE | DEBIT_NOTE.
//
// GST credit/debit notes reuse the return posting exactly (the common Busy/Indian
// convention): a CREDIT_NOTE is the sale-side reduction (Dr Sales + Output GST /
// Cr Customer — same legs as SALES_RETURN) and a DEBIT_NOTE is the purchase-side
// reduction (Dr Supplier / Cr Purchase + Input GST — same legs as PURCHASE_RETURN).
function documentVoucherLines(type, totals, sys, partyLedgerId, ref) {
  if (!partyLedgerId) throw new R.AccountingError('No party ledger for the document', 'ACCT_INVALID');
  const t = totals._p;
  const note = ref ? `vide ${ref}` : '';
  const narr = { SALES: 'Being sales', SALES_RETURN: 'Being sales return', CREDIT_NOTE: 'Being credit note',
    PURCHASE: 'Being purchase', PURCHASE_RETURN: 'Being purchase return', DEBIT_NOTE: 'Being debit note' }[type] || 'Being document';
  const L = [];
  const dr = (ledger, p, n) => { if (p > 0) L.push({ ledger_id: ledger, dr_amount: S(p), cr_amount: '0', narration: n }); };
  const cr = (ledger, p, n) => { if (p > 0) L.push({ ledger_id: ledger, dr_amount: '0', cr_amount: S(p), narration: n }); };

  if (type === 'SALES' || type === 'SALES_RETURN' || type === 'CREDIT_NOTE') {
    const income = type === 'SALES';          // sale: party Dr; return / credit note: party Cr
    (income ? dr : cr)(partyLedgerId, t.grand, `${narr} ${note}`.trim());
    (income ? cr : dr)(sys.SALES, t.taxable, 'Sales');
    (income ? cr : dr)(sys.OUTPUT_CGST, t.cgst, 'Output CGST');
    (income ? cr : dr)(sys.OUTPUT_SGST, t.sgst, 'Output SGST');
    (income ? cr : dr)(sys.OUTPUT_IGST, t.igst, 'Output IGST');
  } else if (type === 'PURCHASE' || type === 'PURCHASE_RETURN' || type === 'DEBIT_NOTE') {
    const buy = type === 'PURCHASE';          // purchase: party Cr; return / debit note: party Dr
    (buy ? dr : cr)(sys.PURCHASE, t.taxable, 'Purchase');
    (buy ? dr : cr)(sys.INPUT_CGST, t.cgst, 'Input CGST');
    (buy ? dr : cr)(sys.INPUT_SGST, t.sgst, 'Input SGST');
    (buy ? dr : cr)(sys.INPUT_IGST, t.igst, 'Input IGST');
    (buy ? cr : dr)(partyLedgerId, t.grand, `${narr} ${note}`.trim());
  } else {
    throw new R.AccountingError(`Unsupported document voucher type ${type}`, 'ACCT_INVALID');
  }

  // Round-off plug so the journal ties exactly.
  const d = L.reduce((s, l) => s + P(l.dr_amount), 0);
  const c = L.reduce((s, l) => s + P(l.cr_amount), 0);
  const plug = d - c;
  if (plug > 0) cr(sys.ROUND_OFF, plug, 'Round off');
  else if (plug < 0) dr(sys.ROUND_OFF, -plug, 'Round off');
  return L;
}

module.exports = { gstSplit, salesInvoiceLines, computeDocument, documentVoucherLines };
