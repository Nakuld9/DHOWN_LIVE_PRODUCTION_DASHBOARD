// GSTR-1 summary — outward supplies for a return period.
//
// This is a summary to prepare and check a return against, not a filing export.
// It answers the question the accountant actually asks at the start of every
// month: what did we invoice, split the way the return wants it, and does it
// add up to our own sales figure.
//
// The classification rules are the return's, not ours:
//
//   B2B    customer has a GSTIN — reported invoice by invoice, rate-wise
//   B2CL   no GSTIN, inter-state, invoice value over 2,50,000 — also itemised
//   B2CS   everything else unregistered — reported only as a rate/state total
//   CDNR   credit notes against registered customers
//   CDNUR  credit notes against unregistered customers
//
// Two decisions worth stating:
//
//   - Rate-wise figures come from the LINE items, not the invoice header. An
//     invoice can carry 5% and 12% lines together, and the return wants them
//     apart. Summing the header would put the whole invoice in one rate bucket.
//   - Every section is derived from the same set of invoices, and `reconciles`
//     checks the sections add back to that set. A return that quietly drops an
//     invoice is the expensive failure here, and it is invisible unless checked.
//
// CANCELLED invoices are excluded throughout. A cancelled invoice is not a
// supply; including it would overstate liability and the tax would be paid on
// a sale that never happened.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const B2CL_THRESHOLD = 250000;

