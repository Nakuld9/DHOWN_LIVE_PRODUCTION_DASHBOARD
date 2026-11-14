// Phase 1 — Busy READ BRIDGE: mirror + reconciliation.
//
// Consumes a `busy-mirror/v1` JSON extract produced on Windows by
// tools/busy-bridge/extract-busy.ps1 (ACE OLEDB read of the .bds). It:
//   1. mirrors Busy's masters (group tree) + Trial Balance into the acct schema
//      as a clearly-tagged, read-only snapshot (source='BUSY', timestamp) —
//      it NEVER touches the native ledgers/vouchers/journals, and
//   2. reconciles a MES-side Trial Balance, rebuilt *independently* from the raw
//      masters by re-classifying every ledger up the group tree, against Busy's
//      own TB — to the rupee (integer paise). Any variance is flagged.
//
// Busy stays the statutory book of record. This is the parallel-run foundation.
const R = require('./rules');

// paise helpers — exact integer money (JSON carries numbers with 2 decimals).
const P = (v) => R.toPaise(String(v == null ? 0 : v).replace(/,/g, '').trim()) || 0;
const S = (p) => R.fromPaise(p);

// Busy's FIXED primary group codes (format/03-accounting-semantics.md;
// identical to scripts/reports.ps1 and the extractor). This is MES's own
// classification — deliberately re-derived here so the reconciliation is an
// independent check, not a tautology that trusts the extractor's labels.
const ASSET_PRIM = new Set([102, 104, 105, 107, 1462, 2272]);
const LIAB_PRIM = new Set([101, 103, 106, 110]);
const PL_PRIM = 109;
const PLRES_PRIM = 108;
const INCOME_GRP = new Set([123, 126, 127]);
const EXPENSE_GRP = new Set([122, 124, 125]);
const ASSET_NAME_RE = /asset|investment|cash|bank|debtor|stock|advance|deposit|receivable|fixed/i;

// Walk a ledger up its parent_code chain to the primary group, then classify.
function classify(code, byCode) {
  const path = [];
  let cur = Number(code);
  const seen = new Set();
  while (cur && byCode.has(cur) && !seen.has(cur)) {
    seen.add(cur); path.push(cur);
    const m = byCode.get(cur);
    if (!m.parent_code) break;
    cur = Number(m.parent_code);
  }
  if (!path.length) return { section: 'BS', nature: 'Liability', primary_code: 0, primary_name: '(unknown)' };
  const prim = path[path.length - 1];
  const primName = byCode.has(prim) ? byCode.get(prim).name : `(${prim})`;
  if (prim === PL_PRIM) {
    let nat = 'Expense';
    for (const cc of path) { if (INCOME_GRP.has(cc)) { nat = 'Income'; break; } if (EXPENSE_GRP.has(cc)) { nat = 'Expense'; break; } }
    return { section: 'PL', nature: nat, primary_code: prim, primary_name: primName };
  }
  if (prim === PLRES_PRIM) return { section: 'BS', nature: 'Liability', primary_code: prim, primary_name: primName };
  if (ASSET_PRIM.has(prim)) return { section: 'BS', nature: 'Asset', primary_code: prim, primary_name: primName };
  if (LIAB_PRIM.has(prim)) return { section: 'BS', nature: 'Liability', primary_code: prim, primary_name: primName };
  if (ASSET_NAME_RE.test(primName)) return { section: 'BS', nature: 'Asset', primary_code: prim, primary_name: primName };
  return { section: 'BS', nature: 'Liability', primary_code: prim, primary_name: primName };
}

