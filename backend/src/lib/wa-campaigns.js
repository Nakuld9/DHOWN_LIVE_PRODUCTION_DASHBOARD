// WhatsApp marketing campaigns (blasts) — business-initiated bulk sends using an
// APPROVED MARKETING template.
//
// Compliance is built in, not optional:
//   * Only recipients who EXPLICITLY opted in to MARKETING are ever queued or sent
//     (wa_consent.marketing_ok). Opt-out is re-checked at send time.
//   * Only a MARKETING-category template that YOU have approved in Meta is used —
//     the template name is configured per campaign; nothing is invented.
//   * Sends are throttled and idempotent (only QUEUED rows are processed), so a
//     retry never double-sends.
// MES never fabricates consent; if nobody opted in, a blast reaches nobody — which
// is the correct, lawful behaviour.

let ensured = false;

module.exports = ({ pool, sendTemplate, consent }) => {
  async function ensure() {
    if (ensured) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_campaigns (
        campaign_id   BIGSERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        template_name TEXT NOT NULL,
        lang          TEXT NOT NULL DEFAULT 'en',
        body_params   JSONB NOT NULL DEFAULT '[]',   -- tokens, may contain {{name}}
        audience      JSONB NOT NULL DEFAULT '{}',    -- {category, only_customers}
        status        TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT','QUEUED','SENDING','DONE','CANCELLED')),
        total         INTEGER NOT NULL DEFAULT 0,
        sent          INTEGER NOT NULL DEFAULT 0,
        failed        INTEGER NOT NULL DEFAULT 0,
        skipped       INTEGER NOT NULL DEFAULT 0,
        created_by    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS wa_campaign_recipients (
        id            BIGSERIAL PRIMARY KEY,
        campaign_id   BIGINT NOT NULL REFERENCES wa_campaigns(campaign_id) ON DELETE CASCADE,
        phone         TEXT NOT NULL,
        partner_id    INTEGER,
        name          TEXT,
        status        TEXT NOT NULL DEFAULT 'QUEUED'
                        CHECK (status IN ('QUEUED','SENT','FAILED','SKIPPED')),
        wa_message_id TEXT,
        error         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (campaign_id, phone)
      );
      CREATE INDEX IF NOT EXISTS idx_wa_camp_recip_campaign ON wa_campaign_recipients(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_wa_camp_recip_status ON wa_campaign_recipients(status);
    `);
    ensured = true;
  }

  const digits = (p) => String(p || '').replace(/\D/g, '');

  // The eligible marketing audience: EXPLICIT marketing opt-ins only, de-duplicated
  // by phone, optionally narrowed to a partner category / customers with a partner.
  async function eligible(audience = {}) {
    await ensure();
    const params = []; const where = [`c.marketing_ok = true`, `c.status <> 'REVOKED'`];
    if (audience.only_customers) where.push(`c.partner_id IS NOT NULL`);
    if (audience.category) { params.push(audience.category); where.push(`p.customer_category = $${params.length}`); }
    const rows = (await pool.query(
      `SELECT DISTINCT ON (c.phone) c.phone, c.partner_id, p.company_name AS name
         FROM wa_consent c LEFT JOIN partners p ON p.partner_id = c.partner_id
        WHERE ${where.join(' AND ')} ORDER BY c.phone`, params)).rows;
    return rows;
  }

  async function preview(audience) {
    const rows = await eligible(audience);
    return { count: rows.length, sample: rows.slice(0, 20).map(r => ({ phone: r.phone, name: r.name })),
      note: rows.length ? null : 'No customers have opted in to marketing yet. Marketing messages can only go to explicit opt-ins.' };
  }

  async function create(body, user) {
    await ensure();
    const b = body || {};
    if (!b.name || !b.template_name) return { error: 'Campaign name and approved MARKETING template name are required.', code: 400 };
    const r = (await pool.query(
      `INSERT INTO wa_campaigns (name, template_name, lang, body_params, audience, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.name, b.template_name, b.lang || 'en', JSON.stringify(Array.isArray(b.body_params) ? b.body_params : []),
       JSON.stringify(b.audience || {}), user?.username || null])).rows[0];
    return { ok: true, campaign: r };
  }

  const get = async (id) => {
    await ensure();
    const c = (await pool.query(`SELECT * FROM wa_campaigns WHERE campaign_id=$1`, [id])).rows[0];
    if (!c) return null;
    const recips = (await pool.query(`SELECT status, COUNT(*) n FROM wa_campaign_recipients WHERE campaign_id=$1 GROUP BY status`, [id])).rows;
    return { ...c, recipients: recips };
  };
  const list = async () => { await ensure(); return (await pool.query(`SELECT * FROM wa_campaigns ORDER BY campaign_id DESC`)).rows; };

  // Snapshot the eligible audience into recipients (QUEUED). Idempotent-ish: re-queue
  // only adds new phones. Sets the campaign to QUEUED.
  async function enqueue(id, user) {
    const c = (await pool.query(`SELECT * FROM wa_campaigns WHERE campaign_id=$1`, [id])).rows[0];
    if (!c) return { error: 'Campaign not found', code: 404 };
    if (['SENDING', 'DONE'].includes(c.status)) return { error: `Campaign is ${c.status}.`, code: 409 };
    const rows = await eligible(c.audience || {});
    let added = 0;
    for (const r of rows) {
      const ins = await pool.query(
        `INSERT INTO wa_campaign_recipients (campaign_id, phone, partner_id, name)
         VALUES ($1,$2,$3,$4) ON CONFLICT (campaign_id, phone) DO NOTHING RETURNING id`,
        [id, digits(r.phone), r.partner_id || null, r.name || null]);
      if (ins.rows.length) added++;
    }
    const total = (await pool.query(`SELECT COUNT(*)::int n FROM wa_campaign_recipients WHERE campaign_id=$1`, [id])).rows[0].n;
    await pool.query(`UPDATE wa_campaigns SET status='QUEUED', total=$2, updated_at=NOW() WHERE campaign_id=$1`, [id, total]);
    return { ok: true, queued: total, added };
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const paramsFor = (tokens, recip) => (tokens || []).map(t => String(t).replace(/\{\{\s*name\s*\}\}/gi, recip.name || 'Sir/Madam'));

  // Drain QUEUED recipients in a throttled batch. Only sends to those STILL marketing-
  // consented at send time. Idempotent: a re-run picks up only remaining QUEUED rows.
  async function send(id, { limit = 200 } = {}) {
    const c = (await pool.query(`SELECT * FROM wa_campaigns WHERE campaign_id=$1`, [id])).rows[0];
    if (!c) return { error: 'Campaign not found', code: 404 };
    if (c.status === 'DRAFT') return { error: 'Enqueue the audience before sending.', code: 400 };
    if (c.status === 'CANCELLED') return { error: 'Campaign is cancelled.', code: 409 };
    await pool.query(`UPDATE wa_campaigns SET status='SENDING', updated_at=NOW() WHERE campaign_id=$1`, [id]);

    const batch = (await pool.query(
      `SELECT * FROM wa_campaign_recipients WHERE campaign_id=$1 AND status='QUEUED' ORDER BY id LIMIT $2`, [id, limit])).rows;
    let sent = 0, failed = 0, skipped = 0;
    for (const r of batch) {
      // Re-check consent at the moment of sending — an opt-out must stop the send.
      const ok = consent ? (await consent.canSend(r.phone, 'MARKETING')).allowed : true;
      if (!ok) {
        await pool.query(`UPDATE wa_campaign_recipients SET status='SKIPPED', error='not marketing-consented at send time', updated_at=NOW() WHERE id=$1`, [r.id]);
        skipped++; continue;
      }
      let res = null;
      try { res = await sendTemplate(r.phone, c.template_name, c.lang, paramsFor(c.body_params, r)); } catch (e) { res = { error: { message: e.message } }; }
      if (res && res.messages && res.messages[0]) {
        await pool.query(`UPDATE wa_campaign_recipients SET status='SENT', wa_message_id=$2, error=NULL, updated_at=NOW() WHERE id=$1`, [r.id, res.messages[0].id]);
        sent++;
      } else {
        const err = res?.error?.message || 'send failed (check template approval / number)';
        await pool.query(`UPDATE wa_campaign_recipients SET status='FAILED', error=$2, updated_at=NOW() WHERE id=$1`, [r.id, String(err).slice(0, 300)]);
        failed++;
      }
      await sleep(120); // throttle ~8/sec to respect messaging limits
    }
    // Roll up totals + finalise status when nothing QUEUED remains.
    const agg = (await pool.query(`SELECT status, COUNT(*)::int n FROM wa_campaign_recipients WHERE campaign_id=$1 GROUP BY status`, [id])).rows
      .reduce((a, x) => (a[x.status] = x.n, a), {});
    const remaining = agg.QUEUED || 0;
    await pool.query(`UPDATE wa_campaigns SET sent=$2, failed=$3, skipped=$4, status=$5, updated_at=NOW() WHERE campaign_id=$1`,
      [id, agg.SENT || 0, agg.FAILED || 0, agg.SKIPPED || 0, remaining > 0 ? 'SENDING' : 'DONE']);
    return { ok: true, batch: batch.length, sent, failed, skipped, remaining };
  }

  async function cancel(id) {
    await ensure();
    await pool.query(`UPDATE wa_campaigns SET status='CANCELLED', updated_at=NOW() WHERE campaign_id=$1 AND status IN ('DRAFT','QUEUED','SENDING')`, [id]);
    return { ok: true };
  }

  return { ensure, create, preview, enqueue, send, get, list, cancel, eligible };
};
