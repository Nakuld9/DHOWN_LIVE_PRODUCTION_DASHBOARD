// Import customs + documents + post-port logistics.
//
// Customs figures are recorded by the CHA/accounts team from the actual Bill of
// Entry — NO government/customs API is claimed. Documents are metadata + an
// optional base64 file. Logistics tracks the transport legs from port to the
// Ludhiana warehouse (which then feeds the existing GRN).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));

// The document set an import is expected to have. Completion % is measured over
// these; extra ad-hoc docs are allowed but don't change the denominator.
const REQUIRED_DOCS = [
  'PURCHASE_ORDER', 'PROFORMA_INVOICE', 'COMMERCIAL_INVOICE', 'PACKING_LIST', 'BILL_OF_LADING',
  'CERTIFICATE_OF_ORIGIN', 'INSURANCE', 'BILL_OF_ENTRY', 'DUTY_PAYMENT', 'TRANSPORT_LR', 'EWAY_BILL', 'POD',
];

module.exports = (pool) => {
  const audit = async (username, action, newVal) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'IMPORTS',$3)`,
      [username || null, action, newVal ? JSON.stringify(newVal).slice(0, 4000) : null]); } catch {}
  };
  const exists = async (id) => (await pool.query(`SELECT import_no FROM imports WHERE import_id=$1 AND deleted_at IS NULL`, [id])).rows[0];

  // ── Customs ─────────────────────────────────────────────────────────────────
  async function getCustoms(importId) {
    return (await pool.query(`SELECT * FROM import_customs WHERE import_id=$1`, [importId])).rows[0] || null;
  }
  async function saveCustoms(importId, b, user) {
    const imp = await exists(importId); if (!imp) return { error: 'Import not found', code: 404 };
    b = b || {};
    await pool.query(
      `INSERT INTO import_customs (import_id, boe_number, boe_date, customs_status, assessable_value, customs_duty,
         igst, other_taxes, duty_payment_date, examination_status, out_of_charge_date, cha, remarks, updated_at)
       VALUES ($1,$2,$3,COALESCE($4,'NOT_FILED'),$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (import_id) DO UPDATE SET boe_number=EXCLUDED.boe_number, boe_date=EXCLUDED.boe_date,
         customs_status=EXCLUDED.customs_status, assessable_value=EXCLUDED.assessable_value,
         customs_duty=EXCLUDED.customs_duty, igst=EXCLUDED.igst, other_taxes=EXCLUDED.other_taxes,
         duty_payment_date=EXCLUDED.duty_payment_date, examination_status=EXCLUDED.examination_status,
         out_of_charge_date=EXCLUDED.out_of_charge_date, cha=EXCLUDED.cha, remarks=EXCLUDED.remarks, updated_at=NOW()`,
      [importId, b.boe_number || null, b.boe_date || null, b.customs_status || null, num(b.assessable_value),
       num(b.customs_duty), num(b.igst), num(b.other_taxes), b.duty_payment_date || null,
       b.examination_status || null, b.out_of_charge_date || null, b.cha || null, b.remarks || null]);
    // Sync the duty figures into the costing row so landed cost reflects them:
    // BCD → customs_duty, SWS/other → other_customs_levies (both add to landed cost),
    // IGST → igst (recoverable ITC, excluded). Assessable value kept for reference.
    // Only writes fields present in this save, so a status-only update won't zero duties.
    const sets = [], params = [importId];
    const add = (col, val) => { params.push(num(val)); sets.push(`${col}=$${params.length}`); };
    if ('customs_duty' in b) add('customs_duty', b.customs_duty);
    if ('other_taxes' in b) add('other_customs_levies', b.other_taxes);
    if ('igst' in b) add('igst', b.igst);
    if ('assessable_value' in b) add('customs_assessable_value', b.assessable_value);
    if (sets.length) {
      await pool.query(`UPDATE import_costs SET ${sets.join(', ')}, updated_at=NOW() WHERE import_id=$1`, params);
      try { await require('./import-costing')(pool).getCosting(importId); } catch { /* refresh landed cost best-effort */ }
    }
    await audit(user?.username, 'IMPORT_CUSTOMS_SAVE', { import_no: imp.import_no, status: b.customs_status });
    return { ok: true, customs: await getCustoms(importId) };
  }

  // ── Documents ───────────────────────────────────────────────────────────────
  async function listDocuments(importId) {
    const rows = (await pool.query(
      `SELECT document_id, doc_type, status, file_name, mime_type, uploaded_by, uploaded_at,
              verified_by, verified_at, remarks, (file_data IS NOT NULL) AS has_file
         FROM import_documents WHERE import_id=$1 ORDER BY doc_type, document_id`, [importId])).rows;
    const present = new Set(rows.filter(r => r.status !== 'MISSING' && r.status !== 'REJECTED').map(r => r.doc_type));
    const verified = new Set(rows.filter(r => r.status === 'VERIFIED').map(r => r.doc_type));
    const requiredPresent = REQUIRED_DOCS.filter(d => present.has(d)).length;
    const requiredVerified = REQUIRED_DOCS.filter(d => verified.has(d)).length;
    return {
      documents: rows,
      required: REQUIRED_DOCS,
      missing: REQUIRED_DOCS.filter(d => !present.has(d)),
      completion_pct: Math.round((requiredPresent / REQUIRED_DOCS.length) * 100),
      verified_pct: Math.round((requiredVerified / REQUIRED_DOCS.length) * 100),
    };
  }
  async function upsertDocument(importId, b, user) {
    const imp = await exists(importId); if (!imp) return { error: 'Import not found', code: 404 };
    b = b || {};
    if (!b.doc_type) return { error: 'doc_type is required', code: 400 };
    // Basic upload validation: cap base64 payload and require a mime type when a file is sent.
    if (b.file_data) {
      if (String(b.file_data).length > 14 * 1024 * 1024) return { error: 'File too large (max ~10 MB).', code: 400 };
      if (!b.mime_type) return { error: 'mime_type is required with a file.', code: 400 };
    }
    const uploadedAt = b.file_data ? new Date().toISOString() : null;
    const r = await pool.query(
      `INSERT INTO import_documents (import_id, doc_type, status, file_name, mime_type, file_data, uploaded_by, uploaded_at, remarks)
       VALUES ($1,$2,COALESCE($3,'UPLOADED'),$4,$5,$6,$7,$8,$9) RETURNING document_id`,
      [importId, b.doc_type, b.status || null, b.file_name || null, b.mime_type || null, b.file_data || null,
       user?.username || null, uploadedAt, b.remarks || null]);
    await audit(user?.username, 'IMPORT_DOC_UPLOAD', { import_no: imp.import_no, doc_type: b.doc_type });
    return { ok: true, document_id: r.rows[0].document_id };
  }
  async function setDocumentStatus(importId, docId, status, user) {
    const ALLOWED = ['UPLOADED', 'VERIFIED', 'REJECTED', 'MISSING'];
    if (!ALLOWED.includes(status)) return { error: 'Invalid status', code: 400 };
    const r = await pool.query(
      `UPDATE import_documents SET status=$1, updated_at=NOW(),
         verified_by=CASE WHEN $1 IN ('VERIFIED','REJECTED') THEN $2 ELSE verified_by END,
         verified_at=CASE WHEN $1 IN ('VERIFIED','REJECTED') THEN NOW() ELSE verified_at END
       WHERE document_id=$3 AND import_id=$4 RETURNING doc_type`, [status, user?.username || null, docId, importId]);
    if (!r.rows.length) return { error: 'Document not found', code: 404 };
    await audit(user?.username, 'IMPORT_DOC_' + status, { doc_type: r.rows[0].doc_type });
    return { ok: true };
  }
  async function getDocumentFile(importId, docId) {
    return (await pool.query(`SELECT doc_type, file_name, mime_type, file_data FROM import_documents WHERE document_id=$1 AND import_id=$2`, [docId, importId])).rows[0] || null;
  }
  async function deleteDocument(importId, docId, user) {
    const r = await pool.query(`DELETE FROM import_documents WHERE document_id=$1 AND import_id=$2 RETURNING doc_type`, [docId, importId]);
    if (!r.rows.length) return { error: 'Document not found', code: 404 };
    await audit(user?.username, 'IMPORT_DOC_DELETE', { doc_type: r.rows[0].doc_type });
    return { ok: true };
  }

  // ── Logistics ────────────────────────────────────────────────────────────────
  async function listLogistics(importId) {
    return (await pool.query(
      `SELECT l.*, w.name AS warehouse_name FROM import_logistics l
         LEFT JOIN warehouses w ON w.warehouse_id=l.warehouse_id
        WHERE l.import_id=$1 ORDER BY l.dispatch_date NULLS LAST, l.leg_id`, [importId])).rows;
  }
  async function addLogistics(importId, b, user) {
    const imp = await exists(importId); if (!imp) return { error: 'Import not found', code: 404 };
    b = b || {};
    const r = await pool.query(
      `INSERT INTO import_logistics (import_id, shipment_id, transporter, vehicle_number, driver, lr_number,
         dispatch_date, expected_delivery, actual_delivery, freight, warehouse_id, status, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,'PLANNED'),$13) RETURNING leg_id`,
      [importId, b.shipment_id || null, b.transporter || null, b.vehicle_number || null, b.driver || null,
       b.lr_number || null, b.dispatch_date || null, b.expected_delivery || null, b.actual_delivery || null,
       num(b.freight), b.warehouse_id || null, b.status || null, b.remarks || null]);
    await audit(user?.username, 'IMPORT_LOGISTICS_ADD', { import_no: imp.import_no, leg_id: r.rows[0].leg_id });
    return { ok: true, leg_id: r.rows[0].leg_id };
  }
  async function updateLogistics(importId, legId, b, user) {
    b = b || {};
    const editable = ['transporter', 'vehicle_number', 'driver', 'lr_number', 'dispatch_date', 'expected_delivery',
      'actual_delivery', 'freight', 'warehouse_id', 'status', 'remarks'];
    const sets = [], params = [];
    for (const f of editable) if (f in b) { params.push(f === 'freight' ? num(b[f]) : (b[f] === '' ? null : b[f])); sets.push(`${f}=$${params.length}`); }
    if (!sets.length) return { error: 'nothing to update', code: 400 };
    params.push(legId, importId);
    const r = await pool.query(`UPDATE import_logistics SET ${sets.join(', ')}, updated_at=NOW() WHERE leg_id=$${params.length - 1} AND import_id=$${params.length} RETURNING leg_id`, params);
    if (!r.rows.length) return { error: 'Leg not found', code: 404 };
    await audit(user?.username, 'IMPORT_LOGISTICS_UPDATE', { leg_id: legId });
    return { ok: true };
  }

  return { getCustoms, saveCustoms, listDocuments, upsertDocument, setDocumentStatus, getDocumentFile,
    deleteDocument, listLogistics, addLogistics, updateLogistics, REQUIRED_DOCS };
};
