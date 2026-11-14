// CommonJS chat helper for the WhatsApp AI CRM.
//
// src/ai/glm.js is ESM and takes a single prompt, so it can't be require()d from
// the CJS backend with a system+user pair. This wrapper speaks the OpenAI-compatible
// chat API directly: NVIDIA/GLM primary, Groq fallback, both already configured in .env.

const https = require('https');
const obs = require('./observability');

function postJson({ hostname, path, apiKey, body }) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 45000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(j.choices?.[0]?.message?.content || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

// Returns the assistant text, or null if every provider fails (callers degrade
// gracefully — the CRM never fabricates data when the LLM is unavailable).
// Circuit breaker on the primary provider.
//
// The fallback worked, but it cost the full socket timeout on EVERY call: the
// primary endpoint was hanging rather than refusing, so each reply took about
// 38 seconds when Groq alone answers in under two. In AUTO mode that is 38
// seconds of a customer waiting, on every message, for a provider that has been
// dead for days.
//
// After a few consecutive failures the primary is skipped entirely for a cooling
// period, then retried once — so a provider that comes back is picked up
// automatically, and one that stays down costs nothing.
// Trips on the SECOND consecutive failure rather than the third, and cools down
// in five minutes rather than ten. The asymmetry is deliberate: being wrong
// costs one extra fallback call, which the fallback handles in about a second,
// while being slow costs 38 seconds on every message. Tolerating one blip before
// tripping avoids reacting to a single transient error.
//
// State is per process, so a freshly started CLI pays the penalty until it
// trips. The long-running server pays it once per restart.
const BREAKER = { failures: 0, openUntil: 0 };
const BREAKER_TRIP_AFTER = Number(process.env.AI_BREAKER_TRIP_AFTER || 2);
const BREAKER_COOLDOWN_MS = Number(process.env.AI_BREAKER_COOLDOWN_MIN || 5) * 60_000;

function primaryAvailable() {
  if (Date.now() < BREAKER.openUntil) return false;
  return true;
}

function recordPrimary(ok) {
  if (ok) {
    if (BREAKER.failures > 0) {
      obs.log('info', 'ai.primary.recovered', { after_failures: BREAKER.failures });
    }
    BREAKER.failures = 0;
    BREAKER.openUntil = 0;
    return;
  }
  BREAKER.failures += 1;
  if (BREAKER.failures >= BREAKER_TRIP_AFTER && Date.now() >= BREAKER.openUntil) {
    BREAKER.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    obs.log('warn', 'ai.primary.circuit_open', {
      failures: BREAKER.failures,
      minutes: BREAKER_COOLDOWN_MS / 60000,
      note: 'skipping the primary provider until it cools down; the fallback answers directly',
    });
  }
}

function breakerState() {
  return {
    failures: BREAKER.failures,
    open: Date.now() < BREAKER.openUntil,
    reopens_in_s: Math.max(0, Math.round((BREAKER.openUntil - Date.now()) / 1000)),
  };
}

async function chat(systemPrompt, userMessage) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMessage },
  ];

  // The NVIDIA/GLM "primary" is opt-in: when it hangs it costs the full socket
  // timeout on every call (measured ~20-40s) before the Groq fallback answers,
  // which is unusable for the live customer web chat. Default to Groq directly;
  // set WA_LLM_PRIMARY=true only when the primary is known-good.
  const nvKey = process.env.NVIDIA_API_KEY;
  if (process.env.WA_LLM_PRIMARY === 'true' && nvKey && primaryAvailable()) {
    const host = (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1')
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const t0 = Date.now();
    const out = await postJson({
      hostname: host, path: '/v1/chat/completions', apiKey: nvKey,
      body: { model: process.env.GLM_MODEL || 'z-ai/glm-5.2', messages, temperature: 0.3, stream: false },
    });
    obs.recordProvider('nvidia:chat', { ok: !!out, ms: Date.now() - t0, error: out ? null : 'no response' });
    recordPrimary(!!out);
    if (out) return out;
    obs.inc('ai_fallback_total', { from: 'nvidia', kind: 'chat' });
    obs.log('warn', 'ai.fallback', { from: 'nvidia', kind: 'chat' });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const t1 = Date.now();
    const out = await postJson({
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', apiKey: groqKey,
      body: { model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', messages, temperature: 0.3, stream: false },
    });
    obs.recordProvider('groq:chat', { ok: !!out, ms: Date.now() - t1, error: out ? null : 'no response' });
    if (out) return out;
  }

  return null;
}

// §3 image understanding — describe a customer's photo (fabric, shade card,
// roll label, invoice, PO) so the text pipeline can act on it. Returns null if
// no vision-capable provider is configured; callers then fall back to asking
// the customer, rather than guessing what the picture showed.
// Same primary/fallback shape as chat(): NVIDIA first, then Groq. Without the
// fallback a dead primary made every image silently undescribed — the pipeline
// carried on as if the customer had sent nothing.
async function vision(systemPrompt, userText, imageBase64, mime = 'image/jpeg') {
  if (!imageBase64) return null;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText || 'What does this image show?' },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBase64}` } },
      ],
    },
  ];

  const nvKey = process.env.NVIDIA_API_KEY;
  // Same breaker as chat(): vision shares the primary, so a dead endpoint was
  // costing an image description the same 38-second wait.
  if (nvKey && primaryAvailable()) {
    const host = (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1')
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const out = await postJson({
      hostname: host, path: '/v1/chat/completions', apiKey: nvKey,
      body: {
        model: process.env.VISION_MODEL || 'meta/llama-3.2-90b-vision-instruct',
        messages, max_tokens: 400, temperature: 0.2, stream: false,
      },
    });
    obs.recordProvider('nvidia:vision', { ok: !!out, error: out ? null : 'no response' });
    recordPrimary(!!out);
    if (out) return out;
    obs.inc('ai_fallback_total', { from: 'nvidia', kind: 'vision' });
    obs.log('warn', 'ai.fallback', { from: 'nvidia', kind: 'vision' });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const tv = Date.now();
    const out2 = await postJson({
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', apiKey: groqKey,
      body: {
        model: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b',
        messages, max_tokens: 400, temperature: 0.2, stream: false,
      },
    });
    obs.recordProvider('groq:vision', { ok: !!out2, ms: Date.now() - tv, error: out2 ? null : 'no response' });
    return out2;
  }

  obs.log('error', 'ai.vision.unavailable', { detail: 'no vision-capable provider configured — customer images are being discarded' });
  obs.inc('ai_vision_unavailable_total');
  return null;
}

module.exports = { chat, vision, breakerState };
