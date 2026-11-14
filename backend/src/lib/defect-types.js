// Defect-type master management.
//
// Inspections store the defect name as text (not a foreign key), so a defect type
// is never hard-deleted — that would orphan nothing but would erase a label from
// history. Instead it is DEACTIVATED: hidden from new inspections, still readable
// on old ones. Names are unique (case-insensitively) so the same defect can't be
// entered twice.

module.exports = (pool) => {
  // Management list — includes inactive, ordered for display.
  async function listAll() {
    const r = await pool.query(
      `SELECT id, name, description, is_active, sort_order, updated_at
         FROM defect_types ORDER BY is_active DESC, sort_order NULLS LAST, name`);
    return r.rows;
  }

  async function create({ name, description, sort_order }) {
    const nm = String(name || '').trim();
    if (!nm) return { code: 400, error: 'name is required' };
    const dup = await pool.query(`SELECT 1 FROM defect_types WHERE LOWER(name) = LOWER($1)`, [nm]);
    if (dup.rowCount) return { code: 409, error: `Defect type "${nm}" already exists` };
    const nextSort = sort_order != null ? Number(sort_order)
      : (await pool.query(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM defect_types`)).rows[0].n;
    const row = (await pool.query(
      `INSERT INTO defect_types (name, description, sort_order, is_active)
       VALUES ($1,$2,$3,TRUE) RETURNING *`, [nm, description || null, nextSort])).rows[0];
    return { ok: true, defect: row };
  }

  async function update(id, { name, description, sort_order }) {
    const cur = (await pool.query(`SELECT * FROM defect_types WHERE id=$1`, [id])).rows[0];
    if (!cur) return { code: 404, error: 'Defect type not found' };
    const nm = name != null ? String(name).trim() : cur.name;
    if (!nm) return { code: 400, error: 'name cannot be empty' };
    if (nm.toLowerCase() !== cur.name.toLowerCase()) {
      const dup = await pool.query(`SELECT 1 FROM defect_types WHERE LOWER(name)=LOWER($1) AND id<>$2`, [nm, id]);
      if (dup.rowCount) return { code: 409, error: `Defect type "${nm}" already exists` };
    }
    const row = (await pool.query(
      `UPDATE defect_types SET name=$2, description=$3, sort_order=$4, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
      [id, nm, description !== undefined ? description : cur.description,
       sort_order != null ? Number(sort_order) : cur.sort_order])).rows[0];
    return { ok: true, defect: row };
  }

  async function setActive(id, active) {
    const row = (await pool.query(
      `UPDATE defect_types SET is_active=$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, !!active])).rows[0];
    if (!row) return { code: 404, error: 'Defect type not found' };
    return { ok: true, defect: row };
  }

  return { listAll, create, update, setActive };
};
