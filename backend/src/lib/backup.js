// Scheduled pg_dump backups, with an optional off-machine copy
// (BACKUP_SECONDARY_DIR, e.g. Google Drive).
//
// Two cadences, because they answer different questions:
//
//   * DAILY at 02:00, kept 7 days — the long view, and what a restore normally
//     uses.
//   * HOURLY, kept 48 hours — this exists because the recovery point was
//     otherwise up to 24 hours. A failure at 01:00 lost a full day of
//     production, dispatch and receipts. A dump costs about a second here, so
//     the cheap fix is simply to take more of them.
//
// The directory comes from tenant config. It used to be
// path.join(__dirname, 'backups') — and __dirname here is src/lib, so the
// nightly job wrote to backend/src/lib/backups while the admin screen listed
// backend/backups. The two diverged silently: the UI showed backups three weeks
// stale while the real ones accumulated somewhere nobody looked. Filenames are
// tenant-prefixed for the same reason the directory is — a second firm must not
// write dhown_mes_*.sql into anyone's folder.

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const tenant = require("../../config/tenant");

const BACKUP_DIR = tenant.backupDir;

const DAILY_KEEP_DAYS = Number(process.env.BACKUP_DAILY_KEEP_DAYS || 7);
const HOURLY_KEEP_HOURS = Number(process.env.BACKUP_HOURLY_KEEP_HOURS || 48);
// Set BACKUP_HOURLY=false to return to daily-only.
const HOURLY_ENABLED = String(process.env.BACKUP_HOURLY || 'true') !== 'false';

const pgDumpPath = () =>
  path.join(process.env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin', 'pg_dump.exe');

function dump(destFile) {
  const cmd = `"${pgDumpPath()}" -h ${process.env.DB_HOST || 'localhost'} `
            + `-p ${process.env.DB_PORT || '5432'} -U ${process.env.DB_USER || 'postgres'} `
            + `-F p -f "${destFile}" ${process.env.DB_NAME || 'dhown_mes'}`;
  const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' };
  return new Promise((resolve, reject) =>
    exec(cmd, { env, maxBuffer: 1024 * 1024 * 64 }, err => (err ? reject(err) : resolve())));
}

// A dump that exists is not a dump that worked. Check for the completion marker
// pg_dump writes at the end of a successful run.
function verify(file) {
  try {
    const size = fs.statSync(file).size;
    const tail = fs.readFileSync(file, 'utf8').slice(-200);
    const ok = size > 1024 && /PostgreSQL database dump complete/i.test(tail);
    if (!ok) console.error(`[BACKUP] VERIFY FAILED — ${file} is ${size} bytes with no completion marker`);
    return ok;
  } catch (e) {
    console.error('[BACKUP] Verify failed:', e.message);
    return false;
  }
}

// Age out old files. Scoped by prefix so the hourly sweep can never touch a
// daily backup, and vice versa.
function prune(prefix, maxAgeMs, label) {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!f.startsWith(prefix) || !f.endsWith('.sql')) continue;
    const p = path.join(BACKUP_DIR, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); removed++; }
    } catch { /* a file removed underneath us is not a problem */ }
  }
  if (removed) console.log(`[BACKUP] Pruned ${removed} ${label} backup(s)`);
}

function copyToSecondary(file) {
  const secondary = process.env.BACKUP_SECONDARY_DIR;
  if (!secondary) return;
  try {
    if (!fs.existsSync(secondary)) fs.mkdirSync(secondary, { recursive: true });
    fs.copyFileSync(file, path.join(secondary, path.basename(file)));
    console.log(`[BACKUP] Copied to secondary: ${secondary}`);
  } catch (e) { console.error('[BACKUP] Secondary copy failed:', e.message); }
}