module.exports = (pool) => {

  // Every non-cancelled invoice in the period, with the classification already
  // decided so the sections cannot disagree about which bucket an invoice is in.
  const CLASSIFIED = `
    SELECT ti.invoice_id, ti.invoice_number, ti.invoice_date, ti.partner_id,
           ti.customer_name, ti.customer_gstin, ti.customer_state, ti.place_of_supply,
           ti.taxable_value, ti.cgst_amount, ti.sgst_amount, ti.igst_amount, ti.grand_total,
           (NULLIF(TRIM(COALESCE(ti.customer_gstin,'')), '') IS NOT NULL) AS registered,
           -- Inter-state is what drives IGST. The tax already charged is the
           -- most reliable signal available: supply_type is free text and is
           -- not always set, but IGST on the invoice means it was treated as
           -- inter-state at the time it was raised, and the return must match
           -- what was charged rather than what we would decide today.
           (COALESCE(ti.igst_amount,0) > 0) AS interstate
      FROM tax_invoices ti
     WHERE ti.status <> 'CANCELLED'
       AND ($1::date IS NULL OR ti.invoice_date >= $1::date)
       AND ($2::date IS NULL OR ti.invoice_date <= $2::date)`;

  async function summary({ from = null, to = null } = {}) {
    const p = [from, to];

    // ── B2B and B2CL: itemised, rate-wise ────────────────────────────────
    const rateWise = (await pool.query(`
      SELECT c.invoice_id, c.invoice_number, c.invoice_date, c.customer_name,
             c.customer_gstin, c.place_of_supply, c.registered, c.interstate,
             c.grand_total,
             ii.gst_rate,
             SUM(ii.taxable_value) AS taxable,
             SUM(ii.cgst_amount)   AS cgst,
             SUM(ii.sgst_amount)   AS sgst,
             SUM(ii.igst_amount)   AS igst
        FROM (${CLASSIFIED}) c
        JOIN tax_invoice_items ii ON ii.invoice_id = c.invoice_id
       GROUP BY c.invoice_id, c.invoice_number, c.invoice_date, c.customer_name,
                c.customer_gstin, c.place_of_supply, c.registered, c.interstate,
                c.grand_total, ii.gst_rate
       ORDER BY c.invoice_date, c.invoice_number, ii.gst_rate`, p)).rows;

    const line = (x) => ({
      invoice_id: x.invoice_id, invoice_number: x.invoice_number,
      invoice_date: x.invoice_date, customer_name: x.customer_name,
      gstin: x.customer_gstin || null, place_of_supply: x.place_of_supply || null,
      gst_rate: Number(x.gst_rate) || 0,
      taxable: r2(x.taxable), cgst: r2(x.cgst), sgst: r2(x.sgst), igst: r2(x.igst),
      invoice_value: r2(x.grand_total),
    });

    const b2b = rateWise.filter(x => x.registered).map(line);
    const b2cl = rateWise
      .filter(x => !x.registered && x.interstate && Number(x.grand_total) > B2CL_THRESHOLD)
      .map(line);

    // ── B2CS: consolidated, never itemised ───────────────────────────────
    // The return wants a single figure per rate and place of supply, so the
    // individual invoices are deliberately not carried through.
    const b2csRows = rateWise.filter(x =>
      !x.registered && !(x.interstate && Number(x.grand_total) > B2CL_THRESHOLD));
    const b2csMap = new Map();
    for (const x of b2csRows) {
      const key = `${x.interstate ? 'INTER' : 'INTRA'}|${x.place_of_supply || '-'}|${Number(x.gst_rate) || 0}`;
      const cur = b2csMap.get(key) || {
        type: x.interstate ? 'INTER' : 'INTRA',
        place_of_supply: x.place_of_supply || null,
        gst_rate: Number(x.gst_rate) || 0,
        taxable: 0, cgst: 0, sgst: 0, igst: 0, invoices: new Set(),
      };
      cur.taxable += Number(x.taxable) || 0;
      cur.cgst += Number(x.cgst) || 0;
      cur.sgst += Number(x.sgst) || 0;
      cur.igst += Number(x.igst) || 0;
      cur.invoices.add(x.invoice_id);
      b2csMap.set(key, cur);
    }
    const b2cs = [...b2csMap.values()].map(x => ({
      type: x.type, place_of_supply: x.place_of_supply, gst_rate: x.gst_rate,
      taxable: r2(x.taxable), cgst: r2(x.cgst), sgst: r2(x.sgst), igst: r2(x.igst),
      invoice_count: x.invoices.size,
    })).sort((a, b) => a.type.localeCompare(b.type) || a.gst_rate - b.gst_rate);

    // ── Credit notes ─────────────────────────────────────────────────────
    // credit_notes carries taxable_value and a single tax_amount, with no
    // rate-wise split — a note is raised against a return, not re-priced line
    // by line. So these are reported at note level and the rate column is left
    // out rather than guessed at.
    const notes = (await pool.query(`
      SELECT cn.note_id, cn.note_number, cn.note_date, cn.invoice_id,
             ti.invoice_number, ti.customer_gstin, ti.customer_name, ti.place_of_supply,
             cn.taxable_value, cn.tax_amount, cn.amount,
             (NULLIF(TRIM(COALESCE(ti.customer_gstin,'')), '') IS NOT NULL) AS registered
        FROM credit_notes cn
        LEFT JOIN tax_invoices ti ON ti.invoice_id = cn.invoice_id
       WHERE cn.status = 'ACTIVE'
         AND ($1::date IS NULL OR cn.note_date >= $1::date)
         AND ($2::date IS NULL OR cn.note_date <= $2::date)
       ORDER BY cn.note_date, cn.note_number`, p)).rows;

    const noteOut = (x) => ({
      note_id: x.note_id, note_number: x.note_number, note_date: x.note_date,
      against_invoice: x.invoice_number || null,
      customer_name: x.customer_name || null, gstin: x.customer_gstin || null,
      place_of_supply: x.place_of_supply || null,
      taxable: r2(x.taxable_value), tax: r2(x.tax_amount), total: r2(x.amount),
    });
    const cdnr = notes.filter(x => x.registered).map(noteOut);
    const cdnur = notes.filter(x => !x.registered).map(noteOut);

    // ── HSN summary ──────────────────────────────────────────────────────
    const hsn = (await pool.query(`
      SELECT COALESCE(NULLIF(TRIM(ii.hsn_code), ''), '(missing)') AS hsn_code,
             COALESCE(NULLIF(TRIM(ii.uom), ''), 'KG') AS uom,
             ii.gst_rate,
             SUM(ii.quantity)      AS quantity,
             SUM(ii.taxable_value) AS taxable,
             SUM(ii.cgst_amount)   AS cgst,
             SUM(ii.sgst_amount)   AS sgst,
             SUM(ii.igst_amount)   AS igst
        FROM (${CLASSIFIED}) c
        JOIN tax_invoice_items ii ON ii.invoice_id = c.invoice_id
       GROUP BY 1, 2, ii.gst_rate
       ORDER BY 1, ii.gst_rate`, p)).rows.map(x => ({
      hsn_code: x.hsn_code, uom: x.uom, gst_rate: Number(x.gst_rate) || 0,
      quantity: Math.round((Number(x.quantity) || 0) * 1000) / 1000,
      taxable: r2(x.taxable), cgst: r2(x.cgst), sgst: r2(x.sgst), igst: r2(x.igst),
    }));

    // An HSN code is mandatory on the return. Saying so here is more use than
    // letting the portal reject the upload later.
    const missingHsn = hsn.filter(h => h.hsn_code === '(missing)');

    // ── Document series ──────────────────────────────────────────────────
    const docs = (await pool.query(`
      SELECT MIN(invoice_number) AS from_no, MAX(invoice_number) AS to_no,
             COUNT(*)::int AS issued,
             COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
        FROM tax_invoices
       WHERE ($1::date IS NULL OR invoice_date >= $1::date)
         AND ($2::date IS NULL OR invoice_date <= $2::date)`, p)).rows[0];

    // ── Totals, and the check that the sections add back ─────────────────
    const invTotals = (await pool.query(`
      SELECT COUNT(*)::int AS invoices,
             COALESCE(SUM(taxable_value),0) AS taxable,
             COALESCE(SUM(cgst_amount),0)   AS cgst,
             COALESCE(SUM(sgst_amount),0)   AS sgst,
             COALESCE(SUM(igst_amount),0)   AS igst,
             COALESCE(SUM(grand_total),0)   AS invoice_value
        FROM (${CLASSIFIED}) c`, p)).rows[0];

    const add = (rows, f) => r2(rows.reduce((s, x) => s + (Number(x[f]) || 0), 0));
    const sections = {
      taxable: r2(add(b2b, 'taxable') + add(b2cl, 'taxable') + add(b2cs, 'taxable')),
      cgst: r2(add(b2b, 'cgst') + add(b2cl, 'cgst') + add(b2cs, 'cgst')),
      sgst: r2(add(b2b, 'sgst') + add(b2cl, 'sgst') + add(b2cs, 'sgst')),
      igst: r2(add(b2b, 'igst') + add(b2cl, 'igst') + add(b2cs, 'igst')),
    };

    const totals = {
      invoices: Number(invTotals.invoices),
      taxable: r2(invTotals.taxable),
      cgst: r2(invTotals.cgst), sgst: r2(invTotals.sgst), igst: r2(invTotals.igst),
      total_tax: r2(Number(invTotals.cgst) + Number(invTotals.sgst) + Number(invTotals.igst)),
      invoice_value: r2(invTotals.invoice_value),
      credit_notes: notes.length,
      credit_note_taxable: r2(notes.reduce((s, x) => s + Number(x.taxable_value || 0), 0)),
      credit_note_tax: r2(notes.reduce((s, x) => s + Number(x.tax_amount || 0), 0)),
    };

    // Header totals and the sum of the lines should agree. When they do not,
    // an invoice header was written with figures its own lines do not support —
    // worth knowing before the number is filed rather than after.
    const drift = {
      taxable: r2(sections.taxable - totals.taxable),
      cgst: r2(sections.cgst - totals.cgst),
      sgst: r2(sections.sgst - totals.sgst),
      igst: r2(sections.igst - totals.igst),
    };
    const reconciles = Object.values(drift).every(d => Math.abs(d) < 0.011);

    return {
      period: { from, to },
      totals, sections, drift, reconciles,
      b2b, b2cl, b2cs, cdnr, cdnur, hsn,
      documents: {
        from_no: docs.from_no, to_no: docs.to_no,
        issued: Number(docs.issued), cancelled: Number(docs.cancelled),
      },
      warnings: [
        ...(missingHsn.length
          ? [`${missingHsn.length} line group(s) have no HSN code — the return will be rejected without one.`]
          : []),
        ...(reconciles ? [] : ['Invoice headers do not match the sum of their line items.']),
      ],
    };
  }

  return { summary };
};
