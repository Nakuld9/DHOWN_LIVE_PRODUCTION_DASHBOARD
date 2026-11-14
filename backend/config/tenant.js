// Who this instance belongs to.
//
// The mill runs a second firm (VD Knits) which until now was a frozen COPY of
// this codebase — so every change had to be made twice, and the copy drifted far
// enough behind that it has none of the commercial modules. The data was never
// the problem: each firm already has its own database. The problem was that the
// firm's identity was written into the code.
//
// Everything a second instance needs to differ by lives here, read from its own
// .env. One codebase, one deployment per firm, no fork.
//
// Defaults are Dhown's, deliberately: an existing install that sets none of these
// keeps behaving exactly as it did.

// Loaded here rather than assumed, the same way config/database.js does it.
// Without this, anything that reaches tenant config before server.js has called
// dotenv silently gets the Dhown defaults — which on the second instance meant a
// vdknits deployment reporting itself as "dhown" and prefixing its backups
// accordingly. dotenv is idempotent, so calling it twice costs nothing.
require('dotenv').config({ quiet: true });

const path = require('path');

const env = (k, fallback) => {
  const v = process.env[k];
  return v === undefined || v === '' ? fallback : v;
};

// Short code used in filenames and log lines. Derived from the database name
// when not set, because that is already unique per firm and impossible to get
// wrong by copying a .env and forgetting one line.
const dbName = env('DB_NAME', 'dhown_mes');
const code = env('TENANT_CODE', dbName.replace(/_mes$/, '')).toLowerCase();

// The firm's display identity already lives in app_settings — per database, so
// already per firm, and editable in the UI. Env is only a fallback for the
// moments before the database has been read, and for an install that has not set
// it. Keeping the real value in one place is the whole point; a second
// authoritative copy in .env would drift from what the UI shows.
const name = env('COMPANY_NAME', 'DHOWN HOSIERY MILLS');

// Backups belong beside the instance that made them. This used to be an absolute
// path to Dhown's folder, which meant a second instance would have written its
// dumps into Dhown's backup directory under a dhown_mes_ filename — losing them
// among another firm's, and looking like Dhown data on restore.
const backupDir = path.resolve(env('BACKUP_DIR', path.join(__dirname, '..', 'backups')));

module.exports = {
  code,
  name,
  // Used in AI prompts, where a full legal name reads badly mid-sentence.
  shortName: env('COMPANY_SHORT_NAME', name.replace(/\s+(MILLS|LIMITED|LTD|PVT)\b.*/i, '')),
  // What the business does, for AI prompts that need to describe it.
  business: env('COMPANY_BUSINESS', 'knitted fabric manufacturer'),
  gstin: env('COMPANY_GSTIN', ''),
  address: env('COMPANY_ADDRESS', ''),

  backupDir,
  // The database name, which is already unique per firm and is what existing
  // backup files are named after. Using anything else would leave the previous
  // files unmatched by the retention sweep, so they would accumulate forever.
  backupPrefix: dbName,

  // Public base for QR codes printed on rolls.
  qrBaseUrl: env('QR_BASE_URL', 'https://mes.dhownhosiery.com').replace(/\/$/, ''),

  // Hosts allowed to call the API, beyond localhost and the LAN.
  allowedOrigins: env('ALLOWED_ORIGINS', 'https://mes.dhownhosiery.com')
    .split(',').map(s => s.trim()).filter(Boolean),
  // Domain suffix whose subdomains are all trusted. A second firm on its own
  // domain sets this rather than editing the CORS check.
  originSuffix: env('ORIGIN_SUFFIX', 'dhownhosiery.com'),
};
