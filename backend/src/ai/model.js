// Model gateway — the one place the agent runtime talks to a language model.
//
// Provider-abstracted (blueprint §18). Every call names a TASK class; each task
// routes to a provider by env (defaults to Groq, the always-on baseline). Adding a
// model is a key in .env + optionally pointing a task at it — see src/ai/providers.js.
// If a chosen provider is unconfigured or errors, we fall back to Groq so nothing
// silently returns nothing.

const providers = require('./providers');
const { callGroq, callGroqVision } = require('../lib/ai');

// task → provider. Overridable per task via env, so ops can send 'reasoning' to
// Claude/DeepSeek/GLM while keeping 'fast' on Groq, without code changes.
const ROUTING = {
  fast: process.env.AI_FAST || 'groq',
  reasoning: process.env.AI_REASONING || 'groq',
  default: process.env.AI_DEFAULT || 'groq',
};

async function chat(system, user, { task = 'default', provider } = {}) {
  const name = provider || ROUTING[task] || ROUTING.default || 'groq';
  if (name !== 'groq' && providers.has(name)) {
    const out = await providers.complete(name, system, user, { maxTokens: 1500 });
    if (out.ok) return out.text;
    console.error(`model provider ${name} failed (${out.error}) — falling back to groq`);
  }
  const g = await callGroq(system, user);
  return typeof g === 'string' ? g : '';
}

// Vision — send an image with a prompt. Task 'ocr' by default; provider from env
// (OCR_PROVIDER) so ops can point OCR at nemotron_ocr / openai / claude. Falls back
// to Groq vision.
async function visionChat(system, user, imageDataUri, { provider } = {}) {
  const name = provider || process.env.OCR_PROVIDER || 'groq';
  if (name !== 'groq' && providers.has(name)) {
    const out = await providers.complete(name, system, user, { imageDataUri, maxTokens: 1500 });
    if (out.ok) return out.text;
    console.error(`vision provider ${name} failed (${out.error}) — falling back to groq vision`);
  }
  return callGroqVision(system, user, imageDataUri);
}

// Document — read a whole PDF (native, incl. scanned pages, layout preserved).
// Provider from env (OCR_PROVIDER); only Claude supports native PDF today. Returns
// the model text, or '' with a reason when no PDF-capable provider is configured
// (the caller then falls back to text-layer extraction). Never fabricates.
async function documentChat(system, user, pdfBase64, { provider, maxTokens = 2000 } = {}) {
  // Own env var (not OCR_PROVIDER) so the PDF reader is independent of the image-OCR
  // provider. Defaults to Claude — the only native-PDF reader wired today.
  const name = provider || process.env.PDF_AI_PROVIDER || 'claude';
  if (!providers.has(name)) return { ok: false, text: '', reason: `PDF reader "${name}" not configured (set its API key).` };
  const out = await providers.complete(name, system, user, { pdfBase64, maxTokens });
  return out.ok ? { ok: true, text: out.text, provider: name } : { ok: false, text: '', reason: out.error };
}

module.exports = { chat, visionChat, documentChat, providers, ROUTING };
