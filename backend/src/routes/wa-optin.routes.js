// WhatsApp opt-in growth kit — mounted at /api/wa-optin.
// Returns the customer-initiated opt-in deep link (wa.me/<number>?text=<keyword>)
// + live opt-in count, so the business can print a QR / share a link at
// exhibitions and let prospects opt THEMSELVES in (fully WhatsApp-compliant —
// the customer sends the first message, which the existing keyword flow turns
// into marketing consent). No outbound sending here.
const express = require('express');

module.exports = ({ pool, verifyToken, requireRole }) => {
  const router = express.Router();
  const READ = requireRole('SUPERVISOR', { also: ['SALES', 'ACCOUNTS'] });
  const WRITE = requireRole('SUPERVISOR', { also: ['ADMIN'] });

  const digits = (s) => String(s || '').replace(/\D/g, '');
  const keywordList = () =>
    (process.env.WA_MARKETING_OPTIN_KEYWORDS || 'OFFERS,DEALS,YES OFFERS,SUBSCRIBE OFFERS,JOIN OFFERS')
      .split(',').map((k) => k.trim()).filter(Boolean);

  async function getNumber() {
    try {
      const r = await pool.query(`SELECT value FROM app_settings WHERE key = 'wa_optin_number' LIMIT 1`);
      if (r.rows[0] && digits(r.rows[0].value)) return digits(r.rows[0].value);
    } catch {}
    return digits(process.env.WA_OPTIN_NUMBER || '');
  }

  router.get('/', verifyToken, READ, async (req, res) => {
    try {
      const number = await getNumber();
      const keywords = keywordList();
      const keyword = keywords[0] || 'OFFERS';
      const link = number ? `https://wa.me/${number}?text=${encodeURIComponent(keyword)}` : null;
      let opted_in_count = 0;
      try {
        const c = await pool.query(`SELECT COUNT(*)::int AS n FROM wa_consent WHERE marketing_ok = true AND status = 'GRANTED'`);
        opted_in_count = c.rows[0]?.n || 0;
      } catch {}
      res.json({ number, number_set: !!number, keyword, keywords, link, opted_in_count });
    } catch (e) {
      console.error('[wa-optin]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Set/clear the business WhatsApp number used in the opt-in link (per firm).
  router.post('/number', verifyToken, WRITE, async (req, res) => {
    try {
      const num = digits(req.body?.number);
      if (req.body?.number && (num.length < 10 || num.length > 15))
        return res.status(400).json({ error: 'Enter the WhatsApp number in international format, e.g. 917055600009.' });
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ('wa_optin_number', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [num]);
      res.json({ ok: true, number: num, number_set: !!num });
    } catch (e) {
      console.error('[wa-optin-number]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
