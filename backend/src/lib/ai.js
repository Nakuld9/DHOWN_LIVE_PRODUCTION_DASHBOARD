// AI helpers — GLM primary with Groq fallback (used by the costing assistant).

const https = require("https");

// AI helper -- Groq cloud API (llama-3.3-70b-versatile, no local model required)
function callGroq(systemPrompt, userMessage) {
  return new Promise((resolve) => {
    const apiKey = process.env.GROQ_API_KEY;
    const model  = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    if (!apiKey) { resolve('GROQ_API_KEY not set in .env'); return; }

    const body = JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
    });

    const https = require('https');
    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (groqRes) => {
      let data = '';
      groqRes.on('data', chunk => data += chunk);
      groqRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.choices?.[0]?.message?.content || parsed.error?.message || 'No response from Groq');
        } catch (e) { resolve('Error parsing Groq response'); }
      });
    });
    req.setTimeout(30000, () => { req.destroy(); resolve('Groq request timed out (30s)'); });
    req.on('error', (e) => resolve(`Cannot reach Groq API: ${e.message}`));
    req.write(body); req.end();
  });
}

// Groq vision — send an image (data URI) with a prompt. Uses a vision-capable
// model (env GROQ_VISION_MODEL, default qwen/qwen3.6-27b, confirmed on the plan).
// Used by invoice OCR to read scanned / photographed invoices.
function callGroqVision(systemPrompt, userText, imageDataUri) {
  return new Promise((resolve) => {
    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
    if (!apiKey) { resolve('GROQ_API_KEY not set in .env'); return; }

    const body = JSON.stringify({
      model, stream: false, max_tokens: 1500,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: imageDataUri } },
        ] },
      ],
    });
    const options = {
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { const j = JSON.parse(data); resolve(j.choices?.[0]?.message?.content || j.error?.message || 'No response'); }
        catch { resolve('Error parsing Groq vision response'); }
      });
    });
    req.setTimeout(45000, () => { req.destroy(); resolve('Groq vision request timed out'); });
    req.on('error', (e) => resolve(`Cannot reach Groq API: ${e.message}`));
    req.write(body); req.end();
  });
}

// Primary/fallback -- all existing callOllama() calls try GLM first, then Groq.
async function callOllama(systemPrompt, userMessage) {
  try {
    return await askGLM(`${systemPrompt}\n\n${userMessage}`);
  } catch (e) {
    console.error('GLM failed, falling back to Groq:', e.message);
    return callGroq(systemPrompt, userMessage);
  }
}

module.exports = { callGroq, callGroqVision, callOllama };
