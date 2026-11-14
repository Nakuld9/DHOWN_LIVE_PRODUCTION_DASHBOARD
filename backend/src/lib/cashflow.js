// Rolling cash-flow forecast for the CFO module (spec §5).
//
// A weekly (default 13-week) forecast built from what the MES actually knows:
//   opening cash      — the REAL bank balance from the H2H statement feed
//   loan P + interest  — EXACT dates/amounts from loan_schedules (Slice 1)
//   collections        — open receivables distributed by their ageing (a labelled
//                        forecast, not an actual) — overdue collected sooner
//   supplier payments  — open POs distributed by expected/overdue date
//   recurring outflows — wages/utilities/admin/statutory/capex set as assumptions
// Every forecast figure is a FORECAST, never presented as an actual bank balance.
// Any cell can be overridden with a reason; the original is preserved (audit trail).
// Scenarios: BASE / UPSIDE / DOWNSIDE adjust collection speed + an inflow haircut.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const ymd = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
// Which 1-based week a date falls in, relative to the anchor. Week 1 = [anchor, anchor+7),
// week 2 = [anchor+7, anchor+14), … Overdue (before anchor) -> week 1; beyond horizon -> last week.
function weekOf(dateStr, anchor, H) {
  const days = Math.floor((new Date(dateStr + 'T00:00:00') - new Date(anchor + 'T00:00:00')) / 864e5);
  return Math.min(Math.max(Math.floor(days / 7) + 1, 1), H);
}

// Outflow/inflow line keys (OPENING/CLOSING/surplus are derived, not stored).
const INFLOW_LINES = ['COLLECTIONS', 'OTHER_RECEIPTS'];
const OUTFLOW_LINES = ['SUPPLIER_PAYMENTS', 'LOAN_PRINCIPAL', 'LOAN_INTEREST', 'WAGES', 'UTILITIES', 'ADMIN_SELLING', 'STATUTORY', 'CAPEX', 'OTHER_OUTFLOW'];
const RECURRING_KEYS = ['OTHER_RECEIPTS', 'WAGES', 'UTILITIES', 'ADMIN_SELLING', 'STATUTORY', 'CAPEX', 'OTHER_OUTFLOW'];

// Distribute a bucket amount evenly across an inclusive week range [a,b] (1-based).
function spread(weeks, amount, a, b, horizon) {
  const lo = Math.max(1, a), hi = Math.min(horizon, b);
  if (hi < lo || !amount) return;
  const per = amount / (hi - lo + 1);
  for (let w = lo; w <= hi; w++) weeks[w - 1] += per;
}

