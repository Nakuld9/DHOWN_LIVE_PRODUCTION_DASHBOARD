// Import Document AI (spec §34) — read a set of shipment PDFs, classify each,
// extract the fields, reconcile them against each other, and produce a DRAFT
// proposal: the import fields + which document is which + cross-document mismatches
// + proposed draft entries (advance payment, landed cost). It WRITES NOTHING — the
// caller (applyProposal, human-approved) does that. No-hallucination: every field
// is null unless a document actually states it, and each carries its source doc.
//
// Reuses invoice-ocr's PDF text extraction and the AI model gateway; the model only
// EXTRACTS per document, while classification-merge and reconciliation are done in
// code for determinism.

const { extractText, _firstJson: firstJson } = require('./invoice-ocr');
const model = require('../ai/model');

const num = (v) => (v == null || v === '' || isNaN(Number(String(v).replace(/[, ]/g, ''))) ? null : Number(String(v).replace(/[, ]/g, '')));
const str = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

// Doc types we classify into (align with import_documents REQUIRED_DOCS).
const DOC_TYPES = ['PROFORMA_INVOICE', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING',
  'CERTIFICATE_OF_ORIGIN', 'INSURANCE', 'PURCHASE_ORDER', 'BILL_OF_ENTRY', 'OTHER'];

// Filename hints — a cheap, deterministic prior that also covers cases the model is unsure on.
function hintFromName(name) {
  const n = (name || '').toUpperCase();
  if (/\bBILL OF LADING\b|\bB\/?L\b|OOLU|MAEU|MSCU|BL[ _-]/.test(n)) return 'BILL_OF_LADING';
  if (/PACKING/.test(n)) return 'PACKING_LIST';
  if (/PROFORMA|\bPI\b/.test(n)) return 'PROFORMA_INVOICE';
  if (/INSURANCE|MARINE/.test(n)) return 'INSURANCE';
  if (/\bCO\b|CERTIFICATE OF ORIGIN|ORIGIN/.test(n)) return 'CERTIFICATE_OF_ORIGIN';
  if (/PURCHASE ORDER|\bPO\b/.test(n)) return 'PURCHASE_ORDER';
  if (/BILL OF ENTRY|\bBOE\b/.test(n)) return 'BILL_OF_ENTRY';
  if (/INVOICE/.test(n)) return 'COMMERCIAL_INVOICE';
  return null;
}

const SYS = [
  'You read ONE international-trade shipment document (proforma/commercial invoice, packing list,',
  'bill of lading, certificate of origin, insurance, purchase order, or bill of entry).',
  'Return ONLY a JSON object, no prose, no code fences. Use null for any field the document does',
  'not state — NEVER invent or infer a value. Numbers are plain (no symbols, no thousands commas).',
  'Dates as YYYY-MM-DD. Keep the goods description verbatim.',
  'Shape:',
  '{',
  '  "doc_type": "PROFORMA_INVOICE|COMMERCIAL_INVOICE|PACKING_LIST|BILL_OF_LADING|CERTIFICATE_OF_ORIGIN|INSURANCE|PURCHASE_ORDER|BILL_OF_ENTRY|OTHER",',
  '  "supplier_name": string|null, "buyer_name": string|null,',
  '  "proforma_invoice_no": string|null, "commercial_invoice_no": string|null, "sales_confirmation_no": string|null,',
  '  "document_date": string|null, "incoterm": string|null, "currency": string|null,',
  '  "total_value": number|null, "unit_price": number|null,',
  '  "advance_amount": number|null,   // any "down payment" / "advance" / "deposit" amount already paid; null if none',
  '  "balance_amount": number|null,   // any "balance" amount still due',
  '  "goods_description": string|null, "hs_code": string|null,',
  '  "net_weight_kg": number|null, "gross_weight_kg": number|null, "cartons": number|null,',
  '  "bl_no": string|null, "vessel_name": string|null, "voyage_no": string|null, "container_no": string|null, "seal_no": string|null,',
  '  "port_of_loading": string|null, "port_of_discharge": string|null, "place_of_delivery": string|null,',
  '  "etd": string|null, "eta": string|null, "country_of_origin": string|null',
  '}',
].join('\n');

const FIELDS = ['supplier_name', 'buyer_name', 'proforma_invoice_no', 'commercial_invoice_no', 'sales_confirmation_no',
  'document_date', 'incoterm', 'currency', 'total_value', 'unit_price', 'advance_amount', 'balance_amount',
  'goods_description', 'hs_code', 'net_weight_kg', 'gross_weight_kg', 'cartons', 'bl_no', 'vessel_name', 'voyage_no',
  'container_no', 'seal_no', 'port_of_loading', 'port_of_discharge', 'place_of_delivery', 'etd', 'eta', 'country_of_origin'];
const NUM_FIELDS = new Set(['total_value', 'unit_price', 'advance_amount', 'balance_amount', 'net_weight_kg', 'gross_weight_kg', 'cartons']);

function shape(j, hint) {
  const out = { doc_type: DOC_TYPES.includes(j && j.doc_type) ? j.doc_type : (hint || 'OTHER') };
  for (const f of FIELDS) out[f] = NUM_FIELDS.has(f) ? num(j && j[f]) : str(j && j[f]);
  return out;
}

