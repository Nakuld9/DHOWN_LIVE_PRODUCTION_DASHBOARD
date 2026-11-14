// Knitting-structures repository — machine "recipe" per fabric structure.
// Migrated from the standalone Knitting Structure Library into MES; tied to
// fabric_types (fabric_code) with gsm on the structure. JSONB columns:
// tags, yarns, feeder_data, cam_data (tracks×feeds matrix), needle_data, images.
module.exports = (pool) => ({
  findAll({ machine_type, fabric_code, favourite } = {}) {
    // Trashed structures never appear, whatever else is being filtered.
    const conds = ['ks.deleted_at IS NULL']; const vals = []; let p = 1;
    if (machine_type) { conds.push(`ks.machine_type = $${p++}`); vals.push(machine_type); }
    if (fabric_code)  { conds.push(`ks.fabric_code = $${p++}`);  vals.push(fabric_code); }
    if (favourite)    { conds.push(`ks.is_favourite = TRUE`); }
    const where = `WHERE ${conds.join(' AND ')}`;
    return pool.query(
      `SELECT ks.*, ft.name AS fabric_name
       FROM knitting_structures ks
       LEFT JOIN fabric_types ft ON ft.code = ks.fabric_code
       ${where} ORDER BY ks.is_favourite DESC, ks.updated_at DESC`, vals);
  },

  findById(id) {
    return pool.query(
      `SELECT ks.*, ft.name AS fabric_name FROM knitting_structures ks
       LEFT JOIN fabric_types ft ON ft.code = ks.fabric_code
       WHERE ks.id = $1 AND ks.deleted_at IS NULL`, [id]);
  },

  insert(id, b) {
    return pool.query(
      `INSERT INTO knitting_structures
        (id, structure_name, machine_type, fabric_code, gsm, cylinder_tracks, dial_tracks,
         feed_repeat, needle_repeat, category, tags, description, yarn_repeat_count, yarns,
         feeder_data, cam_data, needle_data, images, is_favourite)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [id, b.structure_name, b.machine_type, b.fabric_code || null, b.gsm ?? null,
       b.cylinder_tracks ?? null, b.dial_tracks ?? null, b.feed_repeat ?? null, b.needle_repeat ?? null,
       b.category || null, JSON.stringify(b.tags || []), b.description || null, b.yarn_repeat_count ?? null,
       JSON.stringify(b.yarns || []), JSON.stringify(b.feeder_data || []), JSON.stringify(b.cam_data || {}),
       JSON.stringify(b.needle_data || {}), JSON.stringify(b.images || []), !!b.is_favourite]);
  },

  update(id, b) {
    return pool.query(
      `UPDATE knitting_structures SET
        structure_name=$2, machine_type=$3, fabric_code=$4, gsm=$5, cylinder_tracks=$6, dial_tracks=$7,
        feed_repeat=$8, needle_repeat=$9, category=$10, tags=$11, description=$12, yarn_repeat_count=$13,
        yarns=$14, feeder_data=$15, cam_data=$16, needle_data=$17, images=$18, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id, b.structure_name, b.machine_type, b.fabric_code || null, b.gsm ?? null,
       b.cylinder_tracks ?? null, b.dial_tracks ?? null, b.feed_repeat ?? null, b.needle_repeat ?? null,
       b.category || null, JSON.stringify(b.tags || []), b.description || null, b.yarn_repeat_count ?? null,
       JSON.stringify(b.yarns || []), JSON.stringify(b.feeder_data || []), JSON.stringify(b.cam_data || {}),
       JSON.stringify(b.needle_data || {}), JSON.stringify(b.images || [])]);
  },

  setFavourite(id, fav) {
    return pool.query(`UPDATE knitting_structures SET is_favourite=$2, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, !!fav]);
  },

  // Soft delete — recoverable from Trash.
  remove(id) {
    return pool.query(
      `UPDATE knitting_structures SET deleted_at = NOW() WHERE id=$1 AND deleted_at IS NULL`, [id]);
  },
});
