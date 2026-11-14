// Shade swatches — the colour master behind branded shade cards. CRUD only.
// Mounted at /api/shade-swatches. Read: OPERATOR+. Write: SUPERVISOR+.
const express = require('express');

const HEX = /^#[0-9a-fA-F]{6}$/;

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  router.get('/', verifyToken, requireRole('OPERATOR'), async (req, res) => {
    try {
      const rows = (await pool.query(
        `SELECT swatch_id, shade_name, shade_code, hex, pantone, fabric_type, sort_order, is_active
           FROM shade_swatches
          WHERE ($1 = true OR is_active = true)
          ORDER BY sort_order, shade_name`, [req.query.all === '1'])).rows;
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    const { shade_name, shade_code, hex, pantone, fabric_type, sort_order } = req.body || {};
    const name = String(shade_name || '').trim();
    const h = String(hex || '').trim();
    if (!name) return res.status(400).json({ error: 'shade_name is required' });
    if (!HEX.test(h)) return res.status(400).json({ error: 'hex must be #RRGGBB' });
    try {
      const row = (await pool.query(
        `INSERT INTO shade_swatches (shade_name, shade_code, hex, pantone, fabric_type, sort_order, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, shade_code || null, h.toLowerCase(), pantone || null, fabric_type || null,
         Number(sort_order) || 0, req.user?.username || null])).rows[0];
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    const { shade_name, shade_code, hex, pantone, fabric_type, sort_order, is_active } = req.body || {};
    if (hex != null && !HEX.test(String(hex))) return res.status(400).json({ error: 'hex must be #RRGGBB' });
    try {
      const row = (await pool.query(
        `UPDATE shade_swatches SET
           shade_name  = COALESCE($2, shade_name),
           shade_code  = $3,
           hex         = COALESCE($4, hex),
           pantone     = $5,
           fabric_type = $6,
           sort_order  = COALESCE($7, sort_order),
           is_active   = COALESCE($8, is_active),
           updated_at  = NOW()
         WHERE swatch_id = $1 RETURNING *`,
        [req.params.id,
         shade_name ? String(shade_name).trim() : null,
         shade_code ?? null,
         hex ? String(hex).toLowerCase() : null,
         pantone ?? null, fabric_type ?? null,
         sort_order == null ? null : Number(sort_order),
         is_active == null ? null : !!is_active])).rows[0];
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
    try {
      const r = await pool.query(`DELETE FROM shade_swatches WHERE swatch_id=$1`, [req.params.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
