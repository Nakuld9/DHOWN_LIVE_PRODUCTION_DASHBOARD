// Multi-provider model registry.
//
// Adding a model = a row here + its API key in .env. Everything stays DORMANT until
// its key is set, and the gateway falls back to Groq, so nothing breaks by adding a
// provider you have not keyed yet. Model IDs are env-overridable because vendors
// rename them often — set the exact id (e.g. GLM_MODEL, KIMI_MODEL) when you have
// access; the defaults are best-effort.
//
// Most providers use the OpenAI-compatible /chat/completions shape, so ONE client
// talks to all of them by swapping host + path + key + model. Anthropic (Claude)
// uses its own messages API, handled separately. Image generation is a distinct
// capability (images endpoint), also here.

const https = require('https');

function post(host, path, headers, bodyObj, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(bodyObj);
    const req = https.request({ hostname: host, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: r.statusCode, json: null, raw: d }); } });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 0, json: null, raw: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, json: null, raw: e.message }));
    req.write(body); req.end();
  });
}

// name → provider. host/path for OpenAI-compatible; kind 'anthropic' for Claude.
// caps: chat | vision | image. modelEnv/imageModelEnv let ops set the exact id.
const PROVIDERS = {
  groq:         { kind: 'openai', host: 'api.groq.com', path: '/openai/v1/chat/completions', keyEnv: 'GROQ_API_KEY', modelEnv: 'GROQ_MODEL', model: 'llama-3.3-70b-versatile', visionModelEnv: 'GROQ_VISION_MODEL', visionModel: 'qwen/qwen3.6-27b', caps: ['chat', 'vision'] },
  deepseek:     { kind: 'openai', host: 'api.deepseek.com', path: '/chat/completions', keyEnv: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_MODEL', model: 'deepseek-chat', caps: ['chat'] },
  kimi:         { kind: 'openai', host: 'api.moonshot.ai', path: '/v1/chat/completions', keyEnv: 'MOONSHOT_API_KEY', modelEnv: 'KIMI_MODEL', model: 'moonshot-v1-8k', caps: ['chat'] },
  glm:          { kind: 'openai', host: 'open.bigmodel.cn', path: '/api/paas/v4/chat/completions', keyEnv: 'ZHIPU_API_KEY', modelEnv: 'GLM_MODEL', model: 'glm-4-plus', visionModelEnv: 'GLM_VISION_MODEL', visionModel: 'glm-4v-plus', caps: ['chat', 'vision'] },
  openai:       { kind: 'openai', host: 'api.openai.com', path: '/v1/chat/completions', keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', model: 'gpt-4o-mini', visionModelEnv: 'OPENAI_VISION_MODEL', visionModel: 'gpt-4o-mini', imageHost: 'api.openai.com', imagePath: '/v1/images/generations', imageModelEnv: 'OPENAI_IMAGE_MODEL', imageModel: 'gpt-image-1', caps: ['chat', 'vision', 'image'] },
  nvidia:       { kind: 'openai', host: 'integrate.api.nvidia.com', path: '/v1/chat/completions', keyEnv: 'NVIDIA_API_KEY', modelEnv: 'NVIDIA_MODEL', model: 'nvidia/nemotron-3-ultra-550b-a55b', caps: ['chat'] },
  nemotron_ocr: { kind: 'openai', host: 'integrate.api.nvidia.com', path: '/v1/chat/completions', keyEnv: 'NVIDIA_API_KEY', modelEnv: 'NEMOTRON_OCR_MODEL', model: 'nvidia/nemotron-nano-12b-v2-vl', visionModelEnv: 'NEMOTRON_OCR_MODEL', visionModel: 'nvidia/nemotron-nano-12b-v2-vl', caps: ['vision'] },
  claude:       { kind: 'anthropic', host: 'api.anthropic.com', path: '/v1/messages', keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', model: 'claude-3-5-sonnet-latest', visionModelEnv: 'ANTHROPIC_MODEL', visionModel: 'claude-3-5-sonnet-latest', caps: ['chat', 'vision'] },
  qwen_image:   { kind: 'dashscope', host: 'dashscope-intl.aliyuncs.com', path: '/api/v1/services/aigc/text2image/image-synthesis', keyEnv: 'DASHSCOPE_API_KEY', imageModelEnv: 'QWEN_IMAGE_MODEL', imageModel: 'wan2.2-t2i-flash', caps: ['image'] },
  // NVIDIA FLUX — FREE image generation on the NVIDIA_API_KEY you already have.
  // flux.1-dev is the reliable one (schnell errors on the free tier). ~5s/image.
  nvidia_image: { kind: 'nvidia_image', host: 'ai.api.nvidia.com', imagePath: '/v1/genai/black-forest-labs/flux.1-dev', keyEnv: 'NVIDIA_API_KEY', imageModelEnv: 'NVIDIA_IMAGE_MODEL', imageModel: 'black-forest-labs/flux.1-dev', caps: ['image'] },
};

// FLUX accepts only these side lengths — snap a requested size to the nearest one.
const FLUX_SIDES = [768, 832, 896, 960, 1024, 1088, 1152, 1216, 1280, 1344];
const snapFlux = (n) => FLUX_SIDES.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a, 1024);

// NVIDIA image invoke. NVCF-POLL-SECONDS asks the server to hold the connection
// until the image is ready (flux.1-dev finishes in ~5s), so a single call returns
// the picture. Returns { status, json, nvstatus }.
function nvidiaImagePost(path, key, bodyObj) {
  return new Promise((resolve) => {
    const body = JSON.stringify(bodyObj);
    const req = https.request({ hostname: 'ai.api.nvidia.com', path, method: 'POST',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json',
                 'Content-Length': Buffer.byteLength(body), 'NVCF-POLL-SECONDS': '60' } }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve({ status: r.statusCode, json: JSON.parse(d), nvstatus: r.headers['nvcf-status'] }); }
                          catch { resolve({ status: r.statusCode, raw: d, nvstatus: r.headers['nvcf-status'] }); } });
    });
    req.setTimeout(120000, () => { req.destroy(); resolve({ status: 0, raw: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, raw: e.message }));
    req.write(body); req.end();
  });
}

