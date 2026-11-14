// GSTR-9 annual summary (indicative) — consolidates the year's outward supplies,
// ITC and net tax from MES data, laid out in the return's own table order. A prep
// aid to reconcile against the filed monthly GSTR-1/3B, not a filing export.
module.exports = (pool) => {
  const gstr1 = require('./gstr1')(pool);
  const gstSummary = require('./gst-summary')(pool);

  async function summary({ from = null, to = null } = {}) {
    const g1 = await gstr1.summary({ from, to });
    const gs = await gstSummary.summary({ from, to });
    const tc = gs.tax_calculation;
    return {
      period: { from, to },
      // Tables 4 & 5 — outward supplies
      outward: {
        taxable: g1.totals.taxable, cgst: g1.totals.cgst, sgst: g1.totals.sgst, igst: g1.totals.igst,
        total_tax: g1.totals.total_tax, invoice_value: g1.totals.invoice_value, invoices: g1.totals.invoices,
        b2b: g1.b2b.length, b2cl: g1.b2cl.length, b2cs: g1.b2cs.length,
        credit_notes: g1.totals.credit_notes, credit_note_taxable: g1.totals.credit_note_taxable, credit_note_tax: g1.totals.credit_note_tax,
        rate_wise: gs.output.lines,
      },
      // Table 6 — ITC availed
      itc: { cgst: tc.input_itc.cgst, sgst: tc.input_itc.sgst, igst: tc.input_itc.igst, import_igst: tc.input_itc.import_igst, total: tc.input_itc.total_tax, rate_wise: gs.input.lines },
      // Table 9 — tax payable & set-off
      tax: { output: tc.output_tax, net_payable: tc.net_payable, set_off: tc.set_off, opening: tc.opening },
      // Table 17/18 — HSN
      hsn: g1.hsn,
      reconciles: g1.reconciles,
      warnings: g1.warnings,
      note: 'Indicative GSTR-9 consolidation from MES data. Reconcile with the filed GSTR-1 / 3B before filing; ITC reflects only purchases captured in the accounting engine plus recoverable import IGST.',
    };
  }

  return { summary };
};
