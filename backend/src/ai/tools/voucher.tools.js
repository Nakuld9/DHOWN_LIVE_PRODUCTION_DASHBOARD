// AI Accountant WRITE tools — draft Busy vouchers, behind the approvals queue.
//
// Phase 0 has no Busy write bridge, so "post" means: on human approval, produce
// the Busy-import artifact (the CSV a person imports into Busy) and record it in
// the immutable audit trail. Nothing is written to Busy automatically, and
// nothing is even prepared until a SUPERVISOR/ACCOUNTS approval runs execute().
//
// This keeps the golden rule intact: the AI drafts, a human approves, and the
// actual posting into the book of accounts stays a deliberate human step (until
// Busy's team provides a supported write API — Phase 2).

const makeRepository = require('../../repositories/busy-sync.repository');
const makeService = require('../../services/busy-sync.service');

module.exports = function registerVoucherTools(registry, { pool }) {
  const busy = makeService(makeRepository(pool));
  const audit = require('../../lib/audit')(pool);

  // Draft a PURCHASE voucher from approved GRNs in a date range. The rows are the
  // same Busy-import CSV the Busy-sync screen produces — the AI just prepares it
  // on request and books it into the audit trail once approved.
  registry.register({
    name: 'draft_purchase_voucher',
    description: 'Draft a Busy purchase voucher (CSV) from approved GRNs in a date range. Proposes for approval; on approval it prepares the Busy import file and records it in the audit trail — it does NOT post to Busy. Args: {from?: "YYYY-MM-DD", to?: "YYYY-MM-DD"}',
    safe: false,
    minRole: 'SUPERVISOR',
    approveRole: 'ACCOUNTS',
    propose: async ({ from, to } = {}) => {
      const { csv } = await busy.grnCsv({ from: from || null, to: to || null });
      const lines = String(csv).split('\n').length - 1;   // minus header
      if (lines <= 0) return { error: 'No approved GRNs in that range to draft a purchase voucher from.' };
      return {
        summary: `Draft purchase voucher from ${lines} GRN line(s)${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}. On approval, prepares the Busy import CSV — does not post to Busy.`,
        payload: { from: from || null, to: to || null, line_count: lines },
      };
    },
    execute: async (payload, { user } = {}) => {
      const { filename, csv } = await busy.grnCsv({ from: payload.from, to: payload.to });
      const lines = String(csv).split('\n').length - 1;
      await audit.record({
        actor: user?.username || null, actor_role: user?.role || null, agent: 'accountant',
        action: 'DRAFT_PURCHASE_VOUCHER', entity_type: 'purchase_voucher', entity_id: filename,
        after: { from: payload.from, to: payload.to, line_count: lines },
        reason: 'AI-drafted Busy purchase voucher from approved GRNs',
        status: 'APPROVED', approver: user?.username || null, approved_at: new Date().toISOString(),
        result: 'CSV prepared for manual Busy import',
      });
      return { ok: true, filename, line_count: lines, csv,
        note: 'Busy import CSV prepared and recorded in the audit trail. Import it into Busy (Purchase Vouchers), then reconcile. Nothing has been posted to Busy automatically.' };
    },
  });
};
