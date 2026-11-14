// Outbound supplier payments — Host-to-host (H2H) Phase B. DRAFT-ONLY.
//
// SAFETY CONTRACT (do not weaken):
//   1. The MES GENERATES a bank-uploadable payment file. It NEVER transmits money,
//      never connects to the bank to send, never debits anything. A human takes the
//      file to the bank, where the bank's own MAKER-CHECKER approves the debit.
//   2. A beneficiary must be APPROVED (verified bank details) before it can be paid.
//      An unapproved/inactive beneficiary cannot go into a batch.
//   3. Hard ceilings per payment and per batch (env) catch fat-finger / fraud.
//   4. Every step is audited. Nothing here writes to Busy.
//
// Output formats: ISO 20022 pain.001 (XML) and a generic NEFT/RTGS CSV. The exact
// per-bank CSV layout is set when the bank's H2H spec is in hand (same as inbound).

const { nextSeq } = require('./sequences');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d) => { const n = Number(process.env[v]); return Number.isFinite(n) ? n : d; };
const clean = (s) => String(s == null ? '' : s).trim();
const MAX_TXN = () => num('BANK_PAY_MAX_PER_TXN', 10000000);     // ₹1 Cr default per payment
const MAX_BATCH = () => num('BANK_PAY_MAX_PER_BATCH', 50000000); // ₹5 Cr default per batch
const esc = (s) => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

