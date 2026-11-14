// Budgeting & scenario planning for the CFO module (spec §11).
//
// Management defines monthly budgets per financial year for a set of line items,
// across three scenarios (BASE / UPSIDE / DOWNSIDE). Versions are preserved so a
// forecast's history is never lost. Budget-vs-actual compares the budget to what
// the MES can actually source — REVENUE (tax invoices), RECEIVABLE_COLLECTION
// (receipts) and DEBT_REPAYMENT (loan schedules). Line items that depend on Busy
// (margin, opex, EBITDA, working capital) are shown as "actual not in MES" rather
// than faked. Nothing is read from or written to Busy.
//
// FY month index: period 1 = Apr … 12 = Mar (Indian FY). fy is stored as 'YY-YY'
// (e.g. '26-27'); period_month maps to a calendar (year, month) for actuals.

const SCENARIOS = ['BASE', 'UPSIDE', 'DOWNSIDE'];
const LINE_ITEMS = [
  { key: 'REVENUE', label: 'Revenue', unit: 'INR', actual: 'invoices' },
  { key: 'SALES_VOLUME_KG', label: 'Sales volume (kg)', unit: 'KG', actual: null },
  { key: 'GROSS_MARGIN_PCT', label: 'Gross margin %', unit: 'PCT', actual: null },
  { key: 'OPEX', label: 'Operating expenses', unit: 'INR', actual: null },
  { key: 'EBITDA', label: 'EBITDA', unit: 'INR', actual: null },
  { key: 'CAPEX', label: 'Capital expenditure', unit: 'INR', actual: null },
  { key: 'RECEIVABLE_COLLECTION', label: 'Receivable collection', unit: 'INR', actual: 'receipts' },
  { key: 'INVENTORY', label: 'Inventory', unit: 'INR', actual: null },
  { key: 'WORKING_CAPITAL', label: 'Working capital', unit: 'INR', actual: null },
  { key: 'DEBT_REPAYMENT', label: 'Debt repayment', unit: 'INR', actual: 'loans' },
];
const ITEM_KEYS = new Set(LINE_ITEMS.map(l => l.key));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));

// fy '26-27' + period 1..12 (Apr..Mar) -> {year, month}
function periodToCalendar(fy, period) {
  const startYear = 2000 + parseInt(String(fy).slice(0, 2), 10);
  if (period <= 9) return { year: startYear, month: period + 3 };   // Apr(4)..Dec(12)
  return { year: startYear + 1, month: period - 9 };                 // Jan(1)..Mar(3)
}

