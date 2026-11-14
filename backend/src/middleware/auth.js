// Auth middleware — JWT verification, role gate, DC ingest api-key guard,
// and the login/PIN rate limiters.

const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const revocation = require("../lib/token-revocation");
// Normalises an IP before it is used as a rate-limit key. See aiLimiter below.
const { ipKeyGenerator } = require("express-rate-limit");

const JWT_SECRET = process.env.JWT_SECRET || 'dhown_mes_jwt_secret_2026';

const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

// â"€â"€ Auth middleware â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// Paths a display-scoped token may reach. A wall-mounted TV has no one logged
// into it and no way to log out, so its credential is long-lived — which means it
// must be able to read the shift board and nothing else. A plain VIEWER token
// would not be enough: most routers check only that you are authenticated, so a
// token left on a screen in the corridor would also read invoices and costing.
const DISPLAY_ALLOWED = [/^\/api\/dashboard\/live/, /^\/api\/public\//];

function verifyToken(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);

    // Revocation: a valid signature is not enough — the token (or all of this
    // user's tokens) may have been killed since it was issued. Cache-backed, sync.
    if (revocation.isRevoked(req.user)) {
      return res.status(401).json({ error: 'Session ended. Please log in again.' });
    }

    if (req.user.scope === 'display') {
      const p = req.baseUrl + (req.path === '/' ? '' : req.path);
      if (!DISPLAY_ALLOWED.some(re => re.test(p) || re.test(req.originalUrl.split('?')[0]))) {
        return res.status(403).json({ error: 'This display token may only read the live dashboard' });
      }
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// â"€â"€ Login rate limiter (10 attempts / 15 min per IP) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// â"€â"€ Supervisor PIN rate limiter (5 attempts / 5 min per IP) â"€â"€â"€â"€
const pinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many PIN attempts. Try again in 5 minutes.' },
});

// â"€â"€ Role-based access control â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// SALES and ACCOUNTS deliberately rank alongside OPERATOR rather than above it.
//
// Each needs to reach work that sits behind SUPERVISOR or ADMIN — a
// salesperson needs quotes and sales orders, an accountant needs to record and
// cancel receipts and approve credit notes — but neither may inherit a
// supervisor's authority over production: approving a GRN, approving a roll,
// closing downtime. On a ladder those are the same rung, so a ladder cannot
// express the difference. Ranking either at 3 would silently hand every
// salesperson and every accounts clerk the ability to sign stock into the
// factory; ranking ACCOUNTS at 4 would additionally let them create users.
//
// So seniority stays a ladder, and each job opts in explicitly with
// requireRole('SUPERVISOR', { also: ['SALES'] }). A route grants access only
// where someone wrote it down, which is auditable by grepping for `also`.
//
// The two are peers, not a hierarchy: ACCOUNTS cannot raise a quote and SALES
// cannot cancel a receipt, which is the separation you want between the person
// who agrees a price and the person who records the money.
// QC sits at OPERATOR rank and opts into the specific quality decisions
// (releasing a roll from quarantine, recording an inspection) via `also`, the
// same way SALES/ACCOUNTS opt into their routes — a quality inspector is not a
// production supervisor and must not inherit GRN/roll approval.
//
// AUDITOR is a different shape entirely: read EVERYTHING, write NOTHING. A rank
// cannot express that — any rank high enough to read the books is also high
// enough to change them. So AUDITOR keeps VIEWER's rank (it earns no write
// authority from the ladder) but is granted a blanket read pass in requireRole
// for safe methods, and every unsafe method is refused globally in
// auditorWriteBlock below. The two halves together make it strictly read-only,
// yet able to reach ACCOUNTS/ADMIN-gated *reports* that a plain VIEWER cannot.
const ROLE_HIERARCHY = {
  VIEWER: 1, AUDITOR: 1,
  OPERATOR: 2, SALES: 2, ACCOUNTS: 2, QC: 2,
  SUPERVISOR: 3, ADMIN: 4, SUPER_ADMIN: 5,
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requireRole(minRole, { also = [] } = {}) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (also.includes(req.user.role)) return next();
    // A read-only auditor clears any gate for a safe method; unsafe methods are
    // stopped globally (auditorWriteBlock), so this can only ever grant a read.
    if (req.user.role === 'AUDITOR' && SAFE_METHODS.has(req.method)) return next();
    if ((ROLE_HIERARCHY[req.user.role] || 0) < (ROLE_HIERARCHY[minRole] || 99)) {
      return res.status(403).json({ error: `Requires ${minRole} role or higher` });
    }
    next();
  };
}

// The write half of the AUDITOR contract: an authenticated auditor may not
// mutate anything, anywhere. Enforced once, centrally, so no future route can
// forget it — the mirror image of the apiAuthGate reasoning.
function auditorWriteBlock(req, res, next) {
  if (req.user?.role === 'AUDITOR' && !SAFE_METHODS.has(req.method)) {
    return res.status(403).json({ error: 'Auditor role is read-only' });
  }
  next();
}