// Read a PDF into model JSON, trying the best available path in order:
//   1) native PDF (Claude documentChat) — scanned + layout, no rendering
//   2) vision OCR (GLM/any) — render page 1 → image → read
//   3) text layer (digital PDFs only)
// Returns { j, read_by, scanned } or { error }.
async function readPdfJson(b64, sys, userPrompt, password) {
  const buffer = Buffer.from(String(b64 || ''), 'base64');
  if (!buffer.length) return { error: 'Empty file.' };
  if (buffer.slice(0, 4).toString('latin1') !== '%PDF') return { error: 'Not a PDF.' };
  let text = '', scanned = true, pageCount = 1;
  try { ({ text, scanned, pages: pageCount } = await extractText(buffer, password)); }
  catch (e) {
    if (e && e.needsPassword) return { error: e.message, needsPassword: true };
    /* image-only/malformed → fall through to vision paths */
  }

  // Password-protected PDFs are decrypted to their text layer above; the native-PDF
  // and vision paths receive the still-encrypted bytes and can't read them, so when a
  // password is supplied we go straight to the text-layer model with the decrypted text.
  if (password && text && text.length >= 40) {
    try { return { j: firstJson(await model.chat(sys, text.length > 12000 ? text.slice(0, 12000) : text, { task: 'reasoning' })), read_by: 'text-layer(decrypted)', scanned: false }; }
    catch (e) { return { error: `AI read failed: ${e.message}` }; }
  }

  const doc = await model.documentChat(sys, userPrompt, b64).catch(() => ({ ok: false }));
  if (doc.ok) return { j: firstJson(doc.text), read_by: doc.provider, scanned };

  const vp = process.env.DOC_VISION_PROVIDER || process.env.OCR_PROVIDER || 'glm';
  if (model.providers.has(vp)) {
    try {
      const { pdfToPng } = require('pdf-to-png-converter');
      // Render up to N pages and send them together — a doc's fields can live on
      // page 2 (packing list totals, BL continuation). Bounded to keep cost/size sane.
      const maxPages = Math.max(1, parseInt(process.env.DOC_VISION_MAX_PAGES, 10) || 3);
      const nums = Array.from({ length: Math.min(pageCount || 1, maxPages) }, (_, k) => k + 1);
      const rendered = await pdfToPng(buffer, { viewportScale: 1.6, pagesToProcess: nums });
      const imgs = (rendered || []).map(p => `data:image/png;base64,${p.content.toString('base64')}`);
      if (imgs.length) {
        const j = firstJson(await model.visionChat(sys, userPrompt, imgs, { provider: vp }));
        if (j) return { j, read_by: `${vp}-vision(${imgs.length}p)`, scanned };
      }
    } catch { /* fall through */ }
  }

  if (scanned) return { scanned: true, error: 'Scanned/image-only PDF — configure a PDF reader (ZHIPU_API_KEY + DOC_VISION_PROVIDER=glm, or ANTHROPIC_API_KEY).' };
  try { return { j: firstJson(await model.chat(sys, text.length > 12000 ? text.slice(0, 12000) : text, { task: 'reasoning' })), read_by: 'text-layer', scanned }; }
  catch (e) { return { error: `AI read failed: ${e.message}` }; }
}

// Extract ONE shipment document. Returns { ok, doc_type, fields, file_name, error? }.
async function extractOne(file) {
  const name = file.file_name || file.name || 'document.pdf';
  const hint = hintFromName(name);
  const r = await readPdfJson(String(file.file_data || file.base64 || ''), SYS, 'Extract this shipment document. Return ONLY the JSON object.');
  if (r.error) return { ok: false, file_name: name, doc_type: hint || 'OTHER', scanned: r.scanned, error: r.error };
  const fields = shape(r.j || {}, hint);
  return { ok: true, file_name: name, doc_type: fields.doc_type, fields, read_by: r.read_by };
}

// Merge across docs to form the proposed IMPORT fields, preferring the authoritative
// source per field. Records which document each value came from.
function mergeImport(docs) {
  // priority[field] = ordered doc_types most authoritative first
  const P = {
    supplier_name: ['COMMERCIAL_INVOICE', 'PROFORMA_INVOICE', 'BILL_OF_LADING', 'CERTIFICATE_OF_ORIGIN'],
    commercial_invoice_number: ['COMMERCIAL_INVOICE'],
    proforma_invoice_number: ['PROFORMA_INVOICE'],
    incoterm: ['COMMERCIAL_INVOICE', 'PROFORMA_INVOICE'],
    currency: ['COMMERCIAL_INVOICE', 'PROFORMA_INVOICE'],
    invoice_value: ['COMMERCIAL_INVOICE', 'PROFORMA_INVOICE'],
    unit_price: ['COMMERCIAL_INVOICE', 'PROFORMA_INVOICE'],
    quantity: ['COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING'],
    goods_description: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'PACKING_LIST'],
    hs_code: ['COMMERCIAL_INVOICE', 'BILL_OF_LADING', 'CERTIFICATE_OF_ORIGIN'],
    bl_number: ['BILL_OF_LADING'],
    vessel_name: ['BILL_OF_LADING'],
    voyage_no: ['BILL_OF_LADING'],
    container_no: ['BILL_OF_LADING', 'PACKING_LIST'],
    port_of_loading: ['BILL_OF_LADING', 'COMMERCIAL_INVOICE'],
    port_of_discharge: ['BILL_OF_LADING'],
    final_destination: ['BILL_OF_LADING', 'COMMERCIAL_INVOICE'],
    etd: ['BILL_OF_LADING'],
    country_of_origin: ['CERTIFICATE_OF_ORIGIN', 'COMMERCIAL_INVOICE', 'BILL_OF_LADING'],
    invoice_date: ['COMMERCIAL_INVOICE', 'PROFORMA_INVOICE'],
  };
  // map import field → source doc field name
  const SRC = { commercial_invoice_number: 'commercial_invoice_no', proforma_invoice_number: 'proforma_invoice_no',
    invoice_value: 'total_value', quantity: 'net_weight_kg', bl_number: 'bl_no', final_destination: 'place_of_delivery',
    invoice_date: 'document_date' };
  const byType = {};
  for (const d of docs) if (d.ok) (byType[d.doc_type] = byType[d.doc_type] || []).push(d);
  const value = {}, source = {};
  for (const [imf, order] of Object.entries(P)) {
    const srcField = SRC[imf] || imf;
    for (const t of order) {
      const hit = (byType[t] || []).map(d => d.fields[srcField]).find(v => v != null && v !== '');
      if (hit != null) { value[imf] = hit; source[imf] = t; break; }
    }
  }
  return { value, source };
}

