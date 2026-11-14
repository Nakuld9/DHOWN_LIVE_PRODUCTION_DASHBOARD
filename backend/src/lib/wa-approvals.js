// Value-banded approvals (HIGH-05).
//
// A ₹5,000 order and a ₹50,00,000 order required the same single approval, and
// credit was checked once at quotation and never again — so a customer could
// pass the check when quoted and breach it by the time they confirmed.
//
// Two things here:
//   1. requiredRole(docType, value) — who must sign off, by value band.
//   2. A request queue, so an escalation is a thing someone can see and act on
//      rather than a status buried on a document.

const ROLE_RANK = { OPERATOR: 1, SUPERVISOR: 2, ADMIN: 3, SUPER_ADMIN: 4 };

// Used when no bands are configured. Deliberately conservative: the fallback
// should never be more permissive than a deliberate configuration.
const DEFAULT_BANDS = [
  { doc_type: 'ORDER', min_value: 0,       max_value: 100000,  required_role: 'SUPERVISOR' },
  { doc_type: 'ORDER', min_value: 100000,  max_value: 1000000, required_role: 'ADMIN' },
  { doc_type: 'ORDER', min_value: 1000000, max_value: null,    required_role: 'SUPER_ADMIN' },
  { doc_type: 'QUOTE', min_value: 0,       max_value: 500000,  required_role: 'SUPERVISOR' },
  { doc_type: 'QUOTE', min_value: 500000,  max_value: null,    required_role: 'ADMIN' },
  { doc_type: 'CREDIT', min_value: 0,      max_value: null,    required_role: 'ADMIN' },
];

