// Phase 6 — AI accountant hooks (gated). The AI may ONLY (a) propose a voucher,
// which lands as a DRAFT through the one authoritative service, and (b) explain
// a balance, read-only. It never validates, approves, posts or reverses — a
// human does that through the normal flow. This module deliberately exposes no
// path to post, so an AI integration cannot write to the ledger directly.
const R = require('./rules');

module.exports = (pool) => {
  const svc = require('./service')(pool);
  const docs = require('./documents')(pool);
  async function cid() { return svc.companyId(); }

  // Propose a journal (explicit Dr/Cr lines) as a DRAFT for human review.
  async function proposeVoucher({ voucher_type = 'JOURNAL', voucher_date, party_ledger_id, reference_no, narration, lines, rationale }, user) {
    if (!Array.isArray(lines) || lines.length < 2) throw new R.AccountingError('A proposal needs at least two lines', 'ACCT_INVALID');
    const actor = { username: (user && user.username) || 'ai-accountant', ai: true };
    const draft = await svc.createDraft({
      voucher_type, voucher_date, party_ledger_id: party_ledger_id || null, reference_no: reference_no || null,
      narration: `[AI proposal] ${narration || ''}`.trim(), source_module: 'acct.ai', lines,
    }, actor);
    if (rationale) {
      await pool.query(`INSERT INTO acct.audit_log (company_id, entity, entity_id, action, actor, detail) VALUES ($1,'voucher',$2,'AI_PROPOSE',$3,$4)`,
        [await cid(), draft.voucher_id, actor.username, JSON.stringify({ rationale })]);
    }
    return { ...(await svc.getVoucher(draft.voucher_id)), ai_generated: true, requires_human_approval: true,
      note: 'Draft created by the AI accountant. A human must validate and post it — the AI cannot.' };
  }

  // Propose a Sales/Purchase document (GST computed by the engine) as a DRAFT.
  async function proposeDocument(body, user) {
    const actor = { username: (user && user.username) || 'ai-accountant', ai: true };
    const v = await docs.create({ ...body, source_module: 'acct.ai' }, actor);
    return { ...v, ai_generated: true, requires_human_approval: true };
  }

  // Read-only: explain a ledger's balance in plain terms (no writes).
  async function explainBalance({ ledger_id, as_of }) {
    if (!ledger_id) throw new R.AccountingError('ledger_id is required', 'ACCT_INVALID');
    const bal = await svc.ledgerBalance(ledger_id, as_of);
    const st = await svc.ledgerStatement({ ledger_id, to: as_of });
    const recent = (st.lines || []).slice(-8).map((l) => ({ date: l.date, voucher_no: l.voucher_no, type: l.voucher_type, debit: l.debit, credit: l.credit, balance: l.balance }));
    const dr = recent.reduce((s, l) => s + (R.toPaise(l.debit) || 0), 0);
    const cr = recent.reduce((s, l) => s + (R.toPaise(l.credit) || 0), 0);
    return {
      ledger: st.ledger, as_of: st.to, closing: bal,
      opening: st.opening, movement: { debit: st.total_debit, credit: st.total_credit },
      recent,
      summary: `${st.ledger.name}: opening ${st.opening.amount} ${st.opening.side}, ` +
        `movement Dr ${st.total_debit} / Cr ${st.total_credit}, closing ${bal.amount} ${bal.side}. ` +
        `Last ${recent.length} entries net Dr ${R.fromPaise(dr)} / Cr ${R.fromPaise(cr)}.`,
      disclaimer: 'Read-only explanation generated from posted ledger data. Not financial advice.',
    };
  }

  return { proposeVoucher, proposeDocument, explainBalance };
};
