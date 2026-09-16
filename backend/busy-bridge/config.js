/**
 * BUSY bridge configuration, read from the backend .env only.
 *
 * SECURITY: BUSY credentials live here and nowhere else. They are never sent
 * to the React frontend, never logged, and never returned by any route — see
 * redactedConfig(), which is what the BUSY Bridge page receives.
 */

const path = require('path');

const ALL_ENTITY_TYPES = [
  'CUSTOMER',
  'VENDOR',
  'ITEM',
  'WAREHOUSE',
  'SALES_REFERENCE',
  'PURCHASE_REFERENCE',
  'DISPATCH',
  'INVOICE',
];

const MASTER_TYPES = new Set(['CUSTOMER', 'VENDOR', 'ITEM', 'WAREHOUSE']);

function str(env, name, fallback) {
  const v = env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

function int(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  return n;
}

function parseEntityTypes(raw) {
  const set = new Set();
  for (const entry of raw.split(',')) {
    const t = entry.trim().toUpperCase();
    if (!t) continue;
    if (!ALL_ENTITY_TYPES.includes(t)) throw new Error(`Unknown entity type "${t}" in BUSY_ENABLED_ENTITY_TYPES`);
    set.add(t);
  }
  return set;
}

/**
 * Resolve an exchange directory.
 *
 * BUSY runs on a DIFFERENT PC from this dashboard, so these are normally UNC
 * paths (\\BUSY-PC\BusyExchange\Outbox) or a mapped drive. path.resolve()
 * would mangle a UNC path into something relative to this process's cwd, so
 * UNC paths are passed through untouched and only local relative paths are
 * resolved.
 */
function resolveExchangePath(value) {
  if (/^\\\\/.test(value)) return value;            // \\SERVER\share — leave alone
  if (/^[A-Za-z]:[\\/]/.test(value)) return value;  // C:\... or Z:\... — already absolute
  return path.resolve(value);
}

function loadConfig(env = process.env) {
  const adapter = str(env, 'BUSY_ADAPTER', 'xml');
  if (!['xml', 'rest', 'memory'].includes(adapter)) {
    throw new Error(`Unknown BUSY_ADAPTER "${adapter}" (expected xml|rest|memory)`);
  }

  const config = {
    env: str(env, 'NODE_ENV', 'development'),
    adapter,

    xml: {
      outbox: resolveExchangePath(str(env, 'BUSY_XML_OUTBOX', './busy-exchange/outbox')),
      ack: resolveExchangePath(str(env, 'BUSY_XML_ACK', './busy-exchange/ack')),
      inbox: resolveExchangePath(str(env, 'BUSY_XML_INBOX', './busy-exchange/inbox')),
      archive: resolveExchangePath(str(env, 'BUSY_XML_ARCHIVE', './busy-exchange/archive')),
      companyName: str(env, 'BUSY_COMPANY_NAME', 'DHOWN'),
      /** Hostname of the BUSY PC, shown on the dashboard for diagnostics. */
      hostLabel: str(env, 'BUSY_HOST_LABEL', ''),
    },

    rest: {
      baseUrl: str(env, 'BUSY_REST_BASE_URL', ''),
      apiKey: str(env, 'BUSY_REST_API_KEY', ''),
      timeoutMs: int(env, 'BUSY_REST_TIMEOUT_MS', 15000),
      readOnly: str(env, 'BUSY_REST_READ_ONLY', 'false') === 'true',
    },

    queue: {
      pollIntervalMs: int(env, 'BUSY_QUEUE_POLL_INTERVAL_MS', 10000),
      batchSize: int(env, 'BUSY_QUEUE_BATCH_SIZE', 10),
      maxAttempts: int(env, 'BUSY_MAX_ATTEMPTS', 4),
      retryBaseDelayMs: int(env, 'BUSY_RETRY_BASE_DELAY_MS', 30000),
      retryMaxDelayMs: int(env, 'BUSY_RETRY_MAX_DELAY_MS', 3600000),
    },

    enabledEntityTypes: parseEntityTypes(
      str(
        env,
        'BUSY_ENABLED_ENTITY_TYPES',
        'CUSTOMER,VENDOR,ITEM,SALES_REFERENCE,PURCHASE_REFERENCE,DISPATCH,INVOICE',
      ),
    ),

    reconcile: {
      intervalMs: int(env, 'BUSY_RECONCILE_INTERVAL_MS', 900000),
      lookbackDays: int(env, 'BUSY_RECONCILE_LOOKBACK_DAYS', 7),
    },

    /** Set BUSY_BRIDGE_ENABLED=false to mount the routes but never touch BUSY. */
    enabled: str(env, 'BUSY_BRIDGE_ENABLED', 'true') !== 'false',
  };

  if (config.adapter === 'rest' && !config.rest.baseUrl) {
    throw new Error('BUSY_ADAPTER=rest requires BUSY_REST_BASE_URL to be set.');
  }
  return config;
}

/**
 * The only config shape allowed to leave the process. Secrets become a
 * presence flag, so an operator can confirm "a key is configured" without the
 * key itself ever reaching a browser.
 */
function redactedConfig(config) {
  return {
    env: config.env,
    adapter: config.adapter,
    enabled: config.enabled,
    enabledEntityTypes: [...config.enabledEntityTypes],
    queue: config.queue,
    reconcile: config.reconcile,
    xml: {
      // Paths are operational facts, not secrets, and supervisors need them to
      // diagnose "BUSY isn't picking files up".
      outbox: config.xml.outbox,
      ack: config.xml.ack,
      inbox: config.xml.inbox,
      companyName: config.xml.companyName,
      hostLabel: config.xml.hostLabel,
    },
    rest: {
      baseUrl: config.rest.baseUrl,
      apiKeyConfigured: config.rest.apiKey.length > 0,
      timeoutMs: config.rest.timeoutMs,
      readOnly: config.rest.readOnly,
    },
  };
}

module.exports = { loadConfig, redactedConfig, resolveExchangePath, ALL_ENTITY_TYPES, MASTER_TYPES };
