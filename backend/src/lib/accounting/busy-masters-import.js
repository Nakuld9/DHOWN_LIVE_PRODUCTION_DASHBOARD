// Busy MASTERS migration — copy Busy's chart of accounts (groups + ledgers) with
// all details into MES's OWN acct books (acct.account_groups / acct.ledgers), so
// staff can post to them. Masters only — no balances, no vouchers (that is the full
// cutover). Idempotent (skip by name), tagged (created_by='busy-masters'), and
// reversible (rollback deletes tagged ledgers that have no postings yet).
//
// Group strategy: Busy primary groups map to the matching MES primary (by Busy's
// fixed codes), and well-known sub-groups (Sundry Debtors/Creditors, Bank, Cash,
// Duties & Taxes, …) map to the MES standard sub-group by name — so party ledgers
// roll up to SUNDRY_DEBTORS/CREDITORS and ageing/allocation keep working. Any other
// Busy group is recreated under its mapped parent, inheriting nature/report.
const R = require('./rules');

// Busy fixed primary group code -> MES primary group code.
const BUSY_PRIMARY = {
  101: 'CAPITAL', 102: 'CURRENT_ASSETS', 103: 'CURRENT_LIAB', 104: 'FIXED_ASSETS',
  105: 'INVESTMENTS', 106: 'LOANS_LIAB', 107: 'MISC_EXP_ASSET', 108: 'CAPITAL',
  110: 'SUSPENSE', 122: 'PURCHASE', 123: 'SALES', 124: 'DIRECT_EXPENSE',
  125: 'INDIRECT_EXPENSE', 126: 'DIRECT_INCOME', 127: 'INDIRECT_INCOME',
  // User-added primaries seen in DHOWN's book.
  1462: 'FIXED_ASSETS', 2272: 'CURRENT_ASSETS',
};
// Busy group name (normalized) -> MES standard group code.
const BY_NAME = {
  'sundry debtors': 'SUNDRY_DEBTORS', 'sundry creditors': 'SUNDRY_CREDITORS',
  'bank accounts': 'BANK_ACCOUNTS', 'bank account': 'BANK_ACCOUNTS',
  'cash-in-hand': 'CASH_IN_HAND', 'cash in hand': 'CASH_IN_HAND', 'cash': 'CASH_IN_HAND',
  'duties & taxes': 'DUTIES_TAXES', 'duties and taxes': 'DUTIES_TAXES',
  'stock-in-hand': 'STOCK_IN_HAND', 'stock in hand': 'STOCK_IN_HAND',
  'secured loans': 'SECURED_LOANS', 'unsecured loans': 'UNSECURED_LOANS',
  'bank od a/c': 'BANK_OD', 'bank o/d': 'BANK_OD', 'bank occ a/c': 'BANK_OD', 'bank cc a/c': 'BANK_OD',
  'reserves & surplus': 'RESERVES', 'reserves and surplus': 'RESERVES',
  'provisions': 'PROVISIONS', 'loans & advances (asset)': 'LOANS_ADV_ASSET',
  'loans and advances (assets)': 'LOANS_ADV_ASSET', 'deposits (asset)': 'DEPOSITS_ASSET', 'deposits(asset)': 'DEPOSITS_ASSET',
  'current assets': 'CURRENT_ASSETS', 'current liabilities': 'CURRENT_LIAB',
  'fixed assets': 'FIXED_ASSETS', 'investments': 'INVESTMENTS', 'capital account': 'CAPITAL',
  'suspense account': 'SUSPENSE', 'sales accounts': 'SALES', 'purchase accounts': 'PURCHASE',
  'direct incomes': 'DIRECT_INCOME', 'indirect incomes': 'INDIRECT_INCOME',
  'direct expenses': 'DIRECT_EXPENSE', 'indirect expenses': 'INDIRECT_EXPENSE',
};

// Ledger type from the Busy group-name chain (independent of MES group creation).
function ledgerTypeForBusy(l, byCode) {
  let cur = Number(l.parent_code || 0); const seen = new Set();
  while (cur && byCode.has(cur) && !seen.has(cur)) {
    seen.add(cur); const g = byCode.get(cur); const nm = String(g.name || '').toLowerCase();
    if (/debtor|creditor|sundry|receivable|payable/.test(nm)) return 'PARTY';
    if (/\bbank\b/.test(nm)) return 'BANK';
    if (/cash/.test(nm)) return 'CASH';
    if (/duties|taxes?/.test(nm)) return 'TAX';
    cur = Number(g.parent_code || 0);
  }
  if (l.gstin) return 'PARTY';
  return 'GENERAL';
}

function validate(j) {
  if (!j || j.schema !== 'busy-mirror/v1') throw new R.AccountingError('Provide a busy-mirror/v1 extract', 'ACCT_INVALID');
  if (!Array.isArray(j.masters) || !j.masters.length) throw new R.AccountingError('Extract has no masters', 'ACCT_INVALID');
  return j;
}

