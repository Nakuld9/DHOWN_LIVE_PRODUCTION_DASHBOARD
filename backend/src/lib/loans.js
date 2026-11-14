// Debt & Loan management for the CFO module (spec §10).
//
// A facility register (term loans, machinery finance, working-capital loans,
// CC/OD, other borrowings, proposed project finance) plus a verified-terms
// amortization engine that generates principal + interest schedules, a
// debt-service calendar, and scheduled-vs-actual tracking.
//
// NO Busy dependency: lender terms are entered here and schedules are COMPUTED.
// Figures are labelled by source (LENDER_CONFIRMED vs MANUAL_ASSUMPTION) so a
// modelled assumption is never shown as a confirmed term. Actual repayments are
// recorded manually here (or, later, reconciled from the bank feed) and compared
// against the schedule — this module never posts to Busy.
//
// Money is decimal-safe: the amortization runs in integer paise and the final
// installment absorbs rounding residue so the schedule amortizes exactly.

const FACILITY_TYPES = ['TERM_LOAN', 'MACHINERY', 'WORKING_CAPITAL', 'CC_OD', 'OTHER', 'PROJECT'];
const REVOLVING = new Set(['CC_OD', 'WORKING_CAPITAL']);   // no fixed amortization schedule
const FREQ_MONTHS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
// Local YYYY-MM-DD (pg DATE round-trips at local midnight; toISOString would shift in IST).
const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const addMonths = (dateStr, months) => { const d = new Date(dateStr + 'T00:00:00'); d.setMonth(d.getMonth() + months); return ymd(d); };

// ── Amortization engine (pure, exported for tests) ──────────────────────────
// Reducing-balance EMI with optional moratorium and balloon. All money in paise.
// Returns { rows:[{installment_no, due_date, opening_balance, principal_due,
//                   interest_due, total_due, closing_balance, is_balloon}], emi, periods }
function amortize({ principal, annual_rate, tenure_months, frequency = 'MONTHLY',
                    moratorium_months = 0, moratorium_type = 'NONE',
                    balloon_amount = 0, first_due_date }) {
  const mpp = FREQ_MONTHS[frequency] || 1;
  const P0 = Math.round(Number(principal) * 100);               // paise
  const balloon = Math.round(Number(balloon_amount || 0) * 100);
  const periodRate = (Number(annual_rate) / 100) * (mpp / 12);  // rate per period
  const totalPeriods = Math.max(1, Math.round(Number(tenure_months) / mpp));
  const moratoriumPeriods = Math.max(0, Math.round(Number(moratorium_months || 0) / mpp));
  const rows = [];
  let bal = P0;
  // first_due_date may arrive as a 'YYYY-MM-DD' string or a pg Date — normalise to a string.
  let due = ymd(new Date(first_due_date));
  let n = 0;

  // Moratorium leg: interest-only pays interest (principal held); full moratorium
  // capitalises interest into the balance; neither amortises principal.
  for (let i = 0; i < moratoriumPeriods; i++) {
    n++;
    const interest = Math.round(bal * periodRate);
    let principalDue = 0, total, closing = bal;
    if (moratorium_type === 'INTEREST_ONLY') { total = interest; }
    else { total = 0; closing = bal + interest; }   // FULL: capitalise
    rows.push({ installment_no: n, due_date: due, opening_balance: bal / 100,
      principal_due: principalDue / 100, interest_due: interest / 100,
      total_due: total / 100, closing_balance: closing / 100, is_balloon: false });
    bal = closing;
    due = addMonths(due, mpp);
  }

  // Amortising leg: EMI sized so the balance lands exactly on `balloon` at the end.
  const amortPeriods = Math.max(1, totalPeriods - moratoriumPeriods);
  let emi;
  if (periodRate === 0) {
    emi = Math.round((bal - balloon) / amortPeriods);
  } else {
    const g = Math.pow(1 + periodRate, amortPeriods);
    emi = Math.round((bal * g - balloon) * periodRate / (g - 1));
  }

  for (let i = 1; i <= amortPeriods; i++) {
    n++;
    const interest = Math.round(bal * periodRate);
    let principalDue = emi - interest;
    const last = i === amortPeriods;
    if (last) principalDue = bal - balloon;                 // clear to the balloon exactly
    if (principalDue > bal) principalDue = bal;             // never over-amortise
    let closing = bal - principalDue;
    let isBalloon = false;
    let total = principalDue + interest;
    if (last && balloon > 0) { total += balloon; closing -= balloon; isBalloon = true; }
    rows.push({ installment_no: n, due_date: due, opening_balance: bal / 100,
      principal_due: (principalDue + (last ? balloon : 0)) / 100, interest_due: interest / 100,
      total_due: total / 100, closing_balance: (closing < 0 ? 0 : closing) / 100, is_balloon: isBalloon });
    bal = closing;
    due = addMonths(due, mpp);
  }

  const totalInterest = r2(rows.reduce((s, x) => s + x.interest_due, 0));
  const totalPrincipal = r2(rows.reduce((s, x) => s + x.principal_due, 0));
  return { rows, emi: r2(emi / 100), periods: n, total_interest: totalInterest, total_principal: totalPrincipal };
}

