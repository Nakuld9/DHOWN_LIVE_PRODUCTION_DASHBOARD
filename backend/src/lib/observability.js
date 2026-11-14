// Observability — metrics, structured logging and provider health.
//
// Deliberately dependency-free: no Prometheus client, no agent, nothing new to
// run. The registry is in-memory and exposed in Prometheus text format, so it
// can be scraped later without changing any call site.
//
// This exists because of a real incident: the vision provider was unreachable
// for a day, every customer photo was silently discarded, and nothing anywhere
// reported it. The point of this module is that such a failure becomes visible
// within minutes instead of never.

const counters = new Map();   // name|labels -> number
const gauges   = new Map();
const timings  = new Map();   // name|labels -> { count, sum, max }

const key = (name, labels) => {
  const l = Object.entries(labels || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, "'")}"`).join(',');
  return l ? `${name}{${l}}` : name;
};

function inc(name, labels, by = 1) {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) || 0) + by);
}
function gauge(name, value, labels) { gauges.set(key(name, labels), Number(value) || 0); }
function observe(name, ms, labels) {
  const k = key(name, labels);
  const t = timings.get(k) || { count: 0, sum: 0, max: 0 };
  t.count += 1; t.sum += ms; t.max = Math.max(t.max, ms);
  timings.set(k, t);
}

// Prometheus text exposition.
function render() {
  const lines = [];
  for (const [k, v] of counters) lines.push(`${k} ${v}`);
  for (const [k, v] of gauges)   lines.push(`${k} ${v}`);
  for (const [k, t] of timings) {
    const base = k.includes('{') ? k.slice(0, k.indexOf('{')) : k;
    const lbl  = k.includes('{') ? k.slice(k.indexOf('{')) : '';
    lines.push(`${base}_count${lbl} ${t.count}`);
    lines.push(`${base}_sum_ms${lbl} ${Math.round(t.sum)}`);
    lines.push(`${base}_max_ms${lbl} ${Math.round(t.max)}`);
    lines.push(`${base}_avg_ms${lbl} ${t.count ? Math.round(t.sum / t.count) : 0}`);
  }
  return lines.join('\n') + '\n';
}

function snapshot() {
  return {
    counters: Object.fromEntries(counters),
    gauges: Object.fromEntries(gauges),
    timings: Object.fromEntries([...timings].map(([k, t]) => [k, { ...t, avg: t.count ? t.sum / t.count : 0 }])),
  };
}

// ── structured logging ─────────────────────────────────────────────────
// One JSON object per line so it can be grepped now and shipped later.
function log(level, event, fields = {}) {
  const rec = { ts: new Date().toISOString(), level, event, ...fields };
  const line = JSON.stringify(rec);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// ── provider health ────────────────────────────────────────────────────
// In-memory so wa-llm has no DB dependency (and no circular import); the health
// endpoint reads it directly. Persisted separately by the watcher.
const providers = new Map(); // name -> { ok, fail, lastOk, lastFail, lastError, lastMs }

function recordProvider(name, { ok, ms, error } = {}) {
  const p = providers.get(name) || { ok: 0, fail: 0, lastOk: null, lastFail: null, lastError: null, lastMs: null };
  if (ok) { p.ok += 1; p.lastOk = new Date().toISOString(); }
  else    { p.fail += 1; p.lastFail = new Date().toISOString(); p.lastError = String(error || 'unknown').slice(0, 200); }
  if (ms != null) p.lastMs = Math.round(ms);
  providers.set(name, p);

  inc('ai_provider_calls_total', { provider: name, result: ok ? 'ok' : 'fail' });
  if (ms != null) observe('ai_provider_latency', ms, { provider: name });
}

// A provider is unhealthy when it has recent failures and no recent success.
// Reporting "degraded" for a provider that is simply idle would be noise.
function providerHealth() {
  const out = {};
  for (const [name, p] of providers) {
    const total = p.ok + p.fail;
    const failRate = total ? p.fail / total : 0;
    let state = 'ok';
    if (total === 0) state = 'idle';
    else if (p.ok === 0) state = 'down';
    else if (failRate > 0.5) state = 'degraded';
    out[name] = { ...p, calls: total, fail_rate: Math.round(failRate * 100) / 100, state };
  }
  return out;
}

module.exports = { inc, gauge, observe, render, snapshot, log, recordProvider, providerHealth };