module.exports = (pool) => {
  const svc = require('./service')(pool);

  async function importMasters(extract, { dry_run = false } = {}, user) {
    const j = validate(extract);
    const company = await svc.companyId();
    const actor = (user && user.username) || 'busy-masters';
    const masters = j.masters;
    const byCode = new Map(masters.map((m) => [Number(m.code), m]));
    const busyGroups = masters.filter((m) => m.is_group);
    const busyLedgers = masters.filter((m) => !m.is_group);

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const mesGroups = (await c.query(
        `SELECT group_id, code, name, parent_id, nature, report FROM acct.account_groups WHERE company_id=$1`, [company])).rows;
      const mesByCode = new Map(mesGroups.map((g) => [g.code, g]));
      const mesByName = new Map(mesGroups.map((g) => [g.name.toLowerCase(), g]));
      const suspense = mesByCode.get('SUSPENSE');

      const stats = { groups_created: 0, groups_mapped: 0, ledgers_created: 0, ledgers_existing: 0, ledgers_no_name: 0 };
      const resolved = new Map(); // busyCode -> { group_id, nature, report }
      const warnings = [];

      async function resolveGroup(busyCode, depth = 0) {
        if (resolved.has(busyCode)) return resolved.get(busyCode);
        const bg = byCode.get(busyCode);
        if (!bg || !bg.is_group || depth > 30) {
          const r = { group_id: suspense.group_id, nature: suspense.nature, report: suspense.report };
          resolved.set(busyCode, r); return r;
        }
        const nm = String(bg.name || '').trim().toLowerCase();
        // Busy's fixed system-group codes map first — they apply wherever the group
        // sits in the tree (Purchase/Sale/Expenses/Income sit under "Revenue Accounts",
        // not at the root) — then well-known names.
        const stdCode = BUSY_PRIMARY[busyCode] || BY_NAME[nm] || null;
        if (stdCode && mesByCode.has(stdCode)) {
          const g = mesByCode.get(stdCode); const r = { group_id: g.group_id, nature: g.nature, report: g.report };
          resolved.set(busyCode, r); stats.groups_mapped++; return r;
        }
        if (mesByName.has(nm)) {
          const g = mesByName.get(nm); const r = { group_id: g.group_id, nature: g.nature, report: g.report };
          resolved.set(busyCode, r); stats.groups_mapped++; return r;
        }
        // Create under the resolved parent (or Suspense for an unmapped primary).
        const par = (bg.parent_code && Number(bg.parent_code) !== 0)
          ? await resolveGroup(Number(bg.parent_code), depth + 1)
          : { group_id: suspense.group_id, nature: suspense.nature, report: suspense.report };
        if (!bg.parent_code || Number(bg.parent_code) === 0) warnings.push(`Primary group "${bg.name}" had no standard mapping — placed under Suspense`);
        let gid = null;
        if (!dry_run) {
          const ins = await c.query(
            `INSERT INTO acct.account_groups (company_id, code, name, parent_id, nature, report, sort_order, is_system)
             VALUES ($1,$2,$3,$4,$5,$6,900,false)
             ON CONFLICT (company_id, name) DO UPDATE SET updated_at = acct.account_groups.updated_at
             RETURNING group_id`, [company, `B${busyCode}`, bg.name, par.group_id, par.nature, par.report]);
          gid = ins.rows[0].group_id;
        }
        stats.groups_created++;
        const r = { group_id: gid, nature: par.nature, report: par.report };
        resolved.set(busyCode, r);
        if (gid) mesByName.set(nm, { group_id: gid, name: bg.name, nature: par.nature, report: par.report, code: `B${busyCode}` });
        return r;
      }

      // Groups are resolved lazily from the ledgers that need them (below), so empty
      // Busy container groups with no ledgers are not recreated as strays.
      void busyGroups;

      const existing = new Set((await c.query(`SELECT lower(name) n FROM acct.ledgers WHERE company_id=$1`, [company])).rows.map((r) => r.n));
      for (const l of busyLedgers) {
        const name = String(l.name || '').trim();
        if (!name) { stats.ledgers_no_name++; continue; }
        if (existing.has(name.toLowerCase())) { stats.ledgers_existing++; continue; }
        const pr = await resolveGroup(Number(l.parent_code || 0));
        const ltype = ledgerTypeForBusy(l, byCode);
        if (!dry_run) {
          await c.query(
            `INSERT INTO acct.ledgers (company_id, code, name, group_id, ledger_type, gstin, state_code, address, pan, phone, email, pincode, contact, whatsapp, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (company_id, name) DO NOTHING`,
            [company, `B${l.code}`, name, pr.group_id, ltype, l.gstin || null, l.state_code || null, l.address || null,
              l.pan || null, l.phone || null, l.email || null, l.pincode || null, l.contact || null, l.whatsapp || null, actor]);
        }
        stats.ledgers_created++; existing.add(name.toLowerCase());
      }

      if (dry_run) await c.query('ROLLBACK'); else await c.query('COMMIT');
      return { dry_run, company_busy: (j.company && j.company.name) || null, stats, warnings: warnings.slice(0, 50) };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // Rollback: remove migrated ledgers that have no postings yet (safe to undo).
  async function rollbackMasters(user) {
    const company = await svc.companyId();
    const r = await pool.query(
      `DELETE FROM acct.ledgers l
        WHERE l.company_id=$1 AND l.created_by='busy-masters'
          AND NOT EXISTS (SELECT 1 FROM acct.journal_lines jl WHERE jl.ledger_id=l.ledger_id)
          AND NOT EXISTS (SELECT 1 FROM acct.voucher_lines vl WHERE vl.ledger_id=l.ledger_id)
        RETURNING ledger_id`, [company]);
    return { removed_ledgers: r.rowCount, note: 'Migrated groups are left in place (they may now hold other ledgers).' };
  }

  return { importMasters, rollbackMasters, ledgerTypeForBusy };
};