// Deterministic cross-document reconciliation — flags mismatches for the human.
function reconcile(docs) {
  const flags = [];
  const pick = (type, field) => docs.filter(d => d.ok && d.doc_type === type).map(d => d.fields[field]).find(v => v != null);
  const near = (a, b, tol = 0.01) => a != null && b != null && Math.abs(a - b) <= Math.abs(a) * tol + 0.5;
  // container number across BL vs Packing List
  const blC = pick('BILL_OF_LADING', 'container_no'), plC = pick('PACKING_LIST', 'container_no');
  if (blC && plC && blC.replace(/\s/g, '') !== plC.replace(/\s/g, '')) flags.push({ level: 'high', field: 'container_no', message: `Container differs: BL ${blC} vs Packing List ${plC}` });
  // net weight across CI / PL / BL
  const weights = [['COMMERCIAL_INVOICE', pick('COMMERCIAL_INVOICE', 'net_weight_kg')], ['PACKING_LIST', pick('PACKING_LIST', 'net_weight_kg')]].filter(w => w[1] != null);
  if (weights.length === 2 && !near(weights[0][1], weights[1][1])) flags.push({ level: 'medium', field: 'net_weight_kg', message: `Net weight differs: ${weights.map(w => `${w[0]} ${w[1]}`).join(' vs ')}` });
  // value across CI vs PI
  const ciV = pick('COMMERCIAL_INVOICE', 'total_value'), piV = pick('PROFORMA_INVOICE', 'total_value');
  if (ciV != null && piV != null && !near(ciV, piV, 0.02)) flags.push({ level: 'medium', field: 'invoice_value', message: `Invoice value differs from PI: CI ${ciV} vs PI ${piV}` });
  // supplier consistency
  const suppliers = [...new Set(docs.filter(d => d.ok && d.fields.supplier_name).map(d => d.fields.supplier_name.toUpperCase().replace(/[^A-Z0-9]/g, '')))];
  if (suppliers.length > 1) flags.push({ level: 'low', field: 'supplier_name', message: 'Supplier name is not identical across documents — verify.' });
  return flags;
}

// Proposed draft accounting entries (NOT posted — drafts for approval).
function draftEntries(merged, docs) {
  const entries = [];
  const advance = docs.filter(d => d.ok).map(d => d.fields.advance_amount).find(v => v != null);
  const currency = merged.value.currency || docs.map(d => d.ok && d.fields.currency).find(Boolean) || null;
  if (advance != null && advance > 0) entries.push({
    kind: 'ADVANCE_PAYMENT', currency, amount: advance,
    basis: 'Down payment / advance stated on the proforma/commercial invoice',
    note: 'Draft only — approve to record the advance payment against this import.',
  });
  if (merged.value.invoice_value != null) entries.push({
    kind: 'LANDED_COST_PURCHASE', currency, cif_value: merged.value.invoice_value, incoterm: merged.value.incoterm || 'CIF',
    basis: 'CIF value from the commercial invoice; import-side expenses added later at costing',
    note: 'Draft only — approve to seed the import costing (freight/insurance NOT re-added on a CIF shipment).',
  });
  return entries;
}

// Bank TT (telegraphic transfer) advice — an outward remittance for an import.
const TT_SYS = [
  'You read a BANK TRANSACTION / TT (telegraphic transfer) ADVICE for an OUTWARD import payment.',
  'Return ONLY a JSON object, no prose, no code fences. Use null for anything not stated — never invent.',
  'Numbers plain (no symbols/commas). Dates as YYYY-MM-DD (input may be DD/MM/YYYY).',
  '{',
  '  "tt_reference": string|null,          // Reference Number',
  '  "tt_date": string|null,               // Event Date',
  '  "purpose": string|null,               // Purpose Code & Description',
  '  "is_advance": boolean,                // true if purpose says ADVANCE',
  '  "beneficiary_name": string|null,      // the "Other Party" (supplier)',
  '  "invoice_ref": string|null,           // Invoice Number referenced',
  '  "amount_fc": number|null,             // Event / FX deal amount in foreign currency',
  '  "currency": string|null,              // e.g. USD',
  '  "exchange_rate": number|null,         // FX Deal Rate',
  '  "amount_inr": number|null,            // FX Converted Amount (INR value of the goods)',
  '  "account_debit_inr": number|null,     // total INR debited to the account',
  '  "bank_charges_inr": number|null,      // Grand Total of ALL bank charges incl GST',
  '  // Itemised bank charges (INR, each INCLUDING its GST). Read the "Details of Bank',
  '  // Charges" table; a line total = Charges + GST. null if that specific line absent.',
  '  "swift_charges_inr": number|null,         // "REMITTANCES SWIFT CHARGES" line total (incl GST)',
  '  "advance_import_charges_inr": number|null,// "Foreign Advance Import Remittance" line total',
  '  "fx_conversion_charges_inr": number|null, // "FOREIGN CCY CONV" / currency-conversion line total (incl GST)',
  '  "other_bank_charges_inr": number|null,    // any OTHER bank charge line total not covered above',
  '  "bank": string|null                   // remitting bank name',
  '}',
].join('\n');

