// TDS section master + deduction calculator.
//
// Design stance (same caution as tds-monitor.js): the MES is NOT the statutory
// TDS book — Busy / the CA is. So rates and thresholds are NOT hardcoded in
// code; they live in an editable `tds_sections` table the user maintains. When
// the Finance Act changes a rate or adds a section, you edit the table (or add a
// row) in the UI — no deploy. We seed the well-known sections for FY 2026-27 as
// a STARTING POINT clearly marked "verify with CA"; every figure is editable.
//
// compute() returns a SUGGESTED deduction for a given invoice/payment value. It
// is a draft aid, never a filing or a determination.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rupee = (n) => Math.round(Number(n) || 0); // TDS is deducted to the nearest rupee

// Seed: standard sections as of FY 2026-27 (AY 2027-28). RATES/THRESHOLDS ARE
// DEFAULTS TO CONFIRM WITH YOUR CA — all editable in the UI. Section 194T is the
// new one (firm/LLP payments to partners, in force from FY 2025-26).
const SEED = [
  {
    code: '194C', name: 'Payments to contractors / job-work',
    rate_pct: 1, rate_label: 'Individual / HUF',
    rate_alt_pct: 2, rate_alt_label: 'Other than Ind/HUF (company, firm)',
    no_pan_pct: 20, threshold_single: 30000, threshold_aggregate: 100000,
    notes: 'Single payment ≥ ₹30,000 or FY aggregate ≥ ₹1,00,000. MES job-work heads-up uses this.',
  },
  {
    code: '194J', name: 'Professional / technical fees, royalty',
    rate_pct: 10, rate_label: 'Professional / royalty',
    rate_alt_pct: 2, rate_alt_label: 'Technical service / call-centre',
    no_pan_pct: 20, threshold_single: 0, threshold_aggregate: 50000,
    notes: 'FY aggregate threshold ₹50,000. 2% for technical services & call-centres, else 10%.',
  },
  {
    code: '194H', name: 'Commission or brokerage',
    rate_pct: 2, rate_label: 'Commission / brokerage',
    rate_alt_pct: null, rate_alt_label: null,
    no_pan_pct: 20, threshold_single: 0, threshold_aggregate: 20000,
    notes: 'FY aggregate threshold ₹20,000 (raised by Finance Act 2025). Rate 2%.',
  },
  {
    code: '194I', name: 'Rent',
    rate_pct: 10, rate_label: 'Land / building / furniture',
    rate_alt_pct: 2, rate_alt_label: 'Plant & machinery',
    no_pan_pct: 20, threshold_single: 50000, threshold_aggregate: 0,
    notes: 'Threshold ₹50,000 PER MONTH (Finance Act 2025). 10% land/building, 2% plant & machinery.',
  },
  {
    code: '194Q', name: 'Purchase of goods',
    rate_pct: 0.1, rate_label: 'Buyer on purchases',
    rate_alt_pct: null, rate_alt_label: null,
    no_pan_pct: 5, threshold_single: 0, threshold_aggregate: 5000000,
    notes: 'Buyer with turnover > ₹10 cr. 0.1% on the value of purchases from a seller EXCEEDING ₹50,00,000 in the FY. No-PAN rate 5%.',
  },
  {
    code: '194T', name: 'Firm / LLP payments to partners',
    rate_pct: 10, rate_label: 'Remuneration / interest / commission / bonus',
    rate_alt_pct: null, rate_alt_label: null,
    no_pan_pct: 20, threshold_single: 0, threshold_aggregate: 20000,
    notes: 'NEW — in force from FY 2025-26. 10% on salary/remuneration/interest/commission/bonus to partners when FY aggregate > ₹20,000.',
  },
];

// Pure deduction math — no DB. Exported for unit tests.
function calc(s, { amount, variant = 'std', has_pan = true, fy_prior = 0 } = {}) {
  const base = Number(amount) || 0;
  const prior = Number(fy_prior) || 0;
  let ratePct;
  if (!has_pan) ratePct = Number(s.no_pan_pct) || 0;
  else if (variant === 'alt' && s.rate_alt_pct != null) ratePct = Number(s.rate_alt_pct);
  else ratePct = Number(s.rate_pct) || 0;

  const single = Number(s.threshold_single) || 0;
  const agg = Number(s.threshold_aggregate) || 0;
  const overSingle = single > 0 && base >= single;
  const overAgg = agg > 0 && (base + prior) >= agg;
  // 194Q deducts only on the value EXCEEDING the aggregate threshold.
  const dutiableBase = (String(s.code).toUpperCase() === '194Q' && agg > 0)
    ? Math.max(0, base + prior - agg) : base;
  const applicable = (single === 0 && agg === 0) ? true : (overSingle || overAgg);
  const tds = applicable ? rupee(dutiableBase * ratePct / 100) : 0;
  return {
    section: s.code, section_name: s.name,
    amount: r2(base), rate_pct: ratePct,
    variant: !has_pan ? 'no-PAN (206AA)' : (variant === 'alt' ? (s.rate_alt_label || 'alt') : (s.rate_label || 'std')),
    applicable, over_single: overSingle, over_aggregate: overAgg,
    dutiable_base: r2(dutiableBase), tds_amount: tds, net_payable: r2(base - tds),
  };
}