module.exports = (pool, { nextSeq } = {}) => {
  async function ensure() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS loan_facilities (
        facility_id       BIGSERIAL PRIMARY KEY,
        loan_code         VARCHAR(30) UNIQUE,
        lender            VARCHAR(160) NOT NULL,
        lender_ref        VARCHAR(120),
        facility_type     VARCHAR(20) NOT NULL DEFAULT 'TERM_LOAN',
        sanctioned_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
        outstanding_amount NUMERIC(16,2),
        disbursed_amount  NUMERIC(16,2),
        interest_rate     NUMERIC(7,4) NOT NULL DEFAULT 0,
        rate_type         VARCHAR(12) NOT NULL DEFAULT 'FIXED',
        repayment_frequency VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
        tenure_months     INT,
        moratorium_months INT NOT NULL DEFAULT 0,
        moratorium_type   VARCHAR(16) NOT NULL DEFAULT 'NONE',
        balloon_amount    NUMERIC(16,2) NOT NULL DEFAULT 0,
        start_date        DATE,
        first_due_date    DATE,
        security          TEXT,
        notes             TEXT,
        status            VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',
        source            VARCHAR(20) NOT NULL DEFAULT 'LENDER_CONFIRMED',
        created_by        VARCHAR(60),
        created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMP,
        CONSTRAINT loan_facility_type_ck CHECK (facility_type IN ('TERM_LOAN','MACHINERY','WORKING_CAPITAL','CC_OD','OTHER','PROJECT')),
        CONSTRAINT loan_rate_type_ck CHECK (rate_type IN ('FIXED','FLOATING')),
        CONSTRAINT loan_status_ck CHECK (status IN ('ACTIVE','CLOSED','PROPOSED')),
        CONSTRAINT loan_source_ck CHECK (source IN ('LENDER_CONFIRMED','MANUAL_ASSUMPTION')),
        CONSTRAINT loan_sanctioned_nonneg CHECK (sanctioned_amount >= 0)
      );
      CREATE TABLE IF NOT EXISTS loan_schedules (
        schedule_id     BIGSERIAL PRIMARY KEY,
        facility_id     BIGINT NOT NULL REFERENCES loan_facilities(facility_id) ON DELETE CASCADE,
        installment_no  INT NOT NULL,
        due_date        DATE NOT NULL,
        opening_balance NUMERIC(16,2) NOT NULL DEFAULT 0,
        principal_due   NUMERIC(16,2) NOT NULL DEFAULT 0,
        interest_due    NUMERIC(16,2) NOT NULL DEFAULT 0,
        total_due       NUMERIC(16,2) NOT NULL DEFAULT 0,
        closing_balance NUMERIC(16,2) NOT NULL DEFAULT 0,
        is_balloon      BOOLEAN NOT NULL DEFAULT FALSE,
        status          VARCHAR(10) NOT NULL DEFAULT 'SCHEDULED',
        paid_amount     NUMERIC(16,2) NOT NULL DEFAULT 0,
        paid_date       DATE,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT loan_sched_status_ck CHECK (status IN ('SCHEDULED','PAID','PARTIAL','OVERDUE')),
        UNIQUE (facility_id, installment_no)
      );
      ALTER TABLE loan_schedules ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
      ALTER TABLE loan_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();
      CREATE INDEX IF NOT EXISTS idx_loan_sched_facility ON loan_schedules(facility_id);
      CREATE INDEX IF NOT EXISTS idx_loan_sched_due ON loan_schedules(due_date);
      CREATE INDEX IF NOT EXISTS idx_loan_facilities_status ON loan_facilities(status) WHERE deleted_at IS NULL;
    `);
  }

  const audit = async (user, action, val) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'LOANS',$3)`,
      [user || null, action, val ? JSON.stringify(val).slice(0, 4000) : null]); } catch {}
  };

  function validate(b) {
    if (!b.lender) return 'lender is required';
    if (!FACILITY_TYPES.includes(b.facility_type || 'TERM_LOAN')) return 'invalid facility_type';
    if (num(b.sanctioned_amount) == null || num(b.sanctioned_amount) < 0) return 'sanctioned_amount must be >= 0';
    const revolving = REVOLVING.has(b.facility_type) && (b.facility_type === 'CC_OD');
    if (!revolving) {
      if (!num(b.tenure_months) || num(b.tenure_months) <= 0) return 'tenure_months is required for an amortising loan';
      if (!b.first_due_date) return 'first_due_date is required for an amortising loan';
      if (num(b.interest_rate) == null) return 'interest_rate is required';
    }
    return null;
  }

  // Build the amortization schedule rows for a facility (empty for revolving CC/OD).
  function buildSchedule(f) {
    if (f.facility_type === 'CC_OD') return { rows: [], emi: 0, total_interest: 0, total_principal: 0, revolving: true };
    const principal = num(f.disbursed_amount) ?? num(f.sanctioned_amount);
    return amortize({
      principal, annual_rate: num(f.interest_rate) || 0, tenure_months: num(f.tenure_months),
      frequency: f.repayment_frequency || 'MONTHLY', moratorium_months: num(f.moratorium_months) || 0,
      moratorium_type: f.moratorium_type || 'NONE', balloon_amount: num(f.balloon_amount) || 0,
      first_due_date: f.first_due_date,
    });
  }

  async function persistSchedule(facilityId, rows) {
    await pool.query(`DELETE FROM loan_schedules WHERE facility_id=$1`, [facilityId]);
    for (const r of rows) {
      await pool.query(`INSERT INTO loan_schedules
        (facility_id, installment_no, due_date, opening_balance, principal_due, interest_due, total_due, closing_balance, is_balloon)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [facilityId, r.installment_no, r.due_date, r.opening_balance, r.principal_due, r.interest_due, r.total_due, r.closing_balance, r.is_balloon]);
    }
  }

  async function create(body, user) {
    const err = validate(body);
    if (err) return { badRequest: err };
    // Compute the schedule from the inputs FIRST, so a bad amortization fails before
    // any row is written. Facility + its schedule are then inserted atomically.
    const sched = buildSchedule(body);
    const outstanding = num(body.outstanding_amount) ?? num(body.disbursed_amount) ?? num(body.sanctioned_amount);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const code = nextSeq ? await nextSeq('LOAN', 'loan_facilities', 'loan_code') : null;
      const f = (await client.query(`INSERT INTO loan_facilities
        (loan_code, lender, lender_ref, facility_type, sanctioned_amount, outstanding_amount, disbursed_amount,
         interest_rate, rate_type, repayment_frequency, tenure_months, moratorium_months, moratorium_type,
         balloon_amount, start_date, first_due_date, security, notes, status, source, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
        [code, body.lender, body.lender_ref || null, body.facility_type || 'TERM_LOAN',
         num(body.sanctioned_amount) || 0, outstanding, num(body.disbursed_amount),
         num(body.interest_rate) || 0, body.rate_type || 'FIXED', body.repayment_frequency || 'MONTHLY',
         num(body.tenure_months), num(body.moratorium_months) || 0, body.moratorium_type || 'NONE',
         num(body.balloon_amount) || 0, body.start_date || null, body.first_due_date || null,
         body.security || null, body.notes || null, body.status || 'ACTIVE', body.source || 'LENDER_CONFIRMED',
         user || null])).rows[0];
      for (const r of sched.rows) {
        await client.query(`INSERT INTO loan_schedules
          (facility_id, installment_no, due_date, opening_balance, principal_due, interest_due, total_due, closing_balance, is_balloon)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [f.facility_id, r.installment_no, r.due_date, r.opening_balance, r.principal_due, r.interest_due, r.total_due, r.closing_balance, r.is_balloon]);
      }
      await client.query('COMMIT');
      await audit(user, `loan created ${code} ${body.lender}`, { facility_id: f.facility_id, sanctioned: body.sanctioned_amount });
      return { row: f, schedule: sched };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async function list() {
    const rows = (await pool.query(`
      SELECT f.*,
        (SELECT MIN(due_date) FROM loan_schedules s WHERE s.facility_id=f.facility_id AND s.status<>'PAID') AS next_due_date,
        (SELECT COALESCE(SUM(total_due),0) FROM loan_schedules s WHERE s.facility_id=f.facility_id AND s.status<>'PAID') AS remaining_due
        FROM loan_facilities f WHERE f.deleted_at IS NULL ORDER BY f.status, f.created_at DESC`)).rows;
    return rows;
  }

  async function get(id) {
    const f = (await pool.query(`SELECT * FROM loan_facilities WHERE facility_id=$1 AND deleted_at IS NULL`, [id])).rows[0];
    if (!f) return { notFound: true };
    const schedule = (await pool.query(`SELECT * FROM loan_schedules WHERE facility_id=$1 ORDER BY installment_no`, [id])).rows;
    const paid = schedule.filter(s => s.status === 'PAID').reduce((a, s) => a + Number(s.paid_amount), 0);
    const totalInterest = r2(schedule.reduce((a, s) => a + Number(s.interest_due), 0));
    return { row: f, schedule, totals: { installments: schedule.length, total_interest: totalInterest, total_paid: r2(paid) } };
  }

  async function update(id, body, user) {
    const existing = (await pool.query(`SELECT * FROM loan_facilities WHERE facility_id=$1 AND deleted_at IS NULL`, [id])).rows[0];
    if (!existing) return { notFound: true };
    const merged = { ...existing, ...body };
    const err = validate(merged);
    if (err) return { badRequest: err };
    const f = (await pool.query(`UPDATE loan_facilities SET
      lender=$2, lender_ref=$3, facility_type=$4, sanctioned_amount=$5, outstanding_amount=$6, disbursed_amount=$7,
      interest_rate=$8, rate_type=$9, repayment_frequency=$10, tenure_months=$11, moratorium_months=$12,
      moratorium_type=$13, balloon_amount=$14, start_date=$15, first_due_date=$16, security=$17, notes=$18,
      status=$19, source=$20, updated_at=NOW() WHERE facility_id=$1 RETURNING *`,
      [id, merged.lender, merged.lender_ref || null, merged.facility_type, num(merged.sanctioned_amount) || 0,
       num(merged.outstanding_amount), num(merged.disbursed_amount), num(merged.interest_rate) || 0, merged.rate_type || 'FIXED',
       merged.repayment_frequency || 'MONTHLY', num(merged.tenure_months), num(merged.moratorium_months) || 0,
       merged.moratorium_type || 'NONE', num(merged.balloon_amount) || 0, merged.start_date || null,
       merged.first_due_date || null, merged.security || null, merged.notes || null, merged.status || 'ACTIVE',
       merged.source || 'LENDER_CONFIRMED'])).rows[0];
    // Regenerate the schedule from the new terms, preserving already-recorded payments by installment_no.
    const paidBefore = (await pool.query(`SELECT installment_no, status, paid_amount, paid_date FROM loan_schedules WHERE facility_id=$1 AND status<>'SCHEDULED'`, [id])).rows;
    const sched = buildSchedule(f);
    await persistSchedule(id, sched.rows);
    for (const p of paidBefore) {
      await pool.query(`UPDATE loan_schedules SET status=$2, paid_amount=$3, paid_date=$4 WHERE facility_id=$1 AND installment_no=$5`,
        [id, p.status, p.paid_amount, p.paid_date, p.installment_no]).catch(() => {});
    }
    await audit(user, `loan updated ${f.loan_code}`, { facility_id: id });
    return { row: f, schedule: sched };
  }

  async function remove(id, user) {
    const r = await pool.query(`UPDATE loan_facilities SET deleted_at=NOW(), status='CLOSED' WHERE facility_id=$1 AND deleted_at IS NULL RETURNING loan_code`, [id]);
    if (!r.rows[0]) return { notFound: true };
    await audit(user, `loan deleted ${r.rows[0].loan_code}`, { facility_id: id });
    return { ok: true };
  }

  // Record an actual repayment against one installment (manual; or later from bank feed).
  async function recordPayment(id, body, user) {
    const s = (await pool.query(`SELECT * FROM loan_schedules WHERE facility_id=$1 AND installment_no=$2`, [id, body.installment_no])).rows[0];
    if (!s) return { notFound: true };
    const amount = num(body.amount);
    if (amount == null || amount <= 0) return { badRequest: 'amount must be > 0' };
    const paid = r2(Number(s.paid_amount) + amount);
    const status = paid + 0.01 >= Number(s.total_due) ? 'PAID' : 'PARTIAL';
    const row = (await pool.query(`UPDATE loan_schedules SET paid_amount=$3, paid_date=$4, status=$5 WHERE facility_id=$1 AND installment_no=$2 RETURNING *`,
      [id, body.installment_no, paid, body.paid_date || ymd(new Date()), status])).rows[0];
    await audit(user, `loan payment ${id}/#${body.installment_no} ${amount}`, { facility_id: id, installment: body.installment_no, amount });
    return { row };
  }

  // Debt-service calendar: upcoming obligations across active facilities in a window.
  async function calendar({ from, to } = {}) {
    const f = from || ymd(new Date());
    const t = to || addMonths(f, 12);
    const rows = (await pool.query(`
      SELECT s.facility_id, f.loan_code, f.lender, f.facility_type, s.installment_no, s.due_date,
             s.principal_due, s.interest_due, s.total_due, s.status, s.paid_amount, s.is_balloon
        FROM loan_schedules s JOIN loan_facilities f ON f.facility_id=s.facility_id
       WHERE f.deleted_at IS NULL AND f.status='ACTIVE' AND s.due_date BETWEEN $1 AND $2
       ORDER BY s.due_date, f.loan_code`, [f, t])).rows;
    const total = rows.reduce((a, r) => ({ principal: a.principal + Number(r.principal_due), interest: a.interest + Number(r.interest_due), total: a.total + Number(r.total_due) }), { principal: 0, interest: 0, total: 0 });
    return { from: f, to: t, installments: rows, totals: { principal: r2(total.principal), interest: r2(total.interest), total: r2(total.total) } };
  }

  // Portfolio summary: outstanding, next 30/90-day service, total remaining interest, maturity profile.
  async function summary() {
    const facilities = (await pool.query(`SELECT facility_type, status, COUNT(*) n,
        COALESCE(SUM(sanctioned_amount),0) sanctioned, COALESCE(SUM(outstanding_amount),0) outstanding
        FROM loan_facilities WHERE deleted_at IS NULL GROUP BY facility_type, status`)).rows;
    const activeOutstanding = r2(facilities.filter(f => f.status === 'ACTIVE').reduce((a, f) => a + Number(f.outstanding), 0));
    const sanctioned = r2(facilities.reduce((a, f) => a + Number(f.sanctioned), 0));
    const next30 = await calendar({ from: ymd(new Date()), to: addMonths(ymd(new Date()), 1) });
    const next90 = await calendar({ from: ymd(new Date()), to: addMonths(ymd(new Date()), 3) });
    const remainingInterest = r2((await pool.query(`SELECT COALESCE(SUM(interest_due),0) i
        FROM loan_schedules s JOIN loan_facilities f ON f.facility_id=s.facility_id
       WHERE f.deleted_at IS NULL AND f.status='ACTIVE' AND s.status<>'PAID'`)).rows[0].i);
    const overdue = r2((await pool.query(`SELECT COALESCE(SUM(total_due - paid_amount),0) d
        FROM loan_schedules s JOIN loan_facilities f ON f.facility_id=s.facility_id
       WHERE f.deleted_at IS NULL AND f.status='ACTIVE' AND s.status<>'PAID' AND s.due_date < CURRENT_DATE`)).rows[0].d);
    return {
      total_sanctioned: sanctioned, total_outstanding: activeOutstanding, remaining_interest: remainingInterest,
      overdue_amount: overdue, by_type: facilities,
      service_next_30d: next30.totals.total, service_next_90d: next90.totals.total,
      note: 'Outstanding is as entered/last updated per facility; schedules are computed from the stored terms. Nothing is read from Busy.',
    };
  }

  return { ensure, create, list, get, update, remove, recordPayment, calendar, summary, _amortize: amortize, FACILITY_TYPES };
};