// ── pure reconciliation — no DB, fully deterministic ───────────────────────────
// `extract` is either the parsed JSON (masters[] + trial_balance[]) or an object
// with the same shape rebuilt from the DB. All money compared as integer paise.
function reconcileExtract(extract) {
  const masters = extract.masters || [];
  const tb = extract.trial_balance || [];
  const byCode = new Map(masters.map((m) => [Number(m.code), { name: m.name, parent_code: Number(m.parent_code || 0) }]));

  let mesDr = 0, mesCr = 0;
  let incomeCr = 0, expenseDr = 0, assetDr = 0, liabCr = 0;
  const classVariances = [];
  const primaries = new Map(); // primary_name → {section, dr, cr}

  for (const row of tb) {
    const dr = P(row.debit), cr = P(row.credit);
    mesDr += dr; mesCr += cr;
    const cl = classify(row.code, byCode);

    // net in paise: Dr positive, Cr negative
    const net = dr - cr;
    if (cl.section === 'PL') {
      if (cl.nature === 'Income') incomeCr += (cr - dr); else expenseDr += (dr - cr);
    } else if (cl.nature === 'Asset') {
      assetDr += (dr - cr);
    } else {
      liabCr += (cr - dr);
    }

    const key = cl.primary_name;
    const agg = primaries.get(key) || { section: cl.section, nature: cl.nature, dr: 0, cr: 0, count: 0 };
    agg.dr += dr; agg.cr += cr; agg.count += 1;
    primaries.set(key, agg);

    // MES's independent classification vs what the extractor labelled the row.
    if (row.section && (row.section !== cl.section || (row.nature && row.nature !== cl.nature))) {
      classVariances.push({ code: row.code, name: row.name, mes: `${cl.section}/${cl.nature}`, busy: `${row.section}/${row.nature}` });
    }
    void net;
  }

  const netProfit = incomeCr - expenseDr;                 // paise
  const bsAsset = assetDr;                                // paise
  const bsLiabCapital = liabCr + netProfit;               // + current-year result

  // Busy's own stated control totals (from the extractor).
  const busyDr = P(extract.totals && extract.totals.debit);
  const busyCr = P(extract.totals && extract.totals.credit);
  const busyNet = P(extract.pnl && extract.pnl.net_profit);
  const busyAsset = P(extract.balance_sheet && extract.balance_sheet.assets);

  const checks = {
    tb_balanced: mesDr === mesCr,
    matches_busy_debit: mesDr === busyDr,
    matches_busy_credit: mesCr === busyCr,
    net_profit_matches_busy: netProfit === busyNet,
    balance_sheet_balances: bsAsset === bsLiabCapital,
    assets_match_busy: bsAsset === busyAsset,
    no_classification_variance: classVariances.length === 0,
  };
  const ok = Object.values(checks).every(Boolean);

  const bySection = (sec) => [...primaries.entries()]
    .filter(([, v]) => v.section === sec)
    .map(([name, v]) => ({ primary: name, nature: v.nature, debit: S(v.dr), credit: S(v.cr), accounts: v.count }))
    .sort((a, b) => a.primary.localeCompare(b.primary));

  return {
    ok,
    checks,
    mes_tb: { debit: S(mesDr), credit: S(mesCr), diff: S(mesDr - mesCr), accounts: tb.length },
    busy_tb: { debit: S(busyDr), credit: S(busyCr), diff: S(busyDr - busyCr) },
    difference: {
      debit: S(mesDr - busyDr), credit: S(mesCr - busyCr),
      net_profit: S(netProfit - busyNet), assets: S(bsAsset - busyAsset),
    },
    profit_and_loss: { income: S(incomeCr), expense: S(expenseDr), net_profit: S(netProfit),
      busy_net_profit: S(busyNet) },
    balance_sheet: { assets: S(bsAsset), liabilities_capital: S(bsLiabCapital),
      net_profit: S(netProfit), diff: S(bsAsset - bsLiabCapital) },
    breakdown: { balance_sheet: bySection('BS'), profit_and_loss: bySection('PL') },
    classification_variances: classVariances.slice(0, 100),
  };
}

function validateExtract(j) {
  if (!j || typeof j !== 'object') throw new R.AccountingError('Empty or invalid extract', 'ACCT_INVALID');
  if (j.schema !== 'busy-mirror/v1') throw new R.AccountingError(`Unsupported extract schema "${j.schema}" (expected busy-mirror/v1)`, 'ACCT_INVALID');
  if (!Array.isArray(j.masters) || !Array.isArray(j.trial_balance)) throw new R.AccountingError('Extract is missing masters[] or trial_balance[]', 'ACCT_INVALID');
  if (!j.masters.length) throw new R.AccountingError('Extract has no masters', 'ACCT_INVALID');
  return j;
}

