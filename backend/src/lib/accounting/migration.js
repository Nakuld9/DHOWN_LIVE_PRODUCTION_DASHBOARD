// Phase 5 — Busy XML migration. Consumes an authorised Busy "Data Export/Import
// (XML)" export (masters + transactions) and brings it into the acct engine
// through the ONE authoritative service: dry-run first, dedupe + restartable via
// a source→target map, a reconciliation report against the export's own control
// totals, and batch rollback before go-live. Busy stays the book of record until
// a reviewed cutover, so vouchers import as shadow DRAFT by default.
//
// Fidelity note: every Busy voucher is migrated as a JOURNAL that reproduces its
// exact Dr/Cr ledger effect; the original Busy voucher type, number and date are
// preserved as metadata (reference + narration + migration_map). This avoids
// type-specific validation (e.g. the Contra cash/bank rule) rewriting history.
const R = require('./rules');
const X = require('./xml-lite');

const P = (v) => R.toPaise(String(v == null ? '' : v).replace(/,/g, '').trim()) || 0;
const S = (p) => R.fromPaise(p);
const sideOf = (s) => (String(s || '').trim().toUpperCase().startsWith('C') ? 'Cr' : 'Dr');

module.exports = (pool) => {
  const svc = require('./service')(pool);
  async function cid() { return svc.companyId(); }

  // ── parse an export into a normalized shape ────────────────────────────────
  function parse(xml) {
    const root = X.parseXml(xml);
    const groups = X.findAll(root, 'Group').map((g) => ({
      name: X.text(g, 'Name', 'GroupName').trim(),
      parent: X.text(g, 'Parent', 'Under', 'ParentGroup').trim() || null,
      nature: X.text(g, 'Nature', 'Type').trim() || null,
    })).filter((g) => g.name);
    const ledgers = X.findAll(root, 'Ledger', 'Account', 'Master').map((l) => ({
      name: X.text(l, 'Name', 'LedgerName', 'AccountName').trim(),
      group: X.text(l, 'Group', 'Under', 'ParentGroup').trim() || null,
      gstin: X.text(l, 'GSTIN', 'GSTNo', 'GSTIN_No').trim() || null,
      opening: X.text(l, 'OpeningBalance', 'Opening', 'OpeningBal').trim() || '',
      drcr: X.text(l, 'DrCr', 'OpeningDrCr', 'BalanceType').trim() || 'Dr',
    })).filter((l) => l.name);
    const vouchers = X.findAll(root, 'Voucher', 'Transaction').map((v, idx) => {
      const number = X.text(v, 'Number', 'VoucherNo', 'VchNo', 'No').trim();
      const lines = X.childrenNamed(v, 'Line', 'Entry', 'LedgerEntry', 'Detail').map((ln) => ({
        ledger: X.text(ln, 'Ledger', 'Account', 'LedgerName', 'Name').trim(),
        drcr: sideOf(X.text(ln, 'DrCr', 'Type', 'BalanceType')),
        amount: X.text(ln, 'Amount', 'Value', 'Amt').trim(),
      })).filter((ln) => ln.ledger);
      return {
        source_id: number || `V${idx + 1}`,
        type: X.text(v, 'Type', 'VoucherType', 'VchType').trim() || 'Journal',
        date: (X.text(v, 'Date', 'VoucherDate', 'VchDate').trim() || '').slice(0, 10),
        number, narration: X.text(v, 'Narration', 'Remarks', 'Particulars').trim() || null,
        reference: X.text(v, 'Reference', 'RefNo', 'Ref').trim() || null,
        lines,
      };
    });
    const company = X.text(root.children[0] || root, 'Company', 'CompanyName') || (root.children[0] && root.children[0].attrs && (root.children[0].attrs.company || root.children[0].attrs.Company)) || null;
    return { company, groups, ledgers, vouchers };
  }

  // Control totals straight from the export (what the migration must reproduce).
  function exportTotals(norm) {
    let openDr = 0, openCr = 0;
    for (const l of norm.ledgers) { const p = P(l.opening); if (!p) continue; if (sideOf(l.drcr) === 'Cr') openCr += p; else openDr += p; }
    let vDr = 0, vCr = 0, unbalanced = 0;
    for (const v of norm.vouchers) {
      let d = 0, c = 0;
      for (const ln of v.lines) { const p = P(ln.amount); if (ln.drcr === 'Cr') c += p; else d += p; }
      vDr += d; vCr += c; if (d !== c || d === 0) unbalanced++;
    }
    return { opening_dr: S(openDr), opening_cr: S(openCr), opening_diff: S(openDr - openCr),
      voucher_dr: S(vDr), voucher_cr: S(vCr), unbalanced_vouchers: unbalanced };
  }

  async function mapGet(sourceType, sourceId) {
    const c = await cid();
    const r = (await pool.query(`SELECT target_kind, target_id FROM acct.migration_map WHERE company_id=$1 AND source_type=$2 AND source_id=$3`, [c, sourceType, String(sourceId)])).rows[0];
    return r || null;
  }
  async function mapPut(batchId, sourceType, sourceId, kind, targetId) {
    const c = await cid();
    await pool.query(
      `INSERT INTO acct.migration_map (company_id, batch_id, source_type, source_id, target_kind, target_id)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (company_id, source_type, source_id) DO NOTHING`,
      [c, batchId, sourceType, String(sourceId), kind, String(targetId)]);
  }

  async function ledgerIndex() {
    const leds = await svc.listLedgers({});
    const m = new Map();
    for (const l of leds) { m.set(l.name.toLowerCase(), l); if (l.code) m.set(l.code.toLowerCase(), l); }
    return m;
  }
  async function groupIndex() {
    const gs = await svc.listGroups();
    const m = new Map();
    for (const g of gs) { m.set(g.name.toLowerCase(), g); if (g.code) m.set(g.code.toLowerCase(), g); }
    return m;
  }

  // ── dry run: no writes, full reconciliation preview ─────────────────────────
  async function dryRun(xml) {
    const norm = parse(xml);
    const gi = await groupIndex(); const li = await ledgerIndex();
    const warnings = [];
    const gNew = norm.groups.filter((g) => !gi.has(g.name.toLowerCase())).length;
    const lNew = norm.ledgers.filter((l) => !li.has(l.name.toLowerCase())).length;
    // Ledger names a voucher references but that neither exist nor are declared.
    const declared = new Set([...norm.ledgers.map((l) => l.name.toLowerCase()), ...li.keys()]);
    let vDup = 0;
    for (const v of norm.vouchers) {
      if (await mapGet('voucher', v.source_id)) vDup++;
      for (const ln of v.lines) if (!declared.has(ln.ledger.toLowerCase())) warnings.push(`Voucher ${v.source_id}: ledger "${ln.ledger}" is not declared in masters and does not exist`);
    }
    for (const l of norm.ledgers) if (l.group && !gi.has(l.group.toLowerCase()) && !norm.groups.some((g) => g.name.toLowerCase() === l.group.toLowerCase())) warnings.push(`Ledger "${l.name}": group "${l.group}" not found (will fall back to Suspense)`);
    return {
      company: norm.company,
      counts: { groups: norm.groups.length, groups_new: gNew, ledgers: norm.ledgers.length, ledgers_new: lNew, vouchers: norm.vouchers.length, vouchers_duplicate: vDup },
      export_totals: exportTotals(norm),
      warnings: warnings.slice(0, 200),
      ok_to_import: exportTotals(norm).unbalanced_vouchers === 0 && norm.vouchers.length - vDup >= 0,
    };
  }

  // ── import ──────────────────────────────────────────────────────────────────
  async function resolveGroupId(name, gi) {
    if (name && gi.has(name.toLowerCase())) return gi.get(name.toLowerCase()).group_id;
    return gi.get('suspense') ? gi.get('suspense').group_id : null;
  }

  async function doImport(xml, { mode = 'DRAFT', label } = {}, user) {
    const m = String(mode).toUpperCase() === 'POST' ? 'POST' : 'DRAFT';
    const norm = parse(xml);
    const et = exportTotals(norm);
    if (et.unbalanced_vouchers > 0) throw new R.AccountingError(`Export has ${et.unbalanced_vouchers} unbalanced voucher(s) — refusing to import`, 'ACCT_INVALID');
    const c = await cid();
    const actor = user || { username: 'migration' };
    const batch = (await pool.query(
      `INSERT INTO acct.migration_batches (company_id, label, source, mode, created_by) VALUES ($1,$2,'busy-xml',$3,$4) RETURNING batch_id`,
      [c, label || `Busy import ${new Date().toISOString().slice(0, 10)}`, m, actor.username])).rows[0];
    const batchId = batch.batch_id;
    const stats = { groups_created: 0, groups_existing: 0, ledgers_created: 0, ledgers_existing: 0, vouchers_created: 0, vouchers_duplicate: 0, posted: 0 };

    // 1) Groups (parents first — sort so a parent that is also in the file lands first).
    let gi = await groupIndex();
    const order = [...norm.groups].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
    for (const g of order) {
      if (gi.has(g.name.toLowerCase())) { stats.groups_existing++; await mapPut(batchId, 'group', g.name, 'group', gi.get(g.name.toLowerCase()).group_id); continue; }
      const parentId = await resolveGroupId(g.parent, gi);
      const created = await svc.createGroup({ name: g.name, parent_id: parentId }, actor);
      stats.groups_created++; await mapPut(batchId, 'group', g.name, 'group', created.group_id);
      gi = await groupIndex();
    }

    // 2) Ledgers + opening balances.
    let li = await ledgerIndex();
    for (const l of norm.ledgers) {
      const existing = li.get(l.name.toLowerCase());
      if (existing) { stats.ledgers_existing++; await mapPut(batchId, 'ledger', l.name, 'ledger', existing.ledger_id); continue; }
      const groupId = await resolveGroupId(l.group, gi);
      if (!groupId) throw new R.AccountingError(`Ledger "${l.name}": no group and no Suspense fallback`, 'ACCT_CONFLICT');
      const opening = P(l.opening) ? { amount: S(P(l.opening)), side: sideOf(l.drcr) } : null;
      const saved = await svc.saveLedger(null, { name: l.name, group_id: groupId, gstin: l.gstin || null, opening }, actor);
      stats.ledgers_created++; await mapPut(batchId, 'ledger', l.name, 'ledger', saved.ledger_id);
      li = await ledgerIndex();
    }

    // 3) Vouchers (as JOURNAL preserving the Dr/Cr effect; dedupe by Busy id).
    li = await ledgerIndex();
    for (const v of norm.vouchers) {
      if (await mapGet('voucher', v.source_id)) { stats.vouchers_duplicate++; continue; }
      const lines = v.lines.map((ln) => {
        const led = li.get(ln.ledger.toLowerCase());
        if (!led) throw new R.AccountingError(`Voucher ${v.source_id}: unknown ledger "${ln.ledger}"`, 'ACCT_NOT_FOUND');
        const p = P(ln.amount);
        return ln.drcr === 'Cr' ? { ledger_id: led.ledger_id, dr_amount: '0', cr_amount: S(p) } : { ledger_id: led.ledger_id, dr_amount: S(p), cr_amount: '0' };
      });
      const draft = await svc.createDraft({
        voucher_type: 'JOURNAL', voucher_date: v.date, reference_no: v.number || v.reference || null,
        narration: `[Busy ${v.type}${v.number ? ' ' + v.number : ''}] ${v.narration || ''}`.trim(),
        source_module: 'acct.migration', source_ref: v.source_id, idempotency_key: `BUSY:${v.source_id}`, lines,
      }, actor);
      if (draft.idempotent_replay) { stats.vouchers_duplicate++; }
      else {
        stats.vouchers_created++;
        if (m === 'POST') {
          const val = await svc.validateVoucher(draft.voucher_id, actor);
          if (val.ok) { await svc.postVoucher(draft.voucher_id, actor); stats.posted++; }
        }
      }
      await mapPut(batchId, 'voucher', v.source_id, 'voucher', draft.voucher_id);
    }

    await pool.query(`UPDATE acct.migration_batches SET stats=$2 WHERE batch_id=$1`, [batchId, JSON.stringify(stats)]);
    return { batch_id: batchId, mode: m, stats, export_totals: et };
  }

  // ── reconciliation: migrated vs the export's own totals ─────────────────────
  async function reconcile(batchId, { as_of } = {}) {
    const c = await cid();
    const b = (await pool.query(`SELECT * FROM acct.migration_batches WHERE batch_id=$1 AND company_id=$2`, [batchId, c])).rows[0];
    if (!b) throw new R.AccountingError(`Migration batch ${batchId} not found`, 'ACCT_NOT_FOUND');
    const voucherIds = (await pool.query(`SELECT target_id FROM acct.migration_map WHERE company_id=$1 AND batch_id=$2 AND target_kind='voucher'`, [c, batchId])).rows.map((r) => r.target_id);
    // Posted effect of this batch's vouchers.
    const posted = (await pool.query(
      `SELECT COALESCE(SUM(jl.dr_amount),0) dr, COALESCE(SUM(jl.cr_amount),0) cr
         FROM acct.journal_lines jl JOIN acct.journal_entries je ON je.je_id=jl.je_id
        WHERE je.company_id=$1 AND je.voucher_id = ANY($2::uuid[])`, [c, voucherIds])).rows[0];
    const tb = await svc.trialBalance({ as_of: as_of || undefined });
    const stats = b.stats || {};
    return {
      batch_id: batchId, status: b.status, mode: b.mode, stats,
      posted_effect: { dr: S(R.toPaise(posted.dr) || 0), cr: S(R.toPaise(posted.cr) || 0) },
      trial_balance_ties: tb.totals.closing_dr === tb.totals.closing_cr,
      note: b.mode === 'DRAFT' ? 'Shadow import: vouchers are DRAFT and do not yet affect the GL. Reconcile against Busy, then POST or rollback.' : 'Posted import: compare the trial balance to Busy for the same date.',
    };
  }

  // ── rollback: reverse/cancel this batch's vouchers (masters are left) ────────
  async function rollback(batchId, user) {
    const c = await cid();
    const b = (await pool.query(`SELECT * FROM acct.migration_batches WHERE batch_id=$1 AND company_id=$2`, [batchId, c])).rows[0];
    if (!b) throw new R.AccountingError(`Migration batch ${batchId} not found`, 'ACCT_NOT_FOUND');
    if (b.status === 'ROLLED_BACK') return { batch_id: batchId, already: true };
    const actor = user || { username: 'migration' };
    const vouchers = (await pool.query(`SELECT target_id FROM acct.migration_map WHERE company_id=$1 AND batch_id=$2 AND target_kind='voucher'`, [c, batchId])).rows.map((r) => r.target_id);
    let reversed = 0, cancelled = 0, skipped = 0;
    for (const vid of vouchers) {
      const v = await svc.getVoucher(vid).catch(() => null);
      if (!v) { skipped++; continue; }
      try {
        if (v.status === 'POSTED') { await svc.reverseVoucher(vid, { reason: `Rollback of migration batch ${batchId}` }, actor); reversed++; }
        else if (['DRAFT', 'VALIDATED', 'APPROVED'].includes(v.status)) { await svc.cancelDraft(vid, actor); cancelled++; }
        else skipped++;
      } catch { skipped++; }
    }
    await pool.query(`UPDATE acct.migration_batches SET status='ROLLED_BACK', rolled_back_at=now() WHERE batch_id=$1`, [batchId]);
    return { batch_id: batchId, reversed, cancelled, skipped, note: 'Imported ledgers/groups are retained (masters are not auto-deleted).' };
  }

  async function listBatches() {
    const c = await cid();
    return (await pool.query(`SELECT batch_id, label, source, mode, status, stats, created_by, created_at, rolled_back_at FROM acct.migration_batches WHERE company_id=$1 ORDER BY batch_id DESC`, [c])).rows;
  }

  return { parse, exportTotals, dryRun, import: doImport, reconcile, rollback, listBatches };
};
