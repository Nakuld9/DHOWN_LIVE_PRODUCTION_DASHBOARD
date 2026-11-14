// Consent (§24) — Meta Business Messaging policy + India's DPDP Act 2023.
//
// Three purposes, deliberately not one flag:
//   SERVICE       replying inside the 24h window to someone who wrote to us.
//                 Implied by their message; blocked only after an opt-out.
//   TRANSACTIONAL order confirmations, dispatch notes, invoices — messages about
//                 business the customer actually asked for. Blocked after opt-out.
//   MARKETING     outreach, offers, reorder nudges. Requires EXPLICIT opt-in.
//
// The guard lives at the send layer, not in the UI, so no caller can bypass it.

const PURPOSES = ['SERVICE', 'TRANSACTIONAL', 'MARKETING'];

// Customers write "stop" in several languages here. Matched on the whole
// message so "don't stop production" can never be read as an opt-out.
const STOP_RE = /^(stop|unsubscribe|opt\s*out|band\s*karo|bandh?\s*karo|mat\s*bhejo|message\s*mat|no\s*more\s*messages|hatao|remove\s*me)\.?$/i;
const START_RE = /^(start|subscribe|opt\s*in|resume|chalu\s*karo|shuru\s*karo)\.?$/i;

// A DEDICATED, unambiguous marketing opt-in keyword the business asks customers to
// send (distinct from START, which just resumes service). Configurable; the first
// entry is the one the invite tells customers to reply with.
const MKT_KEYWORDS = (process.env.WA_MARKETING_OPTIN_KEYWORDS || 'OFFERS,DEALS,YES OFFERS,SUBSCRIBE OFFERS,JOIN OFFERS')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const digits = (p) => String(p || '').replace(/\D/g, '');

module.exports = (pool) => {

  const isStopKeyword  = (text) => STOP_RE.test(String(text || '').trim());
  const isStartKeyword = (text) => START_RE.test(String(text || '').trim());
  const isMarketingOptInKeyword = (text) => MKT_KEYWORDS.includes(String(text || '').trim().toLowerCase().replace(/[.!]+$/, ''));
  const marketingKeyword = () => (MKT_KEYWORDS[0] || 'offers').toUpperCase();

  function log(phone, action, { purpose, detail, actor, proofRef } = {}) {
    return pool.query(
      `INSERT INTO wa_consent_log (phone, action, purpose, detail, actor, proof_ref)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [digits(phone), action, purpose || null, detail || null, actor || 'SYSTEM', proofRef || null]
    ).catch(e => console.error('[consent log]', e.message));
  }

  async function get(phone) {
    const r = await pool.query(`SELECT * FROM wa_consent WHERE phone = $1`, [digits(phone)]);
    return r.rows[0] || null;
  }

  // A customer messaging us establishes implied consent for service replies.
  // Never upgrades an existing record — in particular it must not silently
  // resurrect consent for someone who opted out.
  async function recordImplied(phone, { partnerId, proofRef } = {}) {
    const p = digits(phone);
    const r = await pool.query(
      `INSERT INTO wa_consent (phone, partner_id, status, source, proof_ref, granted_at)
       VALUES ($1,$2,'IMPLIED','INBOUND_MESSAGE',$3,NOW())
       ON CONFLICT (phone) DO NOTHING
       RETURNING consent_id`, [p, partnerId || null, proofRef || null]);
    if (r.rows.length) await log(p, 'IMPLIED', { purpose: 'SERVICE', actor: 'CUSTOMER', proofRef });
    return r.rows.length > 0;
  }

  async function optIn(phone, { actor, proofRef, detail, partnerId } = {}) {
    const p = digits(phone);
    await pool.query(
      `INSERT INTO wa_consent (phone, partner_id, status, marketing_ok, source, proof_ref, granted_at, revoked_at, revoke_reason, updated_at)
       VALUES ($1,$2,'OPTED_IN',TRUE,$3,$4,NOW(),NULL,NULL,NOW())
       ON CONFLICT (phone) DO UPDATE SET
         status='OPTED_IN', marketing_ok=TRUE, source=EXCLUDED.source,
         proof_ref=COALESCE(EXCLUDED.proof_ref, wa_consent.proof_ref),
         granted_at=NOW(), revoked_at=NULL, revoke_reason=NULL, updated_at=NOW()`,
      [p, partnerId || null, actor === 'CUSTOMER' ? 'CUSTOMER_REPLY' : 'STAFF', proofRef || null]);
    await log(p, 'OPT_IN', { purpose: 'MARKETING', actor, detail, proofRef });
    return get(p);
  }

  async function optOut(phone, { actor, reason, proofRef } = {}) {
    const p = digits(phone);
    await pool.query(
      `INSERT INTO wa_consent (phone, status, marketing_ok, revoked_at, revoke_reason, updated_at)
       VALUES ($1,'OPTED_OUT',FALSE,NOW(),$2,NOW())
       ON CONFLICT (phone) DO UPDATE SET
         status='OPTED_OUT', marketing_ok=FALSE, revoked_at=NOW(),
         revoke_reason=EXCLUDED.revoke_reason, updated_at=NOW()`,
      [p, reason || null]);
    await log(p, 'OPT_OUT', { actor, detail: reason, proofRef });
    return get(p);
  }

  // The gate. Returns { allowed, reason }.
  async function canSend(phone, purpose = 'SERVICE') {
    const kind = PURPOSES.includes(purpose) ? purpose : 'SERVICE';
    const c = await get(phone);

    // No record yet: service and transactional are fine (they only happen in
    // response to the customer), marketing is not.
    if (!c) {
      return kind === 'MARKETING'
        ? { allowed: false, reason: 'No opt-in on record for marketing messages.' }
        : { allowed: true };
    }
    if (c.status === 'OPTED_OUT') {
      return { allowed: false, reason: 'Customer has opted out of WhatsApp messages.' };
    }
    if (kind === 'MARKETING' && !c.marketing_ok) {
      return { allowed: false, reason: 'Customer has not opted in to marketing messages.' };
    }
    return { allowed: true };
  }

  // Same check, but records the refusal — a blocked send is exactly the thing a
  // compliance review asks to see.
  async function guard(phone, purpose, actor) {
    const v = await canSend(phone, purpose);
    if (!v.allowed) await log(phone, 'BLOCKED_SEND', { purpose, detail: v.reason, actor });
    return v;
  }

  async function history(phone, limit = 50) {
    const r = await pool.query(
      `SELECT * FROM wa_consent_log WHERE phone = $1 ORDER BY created_at DESC LIMIT $2`,
      [digits(phone), limit]);
    return r.rows;
  }

  async function register({ status } = {}) {
    const r = await pool.query(
      `SELECT c.*, p.company_name,
              (SELECT conversation_id FROM wa_conversations w WHERE w.phone = c.phone LIMIT 1) AS conversation_id
         FROM wa_consent c
         LEFT JOIN partners p ON p.partner_id = c.partner_id
        WHERE ($1::text IS NULL OR c.status = $1)
        ORDER BY c.updated_at DESC LIMIT 300`, [status || null]);
    return r.rows;
  }

  return { isStopKeyword, isStartKeyword, isMarketingOptInKeyword, marketingKeyword,
           get, recordImplied, optIn, optOut, canSend, guard, history, register, PURPOSES };
};
