// WhatsApp machine-down alerts via the official WhatsApp Cloud API (Meta).
// Business-initiated alerts use an APPROVED template (3 body params:
// {{1}} machine, {{2}} status, {{3}} time). Two-way: supervisors can REPLY to an
// alert on WhatsApp to acknowledge it — that logs who acknowledged and stops the
// system re-alerting that machine until it recovers (see the webhook route).
//
// Enable by setting these in .env (see .env.example / HANDOFF for setup):
//   WHATSAPP_TOKEN        = access token (Meta)
//   WHATSAPP_PHONE_ID     = phone number ID (Meta)
//   WHATSAPP_TEMPLATE     = approved template name        (default: machine_alert)
//   WHATSAPP_LANG         = template language code        (default: en)
//   WHATSAPP_TO           = recipient number(s), comma-separated for multiple
//                           (else all active supervisors/admins from `users`)
//   WHATSAPP_VERIFY_TOKEN = webhook verify token (you choose it; used in Meta setup)
//   WHATSAPP_API_VERSION  = graph API version             (default: v21.0)

const https = require("https");
const obs = require('./observability');
const pool = require("../../config/database");

const WA_TOKEN    = process.env.WHATSAPP_TOKEN || '';
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '';
const WA_TEMPLATE = process.env.WHATSAPP_TEMPLATE || 'machine_alert';
const WA_LANG     = process.env.WHATSAPP_LANG || 'en';
const WA_TO       = process.env.WHATSAPP_TO || '';
const WA_VERSION  = process.env.WHATSAPP_API_VERSION || 'v21.0';

// True once the Cloud API credentials are configured.
const WHATSAPP_ENABLED = Boolean(WA_TOKEN && WA_PHONE_ID);

const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between alerts per machine

// Escalation: if an alert stays unacknowledged this long, ping the owner number.
const ESCALATE_TO = process.env.WHATSAPP_ESCALATE_TO || '';
const ESCALATE_MS = Number(process.env.WHATSAPP_ESCALATE_MIN || 15) * 60 * 1000;

// In-memory per machine: { lastStatus, lastAlertAt, acknowledged, ackBy, ackAt }
const machineAlertState = {};

// Recently-sent alerts, keyed by the WhatsApp message id, so a REPLY (which
// carries context.id = the original message id) resolves back to its machine.
const sentAlerts = new Map(); // message_id -> { machineId, machine, to, at }
const SENT_CAP = 300;

function rememberSentAlert(messageId, machineId, machine, to) {
  if (!messageId) return;
  sentAlerts.set(messageId, { machineId, machine, to, at: Date.now() });
  while (sentAlerts.size > SENT_CAP) sentAlerts.delete(sentAlerts.keys().next().value);
}

// Normalize an Indian mobile to E.164 digits (adds 91 when a bare 10-digit number).
function toE164(mobile) {
  const d = String(mobile || '').replace(/\D/g, '');
  if (!d) return null;
  return d.length === 10 ? '91' + d : d;
}