module.exports = (pool) => {
  const audit = async (username, action, newVal) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'BANK_PAYOUT',$3)`,
      [username || null, action, newVal ? JSON.stringify(newVal).slice(0, 4000) : null]); } catch {}
  };

  // ── Beneficiaries (approved bank-detail master) ──────────────────────────────
  async function listBeneficiaries(q = {}) {
    const p = []; let where = 'b.is_active = true';
    if (q.partner_id) { p.push(q.partner_id); where += ` AND b.partner_id = $${p.length}`; }
    if (q.approved === 'true') where += ' AND b.approved = true';
    return (await pool.query(
      `SELECT b.*, pt.company_name AS partner_name FROM bank_beneficiaries b
         LEFT JOIN partners pt ON pt.partner_id = b.partner_id
        WHERE ${where} ORDER BY b.beneficiary_name`, p)).rows;
  }

  async function addBeneficiary(b, user) {
    b = b || {};
    for (const f of ['beneficiary_name', 'account_no', 'ifsc']) if (!clean(b[f])) return { error: `${f.replace(/_/g, ' ')} is required`, code: 400 };
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(clean(b.ifsc))) return { error: 'IFSC is not valid (expected 11 chars like HDFC0001234).', code: 400 };
    try {
      const r = await pool.query(
        `INSERT INTO bank_beneficiaries (partner_id, beneficiary_name, account_no, ifsc, bank_name, swift, email, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [b.partner_id || null, clean(b.beneficiary_name), clean(b.account_no), clean(b.ifsc).toUpperCase(),
         clean(b.bank_name) || null, clean(b.swift) || null, clean(b.email) || null, user?.username || null]);
      await audit(user?.username, 'ADD_BENEFICIARY', { name: b.beneficiary_name, acct: b.account_no });
      return { ok: true, beneficiary: r.rows[0] };
    } catch (e) { if (e.code === '23505') return { error: 'A beneficiary with this account + IFSC already exists.', code: 409 }; return { error: e.message, code: 500 }; }
  }

  // Approval is the control: only an authorised user turns a beneficiary payable.
  async function approveBeneficiary(id, user) {
    const r = await pool.query(`UPDATE bank_beneficiaries SET approved=true, approved_by=$2, approved_at=NOW() WHERE beneficiary_id=$1 RETURNING *`, [id, user?.username || null]);
    if (!r.rows.length) return { error: 'Beneficiary not found', code: 404 };
    await audit(user?.username, 'APPROVE_BENEFICIARY', { beneficiary_id: id });
    return { ok: true, beneficiary: r.rows[0] };
  }

  // ── Payment batch (draft) ────────────────────────────────────────────────────
  // lines: [{ beneficiary_id, amount, purpose, reference, invoice_ref, partner_id }]
  async function createBatch(body, user) {
    const b = body || {};
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (!lines.length) return { error: 'Add at least one payment line.', code: 400 };
    const method = ['NEFT', 'RTGS', 'IMPS'].includes(b.payment_method) ? b.payment_method : 'NEFT';

    // Validate every line against the APPROVED beneficiary master + ceilings.
    const prepared = [];
    let total = 0;
    for (const [i, ln] of lines.entries()) {
      const amt = r2(ln.amount);
      if (!(amt > 0)) return { error: `Line ${i + 1}: amount must be greater than 0.`, code: 400 };
      if (amt > MAX_TXN()) return { error: `Line ${i + 1}: ₹${amt.toLocaleString('en-IN')} exceeds the per-payment limit (₹${MAX_TXN().toLocaleString('en-IN')}).`, code: 400 };
      if (method === 'RTGS' && amt < 200000) return { error: `Line ${i + 1}: RTGS minimum is ₹2,00,000 (use NEFT for smaller).`, code: 400 };
      if (method === 'IMPS' && amt > 500000) return { error: `Line ${i + 1}: IMPS maximum is ₹5,00,000 (use NEFT/RTGS).`, code: 400 };
      const ben = (await pool.query(`SELECT * FROM bank_beneficiaries WHERE beneficiary_id=$1 AND is_active=true`, [ln.beneficiary_id])).rows[0];
      if (!ben) return { error: `Line ${i + 1}: beneficiary not found or inactive.`, code: 400 };
      if (!ben.approved) return { error: `Line ${i + 1}: beneficiary "${ben.beneficiary_name}" is NOT approved — approve it before paying.`, code: 400 };
      prepared.push({ ben, amt, purpose: clean(ln.purpose) || 'Supplier payment', reference: clean(ln.reference) || null, invoice_ref: clean(ln.invoice_ref) || null, partner_id: ben.partner_id || ln.partner_id || null });
      total = r2(total + amt);
    }
    if (total > MAX_BATCH()) return { error: `Batch total ₹${total.toLocaleString('en-IN')} exceeds the per-batch limit (₹${MAX_BATCH().toLocaleString('en-IN')}).`, code: 400 };

    const batchNo = await nextSeq('PAYB', 'bank_payment_batches', 'batch_no');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const batch = (await c.query(
        `INSERT INTO bank_payment_batches (batch_no, from_account_id, value_date, currency, total_amount, payment_method, status, remarks, created_by)
         VALUES ($1,$2,$3,'INR',$4,$5,'DRAFT',$6,$7) RETURNING *`,
        [batchNo, b.from_account_id || null, b.value_date || null, total, method, clean(b.remarks) || null, user?.username || null])).rows[0];
      for (const p of prepared) await c.query(
        `INSERT INTO bank_payment_lines (batch_id, beneficiary_id, partner_id, amount, purpose, reference, invoice_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [batch.batch_id, p.ben.beneficiary_id, p.partner_id, p.amt, p.purpose, p.reference, p.invoice_ref]);
      await c.query('COMMIT');
      await audit(user?.username, 'CREATE_PAYMENT_BATCH', { batch_no: batchNo, lines: prepared.length, total, method });
      return { ok: true, batch_id: Number(batch.batch_id), batch_no: batchNo, total, lines: prepared.length, method };
    } catch (e) { await c.query('ROLLBACK'); return { error: e.message, code: 500 }; }
    finally { c.release(); }
  }

  async function getBatch(id) {
    const batch = (await pool.query(`SELECT * FROM bank_payment_batches WHERE batch_id=$1`, [id])).rows[0];
    if (!batch) return null;
    const lines = (await pool.query(
      `SELECT l.*, b.beneficiary_name, b.account_no, b.ifsc, b.bank_name FROM bank_payment_lines l
         LEFT JOIN bank_beneficiaries b ON b.beneficiary_id=l.beneficiary_id WHERE l.batch_id=$1 ORDER BY l.line_id`, [id])).rows;
    const { file_data, ...head } = batch;   // don't ship the file blob in the list view
    return { batch: head, lines, has_file: !!file_data };
  }

  const listBatches = () => pool.query(
    `SELECT batch_id, batch_no, value_date, currency, total_amount, payment_method, status, file_format, file_name, created_by, created_at, released_at
       FROM bank_payment_batches ORDER BY created_at DESC LIMIT 200`).then(r => r.rows);

  // ── File generation — builds the file, NEVER sends it ────────────────────────
  async function generateFile(id, format, user) {
    const data = await getBatch(id);
    if (!data) return { error: 'Batch not found', code: 404 };
    if (data.batch.status === 'RELEASED') return { error: 'This batch is already released.', code: 409 };
    if (data.batch.status === 'CANCELLED') return { error: 'This batch is cancelled.', code: 409 };
    if (!data.lines.length) return { error: 'Batch has no lines.', code: 400 };
    const fmt = (format || 'PAIN001').toUpperCase() === 'CSV' ? 'CSV' : 'PAIN001';
    const debtor = data.batch.from_account_id
      ? (await pool.query(`SELECT * FROM bank_accounts WHERE account_id=$1`, [data.batch.from_account_id])).rows[0] : null;

    const content = fmt === 'CSV' ? buildCsv(data, debtor) : buildPain001(data, debtor);
    const fileName = `${data.batch.batch_no}.${fmt === 'CSV' ? 'csv' : 'xml'}`;
    await pool.query(`UPDATE bank_payment_batches SET status='GENERATED', file_format=$2, file_name=$3, file_data=$4, generated_at=NOW() WHERE batch_id=$1`,
      [id, fmt, fileName, content]);
    await audit(user?.username, 'GENERATE_PAYMENT_FILE', { batch_no: data.batch.batch_no, format: fmt });
    return { ok: true, format: fmt, file_name: fileName, content, note: 'File generated for you to upload to the bank. The MES does not send it; the bank maker-checker approves the debit.' };
  }

  // Human marks the file taken to the bank. The MES still does not send anything —
  // this only records that the operator released it to the bank portal.
  async function release(id, user) {
    const b = (await pool.query(`SELECT status FROM bank_payment_batches WHERE batch_id=$1`, [id])).rows[0];
    if (!b) return { error: 'Batch not found', code: 404 };
    if (b.status !== 'GENERATED') return { error: 'Generate the payment file before releasing.', code: 409 };
    await pool.query(`UPDATE bank_payment_batches SET status='RELEASED', released_by=$2, released_at=NOW() WHERE batch_id=$1`, [id, user?.username || null]);
    await audit(user?.username, 'RELEASE_PAYMENT_BATCH', { batch_id: id });
    return { ok: true, note: 'Marked released. Upload the file to your bank H2H portal; the bank maker-checker approves the actual debit.' };
  }

  async function cancel(id, user) {
    const r = await pool.query(`UPDATE bank_payment_batches SET status='CANCELLED' WHERE batch_id=$1 AND status IN ('DRAFT','GENERATED') RETURNING batch_no`, [id]);
    if (!r.rows.length) return { error: 'Only a draft/generated batch can be cancelled.', code: 409 };
    await audit(user?.username, 'CANCEL_PAYMENT_BATCH', { batch_id: id });
    return { ok: true };
  }

  return { listBeneficiaries, addBeneficiary, approveBeneficiary, createBatch, getBatch, listBatches, generateFile, release, cancel };
};

// ── Pure file builders (module scope, no DB) — exposed for tests ───────────────
function buildCsv(data, debtor) {
  const head = ['Beneficiary Name', 'Account Number', 'IFSC', 'Amount', 'Payment Mode', 'Debit Account', 'Purpose', 'Reference', 'Email'];
  const rows = data.lines.map(l => [l.beneficiary_name, l.account_no, l.ifsc, r2(l.amount).toFixed(2), data.batch.payment_method,
    debtor?.account_no || '', l.purpose || '', l.reference || l.invoice_ref || '', l.email || '']
    .map(v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(','));
  return [head.join(','), ...rows].join('\r\n');
}

function buildPain001(data, debtor) {
    const now = new Date().toISOString();
    const total = r2(data.batch.total_amount).toFixed(2);
    const n = data.lines.length;
    const vdt = data.batch.value_date ? String(data.batch.value_date).slice(0, 10) : now.slice(0, 10);
    const svc = data.batch.payment_method === 'RTGS' ? 'RTGS' : (data.batch.payment_method === 'IMPS' ? 'IMPS' : 'NEFT');
    const tx = data.lines.map(l => `
      <CdtTrfTxInf>
        <PmtId><EndToEndId>${esc(l.reference || l.invoice_ref || ('L' + l.line_id))}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="INR">${r2(l.amount).toFixed(2)}</InstdAmt></Amt>
        <CdtrAgt><FinInstnId><ClrSysMmbId><MmbId>${esc(l.ifsc)}</MmbId></ClrSysMmbId></FinInstnId></CdtrAgt>
        <Cdtr><Nm>${esc(l.beneficiary_name)}</Nm></Cdtr>
        <CdtrAcct><Id><Othr><Id>${esc(l.account_no)}</Id></Othr></Id></CdtrAcct>
        <RmtInf><Ustrd>${esc((l.purpose || 'Supplier payment') + (l.invoice_ref ? ' ' + l.invoice_ref : ''))}</Ustrd></RmtInf>
      </CdtTrfTxInf>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${esc(data.batch.batch_no)}</MsgId>
      <CreDtTm>${now}</CreDtTm>
      <NbOfTxs>${n}</NbOfTxs>
      <CtrlSum>${total}</CtrlSum>
      <InitgPty><Nm>${esc(debtor?.account_name || 'DHOWN')}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(data.batch.batch_no)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${n}</NbOfTxs>
      <CtrlSum>${total}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>${svc}</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${vdt}</ReqdExctnDt>
      <Dbtr><Nm>${esc(debtor?.account_name || 'DHOWN')}</Nm></Dbtr>
      <DbtrAcct><Id><Othr><Id>${esc(debtor?.account_no || '')}</Id></Othr></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><ClrSysMmbId><MmbId>${esc(debtor?.ifsc || '')}</MmbId></ClrSysMmbId></FinInstnId></DbtrAgt>${tx}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;
}

// Exposed for tests (pure builders, no DB).
module.exports.builders = { buildCsv, buildPain001 };
