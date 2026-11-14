// Shade approvals — the sample-approval loop between Shade Cards and Sales.
// A shade sample is sent to a customer, who approves or rejects it; an approved
// shade can be tied to a sales order. Closes the gap between the colour master
// and the order it unblocks. Self-healing schema.
module.exports = (pool) => {
  const { nextSeq } = require('./sequences');

  async function ensure() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shade_approvals (
        approval_id      SERIAL PRIMARY KEY,
        approval_number  VARCHAR(40) UNIQUE,
        partner_id       INTEGER,
        customer_name    VARCHAR(200),
        shade_name       VARCHAR(200) NOT NULL,
        shade_code       VARCHAR(80),
        hex              VARCHAR(9),
        fabric_type      VARCHAR(120),
        so_id            INTEGER,
        so_number        VARCHAR(60),
        sample_ref       VARCHAR(120),
        status           VARCHAR(20) NOT NULL DEFAULT 'SENT',
        sent_date        DATE NOT NULL DEFAULT CURRENT_DATE,
        decided_date     DATE,
        decided_by       VARCHAR(120),
        notes            TEXT,
        created_by       VARCHAR(80),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  }

  const STATUSES = ['SENT', 'RESENT', 'APPROVED', 'REJECTED', 'CANCELLED'];

  async function list({ status, partner_id, limit = 300 } = {}) {
    const where = []; const params = [];
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    if (partner_id) { params.push(partner_id); where.push(`partner_id = $${params.length}`); }
    params.push(Math.min(Number(limit) || 300, 1000));
    const r = await pool.query(
      `SELECT * FROM shade_approvals
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY (status IN ('SENT','RESENT')) DESC, sent_date DESC, approval_id DESC
       LIMIT $${params.length}`, params);
    return r.rows;
  }

  async function summary() {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('SENT','RESENT'))::int AS pending,
        COUNT(*) FILTER (WHERE status = 'APPROVED')::int        AS approved,
        COUNT(*) FILTER (WHERE status = 'REJECTED')::int        AS rejected,
        COUNT(*) FILTER (WHERE status IN ('SENT','RESENT') AND sent_date < CURRENT_DATE - 7)::int AS stale
      FROM shade_approvals`);
    return r.rows[0];
  }

  async function create(body, user) {
    if (!body || !body.shade_name) throw new Error('shade_name is required');
    const num = await nextSeq('SHA', 'shade_approvals', 'approval_number');
    const r = await pool.query(
      `INSERT INTO shade_approvals
         (approval_number, partner_id, customer_name, shade_name, shade_code, hex, fabric_type,
          so_id, so_number, sample_ref, status, sent_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'SENT',COALESCE($11,CURRENT_DATE),$12,$13)
       RETURNING *`,
      [num, body.partner_id || null, body.customer_name || null, body.shade_name,
       body.shade_code || null, body.hex || null, body.fabric_type || null,
       body.so_id || null, body.so_number || null, body.sample_ref || null,
       body.sent_date || null, body.notes || null, user?.username || null]);
    return r.rows[0];
  }

  // Record the customer's decision (or resend / cancel).
  async function decide(id, { status, decided_by, notes, so_id, so_number }, user) {
    const s = String(status || '').toUpperCase();
    if (!STATUSES.includes(s)) throw new Error('Invalid status');
    const decided = (s === 'APPROVED' || s === 'REJECTED');
    const r = await pool.query(
      `UPDATE shade_approvals
          SET status = $2,
              decided_date = ${decided ? 'CURRENT_DATE' : 'NULL'},
              decided_by = COALESCE($3, decided_by),
              so_id = COALESCE($5, so_id),
              so_number = COALESCE($6, so_number),
              notes = COALESCE($4, notes),
              updated_at = now()
        WHERE approval_id = $1
        RETURNING *`,
      [id, s, decided_by || null, notes || null, so_id || null, so_number || null]);
    if (!r.rows[0]) throw new Error('Shade approval not found');
    return r.rows[0];
  }

  return { ensure, list, summary, create, decide, STATUSES };
};
