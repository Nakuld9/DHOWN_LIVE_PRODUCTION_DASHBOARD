// Every /api prefix the frontend calls must actually be mounted.
//
// This exists because the same bug shipped twice. A path that matches no route
// falls through to the SPA catch-all, which returns index.html with status 200 —
// so the fetch "succeeds", JSON.parse throws, the page's .catch swallows it, and
// a dropdown renders empty with no error anywhere. It cost the partner picker on
// three pages and the item picker on four before either was noticed, and only
// then by accident.
//
// Checking the PREFIX rather than the full path is deliberate. Earlier attempts
// probed full paths and produced two rounds of false positives: GET requests
// against POST-only routes, paths passed into helpers that supply the method,
// and template literals normalised to a nonsense id. The prefix is what actually
// goes wrong (/api/erp-items instead of /api/erp) and it can be checked with no
// ambiguity at all.
//
//   node tests/api-paths.e2e.js

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'src');
const SERVER = path.join(__dirname, '..', 'server.js');

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

function walk(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...walk(p));
    else if (/\.jsx?$/.test(f.name)) out.push(p);
  }
  return out;
}

if (!fs.existsSync(SRC)) {
  console.log('  SKIP  frontend/src not present');
  process.exit(0);
}

const server = fs.readFileSync(SERVER, 'utf8');

// Everything mounted with app.use('/api/...').
//
// Routers mounted at bare '/api' need their own routes read, otherwise this
// check is vacuous: treating "something is mounted at /api" as "any path under
// /api is valid" makes every ghost pass. That is exactly what the first version
// of this test did, and it happily passed with the bug reintroduced.
const mounts = new Set();
for (const m of server.matchAll(/app\.use\(\s*['"`](\/api[^'"`]*)['"`]\s*,\s*require\(['"`]([^'"`]+)['"`]\)/g)) {
  const mountPath = m[1].replace(/\/+$/, '');
  if (mountPath !== '/api') { mounts.add(mountPath); continue; }

  // Bare /api: the router's own first path segment is the real prefix.
  const file = path.join(__dirname, '..', m[2].replace(/^\.\//, '') + (m[2].endsWith('.js') ? '' : '.js'));
  if (!fs.existsSync(file)) continue;
  const routerSrc = fs.readFileSync(file, 'utf8');
  for (const r of routerSrc.matchAll(/router\.(?:get|post|put|patch|delete)\(\s*['"`]\/([a-zA-Z0-9_-]+)/g)) {
    mounts.add('/api/' + r[1]);
  }
}
// Plain app.use('/api/x') with no require on the same line (middleware mounts).
for (const m of server.matchAll(/app\.use\(\s*['"`](\/api\/[a-zA-Z0-9_-]+)/g)) {
  mounts.add(m[1].replace(/\/+$/, ''));
}

// Routes defined directly on app, e.g. app.get('/api/dashboard/live', ...).
for (const m of server.matchAll(/app\.(get|post|put|patch|delete)\(\s*['"`](\/api\/[^'"`]*)['"`]/g)) {
  const seg = m[2].split('/').slice(0, 3).join('/');
  mounts.add(seg);
}

const referenced = new Map();   // prefix -> Set(files)
for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  // Match anywhere, not only immediately after a quote: a template literal like
  // `${API}/api/erp-items/items` puts the path in the middle of the string, and
  // the quote-anchored version silently missed every one of them.
  for (const m of src.matchAll(/(\/api\/[a-zA-Z0-9_-]+)/g)) {
    const prefix = m[1];
    if (!referenced.has(prefix)) referenced.set(prefix, new Set());
    referenced.get(prefix).add(path.relative(SRC, file));
  }
}

console.log(`\n${referenced.size} distinct /api prefixes referenced by the UI`);
console.log(`${mounts.size} mounted prefixes in server.js\n`);

const ghosts = [];
for (const [prefix, files] of [...referenced.entries()].sort()) {
  if (mounts.has(prefix)) continue;
  ghosts.push({ prefix, files: [...files] });
}

ok(ghosts.length === 0,
  'every referenced /api prefix is mounted',
  ghosts.length ? ghosts.map(g => `${g.prefix} (${g.files.join(', ')})`).join(' | ') : 'no ghosts');

// The two that already shipped. Named explicitly so a revert is caught by name
// rather than by someone repeating the whole investigation.
const REGRESSIONS = ['/api/erp-items', '/api/erp-partners', '/api/erp-masters'];
for (const bad of REGRESSIONS) {
  const users = referenced.get(bad);
  ok(!users, `${bad} is not referenced (it is /api/erp)`, users ? [...users].join(', ') : '');
}

console.log(fails ? `\n${fails} FAILED\n` : '\nAll checks passed\n');
process.exit(fails ? 1 : 0);