function dcApiKeyGuard(req, res, next) {
  const expected = process.env.DC_API_KEY;
  if (!expected) {
    if (!dcApiKeyWarned) {
      console.warn('[SECURITY] /api/live-data is UNAUTHENTICATED — set DC_API_KEY in .env to require an API key from data collectors');
      dcApiKeyWarned = true;
    }
    return next();
  }
  const provided = req.get('x-api-key') || req.query.api_key;
  if (provided !== expected) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  return next();
}

// ── AI endpoint limiter (§24) ──────────────────────────────────────────
// Each AI call costs two LLM round-trips, so a runaway loop or a careless
// script could burn quota fast. Keyed per user (not per IP) so one person's
// mistake cannot lock out the whole office behind a shared NAT.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Falling back to a bare req.ip made the limit trivially bypassable over
  // IPv6: a client is handed a whole prefix, so rotating the address gives it a
  // fresh 20-request budget every time and the cap means nothing. express-rate-
  // limit warns about exactly this at boot. ipKeyGenerator collapses an IPv6
  // address to its /56 network, so the whole prefix shares one budget; IPv4
  // addresses pass through unchanged.
  keyGenerator: (req) => req.user?.username || ipKeyGenerator(req.ip),
  message: { error: 'Too many AI requests. Please wait a moment and try again.' },
});

// ── Global /api authentication gate ────────────────────────────────────────
//
// The single most-repeated defect in this system was a new router mounted
// without a verifyToken guard, leaking business data unauthenticated. It was
// found and fixed three times, each time per-router, and each time a later
// router re-introduced it — because "remember to guard every new router" is not
// something a person reliably does.
//
// This closes it structurally: ONE gate over all of /api that authenticates by
// default, with a small, explicit allow-list of the endpoints that are public
// by design. A new router is protected the moment it is mounted, with no action
// required. Adding a public endpoint now requires a deliberate edit to this
// list, which is the correct place for that decision to be visible and reviewed.
//
// The allow-list is matched on METHOD + full pathname (from originalUrl, so the
// mount point cannot confuse it). Each entry names WHY it is public.
const PUBLIC_ROUTES = [
  // The UI fetches tenant identity/branding before anyone has logged in.
  { method: 'GET',  test: (p) => p === '/api/public/tenant' },
  // A roll QR sticker is scanned on the shop floor with no login (mobile /m/roll).
  { method: 'GET',  test: (p) => p.startsWith('/api/public/roll/') },
  // Login itself, and the supervisor PIN login used by the Android app. Both
  // carry their own rate limiters.
  { method: 'POST', test: (p) => p === '/api/auth/login' },
  { method: 'POST', test: (p) => p === '/api/auth/supervisor-pin' },
  // Liveness and readiness probes — must answer before/without a token so a
  // monitor or load balancer can see the process is up. The deeper health
  // routes (/deps, /metrics, /credentials) are NOT here and stay authenticated.
  { method: 'GET',  test: (p) => p === '/api/health/live' },
  { method: 'GET',  test: (p) => p === '/api/health/ready' },
  { method: 'GET',  test: (p) => p === '/api/health' },
  // Data-collector ingest authenticates with its own API key (dcApiKeyGuard),
  // not a JWT — the ESP32 boards cannot hold a user session. GET /api/live-data
  // is the dashboard read and is deliberately NOT here, so it still needs a JWT.
  { method: 'POST', test: (p) => p === '/api/live-data' },
  // WhatsApp webhook: the GET handshake proves the verify token to Meta, and the
  // POST authenticates cryptographically via the HMAC middleware on its mount.
  { method: 'GET',  test: (p) => p === '/api/whatsapp/webhook' },
  { method: 'POST', test: (p) => p === '/api/whatsapp/webhook' },
  // Public customer web-chat widget (the "Chat with us" bubble). Anonymous website
  // visitors have no login; the route itself is rate-limited and keyed by an
  // unguessable per-visitor session id. Landing threads go into the CRM as WEB.
  { method: 'GET',  test: (p) => p.startsWith('/api/webchat/') },
  { method: 'POST', test: (p) => p.startsWith('/api/webchat/') },
];

function apiAuthGate(req, res, next) {
  const pathname = (req.originalUrl || req.url || '').split('?')[0];
  const isPublic = PUBLIC_ROUTES.some(r => r.method === req.method && r.test(pathname));
  if (isPublic) return next();
  // Authenticate first, then apply the auditor read-only block once the token
  // (and thus req.user.role) is known.
  return verifyToken(req, res, () => auditorWriteBlock(req, res, next));
}

module.exports = { JWT_SECRET, JWT_EXPIRES, ROLE_HIERARCHY, loginLimiter, pinLimiter, aiLimiter, verifyToken, requireRole, auditorWriteBlock, dcApiKeyGuard, apiAuthGate, PUBLIC_ROUTES };
