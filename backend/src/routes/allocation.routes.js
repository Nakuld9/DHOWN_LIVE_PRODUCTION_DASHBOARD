// Lot allocation with shade continuity, quarantine, and unit conversion.
//
// Reading is OPERATOR. Committing or releasing rolls is SUPERVISOR. Approving a
// multi-lot pick is ADMIN, because accepting a shade mismatch is a commercial
// decision with the cost of the whole consignment behind it.

const express = require('express');

module.exports = ({ pool, verifyToken, requireRole, allocation, uom, sendTemplate }) => {
  const router = express.Router();
  router.use(verifyToken);
  const consent = pool ? require('../lib/wa-consent')(pool) : null;

  // Fire-and-forget: when finished goods are allocated to a customer, WhatsApp them that
  // their fabric is ready. Needs their number on file + consent + the template approved.
  async function notifyFabricReady({ partner_id, fabric_type, color_name, kg }) {
    try {
      if (!sendTemplate || !pool || !partner_id || !(kg > 0)) return;
      const phone = (await pool.query(
        `SELECT phone FROM wa_conversations WHERE partner_id = $1 AND channel IS DISTINCT FROM 'WEB'
          ORDER BY last_message_at DESC NULLS LAST LIMIT 1`, [partner_id])).rows[0]?.phone;
      if (!phone) return;
      if (consent && !(await consent.canSend(phone, 'SERVICE')).allowed) return;
      const name = (await pool.query(`SELECT company_name FROM partners WHERE partner_id = $1`, [partner_id])).rows[0]?.company_name || 'Sir';
      const fabric = [color_name, fabric_type].filter(Boolean).join(' ') || 'your fabric';
      const lang = process.env.PAYMENT_REMINDER_LANG || 'en_US';
      sendTemplate(phone, 'fabric_ready', lang, [name, fabric, String(Math.round(kg))]).catch(() => {});
    } catch { /* never block allocation */ }
  }

  const send = (res, out, okStatus = 200) => {
    if (out && out.error) return res.status(out.code || 400).json({ error: out.error });
    return res.status(okStatus).json(out);
  };
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) { res.status(500).json({ error: e.message }); }
  };

  // ── Availability and planning ─────────────────────────────────────────────
  router.get('/lots', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await allocation.availableLots({
      fabric_type: req.query.fabric_type, color_name: req.query.color_name,
      gsm: req.query.gsm,
      grades: req.query.grades ? String(req.query.grades).split(',') : undefined,
    }));
  }));

  // Dry run: what would be picked, and would it span more than one dye lot.
  // Deliberately a GET with no side effects, so it can be called while someone
  // is still deciding.
  router.get('/plan', requireRole('OPERATOR'), wrap(async (req, res) => {
    send(res, await allocation.plan({
      partner_id: req.query.partner_id || null,
      fabric_type: req.query.fabric_type, color_name: req.query.color_name,
      gsm: req.query.gsm, quantity_kg: req.query.quantity_kg,
      grades: req.query.grades ? String(req.query.grades).split(',') : undefined,
      allow_split: req.query.allow_split !== 'false',
      tolerance_pct: req.query.tolerance_pct,
    }));
  }));

  router.get('/allocations', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await allocation.list(req.query));
  }));

  router.get('/allocations/:id', requireRole('OPERATOR'), wrap(async (req, res) => {
    const a = await allocation.get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Allocation not found' });
    res.json(a);
  }));

  router.post('/allocations', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    const out = await allocation.commit({ ...req.body, created_by: req.user?.username });
    if (out && out.ok && req.body.partner_id) {
      notifyFabricReady({ partner_id: req.body.partner_id, fabric_type: req.body.fabric_type, color_name: req.body.color_name, kg: Number(out.allocated || req.body.quantity_kg || 0) });
    }
    send(res, out, 201);
  }));

  // Accepting a shade split is a commercial call, not a warehouse one.
  router.post('/allocations/:id/approve-shade', requireRole('ADMIN'), wrap(async (req, res) => {
    send(res, await allocation.approveShade(req.params.id, { ...req.body, by: req.user?.username }));
  }));

  router.post('/allocations/:id/release', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await allocation.release(req.params.id, { ...req.body, by: req.user?.username }));
  }));

  router.post('/allocations/:id/consume', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await allocation.consume(req.params.id, { by: req.user?.username }));
  }));

  // ── Quarantine and rework ─────────────────────────────────────────────────
  router.get('/quarantine', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await allocation.quarantineList({ status: req.query.status }));
  }));

  router.get('/quarantine/:rollId/history', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await allocation.quarantineHistory(req.params.rollId));
  }));

  router.post('/quarantine/:rollId', requireRole('SUPERVISOR', { also: ['QC'] }), wrap(async (req, res) => {
    send(res, await allocation.setQuarantine(req.params.rollId, req.body?.status,
      { ...req.body, by: req.user?.username }));
  }));

  // ── Unit conversion ───────────────────────────────────────────────────────
  router.get('/uom/convert', requireRole('OPERATOR'), wrap(async (req, res) => {
    send(res, await uom.convertVia({
      item_id: req.query.item_id || null,
      from_uom: req.query.from, to_uom: req.query.to, quantity: req.query.quantity,
    }));
  }));

  router.get('/uom/units/:itemId', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await uom.supportedUnits(req.params.itemId));
  }));

  router.get('/uom/factors', requireRole('OPERATOR'), wrap(async (req, res) => {
    res.json(await uom.listFactors({ item_id: req.query.item_id }));
  }));

  router.post('/uom/factors', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await uom.saveFactor({ ...req.body, by: req.user?.username }), 201);
  }));

  router.delete('/uom/factors/:id', requireRole('SUPERVISOR'), wrap(async (req, res) => {
    send(res, await uom.deleteFactor(req.params.id));
  }));

  return router;
};
