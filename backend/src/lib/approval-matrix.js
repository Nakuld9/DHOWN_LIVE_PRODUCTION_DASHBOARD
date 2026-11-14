// Approval matrix — who has to sign off what, by document value.
//
// The bands were seeded from code and editable only by SQL, which meant the
// rule deciding whether a ₹9,00,000 order needs an admin lived somewhere nobody
// could see or change.
//
// The interesting part is not the CRUD. It is that a band set can be wrong in
// two quiet ways, and `requiredRole()` hides both:
//
//   - OVERLAP. Two bands match the same value. The lookup does
//     `ORDER BY min_value DESC LIMIT 1`, so it picks one and looks decisive.
//     A ₹5,00,000 order could need a supervisor or a super admin depending on
//     which row was written first.
//   - GAP. No band matches. The lookup falls through to the hardcoded defaults
//     in wa-approvals.js — so the screen shows one policy and the system
//     applies another.
//
// So every write is validated against the whole set for that document type, and
// the read reports coverage rather than just listing rows.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const up = (s) => String(s || '').trim().toUpperCase();

const DOC_TYPES = ['ORDER', 'QUOTE', 'CREDIT'];
const ROLES = ['SUPERVISOR', 'ADMIN', 'SUPER_ADMIN'];

module.exports = (pool) => {

  // Analyse one document type's bands: are they contiguous from zero, with no
  // overlap and no gap, ending in an open-ended band?
  function analyse(bands) {
    const active = bands.filter(b => b.is_active)
      .map(b => ({ ...b, min: Number(b.min_value), max: b.max_value === null ? null : Number(b.max_value) }))
      .sort((a, b) => a.min - b.min);

    const problems = [];
    if (!active.length) {
      problems.push('No active bands — approvals for this document type fall back to the built-in defaults, which are not shown here.');
      return { problems, covered: false };
    }

    if (active[0].min > 0) {
      problems.push(`Nothing covers values below ${active[0].min} — those fall back to the built-in defaults.`);
    }

    for (let i = 0; i < active.length; i++) {
      const b = active[i];
      if (b.max !== null && b.max <= b.min) {
        problems.push(`A band from ${b.min} to ${b.max} can never match — the top is not above the bottom.`);
      }
      const next = active[i + 1];
      if (!next) continue;
      if (b.max === null) {
        problems.push(`The open-ended band starting at ${b.min} is not the last one — bands above it can never be reached.`);
        continue;
      }
      if (next.min < b.max) {
        problems.push(`Bands overlap between ${next.min} and ${b.max} — two rules match, and which one wins is arbitrary.`);
      } else if (next.min > b.max) {
        problems.push(`Nothing covers ${b.max} to ${next.min} — values in that range fall back to the built-in defaults.`);
      }
    }

    const last = active[active.length - 1];
    if (last.max !== null) {
      problems.push(`Nothing covers values above ${last.max} — the highest band should be open-ended.`);
    }

    return { problems, covered: problems.length === 0 };
  }

  async function list() {
    const rows = (await pool.query(
      `SELECT * FROM approval_matrix ORDER BY doc_type, min_value`)).rows
      .map(b => ({ ...b, min_value: r2(b.min_value), max_value: b.max_value === null ? null : r2(b.max_value) }));

    const byType = {};
    for (const t of [...new Set([...DOC_TYPES, ...rows.map(r => r.doc_type)])]) {
      const bands = rows.filter(r => r.doc_type === t);
      byType[t] = { bands, ...analyse(bands) };
    }
    return { doc_types: Object.keys(byType), roles: ROLES, matrix: byType };
  }

  // What the live lookup would decide, so the screen can show the policy being
  // applied rather than the policy as written.
  async function preview(docType, value) {
    const v = Number(value) || 0;
    const r = await pool.query(
      `SELECT required_role, min_value, max_value FROM approval_matrix
        WHERE doc_type=$1 AND is_active=true
          AND $2 >= min_value AND (max_value IS NULL OR $2 < max_value)
        ORDER BY min_value DESC`, [up(docType), v]);
    return {
      doc_type: up(docType), value: v,
      matched: r.rows.length,
      required_role: r.rows.length ? r.rows[0].required_role : null,
      // More than one match is the overlap case made visible.
      ambiguous: r.rows.length > 1,
      falls_back: r.rows.length === 0,
      bands: r.rows,
    };
  }

  function validateBand({ doc_type, min_value, max_value, required_role }) {
    if (!DOC_TYPES.includes(up(doc_type))) {
      return `Document type must be one of ${DOC_TYPES.join(', ')}`;
    }
    if (!ROLES.includes(up(required_role))) {
      return `Approver must be one of ${ROLES.join(', ')}`;
    }
    const min = Number(min_value);
    if (!Number.isFinite(min) || min < 0) return 'The band must start at zero or above';
    if (max_value !== null && max_value !== undefined && max_value !== '') {
      const max = Number(max_value);
      if (!Number.isFinite(max)) return 'The top of the band must be a number, or blank for open-ended';
      if (max <= min) return 'The top of the band must be above the bottom';
    }
    return null;
  }

  // Refuse a write that would overlap an existing active band. A gap is a
  // warning — you may legitimately build the set one band at a time — but an
  // overlap makes the policy ambiguous the moment it is saved.
  async function overlapsExisting(docType, min, max, excludeId = null) {
    const r = await pool.query(
      `SELECT rule_id, min_value, max_value FROM approval_matrix
        WHERE doc_type=$1 AND is_active=true AND ($2::bigint IS NULL OR rule_id <> $2::bigint)`,
      [up(docType), excludeId]);
    for (const b of r.rows) {
      const bMin = Number(b.min_value);
      const bMax = b.max_value === null ? Infinity : Number(b.max_value);
      const nMax = max === null ? Infinity : Number(max);
      if (min < bMax && bMin < nMax) {
        return `That overlaps the existing band ${bMin} to ${b.max_value === null ? 'open' : bMax}`;
      }
    }
    return null;
  }

  async function create(body, { by } = {}) {
    const bad = validateBand(body);
    if (bad) return { error: bad, code: 400 };
    const min = Number(body.min_value);
    const max = (body.max_value === null || body.max_value === undefined || body.max_value === '')
      ? null : Number(body.max_value);

    const clash = await overlapsExisting(body.doc_type, min, max);
    if (clash) return { error: clash, code: 409 };

    const r = await pool.query(
      `INSERT INTO approval_matrix (doc_type, min_value, max_value, required_role, is_active)
       VALUES ($1,$2,$3,$4,true) RETURNING *`,
      [up(body.doc_type), min, max, up(body.required_role)]);
    return { ok: true, band: r.rows[0], by: by || null };
  }

  async function update(id, body, { by } = {}) {
    const cur = (await pool.query(`SELECT * FROM approval_matrix WHERE rule_id=$1`, [id])).rows[0];
    if (!cur) return { error: 'Band not found', code: 404 };

    const merged = {
      doc_type: body.doc_type ?? cur.doc_type,
      min_value: body.min_value ?? cur.min_value,
      max_value: body.max_value === undefined ? cur.max_value : body.max_value,
      required_role: body.required_role ?? cur.required_role,
    };
    const bad = validateBand(merged);
    if (bad) return { error: bad, code: 400 };

    const min = Number(merged.min_value);
    const max = (merged.max_value === null || merged.max_value === '') ? null : Number(merged.max_value);
    const active = body.is_active === undefined ? cur.is_active : !!body.is_active;

    if (active) {
      const clash = await overlapsExisting(merged.doc_type, min, max, id);
      if (clash) return { error: clash, code: 409 };
    }

    const r = await pool.query(
      `UPDATE approval_matrix
          SET doc_type=$2, min_value=$3, max_value=$4, required_role=$5, is_active=$6, updated_at=NOW()
        WHERE rule_id=$1 RETURNING *`,
      [id, up(merged.doc_type), min, max, up(merged.required_role), active]);
    return { ok: true, band: r.rows[0], by: by || null };
  }

  // Deactivate rather than delete: an approval that was granted last month was
  // granted under the band as it stood then, and deleting the row makes that
  // decision unexplainable.
  async function deactivate(id, { by } = {}) {
    const r = await pool.query(
      `UPDATE approval_matrix SET is_active=false, updated_at=NOW()
        WHERE rule_id=$1 AND is_active=true RETURNING *`, [id]);
    if (!r.rows.length) return { error: 'Band not found, or already inactive', code: 404 };
    return { ok: true, band: r.rows[0], by: by || null };
  }

  return { list, preview, create, update, deactivate, analyse, DOC_TYPES, ROLES };
};
