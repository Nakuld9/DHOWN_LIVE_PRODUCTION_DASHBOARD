// Credit limits and payment terms, in bulk.
//
// These live one-per-customer on the partner record, so setting them across a
// book of customers meant opening each one. In practice that means they do not
// get set at all — and a credit limit of zero is not "no credit allowed", it is
// "no limit recorded", which the credit gate treats as nothing to enforce.
//
// So this exists to make the state visible first and editable second. The list
// leads with who has no limit, because that is the population where the gate is
// silently doing nothing.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = (pool) => {

  async function list({ q = null, missing_only = false } = {}) {
    const rows = (await pool.query(
      `SELECT p.partner_id, p.partner_code, p.company_name,
              COALESCE(p.credit_limit,0) AS credit_limit,
              COALESCE(p.credit_days,0)  AS credit_days,
              p.payment_terms,
              COALESCE(o.outstanding,0)  AS outstanding,
              COALESCE(o.overdue,0)      AS overdue
         FROM partners p
         LEFT JOIN v_partner_outstanding o ON o.partner_id = p.partner_id
        WHERE ($1::text IS NULL OR p.company_name ILIKE '%'||$1||'%' OR p.partner_code ILIKE '%'||$1||'%')
        ORDER BY p.company_name`, [q])).rows;

    const shaped = rows.map(x => {
      const limit = r2(x.credit_limit);
      const out = r2(x.outstanding);
      return {
        partner_id: x.partner_id, partner_code: x.partner_code, company_name: x.company_name,
        credit_limit: limit, credit_days: Number(x.credit_days), payment_terms: x.payment_terms,
        outstanding: out, overdue: r2(x.overdue),
        // No limit recorded is a different state from a limit of zero, and the
        // difference matters: one means "unlimited in practice", the other
        // would mean "no credit at all".
        no_limit: limit <= 0,
        no_terms: !Number(x.credit_days),
        utilisation: limit > 0 ? Math.round((out / limit) * 100) : null,
        over_limit: limit > 0 && out > limit + 0.009,
      };
    });

    const filtered = missing_only ? shaped.filter(x => x.no_limit || x.no_terms) : shaped;

    return {
      customers: filtered,
      summary: {
        total: shaped.length,
        no_limit: shaped.filter(x => x.no_limit).length,
        no_terms: shaped.filter(x => x.no_terms).length,
        over_limit: shaped.filter(x => x.over_limit).length,
        exposure: r2(shaped.reduce((s, x) => s + x.outstanding, 0)),
      },
    };
  }

  // Apply changes to many customers at once. Everything is validated before
  // anything is written — a half-applied bulk edit across a credit book is far
  // worse than a rejected one, because nobody can tell which half landed.
  async function bulkUpdate(changes, { by } = {}) {
    if (!Array.isArray(changes) || !changes.length) {
      return { error: 'No changes supplied', code: 400 };
    }
    if (changes.length > 500) {
      return { error: 'Too many rows in one go — split it into batches of 500', code: 400 };
    }

    const problems = [];
    for (const [i, c] of changes.entries()) {
      if (!c.partner_id) problems.push(`Row ${i + 1}: no customer`);
      if (c.credit_limit !== undefined && c.credit_limit !== null) {
        const v = Number(c.credit_limit);
        if (!Number.isFinite(v) || v < 0) problems.push(`Row ${i + 1}: credit limit must be zero or more`);
      }
      if (c.credit_days !== undefined && c.credit_days !== null) {
        const v = Number(c.credit_days);
        if (!Number.isInteger(v) || v < 0 || v > 365) {
          problems.push(`Row ${i + 1}: credit days must be a whole number between 0 and 365`);
        }
      }
    }
    if (problems.length) return { error: problems.slice(0, 5).join('; '), code: 400, problems };

    const ids = changes.map(c => c.partner_id);
    const found = (await pool.query(
      `SELECT partner_id FROM partners WHERE partner_id = ANY($1)`, [ids])).rows.map(r => r.partner_id);
    const missing = ids.filter(id => !found.includes(id));
    if (missing.length) {
      return { error: `Unknown customer id(s): ${missing.slice(0, 5).join(', ')}`, code: 404 };
    }

    const client = await pool.connect();
    const applied = [];
    try {
      await client.query('BEGIN');
      for (const c of changes) {
        // COALESCE on the parameter, not the column: an omitted field leaves
        // the existing value alone rather than zeroing it.
        const r = await client.query(
          `UPDATE partners
              SET credit_limit  = COALESCE($2, credit_limit),
                  credit_days   = COALESCE($3, credit_days),
                  payment_terms = COALESCE($4, payment_terms),
                  updated_at    = NOW()
            WHERE partner_id = $1
            RETURNING partner_id, company_name, credit_limit, credit_days, payment_terms`,
          [c.partner_id,
           c.credit_limit === undefined || c.credit_limit === null ? null : Number(c.credit_limit),
           c.credit_days === undefined || c.credit_days === null ? null : Number(c.credit_days),
           c.payment_terms === undefined ? null : (String(c.payment_terms).trim() || null)]);
        applied.push(r.rows[0]);
      }

      // A bulk change to who can owe what should be answerable later.
      await client.query(
        `INSERT INTO audit_logs (username, action, module, new_value)
         VALUES ($1, $2, 'CREDIT_TERMS', $3)`,
        [by || 'unknown', `Bulk credit terms update: ${applied.length} customer(s)`,
         JSON.stringify(changes).slice(0, 4000)]).catch(() => { /* never fail the edit for a log row */ });

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return { ok: true, updated: applied.length, customers: applied };
  }

  return { list, bulkUpdate };
};