const keyOf = (p) => process.env[p.keyEnv];
const has = (name) => { const p = PROVIDERS[name]; return !!(p && keyOf(p)); };

// Normalise one-or-many image data URIs to an array.
const asImages = (v) => (v == null ? [] : Array.isArray(v) ? v.filter(Boolean) : [v]);

// Build the vision/text image_url or content parts for OpenAI-compatible calls.
function openaiMessages(system, user, imageDataUri) {
  const imgs = asImages(imageDataUri);
  const userContent = imgs.length
    ? [{ type: 'text', text: user }, ...imgs.map((url) => ({ type: 'image_url', image_url: { url } }))]
    : user;
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push({ role: 'user', content: userContent });
  return msgs;
}

// Unified chat/vision/document completion. Returns { ok, text } or { ok:false, error }.
// pdfBase64 (Anthropic only) reads a PDF natively — text AND scanned pages, layout
// preserved — the right path for dense trade documents.
async function complete(name, system, user, { imageDataUri = null, pdfBase64 = null, maxTokens = 1500 } = {}) {
  const p = PROVIDERS[name];
  if (!p) return { ok: false, error: `unknown provider: ${name}` };
  const key = keyOf(p);
  if (!key) return { ok: false, error: `${name} not configured (set ${p.keyEnv})` };

  if (p.kind === 'anthropic') {
    const model = process.env[(imageDataUri || pdfBase64) ? p.visionModelEnv : p.modelEnv] || ((imageDataUri || pdfBase64) ? p.visionModel : p.model);
    let content;
    if (pdfBase64) content = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } }, { type: 'text', text: user }];
    else if (imageDataUri) content = [{ type: 'text', text: user }, ...asImages(imageDataUri).map((u) => ({ type: 'image', source: { type: 'base64', media_type: (u.match(/^data:(.*?);/) || [])[1] || 'image/jpeg', data: u.split(',')[1] } }))];
    else content = [{ type: 'text', text: user }];
    const r = await post(p.host, p.path, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxTokens, system: system || undefined, messages: [{ role: 'user', content }] }, pdfBase64 ? 90000 : 45000);
    const text = r.json?.content?.[0]?.text;
    return text ? { ok: true, text, provider: name, model } : { ok: false, error: r.json?.error?.message || `HTTP ${r.status}` };
  }
  if (pdfBase64) return { ok: false, error: `${name} does not support native PDF reading — use provider 'claude'.` };

  // OpenAI-compatible
  const model = process.env[imageDataUri ? (p.visionModelEnv || p.modelEnv) : p.modelEnv] || (imageDataUri ? (p.visionModel || p.model) : p.model);
  const r = await post(p.host, p.path, { Authorization: `Bearer ${key}` }, { model, stream: false, max_tokens: maxTokens, messages: openaiMessages(system, user, imageDataUri) });
  const text = r.json?.choices?.[0]?.message?.content;
  return text ? { ok: true, text, provider: name, model } : { ok: false, error: r.json?.error?.message || r.raw || `HTTP ${r.status}` };
}