module.exports = (pool) => {
  async function ensure() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS budget_versions (
        version_id  BIGSERIAL PRIMARY KEY,
        fy          VARCHAR(7) NOT NULL,
        name        VARCHAR(120) NOT NULL,
        status      VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
        notes       TEXT,
        created_by  VARCHAR(60),
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT budget_version_status_ck CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED'))
      );
      CREATE TABLE IF NOT EXISTS budget_lines (
        line_id     BIGSERIAL PRIMARY KEY,
        version_id  BIGINT NOT NULL REFERENCES budget_versions(version_id) ON DELETE CASCADE,
        scenario    VARCHAR(10) NOT NULL DEFAULT 'BASE',
        line_item   VARCHAR(30) NOT NULL,
        period_month INT NOT NULL,
        amount      NUMERIC(16,2) NOT NULL DEFAULT 0,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT budget_scenario_ck CHECK (scenario IN ('BASE','UPSIDE','DOWNSIDE')),
        CONSTRAINT budget_period_ck CHECK (period_month BETWEEN 1 AND 12),
        UNIQUE (version_id, scenario, line_item, period_month)
      );
      CREATE TABLE IF NOT EXISTS budget_assumptions (
        assumption_id BIGSERIAL PRIMARY KEY,
        version_id  BIGINT NOT NULL REFERENCES budget_versions(version_id) ON DELETE CASCADE,
        scenario    VARCHAR(10) NOT NULL DEFAULT 'BASE',
        akey        VARCHAR(60) NOT NULL,
        aval        NUMERIC(14,4),
        note        TEXT,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT budget_assum_scenario_ck CHECK (scenario IN ('BASE','UPSIDE','DOWNSIDE')),
        UNIQUE (version_id, scenario, akey)
      );
      CREATE INDEX IF NOT EXISTS idx_budget_lines_version ON budget_lines(version_id);
      -- The assumption value is legitimately SIGNED (e.g. a -10% downside delta). An
      -- earlier column name 'avalue' matched the auto non-negative-money heuristic and
      -- got a >= 0 CHECK; rename to 'aval' (no 'value' substring) and drop that check.
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budget_assumptions' AND column_name='avalue') THEN
          ALTER TABLE budget_assumptions RENAME COLUMN avalue TO aval;
        END IF;
      END $$;
      ALTER TABLE budget_assumptions DROP CONSTRAINT IF EXISTS ck_budget_assumptions__avalue_nonneg;
      -- A budget amount is legitimately SIGNED (a budgeted EBITDA or gross margin can
      -- be negative). The boot's non-negative-money heuristic adds amount >= 0; drop it.
      ALTER TABLE budget_lines DROP CONSTRAINT IF EXISTS ck_budget_lines__amount_nonneg;
    `);
  }

  const audit = async (user, action, val) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'BUDGET',$3)`,
      [user || null, action, val ? JSON.stringify(val).slice(0, 4000) : null]); } catch {}
  };

  async function createVersion(body, user) {
    if (!body.fy || !/^\d{2}-\d{2}$/.test(body.fy)) return { badRequest: "fy is required as 'YY-YY' (e.g. 26-27)" };
    if (!body.name) return { badRequest: 'name is required' };
    const v = (await pool.query(`INSERT INTO budget_versions (fy, name, status, notes, created_by)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.fy, body.name, body.status || 'DRAFT', body.notes || null, user || null])).rows[0];
    await audit(user, `budget version created ${v.version_id} ${body.fy} ${body.name}`, { version_id: v.version_id });
    return { row: v };
  }

  async function listVersions() {
    return (await pool.query(`SELECT v.*,
      (SELECT COUNT(*) FROM budget_lines l WHERE l.version_id=v.version_id) AS line_count
      FROM budget_versions v ORDER BY v.fy DESC, v.created_at DESC`)).rows;
  }

  // Pivoted view: { version, scenarios:{BASE:{line_item:{period:amount,...}, ...}}, totals, assumptions, meta }
  async function getVersion(id) {
    const v = (await pool.query(`SELECT * FROM budget_versions WHERE version_id=$1`, [id])).rows[0];
    if (!v) return { notFound: true };
    const lines = (await pool.query(`SELECT scenario, line_item, period_month, amount FROM budget_lines WHERE version_id=$1`, [id])).rows;
    const assumptions = (await pool.query(`SELECT scenario, akey, aval AS avalue, note FROM budget_assumptions WHERE version_id=$1 ORDER BY scenario, akey`, [id])).rows;
    const scenarios = {};
    const totals = {};
    for (const sc of SCENARIOS) { scenarios[sc] = {}; totals[sc] = {}; }
    for (const l of lines) {
      scenarios[l.scenario] = scenarios[l.scenario] || {};
      scenarios[l.scenario][l.line_item] = scenarios[l.scenario][l.line_item] || {};
      scenarios[l.scenario][l.line_item][l.period_month] = Number(l.amount);
      totals[l.scenario][l.line_item] = r2((totals[l.scenario][l.line_item] || 0) + Number(l.amount));
    }
    return { row: v, scenarios, totals, assumptions, line_items: LINE_ITEMS };
  }

  // Bulk upsert the monthly values for one scenario.
  async function upsertLines(id, body, user) {
    const v = (await pool.query(`SELECT version_id, status FROM budget_versions WHERE version_id=$1`, [id])).rows[0];
    if (!v) return { notFound: true };
    if (v.status === 'ARCHIVED') return { badRequest: 'archived version is read-only — create a new version to change it' };
    const scenario = SCENARIOS.includes(body.scenario) ? body.scenario : 'BASE';
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const ln of lines) {
        if (!ITEM_KEYS.has(ln.line_item)) continue;
        const pm = parseInt(ln.period_month, 10);
        if (!(pm >= 1 && pm <= 12)) continue;
        await client.query(`INSERT INTO budget_lines (version_id, scenario, line_item, period_month, amount)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (version_id, scenario, line_item, period_month)
          DO UPDATE SET amount=EXCLUDED.amount, updated_at=NOW()`,
          [id, scenario, ln.line_item, pm, num(ln.amount) || 0]);
      }
      await client.query(`UPDATE budget_versions SET updated_at=NOW() WHERE version_id=$1`, [id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
    await audit(user, `budget lines upserted v${id}/${scenario} (${lines.length})`, { version_id: id, scenario });
    return await getVersion(id);
  }

  // Derive UPSIDE/DOWNSIDE from BASE by applying a per-line-item percentage delta.
  // Captures the "editable assumption -> financial impact" idea (§11) deterministically.
  async function deriveScenario(id, body, user) {
    const to = SCENARIOS.includes(body.to) ? body.to : null;
    if (!to || to === 'BASE') return { badRequest: 'to must be UPSIDE or DOWNSIDE' };
    const deltas = body.deltas || {};  // { REVENUE: 10, OPEX: -5, ... } percentages
    const base = (await pool.query(`SELECT line_item, period_month, amount FROM budget_lines WHERE version_id=$1 AND scenario='BASE'`, [id])).rows;
    if (!base.length) return { badRequest: 'populate the BASE scenario first' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const b of base) {
        const pct = num(deltas[b.line_item]) || 0;
        const amt = r2(Number(b.amount) * (1 + pct / 100));
        await client.query(`INSERT INTO budget_lines (version_id, scenario, line_item, period_month, amount)
          VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (version_id, scenario, line_item, period_month)
          DO UPDATE SET amount=EXCLUDED.amount, updated_at=NOW()`,
          [id, to, b.line_item, b.period_month, amt]);
      }
      for (const [k, val] of Object.entries(deltas)) {
        await client.query(`INSERT INTO budget_assumptions (version_id, scenario, akey, aval, note)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT (version_id, scenario, akey)
          DO UPDATE SET aval=EXCLUDED.aval, note=EXCLUDED.note, updated_at=NOW()`,
          [id, to, `delta_${k}`, num(val) || 0, `${to} applies ${val}% to BASE ${k}`]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
    finally { client.release(); }
    await audit(user, `budget scenario derived v${id} ${to}`, { version_id: id, to, deltas });
    return await getVersion(id);
  }

  // Monthly actuals the MES can SOURCE for the given FY. Honest: only REVENUE,
  // RECEIVABLE_COLLECTION and DEBT_REPAYMENT; everything else -> available:false.
  async function actuals(fy) {
    const out = { REVENUE: {}, RECEIVABLE_COLLECTION: {}, DEBT_REPAYMENT: {} };
    for (let p = 1; p <= 12; p++) {
      const { year, month } = periodToCalendar(fy, p);
      const rev = (await pool.query(
        `SELECT COALESCE(SUM(grand_total),0) a FROM tax_invoices
          WHERE EXTRACT(YEAR FROM invoice_date)=$1 AND EXTRACT(MONTH FROM invoice_date)=$2`, [year, month])).rows[0].a;
      const coll = (await pool.query(
        `SELECT COALESCE(SUM(amount),0) a FROM payments
          WHERE COALESCE(status,'ACTIVE')<>'CANCELLED'
            AND EXTRACT(YEAR FROM payment_date)=$1 AND EXTRACT(MONTH FROM payment_date)=$2`, [year, month])).rows[0].a;
      const debt = (await pool.query(
        `SELECT COALESCE(SUM(paid_amount),0) a FROM loan_schedules
          WHERE status IN ('PAID','PARTIAL') AND paid_date IS NOT NULL
            AND EXTRACT(YEAR FROM paid_date)=$1 AND EXTRACT(MONTH FROM paid_date)=$2`, [year, month]).catch(() => ({ rows: [{ a: 0 }] }))).rows[0].a;
      out.REVENUE[p] = r2(rev);
      out.RECEIVABLE_COLLECTION[p] = r2(coll);
      out.DEBT_REPAYMENT[p] = r2(debt);
    }
    return {
      fy, sourced: ['REVENUE', 'RECEIVABLE_COLLECTION', 'DEBT_REPAYMENT'], actuals: out,
      sources: { REVENUE: 'MES tax invoices', RECEIVABLE_COLLECTION: 'MES receipts (payments)', DEBT_REPAYMENT: 'loan schedules (paid)' },
      note: 'Only these three line items have a reliable MES actual. Margin, opex, EBITDA, inventory and working capital require Busy and are not sourced here.',
    };
  }

  // Budget vs actual for one scenario: per-item monthly + YTD, with variance and source labels.
  async function variance(id, scenario = 'BASE') {
    const v = await getVersion(id);
    if (v.notFound) return v;
    const sc = SCENARIOS.includes(scenario) ? scenario : 'BASE';
    const act = await actuals(v.row.fy);
    const rows = LINE_ITEMS.map(li => {
      const budgetByP = (v.scenarios[sc] && v.scenarios[sc][li.key]) || {};
      const actByP = act.actuals[li.key] || null;
      const budgetTotal = r2(Object.values(budgetByP).reduce((a, x) => a + Number(x), 0));
      const actualTotal = actByP ? r2(Object.values(actByP).reduce((a, x) => a + Number(x), 0)) : null;
      return {
        line_item: li.key, label: li.label, unit: li.unit,
        budget_total: budgetTotal,
        actual_total: actualTotal,
        actual_available: actByP != null,
        variance: actByP != null ? r2(actualTotal - budgetTotal) : null,
        variance_pct: actByP != null && budgetTotal ? r2((actualTotal - budgetTotal) / budgetTotal * 100) : null,
        source: li.actual ? act.sources[li.key] || null : 'needs Busy',
        monthly: { budget: budgetByP, actual: actByP },
      };
    });
    return { version: v.row, scenario: sc, rows, note: act.note };
  }

  async function setAssumptions(id, body, user) {
    const scenario = SCENARIOS.includes(body.scenario) ? body.scenario : 'BASE';
    const items = Array.isArray(body.assumptions) ? body.assumptions : [];
    for (const a of items) {
      if (!a.key) continue;
      await pool.query(`INSERT INTO budget_assumptions (version_id, scenario, akey, aval, note)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (version_id, scenario, akey)
        DO UPDATE SET aval=EXCLUDED.aval, note=EXCLUDED.note, updated_at=NOW()`,
        [id, scenario, a.key, num(a.value), a.note || null]);
    }
    await audit(user, `budget assumptions set v${id}/${scenario}`, { version_id: id });
    return await getVersion(id);
  }

  async function setStatus(id, status, user) {
    if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) return { badRequest: 'invalid status' };
    const v = (await pool.query(`UPDATE budget_versions SET status=$2, updated_at=NOW() WHERE version_id=$1 RETURNING *`, [id, status])).rows[0];
    if (!v) return { notFound: true };
    // Only one ACTIVE version per FY: archive the others.
    if (status === 'ACTIVE') await pool.query(`UPDATE budget_versions SET status='ARCHIVED' WHERE fy=$1 AND version_id<>$2 AND status='ACTIVE'`, [v.fy, id]);
    await audit(user, `budget version ${id} -> ${status}`, { version_id: id, status });
    return { row: v };
  }

  async function remove(id, user) {
    const r = await pool.query(`DELETE FROM budget_versions WHERE version_id=$1 RETURNING fy, name`, [id]);
    if (!r.rows[0]) return { notFound: true };
    await audit(user, `budget version deleted ${id}`, { version_id: id });
    return { ok: true };
  }

  return { ensure, createVersion, listVersions, getVersion, upsertLines, deriveScenario, actuals, variance, setAssumptions, setStatus, remove, LINE_ITEMS, SCENARIOS, _periodToCalendar: periodToCalendar };
};
