// Health watcher — turns metrics into somebody actually finding out.
//
// Metrics alone did not fail us; nobody looking at them did. This checks the
// conditions that were silent in the vision incident and alerts the operator
// over the channel they already read.
//
// Alerts are throttled per condition so a sustained outage produces one message,
// not one every cycle — an alert stream people mute is worse than none.

const obs = require('./observability');

const CHECK_MS      = (Number(process.env.HEALTH_CHECK_MIN) || 15) * 60 * 1000;
const REALERT_MS    = (Number(process.env.HEALTH_REALERT_HOURS) || 6) * 60 * 60 * 1000;
const SEND_FAIL_MAX = Number(process.env.HEALTH_SEND_FAIL_PCT) || 20;

module.exports = (pool, { sendText, jobLock } = {}) => {
  const lastAlertAt = new Map();

  function shouldAlert(condition) {
    const last = lastAlertAt.get(condition) || 0;
    if (Date.now() - last < REALERT_MS) return false;
    lastAlertAt.set(condition, Date.now());
    return true;
  }

  function clear(condition) { lastAlertAt.delete(condition); }

  // Who hears about it. Falls back to the supervisors already receiving machine
  // alerts — an unset variable must not mean "nobody is told".
  function recipients() {
    const raw = process.env.HEALTH_ALERT_TO
             || process.env.WHATSAPP_ESCALATE_TO
             || process.env.WHATSAPP_TO
             || '';
    return raw.split(/[,;\s]+/).filter(Boolean);
  }

  async function notify(condition, message) {
    // Log the condition every cycle (that is the record), but only send — and
    // only claim to have sent — when the throttle actually allows it.
    obs.log('warn', 'health.condition', { condition, message });
    if (!shouldAlert(condition)) return;

    const to = recipients();
    if (!sendText || !to.length) {
      obs.log('error', 'health.alert.undeliverable', {
        condition,
        detail: 'A system alert fired but no recipient is configured. Set HEALTH_ALERT_TO.',
      });
      return;
    }
    for (const n of to) {
      try {
        await sendText(n, `⚠️ MES system alert\n\n${message}`);
        obs.log('error', 'health.alert.sent', { condition, to: n });
      } catch (e) {
        obs.log('error', 'health.alert.failed', { condition, to: n, error: e.message });
      }
    }
  }

  async function check() {
    const problems = [];

    // 1. AI providers — the vision incident, caught this time.
    const health = obs.providerHealth();
    for (const [name, p] of Object.entries(health)) {
      const cond = `provider:${name}`;
      if (p.state === 'down' && p.calls >= 3) {
        problems.push(`${name} is failing every call (${p.fail} failures). Last error: ${p.lastError || 'unknown'}`);
        await notify(cond, `${name} is DOWN — ${p.fail} consecutive failures. Last error: ${p.lastError || 'unknown'}`);
      } else if (p.state === 'degraded') {
        problems.push(`${name} failing ${Math.round(p.fail_rate * 100)}% of calls`);
        await notify(cond, `${name} is degraded — ${Math.round(p.fail_rate * 100)}% of calls failing.`);
      } else if (p.state === 'ok') clear(cond);
    }

    // 2. No vision provider at all — images are being discarded right now.
    if (!process.env.NVIDIA_API_KEY && !process.env.GROQ_API_KEY) {
      problems.push('No AI provider configured');
      await notify('ai:none', 'No AI provider is configured — the assistant and image reading are both offline.');
    }

    // 3. WhatsApp send failures reported by Meta in the last hour.
    try {
      const r = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE status='failed') AS failed, COUNT(*) AS total
           FROM wa_messages
          WHERE direction='OUT' AND created_at > NOW() - INTERVAL '1 hour'`);
      const { failed, total } = r.rows[0];
      obs.gauge('wa_send_failed_1h', Number(failed));
      if (Number(total) >= 5) {
        const pct = (Number(failed) / Number(total)) * 100;
        if (pct >= SEND_FAIL_MAX) {
          problems.push(`${Math.round(pct)}% of WhatsApp sends failed in the last hour`);
          await notify('wa:sendfail',
            `${Math.round(pct)}% of WhatsApp messages failed to send in the last hour (${failed}/${total}). Check the token, the 24-hour window and template status.`);
        } else clear('wa:sendfail');
      }
    } catch (e) { obs.log('error', 'health.check.failed', { part: 'send-failures', error: e.message }); }

    // 4. Token expiry is a scheduled outage nobody remembers to prevent.
    const exp = process.env.WHATSAPP_TOKEN_EXPIRES_AT;
    if (exp) {
      const days = Math.floor((new Date(exp).getTime() - Date.now()) / 86400000);
      obs.gauge('wa_token_days_left', days);
      if (days <= 7) {
        problems.push(`WhatsApp token expires in ${days} day(s)`);
        await notify('wa:token', `The WhatsApp access token expires in ${days} day(s). Rotate it before customer messaging stops.`);
      }
    }

    // 5. Unanswered customer messages — a business signal, not a technical one.
    try {
      const r = await pool.query(
        `SELECT COUNT(*) n FROM wa_conversations c
          WHERE (SELECT direction FROM wa_messages m WHERE m.conversation_id=c.conversation_id
                  ORDER BY created_at DESC LIMIT 1) = 'IN'
            AND c.last_message_at < NOW() - INTERVAL '4 hours'`);
      obs.gauge('wa_unanswered_over_4h', Number(r.rows[0].n));
    } catch { /* metric only */ }

    obs.gauge('health_problems', problems.length);
    if (problems.length) obs.log('warn', 'health.degraded', { problems });
    return { ok: problems.length === 0, problems, providers: health };
  }

  function start() {
    const to = recipients();
    if (!to.length) {
      // Say so at boot rather than discovering it during an incident.
      obs.log('error', 'health.watch.no_recipient',
        { detail: 'Health alerts have nowhere to go — set HEALTH_ALERT_TO or WHATSAPP_TO.' });
    }
    if (jobLock) jobLock.schedule('health-check', check, CHECK_MS, { delayMs: 90 * 1000 });
    else {
      setInterval(() => { check().catch(e => obs.log('error', 'health.watch', { error: e.message })); }, CHECK_MS);
      setTimeout(() => { check().catch(() => {}); }, 90 * 1000);
    }
    obs.log('info', 'health.watch.started', { every_min: CHECK_MS / 60000, recipients: to.length });
  }

  return { check, start };
};
