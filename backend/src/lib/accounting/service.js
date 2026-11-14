// Accounting engine — the authoritative service (Phase 1).
//
// This is the ONLY code that writes journal entries. Routes, the UI, MES modules
// and (later) the AI accountant all go through createDraft → validate →
// [approve] → post, or reverse. Nothing here trusts the caller's arithmetic:
// every post re-loads the lines and re-validates inside the posting transaction.
//
// Concurrency: post/reverse take a row lock on the voucher (FOR UPDATE) and on
// its numbering series row, so two simultaneous posts can neither double-post
// one voucher nor hand out the same voucher number. The deferred DB trigger
// re-checks Σdr = Σcr at COMMIT as a second line of defence.

const R = require('./rules');
const { ymd } = require('./schema');
const { AccountingError } = R;

const MAKER_CHECKER = String(process.env.ACCT_MAKER_CHECKER || 'true') !== 'false';

module.exports = (pool) => {
  // ── plumbing ─────────────────────────────────────────────────────────────
  async function tx(fn) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw translate(e);
    } finally {
      c.release();
    }
  }

  // DB-level guard violations come back as P0001; surface them as conflicts.
  function translate(e) {
    if (e instanceof AccountingError) return e;
    if (e && e.code === 'P0001') return new AccountingError(e.message.replace(/^acct[.:]\s*/, ''), 'ACCT_CONFLICT');
    if (e && e.code === '23505') return new AccountingError('Duplicate: ' + (e.detail || e.message), 'ACCT_CONFLICT');
    if (e && e.code === '23503') return new AccountingError('Reference not found: ' + (e.detail || e.message), 'ACCT_INVALID');
    if (e && e.code === '22P02') return new AccountingError('Invalid identifier', 'ACCT_INVALID');
    return e;
  }

  let _company = null;
  async function companyId(c = pool) {
    if (_company) return _company;
    const r = (await c.query(`SELECT company_id FROM acct.companies WHERE is_default`)).rows[0];
    if (!r) throw new AccountingError('Accounting is not initialised for this company', 'ACCT_NOT_FOUND');
    _company = r.company_id;
    return _company;
  }

  async function audit(c, cid, entity, entityId, action, actor, detail) {
    await c.query(
      `INSERT INTO acct.audit_log (company_id, entity, entity_id, action, actor, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      [cid, entity, entityId ? String(entityId) : null, action, actor || null, detail ? JSON.stringify(detail) : null]);
  }

  const who = (user) => (user && (user.username || user.name)) || 'system';

  function isoDate(v) {
    if (!v) throw new AccountingError('Voucher date is required', 'ACCT_INVALID');
    const s = v instanceof Date ? ymd(v) : String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) {
      throw new AccountingError(`"${v}" is not a valid date (YYYY-MM-DD)`, 'ACCT_INVALID');
    }
    return s;
  }

  async function fyForDate(c, date) {
    const r = (await c.query(
      `SELECT fy_id, label, is_closed, start_date, end_date FROM public.financial_years
        WHERE $1::date BETWEEN start_date AND end_date ORDER BY start_date DESC LIMIT 1`, [date])).rows[0];
    if (!r) throw new AccountingError(`No financial year covers ${date}`, 'ACCT_PERIOD');
    return r;
  }

  async function periodForDate(c, cid, fyId, date, lock = false) {
    const r = (await c.query(
      `SELECT period_id, status FROM acct.periods
        WHERE company_id=$1 AND fy_id=$2 AND $3::date BETWEEN start_date AND end_date
        ${lock ? 'FOR SHARE' : ''}`, [cid, fyId, date])).rows[0];
    if (!r) throw new AccountingError(`No accounting period covers ${date}`, 'ACCT_PERIOD');
    return r;
  }

  async function voucherType(c, code) {
    const t = (await c.query(`SELECT * FROM acct.voucher_types WHERE code=$1`, [code])).rows[0];
    if (!t || !t.is_active) throw new AccountingError(`Unknown voucher type "${code}"`, 'ACCT_INVALID');
    return t;
  }

  async function ledgerMap(c, cid, ids) {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map();
    const rows = (await c.query(
      `SELECT ledger_id, name, ledger_type, is_active FROM acct.ledgers
        WHERE company_id=$1 AND ledger_id = ANY($2::uuid[])`, [cid, uniq])).rows;
    return new Map(rows.map((r) => [r.ledger_id, r]));
  }

  async function loadVoucher(c, id, lock = false) {
    const cid = await companyId(c);
    const v = (await c.query(
      `SELECT * FROM acct.vouchers WHERE voucher_id=$1 AND company_id=$2 ${lock ? 'FOR UPDATE' : ''}`, [id, cid])).rows[0];
    if (!v) throw new AccountingError('Voucher not found', 'ACCT_NOT_FOUND');
    return v;
  }

  async function loadLines(c, id) {
    return (await c.query(
      `SELECT line_no, ledger_id, dr_amount, cr_amount, cost_centre_id, narration
         FROM acct.voucher_lines WHERE voucher_id=$1 ORDER BY line_no`, [id])).rows
      .map((l) => ({ ...l, dr: R.toPaise(l.dr_amount) || 0, cr: R.toPaise(l.cr_amount) || 0, _row: l.line_no }));
  }

  async function writeLines(c, voucherId, lines) {
    await c.query(`DELETE FROM acct.voucher_lines WHERE voucher_id=$1`, [voucherId]);
    for (const l of lines) {
      await c.query(
        `INSERT INTO acct.voucher_lines (voucher_id, line_no, ledger_id, dr_amount, cr_amount, cost_centre_id, narration)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [voucherId, l.line_no, l.ledger_id, R.fromPaise(l.dr), R.fromPaise(l.cr), l.cost_centre_id, l.narration]);
    }
  }

  // A draft line must at least be well-formed (the DB enforces one-sided, non-negative).
  function assertDraftLines(lines) {
    for (const l of lines) {
      if (!l.ledger_id) throw new AccountingError(`Line ${l._row}: select an account`, 'ACCT_LINES');
      if ((l.dr > 0) === (l.cr > 0)) throw new AccountingError(`Line ${l._row}: enter either a debit or a credit amount`, 'ACCT_LINES');
      if (l.dr < 0 || l.cr < 0) throw new AccountingError(`Line ${l._row}: amounts cannot be negative`, 'ACCT_LINES');
    }
  }

  // ── vouchers ─────────────────────────────────────────────────────────────
  async function createDraft(body, user) {
    return tx(async (c) => {
      const cid = await companyId(c);
      if (body.idempotency_key) {
        const dup = (await c.query(`SELECT voucher_id FROM acct.vouchers WHERE company_id=$1 AND idempotency_key=$2`,
          [cid, String(body.idempotency_key)])).rows[0];
        if (dup) return { ...(await getVoucher(dup.voucher_id, c)), idempotent_replay: true };
      }
      const type = await voucherType(c, body.voucher_type);
      if (type.code === 'REVERSAL') throw new AccountingError('Reversal vouchers are created by reversing a posted voucher', 'ACCT_INVALID');
      const date = isoDate(body.voucher_date);
      const fy = await fyForDate(c, date);
      const lines = R.normaliseLines(body.lines || []);
      assertDraftLines(lines);
      const lm = await ledgerMap(c, cid, lines.map((l) => l.ledger_id).concat(body.party_ledger_id || []));
      for (const l of lines) if (!lm.has(l.ledger_id)) throw new AccountingError(`Line ${l._row}: account not found`, 'ACCT_LINES');
      if (body.party_ledger_id && !lm.has(body.party_ledger_id)) throw new AccountingError('Party account not found', 'ACCT_INVALID');

      const v = (await c.query(
        `INSERT INTO acct.vouchers (company_id, fy_id, voucher_type, voucher_date, party_ledger_id, reference_no,
           reference_date, narration, source_module, source_ref, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING voucher_id`,
        [cid, fy.fy_id, type.code, date, body.party_ledger_id || null, body.reference_no || null,
         body.reference_date ? isoDate(body.reference_date) : null, body.narration || null,
         body.source_module || null, body.source_ref || null,
         body.idempotency_key ? String(body.idempotency_key) : null, who(user)])).rows[0];
      await writeLines(c, v.voucher_id, lines);
      await audit(c, cid, 'voucher', v.voucher_id, 'CREATE', who(user), { type: type.code, date, lines: lines.length });
      return getVoucher(v.voucher_id, c);
    });
  }

  async function updateDraft(id, body, user) {
    return tx(async (c) => {
      const cid = await companyId(c);
      const v = await loadVoucher(c, id, true);
      if (!['DRAFT', 'VALIDATED', 'APPROVED'].includes(v.status)) {
        throw new AccountingError(`A ${v.status} voucher cannot be edited${v.status === 'POSTED' ? ' — reverse it and enter a corrected voucher' : ''}`, 'ACCT_STATE');
      }
      const date = body.voucher_date ? isoDate(body.voucher_date) : ymd(v.voucher_date);
      const fy = await fyForDate(c, date);
      // Any edit sends the voucher back to DRAFT — a validated/approved state
      // must describe the exact content that was checked.
      await c.query(
        `UPDATE acct.vouchers SET status='DRAFT', validated_by=NULL, validated_at=NULL, approved_by=NULL, approved_at=NULL,
           fy_id=$2, voucher_date=$3, party_ledger_id=$4, reference_no=$5, reference_date=$6, narration=$7, updated_at=now()
         WHERE voucher_id=$1`,
        [id, fy.fy_id, date,
         body.party_ledger_id !== undefined ? (body.party_ledger_id || null) : v.party_ledger_id,
         body.reference_no !== undefined ? (body.reference_no || null) : v.reference_no,
         body.reference_date !== undefined ? (body.reference_date ? isoDate(body.reference_date) : null) : v.reference_date,
         body.narration !== undefined ? (body.narration || null) : v.narration]);
      if (body.lines) {
        const lines = R.normaliseLines(body.lines);
        assertDraftLines(lines);
        const lm = await ledgerMap(c, cid, lines.map((l) => l.ledger_id));
        for (const l of lines) if (!lm.has(l.ledger_id)) throw new AccountingError(`Line ${l._row}: account not found`, 'ACCT_LINES');
        await writeLines(c, id, lines);
      }
      await audit(c, cid, 'voucher', id, 'UPDATE', who(user), { from_status: v.status });
      return getVoucher(id, c);
    });
  }

  // Full validation (structure + balance + accounts + period). Pure check; does not change state.
  async function check(c, v) {
    const cid = await companyId(c);
    const lines = await loadLines(c, v.voucher_id);
    const lm = await ledgerMap(c, cid, lines.map((l) => l.ledger_id));
    const res = R.validateLines(v.voucher_type, lines, lm);
    const date = ymd(v.voucher_date);
    try {
      const fy = await fyForDate(c, date);
      if (fy.fy_id !== v.fy_id) res.errors.push('Voucher date is outside its financial year.');
      if (fy.is_closed) res.errors.push(`Financial year ${fy.label} is closed.`);
      const p = await periodForDate(c, cid, fy.fy_id, date);
      if (p.status !== 'OPEN') res.errors.push(`The accounting period for ${date} is ${p.status}.`);
    } catch (e) { res.errors.push(e.message); }
    res.ok = res.errors.length === 0;
    return { ...res, lines, ledgers: lm };
  }

  async function validateVoucher(id, user) {
    return tx(async (c) => {
      const cid = await companyId(c);
      const v = await loadVoucher(c, id, true);
      if (!['DRAFT', 'VALIDATED'].includes(v.status)) throw new AccountingError(`A ${v.status} voucher cannot be validated`, 'ACCT_STATE');
      const res = await check(c, v);
      if (res.ok && v.status === 'DRAFT') {
        await c.query(`UPDATE acct.vouchers SET status='VALIDATED', validated_by=$2, validated_at=now(), updated_at=now() WHERE voucher_id=$1`, [id, who(user)]);
        await audit(c, cid, 'voucher', id, 'VALIDATE', who(user));
      }
      return { ok: res.ok, errors: res.errors, total_dr: R.fromPaise(res.total_dr), total_cr: R.fromPaise(res.total_cr), voucher: await getVoucher(id, c) };
    });
  }

  async function approveVoucher(id, user) {
    return tx(async (c) => {
      const cid = await companyId(c);
      const v = await loadVoucher(c, id, true);
      if (v.status !== 'VALIDATED') throw new AccountingError('Only a validated voucher can be approved', 'ACCT_STATE');
      if (MAKER_CHECKER && v.created_by && v.created_by === who(user)) {
        throw new AccountingError('Maker-checker: the person who entered a voucher cannot approve it', 'ACCT_FORBIDDEN');
      }
      const res = await check(c, v);
      if (!res.ok) throw new AccountingError('Voucher no longer validates: ' + res.errors.join(' '), 'ACCT_INVALID', res.errors);
      R.assertTransition(v.status, 'APPROVED');
      await c.query(`UPDATE acct.vouchers SET status='APPROVED', approved_by=$2, approved_at=now(), updated_at=now() WHERE voucher_id=$1`, [id, who(user)]);
      await audit(c, cid, 'voucher', id, 'APPROVE', who(user));
      return getVoucher(id, c);
    });
  }

  // The single posting path. Called with an open transaction client.
  async function postInTx(c, v, user) {
    const cid = await companyId(c);
    const type = await voucherType(c, v.voucher_type);
    if (type.requires_approval && v.status !== 'APPROVED') {
      throw new AccountingError(`${type.name} vouchers must be approved before posting`, 'ACCT_STATE');
    }
    R.assertTransition(v.status, 'POSTED');
    const res = await check(c, v);
    if (!res.ok) throw new AccountingError('Cannot post: ' + res.errors.join(' '), 'ACCT_INVALID', res.errors);

    const date = ymd(v.voucher_date);
    const period = await periodForDate(c, cid, v.fy_id, date, true); // FOR SHARE: blocks a concurrent close

    // Number: lock the series row so concurrent posts serialise here.
    await c.query(`INSERT INTO acct.voucher_series (company_id, fy_id, voucher_type) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [cid, v.fy_id, v.voucher_type]);
    const s = (await c.query(`SELECT next_no FROM acct.voucher_series WHERE company_id=$1 AND fy_id=$2 AND voucher_type=$3 FOR UPDATE`,
      [cid, v.fy_id, v.voucher_type])).rows[0];
    const fyLabel = (await c.query(`SELECT label FROM public.financial_years WHERE fy_id=$1`, [v.fy_id])).rows[0].label;
    const short = String(fyLabel).replace(/^20(\d\d)-(?:20)?(\d\d)$/, '$1-$2');
    const voucherNo = `${type.prefix}/${short}/${String(s.next_no).padStart(4, '0')}`;
    await c.query(`UPDATE acct.voucher_series SET next_no=next_no+1 WHERE company_id=$1 AND fy_id=$2 AND voucher_type=$3`,
      [cid, v.fy_id, v.voucher_type]);

    const je = (await c.query(
      `INSERT INTO acct.journal_entries (company_id, voucher_id, fy_id, period_id, posting_date, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING je_id`,
      [cid, v.voucher_id, v.fy_id, period.period_id, date, who(user)])).rows[0];
    for (const l of res.lines) {
      await c.query(
        `INSERT INTO acct.journal_lines (je_id, company_id, line_no, ledger_id, posting_date, dr_amount, cr_amount, cost_centre_id, narration)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [je.je_id, cid, l.line_no, l.ledger_id, date, R.fromPaise(l.dr), R.fromPaise(l.cr), l.cost_centre_id, l.narration]);
    }
    await c.query(
      `UPDATE acct.vouchers SET status='POSTED', voucher_no=$2, posted_by=$3, posted_at=now(), updated_at=now() WHERE voucher_id=$1`,
      [v.voucher_id, voucherNo, who(user)]);
    await audit(c, cid, 'voucher', v.voucher_id, 'POST', who(user),
      { voucher_no: voucherNo, je_id: je.je_id, total: R.fromPaise(res.total_dr) });
    return { je_id: je.je_id, voucher_no: voucherNo };
  }

  async function postVoucher(id, user) {
    return tx(async (c) => {
      const v = await loadVoucher(c, id, true);
      if (v.status === 'POSTED' || v.status === 'REVERSED') {
        // Idempotent: posting an already-posted voucher returns what was posted.
        return { ...(await getVoucher(id, c)), idempotent_replay: true };
      }
      await postInTx(c, v, user);
      return getVoucher(id, c);
    });
  }

  // Corrections never edit history: a REVERSAL voucher with Dr/Cr swapped is
  // posted, and the original is marked REVERSED (pointing at its reversal).
  async function reverseVoucher(id, { date, narration } = {}, user) {
    return tx(async (c) => {
      const cid = await companyId(c);
      const v = await loadVoucher(c, id, true);
      if (v.status === 'REVERSED') throw new AccountingError(`Voucher ${v.voucher_no} is already reversed`, 'ACCT_STATE');
      if (v.status !== 'POSTED') throw new AccountingError('Only a posted voucher can be reversed', 'ACCT_STATE');
      if (v.voucher_type === 'REVERSAL') throw new AccountingError('A reversal cannot itself be reversed — enter a fresh voucher', 'ACCT_STATE');
      const rdate = date ? isoDate(date) : ymd(v.voucher_date);
      const fy = await fyForDate(c, rdate);
      const lines = R.reverseLines(await loadLines(c, id));
      const rv = (await c.query(
        `INSERT INTO acct.vouchers (company_id, fy_id, voucher_type, voucher_date, party_ledger_id, reference_no,
           narration, source_module, source_ref, reversal_of, created_by)
         VALUES ($1,$2,'REVERSAL',$3,$4,$5,$6,'acct.reversal',$7,$8,$9) RETURNING *`,
        [cid, fy.fy_id, rdate, v.party_ledger_id, v.voucher_no,
         narration || `Reversal of ${v.voucher_no}`, v.voucher_no, id, who(user)])).rows[0];
      await writeLines(c, rv.voucher_id, lines);
      const posted = await postInTx(c, rv, user);
      await c.query(
        `UPDATE acct.vouchers SET status='REVERSED', reversed_by=$2, reversed_at=now(), reversed_by_voucher_id=$3, updated_at=now()
          WHERE voucher_id=$1`, [id, who(user), rv.voucher_id]);
      await audit(c, cid, 'voucher', id, 'REVERSE', who(user), { reversal_voucher: posted.voucher_no });
      return { original: await getVoucher(id, c), reversal: await getVoucher(rv.voucher_id, c) };
    });
  }

  async function cancelDraft(id, user) {
    return tx(async (c) => {
      const cid = await companyId(c);
      const v = await loadVoucher(c, id, true);
      R.assertTransition(v.status, 'CANCELLED');
      await c.query(`UPDATE acct.vouchers SET status='CANCELLED', cancelled_by=$2, cancelled_at=now(), updated_at=now() WHERE voucher_id=$1`, [id, who(user)]);
      await audit(c, cid, 'voucher', id, 'CANCEL', who(user));
      return getVoucher(id, c);
    });
  }

  async function getVoucher(id, c = pool) {
    const cid = await companyId(c);
    const v = (await c.query(
      `SELECT v.*, t.name AS voucher_type_name, pl.name AS party_name,
              rv.voucher_no AS reversed_by_voucher_no, ro.voucher_no AS reversal_of_no
         FROM acct.vouchers v
         JOIN acct.voucher_types t ON t.code=v.voucher_type
         LEFT JOIN acct.ledgers pl ON pl.ledger_id=v.party_ledger_id
         LEFT JOIN acct.vouchers rv ON rv.voucher_id=v.reversed_by_voucher_id
         LEFT JOIN acct.vouchers ro ON ro.voucher_id=v.reversal_of
        WHERE v.voucher_id=$1 AND v.company_id=$2`, [id, cid])).rows[0];
    if (!v) throw new AccountingError('Voucher not found', 'ACCT_NOT_FOUND');
    const lines = (await c.query(
      `SELECT vl.line_no, vl.ledger_id, l.name AS ledger_name, g.name AS group_name, vl.dr_amount, vl.cr_amount,
              vl.cost_centre_id, vl.narration
         FROM acct.voucher_lines vl JOIN acct.ledgers l ON l.ledger_id=vl.ledger_id
         JOIN acct.account_groups g ON g.group_id=l.group_id
        WHERE vl.voucher_id=$1 ORDER BY vl.line_no`, [id])).rows;
    const tot = lines.reduce((a, l) => [a[0] + (R.toPaise(l.dr_amount) || 0), a[1] + (R.toPaise(l.cr_amount) || 0)], [0, 0]);
    const je = (await c.query(`SELECT je_id, posting_date, posted_at, posted_by FROM acct.journal_entries WHERE voucher_id=$1`, [id])).rows[0] || null;
    const items = (await c.query(
      `SELECT line_no, item_id, item_name, hsn_code, quantity, uom, rate, discount_pct, taxable_value, gst_rate,
              cgst_amount, sgst_amount, igst_amount, line_total FROM acct.voucher_items WHERE voucher_id=$1 ORDER BY line_no`, [id])).rows;
    return { ...v, voucher_date: ymd(v.voucher_date), lines, items, total_dr: R.fromPaise(tot[0]), total_cr: R.fromPaise(tot[1]), journal: je };
  }

  async function listVouchers({ type, status, from, to, q, limit = 100, offset = 0 } = {}) {
    const cid = await companyId();
    const where = ['v.company_id=$1']; const p = [cid];
    if (type) { p.push(type); where.push(`v.voucher_type=$${p.length}`); }
    if (status) { p.push(status); where.push(`v.status=$${p.length}`); }
    if (from) { p.push(isoDate(from)); where.push(`v.voucher_date >= $${p.length}`); }
    if (to) { p.push(isoDate(to)); where.push(`v.voucher_date <= $${p.length}`); }
    if (q) { p.push(`%${q}%`); where.push(`(v.voucher_no ILIKE $${p.length} OR v.narration ILIKE $${p.length} OR v.reference_no ILIKE $${p.length} OR pl.name ILIKE $${p.length})`); }
    p.push(Math.min(Number(limit) || 100, 500)); p.push(Math.max(Number(offset) || 0, 0));
    const rows = (await pool.query(
      `SELECT v.voucher_id, v.voucher_type, t.name AS voucher_type_name, v.voucher_no, v.voucher_date, v.status,
              pl.name AS party_name, v.narration, v.reference_no, v.created_by, v.posted_by,
              COALESCE((SELECT SUM(dr_amount) FROM acct.voucher_lines vl WHERE vl.voucher_id=v.voucher_id),0) AS amount
         FROM acct.vouchers v JOIN acct.voucher_types t ON t.code=v.voucher_type
         LEFT JOIN acct.ledgers pl ON pl.ledger_id=v.party_ledger_id
        WHERE ${where.join(' AND ')}
        ORDER BY v.voucher_date DESC, v.created_at DESC
        LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
    return rows.map((r) => ({ ...r, voucher_date: ymd(r.voucher_date) }));
  }

  // ── masters ──────────────────────────────────────────────────────────────
  async function listGroups() {
    const cid = await companyId();
    return (await pool.query(
      `SELECT g.group_id, g.code, g.name, g.parent_id, p.name AS parent_name, g.nature, g.report, g.sort_order, g.is_system, g.is_active,
              (SELECT COUNT(*)::int FROM acct.ledgers l WHERE l.group_id=g.group_id) AS ledger_count
         FROM acct.account_groups g LEFT JOIN acct.account_groups p ON p.group_id=g.parent_id
        WHERE g.company_id=$1 ORDER BY g.sort_order, g.name`, [cid])).rows;
  }

  async function createGroup({ name, parent_id, code }, user) {
    return tx(async (c) => {
      const cid = await companyId(c);
      if (!name || !String(name).trim()) throw new AccountingError('Group name is required', 'ACCT_INVALID');
      const parent = (await c.query(`SELECT * FROM acct.account_groups WHERE group_id=$1 AND company_id=$2`, [parent_id, cid])).rows[0];
      if (!parent) throw new AccountingError('Choose the parent group ("Under") — new groups sit under an existing group', 'ACCT_INVALID');
      const g = (await c.query(
        `INSERT INTO acct.account_groups (company_id, code, name, parent_id, nature, report, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [cid, code || ('G_' + String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 40)), String(name).trim(),
         parent.group_id, parent.nature, parent.report, parent.sort_order + 1])).rows[0];
      await audit(c, cid, 'group', g.group_id, 'CREATE', who(user), { name: g.name, under: parent.name });
      return g;
    });
  }

  async function listLedgers({ q, group_id, ledger_type, active } = {}) {
    const cid = await companyId();
    const where = ['l.company_id=$1']; const p = [cid];
    if (q) { p.push(`%${q}%`); where.push(`(l.name ILIKE $${p.length} OR l.code ILIKE $${p.length} OR l.gstin ILIKE $${p.length})`); }
    if (group_id) { p.push(group_id); where.push(`l.group_id=$${p.length}`); }
    if (ledger_type) { p.push(ledger_type); where.push(`l.ledger_type=$${p.length}`); }
    if (active === 'true' || active === true) where.push('l.is_active');
    return (await pool.query(
      `SELECT l.*, g.name AS group_name, g.nature, g.report
         FROM acct.ledgers l JOIN acct.account_groups g ON g.group_id=l.group_id
        WHERE ${where.join(' AND ')} ORDER BY l.name LIMIT 2000`, p)).rows;
  }

  async function saveLedger(id, body, user) {
    return tx(async (c) => {
      const cid = await companyId(c);
      if (!body.name || !String(body.name).trim()) throw new AccountingError('Account name is required', 'ACCT_INVALID');
      const g = (await c.query(`SELECT * FROM acct.account_groups WHERE group_id=$1 AND company_id=$2`, [body.group_id, cid])).rows[0];
      if (!g) throw new AccountingError('Choose the group the account is "Under"', 'ACCT_INVALID');
      const type = body.ledger_type || (['SUNDRY_DEBTORS', 'SUNDRY_CREDITORS'].includes(g.code) ? 'PARTY'
        : g.code === 'BANK_ACCOUNTS' || g.code === 'BANK_OD' ? 'BANK' : g.code === 'CASH_IN_HAND' ? 'CASH'
        : g.code === 'DUTIES_TAXES' ? 'TAX' : g.code === 'STOCK_IN_HAND' ? 'STOCK' : 'GENERAL');
      const vals = [String(body.name).trim(), body.code || null, g.group_id, type, body.partner_id || null,
        body.gstin ? String(body.gstin).trim().toUpperCase() : null,
        body.state_code || (body.gstin ? String(body.gstin).slice(0, 2) : null), body.address || null,
        body.credit_days != null && body.credit_days !== '' ? Number(body.credit_days) : null];
      let row;
      if (id) {
        const cur = (await c.query(`SELECT * FROM acct.ledgers WHERE ledger_id=$1 AND company_id=$2 FOR UPDATE`, [id, cid])).rows[0];
        if (!cur) throw new AccountingError('Account not found', 'ACCT_NOT_FOUND');
        if (cur.is_system && body.is_active === false) throw new AccountingError('System accounts cannot be deactivated', 'ACCT_FORBIDDEN');
        row = (await c.query(
          `UPDATE acct.ledgers SET name=$2, code=$3, group_id=$4, ledger_type=$5, partner_id=$6, gstin=$7, state_code=$8,
             address=$9, credit_days=$10, is_active=$11, updated_at=now() WHERE ledger_id=$1 RETURNING *`,
          [id, ...vals, body.is_active === undefined ? cur.is_active : !!body.is_active])).rows[0];
        await audit(c, cid, 'ledger', id, 'UPDATE', who(user), { name: row.name });
      } else {
        row = (await c.query(
          `INSERT INTO acct.ledgers (name, code, group_id, ledger_type, partner_id, gstin, state_code, address, credit_days, company_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [...vals, cid, who(user)])).rows[0];
        await audit(c, cid, 'ledger', row.ledger_id, 'CREATE', who(user), { name: row.name, group: g.name });
      }
      if (body.opening && body.opening.amount != null && body.opening.amount !== '') {
        await setOpeningInTx(c, cid, row.ledger_id, body.opening, user);
      }
      return row;
    });
  }

  async function setOpeningInTx(c, cid, ledgerId, { fy_id, amount, side }, user) {
    const fyId = fy_id || (await c.query(`SELECT fy_id FROM public.financial_years WHERE is_active ORDER BY start_date DESC LIMIT 1`)).rows[0]?.fy_id;
    if (!fyId) throw new AccountingError('No active financial year for the opening balance', 'ACCT_PERIOD');
    const fy = (await c.query(`SELECT is_closed, label FROM public.financial_years WHERE fy_id=$1`, [fyId])).rows[0];
    if (!fy) throw new AccountingError('Financial year not found', 'ACCT_NOT_FOUND');
    if (fy.is_closed) throw new AccountingError(`Financial year ${fy.label} is closed — its opening balances are frozen`, 'ACCT_PERIOD');
    const p = R.toPaise(amount) || 0;
    if (p < 0) throw new AccountingError('Opening amount cannot be negative — choose Dr or Cr', 'ACCT_INVALID');
    const s = String(side || 'Dr').toUpperCase();
    if (!['DR', 'CR'].includes(s)) throw new AccountingError('Opening side must be Dr or Cr', 'ACCT_INVALID');
    await c.query(
      `INSERT INTO acct.ledger_openings (company_id, fy_id, ledger_id, dr_amount, cr_amount, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (company_id, fy_id, ledger_id) DO UPDATE SET dr_amount=EXCLUDED.dr_amount, cr_amount=EXCLUDED.cr_amount,
         updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [cid, fyId, ledgerId, s === 'DR' ? R.fromPaise(p) : '0.00', s === 'CR' ? R.fromPaise(p) : '0.00', who(user)]);
    await audit(c, cid, 'ledger', ledgerId, 'OPENING', who(user), { fy_id: fyId, amount: R.fromPaise(p), side: s });
  }

  async function setOpening(ledgerId, body, user) {
    return tx(async (c) => {
      const cid = await companyId(c);
      const l = (await c.query(`SELECT 1 FROM acct.ledgers WHERE ledger_id=$1 AND company_id=$2`, [ledgerId, cid])).rows[0];
      if (!l) throw new AccountingError('Account not found', 'ACCT_NOT_FOUND');
      await setOpeningInTx(c, cid, ledgerId, body, user);
      return { ok: true };
    });
  }

  // ── periods ──────────────────────────────────────────────────────────────
  async function listPeriods(fyId) {
    const cid = await companyId();
    return (await pool.query(
      `SELECT p.*, f.label AS fy_label FROM acct.periods p JOIN public.financial_years f ON f.fy_id=p.fy_id
        WHERE p.company_id=$1 ${fyId ? 'AND p.fy_id=$2' : ''} ORDER BY p.start_date`, fyId ? [cid, fyId] : [cid])).rows
      .map((r) => ({ ...r, start_date: ymd(r.start_date), end_date: ymd(r.end_date) }));
  }

  async function setPeriodStatus(periodId, status, reason, user) {
    return tx(async (c) => {
      const cid = await companyId(c);
      if (!['OPEN', 'CLOSED', 'LOCKED'].includes(status)) throw new AccountingError('Status must be OPEN, CLOSED or LOCKED', 'ACCT_INVALID');
      const p = (await c.query(`SELECT * FROM acct.periods WHERE period_id=$1 AND company_id=$2 FOR UPDATE`, [periodId, cid])).rows[0];
      if (!p) throw new AccountingError('Period not found', 'ACCT_NOT_FOUND');
      if (status === 'OPEN' && p.status !== 'OPEN' && !(reason && String(reason).trim())) {
        throw new AccountingError('Reopening a period needs a reason (it is recorded in the audit trail)', 'ACCT_INVALID');
      }
      await c.query(`UPDATE acct.periods SET status=$2, changed_by=$3, changed_at=now() WHERE period_id=$1`, [periodId, status, who(user)]);
      await audit(c, cid, 'period', periodId, `SET_${status}`, who(user), { from: p.status, reason: reason || null });
      return { ...p, status };
    });
  }

  // ── reports (all derived from posted journal lines — nothing stored) ──────
  async function ledgerBalance(ledgerId, asOf) {
    const cid = await companyId();
    const date = isoDate(asOf || new Date());
    const fy = await fyForDate(pool, date);
    const r = (await pool.query(
      `SELECT COALESCE((SELECT dr_amount - cr_amount FROM acct.ledger_openings WHERE company_id=$1 AND fy_id=$2 AND ledger_id=$3),0)
            + COALESCE((SELECT SUM(dr_amount - cr_amount) FROM acct.journal_lines
                          WHERE company_id=$1 AND ledger_id=$3 AND posting_date BETWEEN $4 AND $5),0) AS bal`,
      [cid, fy.fy_id, ledgerId, ymd(fy.start_date), date])).rows[0];
    return R.sideOf(R.toPaise(r.bal) || 0);
  }

  // Read-only preview of the voucher number that WILL be assigned on posting
  // (Busy shows the next Vch No up front). Mirrors the format in postVoucher but
  // never consumes the series, so it is safe to call from the entry screen.
  async function nextVoucherNo(voucherType, asOf) {
    const cid = await companyId();
    const date = isoDate(asOf || new Date());
    const type = (await pool.query(`SELECT prefix FROM acct.voucher_types WHERE code=$1`, [voucherType])).rows[0];
    if (!type) throw new AccountingError(`Unknown voucher type ${voucherType}`, 'ACCT_INVALID');
    const fy = await fyForDate(pool, date);
    const s = (await pool.query(
      `SELECT next_no FROM acct.voucher_series WHERE company_id=$1 AND fy_id=$2 AND voucher_type=$3`,
      [cid, fy.fy_id, voucherType])).rows[0];
    const nextNo = s ? s.next_no : 1;
    const short = String(fy.label).replace(/^20(\d\d)-(?:20)?(\d\d)$/, '$1-$2');
    return { voucher_no: `${type.prefix}/${short}/${String(nextNo).padStart(4, '0')}`, next_no: nextNo, fy_label: fy.label };
  }

  async function trialBalance({ fy_id, as_of } = {}) {
    const cid = await companyId();
    const fy = fy_id
      ? (await pool.query(`SELECT * FROM public.financial_years WHERE fy_id=$1`, [fy_id])).rows[0]
      : await fyForDate(pool, isoDate(as_of || new Date()));
    if (!fy) throw new AccountingError('Financial year not found', 'ACCT_NOT_FOUND');
    const from = ymd(fy.start_date);
    const to = as_of ? isoDate(as_of) : ymd(fy.end_date);
    const rows = (await pool.query(
      `SELECT l.ledger_id, l.name, l.group_id, g.name AS group_name, g.nature, g.report,
              COALESCE(o.dr_amount,0) AS op_dr, COALESCE(o.cr_amount,0) AS op_cr,
              COALESCE(m.dr,0) AS dr, COALESCE(m.cr,0) AS cr
         FROM acct.ledgers l
         JOIN acct.account_groups g ON g.group_id=l.group_id
         LEFT JOIN acct.ledger_openings o ON o.ledger_id=l.ledger_id AND o.fy_id=$2 AND o.company_id=$1
         LEFT JOIN (SELECT ledger_id, SUM(dr_amount) dr, SUM(cr_amount) cr FROM acct.journal_lines
                     WHERE company_id=$1 AND posting_date BETWEEN $3 AND $4 GROUP BY ledger_id) m ON m.ledger_id=l.ledger_id
        WHERE l.company_id=$1`, [cid, fy.fy_id, from, to])).rows;
    let T = { op_dr: 0, op_cr: 0, dr: 0, cr: 0, cl_dr: 0, cl_cr: 0 };
    const ledgers = [];
    for (const r of rows) {
      const op = (R.toPaise(r.op_dr) || 0) - (R.toPaise(r.op_cr) || 0);
      const dr = R.toPaise(r.dr) || 0, cr = R.toPaise(r.cr) || 0;
      if (op === 0 && dr === 0 && cr === 0) continue;
      const cl = op + dr - cr;
      T.op_dr += Math.max(op, 0); T.op_cr += Math.max(-op, 0); T.dr += dr; T.cr += cr;
      T.cl_dr += Math.max(cl, 0); T.cl_cr += Math.max(-cl, 0);
      ledgers.push({
        ledger_id: r.ledger_id, name: r.name, group_id: r.group_id, group_name: r.group_name, nature: r.nature, report: r.report,
        opening: R.sideOf(op), debit: R.fromPaise(dr), credit: R.fromPaise(cr), closing: R.sideOf(cl),
        closing_dr: R.fromPaise(Math.max(cl, 0)), closing_cr: R.fromPaise(Math.max(-cl, 0)), _cl: cl,
      });
    }
    // Group roll-up (group -> its ledgers' closing, plus child groups).
    const groups = await listGroups();
    const byId = new Map(groups.map((g) => [g.group_id, { ...g, _cl: 0 }]));
    for (const l of ledgers) {
      let g = byId.get(l.group_id);
      while (g) { g._cl += l._cl; g = g.parent_id ? byId.get(g.parent_id) : null; }
    }
    const groupRows = [...byId.values()].filter((g) => g._cl !== 0).map((g) => ({
      group_id: g.group_id, name: g.name, parent_id: g.parent_id, nature: g.nature, report: g.report,
      closing: R.sideOf(g._cl), closing_dr: R.fromPaise(Math.max(g._cl, 0)), closing_cr: R.fromPaise(Math.max(-g._cl, 0)),
    }));
    ledgers.forEach((l) => delete l._cl);
    const openingDiff = T.op_dr - T.op_cr;
    return {
      fy: { fy_id: fy.fy_id, label: fy.label, from, to },
      ledgers: ledgers.sort((a, b) => a.group_name.localeCompare(b.group_name) || a.name.localeCompare(b.name)),
      groups: groupRows,
      totals: {
        opening_dr: R.fromPaise(T.op_dr), opening_cr: R.fromPaise(T.op_cr), debit: R.fromPaise(T.dr), credit: R.fromPaise(T.cr),
        closing_dr: R.fromPaise(T.cl_dr), closing_cr: R.fromPaise(T.cl_cr),
      },
      // Busy/Tally show this as "Difference in opening balances" — never hidden.
      opening_difference: R.sideOf(openingDiff),
      balanced: T.dr === T.cr && T.cl_dr - T.cl_cr === openingDiff,
    };
  }

  // Shared: signed closing (Dr positive, paise) per ledger for a FY up to a date,
  // tagged with its group's nature/report and its TOP-LEVEL group.
  async function statementClosings(fyId, from, to) {
    const cid = await companyId();
    const groups = await listGroups();
    const byId = new Map(groups.map((g) => [g.group_id, g]));
    const topOf = (gid) => { let g = byId.get(gid); while (g && g.parent_id) g = byId.get(g.parent_id); return g; };
    const rows = (await pool.query(
      `SELECT l.ledger_id, l.name, l.group_id,
              COALESCE(o.dr_amount,0)-COALESCE(o.cr_amount,0) AS op,
              COALESCE(m.dr,0)-COALESCE(m.cr,0) AS mv
         FROM acct.ledgers l
         LEFT JOIN acct.ledger_openings o ON o.ledger_id=l.ledger_id AND o.fy_id=$2 AND o.company_id=$1
         LEFT JOIN (SELECT ledger_id, SUM(dr_amount) dr, SUM(cr_amount) cr FROM acct.journal_lines
                     WHERE company_id=$1 AND posting_date BETWEEN $3 AND $4 GROUP BY ledger_id) m ON m.ledger_id=l.ledger_id
        WHERE l.company_id=$1`, [cid, fyId, from, to])).rows;
    return rows.map((r) => {
      const cl = (R.toPaise(r.op) || 0) + (R.toPaise(r.mv) || 0);
      const top = topOf(r.group_id) || {};
      const g = byId.get(r.group_id) || {};
      return { ledger_id: r.ledger_id, name: r.name, cl, nature: g.nature, report: g.report, top_id: top.group_id, top_name: top.name, top_sort: top.sort_order };
    }).filter((x) => x.cl !== 0);
  }

  function groupByTop(list) {
    const m = new Map();
    for (const x of list) {
      if (!m.has(x.top_id)) m.set(x.top_id, { group_id: x.top_id, name: x.top_name, sort: x.top_sort, amount: 0, ledgers: [] });
      const g = m.get(x.top_id); g.amount += x.cl; g.ledgers.push({ ledger_id: x.ledger_id, name: x.name, amount: x.cl });
    }
    return [...m.values()].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  }

  async function periodFor({ fy_id, as_of }) {
    const fy = fy_id ? (await pool.query(`SELECT * FROM public.financial_years WHERE fy_id=$1`, [fy_id])).rows[0] : await fyForDate(pool, isoDate(as_of || new Date()));
    if (!fy) throw new AccountingError('Financial year not found', 'ACCT_NOT_FOUND');
    return { fy, from: ymd(fy.start_date), to: as_of ? isoDate(as_of) : ymd(fy.end_date) };
  }

  // Profit & Loss — income groups vs expense groups; closing Cr is income, Dr is expense.
  async function profitAndLoss(opts = {}) {
    const { fy, from, to } = await periodFor(opts);
    const cl = await statementClosings(fy.fy_id, from, to);
    const income = groupByTop(cl.filter((x) => x.report === 'PL' && x.nature === 'INCOME')).map((g) => ({ ...g, amount: -g.amount, ledgers: g.ledgers.map((l) => ({ ...l, amount: -l.amount })) }));
    const expense = groupByTop(cl.filter((x) => x.report === 'PL' && x.nature === 'EXPENSE'));
    const totInc = income.reduce((s, g) => s + g.amount, 0);
    const totExp = expense.reduce((s, g) => s + g.amount, 0);
    const net = totInc - totExp; // >0 profit
    return {
      fy: { fy_id: fy.fy_id, label: fy.label, from, to },
      income, expense,
      total_income: R.fromPaise(totInc), total_expense: R.fromPaise(totExp),
      net_profit: R.fromPaise(Math.abs(net)), is_profit: net >= 0,
    };
  }

  // Balance Sheet — assets vs liabilities + the period's net profit carried to capital.
  async function balanceSheet(opts = {}) {
    const { fy, from, to } = await periodFor(opts);
    const cl = await statementClosings(fy.fy_id, from, to);
    const assets = groupByTop(cl.filter((x) => x.report === 'BS' && x.nature === 'ASSET'));
    const liabilities = groupByTop(cl.filter((x) => x.report === 'BS' && x.nature === 'LIABILITY')).map((g) => ({ ...g, amount: -g.amount, ledgers: g.ledgers.map((l) => ({ ...l, amount: -l.amount })) }));
    const pl = await profitAndLoss(opts);
    const net = (R.toPaise(pl.net_profit) || 0) * (pl.is_profit ? 1 : -1);
    const totAssets = assets.reduce((s, g) => s + g.amount, 0);
    const totLiab = liabilities.reduce((s, g) => s + g.amount, 0);
    return {
      fy: { fy_id: fy.fy_id, label: fy.label, from, to },
      assets, liabilities,
      net_profit: R.fromPaise(Math.abs(net)), is_profit: net >= 0,
      total_assets: R.fromPaise(totAssets),
      total_liabilities: R.fromPaise(totLiab + net),  // net profit sits on the liability (capital) side
      balanced: totAssets === totLiab + net,
    };
  }

  // Cash & Bank book — the cash/bank ledgers with their balances. Detail is the
  // normal ledger statement (receipts Dr, payments Cr, running balance).
  async function cashBankBook({ as_of } = {}) {
    const cid = await companyId();
    const date = isoDate(as_of || new Date());
    const fy = await fyForDate(pool, date);
    const leds = (await pool.query(
      `SELECT l.ledger_id, l.name, l.ledger_type, g.name AS group_name
         FROM acct.ledgers l JOIN acct.account_groups g ON g.group_id=l.group_id
        WHERE l.company_id=$1 AND l.ledger_type IN ('CASH','BANK') ORDER BY l.ledger_type, l.name`, [cid])).rows;
    let totCash = 0, totBank = 0;
    const out = [];
    for (const l of leds) {
      const r = (await pool.query(
        `SELECT COALESCE((SELECT dr_amount-cr_amount FROM acct.ledger_openings WHERE company_id=$1 AND fy_id=$2 AND ledger_id=$3),0)
              + COALESCE((SELECT SUM(dr_amount-cr_amount) FROM acct.journal_lines WHERE company_id=$1 AND ledger_id=$3 AND posting_date<=$4),0) AS bal`,
        [cid, fy.fy_id, l.ledger_id, date])).rows[0];
      const bal = R.toPaise(r.bal) || 0;
      if (l.ledger_type === 'CASH') totCash += bal; else totBank += bal;
      out.push({ ledger_id: l.ledger_id, name: l.name, kind: l.ledger_type, group_name: l.group_name, balance: R.sideOf(bal) });
    }
    return { as_of: date, ledgers: out, total_cash: R.sideOf(totCash), total_bank: R.sideOf(totBank), total: R.sideOf(totCash + totBank) };
  }

  // Receivables / payables ageing — FIFO from posted journal lines (no bill-wise
  // allocation yet, so oldest unmatched invoice first), reconciled to the control
  // account (Sundry Debtors / Sundry Creditors group closing).
  async function ageing({ kind = 'RECEIVABLE', as_of, buckets = [30, 60, 90] } = {}) {
    const cid = await companyId();
    const to = isoDate(as_of || new Date());
    const fy = await fyForDate(pool, to);
    const toMs = new Date(to + 'T00:00:00Z').getTime();
    const groups = await listGroups();
    const byId = new Map(groups.map((g) => [g.group_id, g]));
    const targetCode = kind === 'PAYABLE' ? 'SUNDRY_CREDITORS' : 'SUNDRY_DEBTORS';
    const inGroup = (gid) => { let g = byId.get(gid); while (g) { if (g.code === targetCode) return true; g = g.parent_id ? byId.get(g.parent_id) : null; } return false; };
    const incIsDr = kind !== 'PAYABLE'; // a bill increases Dr for a debtor, Cr for a creditor
    const parties = (await pool.query(`SELECT ledger_id, name, group_id, credit_days FROM acct.ledgers WHERE company_id=$1 AND ledger_type='PARTY'`, [cid])).rows.filter((l) => inGroup(l.group_id));

    const T = { outstanding: 0, advance: 0, b: [0, 0, 0, 0] };
    const rows = [];
    for (const l of parties) {
      const op = (await pool.query(`SELECT COALESCE(dr_amount-cr_amount,0) b FROM acct.ledger_openings WHERE company_id=$1 AND fy_id=$2 AND ledger_id=$3`, [cid, fy.fy_id, l.ledger_id])).rows[0];
      const opDr = op ? (R.toPaise(op.b) || 0) : 0;
      const lines = (await pool.query(`SELECT posting_date, dr_amount, cr_amount FROM acct.journal_lines WHERE company_id=$1 AND ledger_id=$2 AND posting_date<=$3 ORDER BY posting_date, jl_id`, [cid, l.ledger_id, to])).rows;
      const q = []; let advance = 0;
      const push = (date, amt) => { if (amt > 0) q.push({ date, amt }); };
      const consume = (amt) => { while (amt > 0 && q.length) { const f = q[0]; const t = Math.min(amt, f.amt); f.amt -= t; amt -= t; if (f.amt === 0) q.shift(); } if (amt > 0) advance += amt; };
      const openInc = incIsDr ? opDr : -opDr;
      if (openInc > 0) push(ymd(fy.start_date), openInc); else if (openInc < 0) consume(-openInc);
      for (const ln of lines) {
        const dr = R.toPaise(ln.dr_amount) || 0, cr = R.toPaise(ln.cr_amount) || 0;
        const inc = incIsDr ? dr - cr : cr - dr;
        if (inc > 0) push(ymd(ln.posting_date), inc); else if (inc < 0) consume(-inc);
      }
      let out = 0; const b = [0, 0, 0, 0];
      for (const bill of q) {
        out += bill.amt;
        const age = Math.floor((toMs - new Date(bill.date + 'T00:00:00Z').getTime()) / 864e5);
        const bi = age <= buckets[0] ? 0 : age <= buckets[1] ? 1 : age <= buckets[2] ? 2 : 3;
        b[bi] += bill.amt;
      }
      if (out > 0 || advance > 0) {
        const oldest = q.length ? Math.floor((toMs - new Date(q[0].date + 'T00:00:00Z').getTime()) / 864e5) : 0;
        rows.push({ ledger_id: l.ledger_id, name: l.name, outstanding: R.fromPaise(out), advance: R.fromPaise(advance),
          current: R.fromPaise(b[0]), d31_60: R.fromPaise(b[1]), d61_90: R.fromPaise(b[2]), d90_plus: R.fromPaise(b[3]),
          oldest_days: oldest, overdue: l.credit_days ? Math.max(0, oldest - l.credit_days) : null });
        T.outstanding += out; T.advance += advance; b.forEach((x, i) => (T.b[i] += x));
      }
    }
    // Control-account reconciliation: the net closing of every party ledger
    // under the control group (Sundry Debtors / Creditors) must equal the net
    // outstanding we aged (outstanding − advance).
    const partyIds = new Set(parties.map((p) => p.ledger_id));
    const cl = await statementClosings(fy.fy_id, ymd(fy.start_date), to);
    const ctrlPaise = cl.filter((x) => partyIds.has(x.ledger_id)).reduce((s, x) => s + x.cl, 0); // dr-positive
    const ctrlNet = incIsDr ? ctrlPaise : -ctrlPaise; // net receivable (dr) or payable (cr) as a positive number
    return {
      kind, as_of: to, buckets: [`0-${buckets[0]}`, `${buckets[0] + 1}-${buckets[1]}`, `${buckets[1] + 1}-${buckets[2]}`, `${buckets[2]}+`],
      rows: rows.sort((a, b2) => b2.oldest_days - a.oldest_days),
      totals: { outstanding: R.fromPaise(T.outstanding), advance: R.fromPaise(T.advance),
        current: R.fromPaise(T.b[0]), d31_60: R.fromPaise(T.b[1]), d61_90: R.fromPaise(T.b[2]), d90_plus: R.fromPaise(T.b[3]) },
      control_account: targetCode, control_balance: R.fromPaise(ctrlNet),
      reconciled: (T.outstanding - T.advance) === ctrlNet,
    };
  }

  async function ledgerStatement({ ledger_id, from, to }) {
    const cid = await companyId();
    if (!ledger_id) throw new AccountingError('Choose an account', 'ACCT_INVALID');
    const led = (await pool.query(
      `SELECT l.*, g.name AS group_name FROM acct.ledgers l JOIN acct.account_groups g ON g.group_id=l.group_id
        WHERE l.ledger_id=$1 AND l.company_id=$2`, [ledger_id, cid])).rows[0];
    if (!led) throw new AccountingError('Account not found', 'ACCT_NOT_FOUND');
    const toD = isoDate(to || new Date());
    const fy = await fyForDate(pool, toD);
    const fromD = from ? isoDate(from) : ymd(fy.start_date);
    if (fromD < ymd(fy.start_date)) throw new AccountingError('The statement range must lie within one financial year', 'ACCT_INVALID');
    const op = (await pool.query(
      `SELECT COALESCE((SELECT dr_amount - cr_amount FROM acct.ledger_openings WHERE company_id=$1 AND fy_id=$2 AND ledger_id=$3),0)
            + COALESCE((SELECT SUM(dr_amount - cr_amount) FROM acct.journal_lines
                          WHERE company_id=$1 AND ledger_id=$3 AND posting_date >= $4 AND posting_date < $5),0) AS bal`,
      [cid, fy.fy_id, ledger_id, ymd(fy.start_date), fromD])).rows[0];
    let run = R.toPaise(op.bal) || 0;
    const opening = R.sideOf(run);
    const lines = (await pool.query(
      `SELECT jl.posting_date, v.voucher_id, v.voucher_no, v.voucher_type, t.name AS voucher_type_name, v.narration,
              jl.dr_amount, jl.cr_amount, jl.narration AS line_narration,
              (SELECT string_agg(l2.name, ', ' ORDER BY j2.line_no) FROM acct.journal_lines j2
                 JOIN acct.ledgers l2 ON l2.ledger_id=j2.ledger_id
                WHERE j2.je_id=jl.je_id AND j2.ledger_id<>jl.ledger_id) AS particulars
         FROM acct.journal_lines jl
         JOIN acct.journal_entries je ON je.je_id=jl.je_id
         JOIN acct.vouchers v ON v.voucher_id=je.voucher_id
         JOIN acct.voucher_types t ON t.code=v.voucher_type
        WHERE jl.company_id=$1 AND jl.ledger_id=$2 AND jl.posting_date BETWEEN $3 AND $4
        ORDER BY jl.posting_date, je.posted_at, jl.line_no`, [cid, ledger_id, fromD, toD])).rows;
    let tdr = 0, tcr = 0;
    const out = lines.map((l) => {
      const dr = R.toPaise(l.dr_amount) || 0, cr = R.toPaise(l.cr_amount) || 0;
      tdr += dr; tcr += cr; run += dr - cr;
      return { date: ymd(l.posting_date), voucher_id: l.voucher_id, voucher_no: l.voucher_no, voucher_type: l.voucher_type_name,
        particulars: l.particulars, narration: l.line_narration || l.narration,
        debit: dr ? R.fromPaise(dr) : '', credit: cr ? R.fromPaise(cr) : '', balance: R.sideOf(run) };
    });
    return { ledger: { ledger_id: led.ledger_id, name: led.name, group_name: led.group_name }, from: fromD, to: toD,
      opening, lines: out, total_debit: R.fromPaise(tdr), total_credit: R.fromPaise(tcr), closing: R.sideOf(run) };
  }

  async function dayBook({ from, to, type } = {}) {
    const cid = await companyId();
    const toD = isoDate(to || new Date());
    const fromD = isoDate(from || toD);
    const p = [cid, fromD, toD];
    let tf = '';
    if (type) { p.push(type); tf = `AND v.voucher_type=$${p.length}`; }
    const rows = (await pool.query(
      `SELECT v.voucher_id, v.voucher_date, v.voucher_no, v.voucher_type, t.name AS voucher_type_name, v.status, v.narration,
              pl.name AS party_name,
              (SELECT SUM(dr_amount) FROM acct.journal_lines jl JOIN acct.journal_entries je ON je.je_id=jl.je_id
                WHERE je.voucher_id=v.voucher_id) AS amount,
              (SELECT string_agg(l.name || ' ' || CASE WHEN jl.dr_amount>0 THEN 'Dr' ELSE 'Cr' END, ' | ' ORDER BY jl.line_no)
                 FROM acct.journal_lines jl JOIN acct.journal_entries je ON je.je_id=jl.je_id
                 JOIN acct.ledgers l ON l.ledger_id=jl.ledger_id WHERE je.voucher_id=v.voucher_id) AS accounts
         FROM acct.vouchers v JOIN acct.voucher_types t ON t.code=v.voucher_type
         LEFT JOIN acct.ledgers pl ON pl.ledger_id=v.party_ledger_id
        WHERE v.company_id=$1 AND v.status IN ('POSTED','REVERSED') AND v.voucher_date BETWEEN $2 AND $3 ${tf}
        ORDER BY v.voucher_date, v.posted_at`, p)).rows;
    // Per-voucher Dr/Cr legs so the Day Book can show each voucher's To/By lines
    // (Busy expands every voucher into its debit and credit account lines).
    const legRows = (await pool.query(
      `SELECT je.voucher_id, jl.line_no, l.name AS ledger, jl.dr_amount, jl.cr_amount
         FROM acct.journal_lines jl
         JOIN acct.journal_entries je ON je.je_id=jl.je_id
         JOIN acct.vouchers v ON v.voucher_id=je.voucher_id
         JOIN acct.ledgers l ON l.ledger_id=jl.ledger_id
        WHERE jl.company_id=$1 AND v.voucher_date BETWEEN $2 AND $3 ${tf}
        ORDER BY je.voucher_id, jl.line_no`, p)).rows;
    const legsBy = new Map();
    for (const r of legRows) {
      const arr = legsBy.get(r.voucher_id) || [];
      arr.push({ ledger: r.ledger, dr: r.dr_amount, cr: r.cr_amount });
      legsBy.set(r.voucher_id, arr);
    }
    return { from: fromD, to: toD, vouchers: rows.map((r) => ({ ...r, voucher_date: ymd(r.voucher_date), legs: legsBy.get(r.voucher_id) || [] })) };
  }

  async function voucherTypes() {
    return (await pool.query(`SELECT * FROM acct.voucher_types WHERE is_active ORDER BY code`)).rows;
  }

  // Sales / Purchase register (Busy-style GST register): one row per posted invoice
  // with taxable value + CGST/SGST/IGST + total, summed from the document item lines.
  // kind 'SALES' covers the sale-side docs; 'PURCHASE' the purchase-side.
  async function salesPurchaseRegister({ kind = 'SALES', from, to } = {}) {
    const cid = await companyId();
    const toD = isoDate(to || new Date());
    const fromD = isoDate(from || `${toD.slice(0, 4)}-04-01`);
    const types = kind === 'PURCHASE'
      ? ['PURCHASE', 'PURCHASE_RETURN', 'DEBIT_NOTE']
      : ['SALES', 'SALES_RETURN', 'CREDIT_NOTE'];
    const rows = (await pool.query(
      `SELECT v.voucher_id, v.voucher_no, v.voucher_date, t.name AS voucher_type_name,
              pl.name AS party_name, pl.gstin AS party_gstin, v.reference_no,
              COALESCE(SUM(vi.taxable_value),0) AS taxable,
              COALESCE(SUM(vi.cgst_amount),0) AS cgst, COALESCE(SUM(vi.sgst_amount),0) AS sgst,
              COALESCE(SUM(vi.igst_amount),0) AS igst, COALESCE(SUM(vi.line_total),0) AS total
         FROM acct.vouchers v
         JOIN acct.voucher_types t ON t.code=v.voucher_type
         LEFT JOIN acct.ledgers pl ON pl.ledger_id=v.party_ledger_id
         LEFT JOIN acct.voucher_items vi ON vi.voucher_id=v.voucher_id
        WHERE v.company_id=$1 AND v.status='POSTED' AND v.voucher_type = ANY($2) AND v.voucher_date BETWEEN $3 AND $4
        GROUP BY v.voucher_id, v.voucher_no, v.voucher_date, t.name, pl.name, pl.gstin, v.reference_no
        ORDER BY v.voucher_date, v.voucher_no`, [cid, types, fromD, toD])).rows;
    const T = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    for (const r of rows) {
      for (const k of Object.keys(T)) T[k] += R.toPaise(r[k]) || 0;
      r.voucher_date = ymd(r.voucher_date);
    }
    return { kind, from: fromD, to: toD, rows,
      totals: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, R.fromPaise(v)])) };
  }

  async function auditTrail({ entity, entity_id, action, limit = 200 } = {}) {
    const cid = await companyId();
    const p = [cid]; const w = ['company_id=$1'];
    if (entity) { p.push(entity); w.push(`entity=$${p.length}`); }
    if (entity_id) { p.push(String(entity_id)); w.push(`entity_id=$${p.length}`); }
    if (action) { p.push(String(action).toUpperCase()); w.push(`upper(action)=$${p.length}`); }
    p.push(Math.min(Number(limit) || 200, 1000));
    return (await pool.query(`SELECT * FROM acct.audit_log WHERE ${w.join(' AND ')} ORDER BY audit_id DESC LIMIT $${p.length}`, p)).rows;
  }

  async function company() {
    const cid = await companyId();
    const co = (await pool.query(`SELECT * FROM acct.companies WHERE company_id=$1`, [cid])).rows[0];
    const fys = (await pool.query(`SELECT fy_id, label, start_date, end_date, is_active, is_closed FROM public.financial_years ORDER BY start_date`)).rows
      .map((f) => ({ ...f, start_date: ymd(f.start_date), end_date: ymd(f.end_date) }));
    return { ...co, financial_years: fys };
  }

  return {
    companyId, company, voucherTypes,
    createDraft, updateDraft, validateVoucher, approveVoucher, postVoucher, reverseVoucher, cancelDraft,
    getVoucher, listVouchers,
    listGroups, createGroup, listLedgers, saveLedger, setOpening,
    listPeriods, setPeriodStatus,
    ledgerBalance, nextVoucherNo, trialBalance, profitAndLoss, balanceSheet, ledgerStatement, dayBook, salesPurchaseRegister, auditTrail,
    cashBankBook, ageing,
    _resetCache: () => { _company = null; },
  };
};
