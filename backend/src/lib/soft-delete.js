// Soft delete, restore, and the trash that makes it useful.
//
// A delete that cannot be undone is a delete that gets feared, worked around,
// or discovered too late. On 2026-08-06 a stray request removed the admin user
// from this database and the only route back was an hourly dump that happened
// to exist. That is not a recovery procedure, it is luck.
//
// Scope is deliberate and narrow — see SOFT_DELETE_TABLES in db/schema.js for
// what is covered and, more importantly, why the rest is not.

const { SOFT_DELETE_TABLES } = require('../db/schema');

// Table names are interpolated into SQL, so they may only ever come from this
// registry — never from a request. Everything else is parameterised.
const REGISTRY = new Map(SOFT_DELETE_TABLES.map(t => [t.table, t]));

module.exports = (pool) => {

  const spec = (table) => REGISTRY.get(String(table || '').toLowerCase()) || null;

  // Mark a row deleted. Returns notFound if it is missing OR already deleted —
  // deleting twice is not a silent success.
  async function remove(table, id, { by } = {}) {
    const s = spec(table);
    if (!s) return { error: 'That table does not support soft delete', code: 400 };

    const r = await pool.query(
      `UPDATE ${s.table} SET deleted_at = NOW(), deleted_by = $2
        WHERE ${s.pk}::text = $1::text AND deleted_at IS NULL
        RETURNING ${s.pk} AS id`,
      [String(id), by || null]);

    if (!r.rows.length) return { error: `${s.label} not found, or already deleted`, code: 404 };
    return { ok: true, table: s.table, id: r.rows[0].id };
  }

  async function restore(table, id, { by } = {}) {
    const s = spec(table);
    if (!s) return { error: 'That table does not support soft delete', code: 400 };

    try {
      const r = await pool.query(
        `UPDATE ${s.table} SET deleted_at = NULL, deleted_by = NULL
          WHERE ${s.pk}::text = $1::text AND deleted_at IS NOT NULL
          RETURNING ${s.pk} AS id`,
        [String(id)]);
      if (!r.rows.length) return { error: `${s.label} not found in trash`, code: 404 };
      return { ok: true, table: s.table, id: r.rows[0].id, restored_by: by || null };
    } catch (e) {
      // The partial unique indexes only cover live rows, so restoring can
      // collide with something created since. Saying so is far better than a
      // raw constraint error.
      if (e.code === '23505') {
        return {
          error: `Cannot restore: another ${s.label.toLowerCase()} with the same ${s.name} now exists. Rename or remove it first.`,
          code: 409,
        };
      }
      throw e;
    }
  }

  // What is in the trash, newest first, across every covered table.
  async function list({ limit = 200 } = {}) {
    const out = [];
    for (const s of REGISTRY.values()) {
      const r = await pool.query(
        `SELECT ${s.pk}::text AS id, ${s.name}::text AS name, deleted_at, deleted_by
           FROM ${s.table} WHERE deleted_at IS NOT NULL
          ORDER BY deleted_at DESC LIMIT $1`, [limit]);
      for (const row of r.rows) {
        out.push({ table: s.table, label: s.label, id: row.id, name: row.name,
                   deleted_at: row.deleted_at, deleted_by: row.deleted_by });
      }
    }
    out.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
    return out.slice(0, limit);
  }

  // Permanent removal, for when trash really should be emptied. Separate from
  // remove() on purpose: this is the irreversible one, and it should read as
  // irreversible at the call site.
  async function purge(table, id, { by } = {}) {
    const s = spec(table);
    if (!s) return { error: 'That table does not support soft delete', code: 400 };
    const r = await pool.query(
      `DELETE FROM ${s.table} WHERE ${s.pk}::text = $1::text AND deleted_at IS NOT NULL
        RETURNING ${s.pk} AS id`, [String(id)]);
    if (!r.rows.length) return { error: `${s.label} not found in trash`, code: 404 };
    return { ok: true, purged: s.table, id: r.rows[0].id, by: by || null };
  }

  return { remove, restore, list, purge, tables: [...REGISTRY.values()] };
};
