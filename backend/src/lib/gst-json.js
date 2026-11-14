// Portal-ready JSON exports — GSTR-1, GSTR-3B and E-Way Bill — built from the
// MES's own invoice data. Prep artifacts to upload via the GST offline tool /
// EWB portal; always validate in the offline tool before filing. We never invent
// figures: fields we cannot derive are left out and flagged in `warnings`.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// GST state codes (2-digit) by state name (lowercased).
const STATE_CODE = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04', 'uttarakhand': '05',
  'haryana': '06', 'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09', 'bihar': '10', 'sikkim': '11',
  'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14', 'mizoram': '15', 'tripura': '16', 'meghalaya': '17',
  'assam': '18', 'west bengal': '19', 'jharkhand': '20', 'odisha': '21', 'chhattisgarh': '22', 'madhya pradesh': '23',
  'gujarat': '24', 'daman and diu': '25', 'dadra and nagar haveli and daman and diu': '26', 'maharashtra': '27',
  'andhra pradesh': '37', 'karnataka': '29', 'goa': '30', 'lakshadweep': '31', 'kerala': '32', 'tamil nadu': '33',
  'puducherry': '34', 'andaman and nicobar islands': '35', 'telangana': '36', 'ladakh': '38', 'other territory': '97',
};
const dmy = (d) => { if (!d) return ''; const x = new Date(d); return `${String(x.getDate()).padStart(2, '0')}-${String(x.getMonth() + 1).padStart(2, '0')}-${x.getFullYear()}`; };
const ddmmyyyy = (d) => dmy(d).replace(/-/g, '/');
const mmyyyy = (d) => { const x = new Date(d); return `${String(x.getMonth() + 1).padStart(2, '0')}${x.getFullYear()}`; };
// Resolve a 2-digit POS state code from a place-of-supply string, else a GSTIN.
function posCode(place, gstin) {
  const p = String(place || '').trim();
  if (/^\d{2}$/.test(p)) return p;
  const m = p.match(/^(\d{2})\s*[-.]/); if (m) return m[1];
  const code = STATE_CODE[p.toLowerCase()]; if (code) return code;
  if (gstin && /^\d{2}/.test(gstin)) return gstin.slice(0, 2);
  return '';
}
const uqc = (u) => { const m = { KG: 'KGS', KGS: 'KGS', PCS: 'PCS', NOS: 'NOS', MTR: 'MTR', MTRS: 'MTR', M: 'MTR', U: 'UNT', UNIT: 'UNT', ROLL: 'NOS', BAG: 'BAG', BOX: 'BOX' }; return m[String(u || '').toUpperCase().trim()] || 'OTH'; };