// WhatsApp media (CRIT-08). uploads/wa holds every customer photo, shade card
// and document exchanged. It is gitignored and was in NO backup at all, so a
// disk failure destroyed it permanently while the database survived. Copied as
// a dated folder rather than an archive so one file can be recovered without
// unpacking anything. Daily only — media changes slowly and copying it hourly
// would be waste.
function backupMedia(dateStr) {
  try {
    const src = path.join(__dirname, '..', '..', 'uploads', 'wa');
    if (!fs.existsSync(src)) return;
    const dest = path.join(BACKUP_DIR, `media_${dateStr}`);
    fs.mkdirSync(dest, { recursive: true });
    let copied = 0;
    for (const f of fs.readdirSync(src)) {
      const from = path.join(src, f);
      if (!fs.statSync(from).isFile()) continue;
      const to = path.join(dest, f);
      if (!fs.existsSync(to)) { fs.copyFileSync(from, to); copied++; }
    }
    if (copied) console.log(`[BACKUP] Media: ${copied} new file(s) -> ${dest}`);

    const secondary = process.env.BACKUP_SECONDARY_DIR;
    if (secondary) {
      const secDest = path.join(secondary, `media_${dateStr}`);
      fs.mkdirSync(secDest, { recursive: true });
      for (const f of fs.readdirSync(dest)) {
        const to = path.join(secDest, f);
        if (!fs.existsSync(to)) fs.copyFileSync(path.join(dest, f), to);
      }
    }
  } catch (e) { console.error('[BACKUP] Media copy failed:', e.message); }
}

async function runDailyBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    const file = path.join(BACKUP_DIR, `${tenant.backupPrefix}_${dateStr}.sql`);

    await dump(file);
    const ok = verify(file);
    console.log(`[BACKUP] Daily: ${file}${ok ? ' (verified)' : ' — VERIFY FAILED'}`);
    copyToSecondary(file);
    backupMedia(dateStr);

    prune(`${tenant.backupPrefix}_hourly_`, HOURLY_KEEP_HOURS * 3600e3, 'hourly');

    // Daily sweep. Hourly files share the tenant prefix, so they are excluded
    // explicitly rather than relying on name shape.
    const cutoff = Date.now() - DAILY_KEEP_DAYS * 86400e3;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (!f.startsWith(`${tenant.backupPrefix}_`) || f.includes('_hourly_') || !f.endsWith('.sql')) continue;
      const p = path.join(BACKUP_DIR, f);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); console.log(`[BACKUP] Deleted old daily: ${f}`); }
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error('[BACKUP] Daily failed:', err.message);
  }
}

async function runHourlyBackup() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 13).replace(/:/g, '');   // YYYY-MM-DDTHH
    const file = path.join(BACKUP_DIR, `${tenant.backupPrefix}_hourly_${stamp}.sql`);
    await dump(file);
    if (verify(file)) console.log(`[BACKUP] Hourly: ${path.basename(file)}`);
    prune(`${tenant.backupPrefix}_hourly_`, HOURLY_KEEP_HOURS * 3600e3, 'hourly');
  } catch (err) {
    console.error('[BACKUP] Hourly failed:', err.message);
  }
}

function scheduleDailyBackup() {
  const now = new Date();
  const next = new Date();
  next.setHours(2, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntilNext = next - now;
  setTimeout(() => {
    runDailyBackup();
    setInterval(runDailyBackup, 24 * 3600e3);
  }, msUntilNext);
  console.log(`[BACKUP] Daily at 02:00 (next in ${Math.round(msUntilNext / 60000)} min), keeping ${DAILY_KEEP_DAYS} days`);

  if (HOURLY_ENABLED) {
    // Fire on the hour so filenames line up with wall-clock hours.
    const nextHour = new Date();
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    setTimeout(() => {
      runHourlyBackup();
      setInterval(runHourlyBackup, 3600e3);
    }, nextHour - now);
    console.log(`[BACKUP] Hourly enabled, keeping ${HOURLY_KEEP_HOURS}h — recovery point ~1 hour`);
  } else {
    console.log('[BACKUP] Hourly DISABLED — recovery point is up to 24 hours');
  }
}

module.exports = { BACKUP_DIR, runDailyBackup, runHourlyBackup, scheduleDailyBackup };