// Image generation. OpenAI images (b64) or DashScope (Qwen, async — returns a URL).
async function generateImage(name, prompt, { size = '1024x1024' } = {}) {
  const p = PROVIDERS[name];
  if (!p || !p.caps.includes('image')) return { ok: false, error: `${name} cannot generate images` };
  const key = keyOf(p);
  if (!key) return { ok: false, error: `${name} not configured (set ${p.keyEnv})` };
  if (p.kind === 'openai') {
    const model = process.env[p.imageModelEnv] || p.imageModel;
    const r = await post(p.imageHost, p.imagePath, { Authorization: `Bearer ${key}` }, { model, prompt, size, n: 1 }, 90000);
    const d = r.json?.data?.[0];
    if (d?.b64_json) return { ok: true, dataUri: `data:image/png;base64,${d.b64_json}`, provider: name, model };
    if (d?.url) return { ok: true, url: d.url, provider: name, model };
    return { ok: false, error: r.json?.error?.message || `HTTP ${r.status}` };
  }
  if (p.kind === 'nvidia_image') {
    const model = process.env[p.imageModelEnv] || p.imageModel;
    const [w, h] = String(size).toLowerCase().split('x').map(n => snapFlux(parseInt(n, 10) || 1024));
    const r = await nvidiaImagePost(p.imagePath, key,
      { prompt, cfg_scale: 3.5, width: w || 1024, height: h || 1024, steps: 25, seed: Math.floor(Math.random() * 4294967295) });
    const b64 = r.json?.artifacts?.[0]?.base64 || r.json?.image;
    if (b64) return { ok: true, dataUri: `data:image/png;base64,${b64}`, provider: name, model };
    const detail = r.json?.detail ? JSON.stringify(r.json.detail) : (r.raw || `HTTP ${r.status}`);
    return { ok: false, error: r.nvstatus === 'errored' ? 'NVIDIA image service is busy — please try again.' : detail };
  }
  if (p.kind === 'dashscope') {
    // DashScope text2image is async (submit → poll task). Returns the task id so the
    // caller can poll; kept minimal here.
    const model = process.env[p.imageModelEnv] || p.imageModel;
    const r = await post(p.host, p.path, { Authorization: `Bearer ${key}`, 'X-DashScope-Async': 'enable' }, { model, input: { prompt }, parameters: { size: size.replace('x', '*'), n: 1 } }, 90000);
    const task = r.json?.output?.task_id;
    return task ? { ok: true, taskId: task, provider: name, model, note: 'DashScope is async — poll the task for the image URL.' } : { ok: false, error: r.json?.message || `HTTP ${r.status}` };
  }
  return { ok: false, error: 'unsupported image provider' };
}

// Status for the admin/UI: which providers are configured and what they can do.
function status() {
  return Object.entries(PROVIDERS).map(([name, p]) => ({
    name, configured: !!keyOf(p), keyEnv: p.keyEnv, caps: p.caps,
    model: process.env[p.modelEnv] || p.model || null,
  }));
}

module.exports = { PROVIDERS, complete, generateImage, status, has };