module.exports = (pool) => {

  async function seedDefaults() {
    const r = await pool.query(`SELECT COUNT(*)::int n FROM approval_matrix`);
    if (r.rows[0].n > 0) return 0;
    for (const b of DEFAULT_BANDS) {
      await pool.query(
        `INSERT INTO approval_matrix (doc_type,min_value,max_value,required_role)
         VALUES ($1,$2,$3,$4)`, [b.doc_type, b.min_value, b.max_value, b.required_role]);
    }
    return DEFAULT_BANDS.length;
  }

  async function requiredRole(docType, value) {
    const v = Number(value) || 0;
    const r = await pool.query(
      `SELECT required_role FROM approval_matrix
        WHERE doc_type=$1 AND is_active=true
          AND $2 >= min_value AND (max_value IS NULL OR $2 < max_value)
        ORDER BY min_value DESC LIMIT 1`, [docType, v]);
    if (r.rows.length) return r.rows[0].required_role;
    const fb = DEFAULT_BANDS.filter(b => b.doc_type === docType)
      .find(b => v >= b.min_value && (b.max_value === null || v < b.max_value));
    return fb ? fb.required_role : 'ADMIN';
  }

  const canApprove = (userRole, needed) =>
    (ROLE_RANK[String(userRole || '').toUpperCase()] || 0) >= (ROLE_RANK[needed] || 99);

  // Credit is a different kind of decision from order size. A small order to a
  // customer with a large overdue balance is still a credit call, so the role is
  // taken from the CREDIT band rather than the order's value band — otherwise a
  // supervisor could clear an overdue customer just because the order was small.
  const CREDIT_REASONS = new Set(['OVERDUE', 'CREDIT_LIMIT', 'BLOCKED']);
  const bandFor = (docType, reason) => (CREDIT_REASONS.has(reason) ? 'CREDIT' : docType);

  // Raise a request, unless an identical one is already open.
  async function request({ docType, docId, reason, detail, value, requestedBy }) {
    const needed = await requiredRole(bandFor(docType, reason), value);
    const dup = await pool.query(
      `SELECT request_id FROM approval_requests
        WHERE doc_type=$1 AND doc_id=$2 AND reason=$3 AND status='PENDING' LIMIT 1`,
      [docType, String(docId), reason || null]);
    if (dup.rows.length) return { request_id: dup.rows[0].request_id, required_role: needed, existing: true };

    const r = await pool.query(
      `INSERT INTO approval_requests (doc_type,doc_id,reason,detail,value,required_role,requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [docType, String(docId), reason || null, detail || null, Number(value) || 0, needed, requestedBy || null]);
    return { ...r.rows[0], required_role: needed };
  }

  // Decide. The rank check is here, not in the route, so no caller can approve
  // above their authority by hitting a different endpoint.
  async function decide(requestId, { approve, note, user, userRole }) {
    const req = (await pool.query(`SELECT * FROM approval_requests WHERE request_id=$1`, [requestId])).rows[0];
    if (!req) return { error: 'Approval request not found', code: 404 };
    if (req.status !== 'PENDING') return { error: `Already ${req.status}`, code: 409 };
    if (!canApprove(userRole, req.required_role)) {
      return { error: `This ${req.doc_type.toLowerCase()} needs ${req.required_role} approval (value ${Number(req.value)}).`, code: 403 };
    }
    const r = await pool.query(
      `UPDATE approval_requests
          SET status=$2, decided_by=$3, decided_at=NOW(), decision_note=$4
        WHERE request_id=$1 RETURNING *`,
      [requestId, approve ? 'APPROVED' : 'REJECTED', user || null, note || null]);
    return { ok: true, request: r.rows[0] };
  }

  async function pending({ docType } = {}) {
    const r = await pool.query(
      `SELECT * FROM approval_requests
        WHERE status='PENDING' AND ($1::text IS NULL OR doc_type=$1)
        ORDER BY created_at DESC LIMIT 200`, [docType || null]);
    return r.rows;
  }

  async function isApproved(docType, docId, reason) {
    const r = await pool.query(
      `SELECT status FROM approval_requests
        WHERE doc_type=$1 AND doc_id=$2 AND ($3::text IS NULL OR reason=$3)
        ORDER BY created_at DESC LIMIT 1`, [docType, String(docId), reason || null]);
    return r.rows.length ? r.rows[0].status === 'APPROVED' : null; // null = never requested
  }

  // Credit position at THIS moment — the whole point is that it is re-evaluated
  // at confirmation, not trusted from quotation time.
  async function creditCheck(partnerId, orderValue) {
    if (!partnerId) return { ok: true, note: 'No customer on record' };
    const r = await pool.query(
      // v_partner_outstanding is the single source of truth: it nets off
      // payments, so a customer who has part-paid is not blocked for the full
      // invoice value.
      `SELECT p.credit_limit,
              COALESCE(v.outstanding,0) AS outstanding,
              COALESCE(v.overdue,0)     AS overdue
         FROM partners p
         LEFT JOIN v_partner_outstanding v ON v.partner_id = p.partner_id
        WHERE p.partner_id=$1`, [partnerId]);
    if (!r.rows.length) return { ok: true, note: 'Customer not found' };

    const limit = Number(r.rows[0].credit_limit) || 0;
    const outstanding = Number(r.rows[0].outstanding) || 0;
    const overdue = Number(r.rows[0].overdue) || 0;
    const exposure = outstanding + (Number(orderValue) || 0);

    // Overdue money blocks regardless of headroom: a customer who has not paid
    // for the last order is the wrong one to extend further credit to.
    if (overdue > 0) {
      return { ok: false, reason: 'OVERDUE', limit, outstanding, overdue, exposure,
        note: `Customer has ${overdue} overdue. Credit approval required before confirming.` };
    }
    if (limit > 0 && exposure > limit) {
      return { ok: false, reason: 'CREDIT_LIMIT', limit, outstanding, overdue, exposure,
        note: `Credit limit ${limit}. Outstanding ${outstanding} + this order = ${exposure}, over the limit.` };
    }
    return { ok: true, limit, outstanding, overdue, exposure,
      note: limit > 0 ? `Within limit (${exposure} of ${limit}).` : 'No credit limit configured.' };
  }

  return { seedDefaults, requiredRole, canApprove, request, decide, pending, isApproved, creditCheck, ROLE_RANK };
};
