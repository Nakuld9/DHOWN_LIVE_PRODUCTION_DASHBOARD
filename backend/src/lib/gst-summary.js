// Busy-style consolidated GST Summary — the single-screen net-tax working that
// Busy shows under Display → GST Reports → GST Summaries → GST Summary.
//
// Unlike GSTR-1 (a return form, outward only) this is BOTH sides netted to a
// payable, broken down by rate slab × supply type (Local / Inter-State / Import):
//
//   Output GST          from MES tax_invoices + tax_invoice_items          (live)
//   Dr/Cr Note (Output) from credit_notes                                   (live)
//   Input GST           from the accounting engine's POSTED purchase        (fills
//                       vouchers (acct.voucher_items)                        as used)
//   ITC (GSTR-2B)       from an uploaded 2B, if present                      (optional)
//   Tax Calculation     Output − Input(ITC) + opening → net payable per head
//
// Honest by construction: the input side is only as complete as the purchases
// actually entered in Accounting; the summary says so rather than inventing ITC.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Statutory ITC set-off (Rule 88A order): IGST credit clears IGST → CGST → SGST;
// CGST credit clears CGST → IGST; SGST credit clears SGST → IGST. CGST and SGST
// credit can never offset each other. Returns cash payable per head + credit c/f.
function computeSetOff(liability, credit) {
  const liab = { igst: liability.igst, cgst: liability.cgst, sgst: liability.sgst };
  const cr = { igst: credit.igst, cgst: credit.cgst, sgst: credit.sgst };
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const use = (from, to) => { const u = Math.min(Math.max(cr[from], 0), Math.max(liab[to], 0)); cr[from] = r2(cr[from] - u); liab[to] = r2(liab[to] - u); };
  use('igst', 'igst'); use('igst', 'cgst'); use('igst', 'sgst');
  use('cgst', 'cgst'); use('cgst', 'igst');
  use('sgst', 'sgst'); use('sgst', 'igst');
  return {
    payable_cash: { igst: r2(Math.max(liab.igst, 0)), cgst: r2(Math.max(liab.cgst, 0)), sgst: r2(Math.max(liab.sgst, 0)),
      total: r2(Math.max(liab.igst, 0) + Math.max(liab.cgst, 0) + Math.max(liab.sgst, 0)) },
    credit_carried_forward: { igst: r2(Math.max(cr.igst, 0)), cgst: r2(Math.max(cr.cgst, 0)), sgst: r2(Math.max(cr.sgst, 0)) },
  };
}

