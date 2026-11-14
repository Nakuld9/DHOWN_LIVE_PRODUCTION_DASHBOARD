// Boot-ensure resilience helper.
//
// At startup every module's idempotent schema `ensure*()` runs. On the busier
// instance (VD Knits, :4100) they used to fire concurrently and stampede the
// shared 25-connection pool, so pool.connect() timed out ("Connection terminated
// due to connection timeout"). The ensure then either threw (logged, schema not
// created) or — worse — swallowed the error and cached a "done" flag, leaving the
// new tables/columns/seeds silently missing even though the code was deployed.
//
// This wrapper makes a boot ensure survive that pressure:
//   1. retry-with-backoff on *transient* connection errors (not on real SQL bugs),
//   2. a module-level registry of what ultimately failed, so
//   3. a post-boot health check (`rerunFailed`) can re-run the stragglers and log
//      loudly if any schema is still missing.
// Everything here stays idempotent and is safe for both firms (DHOWN + VD).

// Transient pool/connection faults worth retrying. A plain SQL error (bad column,
// syntax) is NOT here on purpose — we must not loop on a real bug.
const RETRYABLE = /connection terminated|connection timeout|timeout exceeded|too many clients|ECONNRESET|ETIMEDOUT|ECONNREFUSED|server closed the connection|terminating connection/i;

function isTransient(err) {
  const m = err && (err.message || String(err));
  return !!m && RETRYABLE.test(m);
}

// label -> the zero-arg fn that performs the ensure, recorded only while failing.
const failed = new Map();

// Run `fn` with exponential backoff on transient DB connection errors, then
// rethrow so the caller's own .catch decides what to do. `track` (default true)
// is for boot ensures: a final failure is recorded for `rerunFailed` and logged
// loudly as "schema may be missing". Pass track:false for recurring callers
// (e.g. job locks) that retry the same transient faults but must NOT be re-run
// by the one-shot boot health check.
async function withDbRetry(label, fn, { tries = 5, baseMs = 400, maxMs = 8000, track = true } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const out = await fn();
      if (track) failed.delete(label);
      if (attempt > 1) console.log(`[boot-ensure] ${label} succeeded on attempt ${attempt}/${tries}`);
      return out;
    } catch (err) {
      lastErr = err;
      if (attempt >= tries || !isTransient(err)) break;
      const wait = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
      console.warn(`[boot-ensure] ${label} transient error (attempt ${attempt}/${tries}), retrying in ${wait}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (track) {
    failed.set(label, fn);
    console.error(`[boot-ensure] ${label} FAILED after ${tries} attempts — schema may be missing: ${lastErr && lastErr.message}`);
  }
  throw lastErr;
}

// Post-boot health check: re-run every ensure that gave up, once the startup
// stampede has cleared and connections are free. Call it after the serialized
// boot block. Returns the count still failing (0 = all recovered).
async function rerunFailed() {
  const pending = [...failed.entries()];
  if (!pending.length) return 0;
  console.warn(`[boot-ensure] health check: re-running ${pending.length} failed ensure(s): ${pending.map(([l]) => l).join(', ')}`);
  for (const [label, fn] of pending) {
    try {
      await withDbRetry(label, fn, { tries: 3, baseMs: 1000, maxMs: 8000 });
      console.log(`[boot-ensure] health check recovered: ${label}`);
    } catch {
      console.error(`[boot-ensure] health check STILL FAILING — manual attention needed: ${label}`);
    }
  }
  return failed.size;
}

function failedLabels() {
  return [...failed.keys()];
}

module.exports = { withDbRetry, rerunFailed, failedLabels, isTransient };
