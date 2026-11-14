// Register the DHOWN and VD Knits backends as Windows services so they start on
// boot and restart on crash, instead of dying when a terminal session ends.
//
// MUST be run from an ELEVATED (Administrator) shell — creating or removing a
// Windows service is a privileged operation. The install-services.bat /
// uninstall-services.bat wrappers self-elevate for you; this script is what they
// call once elevated.
//
//   node scripts/win-service.js install   [dhown|vdknits|both]   (default: both)
//   node scripts/win-service.js uninstall [dhown|vdknits|both]   (default: both)
//
// Each service runs `node server.js` from its own backend directory, so each
// loads its OWN .env (distinct ports 4000/4100, distinct DBs, distinct JWT
// secrets). node-windows keeps a wrapper that respawns the process if it exits.

const path = require('path');
const { Service } = require('node-windows');

const TARGETS = {
  dhown: {
    name: 'DHOWN MES',
    description: 'DHOWN Hosiery Mills — MES backend (port 4000, db dhown_mes). Auto-start.',
    script: 'D:\\DHOWN_LIVE_PRODUCTION_DASHBOARD\\backend\\server.js',
  },
  vdknits: {
    name: 'VD Knits MES',
    description: 'VD Knits — MES backend (port 4100, db vdknits_mes). Auto-start.',
    script: 'D:\\VDKNITS_MES\\backend\\server.js',
  },
};

const action = (process.argv[2] || '').toLowerCase();
const which = (process.argv[3] || 'both').toLowerCase();

if (!['install', 'uninstall'].includes(action)) {
  console.error('Usage: node scripts/win-service.js <install|uninstall> [dhown|vdknits|both]');
  process.exit(1);
}

const keys = which === 'both' ? Object.keys(TARGETS) : [which];
for (const k of keys) {
  if (!TARGETS[k]) { console.error(`Unknown target "${k}" — use dhown, vdknits, or both`); process.exit(1); }
}

function build(t) {
  return new Service({
    name: t.name,
    description: t.description,
    script: t.script,
    workingDirectory: path.dirname(t.script),   // so dotenv finds the right .env
    // Respawn policy: wait 2s before the first restart, back off gently, cap the
    // storm at 40 restarts so a hard boot loop does not thrash forever.
    wait: 2,
    grow: 0.5,
    maxRestarts: 40,
  });
}

// node-windows is event-driven; run the targets one at a time so their logs do
// not interleave and a failure is attributable.
(async () => {
  for (const k of keys) {
    const t = TARGETS[k];
    const svc = build(t);
    await new Promise((resolve) => {
      if (action === 'install') {
        svc.on('alreadyinstalled', () => { console.log(`= ${t.name}: already installed — skipping`); resolve(); });
        svc.on('install', () => { console.log(`+ ${t.name}: installed — starting`); svc.start(); });
        svc.on('start', () => { console.log(`✓ ${t.name}: running`); resolve(); });
        svc.on('error', (e) => { console.error(`! ${t.name}: ${e}`); resolve(); });
        svc.install();
      } else {
        svc.on('uninstall', () => { console.log(`- ${t.name}: removed`); resolve(); });
        svc.on('alreadyuninstalled', () => { console.log(`= ${t.name}: not installed`); resolve(); });
        svc.on('error', (e) => { console.error(`! ${t.name}: ${e}`); resolve(); });
        svc.uninstall();
      }
    });
  }
  console.log('\nDone. Check services.msc for "DHOWN MES" and "VD Knits MES".');
})();
