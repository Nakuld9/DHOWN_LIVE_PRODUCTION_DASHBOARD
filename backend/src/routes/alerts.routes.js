// Alerts routes — factory dashboard alerts (layered architecture).
// Mounted at /api/alerts. No auth, matching the original inline handler.
const express = require('express');
const makeRepository = require('../repositories/alerts.repository');
const makeService = require('../services/alerts.service');
const makeController = require('../controllers/alerts.controller');
const wa = require('../lib/alerts');

module.exports = ({ pool, verifyToken, requireRole}) => {
  const router = express.Router();
  router.use(verifyToken); // require login for all routes in this router
  const controller = makeController(makeService(makeRepository(pool)));
  router.get('/', controller.get);

  // POST /api/alerts/send — fire the machine_alert WhatsApp template server-side.
  // Replaces the old client-side whatsapp:// link that popped the desktop app.
  // Body: { machine_id, machine_name?, status?, mobile? }. Without `mobile`,
  // sends to the configured recipients (WHATSAPP_TO or active supervisors/admins).
  router.post('/send', requireRole('SUPERVISOR'), async (req, res) => {
    try {
      if (!wa.WHATSAPP_ENABLED) {
        return res.status(503).json({ ok: false, error: 'WhatsApp not configured on the server (WHATSAPP_* in .env)' });
      }
      const { machine_id, machine_name, status, mobile } = req.body || {};
      if (!machine_id) return res.status(400).json({ ok: false, error: 'machine_id is required' });

      const label = machine_name || machine_id;
      const stat  = status || 'ALERT';
      const time  = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

      const recipients = mobile ? [String(mobile)] : await wa.getRecipients();
      if (!recipients.length) {
        return res.status(422).json({ ok: false, error: 'No recipients — pass a mobile or set WHATSAPP_TO / a supervisor mobile' });
      }

      let sent = 0;
      for (const m of recipients) {
        const ok = await wa.sendWhatsAppAlert(m, label, stat, time, machine_id);
        if (ok) sent++;
      }
      // sent===0 usually means the recipient isn't a WhatsApp test number / the app isn't published yet.
      return res.json({ ok: sent > 0, sent, recipients: recipients.length });
    } catch (e) {
      console.error('[alerts/send]', e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
};