module.exports = (pool) => {
  const emptyHead = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
  const addInto = (acc, x, sign = 1) => { acc.taxable += sign * (Number(x.taxable) || 0); acc.igst += sign * (Number(x.igst) || 0); acc.cgst += sign * (Number(x.cgst) || 0); acc.sgst += sign * (Number(x.sgst) || 0); };
  const round = (h) => ({ taxable: r2(h.taxable), igst: r2(h.igst), cgst: r2(h.cgst), sgst: r2(h.sgst), total_tax: r2(h.igst + h.cgst + h.sgst) });
  const rateLabel = (rate, type) => `@ ${Number(rate) || 0}% (${type})`;

  // Build a rate × type block from rows carrying {gst_rate, type, taxable, igst, cgst, sgst}.
  function block(rows) {
    const map = new Map(); const total = emptyHead();
    for (const x of rows) {
      const type = x.type;
      const key = `${type}|${Number(x.gst_rate) || 0}`;
      if (!map.has(key)) map.set(key, { gst_rate: Number(x.gst_rate) || 0, type, ...emptyHead() });
      addInto(map.get(key), x); addInto(total, x);
    }
    const lines = [...map.values()]
      .sort((a, b) => a.gst_rate - b.gst_rate || a.type.localeCompare(b.type))
      .map((l) => ({ label: rateLabel(l.gst_rate, l.type), gst_rate: l.gst_rate, type: l.type, ...round(l) }));
    return { lines, total: round(total) };
  }

  async function appSetting(key) {
    try { return (await pool.query(`SELECT value FROM public.app_settings WHERE key=$1`, [key])).rows[0]?.value || null; }
    catch { return null; }
  }

  async function summary({ from = null, to = null } = {}) {
    const p = [from, to];

    // ── Output GST (live) — rate-wise from the invoice LINES, Local vs Inter ──
    const outRows = (await pool.query(`
      SELECT ii.gst_rate,
             CASE WHEN COALESCE(ti.igst_amount,0) > 0 THEN 'Inter-State' ELSE 'Local' END AS type,
             SUM(ii.taxable_value) AS taxable, SUM(ii.igst_amount) AS igst,
             SUM(ii.cgst_amount) AS cgst, SUM(ii.sgst_amount) AS sgst
        FROM tax_invoices ti JOIN tax_invoice_items ii ON ii.invoice_id = ti.invoice_id
       WHERE ti.status <> 'CANCELLED'
         AND ($1::date IS NULL OR ti.invoice_date >= $1::date)
         AND ($2::date IS NULL OR ti.invoice_date <= $2::date)
       GROUP BY ii.gst_rate, type`, p)).rows;
    const output = block(outRows);

    // ── Dr/Cr Note (Output) — note level (no rate split), Local vs Inter ──────
    const noteRows = (await pool.query(`
      SELECT (COALESCE(ti.igst_amount,0) > 0) AS interstate,
             cn.taxable_value, cn.tax_amount
        FROM credit_notes cn LEFT JOIN tax_invoices ti ON ti.invoice_id = cn.invoice_id
       WHERE cn.status = 'ACTIVE'
         AND ($1::date IS NULL OR cn.note_date >= $1::date)
         AND ($2::date IS NULL OR cn.note_date <= $2::date)`, p)).rows;
    const noteBlk = { Local: emptyHead(), 'Inter-State': emptyHead() };
    for (const n of noteRows) {
      const t = n.interstate ? 'Inter-State' : 'Local'; const tax = Number(n.tax_amount) || 0;
      addInto(noteBlk[t], { taxable: n.taxable_value, igst: n.interstate ? tax : 0, cgst: n.interstate ? 0 : tax / 2, sgst: n.interstate ? 0 : tax / 2 });
    }
    const notesTotal = emptyHead();
    const notesLines = Object.entries(noteBlk).filter(([, h]) => h.taxable || h.igst || h.cgst || h.sgst)
      .map(([type, h]) => { addInto(notesTotal, h); return { label: `Dr/Cr Note (${type})`, type, ...round(h) }; });
    const output_notes = { lines: notesLines, total: round(notesTotal) };

    // ── Input GST — from POSTED purchase vouchers in the accounting engine ────
    let input = { lines: [], total: round(emptyHead()) }; let inputVouchers = 0;
    try {
      const inRows = (await pool.query(`
        SELECT vi.gst_rate,
               CASE WHEN COALESCE(vi.igst_amount,0) > 0 THEN 'Inter-State' ELSE 'Local' END AS type,
               SUM(vi.taxable_value) * CASE WHEN v.voucher_type='PURCHASE_RETURN' THEN -1 ELSE 1 END AS taxable,
               SUM(vi.igst_amount)   * CASE WHEN v.voucher_type='PURCHASE_RETURN' THEN -1 ELSE 1 END AS igst,
               SUM(vi.cgst_amount)   * CASE WHEN v.voucher_type='PURCHASE_RETURN' THEN -1 ELSE 1 END AS cgst,
               SUM(vi.sgst_amount)   * CASE WHEN v.voucher_type='PURCHASE_RETURN' THEN -1 ELSE 1 END AS sgst
          FROM acct.voucher_items vi JOIN acct.vouchers v ON v.voucher_id = vi.voucher_id
         WHERE v.status='POSTED' AND v.voucher_type IN ('PURCHASE','PURCHASE_RETURN')
           AND ($1::date IS NULL OR v.voucher_date >= $1::date)
           AND ($2::date IS NULL OR v.voucher_date <= $2::date)
         GROUP BY vi.gst_rate, type, v.voucher_type`, p)).rows;
      input = block(inRows);
      inputVouchers = (await pool.query(`SELECT COUNT(*)::int n FROM acct.vouchers WHERE status='POSTED' AND voucher_type IN ('PURCHASE','PURCHASE_RETURN')
         AND ($1::date IS NULL OR voucher_date >= $1::date) AND ($2::date IS NULL OR voucher_date <= $2::date)`, p)).rows[0].n;
    } catch { /* acct schema not present */ }

    // ── Import IGST (customs) — recoverable ITC from the Import Control Tower ──
    let importItc = null;
    try {
      const r = (await pool.query(`
        SELECT COALESCE(SUM(COALESCE(ic.igst_recoverable, ic.igst)), 0) AS igst, COALESCE(SUM(ic.igst), 0) AS igst_gross
          FROM import_costs ic
         WHERE ($1::date IS NULL OR ic.created_at::date >= $1::date)
           AND ($2::date IS NULL OR ic.created_at::date <= $2::date)`, p)).rows[0];
      if (r && Number(r.igst) > 0) importItc = { igst: r2(r.igst), igst_gross: r2(r.igst_gross) };
    } catch { /* imports module absent */ }

    // ── ITC from an uploaded GSTR-2B (optional, totals only) ──────────────────
    let itc2b = null;
    try {
      const r = (await pool.query(`SELECT COALESCE(SUM(eligible_cgst),0) cgst, COALESCE(SUM(eligible_sgst),0) sgst, COALESCE(SUM(eligible_igst),0) igst
        FROM gst_2b_imports WHERE ($1::date IS NULL OR period_from >= $1::date) OR $1::date IS NULL`, [from])).rows[0];
      if (r && (Number(r.cgst) || Number(r.sgst) || Number(r.igst))) itc2b = { cgst: r2(r.cgst), sgst: r2(r.sgst), igst: r2(r.igst), total_tax: r2(Number(r.cgst) + Number(r.sgst) + Number(r.igst)) };
    } catch { /* table/columns absent */ }

    // ── Tax Calculation → net payable per head ───────────────────────────────
    const opening = { cgst: Number(await appSetting('gst_opening_cgst')) || 0, sgst: Number(await appSetting('gst_opening_sgst')) || 0, igst: Number(await appSetting('gst_opening_igst')) || 0 };
    const outputTax = { cgst: r2(output.total.cgst - notesTotal.cgst), sgst: r2(output.total.sgst - notesTotal.sgst), igst: r2(output.total.igst - notesTotal.igst) };
    // ITC = native purchase vouchers + recoverable import IGST (2B shown as a
    // reconciliation reference, not double-counted).
    const importIgst = importItc ? importItc.igst : 0;
    const itc = { cgst: input.total.cgst, sgst: input.total.sgst, igst: r2(input.total.igst + importIgst) };
    const net = {
      cgst: r2(outputTax.cgst - itc.cgst - opening.cgst),
      sgst: r2(outputTax.sgst - itc.sgst - opening.sgst),
      igst: r2(outputTax.igst - itc.igst - opening.igst),
    };
    net.total = r2(net.cgst + net.sgst + net.igst);

    // Statutory ITC set-off → tax payable in cash + credit carried forward.
    const setOff = computeSetOff(outputTax, { cgst: r2(itc.cgst + opening.cgst), sgst: r2(itc.sgst + opening.sgst), igst: r2(itc.igst + opening.igst) });

    return {
      period: { from, to },
      output, output_notes, input, import_itc: importItc, itc_2b: itc2b,
      tax_calculation: {
        opening,
        output_tax: { ...outputTax, total_tax: r2(outputTax.cgst + outputTax.sgst + outputTax.igst) },
        input_itc: { ...itc, import_igst: importIgst, total_tax: r2(itc.cgst + itc.sgst + itc.igst) },
        net_payable: net,
        set_off: setOff, // Rule 88A: cash payable + ITC carried forward
      },
      sources: {
        output: 'MES sales invoices (tax_invoices) — live',
        output_notes: 'MES credit notes — live',
        input: `Accounting engine posted purchase vouchers — ${inputVouchers} voucher(s)`,
        import_itc: importItc ? 'Import Control Tower — recoverable customs IGST' : 'No import IGST in range',
        itc_2b: itc2b ? 'Uploaded GSTR-2B (totals)' : 'No GSTR-2B uploaded',
      },
      notes: [
        ...(inputVouchers === 0 ? ['No purchase vouchers posted in Accounting for this period — the Input GST side is empty. Enter purchases (Accounting → Purchase) or upload GSTR-2B for ITC.'] : []),
        'Input side reflects only purchases captured in the accounting engine; GRN yarn receipts post at value without GST unless entered as a purchase voucher.',
        'Net payable is a straight per-head net (Output − ITC − opening); statutory set-off ordering (IGST first) is not applied here.',
      ],
    };
  }

  return { summary };
};
module.exports.computeSetOff = computeSetOff;