module.exports = (pool) => {
  const q = (sql, p = []) => pool.query(sql, p);

  async function ensure() {
    await q(`
      CREATE TABLE IF NOT EXISTS tds_sections (
        code              VARCHAR(16) PRIMARY KEY,
        name              TEXT NOT NULL,
        rate_pct          NUMERIC(6,3) NOT NULL DEFAULT 0,
        rate_label        TEXT,
        rate_alt_pct      NUMERIC(6,3),
        rate_alt_label    TEXT,
        no_pan_pct        NUMERIC(6,3) NOT NULL DEFAULT 20,
        threshold_single  NUMERIC(14,2) NOT NULL DEFAULT 0,
        threshold_aggregate NUMERIC(14,2) NOT NULL DEFAULT 0,
        notes             TEXT,
        active            BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    // Seed only if empty — never overwrite figures the user has edited.
    const { rows } = await q(`SELECT COUNT(*)::int n FROM tds_sections`);
    if (rows[0].n === 0) {
      for (const s of SEED) {
        await q(`INSERT INTO tds_sections
          (code,name,rate_pct,rate_label,rate_alt_pct,rate_alt_label,no_pan_pct,threshold_single,threshold_aggregate,notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (code) DO NOTHING`,
          [s.code, s.name, s.rate_pct, s.rate_label, s.rate_alt_pct, s.rate_alt_label,
           s.no_pan_pct, s.threshold_single, s.threshold_aggregate, s.notes]);
      }
    }
  }

  async function list() {
    await ensure();
    const { rows } = await q(`SELECT * FROM tds_sections ORDER BY code`);
    return {
      sections: rows,
      note: 'Rates and thresholds are a starting point for FY 2026-27 — confirm every figure with your CA. Editing here changes only the MES suggestion; Busy remains the statutory TDS book.',
    };
  }

  async function upsert(body, actor) {
    await ensure();
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) { const e = new Error('Section code is required'); e.status = 400; throw e; }
    const n = (v, d = null) => (v === '' || v === undefined || v === null ? d : Number(v));
    const { rows } = await q(`
      INSERT INTO tds_sections
        (code,name,rate_pct,rate_label,rate_alt_pct,rate_alt_label,no_pan_pct,threshold_single,threshold_aggregate,notes,active,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
      ON CONFLICT (code) DO UPDATE SET
        name=EXCLUDED.name, rate_pct=EXCLUDED.rate_pct, rate_label=EXCLUDED.rate_label,
        rate_alt_pct=EXCLUDED.rate_alt_pct, rate_alt_label=EXCLUDED.rate_alt_label,
        no_pan_pct=EXCLUDED.no_pan_pct, threshold_single=EXCLUDED.threshold_single,
        threshold_aggregate=EXCLUDED.threshold_aggregate, notes=EXCLUDED.notes,
        active=EXCLUDED.active, updated_at=NOW()
      RETURNING *`,
      [code, String(body.name || code), n(body.rate_pct, 0), body.rate_label || null,
       n(body.rate_alt_pct), body.rate_alt_label || null, n(body.no_pan_pct, 20),
       n(body.threshold_single, 0), n(body.threshold_aggregate, 0), body.notes || null,
       body.active === undefined ? true : !!body.active]);
    return rows[0];
  }

  async function remove(code) {
    await ensure();
    await q(`DELETE FROM tds_sections WHERE code=$1`, [String(code || '').toUpperCase()]);
    return { removed: true };
  }

  // Suggest a deduction for one invoice/payment value.
  //   amount        gross taxable value the TDS is reckoned on
  //   variant       'std' (rate_pct) | 'alt' (rate_alt_pct)
  //   has_pan       false → higher no-PAN rate (206AA)
  //   fy_prior      value already paid to this payee this FY (optional, for the
  //                 aggregate test); defaults to 0
  async function compute({ section_code, amount, variant = 'std', has_pan = true, fy_prior = 0 }) {
    await ensure();
    const code = String(section_code || '').toUpperCase();
    const { rows } = await q(`SELECT * FROM tds_sections WHERE code=$1`, [code]);
    if (!rows.length) { const e = new Error(`Unknown TDS section ${code}`); e.status = 404; throw e; }
    const s = rows[0];
    const c = calc(s, { amount, variant, has_pan, fy_prior });
    const tds = c.tds_amount, ratePct = c.rate_pct, applicable = c.applicable;
    return {
      ...c,
      note: applicable
        ? `Suggested TDS ${tds ? '₹' + tds.toLocaleString('en-IN') : '₹0'} under ${s.code} at ${ratePct}%. Draft only — confirm with your CA; Busy posts the statutory entry.`
        : `Below the ${s.code} threshold on this value — no TDS suggested. Watch the FY aggregate; confirm with your CA.`,
      disclaimer: 'Not tax advice. Rates/thresholds are as configured in the section master and must be verified against the current Finance Act.',
    };
  }

  return { ensure, list, upsert, remove, compute, SEED };
};

module.exports.calc = calc;
module.exports.SEED = SEED;