// Normalise a free-text incoterm ("CIF ICD SAHNEWAL") to a valid enum code.
const INCOTERMS = ['CIF', 'CFR', 'FOB', 'EXW', 'DDP', 'DAP', 'CIP', 'FCA', 'CPT'];
function normIncoterm(v) {
  const s = String(v || '').toUpperCase();
  return INCOTERMS.find(t => new RegExp(`\\b${t}\\b`).test(s)) || 'CIF';
}

module.exports = (pool) => {
  const imports  = require('./imports')(pool);
  const clr      = require('./import-clearance')(pool);
  const costing  = require('./import-costing')(pool);

  // Try to resolve a supplier name to exactly one active partner (else null → UI picks).
  async function matchSupplier(name) {
    if (!name) return null;
    const key = String(name).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const rows = (await pool.query(`SELECT partner_id, company_name FROM partners WHERE is_active=true`)).rows;
    const hit = rows.filter(r => String(r.company_name).replace(/[^A-Za-z0-9]/g, '').toUpperCase().startsWith(key.slice(0, 12)) || key.startsWith(String(r.company_name).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12)));
    return hit.length === 1 ? hit[0].partner_id : null;
  }

  // Analyse a set of files (each {file_name, file_data(base64)}). Read-only.
  async function analyzeDocs(files, opts = {}) {
    if (!Array.isArray(files) || !files.length) return { error: 'No files provided.', code: 400 };
    if (files.length > 12) return { error: 'Up to 12 documents at a time.', code: 400 };
    const docs = [];
    for (const f of files) docs.push(await extractOne(f));
    const merged = mergeImport(docs);
    const advance = docs.filter(d => d.ok).map(d => d.fields.advance_amount).find(v => v != null) || null;
    const proposal = {
      documents: docs.map(d => ({ file_name: d.file_name, doc_type: d.doc_type || 'OTHER', ok: !!d.ok, read_by: d.read_by || null, error: d.error || null })),
      import_fields: merged.value,
      field_sources: merged.source,
      suggested_supplier_id: await matchSupplier(merged.value.supplier_name),
      advance_amount: advance,
      reconciliation: reconcile(docs),
      draft_entries: draftEntries(merged, docs),
      raw: opts.include_raw ? docs : undefined,
      disclaimer: 'AI-extracted DRAFT. Every field comes from a stated document value (null if absent); nothing is posted. Review, correct, and approve before anything is created.',
    };
    return proposal;
  }

  // Apply an APPROVED proposal: create the import, attach the (classified) docs,
  // seed costing, record the advance, and pre-fill customs. This is the ONLY writing
  // path and runs only on explicit human approval. Nothing posts to Busy.
  async function applyProposal(body, user) {
    const b = body || {};
    const f = b.fields || {};
    const supplierId = b.supplier_id || null;
    if (!supplierId) return { error: 'Select the supplier (partner) before creating the import.', code: 400 };

    // 1) Create the import from approved fields.
    const created = await imports.create({
      supplier_id: supplierId, material_id: b.material_id || null, warehouse_id: b.warehouse_id || null,
      country_of_origin: f.country_of_origin || null,
      proforma_invoice_number: f.proforma_invoice_number || null,
      commercial_invoice_number: f.commercial_invoice_number || null,
      invoice_date: f.invoice_date || null,
      quantity: f.quantity || 0, unit: f.unit || 'KG', currency: f.currency || 'USD',
      unit_price: f.unit_price || 0, invoice_value: f.invoice_value || 0,
      incoterm: normIncoterm(f.incoterm), exchange_rate: b.exchange_rate || 0,
      port_of_loading: f.port_of_loading || null, port_of_discharge: f.port_of_discharge || null,
      final_destination: f.final_destination || 'Ludhiana', shipping_line: f.shipping_line || null,
      bl_number: f.bl_number || null, etd: f.etd || null,
      status: 'PLANNED', remarks: (f.goods_description ? f.goods_description + '. ' : '') + (b.remarks || ''),
    }, user);
    if (created.error) return created;
    const importId = created.import.import_id;
    const summary = { import_id: importId, import_no: created.import.import_no, documents: 0, shipment: false, costing: false, customs: false, advance: false };

    // Mark provenance + advance (columns added in schema).
    try {
      await pool.query(`UPDATE imports SET created_via='AI_DOC_INTAKE', advance_amount=$2, advance_currency=$3 WHERE import_id=$1`,
        [importId, Number(b.advance_amount) || 0, b.advance_amount ? (f.currency || 'USD') : null]);
      if (b.advance_amount) summary.advance = true;
    } catch { /* non-fatal */ }

    // 2) Shipment + vessel + container, if BL/vessel present.
    if (f.bl_number || f.vessel_name || f.container_no) {
      let vesselId = null;
      if (f.vessel_name) {
        const ex = (await pool.query(`SELECT vessel_id FROM import_vessels WHERE deleted_at IS NULL AND (LOWER(vessel_name)=LOWER($1) OR imo_number=$2) LIMIT 1`, [f.vessel_name, f.imo_number || null])).rows[0];
        if (ex) vesselId = ex.vessel_id;
        else { const v = (await pool.query(`INSERT INTO import_vessels (vessel_name, imo_number, created_by) VALUES ($1,$2,$3) RETURNING vessel_id`, [f.vessel_name, f.imo_number || null, user?.username || null])).rows[0]; vesselId = v.vessel_id; }
      }
      const sh = await imports.addShipment(importId, { booking_number: f.bl_number || null, shipping_line: f.shipping_line || null,
        vessel_id: vesselId, voyage_number: f.voyage_no || null, bl_number: f.bl_number || null, master_bl: f.bl_number || null,
        port_of_loading: f.port_of_loading || null, port_of_discharge: f.port_of_discharge || null, etd: f.etd || null,
        quantity: f.quantity || 0, status: 'PLANNED' }, user);
      summary.shipment = !!sh.ok;
      if (sh.ok && f.container_no) await imports.addContainer(sh.shipment.shipment_id, { container_number: f.container_no, seal_number: f.seal_no || null, gross_weight: f.gross_weight_kg || 0, net_weight: f.net_weight_kg || 0, package_count: f.cartons || 0 }, user).catch(() => {});
    }

    // 3) Attach the classified documents.
    for (const d of (b.documents || [])) {
      if (!d.file_data || !d.doc_type) continue;
      const r = await clr.upsertDocument(importId, { doc_type: d.doc_type, status: 'UPLOADED', file_name: d.file_name || d.doc_type,
        mime_type: 'application/pdf', file_data: d.file_data, remarks: 'AI intake (auto-classified)' }, user).catch(() => null);
      if (r && r.ok) summary.documents++;
    }

    // 4) Seed costing (estimate) when an exchange rate is given.
    if (b.exchange_rate && f.invoice_value) {
      const cs = await costing.saveCosting(importId, { cif_value: f.invoice_value, invoice_currency: f.currency || 'USD',
        exchange_rate: b.exchange_rate, ocean_freight_treatment: 'INCLUDED_IN_CIF', marine_insurance_treatment: 'INCLUDED_IN_CIF',
        is_actual: false }, user).catch(() => null);
      summary.costing = !!(cs && cs.ok);
    }

    // 5) Pre-fill customs (BOE) if the docs carried any.
    if (f.boe_number || f.customs_duty != null) {
      await clr.saveCustoms(importId, { boe_number: f.boe_number || null, customs_status: 'NOT_FILED', remarks: 'AI intake prefilled' }, user).catch(() => {});
      summary.customs = true;
    }

    return { ok: true, ...summary,
      note: 'Import created as PLANNED with your approved data. Advance and landed-cost vouchers are drafts — post them in Busy from the Import Reports → Busy readiness panel and record the reference.' };
  }

  // Read a bank TT advice PDF → a draft payment (with its OWN exchange rate) + a
  // check of whether it matches the given import (by invoice ref / supplier). Never
  // creates the payment — returns a draft for POST /:id/payments to record.
  async function analyzeTT(file, importId, password) {
    if (!file || !(file.file_data || file.base64)) return { error: 'Provide the TT advice PDF.', code: 400 };
    const r = await readPdfJson(String(file.file_data || file.base64), TT_SYS, 'Extract this bank TT / remittance advice. Return ONLY the JSON object.', password || file.password);
    if (r.error) return { error: r.error, code: r.needsPassword ? 401 : 422, needsPassword: !!r.needsPassword };
    const j = r.j || {};
    const n = (v) => (v == null || v === '' || isNaN(Number(String(v).replace(/[, ]/g, ''))) ? null : Number(String(v).replace(/[, ]/g, '')));
    const swift = n(j.swift_charges_inr), adv = n(j.advance_import_charges_inr), fx = n(j.fx_conversion_charges_inr);
    let other = n(j.other_bank_charges_inr);
    const grand = n(j.bank_charges_inr);
    // If the model gave a grand total but no explicit "other", derive it as the remainder.
    if (other == null && grand != null) {
      const itemised = (swift || 0) + (adv || 0) + (fx || 0);
      other = Math.max(Math.round((grand - itemised) * 100) / 100, 0);
    }
    const tt = {
      tt_reference: str(j.tt_reference), tt_date: str(j.tt_date), purpose: str(j.purpose),
      beneficiary_name: str(j.beneficiary_name), invoice_ref: str(j.invoice_ref),
      amount_fc: n(j.amount_fc), currency: str(j.currency) || 'USD', exchange_rate: n(j.exchange_rate),
      amount_inr: n(j.amount_inr), account_debit_inr: n(j.account_debit_inr), bank_charges_inr: grand,
      swift_charges: swift, advance_import_charges: adv, fx_conversion_charges: fx, other_bank_charges: other,
      bank: str(j.bank),
    };
    const payment_draft = {
      kind: j.is_advance === false ? 'BALANCE' : 'ADVANCE',
      amount_fc: tt.amount_fc, currency: tt.currency, exchange_rate: tt.exchange_rate,
      amount_inr: tt.amount_inr,
      swift_charges: swift, advance_import_charges: adv, fx_conversion_charges: fx, bank_charges: other,
      tt_reference: tt.tt_reference, tt_date: tt.tt_date, bank: tt.bank, invoice_ref: tt.invoice_ref, remarks: tt.purpose,
    };
    // Does this TT match the import it is being attached to?
    let match = null;
    if (importId) {
      const imp = (await pool.query(`SELECT i.import_no, i.commercial_invoice_number, i.proforma_invoice_number, p.company_name AS supplier
        FROM imports i LEFT JOIN partners p ON p.partner_id=i.supplier_id WHERE i.import_id=$1 AND i.deleted_at IS NULL`, [importId])).rows[0];
      if (imp) {
        const norm = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const invMatch = tt.invoice_ref && [imp.commercial_invoice_number, imp.proforma_invoice_number].some(x => x && (norm(x).includes(norm(tt.invoice_ref)) || norm(tt.invoice_ref).includes(norm(x))));
        const supMatch = tt.beneficiary_name && imp.supplier && norm(imp.supplier).slice(0, 8) && (norm(imp.supplier).includes(norm(tt.beneficiary_name).slice(0, 8)) || norm(tt.beneficiary_name).includes(norm(imp.supplier).slice(0, 8)));
        match = { import_no: imp.import_no, invoice_matches: !!invMatch, supplier_matches: !!supMatch,
          warning: (!invMatch && !supMatch) ? `This TT references invoice "${tt.invoice_ref}" / "${tt.beneficiary_name}" which does not match ${imp.import_no} (${imp.commercial_invoice_number || imp.proforma_invoice_number || '—'}, ${imp.supplier || '—'}). Confirm before recording.` : null };
      }
    }
    return { ok: true, read_by: r.read_by, tt, payment_draft, match,
      disclaimer: 'AI-read from the TT advice. Verify the amounts, rate and charge split before recording. Nothing is posted to Busy.' };
  }

  // Shipping-line / forwarder DEBIT NOTE — ocean freight + destination charges (THC,
  // IHC, BL/doc fees…). On FOB/FCA/EXW/CFR terms these are the buyer's cost and are
  // ADDED to landed cost; the draft marks ocean freight ADDITIONAL so it is not
  // treated as already-in-CIF. Read-only: returns a costing draft to approve.
  const DEBIT_NOTE_SYS = [
    'You read a SHIPPING LINE or FREIGHT FORWARDER DEBIT NOTE / invoice of import charges.',
    'Return ONLY a JSON object, no prose, no code fences. Use null for anything not stated — never invent.',
    'Numbers plain (no symbols/commas). Dates as YYYY-MM-DD.',
    '{',
    '  "reference": string|null,        // debit note / invoice number',
    '  "date": string|null,',
    '  "currency": string|null,         // usually INR',
    '  "ocean_freight": number|null,    // ocean / sea freight',
    '  "thc": number|null,              // Terminal Handling Charges (THC / DTHC)',
    '  "ihc": number|null,              // Inland Haulage Charges (IHC)',
    '  "bl_fee": number|null,           // Bill of Lading / documentation / doc fee',
    '  "cfs_charges": number|null,      // CFS / container freight station',
    '  "cha_charges": number|null,      // CHA / clearing agent charges',
    '  "port_charges": number|null,     // port / terminal storage etc.',
    '  "other_charges": number|null,    // any other line charge total (MUC, seal, etc.)',
    '  "gst": number|null,              // total GST on the note',
    '  "grand_total": number|null',
    '}',
  ].join('\n');

  async function analyzeDebitNote(file, importId, password) {
    if (!file || !(file.file_data || file.base64)) return { error: 'Provide the debit-note PDF.', code: 400 };
    const r = await readPdfJson(String(file.file_data || file.base64), DEBIT_NOTE_SYS, 'Extract this shipping-line / forwarder debit note. Return ONLY the JSON object.', password || file.password);
    if (r.error) return { error: r.error, code: r.needsPassword ? 401 : 422, needsPassword: !!r.needsPassword };
    const j = r.j || {};
    const n = (v) => (v == null || v === '' || isNaN(Number(String(v).replace(/[, ]/g, ''))) ? null : Number(String(v).replace(/[, ]/g, '')));
    // Freight is already inside the supplier price only on CIF/CFR/CIP terms.
    const imp = importId ? (await pool.query(`SELECT import_no, incoterm FROM imports WHERE import_id=$1 AND deleted_at IS NULL`, [importId])).rows[0] : null;
    const freightInPrice = ['CIF', 'CFR', 'CIP'].includes(String(imp?.incoterm || '').toUpperCase());
    const freight = n(j.ocean_freight);
    const costing_draft = {
      // Ocean freight: ADDITIONAL unless the incoterm already includes it.
      ocean_freight_treatment: freight != null ? (freightInPrice ? 'INCLUDED_IN_CIF' : 'ADDITIONAL') : undefined,
      ocean_freight_amount: freight != null ? freight : undefined,
      terminal_charges: n(j.thc) != null ? n(j.thc) : undefined,     // THC
      local_transport: n(j.ihc) != null ? n(j.ihc) : undefined,      // IHC (inland haulage)
      documentation_charges: n(j.bl_fee) != null ? n(j.bl_fee) : undefined,
      cfs_charges: n(j.cfs_charges) != null ? n(j.cfs_charges) : undefined,
      cha_charges: n(j.cha_charges) != null ? n(j.cha_charges) : undefined,
      port_charges: n(j.port_charges) != null ? n(j.port_charges) : undefined,
      other_import_expenses: n(j.other_charges) != null ? n(j.other_charges) : undefined,
    };
    // Drop undefined keys so the UI merges only what was found.
    Object.keys(costing_draft).forEach((k) => costing_draft[k] === undefined && delete costing_draft[k]);
    return {
      ok: true, read_by: r.read_by,
      debit_note: { reference: str(j.reference), date: str(j.date), currency: str(j.currency) || 'INR', gst: n(j.gst), grand_total: n(j.grand_total) },
      costing_draft,
      incoterm: imp?.incoterm || null,
      note: freight != null && !freightInPrice
        ? `Incoterm ${imp?.incoterm || 'FOB'}: ocean freight is the buyer's cost — marked ADDITIONAL so it adds to landed cost.`
        : (freightInPrice ? `Incoterm ${imp?.incoterm}: freight is already in the supplier price — not re-added.` : 'Review each charge before applying to costing.'),
      disclaimer: 'AI-read from the debit note. Verify each charge and the freight treatment before applying. Nothing is posted to Busy.',
    };
  }

  // Bill of Entry (ICEGATE / Indian Customs) — reads the BoE into a customs-clearance
  // draft (BE no/date, assessable value, duty breakdown, challan, containers, CHA).
  // Read-only: returns a draft for the Customs tab to review + save.
  const BOE_SYS = [
    'You read an INDIAN CUSTOMS BILL OF ENTRY (BoE / ICEGATE, "Bill of Entry for Home Consumption").',
    'Return ONLY a JSON object, no prose, no code fences. Use null for anything not stated — never invent or guess.',
    'Numbers plain (no symbols/commas). Dates as YYYY-MM-DD (input may be DD/MM/YYYY or DD-MON-YY).',
    '',
    'HOW AN INDIAN BoE IS LAID OUT — read carefully, these are DIFFERENT numbers:',
    '• ASSESSABLE VALUE ("TOT. ASS. VAL" / "Total Assess Value") = the INR value of the GOODS',
    '  (CIF + 1% landing). It is the BASE the duties are charged ON, and is normally MUCH LARGER',
    '  than any single duty and larger than the total duty. Do NOT confuse it with duty.',
    '• The duty table has one ROW PER DUTY TYPE (BCD, SWS, IGST, etc.), each with its own amount',
    '  (often an "Amount"/"DUTY AMOUNT"/"DUTY FORE"+"DUTY INR" column). Read each row separately:',
    '    - BCD  = Basic Customs Duty (the "BASIC" / "BCD" row).',
    '    - SWS  = Social Welfare Surcharge (usually 10% of BCD).',
    '    - IGST = Integrated GST (the largest duty row; recoverable ITC).',
    '    - other = ACD/NCCD/ADD/CVD/Health cess/Compensation cess etc., combined.',
    '• TOTAL DUTY ("TOT. DUTY" / "Total Duty Amt" / "Duty Payable") = the SUM of all the duty rows',
    '  above. It is a DUTY total, NOT the goods value. If your total_duty ends up roughly EQUAL to',
    '  assessable_value, you have almost certainly grabbed the wrong figure — re-check.',
    '',
    'RULES:',
    '• Prefer the per-row duty amounts. Only if a single duty row is genuinely absent, leave it null —',
    '  never spread total_duty across the components yourself.',
    '• assessable_value must be the goods value, not a duty. total_duty must be a duty total, not goods.',
    '• Sanity: expect assessable_value > total_duty, and igst to be the biggest single duty. If what you',
    '  read violates this, you likely mis-read a column — look again before answering. Still, report ONLY',
    '  what the document actually shows; if a number is not legible, use null rather than forcing the check.',
    '{',
    '  "boe_number": string|null,          // BE No',
    '  "boe_date": string|null,            // BE Date',
    '  "port_code": string|null,',
    '  "invoice_no": string|null,          // the supplier invoice referenced',
    '  "invoice_amount": number|null,      // invoice value (foreign currency)',
    '  "invoice_currency": string|null,    // e.g. USD',
    '  "supplier_name": string|null,       // seller',
    '  "cha": string|null,                 // Customs Broker (CB NAME)',
    '  "exchange_rate": number|null,       // customs exchange rate (1 USD = X INR)',
    '  "assessable_value": number|null,    // TOT.ASS VAL (INR) — GOODS value, the duty base',
    '  "bcd": number|null,                 // Basic Customs Duty amount (INR), its own row',
    '  "sws": number|null,                 // Social Welfare Surcharge amount (INR), its own row',
    '  "igst": number|null,                // IGST amount (INR), its own row (recoverable ITC)',
    '  "other_duties": number|null,        // ACD/NCCD/ADD/CVD/cess etc. combined, if any',
    '  "total_duty": number|null,          // TOTAL DUTY (INR) — sum of the duty rows, NOT the goods value',
    '  "challan_no": string|null,          // payment challan number',
    '  "duty_payment_date": string|null,',
    '  "out_of_charge": boolean,           // true if Out of Charge granted',
    '  "containers": [string]              // container numbers',
    '}',
  ].join('\n');

  async function analyzeBoe(file, importId, password) {
    if (!file || !(file.file_data || file.base64)) return { error: 'Provide the Bill of Entry PDF.', code: 400 };
    const r = await readPdfJson(String(file.file_data || file.base64), BOE_SYS, 'Extract this Indian customs Bill of Entry. Return ONLY the JSON object.', password || file.password);
    if (r.error) return { error: r.error, code: r.needsPassword ? 401 : 422, needsPassword: !!r.needsPassword };
    const j = r.j || {};
    const n = (v) => (v == null || v === '' || isNaN(Number(String(v).replace(/[, ]/g, ''))) ? null : Number(String(v).replace(/[, ]/g, '')));
    const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
    const bcd = n(j.bcd), sws = n(j.sws), igst = n(j.igst), other = n(j.other_duties);
    // SWS + any other non-recoverable duties go to "other taxes"; IGST is recoverable ITC.
    const otherTaxes = r2((sws || 0) + (other || 0));
    const status = j.out_of_charge ? 'OUT_OF_CHARGE' : (j.duty_payment_date || j.challan_no ? 'DUTY_PAID' : 'FILED');
    const customs_draft = {
      boe_number: str(j.boe_number), boe_date: str(j.boe_date),
      customs_status: status,
      assessable_value: n(j.assessable_value),
      customs_duty: bcd,                 // Basic Customs Duty
      other_taxes: otherTaxes || null,   // SWS (+ other non-recoverable)
      igst: igst,                        // recoverable ITC (excluded from landed cost)
      duty_payment_date: str(j.duty_payment_date),
      out_of_charge_date: j.out_of_charge ? str(j.duty_payment_date) : null,
      cha: str(j.cha),
      remarks: [j.challan_no ? `Challan ${j.challan_no}` : null,
                j.exchange_rate ? `Customs rate ₹${j.exchange_rate}/${j.invoice_currency || 'USD'}` : null,
                j.total_duty ? `Total duty ₹${j.total_duty}` : null,
                Array.isArray(j.containers) && j.containers.length ? `Containers ${j.containers.join(', ')}` : null,
                j.invoice_no ? `Invoice ${j.invoice_no}` : null].filter(Boolean).join(' · ') || null,
    };
    // Match to the import it is being attached to (by invoice number).
    let match = null, impRow = null;
    if (importId) {
      impRow = (await pool.query(`SELECT import_no, commercial_invoice_number, proforma_invoice_number, invoice_value, currency, p.company_name AS supplier
        FROM imports i LEFT JOIN partners p ON p.partner_id=i.supplier_id WHERE i.import_id=$1 AND i.deleted_at IS NULL`, [importId])).rows[0];
      if (impRow) {
        const norm = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const invMatch = j.invoice_no && [impRow.commercial_invoice_number, impRow.proforma_invoice_number].some(x => x && (norm(x).includes(norm(j.invoice_no)) || norm(j.invoice_no).includes(norm(x))));
        match = { import_no: impRow.import_no, invoice_matches: !!invMatch,
          warning: (j.invoice_no && !invMatch) ? `BoE invoice "${j.invoice_no}" does not match ${impRow.import_no} (${impRow.commercial_invoice_number || impRow.proforma_invoice_number || '—'}). Confirm before saving.` : null };
      }
    }
    // Sanity flags on the extracted duties — surfaced so the operator re-checks before saving.
    const totalDuty = n(j.total_duty);
    const assessable = n(j.assessable_value);
    const rate = n(j.exchange_rate);
    const warnings = [];
    // Cross-check assessable value against the import's own declared goods value × the BoE's
    // exchange rate. ICEGATE BoEs are dense tabular forms and the duty figure is easily mis-read
    // into the assessable-value field; the goods value should dwarf the total duty. We only flag
    // and suggest the expected figure — never silently overwrite what the document was read as.
    const impVal = n(impRow && impRow.invoice_value);
    const expectedAss = (impVal != null && rate != null) ? r2(impVal * rate) : null;
    if (expectedAss != null && assessable != null && assessable < expectedAss * 0.6) {
      warnings.push(`Assessable value read as ₹${assessable}, but ${impRow.import_no}'s declared goods value (${impVal} ${impRow.currency || ''} × customs rate ₹${rate}) is ≈ ₹${expectedAss}. The read figure looks like the duty, not the goods value — likely a swapped field. Expected assessable ≈ ₹${expectedAss}; verify and correct before saving.`);
    }
    if (assessable != null && totalDuty != null && totalDuty >= assessable * 0.9)
      warnings.push(`Assessable value (₹${assessable}) and total duty (₹${totalDuty}) are nearly equal — one was likely mis-read. Assessable value is the goods value and should be much larger than the duty. Verify both.`);
    const dutySum = r2((bcd || 0) + (sws || 0) + (igst || 0) + (other || 0));
    if (totalDuty != null && dutySum > 0 && Math.abs(dutySum - totalDuty) > Math.max(1, totalDuty * 0.02))
      warnings.push(`Duty components (BCD+SWS+IGST+other = ₹${dutySum}) do not sum to the stated total duty (₹${totalDuty}). Check the duty breakdown.`);
    if (totalDuty != null && bcd == null && sws == null && igst == null)
      warnings.push('Total duty was read but the BCD/SWS/IGST breakdown came back empty — enter the components from the BoE duty table manually.');

    return { ok: true, read_by: r.read_by, expected_assessable: expectedAss,
      boe: { ...customs_draft, bcd, sws, igst, total_duty: totalDuty, exchange_rate: n(j.exchange_rate), invoice_no: str(j.invoice_no), containers: j.containers || [] },
      customs_draft, match,
      warnings: warnings.length ? warnings : null,
      note: 'BCD + SWS add to landed cost; IGST is recoverable ITC and is excluded. Customs exchange rate is separate from your TT remittance rate.',
      disclaimer: 'AI-read from the Bill of Entry. Verify duties and BE number before saving. Nothing is posted to Busy.' };
  }

  return { analyzeDocs, applyProposal, analyzeTT, analyzeDebitNote, analyzeBoe, extractOne, matchSupplier, _mergeImport: mergeImport, _reconcile: reconcile };
};
