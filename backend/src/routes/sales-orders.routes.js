// Sales Orders routes — customer orders for finished goods (layered architecture).
// Mounted at /api/sales-orders. Reads open to OPERATOR; writes require SUPERVISOR;
// delete requires ADMIN. Injected: pool, verifyToken, requireRole, nextInvSeq, io.
const express = require('express');
const makeRepository = require('../repositories/sales-orders.repository');
const makeService = require('../services/sales-orders.service');
const makeController = require('../controllers/sales-orders.controller');

module.exports = ({ pool, verifyToken, requireRole, nextInvSeq, io, sendTemplate }) => {
  const router = express.Router();
  const consent = require('../lib/wa-consent')(pool);

  // Fire-and-forget: send the order_confirmation WhatsApp template to the customer when
  // a new order is created. Needs their WhatsApp number on file (from a prior chat),
  // consent, and the template approved at Meta — otherwise it silently no-ops.
  async function notifyOrderConfirmation(row) {
    try {
      if (!sendTemplate || !row || !row.partner_id) return;
      const phone = (await pool.query(
        `SELECT phone FROM wa_conversations WHERE partner_id = $1 AND channel IS DISTINCT FROM 'WEB'
          ORDER BY last_message_at DESC NULLS LAST LIMIT 1`, [row.partner_id])).rows[0]?.phone;
      if (!phone) return;
      if (!(await consent.canSend(phone, 'SERVICE')).allowed) return;
      const name = row.customer_name
        || (await pool.query(`SELECT company_name FROM partners WHERE partner_id = $1`, [row.partner_id])).rows[0]?.company_name
        || 'Sir';
      const ref = row.so_number || `order #${row.so_id || row.id || ''}`.trim();
      const lang = process.env.PAYMENT_REMINDER_LANG || 'en_US';
      sendTemplate(phone, 'order_confirmation', lang, [name, ref]).catch(() => {});
    } catch { /* never block order creation */ }
  }

  // Same idea, on dispatch: tell the customer their order has gone out.
  async function notifyDispatch(row) {
    try {
      if (!sendTemplate || !row || !row.partner_id) return;
      if (row.status !== 'DISPATCHED' && row.status !== 'PARTIALLY_DISPATCHED') return;
      const phone = (await pool.query(
        `SELECT phone FROM wa_conversations WHERE partner_id = $1 AND channel IS DISTINCT FROM 'WEB'
          ORDER BY last_message_at DESC NULLS LAST LIMIT 1`, [row.partner_id])).rows[0]?.phone;
      if (!phone) return;
      if (!(await consent.canSend(phone, 'SERVICE')).allowed) return;
      const name = row.customer_name
        || (await pool.query(`SELECT company_name FROM partners WHERE partner_id = $1`, [row.partner_id])).rows[0]?.company_name
        || 'Sir';
      const ref = row.so_number || `order #${row.so_id || row.id || ''}`.trim();
      const note = row.status === 'PARTIALLY_DISPATCHED' ? 'A part of your order has been dispatched' : 'Our team will share the delivery details shortly';
      const lang = process.env.PAYMENT_REMINDER_LANG || 'en_US';
      sendTemplate(phone, 'dispatch_update', lang, [name, ref, note]).catch(() => {});
    } catch { /* never block the transition */ }
  }

  // Every route below requires a valid session. Applied at router level so a
  // route added later is guarded by default; individual routes add requireRole
  // on top where a specific role is needed.
  router.use(verifyToken);

  const controller = makeController(makeService(makeRepository(pool), { nextInvSeq, io }));

  router.get('/', controller.list);
  router.get('/:id', controller.get);
  // Taking and managing the order is the sales job, so SALES is granted these
  // explicitly. Dispatch is deliberately NOT granted: it moves physical goods
  // out of the building and stays with the supervisor who can see the loading
  // bay. Deletion stays ADMIN.
  const sales = { also: ['SALES'] };
  router.post('/', verifyToken, requireRole('SUPERVISOR', sales), (req, res) => {
    // Intercept the created row on a 201 to send the confirmation, without touching
    // the shared controller/service.
    const orig = res.json.bind(res);
    res.json = (payload) => { if (res.statusCode === 201 && payload && payload.partner_id) notifyOrderConfirmation(payload); return orig(payload); };
    return controller.create(req, res);
  });
  router.put('/:id', verifyToken, requireRole('SUPERVISOR', sales), controller.updateHeader);
  router.put('/:id/confirm', verifyToken, requireRole('SUPERVISOR', sales), controller.confirm);
  const withDispatchNotify = (handler) => (req, res) => {
    const orig = res.json.bind(res);
    res.json = (payload) => { if (res.statusCode < 400 && payload && payload.partner_id) notifyDispatch(payload); return orig(payload); };
    return handler(req, res);
  };
  router.put('/:id/partial', verifyToken, requireRole('SUPERVISOR', sales), withDispatchNotify(controller.partial));
  router.put('/:id/dispatch', verifyToken, requireRole('SUPERVISOR'), withDispatchNotify(controller.dispatch));
  router.put('/:id/cancel', verifyToken, requireRole('SUPERVISOR', sales), controller.cancel);
  router.delete('/:id', verifyToken, requireRole('ADMIN'), controller.remove);

  return router;
};
