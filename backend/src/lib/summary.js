const tenant = require('../../config/tenant');
const obs = require('./observability');
// Daily/shift production summary over WhatsApp.
// Sends an approved template (default `shift_summary`) with 6 body params:
//   {{1}} shift, {{2}} date, {{3}} today kg, {{4}} shift kg, {{5}} running, {{6}} top machine
// Auto-fires at the configured shift-end times, and can be triggered on demand.

const pool = require('../../config/database');
const { WHATSAPP_ENABLED, getRecipients, sendTemplate } = require('./alerts');
const { getShiftSettings, detectCurrentShift } = require('./shift');

const SUMMARY_TEMPLATE = process.env.WHATSAPP_SUMMARY_TEMPLATE || 'shift_summary';
const SUMMARY_LANG     = process.env.WHATSAPP_SUMMARY_LANG || process.env.WHATSAPP_LANG || 'en';
const SUMMARY_TIMES    = (process.env.WHATSAPP_SUMMARY_TIMES || '20:00,08:00')
  .split(',').map((s) => s.trim()).filter(Boolean);

const SHIFT_LABEL = { D: 'Day', N: 'Night', A: 'A', B: 'B', C: 'C' };

async function buildSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const shift = detectCurrentShift(await getShiftSettings());

  const [todayR, shiftR, runR, topR] = await Promise.all([
    pool.query(`SELECT ROUND(COALESCE(SUM(production_kg),0)::numeric,1) AS kg FROM production_records WHERE record_date=$1`, [today]),
    pool.query(`SELECT ROUND(COALESCE(SUM(production_kg),0)::numeric,1) AS kg FROM production_records WHERE record_date=$1 AND shift=$2`, [today, shift]),
    pool.query(`SELECT COUNT(*) AS n FROM machine_live_data WHERE LOWER(COALESCE(dc_status,''))='online' AND COALESCE(rpm,0) > 0`),
    pool.query(`SELECT machine_id, ROUND(SUM(production_kg)::numeric,1) AS kg FROM production_records WHERE record_date=$1 GROUP BY machine_id ORDER BY kg DESC LIMIT 1`, [today]),
  ]);

  const top = topR.rows[0];
  return {
    shift,
    shiftLabel: SHIFT_LABEL[shift] || shift,
    date: today,
    todayKg: String(todayR.rows[0].kg),
    shiftKg: String(shiftR.rows[0].kg),
    running: String(runR.rows[0].n),
    topMachine: top ? `${top.machine_id} (${top.kg} kg)` : 'none yet',
  };
}

// Send the summary now to recipients (defaults to configured/DB recipients).
async function sendShiftSummary(recipientsOverride) {
  if (!WHATSAPP_ENABLED) return { skipped: 'whatsapp disabled' };
  const recipients = recipientsOverride && recipientsOverride.length ? recipientsOverride : await getRecipients();
  if (!recipients.length) return { skipped: 'no recipients' };
  const s = await buildSummary();
  const params = [s.shiftLabel, s.date, s.todayKg, s.shiftKg, s.running, s.topMachine];
  const results = await Promise.all(recipients.map((to) => sendTemplate(to, SUMMARY_TEMPLATE, SUMMARY_LANG, params)));
  const sent = results.filter((r) => r && r.messages).length;
  obs.log('info', 'summary.sent', { sent, recipients: recipients.length });
  return { sent, total: recipients.length, data: s };
}

// Fire once at each configured shift-end time (per day, de-duplicated in memory).
const firedSlots = {};
function startSummaryScheduler() {
  if (!WHATSAPP_ENABLED || !SUMMARY_TIMES.length) return;
  setInterval(() => {
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    if (!SUMMARY_TIMES.includes(hhmm)) return;
    const key = now.toISOString().slice(0, 10) + '|' + hhmm;
    if (firedSlots[key]) return;
    firedSlots[key] = true;
    sendShiftSummary().catch((e) => console.error('[SUMMARY]', e.message));
  }, 60 * 1000);
  obs.log('info', 'summary.scheduler_on', { shift_end_times: SUMMARY_TIMES.join(', ') });
}

// Plain-text live status for the WhatsApp "status" command (free-form reply,
// no template needed since it answers an inbound message within 24h).
async function buildStatusText() {
  const s = await buildSummary();
  return [
    `${tenant.shortName} MES status (${s.date}, ${s.shiftLabel} shift)`,
    `Today: ${s.todayKg} kg | This shift: ${s.shiftKg} kg`,
    `Machines running: ${s.running}`,
    `Top machine: ${s.topMachine}`,
  ].join('\n');
}

module.exports = { buildSummary, buildStatusText, sendShiftSummary, startSummaryScheduler };
