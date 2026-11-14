// ERP item-master routes — items + BOM, HSN, UOM, item categories, doc-series
// (layered extraction, ERP chunk a). Mounted at /api/erp (shares the prefix with the
// remaining inline ERP handlers until chunks b-d are migrated — subpaths are distinct,
// so both can be mounted/inline simultaneously).
// 14 handlers migrated VERBATIM from server.js (2026-07-10).
// Injected: pool, verifyToken, requireRole, numOrNull (shared server.js helper).
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole, numOrNull }) => {
  const router = express.Router();

router.get('/doc-series', requireRole('ADMIN'), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM doc_series ORDER BY series_code');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/doc-series/:code', requireRole('ADMIN'), async (req, res) => {
  const { prefix, zero_pad } = req.body;
  try {
    await pool.query(
      `UPDATE doc_series SET prefix=$1, zero_pad=$2, updated_at=NOW() WHERE series_code=$3`,
      [prefix, zero_pad, req.params.code]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/uom', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM uom WHERE is_active=TRUE ORDER BY code');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/hsn', async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q}%` : '%';
    const r = await pool.query(
      `SELECT * FROM hsn_codes WHERE hsn_code ILIKE $1 OR description ILIKE $1 ORDER BY hsn_code LIMIT 50`,
      [q]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/hsn', requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { hsn_code, description, gst_rate } = req.body;
    if (!hsn_code || !description) return res.status(400).json({ error: 'hsn_code and description required' });
    const r = await pool.query(
      `INSERT INTO hsn_codes (hsn_code, description, gst_rate)
       VALUES ($1, $2, $3)
       ON CONFLICT (hsn_code) DO UPDATE SET description=EXCLUDED.description, gst_rate=EXCLUDED.gst_rate
       RETURNING *`,
      [hsn_code.trim(), description.trim(), parseFloat(gst_rate) || 0]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/item-categories', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM item_categories WHERE is_active=TRUE ORDER BY code');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/items', async (req, res) => {
  try {
    const { page = 1, limit = 50, category, status, q } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    let pi = 1;

    if (category) { conditions.push(`ic.code = $${pi++}`); params.push(category); }
    if (status)   { conditions.push(`i.status = $${pi++}`); params.push(status); }
    if (q)        { conditions.push(`(i.item_code ILIKE $${pi} OR i.item_name ILIKE $${pi})`); params.push(`%${q}%`); pi++; }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM items i JOIN item_categories ic ON i.category_id=ic.category_id ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await pool.query(
      `SELECT i.*, ic.code AS category_code, ic.name AS category_name, u.code AS uom_code
       FROM items i
       JOIN item_categories ic ON i.category_id=ic.category_id
       LEFT JOIN uom u ON i.uom_id=u.uom_id
       ${where}
       ORDER BY i.item_code
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, parseInt(limit), offset]
    );

    res.json({ data: dataRes.rows, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/items/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.*, ic.code AS category_code, ic.name AS category_name,
              u.code AS uom_code, h.hsn_code, h.gst_rate AS hsn_gst_rate
       FROM items i
       JOIN item_categories ic ON i.category_id=ic.category_id
       LEFT JOIN uom u ON i.uom_id=u.uom_id
       LEFT JOIN hsn_codes h ON i.hsn_id=h.hsn_id
       WHERE i.item_id=$1`, [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const item = r.rows[0];

    const yarn = await pool.query('SELECT * FROM item_yarn_attrs WHERE item_id=$1', [item.item_id]);
    const fabric = await pool.query('SELECT * FROM item_fabric_attrs WHERE item_id=$1', [item.item_id]);
    const spare = await pool.query('SELECT * FROM item_spare_attrs WHERE item_id=$1', [item.item_id]);

    item.yarn_attrs = yarn.rows[0] || null;
    item.fabric_attrs = fabric.rows[0] || null;
    item.spare_attrs = spare.rows[0] || null;

    // BOM lines for fabric items
    const bom = await pool.query(
      `SELECT bl.*, yi.item_code AS yarn_code, yi.item_name AS yarn_name
       FROM bom_lines bl JOIN items yi ON yi.item_id = bl.yarn_item_id
       WHERE bl.fabric_item_id = $1 ORDER BY bl.sort_order, bl.bom_line_id`, [item.item_id]);
    item.bom_lines = bom.rows;

    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/items', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      item_code, item_name, category_id, description,
      uom_id, hsn_id, gst_rate, standard_cost,
      yarn_attrs, fabric_attrs, spare_attrs
    } = req.body;

    // Auto-generate item_code if blank
    let code = item_code;
    if (!code || !code.trim()) {
      const catR = await client.query('SELECT code FROM item_categories WHERE category_id=$1', [category_id]);
      const prefix = catR.rows[0]?.code?.slice(0, 3) || 'ITM';
      const seq = await client.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(item_code FROM '[0-9]+$') AS INTEGER)), 0)+1 AS n FROM items WHERE item_code LIKE $1`,
        [`${prefix}%`]
      );
      code = `${prefix}-${String(seq.rows[0].n).padStart(4, '0')}`;
    }

    const { knitting_rate_per_kg, standard_loss_pct } = req.body;
    const r = await client.query(
      `INSERT INTO items (item_code,item_name,category_id,description,uom_id,hsn_id,gst_rate,standard_cost,knitting_rate_per_kg,standard_loss_pct,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [code, item_name, category_id, description, uom_id || null, hsn_id || null,
       gst_rate || 0, standard_cost || 0,
       knitting_rate_per_kg || null, standard_loss_pct || 1.00,
       req.user?.username || 'system']
    );
    const item_id = r.rows[0].item_id;

    if (yarn_attrs && Object.keys(yarn_attrs).length) {
      await client.query(
        `INSERT INTO item_yarn_attrs (item_id,count,composition,shade,yarn_type)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (item_id) DO UPDATE
         SET count=$2,composition=$3,shade=$4,yarn_type=$5`,
        [item_id, yarn_attrs.count, yarn_attrs.composition, yarn_attrs.shade, yarn_attrs.yarn_type]
      );
    }
    if (fabric_attrs && Object.keys(fabric_attrs).length) {
      await client.query(
        `INSERT INTO item_fabric_attrs (item_id,fabric_code,structure,gsm,finished_gsm,width_cm,finished_width_cm,machine_type,gauge,dia_inches,feeders,stitch_length_mm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (item_id) DO UPDATE
         SET fabric_code=$2,structure=$3,gsm=$4,finished_gsm=$5,width_cm=$6,finished_width_cm=$7,machine_type=$8,gauge=$9,dia_inches=$10,feeders=$11,stitch_length_mm=$12`,
        [item_id, fabric_attrs.fabric_code || null, fabric_attrs.structure || null, numOrNull(fabric_attrs.gsm),
         numOrNull(fabric_attrs.finished_gsm), numOrNull(fabric_attrs.width_cm), numOrNull(fabric_attrs.finished_width_cm),
         fabric_attrs.machine_type || null, numOrNull(fabric_attrs.gauge), numOrNull(fabric_attrs.dia_inches),
         numOrNull(fabric_attrs.feeders), numOrNull(fabric_attrs.stitch_length_mm)]
      );
    }
    if (spare_attrs && Object.keys(spare_attrs).length) {
      await client.query(
        `INSERT INTO item_spare_attrs (item_id,oem_part_number,compatible_machine,rack_bin,warranty_months)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (item_id) DO UPDATE
         SET oem_part_number=$2,compatible_machine=$3,rack_bin=$4,warranty_months=$5`,
        [item_id, spare_attrs.oem_part_number || null, spare_attrs.compatible_machine || null,
         spare_attrs.rack_bin || null, numOrNull(spare_attrs.warranty_months)]
      );
    }

    await client.query(
      `INSERT INTO audit_logs (username, action, module, new_value)
       VALUES ($1,'CREATE_ITEM','ITEMS',$2)`,
      [req.user?.username || 'system', `item_id=${item_id} code=${item_code}`]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, item_id, item_code: code });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.put('/items/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      item_name, description, uom_id, hsn_id, gst_rate,
      standard_cost, status, yarn_attrs, fabric_attrs, spare_attrs,
      knitting_rate_per_kg, standard_loss_pct
    } = req.body;
    const item_id = req.params.id;

    await client.query(
      `UPDATE items SET item_name=$1,description=$2,uom_id=$3,hsn_id=$4,
       gst_rate=$5,standard_cost=$6,status=$7,
       knitting_rate_per_kg=$8,standard_loss_pct=$9,
       updated_at=NOW() WHERE item_id=$10`,
      [item_name, description, uom_id || null, hsn_id || null,
       gst_rate || 0, standard_cost || 0, status || 'ACTIVE',
       knitting_rate_per_kg || null, standard_loss_pct || 1.00,
       item_id]
    );

    if (yarn_attrs) {
      await client.query(
        `INSERT INTO item_yarn_attrs (item_id,count,composition,shade,yarn_type)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (item_id) DO UPDATE
         SET count=$2,composition=$3,shade=$4,yarn_type=$5`,
        [item_id, yarn_attrs.count, yarn_attrs.composition, yarn_attrs.shade, yarn_attrs.yarn_type]
      );
    }
    if (fabric_attrs) {
      await client.query(
        `INSERT INTO item_fabric_attrs (item_id,fabric_code,structure,gsm,finished_gsm,width_cm,finished_width_cm,machine_type,gauge,dia_inches,feeders,stitch_length_mm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (item_id) DO UPDATE
         SET fabric_code=$2,structure=$3,gsm=$4,finished_gsm=$5,width_cm=$6,finished_width_cm=$7,machine_type=$8,gauge=$9,dia_inches=$10,feeders=$11,stitch_length_mm=$12`,
        [item_id, fabric_attrs.fabric_code || null, fabric_attrs.structure || null, numOrNull(fabric_attrs.gsm),
         numOrNull(fabric_attrs.finished_gsm), numOrNull(fabric_attrs.width_cm), numOrNull(fabric_attrs.finished_width_cm),
         fabric_attrs.machine_type || null, numOrNull(fabric_attrs.gauge), numOrNull(fabric_attrs.dia_inches),
         numOrNull(fabric_attrs.feeders), numOrNull(fabric_attrs.stitch_length_mm)]
      );
    }
    if (spare_attrs) {
      await client.query(
        `INSERT INTO item_spare_attrs (item_id,oem_part_number,compatible_machine,rack_bin,warranty_months)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (item_id) DO UPDATE
         SET oem_part_number=$2,compatible_machine=$3,rack_bin=$4,warranty_months=$5`,
        [item_id, spare_attrs.oem_part_number || null, spare_attrs.compatible_machine || null,
         spare_attrs.rack_bin || null, numOrNull(spare_attrs.warranty_months)]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.delete('/items/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query(
      `UPDATE items SET is_active=FALSE, status='INACTIVE', updated_at=NOW() WHERE item_id=$1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/items/:id/bom', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT bl.*, yi.item_code AS yarn_code, yi.item_name AS yarn_name
       FROM bom_lines bl JOIN items yi ON yi.item_id = bl.yarn_item_id
       WHERE bl.fabric_item_id = $1 ORDER BY bl.sort_order, bl.bom_line_id`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/items/:id/bom', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { lines } = req.body; // [{ yarn_item_id, percentage }]
    if (!Array.isArray(lines)) throw new Error('lines array required');
    const total = lines.reduce((s, l) => s + parseFloat(l.percentage || 0), 0);
    if (lines.length > 0 && Math.abs(total - 100) > 0.1) throw new Error(`Percentages must total 100% (got ${total.toFixed(2)}%)`);
    await client.query('DELETE FROM bom_lines WHERE fabric_item_id = $1', [req.params.id]);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.yarn_item_id || !l.percentage) continue;
      await client.query(
        `INSERT INTO bom_lines (fabric_item_id, yarn_item_id, percentage, sort_order) VALUES ($1,$2,$3,$4)`,
        [req.params.id, l.yarn_item_id, l.percentage, i]);
    }
    await client.query('COMMIT');
    const r = await pool.query(
      `SELECT bl.*, yi.item_code AS yarn_code, yi.item_name AS yarn_name
       FROM bom_lines bl JOIN items yi ON yi.item_id = bl.yarn_item_id
       WHERE bl.fabric_item_id = $1 ORDER BY bl.sort_order`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { await client.query('ROLLBACK'); res.status(400).json({ error: e.message }); }
  finally { client.release(); }
});

router.post('/items/import-fabric-types', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const fts = await pool.query(`SELECT code, name, description FROM fabric_types WHERE deleted_at IS NULL ORDER BY code`);
    if (fts.rows.length === 0) return res.json({ imported: 0, skipped: 0, message: 'No fabric types found in Settings.' });

    // Get or create a FABRIC category
    let catRes = await pool.query(`SELECT category_id FROM item_categories WHERE UPPER(code) IN ('FINISHED_FABRIC','GREIGE_FABRIC','FABRIC') ORDER BY category_id LIMIT 1`);
    const categoryId = catRes.rows[0]?.category_id || null;

    let imported = 0, skipped = 0;
    for (const ft of fts.rows) {
      const existing = await pool.query(`SELECT item_id FROM items WHERE item_code = $1`, [ft.code]);
      if (existing.rows.length > 0) { skipped++; continue; }
      await pool.query(
        `INSERT INTO items (item_code, item_name, category_id, description, status, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', TRUE, NOW(), NOW())`,
        [ft.code, ft.name, categoryId, ft.description || null]
      );
      imported++;
    }
    res.json({ imported, skipped, total: fts.rows.length, message: `Imported ${imported} fabric types. ${skipped} already existed.` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

  return router;
};