// Recipients for alerts, as an array. Priority:
//   1. WHATSAPP_TO in .env — one or more numbers (comma/semicolon/space separated)
//   2. else every active SUPERVISOR/ADMIN/SUPER_ADMIN with a mobile in `users`
async function getRecipients() {
  if (WA_TO) {
    return WA_TO.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  try {
    const r = await pool.query(
      `SELECT mobile FROM users WHERE role IN ('SUPERVISOR','ADMIN','SUPER_ADMIN') AND mobile IS NOT NULL AND active = true AND deleted_at IS NULL`
    );
    return r.rows.map((x) => String(x.mobile)).filter(Boolean);
  } catch { return []; }
}

// Low-level POST to the Cloud API; resolves with the parsed response (or null).
function waPost(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/${WA_VERSION}/${WA_PHONE_ID}/messages`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => {
        let json = null; try { json = JSON.parse(d); } catch {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.error(`[ALERT] WhatsApp API ${res.statusCode}: ${d.slice(0, 300)}`);
        }
        resolve(json);
      });
    });
    req.on('error', (err) => { console.error(`[ALERT] WhatsApp error: ${err.message}`); resolve(null); });
    req.write(body); req.end();
  });
}

// Generic approved-template sender. bodyParams -> {{1}}, {{2}}, ... in order.
// Returns Meta's parsed response (with messages[0].id on success) or null.
async function sendTemplate(mobile, templateName, langCode, bodyParams = []) {
  if (!WHATSAPP_ENABLED) return null;
  const to = toE164(mobile);
  if (!to) return null;
  const template = { name: templateName, language: { code: langCode || WA_LANG } };
  if (bodyParams.length) {
    template.components = [{ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: String(t) })) }];
  }
  return waPost({ messaging_product: 'whatsapp', to, type: 'template', template });
}

// Send the machine-down alert template; remembers the message id for reply-matching.
async function sendWhatsAppAlert(mobile, machine, status, time, machineId) {
  const to = toE164(mobile);
  const json = await sendTemplate(mobile, WA_TEMPLATE, WA_LANG, [machine, status, time]);
  const mid = json && json.messages && json.messages[0] && json.messages[0].id;
  if (mid) { rememberSentAlert(mid, machineId, machine, to); obs.log('info', 'alert.sent', { to, machine, status }); }
  return !!mid;
}

// Free-form text reply — allowed within 24h of a user's inbound message.
// Returns Meta's parsed response so callers can keep the message id — status
// callbacks (delivered/read/failed) are keyed on it, and without it a failed
// send can never be matched back to the row we showed the user as sent.
async function sendText(mobile, text) {
  if (!WHATSAPP_ENABLED) return null;
  const to = toE164(mobile);
  if (!to) return null;
  return waPost({ messaging_product: 'whatsapp', to, type: 'text', text: { body: String(text) } });
}

// Convenience for callers that only want the id.
const messageIdOf = (res) => res?.messages?.[0]?.id || null;

// Which machine does a reply acknowledge? The replied-to alert if we can match
// its message id; otherwise the most recently-alerted machine still down.
function resolveMachineForReply(contextId) {
  if (contextId && sentAlerts.has(contextId)) return sentAlerts.get(contextId).machineId;
  let best = null, bestAt = -1;
  for (const [id, s] of Object.entries(machineAlertState)) {
    const down = ['OFFLINE', 'STOPPED', 'DOWNTIME'].includes(s.lastStatus);
    if (down && !s.acknowledged && (s.lastAlertAt || 0) > bestAt) { best = id; bestAt = s.lastAlertAt || 0; }
  }
  return best;
}

// Mark a machine acknowledged (suppresses re-alerts until it recovers) + audit log.
async function acknowledgeMachine(machineId, by, text) {
  const s = machineAlertState[machineId] || {};
  machineAlertState[machineId] = { ...s, acknowledged: true, ackBy: by, ackAt: Date.now() };
  try {
    await pool.query(
      `INSERT INTO machine_alert_acks (machine_id, ack_by, message_text) VALUES ($1,$2,$3)`,
      [machineId, String(by || ''), text || null]
    );
  } catch (e) { console.error('[ALERT] ack log failed:', e.message); }
}

// Called by the webhook for each inbound text reply. Returns the acked machine or null.
async function handleInboundReply(from, text, contextId) {
  const machineId = resolveMachineForReply(contextId);
  if (!machineId) return null;
  await acknowledgeMachine(machineId, from, text);
  obs.log('info', 'alert.acknowledged', { machine_id: machineId, from, text: (text || '').slice(0, 40) });
  return machineId;
}

async function checkMachineAlerts() {
  if (!WHATSAPP_ENABLED) return;
  try {
    const { rows } = await pool.query(
      `SELECT ld.machine_id, m.machine_name, ld.dc_status, ld.last_status
         FROM machine_live_data ld
         LEFT JOIN machines m ON m.machine_id = ld.machine_id`
    );
    const recipients = await getRecipients();
    if (!recipients.length) return;

    const now = Date.now();
    for (const m of rows) {
      const id = m.machine_id;
      const status = m.last_status || m.dc_status || 'OFFLINE';
      const prev = machineAlertState[id] || {};
      const isDown = ['OFFLINE', 'STOPPED', 'DOWNTIME'].includes(status);

      // Recovered / running: clear all state including any acknowledgement.
      if (!isDown) { machineAlertState[id] = { lastStatus: status }; continue; }

      const wasOk = !['OFFLINE', 'STOPPED', 'DOWNTIME'].includes(prev.lastStatus);
      const cooledDown = !prev.lastAlertAt || (now - prev.lastAlertAt) > ALERT_COOLDOWN_MS;
      const firstSeen = prev.lastStatus === undefined;
      const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      const st = { ...prev, lastStatus: status };

      // Alert on a fresh downturn or after cooldown — but NOT if acknowledged.
      if ((wasOk || cooledDown) && !prev.acknowledged && !firstSeen) {
        await Promise.all(recipients.map((to) => sendWhatsAppAlert(to, m.machine_name || id, status, time, id)));
        st.lastAlertAt = now;
        st.acknowledged = false;
        if (wasOk || !st.firstAlertAt) { st.firstAlertAt = now; st.escalated = false; } // new incident
      }

      // Escalate to the owner if still down & unacknowledged past the threshold.
      if (ESCALATE_TO && st.firstAlertAt && !st.acknowledged && !st.escalated
          && (now - st.firstAlertAt) > ESCALATE_MS && !firstSeen) {
        await sendWhatsAppAlert(ESCALATE_TO, `${m.machine_name || id} (UNACK ${Math.round(ESCALATE_MS / 60000)}m)`, status, time, id);
        st.escalated = true;
        obs.log('info', 'alert.escalated', { alert_id: id, to: ESCALATE_TO });
      }

      machineAlertState[id] = st;
    }
  } catch (err) {
    console.error('[ALERT] Check failed:', err.message);
  }
}

module.exports = {
  messageIdOf,
  WHATSAPP_ENABLED, ALERT_COOLDOWN_MS, machineAlertState,
  getRecipients, sendTemplate, sendWhatsAppAlert, sendText, checkMachineAlerts,
  handleInboundReply, acknowledgeMachine,
};