module.exports = (pool) => {
  const finance = require('./finance')(pool);
  const bankCf = require('./bank-cashflow')(pool);
  const loans = require('./loans')(pool, {});

  async function ensure() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cashflow_forecasts (
        forecast_id   BIGSERIAL PRIMARY KEY,
        name          VARCHAR(120) NOT NULL,
        anchor_date   DATE NOT NULL DEFAULT CURRENT_DATE,
        horizon_weeks INT NOT NULL DEFAULT 13,
        min_buffer    NUMERIC(16,2) NOT NULL DEFAULT 0,
        opening_cash_override NUMERIC(16,2),
        assumptions   JSONB NOT NULL DEFAULT '{}'::jsonb,
        status        VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
        created_by    VARCHAR(60),
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT cashflow_horizon_ck CHECK (horizon_weeks BETWEEN 1 AND 53),
        CONSTRAINT cashflow_status_ck CHECK (status IN ('ACTIVE','ARCHIVED'))
      );
      CREATE TABLE IF NOT EXISTS cashflow_overrides (
        override_id   BIGSERIAL PRIMARY KEY,
        forecast_id   BIGINT NOT NULL REFERENCES cashflow_forecasts(forecast_id) ON DELETE CASCADE,
        week_index    INT NOT NULL,
        line_key      VARCHAR(30) NOT NULL,
        amount        NUMERIC(16,2) NOT NULL,
        original_amount NUMERIC(16,2),
        reason        TEXT,
        overridden_by VARCHAR(60),
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (forecast_id, week_index, line_key)
      );
      CREATE INDEX IF NOT EXISTS idx_cashflow_ovr_forecast ON cashflow_overrides(forecast_id);
      -- An override / its original can be a signed adjustment; the boot's non-negative
      -- heuristic would add amount >= 0, so drop those checks.
      ALTER TABLE cashflow_overrides DROP CONSTRAINT IF EXISTS ck_cashflow_overrides__amount_nonneg;
      ALTER TABLE cashflow_overrides DROP CONSTRAINT IF EXISTS ck_cashflow_overrides__original_amount_nonneg;
    `);
  }

  const audit = async (user, action, val) => {
    try { await pool.query(`INSERT INTO audit_logs (username, action, module, new_value) VALUES ($1,$2,'CASHFLOW',$3)`,
      [user || null, action, val ? JSON.stringify(val).slice(0, 4000) : null]); } catch {}
  };

  async function create(body, user) {
    if (!body.name) return { badRequest: 'name is required' };
    const f = (await pool.query(`INSERT INTO cashflow_forecasts
      (name, anchor_date, horizon_weeks, min_buffer, opening_cash_override, assumptions, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [body.name, body.anchor_date || ymd(new Date()), num(body.horizon_weeks) || 13, num(body.min_buffer) || 0,
       num(body.opening_cash_override), JSON.stringify(body.assumptions || {}), user || null])).rows[0];
    await audit(user, `cashflow forecast created ${f.forecast_id}`, { forecast_id: f.forecast_id });
    return { row: f };
  }

  async function list() {
    return (await pool.query(`SELECT * FROM cashflow_forecasts ORDER BY status, created_at DESC`)).rows;
  }

  async function update(id, body, user) {
    const ex = (await pool.query(`SELECT * FROM cashflow_forecasts WHERE forecast_id=$1`, [id])).rows[0];
    if (!ex) return { notFound: true };
    const m = { ...ex, ...body };
    const f = (await pool.query(`UPDATE cashflow_forecasts SET name=$2, anchor_date=$3, horizon_weeks=$4,
      min_buffer=$5, opening_cash_override=$6, assumptions=$7, status=$8, updated_at=NOW() WHERE forecast_id=$1 RETURNING *`,
      [id, m.name, m.anchor_date, num(m.horizon_weeks) || 13, num(m.min_buffer) || 0, num(m.opening_cash_override),
       JSON.stringify(typeof m.assumptions === 'string' ? JSON.parse(m.assumptions) : (m.assumptions || {})), m.status || 'ACTIVE'])).rows[0];
    await audit(user, `cashflow forecast ${id} updated`, { forecast_id: id });
    return { row: f };
  }

  async function remove(id, user) {
    const r = await pool.query(`DELETE FROM cashflow_forecasts WHERE forecast_id=$1 RETURNING name`, [id]);
    if (!r.rows[0]) return { notFound: true };
    await audit(user, `cashflow forecast ${id} deleted`, { forecast_id: id });
    return { ok: true };
  }

  // Override one cell. Preserves the model's original value + a reason (audit trail).
  async function setOverride(id, body, user) {
    const wk = parseInt(body.week_index, 10);
    if (!wk || wk < 1) return { badRequest: 'week_index required' };
    if (![...INFLOW_LINES, ...OUTFLOW_LINES].includes(body.line_key)) return { badRequest: 'invalid line_key' };
    if (num(body.amount) == null) return { badRequest: 'amount required' };
    // Record the model's computed value as the original if not already overridden.
    let original = num(body.original_amount);
    if (original == null) {
      const base = await compute(id, { scenario: body.scenario || 'BASE', _noOverrides: true });
      if (base && base.weeks && base.weeks[wk - 1]) original = base.weeks[wk - 1].lines[body.line_key] ?? 0;
    }
    const row = (await pool.query(`INSERT INTO cashflow_overrides (forecast_id, week_index, line_key, amount, original_amount, reason, overridden_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (forecast_id, week_index, line_key)
      DO UPDATE SET amount=EXCLUDED.amount, reason=EXCLUDED.reason, overridden_by=EXCLUDED.overridden_by, updated_at=NOW() RETURNING *`,
      [id, wk, body.line_key, num(body.amount), original, body.reason || null, user || null])).rows[0];
    await audit(user, `cashflow override ${id} wk${wk} ${body.line_key}=${body.amount} (was ${original})`, { forecast_id: id, week: wk, line: body.line_key, amount: body.amount, original });
    return { row };
  }

  async function clearOverride(id, body, user) {
    await pool.query(`DELETE FROM cashflow_overrides WHERE forecast_id=$1 AND week_index=$2 AND line_key=$3`, [id, body.week_index, body.line_key]);
    await audit(user, `cashflow override cleared ${id} wk${body.week_index} ${body.line_key}`, { forecast_id: id });
    return { ok: true };
  }

  // The forecast engine.
  async function compute(id, { scenario = 'BASE', _noOverrides = false } = {}) {
    const f = (await pool.query(`SELECT * FROM cashflow_forecasts WHERE forecast_id=$1`, [id])).rows[0];
    if (!f) return { notFound: true };
    const H = f.horizon_weeks;
    const anchor = ymd(f.anchor_date);
    const a = typeof f.assumptions === 'string' ? JSON.parse(f.assumptions) : (f.assumptions || {});

    // Scenario knobs: downside delays collections + haircuts inflows; upside accelerates.
    const sc = ['BASE', 'UPSIDE', 'DOWNSIDE'].includes(scenario) ? scenario : 'BASE';
    const haircut = sc === 'DOWNSIDE' ? (num(a.downside_haircut_pct) ?? 10) : sc === 'UPSIDE' ? -(num(a.upside_boost_pct) ?? 5) : 0;
    const delay = sc === 'DOWNSIDE' ? 2 : sc === 'UPSIDE' ? -1 : 0;   // weeks

    // Opening cash — REAL bank feed (or an explicit override).
    let opening = num(f.opening_cash_override);
    let openingSource = 'override';
    let asOf = null;
    if (opening == null) {
      const bp = await bankCf.bankPosition().catch(() => null);
      opening = bp && bp.total != null ? Number(bp.total) : 0;
      openingSource = bp && bp.as_of ? `bank feed (as of ${ymd(bp.as_of)})` : 'bank feed (no statement loaded — assumed 0)';
      asOf = bp && bp.as_of ? ymd(bp.as_of) : null;
    }

    // Per-line weekly arrays.
    const Z = () => new Array(H).fill(0);
    const L = {}; [...INFLOW_LINES, ...OUTFLOW_LINES].forEach(k => L[k] = Z());

    // 1) Collections from receivables ageing — overdue sooner, current within term.
    const rec = await finance.receivables().catch(() => null);
    if (rec && rec.buckets) {
      const b = rec.buckets;
      spread(L.COLLECTIONS, b.d90_plus, 1 + delay, 2 + delay, H);
      spread(L.COLLECTIONS, b.d61_90, 1 + delay, 2 + delay, H);
      spread(L.COLLECTIONS, b.d31_60, 2 + delay, 4 + delay, H);
      spread(L.COLLECTIONS, b.d1_30, 3 + delay, 6 + delay, H);
      spread(L.COLLECTIONS, b.current, 5 + delay, H, H);   // not-due paid within the horizon
      if (haircut) for (let i = 0; i < H; i++) L.COLLECTIONS[i] *= (1 - haircut / 100);
    }

    // 2) Supplier payments from ALL open POs (by expected date; overdue -> week 1).
    //    Queried directly (finance.payables caps its list at 25). These are open
    //    purchase commitments in the MES, not the Busy supplier ledger.
    const pos = (await pool.query(
      `SELECT expected_date, order_date, COALESCE(total_amount,0) AS amount
         FROM purchase_orders
        WHERE UPPER(COALESCE(status,'')) NOT IN ('CLOSED','CANCELLED','COMPLETED','RECEIVED')`).catch(() => ({ rows: [] }))).rows;
    for (const po of pos) {
      const amt = Number(po.amount) || 0;
      if (!amt) continue;
      const due = po.expected_date ? ymd(po.expected_date) : null;
      let wk = 1;
      if (due) wk = weekOf(due, anchor, H);   // overdue/undated -> week 1
      L.SUPPLIER_PAYMENTS[wk - 1] += amt;
    }

    // 3) Loan principal + interest — exact, from the amortization schedules.
    const cal = await loans.calendar({ from: anchor, to: addDays(anchor, 7 * H) }).catch(() => null);
    if (cal && cal.installments) {
      for (const ins of cal.installments) {
        const wk = weekOf(ymd(ins.due_date), anchor, H);
        L.LOAN_PRINCIPAL[wk - 1] += Number(ins.principal_due) || 0;
        L.LOAN_INTEREST[wk - 1] += Number(ins.interest_due) || 0;
      }
    }

    // 4) Recurring weekly assumptions (wages/utilities/admin/statutory/capex/other).
    for (const key of RECURRING_KEYS) {
      const weekly = num(a[`weekly_${key.toLowerCase()}`]) || 0;
      if (weekly) for (let i = 0; i < H; i++) L[key][i] += weekly;
    }

    // Apply stored overrides (unless computing the pre-override baseline).
    let overrides = [];
    if (!_noOverrides) {
      overrides = (await pool.query(`SELECT week_index, line_key, amount, original_amount, reason, overridden_by FROM cashflow_overrides WHERE forecast_id=$1`, [id])).rows;
      for (const o of overrides) if (o.week_index >= 1 && o.week_index <= H && L[o.line_key]) L[o.line_key][o.week_index - 1] = Number(o.amount);
    }

    // Roll forward.
    const weeks = [];
    let bal = opening;
    for (let i = 0; i < H; i++) {
      const lines = {};
      [...INFLOW_LINES, ...OUTFLOW_LINES].forEach(k => lines[k] = r2(L[k][i]));
      const inflow = r2(INFLOW_LINES.reduce((s, k) => s + L[k][i], 0));
      const outflow = r2(OUTFLOW_LINES.reduce((s, k) => s + L[k][i], 0));
      const open_i = r2(bal);
      bal = r2(bal + inflow - outflow);
      weeks.push({
        week: i + 1, week_start: addDays(anchor, 7 * i),
        opening: open_i, total_inflow: inflow, total_outflow: outflow, closing: bal,
        buffer_gap: r2(bal - Number(f.min_buffer)),
        below_buffer: bal < Number(f.min_buffer),
        lines,
      });
    }

    const alerts = weeks.filter(w => w.below_buffer).map(w => ({ week: w.week, week_start: w.week_start, closing: w.closing, shortfall: r2(Number(f.min_buffer) - w.closing) }));
    const minClosing = weeks.reduce((m, w) => Math.min(m, w.closing), Infinity);

    return {
      forecast: f, scenario: sc, opening_cash: r2(opening), opening_source: openingSource, as_of: asOf,
      min_buffer: Number(f.min_buffer), horizon_weeks: H, weeks, overrides,
      summary: {
        total_inflow: r2(weeks.reduce((s, w) => s + w.total_inflow, 0)),
        total_outflow: r2(weeks.reduce((s, w) => s + w.total_outflow, 0)),
        closing_cash: weeks.length ? weeks[weeks.length - 1].closing : r2(opening),
        min_closing: minClosing === Infinity ? r2(opening) : minClosing,
        weeks_below_buffer: alerts.length,
      },
      alerts,
      disclaimer: 'FORECAST, not actual bank balance. Opening cash is the real bank feed; collections and supplier payments are modelled from ageing and are indicative. Override any cell for precision.',
    };
  }

  return { ensure, create, list, update, remove, setOverride, clearOverride, compute, INFLOW_LINES, OUTFLOW_LINES, RECURRING_KEYS };
};