module.exports = (pool) => {
  const gstr1 = require('./gstr1')(pool);
  const gstSummary = require('./gst-summary')(pool);

  async function company() {
    let gstin = '', state = '', name = '';
    try {
      const rows = (await pool.query(`SELECT key, value FROM app_settings WHERE key IN ('gst_number','state','company_name')`)).rows;
      const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      gstin = (m.gst_number || '').trim(); state = (m.state || '').trim(); name = (m.company_name || '').trim();
    } catch { /* settings absent */ }
    return { gstin, stateCode: gstin ? gstin.slice(0, 2) : posCode(state), name };
  }

  // Each invoice line's rate-wise item for the portal.
  const itm = (n, l) => ({ num: n, itm_det: { txval: r2(l.taxable), rt: Number(l.gst_rate) || 0, iamt: r2(l.igst), camt: r2(l.cgst), samt: r2(l.sgst), csamt: 0 } });

  async function gstr1Json({ from = null, to = null } = {}) {
    const co = await company();
    const s = await gstr1.summary({ from, to });
    const warnings = [...(s.warnings || [])];
    if (!co.gstin) warnings.push('Company GSTIN not set in Settings — "gstin" is blank.');

    // ── B2B: group by customer GSTIN → invoice → rate-wise items ───────────
    const b2bMap = new Map();
    for (const l of s.b2b) {
      const ctin = (l.gstin || '').trim(); if (!ctin) continue;
      if (!b2bMap.has(ctin)) b2bMap.set(ctin, new Map());
      const invs = b2bMap.get(ctin);
      if (!invs.has(l.invoice_number)) invs.set(l.invoice_number, { inum: l.invoice_number, idt: dmy(l.invoice_date), val: r2(l.invoice_value), pos: posCode(l.place_of_supply, ctin), rchrg: 'N', inv_typ: 'R', itms: [] });
      const inv = invs.get(l.invoice_number); inv.itms.push(itm(inv.itms.length + 1, l));
    }
    const b2b = [...b2bMap.entries()].map(([ctin, invs]) => ({ ctin, inv: [...invs.values()] }));

    // ── B2CL: inter-state, unregistered, invoice > 2.5L (itemised) ─────────
    const b2clMap = new Map();
    for (const l of s.b2cl) {
      const pos = posCode(l.place_of_supply, null);
      if (!b2clMap.has(pos)) b2clMap.set(pos, new Map());
      const invs = b2clMap.get(pos);
      if (!invs.has(l.invoice_number)) invs.set(l.invoice_number, { inum: l.invoice_number, idt: dmy(l.invoice_date), val: r2(l.invoice_value), itms: [] });
      invs.get(l.invoice_number).itms.push(itm(invs.get(l.invoice_number).itms.length + 1, l));
    }
    const b2cl = [...b2clMap.entries()].filter(([p]) => p).map(([pos, invs]) => ({ pos, inv: [...invs.values()] }));

    // ── B2CS: consolidated per supply-type × POS × rate ────────────────────
    const b2cs = (s.b2cs || []).map((x) => {
      const inter = x.type === 'INTER';
      return { sply_ty: inter ? 'INTER' : 'INTRA', pos: posCode(x.place_of_supply, null) || co.stateCode, typ: 'OE',
        rt: Number(x.gst_rate) || 0, txval: r2(x.taxable), csamt: 0,
        ...(inter ? { iamt: r2(x.igst) } : { camt: r2(x.cgst), samt: r2(x.sgst) }) };
    });

    // ── CDNR / CDNUR: credit notes. We store note-level taxable+tax only, so
    // derive the rate from the linked invoice when it is single-rate. ───────
    const cdnr = []; const cdnur = [];
    for (const n of [...s.cdnr, ...s.cdnur]) {
      const reg = !!n.gstin;
      let rate = 0; const il = n.against_invoice;
      try {
        if (il) { const rr = (await pool.query(`SELECT DISTINCT gst_rate FROM tax_invoice_items ii JOIN tax_invoices ti ON ti.invoice_id=ii.invoice_id WHERE ti.invoice_number=$1`, [il])).rows; if (rr.length === 1) rate = Number(rr[0].gst_rate) || 0; else if (rr.length) warnings.push(`Credit note ${n.note_number}: linked invoice ${il} has multiple rates — set the rate manually.`); }
      } catch { /* ignore */ }
      const inter = !!n.gstin && posCode(n.place_of_supply, n.gstin) !== co.stateCode;
      const tax = Number(n.tax) || 0;
      const note = { ntty: 'C', nt_num: n.note_number, nt_dt: dmy(n.note_date), val: r2(n.total),
        itms: [{ num: 1, itm_det: { txval: r2(n.taxable), rt: rate, csamt: 0, ...(inter ? { iamt: r2(tax) } : { camt: r2(tax / 2), samt: r2(tax / 2) }) } }] };
      if (reg) { let e = cdnr.find((x) => x.ctin === n.gstin); if (!e) { e = { ctin: n.gstin, nt: [] }; cdnr.push(e); } note.pos = posCode(n.place_of_supply, n.gstin); e.nt.push(note); }
      else { let e = cdnur.find((x) => x.pos === posCode(n.place_of_supply, null)); if (!e) { e = { pos: posCode(n.place_of_supply, null) || co.stateCode, ntty: 'C', typ: 'B2CL', nt: [] }; cdnur.push(e); } e.nt.push(note); }
    }
    if ((s.cdnr.length + s.cdnur.length) > 0) warnings.push('Credit-note rates are derived from the linked invoice (single-rate only) — verify CDNR/CDNUR rates in the offline tool.');

    // ── HSN summary ────────────────────────────────────────────────────────
    const hsn = { data: (s.hsn || []).map((h, i) => ({ num: i + 1, hsn_sc: h.hsn_code === '(missing)' ? '' : h.hsn_code, desc: '', uqc: uqc(h.uom), qty: h.quantity, txval: r2(h.taxable), iamt: r2(h.igst), camt: r2(h.cgst), samt: r2(h.sgst), csamt: 0, rt: Number(h.gst_rate) || 0 })) };

    return {
      filing: { gstin: co.gstin, fp: mmyyyy(to || from || new Date()) },
      json: { gstin: co.gstin, fp: mmyyyy(to || from || new Date()), b2b, b2cl, b2cs, cdnr, cdnur, hsn },
      warnings,
      note: 'GSTR-1 upload JSON (prep). Validate in the GST offline tool before filing. Credit-note rate is derived for single-rate invoices only.',
    };
  }

  async function gstr3bJson({ from = null, to = null } = {}) {
    const co = await company();
    const gs = await gstSummary.summary({ from, to });
    const o = gs.tax_calculation.output_tax; const i = gs.tax_calculation.input_itc;
    const osup = { txval: r2(Number(gs.output.total.taxable) - Number(gs.output_notes.total.taxable)),
      iamt: o.igst, camt: o.cgst, samt: o.sgst, csamt: 0 };
    return {
      filing: { gstin: co.gstin, ret_period: mmyyyy(to || from || new Date()) },
      json: {
        gstin: co.gstin, ret_period: mmyyyy(to || from || new Date()),
        sup_details: { osup_det: osup, osup_zero: z(), osup_nil_exmp: z2(), isup_rev: z(), osup_nongst: z2() },
        inter_sup: { unreg_details: [], comp_details: [], uin_details: [] },
        itc_elg: { itc_avl: [{ ty: 'OTH', iamt: i.igst, camt: i.cgst, samt: i.sgst, csamt: 0 }], itc_rev: [], itc_net: { iamt: i.igst, camt: i.cgst, samt: i.sgst, csamt: 0 }, itc_inelg: [] },
        intr_ltfee: {},
      },
      warnings: [...(gs.notes || []), 'GSTR-3B 3.1(a) outward from MES invoices; ITC (Table 4) from posted purchases + import IGST. Nil/exempt/zero-rated/RCM are zero unless captured. Validate before filing.'],
      note: 'GSTR-3B upload JSON (prep).',
    };
    function z() { return { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }; }
    function z2() { return { txval: 0 }; }
  }

  // E-Way Bill bulk-generation JSON for invoices over a value threshold.
  async function ewayJson({ from = null, to = null, min_value = 50000 } = {}) {
    const co = await company();
    const invs = (await pool.query(`
      SELECT ti.*, dc.transporter_id, dc.lr_number, dc.distance_km, dc.transport_mode, dc.vehicle_number
        FROM tax_invoices ti LEFT JOIN dispatch_challans dc ON dc.invoice_id = ti.invoice_id
       WHERE ti.status <> 'CANCELLED' AND COALESCE(ti.grand_total,0) >= $3
         AND ($1::date IS NULL OR ti.invoice_date >= $1::date) AND ($2::date IS NULL OR ti.invoice_date <= $2::date)
       ORDER BY ti.invoice_date, ti.invoice_number`, [from, to, min_value])).rows;
    const out = []; const warnings = [];
    for (const v of invs) {
      const items = (await pool.query(`SELECT hsn_code, item_name, quantity, uom, gst_rate, taxable_value, cgst_amount, sgst_amount, igst_amount FROM tax_invoice_items WHERE invoice_id=$1`, [v.invoice_id])).rows;
      const inter = Number(v.igst_amount) > 0;
      out.push({
        userGstin: co.gstin, supplyType: 'O', subSupplyType: '1', docType: 'INV', docNo: v.invoice_number, docDate: ddmmyyyy(v.invoice_date),
        fromGstin: co.gstin, fromTrdName: co.name, fromStateCode: Number(co.stateCode) || 0, actFromStateCode: Number(co.stateCode) || 0,
        toGstin: v.customer_gstin || 'URP', toTrdName: v.customer_name || '', toStateCode: Number(posCode(v.place_of_supply, v.customer_gstin)) || 0, actToStateCode: Number(posCode(v.place_of_supply, v.customer_gstin)) || 0,
        transactionType: 1, totalValue: r2(v.taxable_value), cgstValue: r2(v.cgst_amount), sgstValue: r2(v.sgst_amount), igstValue: r2(v.igst_amount), cessValue: 0, totInvValue: r2(v.grand_total),
        transporterId: v.transporter_id || '', transDocNo: v.lr_number || '', transMode: String(v.transport_mode === 'RAIL' ? 2 : v.transport_mode === 'AIR' ? 3 : v.transport_mode === 'SHIP' ? 4 : 1), transDistance: String(v.distance_km || ''), vehicleNo: v.vehicle_number || '', vehicleType: 'R',
        itemList: items.map((it) => ({ productName: it.item_name || '', hsnCode: it.hsn_code || '', quantity: Number(it.quantity) || 0, qtyUnit: uqc(it.uom), taxableAmount: r2(it.taxable_value), cgstRate: inter ? 0 : (Number(it.gst_rate) || 0) / 2, sgstRate: inter ? 0 : (Number(it.gst_rate) || 0) / 2, igstRate: inter ? (Number(it.gst_rate) || 0) : 0, cessRate: 0 })),
      });
      if (!v.distance_km) warnings.push(`Invoice ${v.invoice_number}: no transport distance — set transDistance before generating.`);
    }
    return { filing: { count: out.length, threshold: min_value }, json: out, warnings, note: 'E-Way Bill bulk JSON (prep) for invoices ≥ ₹50,000. Fill transporter/vehicle/distance where blank; validate on the EWB portal.' };
  }

  return { gstr1Json, gstr3bJson, ewayJson };
};
// Pure helpers exposed for unit testing.
module.exports._helpers = { posCode, uqc, dmy, ddmmyyyy, mmyyyy, STATE_CODE };
