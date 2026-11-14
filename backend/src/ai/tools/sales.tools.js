// Sales tools — customer follow-ups. A read tool for what is pending, and a WRITE
// tool to draft a follow-up reminder behind the approvals queue. Follow-ups live in
// crm_followups (shared with the WhatsApp CRM's auto-follow-ups); an AI-drafted one
// is kind='MANUAL' so it is distinguishable from the auto-generated ones.

module.exports = function registerSalesTools(registry, { pool }) {
  // What follow-ups are still open (PENDING), most overdue first.
  registry.register({
    name: 'get_open_followups',
    description: 'Open customer follow-ups (still pending): who, the note, due date and days overdue. No arguments.',
    minRole: 'OPERATOR',
    handler: async () => {
      const rows = (await pool.query(
        `SELECT f.followup_id, f.note, f.kind, f.assigned_to,
                to_char(f.due_date, 'DD-MM-YYYY') AS due_fmt,
                f.due_date IS NOT NULL AS has_due,
                COALESCE(p.company_name, p.short_name) AS customer,
                (CURRENT_DATE - f.due_date) AS days_due
           FROM crm_followups f
           LEFT JOIN partners p ON p.partner_id = f.partner_id
          WHERE COALESCE(f.status,'') = 'PENDING'
          ORDER BY f.due_date ASC NULLS LAST LIMIT 50`)).rows;
      const overdue = rows.filter(r => r.has_due && Number(r.days_due) > 0).length;
      return {
        count: rows.length, overdue,
        followups: rows.map(r => ({
          id: Number(r.followup_id), customer: r.customer || '(no customer)',
          note: r.note, kind: r.kind, due: r.due_fmt,
          days_overdue: r.has_due && Number(r.days_due) > 0 ? Number(r.days_due) : 0,
          assigned_to: r.assigned_to || null,
        })),
        note: rows.length === 0 ? 'No open follow-ups.' : undefined,
      };
    },
  });

  // Parse a due date that a model is likely to emit: an ISO date, or a relative
  // phrase (today, tomorrow, "next week", "in N days"). Returns {date} on success,
  // {error} on an unrecognised value, or {date:null} when none was given. The date
  // format is DD-MM-YYYY (Indian convention); relative phrases are also understood.
  // Always returns an ISO date internally so the DATE column stores it correctly.
  const parseDue = (raw) => {
    if (raw == null || String(raw).trim() === '') return { date: null };
    const s = String(raw).trim().toLowerCase();
    // DD-MM-YYYY (also tolerant of / or . separators)
    let m = s.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      const dt = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
      if (isNaN(dt.getTime()) || dt.getUTCDate() !== +dd || dt.getUTCMonth() + 1 !== +mm)
        return { error: `"${raw}" is not a valid DD-MM-YYYY date` };
      return { date: `${yyyy}-${mm}-${dd}` };
    }
    // Still accept ISO YYYY-MM-DD (what the DB speaks) so nothing regresses.
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s };
    const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return { date: d.toISOString().slice(0, 10) }; };
    if (s === 'today') return addDays(0);
    if (s === 'tomorrow') return addDays(1);
    if (/^next week$/.test(s)) return addDays(7);
    if (/^next month$/.test(s)) return addDays(30);
    m = s.match(/^in\s+(\d{1,3})\s+days?$/);
    if (m) return addDays(parseInt(m[1], 10));
    return { error: `could not understand due date "${raw}" — use DD-MM-YYYY, "today", "tomorrow", "next week", or "in N days"` };
  };

  // Render an ISO date (YYYY-MM-DD) back as DD-MM-YYYY for anything user-facing.
  const fmtDue = (val) => {
    if (!val) return null;
    const iso = (val instanceof Date) ? val.toISOString().slice(0, 10) : String(val).slice(0, 10);
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
  };

  // ── WRITE tool — draft a customer follow-up reminder, behind approvals ────────
  // Proposes only; a SUPERVISOR approval creates the follow-up (kind='MANUAL',
  // status defaults to PENDING). An optional customer name is resolved to a partner.
  registry.register({
    name: 'create_followup',
    description: 'Draft a customer follow-up reminder. Proposes for approval; a SUPERVISOR must approve before it is created. Args: {note, customer_name?, due_date? (DD-MM-YYYY or "today"/"tomorrow"/"next week"/"in N days", default today), assigned_to?}',
    safe: false,
    minRole: 'OPERATOR',
    approveRole: 'SUPERVISOR',
    propose: async ({ note, customer_name, due_date, assigned_to } = {}) => {
      const n = String(note || '').trim();
      if (!n) return { error: 'note is required' };
      let partner = null;
      const cust = customer_name ? String(customer_name).trim() : '';
      if (cust) {
        partner = (await pool.query(
          `SELECT partner_id, COALESCE(company_name, short_name) AS name FROM partners
            WHERE UPPER(company_name)=UPPER($1) OR UPPER(short_name)=UPPER($1)
               OR UPPER(partner_code)=UPPER($1) LIMIT 1`, [cust])).rows[0] || null;
        if (!partner) return { error: `unknown customer: ${cust}` };
      }
      const parsed = parseDue(due_date);
      if (parsed.error) return { error: parsed.error };
      const due = parsed.date;
      return {
        summary: `Follow-up${partner ? ` with ${partner.name}` : ''}: ${n}${due ? ` (due ${fmtDue(due)})` : ''}`,
        payload: { note: n, partner_id: partner?.partner_id || null, due_date: due, assigned_to: assigned_to || null },
      };
    },
    execute: async ({ note, partner_id, due_date, assigned_to }, { user } = {}) => {
      const row = (await pool.query(
        `INSERT INTO crm_followups
           (partner_id, note, due_date, assigned_to, created_by, kind, status)
         VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,'MANUAL','PENDING')
         RETURNING followup_id`,
        [partner_id, note, due_date, assigned_to, user?.username || 'ai-approval'])).rows[0];
      return { ok: true, followup_id: Number(row.followup_id), status: 'PENDING' };
    },
  });
};
