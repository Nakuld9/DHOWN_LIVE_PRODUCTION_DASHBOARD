// Low yarn-stock WhatsApp alerts. Periodically sums live stock per yarn type
// and alerts recipients when any falls below the threshold (once/day per type).
// Template low_stock — 3 params: {{1}} yarn, {{2}} current kg, {{3}} threshold kg.
const pool = require('../../config/database');
const obs = require('./observability');
const { WHATSAPP_ENABLED, getRecipients, sendTemplate } = require('./alerts');

const LOWSTOCK_TEMPLATE = process.env.WHATSAPP_LOWSTOCK_TEMPLATE || 'low_stock';
const LOWSTOCK_KG       = Number(process.env.WHATSAPP_LOWSTOCK_KG || 100);
const LANG              = process.env.WHATSAPP_NOTIFY_LANG || process.env.WHATSAPP_LANG || 'en';
const CHECK_MS          = Number(process.env.WHATSAPP_LOWSTOCK_INTERVAL_MIN || 180) * 60 * 1000;
const COOLDOWN_MS       = 24 * 60 * 60 * 1000; // once/day per yarn type

const lastAlerted = {}; // yarn_type -> timestamp

async function checkLowStock() {
  if (!WHATSAPP_ENABLED) return;
  try {
    const { rows } = await pool.query(
      `SELECT yarn_type, ROUND(SUM(COALESCE(current_stock_kg,0))::numeric,1) AS kg
       FROM yarn_lots GROUP BY yarn_type
       HAVING SUM(COALESCE(current_stock_kg,0)) < $1
       ORDER BY kg ASC`, [LOWSTOCK_KG]
    );
    if (!rows.length) return;
    const recipients = await getRecipients();
    if (!recipients.length) return;

    const now = Date.now();
    for (const r of rows) {
      const key = r.yarn_type || 'unknown';
      if (lastAlerted[key] && now - lastAlerted[key] < COOLDOWN_MS) continue;
      lastAlerted[key] = now;
      const params = [key, String(r.kg), String(LOWSTOCK_KG)];
      await Promise.all(recipients.map((to) => sendTemplate(to, LOWSTOCK_TEMPLATE, LANG, params)));
      obs.log('info', 'stock.low_alert', { yarn: key, kg: r.kg, threshold: LOWSTOCK_KG });
    }
  } catch (e) { console.error('[STOCK]', e.message); }
}

function startLowStockScheduler() {
  if (!WHATSAPP_ENABLED) return;
  setInterval(checkLowStock, CHECK_MS);
  obs.log('info', 'stock.watcher_on', { threshold_kg: LOWSTOCK_KG, every_min: CHECK_MS / 60000 });
}

module.exports = { checkLowStock, startLowStockScheduler };
