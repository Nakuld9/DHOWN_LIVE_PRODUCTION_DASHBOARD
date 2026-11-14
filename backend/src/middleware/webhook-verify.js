// WhatsApp Cloud API webhook signature verification.
//
// Meta signs every webhook POST with an HMAC-SHA256 of the RAW request body,
// keyed by the app's App Secret, in the header:
//
//   X-Hub-Signature-256: sha256=<hex digest>
//
// The signature must be computed over the exact bytes Meta sent — not the
// re-serialised parsed object, which can differ in key order and whitespace and
// would never match. server.js therefore captures req.rawBody in the body
// parser's verify hook, and this middleware uses that.
//
// It FAILS CLOSED. If WHATSAPP_APP_SECRET is not configured, every webhook is
// rejected rather than waved through — an unverified webhook is exactly the hole
// this exists to close, so "not configured" must not silently mean "no
// verification". The boot warning below makes the missing secret loud.
//
// It never logs the secret, the signature, or the payload.

const crypto = require('crypto');
const obs = require('../lib/observability');

// The App Secret comes from Meta App Dashboard → Settings → Basic → App Secret.
// It is NOT the access token and NOT the verify token — a common and dangerous
// mix-up, so the name is explicit.
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';

let warned = false;
function warnIfUnconfigured() {
  if (!APP_SECRET && !warned) {
    warned = true;
    console.warn('[SECURITY] WHATSAPP_APP_SECRET is not set — the WhatsApp webhook will REJECT all events. ' +
      'Set it to your Meta App Secret (App Dashboard → Settings → Basic) to accept live webhooks.');
  }
}
warnIfUnconfigured();

function verifyWhatsappSignature(req, res, next) {
  // Fail closed on missing configuration.
  if (!APP_SECRET) {
    warnIfUnconfigured();
    obs.inc('wa_webhook_rejected_total', { reason: 'no_secret' });
    return res.status(503).json({ error: 'Webhook verification is not configured' });
  }

  const header = req.get('x-hub-signature-256') || '';
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header);
  if (!m) {
    obs.inc('wa_webhook_rejected_total', { reason: 'no_signature' });
    return res.sendStatus(401);
  }

  // The raw bytes, captured by the body parser. Without them there is nothing
  // trustworthy to verify against.
  const raw = req.rawBody;
  if (!raw || !raw.length) {
    obs.inc('wa_webhook_rejected_total', { reason: 'no_raw_body' });
    return res.sendStatus(401);
  }

  const expected = crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  const given = m[1].toLowerCase();

  // Constant-time compare — a plain === leaks timing information about how much
  // of the digest matched.
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(given, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    obs.inc('wa_webhook_rejected_total', { reason: 'bad_signature' });
    return res.sendStatus(401);
  }

  obs.inc('wa_webhook_verified_total');
  return next();
}

module.exports = { verifyWhatsappSignature, APP_SECRET_CONFIGURED: !!APP_SECRET };
