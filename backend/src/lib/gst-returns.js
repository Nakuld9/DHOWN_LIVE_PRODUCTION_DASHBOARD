// GSTR-3B + GSTR-2B for the AI Accountant (spec §GST).
//
// GSTR-3B is the monthly summary return. Its OUTWARD side (section 3.1 — tax on
// sales) is fully knowable from the MES (tax_invoices + credit_notes) — the same
// source GSTR-1 uses, so the two cannot disagree. Its INWARD side (section 4 — ITC
// on purchases) lives in Busy and is NOT in the MES... EXCEPT that the GST portal's
// own GSTR-2B statement carries exactly that ITC. So this lets you upload the 2B
// file: its eligible ITC then fills section 4, and net tax payable becomes
// computable — without needing the Busy bridge.
//
// Honesty contract holds throughout: outward is ACTUAL from MES; ITC is ACTUAL from
// the uploaded 2B or "unavailable (Busy / upload 2B)" when no 2B is loaded. Net tax
// is marked INDICATIVE because statutory set-off ordering is the filer's call. This
// prepares the figures; it never files, pays, or posts anything.

const crypto = require('crypto');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const n = (v) => Number(v) || 0;

function rtnprdToPeriod(p) {                // '092026' -> '2026-09'
  const s = String(p || '').replace(/\D/g, '');
  if (s.length === 6) return `${s.slice(2)}-${s.slice(0, 2)}`;
  return null;
}
function invTax(inv) {
  if (Array.isArray(inv.items) && inv.items.length) {
    return inv.items.reduce((a, it) => ({
      txval: a.txval + n(it.txval), igst: a.igst + n(it.igst), cgst: a.cgst + n(it.cgst), sgst: a.sgst + n(it.sgst), cess: a.cess + n(it.cess),
    }), { txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
  }
  return { txval: n(inv.txval), igst: n(inv.igst), cgst: n(inv.cgst), sgst: n(inv.sgst), cess: n(inv.cess) };
}

// Parse the GST portal's GSTR-2B JSON: data.docdata.{b2b,cdnr,...}[].inv[] where
// each invoice may carry an items[] rate-split or invoice-level tax fields.
// Tolerant of both. ITC counts as eligible unless the row is flagged itcavl='N'.
// Credit notes (cdnr) net negative — they reduce available ITC.
function parseGstr2b(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  const data = obj?.data || obj;
  const doc = data?.docdata || data?.docData || {};
  const gstin = data?.gstin || data?.stin || null;
  const period = rtnprdToPeriod(data?.rtnprd || data?.retperiod);

  const suppliers = new Map();
  let taxable = 0, igst = 0, cgst = 0, sgst = 0, cess = 0, invCount = 0;
  let eIgst = 0, eCgst = 0, eSgst = 0;

  const addInv = (ctin, trdnm, inv, sign) => {
    const tax = invTax(inv);
    const eligible = String(inv.itcavl || inv.itc_avl || 'Y').toUpperCase() !== 'N';
    taxable += sign * tax.txval; igst += sign * tax.igst; cgst += sign * tax.cgst; sgst += sign * tax.sgst; cess += sign * tax.cess;
    if (eligible) { eIgst += sign * tax.igst; eCgst += sign * tax.cgst; eSgst += sign * tax.sgst; }
    invCount++;
    const s = suppliers.get(ctin) || { gstin: ctin, name: trdnm || null, taxable: 0, igst: 0, cgst: 0, sgst: 0, invoices: 0, eligible_itc: 0 };
    s.taxable += sign * tax.txval; s.igst += sign * tax.igst; s.cgst += sign * tax.cgst; s.sgst += sign * tax.sgst; s.invoices += 1;
    if (eligible) s.eligible_itc += sign * (tax.igst + tax.cgst + tax.sgst);
    suppliers.set(ctin, s);
  };

  for (const sec of ['b2b', 'b2ba']) for (const sup of (doc[sec] || [])) for (const inv of (sup.inv || [])) addInv(sup.ctin, sup.trdnm, inv, +1);
  for (const sec of ['cdnr', 'cdnra']) for (const sup of (doc[sec] || [])) for (const nt of (sup.nt || sup.inv || [])) addInv(sup.ctin, sup.trdnm, nt, -1);

  const supplierList = [...suppliers.values()].map(s => ({
    gstin: s.gstin, name: s.name, invoices: s.invoices,
    taxable: r2(s.taxable), igst: r2(s.igst), cgst: r2(s.cgst), sgst: r2(s.sgst), eligible_itc: r2(s.eligible_itc),
  })).sort((a, b) => b.eligible_itc - a.eligible_itc);

  return {
    gstin, period,
    totals: { taxable: r2(taxable), igst: r2(igst), cgst: r2(cgst), sgst: r2(sgst), cess: r2(cess) },
    eligible_itc: { igst: r2(eIgst), cgst: r2(eCgst), sgst: r2(eSgst), total: r2(eIgst + eCgst + eSgst) },
    invoice_count: invCount, supplier_count: supplierList.length, suppliers: supplierList,
  };
}

module.exports = (pool) => {

  const { withDbRetry } = require('./boot-ensure');
  async function ensure() {
    try {
      await withDbRetry('gst_returns', () => pool.query(`
        CREATE TABLE IF NOT EXISTS gst_2b_imports (
          import_id      BIGSERIAL PRIMARY KEY,
          period         VARCHAR(7) NOT NULL UNIQUE,     -- 'YYYY-MM'
          gstin          VARCHAR(20),
          total_taxable  NUMERIC(14,2) NOT NULL DEFAULT 0,
          total_igst     NUMERIC(14,2) NOT NULL DEFAULT 0,
          total_cgst     NUMERIC(14,2) NOT NULL DEFAULT 0,
          total_sgst     NUMERIC(14,2) NOT NULL DEFAULT 0,
          total_cess     NUMERIC(14,2) NOT NULL DEFAULT 0,
          eligible_igst  NUMERIC(14,2) NOT NULL DEFAULT 0,
          eligible_cgst  NUMERIC(14,2) NOT NULL DEFAULT 0,
          eligible_sgst  NUMERIC(14,2) NOT NULL DEFAULT 0,
          invoice_count  INTEGER NOT NULL DEFAULT 0,
          supplier_count INTEGER NOT NULL DEFAULT 0,
          content_hash   VARCHAR(64),
          summary        JSONB,
          imported_by    VARCHAR(60),
          imported_at    TIMESTAMP NOT NULL DEFAULT NOW()
        );`));
    } catch (e) { require('./observability').log('error', 'gst_returns.ensure', { error: e.message }); }
  }
  ensure();

  // Store (replace) the 2B for a period so GSTR-3B and the dashboard can reuse it.
  async function importGstr2b(json, { period, by } = {}) {
    await ensure();
    let parsed;
    try { parsed = parseGstr2b(json); }
    catch (e) { return { error: `Could not read the GSTR-2B file: ${e.message}`, code: 400 }; }
    const per = period || parsed.period;
    if (!/^\d{4}-\d{2}$/.test(per || '')) return { error: 'Return period (YYYY-MM) is required — none found in the file.', code: 400 };
    if (!parsed.invoice_count) return { error: 'No invoices found in the GSTR-2B file. Check the file is the portal JSON.', code: 400 };
    const hash = crypto.createHash('sha256').update(typeof json === 'string' ? json : JSON.stringify(json)).digest('hex').slice(0, 64);
    const row = (await pool.query(`
      INSERT INTO gst_2b_imports
        (period, gstin, total_taxable, total_igst, total_cgst, total_sgst, total_cess,
         eligible_igst, eligible_cgst, eligible_sgst, invoice_count, supplier_count, content_hash, summary, imported_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (period) DO UPDATE SET
        gstin=EXCLUDED.gstin, total_taxable=EXCLUDED.total_taxable, total_igst=EXCLUDED.total_igst,
        total_cgst=EXCLUDED.total_cgst, total_sgst=EXCLUDED.total_sgst, total_cess=EXCLUDED.total_cess,
        eligible_igst=EXCLUDED.eligible_igst, eligible_cgst=EXCLUDED.eligible_cgst, eligible_sgst=EXCLUDED.eligible_sgst,
        invoice_count=EXCLUDED.invoice_count, supplier_count=EXCLUDED.supplier_count,
        content_hash=EXCLUDED.content_hash, summary=EXCLUDED.summary, imported_by=EXCLUDED.imported_by, imported_at=NOW()
      RETURNING import_id, imported_at`,
      [per, parsed.gstin, parsed.totals.taxable, parsed.totals.igst, parsed.totals.cgst, parsed.totals.sgst, parsed.totals.cess,
       parsed.eligible_itc.igst, parsed.eligible_itc.cgst, parsed.eligible_itc.sgst,
       parsed.invoice_count, parsed.supplier_count, hash, JSON.stringify(parsed), by || null])).rows[0];
    return { ok: true, period: per, import_id: Number(row.import_id), imported_at: row.imported_at, ...parsed };
  }

  async function getGstr2b(period) {
    try {
      const r = (await pool.query(`SELECT * FROM gst_2b_imports WHERE period=$1`, [period])).rows[0];
      if (!r) return null;
      const s = typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary;
      return { period: r.period, gstin: r.gstin, imported_at: r.imported_at, ...s };
    } catch { return null; }   // table not created yet → no 2B on file
  }

  // ── GSTR-3B ───────────────────────────────────────────────────────────────
  // period: 'YYYY-MM' (preferred) or explicit {from,to}. ITC (section 4) is filled
  // from the stored 2B for that period when present; otherwise it is unavailable.
  async function gstr3b({ period = null, from = null, to = null } = {}) {
    let f = from, t = to, per = period;
    if (per && /^\d{4}-\d{2}$/.test(per)) { f = `${per}-01`; t = monthEnd(per); }
    else if (f && !per) per = String(f).slice(0, 7);

    const inv = (await pool.query(`
      SELECT COALESCE(SUM(taxable_value),0) txval, COALESCE(SUM(igst_amount),0) igst,
             COALESCE(SUM(cgst_amount),0) cgst, COALESCE(SUM(sgst_amount),0) sgst, COUNT(*)::int n
        FROM tax_invoices
       WHERE status <> 'CANCELLED'
         AND ($1::date IS NULL OR invoice_date >= $1::date)
         AND ($2::date IS NULL OR invoice_date <= $2::date)`, [f, t])).rows[0];
    // Credit notes reduce outward liability. They carry a single tax_amount (no
    // rate-wise split), so we net the total and report the CN split as unavailable.
    const cn = (await pool.query(`
      SELECT COALESCE(SUM(taxable_value),0) txval, COALESCE(SUM(tax_amount),0) tax, COUNT(*)::int n
        FROM credit_notes
       WHERE COALESCE(status,'ACTIVE') <> 'CANCELLED'
         AND ($1::date IS NULL OR note_date >= $1::date)
         AND ($2::date IS NULL OR note_date <= $2::date)`, [f, t])).rows[0];

    const outGross = { taxable: r2(inv.txval), igst: r2(inv.igst), cgst: r2(inv.cgst), sgst: r2(inv.sgst) };
    const outTaxGross = r2(outGross.igst + outGross.cgst + outGross.sgst);
    const creditNotes = { taxable: r2(cn.txval), tax: r2(cn.tax), count: Number(cn.n) };
    const netTaxable = r2(outGross.taxable - creditNotes.taxable);
    const netOutputTax = r2(outTaxGross - creditNotes.tax);

    const twob = per ? await getGstr2b(per) : null;
    const itc = twob
      ? { available: true, source: '2B', kind: 'actual', igst: twob.eligible_itc.igst, cgst: twob.eligible_itc.cgst, sgst: twob.eligible_itc.sgst, total: twob.eligible_itc.total, as_of: twob.imported_at, note: `From uploaded GSTR-2B for ${per} (${twob.invoice_count} invoice(s), ${twob.supplier_count} supplier(s)).` }
      : { available: false, source: 'BUSY', kind: 'unavailable', note: `ITC lives in Busy. Upload the GSTR-2B JSON for ${per || 'this period'} to fill section 4 and compute net tax.` };

    // Indicative net cash payable per head (output − ITC, floored at 0). Real
    // liability depends on set-off ordering, which is the filer's decision.
    const net = itc.available ? {
      indicative: true,
      igst: r2(Math.max(0, outGross.igst - itc.igst)),
      cgst: r2(Math.max(0, outGross.cgst - itc.cgst)),
      sgst: r2(Math.max(0, outGross.sgst - itc.sgst)),
      note: 'Indicative cash payable (output − eligible ITC per head). Actual liability depends on statutory set-off order — review before filing.',
    } : { available: false, note: 'Net tax needs ITC — upload GSTR-2B.' };

    return {
      period: per, from: f, to: t,
      section_3_1_outward: {
        source: 'MES', kind: 'actual',
        gross: { ...outGross, output_tax: outTaxGross, invoices: Number(inv.n) },
        credit_notes: creditNotes,
        net_taxable: netTaxable, net_output_tax: netOutputTax,
        note: 'Outward taxable supplies from MES tax invoices, net of credit notes. Credit-note tax has no rate-wise split (reported at note level).',
      },
      section_4_itc: itc,
      net_tax_payable: net,
      disclaimer: 'Prepared by DHOWN AI Accountant. Figures are for review — nothing is filed or paid. Verify against the portal before submission.',
    };
  }

  function monthEnd(per) { const [y, m] = per.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }

  return { ensure, parseGstr2b, importGstr2b, getGstr2b, gstr3b };
};

// Pure parser exposed for tests (no DB).
module.exports.parsers = { parseGstr2b, rtnprdToPeriod };
