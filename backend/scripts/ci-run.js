// Local CI runner — runs the FULL test suite (all unit + all e2e) and records the
// result to ci_runs so it is visible in the System Monitor. No hosted CI service.
//
// Usage:
//   node scripts/ci-run.js                 # full run (unit + every e2e)
//   node scripts/ci-run.js --unit-only     # unit tests only (safe, no DB writes)
//   node scripts/ci-run.js --trigger scheduled
//
// Exit code is 0 only when everything passes — so a scheduled task's Last Result
// reflects pass/fail too.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const unitOnly = argv.includes('--unit-only');
const trigger = (argv[argv.indexOf('--trigger') + 1] && argv.includes('--trigger')) ? argv[argv.indexOf('--trigger') + 1] : 'cli';

const out = [];
const say = (s) => { console.log(s); out.push(s); };

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: BACKEND, shell: process.platform === 'win32', encoding: 'utf8', timeout: 15 * 60 * 1000 });
  return { code: r.status == null ? 1 : r.status, text: (r.stdout || '') + (r.stderr || '') };
}

(async () => {
  const t0 = Date.now();
  let pool, ci, runId = null;
  try {
    pool = require('../config/database');
    ci = require('../src/lib/ci')(pool);
    // Refuse to overlap a run already in progress.
    const inflight = await ci.running().catch(() => null);
    if (inflight) { console.error(`CI already running (run ${inflight.run_id}) — abort.`); process.exit(2); }
    runId = await ci.start(trigger);
  } catch (e) {
    console.error('CI: cannot reach DB to record the run —', e.message);
    // Still run unit tests (no DB needed) so the operator sees a result in the console.
  }

  // ── Unit tests (jest) ──────────────────────────────────────────────────────
  say('== unit tests (jest) ==');
  const u = run('npx', ['jest', '--silent']);
  say(u.text.split('\n').filter(l => /Tests:|Test Suites:|FAIL|✕/.test(l)).join('\n') || '(no jest summary parsed)');
  const um = u.text.match(/Tests:\s+(?:(\d+) failed,\s+)?(\d+) passed,\s+(\d+) total/);
  const unit_pass = um ? Number(um[2]) : (u.code === 0 ? 1 : 0);
  const unit_total = um ? Number(um[3]) : (u.code === 0 ? 1 : 0);
  const unitOk = u.code === 0;

  // ── E2E suites (every tests/*.e2e.js) ──────────────────────────────────────
  let e2e_pass = 0, e2e_fail = 0, failed = [];
  const e2eFiles = unitOnly ? [] :
    fs.readdirSync(path.join(BACKEND, 'tests')).filter(f => f.endsWith('.e2e.js')).sort();
  if (!unitOnly) {
    say(`\n== e2e suites (${e2eFiles.length}) ==`);
    for (const f of e2eFiles) {
      const r = run('node', [path.join('tests', f)]);
      if (r.code === 0) { e2e_pass++; say(`  PASS  ${f.replace('.e2e.js', '')}`); }
      else { e2e_fail++; failed.push(f.replace('.e2e.js', '')); say(`  FAIL  ${f.replace('.e2e.js', '')}\n${r.text.split('\n').slice(-8).join('\n')}`); }
    }
  }

  const overall = (unitOk && e2e_fail === 0) ? 'pass' : 'fail';
  const durationMs = Date.now() - t0;
  say(`\n== RESULT: ${overall.toUpperCase()} == unit ${unit_pass}/${unit_total} · e2e ${e2e_pass}/${e2eFiles.length} (${e2e_fail} failed${failed.length ? ': ' + failed.join(', ') : ''}) · ${Math.round(durationMs / 1000)}s`);

  if (ci && runId) {
    try {
      await ci.finish(runId, {
        duration_ms: durationMs, overall,
        unit_pass, unit_total, e2e_pass, e2e_fail, e2e_total: e2eFiles.length,
        failed_suites: failed, output_tail: out.join('\n'),
      });
    } catch (e) { console.error('CI: failed to record result —', e.message); }
  }
  if (pool && pool.end) { try { await pool.end(); } catch {} }
  process.exit(overall === 'pass' ? 0 : 1);
})();
