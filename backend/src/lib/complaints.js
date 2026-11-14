// Customer complaints.
//
// The one business process the mill runs entirely outside the system. A
// customer rings about barre in a lot, or a short delivery, and it lived in
// someone's head or a WhatsApp thread. Nothing recorded it, nothing chased it,
// and nobody could answer "how often does this happen with this shade" — which
// is the question that actually improves the cloth.
//
// Two things this deliberately does:
//
//   - It accepts an incomplete complaint. A customer rarely knows the dispatch
//     number when they call. Refusing to record one until every link is known
//     is exactly how complaints go unrecorded, which is the problem.
//   - It keeps an event trail. A complaint marked resolved with no record of by
//     whom or how is not resolved, it is closed. Every status change, note and
//     link is appended, and the trail cannot be edited.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clean = (s) => (s == null ? null : String(s).trim() || null);
const up = (s) => (clean(s) ? String(s).trim().toUpperCase() : null);

const CATEGORIES = ['QUALITY', 'SHORTAGE', 'WRONG_ITEM', 'DAMAGE', 'DELAY', 'BILLING', 'OTHER'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const SOURCES = ['WHATSAPP', 'PHONE', 'EMAIL', 'VISIT', 'OTHER'];
const RESOLUTIONS = ['REPLACE', 'CREDIT_NOTE', 'DISCOUNT', 'REWORK', 'NO_ACTION'];

// The state machine, written down so it cannot be argued with.
//   OPEN → INVESTIGATING → RESOLVED → CLOSED
//   anything open can be REJECTED; a RESOLVED or REJECTED one can be reopened.
const TRANSITIONS = {
  OPEN:          ['INVESTIGATING', 'RESOLVED', 'REJECTED'],
  INVESTIGATING: ['RESOLVED', 'REJECTED', 'OPEN'],
  RESOLVED:      ['CLOSED', 'OPEN'],
  REJECTED:      ['OPEN'],
  CLOSED:        [],          // a closed complaint stays closed; raise a new one
};

// How long before it should have been dealt with. Severity drives it because a
// critical quality problem on a running order cannot wait a week.
const SLA_DAYS = { CRITICAL: 1, HIGH: 3, MEDIUM: 7, LOW: 14 };

module.exports = (pool) => {

  async function nextNo(db) {
    const yr = new Date().getFullYear();
    const r = await db.query(
      `SELECT complaint_no FROM complaints WHERE complaint_no LIKE $1
        ORDER BY complaint_no DESC LIMIT 1`, [`CMP-${yr}-%`]);
    if (!r.rows.length) return `CMP-${yr}-001`;
    const n = parseInt(String(r.rows[0].complaint_no).split('-').pop(), 10) + 1;
    return `CMP-${yr}-${String(n).padStart(3, '0')}`;
  }

  async function create(body, { by } = {}) {
    const summary = clean(body.summary);
    if (!summary) return { error: 'A short summary is required', code: 400 };
    if (!body.partner_id) return { error: 'A customer is required', code: 400 };

    const category = up(body.category) || 'OTHER';
    if (!CATEGORIES.includes(category)) {
      return { error: `Category must be one of ${CATEGORIES.join(', ')}`, code: 400 };
    }
    const severity = up(body.severity) || 'MEDIUM';
    if (!SEVERITIES.includes(severity)) {
      return { error: `Severity must be one of ${SEVERITIES.join(', ')}`, code: 400 };
    }
    const source = up(body.source) || 'OTHER';
    if (!SOURCES.includes(source)) {
      return { error: `Source must be one of ${SOURCES.join(', ')}`, code: 400 };
    }

    const partner = await pool.query(`SELECT 1 FROM partners WHERE partner_id=$1`, [body.partner_id]);
    if (!partner.rows.length) return { error: 'Customer not found', code: 404 };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const no = await nextNo(client);
      const r = await client.query(
        `INSERT INTO complaints
           (complaint_no, partner_id, raised_on, source, category, severity, summary, detail,
            invoice_id, dispatch_id, roll_id, lot_number, machine_id,
            assigned_to, due_date, created_by)
         VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                 COALESCE($15, CURRENT_DATE + $16::int), $17)
         RETURNING *`,
        [no, body.partner_id, body.raised_on || null, source, category, severity, summary,
         clean(body.detail), body.invoice_id || null, body.dispatch_id || null,
         clean(body.roll_id), clean(body.lot_number), clean(body.machine_id),
         clean(body.assigned_to), body.due_date || null, SLA_DAYS[severity], by || null]);

      await client.query(
        `INSERT INTO complaint_events (complaint_id, kind, note, to_status, created_by)
         VALUES ($1,'STATUS','Complaint logged','OPEN',$2)`, [r.rows[0].complaint_id, by || null]);

      await client.query('COMMIT');
      return { ok: true, complaint: r.rows[0] };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async function get(id) {
    const c = (await pool.query(
      `SELECT c.*, p.company_name,
              ti.invoice_number, d.dispatch_number,
              (c.status IN ('OPEN','INVESTIGATING') AND c.due_date < CURRENT_DATE) AS overdue
         FROM complaints c
         LEFT JOIN partners p ON p.partner_id = c.partner_id
         LEFT JOIN tax_invoices ti ON ti.invoice_id = c.invoice_id
         LEFT JOIN dispatch_challans d ON d.dispatch_id = c.dispatch_id
        WHERE c.complaint_id = $1`, [id])).rows[0];
    if (!c) return { error: 'Complaint not found', code: 404 };

    const events = (await pool.query(
      `SELECT * FROM complaint_events WHERE complaint_id=$1 ORDER BY created_at, event_id`, [id])).rows;
    return { ...c, events, allowed_transitions: TRANSITIONS[c.status] || [] };
  }

  async function list({ status = null, partner_id = null, category = null,
                        overdue = false, limit = 200 } = {}) {
    const r = await pool.query(
      `SELECT c.complaint_id, c.complaint_no, c.raised_on, c.partner_id, p.company_name,
              c.category, c.severity, c.status, c.summary, c.assigned_to, c.due_date,
              c.resolution_type, c.resolved_at,
              (c.status IN ('OPEN','INVESTIGATING') AND c.due_date < CURRENT_DATE) AS overdue
         FROM complaints c
         LEFT JOIN partners p ON p.partner_id = c.partner_id
        WHERE ($1::text IS NULL OR c.status = $1)
          AND ($2::int  IS NULL OR c.partner_id = $2)
          AND ($3::text IS NULL OR c.category = $3)
          AND ($4::bool IS NOT TRUE
               OR (c.status IN ('OPEN','INVESTIGATING') AND c.due_date < CURRENT_DATE))
        ORDER BY
          -- Open and overdue first: this list is a worklist, not an archive.
          (c.status IN ('OPEN','INVESTIGATING')) DESC,
          (c.due_date < CURRENT_DATE) DESC,
          CASE c.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
          c.raised_on DESC
        LIMIT $5`,
      [up(status), partner_id || null, up(category), !!overdue, Math.min(limit, 500)]);
    return r.rows;
  }

  // Move a complaint along. The transition table is the authority; an arbitrary
  // status update would let a closed complaint quietly become open again with
  // no trail.
  async function transition(id, to, { by, note, resolution_type, root_cause, resolution } = {}) {
    const target = up(to);
    const cur = (await pool.query(`SELECT * FROM complaints WHERE complaint_id=$1`, [id])).rows[0];
    if (!cur) return { error: 'Complaint not found', code: 404 };

    const allowed = TRANSITIONS[cur.status] || [];
    if (!allowed.includes(target)) {
      const word = cur.status.toLowerCase();
      return {
        error: allowed.length
          ? `${/^[aeiou]/.test(word) ? 'An' : 'A'} ${word} complaint can only move to ${allowed.join(', ')}`
          : `A closed complaint cannot be changed. Raise a new complaint instead.`,
        code: 409,
      };
    }

    // Resolving without saying how is how a complaint gets closed rather than
    // resolved, and the pattern is then invisible to anyone looking for it.
    if (target === 'RESOLVED') {
      const rt = up(resolution_type);
      if (!rt || !RESOLUTIONS.includes(rt)) {
        return { error: `Resolving needs a resolution type: ${RESOLUTIONS.join(', ')}`, code: 400 };
      }
      if (!clean(resolution)) {
        return { error: 'Resolving needs a note saying what was done', code: 400 };
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // $2 is cast explicitly everywhere it appears: used bare as both the
      // assigned value and a CASE comparand, Postgres deduces two different
      // types for the same parameter and refuses the statement outright.
      const r = await client.query(
        `UPDATE complaints
            SET status = $2::text,
                root_cause      = COALESCE($3, root_cause),
                resolution      = COALESCE($4, resolution),
                resolution_type = COALESCE($5, resolution_type),
                resolved_by = CASE WHEN $2::text = 'RESOLVED' THEN $6 ELSE resolved_by END,
                resolved_at = CASE WHEN $2::text = 'RESOLVED' THEN NOW() ELSE resolved_at END,
                closed_at   = CASE WHEN $2::text = 'CLOSED'   THEN NOW() ELSE closed_at END,
                updated_at  = NOW()
          WHERE complaint_id = $1 RETURNING *`,
        [id, target, clean(root_cause), clean(resolution), up(resolution_type), by || null]);

      await client.query(
        `INSERT INTO complaint_events (complaint_id, kind, note, from_status, to_status, created_by)
         VALUES ($1,'STATUS',$2,$3,$4,$5)`,
        [id, clean(note) || clean(resolution), cur.status, target, by || null]);

      await client.query('COMMIT');
      return { ok: true, complaint: r.rows[0] };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async function addNote(id, { note, by } = {}) {
    if (!clean(note)) return { error: 'A note is required', code: 400 };
    const c = await pool.query(`SELECT 1 FROM complaints WHERE complaint_id=$1`, [id]);
    if (!c.rows.length) return { error: 'Complaint not found', code: 404 };
    const r = await pool.query(
      `INSERT INTO complaint_events (complaint_id, kind, note, created_by)
       VALUES ($1,'NOTE',$2,$3) RETURNING *`, [id, clean(note), by || null]);
    return { ok: true, event: r.rows[0] };
  }

  async function assign(id, to, { by } = {}) {
    const c = (await pool.query(`SELECT assigned_to FROM complaints WHERE complaint_id=$1`, [id])).rows[0];
    if (!c) return { error: 'Complaint not found', code: 404 };
    const target = clean(to);
    await pool.query(
      `UPDATE complaints SET assigned_to=$2, updated_at=NOW() WHERE complaint_id=$1`, [id, target]);
    await pool.query(
      `INSERT INTO complaint_events (complaint_id, kind, note, created_by)
       VALUES ($1,'ASSIGN',$2,$3)`,
      [id, target ? `Assigned to ${target}` : 'Unassigned', by || null]);
    return { ok: true, assigned_to: target };
  }

  // What the pattern is. The reason for recording complaints at all: one
  // complaint is an incident, twenty about the same shade is a process problem.
  async function stats({ from = null, to = null } = {}) {
    const p = [from, to];
    const totals = (await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status IN ('OPEN','INVESTIGATING'))::int AS open,
              COUNT(*) FILTER (WHERE status IN ('OPEN','INVESTIGATING')
                               AND due_date < CURRENT_DATE)::int AS overdue,
              COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
              COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed,
              COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
              ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/86400.0)
                    FILTER (WHERE resolved_at IS NOT NULL), 1) AS avg_days_to_resolve
         FROM complaints
        WHERE ($1::date IS NULL OR raised_on >= $1::date)
          AND ($2::date IS NULL OR raised_on <= $2::date)`, p)).rows[0];

    const byCategory = (await pool.query(
      `SELECT COALESCE(category,'OTHER') AS category, COUNT(*)::int AS n
         FROM complaints
        WHERE ($1::date IS NULL OR raised_on >= $1::date)
          AND ($2::date IS NULL OR raised_on <= $2::date)
        GROUP BY 1 ORDER BY n DESC`, p)).rows;

    const topCustomers = (await pool.query(
      `SELECT c.partner_id, p.company_name, COUNT(*)::int AS n
         FROM complaints c LEFT JOIN partners p ON p.partner_id = c.partner_id
        WHERE ($1::date IS NULL OR c.raised_on >= $1::date)
          AND ($2::date IS NULL OR c.raised_on <= $2::date)
        GROUP BY 1,2 ORDER BY n DESC LIMIT 10`, p)).rows;

    return {
      period: { from, to },
      totals: {
        ...totals,
        avg_days_to_resolve: totals.avg_days_to_resolve === null ? null : Number(totals.avg_days_to_resolve),
      },
      by_category: byCategory,
      top_customers: topCustomers,
    };
  }

  return {
    create, get, list, transition, addNote, assign, stats,
    CATEGORIES, SEVERITIES, SOURCES, RESOLUTIONS, TRANSITIONS, SLA_DAYS,
  };
};
