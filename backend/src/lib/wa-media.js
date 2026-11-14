const tenant = require('../../config/tenant');
// WhatsApp media — inbound download and outbound upload/send (Cloud API).
//
// Inbound: Meta gives a media_id; you must GET /{media_id} for a short-lived URL,
// then fetch that URL with the token. Files land in uploads/wa/ and are served
// back to the MES UI through /api/wa/media/:messageId (JWT-gated).
// Outbound: POST the bytes to /{phone_id}/media to get an id, then send it.

const https = require('https');
const fs = require('fs');
const path = require('path');

const WA_VERSION  = process.env.WHATSAPP_VERSION  || 'v21.0';
const WA_TOKEN    = process.env.WHATSAPP_TOKEN    || '';
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID || '';

const MEDIA_DIR = path.join(__dirname, '..', '..', 'uploads', 'wa');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const EXT = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'application/pdf': '.pdf', 'video/mp4': '.mp4', 'audio/ogg': '.ogg',
};

function getJson(pathOrUrl) {
  return new Promise((resolve) => {
    const opts = pathOrUrl.startsWith('http')
      ? new URL(pathOrUrl)
      : { hostname: 'graph.facebook.com', path: pathOrUrl };
    https.get({
      hostname: opts.hostname, path: opts.pathname ? opts.pathname + (opts.search || '') : opts.path,
      headers: { Authorization: `Bearer ${WA_TOKEN}` },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

// Download one inbound media object to disk. Returns { file, mime } or null.
async function downloadMedia(mediaId) {
  if (!WA_TOKEN || !mediaId) return null;
  const meta = await getJson(`/${WA_VERSION}/${mediaId}`);
  if (!meta || !meta.url) return null;

  const mime = meta.mime_type || 'application/octet-stream';
  const file = `${mediaId}${EXT[mime.split(';')[0]] || ''}`;
  const dest = path.join(MEDIA_DIR, file);

  const ok = await new Promise((resolve) => {
    const u = new URL(meta.url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { Authorization: `Bearer ${WA_TOKEN}` } },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(false); }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(true)));
        out.on('error', () => resolve(false));
      }).on('error', () => resolve(false));
  });

  return ok ? { file, mime, path: dest } : null;
}

// Upload a local file to Meta, returning its media_id (needed before sending).
function uploadMedia(filePath, mime) {
  return new Promise((resolve) => {
    if (!WA_TOKEN || !WA_PHONE_ID || !fs.existsSync(filePath)) return resolve(null);
    const boundary = '----dhown' + Date.now();
    const name = path.basename(filePath);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${mime}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, fs.readFileSync(filePath), tail]);

    const req = https.request({
      hostname: 'graph.facebook.com', path: `/${WA_VERSION}/${WA_PHONE_ID}/media`, method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).id || null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    if (!WA_TOKEN || !WA_PHONE_ID) return resolve(null);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'graph.facebook.com', path: `/${WA_VERSION}/${WA_PHONE_ID}/messages`, method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 300) console.error('[WA media] send failed:', d.slice(0, 250));
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

const toE164 = (m) => {
  const d = String(m || '').replace(/\D/g, '');
  if (!d) return null;
  return d.length === 10 ? `91${d}` : d;
};

// Send a local file as an image or document. Returns Meta's response or null.
async function sendMedia(mobile, filePath, mime, caption) {
  const to = toE164(mobile);
  if (!to) return null;
  const id = await uploadMedia(filePath, mime);
  if (!id) return null;
  const isImage = mime.startsWith('image/');
  return sendMessage({
    messaging_product: 'whatsapp', to,
    type: isImage ? 'image' : 'document',
    ...(isImage
      ? { image: { id, ...(caption ? { caption } : {}) } }
      : { document: { id, filename: path.basename(filePath), ...(caption ? { caption } : {}) } }),
  });
}

// §3 — describe a customer's photo (fabric, shade card, roll label, invoice, PO)
// so the conversation has something actionable. Returns null when no vision model
// is configured; the pipeline then simply has no description rather than a guess.
async function describeImage(fileName, caption) {
  const { vision } = require('./wa-llm');
  const file = path.join(MEDIA_DIR, path.basename(fileName || ''));
  if (!fs.existsSync(file)) return null;

  const SYS = `You look at photos sent to ${tenant.name}, a ${tenant.business}
by customers. Identify only what is actually visible. Reply in 1-3 short lines:
what the image is (fabric swatch / shade card / roll or label / invoice / purchase
order / packing slip / screenshot / other), and any product name, shade name or
code, GSM, quantity or document number you can actually read.
If something is unreadable or absent, say so — never guess a product or a number.`;

  const out = await vision(SYS, caption ? `Customer wrote: "${caption}"` : 'What does this show?',
    fs.readFileSync(file).toString('base64'),
    EXT_MIME[path.extname(file).toLowerCase()] || 'image/jpeg');
  if (!out) return null;

  // Reasoning models emit a <think> block; keep only the actual answer so the
  // stored description (and anything the AI later reads) stays clean.
  const clean = String(out)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')   // unterminated block (hit the token cap)
    .trim();
  return clean || null;
}

const EXT_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

module.exports = { downloadMedia, uploadMedia, sendMedia, describeImage, MEDIA_DIR };