module.exports = (pool) => {
  const svc = require('./service')(pool);
  const cid = () => svc.companyId();

  // ── ingest one extract into the mirror (read-only w.r.t. the native books) ──
  async function importExtract(extract, { filename = null } = {}, user) {
    const j = validateExtract(extract);
    const recon = reconcileExtract(j);
    const company = await cid();
    const actor = (user && user.username) || 'busy-bridge';
    const src = j.source || {};
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const ins = await c.query(
        `INSERT INTO acct.busy_imports
           (company_id, source, source_dir, fy_db, db_sha256, fy_label, busy_company, busy_gstin,
            extracted_at, filename, totals, pnl, balance_sheet, reconciliation, reconciled_ok, imported_by)
         VALUES ($1,'BUSY',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (company_id, db_sha256, extracted_at) DO NOTHING
         RETURNING import_id`,
        [company, src.company_dir || null, src.fy_db || null, src.db_sha256 || null,
          (j.company && j.company.fy_label) || src.fy_label || null,
          (j.company && j.company.name) || null, (j.company && j.company.gstin) || null,
          j.extracted_at || null, filename,
          JSON.stringify(j.totals || {}), JSON.stringify(j.pnl || {}), JSON.stringify(j.balance_sheet || {}),
          JSON.stringify(recon), recon.ok, actor]);
      if (!ins.rows.length) { await c.query('ROLLBACK'); return { duplicate: true, reconciliation: recon }; }
      const importId = ins.rows[0].import_id;

      for (const m of j.masters) {
        await c.query(
          `INSERT INTO acct.busy_masters (import_id, company_id, code, name, master_type, is_group, parent_code, alias, print_name, hsn_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (import_id, code) DO NOTHING`,
          [importId, company, m.code, m.name, m.type, !!m.is_group, m.parent_code || 0, m.alias || null, m.print_name || null, m.hsn_code || null]);
      }
      for (const t of j.trial_balance) {
        await c.query(
          `INSERT INTO acct.busy_trial_balance (import_id, company_id, code, name, primary_code, primary_name, section, nature, debit, credit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (import_id, code) DO NOTHING`,
          [importId, company, t.code, t.name, t.primary_code || null, t.primary_name || null, t.section || null, t.nature || null, S(P(t.debit)), S(P(t.credit))]);
      }
      await c.query('COMMIT');
      return { import_id: importId, reconciliation: recon, masters: j.masters.length, trial_balance: j.trial_balance.length };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function listImports() {
    const company = await cid();
    return (await pool.query(
      `SELECT import_id, source_dir, fy_db, db_sha256, busy_company, busy_gstin, fy_label,
              extracted_at, filename, totals, reconciled_ok, imported_by, imported_at
         FROM acct.busy_imports WHERE company_id=$1 ORDER BY import_id DESC`, [company])).rows;
  }

  async function latestId() {
    const company = await cid();
    const r = (await pool.query(`SELECT import_id FROM acct.busy_imports WHERE company_id=$1 ORDER BY import_id DESC LIMIT 1`, [company])).rows[0];
    return r ? r.import_id : null;
  }

  // Rebuild the extract shape from the DB snapshot and reconcile independently.
  async function reconcile(importId) {
    const company = await cid();
    const id = importId ? Number(importId) : await latestId();
    if (!id) throw new R.AccountingError('No Busy import found — run the Windows extractor and ingest first', 'ACCT_NOT_FOUND');
    const imp = (await pool.query(`SELECT * FROM acct.busy_imports WHERE import_id=$1 AND company_id=$2`, [id, company])).rows[0];
    if (!imp) throw new R.AccountingError(`Busy import ${id} not found`, 'ACCT_NOT_FOUND');
    const masters = (await pool.query(`SELECT code, name, master_type AS type, is_group, parent_code FROM acct.busy_masters WHERE import_id=$1`, [id])).rows;
    const tb = (await pool.query(`SELECT code, name, primary_code, primary_name, section, nature, debit, credit FROM acct.busy_trial_balance WHERE import_id=$1`, [id])).rows;
    const recon = reconcileExtract({ masters, trial_balance: tb, totals: imp.totals, pnl: imp.pnl, balance_sheet: imp.balance_sheet });
    return {
      import_id: id,
      busy_company: imp.busy_company, busy_gstin: imp.busy_gstin, fy_db: imp.fy_db,
      extracted_at: imp.extracted_at, imported_at: imp.imported_at, source_dir: imp.source_dir,
      ...recon,
    };
  }

  async function getMasters(importId, { groups_only = false } = {}) {
    const company = await cid();
    const id = importId ? Number(importId) : await latestId();
    if (!id) return [];
    const where = groups_only ? ' AND is_group' : '';
    return (await pool.query(
      `SELECT code, name, master_type, is_group, parent_code, alias, print_name, hsn_code
         FROM acct.busy_masters WHERE import_id=$1 AND company_id=$2${where} ORDER BY code`, [id, company])).rows;
  }

  return { importExtract, listImports, reconcile, latestId, getMasters, reconcileExtract, classify };
};

// Expose the pure functions for tests (no pool needed).
module.exports.reconcileExtract = reconcileExtract;
module.exports.classify = classify;
module.exports.validateExtract = validateExtract;
