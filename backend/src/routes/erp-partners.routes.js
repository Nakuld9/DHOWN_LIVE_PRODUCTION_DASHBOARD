// ERP partners + location master routes — partners (addresses/contacts/banks) and
// warehouses/racks/bins (layered extraction, ERP chunk b). Mounted at /api/erp
// alongside erp-items.routes.js; unmatched subpaths fall through to the remaining
// inline ERP handlers (chunks c-d). 16 handlers migrated VERBATIM (2026-07-10).
const express = require('express');

const VALID_ROLES = ['SUPPLIER','CUSTOMER','KNITTING_SUB','DYE_HOUSE','FINISHING_HOUSE','TRANSPORTER','AGENT'];

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();

  async function nextPartnerCode() {
    const r = await pool.query(`SELECT COALESCE(MAX(CAST(SUBSTRING(partner_code FROM '[0-9]+$') AS INTEGER)),0)+1 AS n FROM partners`);
    return 'PART-' + String(r.rows[0].n).padStart(4, '0');
  }


router.get('/partners', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const { page = 1, limit = 50, role, city, active, q } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conds = []; const params = []; let pi = 1;

    if (active === 'true')  { conds.push(`p.is_active=TRUE`); }
    if (active === 'false') { conds.push(`p.is_active=FALSE`); }
    if (city) { conds.push(`a.city ILIKE $${pi++}`); params.push(`%${city}%`); }
    if (q)    { conds.push(`(p.partner_code ILIKE $${pi} OR p.company_name ILIKE $${pi} OR p.gstin ILIKE $${pi})`); params.push(`%${q}%`); pi++; }

    const roleJoin = role ? `JOIN partner_roles pr2 ON pr2.partner_id=p.partner_id AND pr2.role=$${pi++}` : '';
    if (role) params.push(role);

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const countRes = await pool.query(
      `SELECT COUNT(DISTINCT p.partner_id) FROM partners p
       LEFT JOIN partner_addresses a ON a.partner_id=p.partner_id AND a.is_default=TRUE
       ${roleJoin} ${where}`, params
    );
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await pool.query(
      `SELECT p.*, a.city, a.state,
              COALESCE(json_agg(DISTINCT pr.role) FILTER (WHERE pr.role IS NOT NULL), '[]') AS roles
       FROM partners p
       LEFT JOIN partner_addresses a ON a.partner_id=p.partner_id AND a.is_default=TRUE
       LEFT JOIN partner_roles pr ON pr.partner_id=p.partner_id
       ${roleJoin} ${where}
       GROUP BY p.partner_id, a.city, a.state
       ORDER BY p.partner_code
       LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, parseInt(limit), offset]
    );

    res.json({ data: dataRes.rows, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/partners/:id', verifyToken, requireRole('OPERATOR'), async (req, res) => {
  try {
    const id = req.params.id;
    const p = await pool.query('SELECT * FROM partners WHERE partner_id=$1', [id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Not found' });
    const partner = p.rows[0];

    const [roles, addresses, contacts, banks] = await Promise.all([
      pool.query('SELECT * FROM partner_roles WHERE partner_id=$1', [id]),
      pool.query('SELECT * FROM partner_addresses WHERE partner_id=$1 ORDER BY is_default DESC', [id]),
      pool.query('SELECT * FROM partner_contacts WHERE partner_id=$1 ORDER BY is_primary DESC', [id]),
      pool.query('SELECT * FROM partner_bank WHERE partner_id=$1 ORDER BY is_default DESC', [id]),
    ]);

    partner.roles = roles.rows.map(r => r.role);
    partner.addresses = addresses.rows;
    partner.contacts = contacts.rows;
    partner.banks = banks.rows;
    res.json(partner);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/partners', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const {
      partner_code, company_name, short_name, gstin, pan, tan, iec, cin,
      msme_number, msme_category, payment_terms, credit_limit, credit_days,
      rating, notes, roles = [], address, contact, bank
    } = req.body;

    const code = (partner_code && partner_code.trim()) ? partner_code.trim() : await nextPartnerCode();

    const r = await client.query(
      `INSERT INTO partners (partner_code,company_name,short_name,gstin,pan,tan,iec,cin,
        msme_number,msme_category,payment_terms,credit_limit,credit_days,rating,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [code, company_name, short_name, gstin||null, pan||null, tan||null, iec||null, cin||null,
       msme_number||null, msme_category||null, payment_terms||30, credit_limit||null,
       credit_days||0, rating||null, notes||null, req.user?.username||'system']
    );
    const partner_id = r.rows[0].partner_id;

    for (const role of roles) {
      if (VALID_ROLES.includes(role)) {
        await client.query(
          `INSERT INTO partner_roles (partner_id, role) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [partner_id, role]
        );
      }
    }

    if (address && (address.line1 || address.city)) {
      await client.query(
        `INSERT INTO partner_addresses (partner_id,address_type,line1,line2,city,state,pincode,country,gstin,is_default)
         VALUES ($1,'PRIMARY',$2,$3,$4,$5,$6,$7,$8,TRUE)`,
        [partner_id, address.line1, address.line2, address.city, address.state,
         address.pincode, address.country||'India', address.gstin||null]
      );
    }

    if (contact && contact.name) {
      await client.query(
        `INSERT INTO partner_contacts (partner_id,name,designation,mobile,email,whatsapp,is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
        [partner_id, contact.name, contact.designation, contact.mobile, contact.email, contact.whatsapp]
      );
    }

    if (bank && bank.account_no) {
      await client.query(
        `INSERT INTO partner_bank (partner_id,bank_name,branch,account_no,ifsc,account_type,is_default)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
        [partner_id, bank.bank_name, bank.branch, bank.account_no, bank.ifsc, bank.account_type||'CURRENT']
      );
    }

    await client.query(
      `INSERT INTO audit_logs (username,action,module,new_value)
       VALUES ($1,'CREATE_PARTNER','PARTNERS',$2)`,
      [req.user?.username||'system', `partner_id=${partner_id} code=${code} name=${company_name}`]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, partner_id, partner_code: code });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.put('/partners/:id', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = req.params.id;
    const {
      company_name, short_name, gstin, pan, tan, iec, cin,
      msme_number, msme_category, payment_terms, credit_limit, credit_days,
      rating, notes, is_active, roles
    } = req.body;

    await client.query(
      `UPDATE partners SET company_name=$1,short_name=$2,gstin=$3,pan=$4,tan=$5,iec=$6,cin=$7,
       msme_number=$8,msme_category=$9,payment_terms=$10,credit_limit=$11,credit_days=$12,
       rating=$13,notes=$14,is_active=$15,updated_at=NOW() WHERE partner_id=$16`,
      [company_name, short_name, gstin||null, pan||null, tan||null, iec||null, cin||null,
       msme_number||null, msme_category||null, payment_terms||30, credit_limit||null,
       credit_days||0, rating||null, notes||null, is_active!==false, id]
    );

    if (Array.isArray(roles)) {
      await client.query('DELETE FROM partner_roles WHERE partner_id=$1', [id]);
      for (const role of roles) {
        if (VALID_ROLES.includes(role)) {
          await client.query(
            `INSERT INTO partner_roles (partner_id,role) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [id, role]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.post('/partners/:id/addresses', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { address_type, line1, line2, city, state, pincode, country, gstin, is_default } = req.body;
    if (is_default) {
      await pool.query('UPDATE partner_addresses SET is_default=FALSE WHERE partner_id=$1', [req.params.id]);
    }
    const r = await pool.query(
      `INSERT INTO partner_addresses (partner_id,address_type,line1,line2,city,state,pincode,country,gstin,is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, address_type||'PRIMARY', line1, line2, city, state, pincode, country||'India', gstin||null, is_default||false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/partners/:id/contacts', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { name, designation, mobile, email, whatsapp, is_primary } = req.body;
    if (is_primary) {
      await pool.query('UPDATE partner_contacts SET is_primary=FALSE WHERE partner_id=$1', [req.params.id]);
    }
    const r = await pool.query(
      `INSERT INTO partner_contacts (partner_id,name,designation,mobile,email,whatsapp,is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, name, designation, mobile, email, whatsapp, is_primary||false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/partners/:id/contacts/:cid', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    await pool.query('DELETE FROM partner_contacts WHERE contact_id=$1 AND partner_id=$2', [req.params.cid, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/partners/:id/banks', verifyToken, requireRole('SUPERVISOR'), async (req, res) => {
  try {
    const { bank_name, branch, account_no, ifsc, account_type, is_default } = req.body;
    if (is_default) {
      await pool.query('UPDATE partner_bank SET is_default=FALSE WHERE partner_id=$1', [req.params.id]);
    }
    const r = await pool.query(
      `INSERT INTO partner_bank (partner_id,bank_name,branch,account_no,ifsc,account_type,is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, bank_name, branch, account_no, ifsc, account_type||'CURRENT', is_default||false]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/partners/:id', verifyToken, requireRole('ADMIN'), async (req, res) => {
  try {
    await pool.query('UPDATE partners SET is_active=FALSE, updated_at=NOW() WHERE partner_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/warehouses', requireRole('OPERATOR'), async (req, res) => {
  try {
    const wh = await pool.query('SELECT * FROM warehouses ORDER BY code');
    const racks = await pool.query('SELECT * FROM racks ORDER BY warehouse_id, code');
    const bins = await pool.query('SELECT * FROM bins ORDER BY rack_id, code');
    const tree = wh.rows.map(w => ({
      ...w,
      racks: racks.rows.filter(r => r.warehouse_id === w.warehouse_id).map(r => ({
        ...r,
        bins: bins.rows.filter(b => b.rack_id === r.rack_id),
      })),
    }));
    res.json(tree);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/warehouses', requireRole('ADMIN'), async (req, res) => {
  const { code, name, type, address } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO warehouses (code,name,type,address) VALUES ($1,$2,$3,$4) RETURNING *`,
      [code, name, type||'INTERNAL', address||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/warehouses/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, type, address, is_active } = req.body;
  try {
    await pool.query(
      `UPDATE warehouses SET name=$1,type=$2,address=$3,is_active=$4 WHERE warehouse_id=$5`,
      [name, type, address||null, is_active!==false, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/warehouses/:wid/racks', requireRole('ADMIN'), async (req, res) => {
  const { code, name } = req.body;
  try {
    const r = await pool.query(
      `INSERT INTO racks (warehouse_id,code,name) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.wid, code, name||null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/racks/:id', requireRole('ADMIN'), async (req, res) => {
  const { name, is_active } = req.body;
  try {
    await pool.query(`UPDATE racks SET name=$1,is_active=$2 WHERE rack_id=$3`, [name, is_active!==false, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/racks/:id', requireRole('ADMIN'), async (req, res) => {
  const rackId = req.params.id;
  const client = await pool.connect();
  try {
    // Block deletion if the rack or any of its bins is referenced by stock movements.
    const used = await client.query(
      `SELECT 1 FROM stock_ledger
       WHERE rack_id=$1 OR bin_id IN (SELECT bin_id FROM bins WHERE rack_id=$1) LIMIT 1`,
      [rackId]
    );
    if (used.rows.length) {
      return res.status(409).json({ error: 'Rack is in use (has stock movements) and cannot be deleted.' });
    }
    await client.query('BEGIN');
    await client.query('DELETE FROM bins WHERE rack_id=$1', [rackId]);
    const r = await client.query('DELETE FROM racks WHERE rack_id=$1 RETURNING rack_id', [rackId]);
    await client.query('COMMIT');
    if (!r.rows.length) return res.status(404).json({ error: 'Rack not found' });
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.post('/racks/:rid/bins', requireRole('ADMIN'), async (req, res) => {
  const { code } = req.body;
  try {
    const r = await pool.query(`INSERT INTO bins (rack_id,code) VALUES ($1,$2) RETURNING *`, [req.params.rid, code]);
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/bins/:id', requireRole('ADMIN'), async (req, res) => {
  const { is_active } = req.body;
  try {
    await pool.query(`UPDATE bins SET is_active=$1 WHERE bin_id=$2`, [is_active!==false, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/bins/:id', requireRole('ADMIN'), async (req, res) => {
  const binId = req.params.id;
  try {
    // Block deletion if the bin is referenced by stock movements.
    const used = await pool.query(`SELECT 1 FROM stock_ledger WHERE bin_id=$1 LIMIT 1`, [binId]);
    if (used.rows.length) {
      return res.status(409).json({ error: 'Bin is in use (has stock movements) and cannot be deleted.' });
    }
    const r = await pool.query(`DELETE FROM bins WHERE bin_id=$1 RETURNING bin_id`, [binId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Bin not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

  return router;
};
