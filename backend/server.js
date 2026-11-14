require('dotenv').config();

const pool = require('./config/database');
const { withDbRetry, rerunFailed } = require('./src/lib/boot-ensure');

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const PDFDocument = require("pdfkit");
const fs = require('fs');
const path = require('path');
const https = require('https');
const { seedDefaultAdmin, ensureProductionHistory, ensureMaintenanceSchema, ensureUsersSchema, ensureOperatorsSchema, ensurePurchaseOrdersSchema, ensureSalesOrdersSchema, ensureProductionPlansSchema, ensurePayrollSchema, ensureTaxInvoicesSchema, ensureAlertAcksSchema, ensureCollectorRollSchema, ensureWaCrmSchema, ensureLogisticsSchema, ensureAllocationSchema, ensureUomSchema, ensureFinancialViews, ensureReferenceData, ensureFinancialConstraints, ensureKnittingSchema, ensureBankReconSchema, ensureSoftDelete, ensureComplaintsSchema, ensureOrderLineWeights, ensureBusyProductionSchema, ensureFabricInspectionSchema, ensureAiAgentsSchema, ensureAiApprovalsSchema, ensureCapaSchema, ensureShadeSwatchesSchema, ensureTimestamps, ensureCheckConstraints, ensureForeignKeyIndexes } = require('./src/db/schema');
const { getShiftSettings, detectCurrentShift } = require('./src/lib/shift');
const { computeLiveStatus, updateOEE } = require('./src/lib/machine');
const { nextSeq, nextInvSeq, nextDocNumber } = require('./src/lib/sequences');
const { generateQR, rollQRContent } = require('./src/lib/qr');
const { callOllama } = require('./src/lib/ai');
const { getYarnRate, numOrNull, addCostEntry, postToLedger } = require('./src/lib/costing');
const { checkMachineAlerts, handleInboundReply, sendText, sendTemplate } = require('./src/lib/alerts');
const { sendShiftSummary, buildSummary, buildStatusText, startSummaryScheduler } = require('./src/lib/summary');
const { notifyInvoice, notifyDispatch, notifyPO } = require('./src/lib/customer-notify');
const { startLowStockScheduler } = require('./src/lib/stock-alerts');
const { runDailyBackup, scheduleDailyBackup } = require('./src/lib/backup');
const retention = require('./src/lib/retention');
const migrate = require('./src/db/migrate');
const { JWT_SECRET, JWT_EXPIRES, loginLimiter, pinLimiter, aiLimiter, verifyToken, requireRole, dcApiKeyGuard, apiAuthGate } = require('./src/middleware/auth');
const { verifyWhatsappSignature } = require('./src/middleware/webhook-verify');

const PG_BIN = process.env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin';


const tenant = require('./config/tenant');

const app = express();
// Behind the cloudflared tunnel (which connects from localhost and sets
// X-Forwarded-For). Trust the loopback proxy so req.ip is the real client and
// express-rate-limit does not throw ERR_ERL_UNEXPECTED_X_FORWARDED_FOR (which
// would otherwise surface as an HTML error page to the SPA). 'loopback' only
// trusts 127.0.0.1/::1, so an external client cannot spoof its IP.
app.set('trust proxy', 'loopback');

// Extra public origins (comma-separated) via env, e.g. the Cloudflare-tunnel domain.
const EXTRA_ORIGINS = tenant.allowedOrigins;
// Subdomains of this firm's own domain. Escaped before it reaches a regex —
// a domain is user-supplied configuration and its dots are not wildcards.
const ORIGIN_SUFFIX_RE = tenant.originSuffix
  ? new RegExp(`^https://([a-z0-9-]+\\.)*${tenant.originSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  : null;
app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin (curl/apps), loopback by name OR by address, any
    // 192.168.x.x device, this firm's own domain, and allow-listed origins.
    // 127.0.0.1 is included because it is the same machine as localhost, and
    // omitting it produced HTML-instead-of-JSON failures that looked like app
    // bugs when testing locally.
    if (!origin
        || origin.includes('localhost')
        || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)
        || /^https?:\/\/192\.168\./.test(origin)
        || (ORIGIN_SUFFIX_RE && ORIGIN_SUFFIX_RE.test(origin))
        || EXTRA_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS: origin not allowed'));
    }
  },
  credentials: true,
}));
// Capture the raw bytes alongside the parsed body. The WhatsApp webhook HMAC
// must be computed over exactly what Meta sent — the re-serialised parsed object
// would differ in key order and whitespace and never match.
app.use(express.json({
  limit: '12mb',   // raised for knitting-structure reference images (base64 in body)
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

// Audit safety net: logs every mutating /api request (except live-data ingest)
app.use(require('./src/middleware/audit')(pool));

// Serve React build for network PCs
const FRONTEND_BUILD = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD));
}






const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// ==========================
// GET MACHINES (LIVE STATUS)
// ==========================
// ── GLOBAL /api AUTHENTICATION GATE ──────────────────────────────────────
// Every /api route is authenticated by default. The only exceptions are the
// explicit public allow-list in src/middleware/auth.js. This must sit ABOVE
// every route mount, so a router added later is protected without anyone
// having to remember. It replaces the per-router guards that kept being
// forgotten; those remain harmlessly (a second verify is a no-op).
app.use('/api', apiAuthGate);

// MACHINES — layered: src/routes/machines.routes.js
app.use('/api/machines', require('./src/routes/machines.routes')({ pool, verifyToken, requireRole, getShiftSettings, detectCurrentShift }));

// ==========================
// UPDATE MACHINE
// ==========================

// ==========================
// MACHINE DETAILS
// ==========================

// ==========================
// GET LIVE DATA
// ==========================
// LIVE-DATA — layered: src/routes/live-data.routes.js
app.use('/api/live-data', require('./src/routes/live-data.routes')({ pool, dcApiKeyGuard, verifyToken, getShiftSettings, detectCurrentShift, updateOEE, computeLiveStatus, io }));


// ==========================
// SOCKET CONNECTION
// ==========================
io.on('connection', () => {});

// PUBLIC roll lookup — no auth. Target of the QR on roll labels (/m/roll/:rollId)
// so floor staff scanning a label see roll info instantly. Returns ONLY safe,
// non-financial display fields (no costs, no internal ids beyond the roll id).
// PUBLIC — layered: src/routes/public.routes.js
app.use('/api/public', require('./src/routes/public.routes')({ pool }));

// ROLLS — layered module (src/routes/rolls.routes.js): create/close/approve/cancel/edit/delete
app.use('/api/rolls', require('./src/routes/rolls.routes')({ pool, verifyToken, requireRole, io, generateQR, rollQRContent, addCostEntry, postToLedger, getShiftSettings, detectCurrentShift }));


// DELETE Roll (OPEN only — not yet weighed)

// CANCEL Roll (CLOSED/APPROVED) — marks CANCELLED

// ==========================
// OPERATORS — migrated to layered architecture (src/routes/operators.routes.js)
// Endpoints unchanged: GET/POST/PUT/DELETE /api/operators[/:id]
// Shared pool + auth injected so behavior is identical to the former inline handlers.
// ==========================
app.use('/api/operators', require('./src/routes/operators.routes')({ pool, verifyToken, requireRole }));

// ==========================
// ASSIGNMENTS
// ==========================

// ASSIGNMENTS — operator assignments + release (layered: src/routes/assignments.routes.js)
app.use('/api/assignments', require('./src/routes/assignments.routes')({ pool, verifyToken, requireRole }));

// RFID — tag lookup + events + scan (layered: src/routes/rfid.routes.js)
app.use('/api', require('./src/routes/rfid.routes')({ pool, verifyToken, requireRole, io }));


// ==========================
// RFID EVENTS
// ==========================


// ==========================
// GET DOWNTIME
// ==========================

// DOWNTIME — list/create/close + open/stats/reason (layered: src/routes/downtime.routes.js)
app.use('/api/downtime', require('./src/routes/downtime.routes')({ pool, verifyToken, requireRole, io, getShiftSettings, detectCurrentShift }));


// ==========================
// START DOWNTIME
// ==========================



// ==========================
// CLOSE DOWNTIME
// ==========================


// ==========================
// ALERTS
// ==========================

// ALERTS — factory dashboard alerts (layered: src/routes/alerts.routes.js)
app.use('/api/alerts', require('./src/routes/alerts.routes')({ pool, verifyToken, requireRole }));

// ==========================
// REPORTS API
// ==========================
// PRODUCTION PDF
// REPORTS — layered module (src/routes/reports.routes.js)
app.use('/api/reports', require('./src/routes/reports.routes')({ pool, verifyToken, requireRole, PDFDocument }));


// ==========================
// PDF REPORTS
// ==========================
 // DOWNTIME PDF
//OPERATOR PDF

//RFID EVENTS PDF
 
///ASSIGNMENTS PDF

// FACTORY SUMMARY


// =============================
// DASHBOARD KPI API
// =============================

// DASHBOARD — layered: src/routes/dashboard.routes.js
app.use('/api/dashboard', require('./src/routes/dashboard.routes')({ pool, verifyToken, getShiftSettings, detectCurrentShift }));


//===========================
// TREND API
//===========================

//===================
// production trend api
//====================
// ============================================================
// PHASE 5 â€" SHIFT CONFIG HELPERS  (read from app_settings, no hardcodes)
// ============================================================






// ==========================
// POST LIVE DATA (DC PUSH) â€" Phase 5 engine
// ==========================
// ── DC ingest API-key guard (P1-11) ─────────────────────────────────────────
// Protects the port-8090 /api/live-data push endpoint. Enforced ONLY when
// DC_API_KEY is set in .env, so existing collectors keep working until the key
// is rolled out to them. Accepts the key via `x-api-key` header or `?api_key=`.
let dcApiKeyWarned = false;


// ==========================
// CHARTS — machine trends + hourly production (layered: src/routes/charts.routes.js)
app.use('/api/charts', require('./src/routes/charts.routes')({ pool, verifyToken }));

// ==========================
// POST REGISTER DATA COLLECTOR
// ==========================
// DATA-COLLECTORS — DC registration/list/update/delete (layered: src/routes/data-collectors.routes.js)
app.use('/api/data-collectors', require('./src/routes/data-collectors.routes')({ pool, verifyToken, requireRole }));

// ==========================
// ROLLS â€" CREATE & CLOSE
// ==========================



// Single-roll detail for the mobile scan page (/m/roll/:id). Login-protected.

// ACTIVE OPERATORS (layered: src/routes/active-operators.routes.js)
app.use('/api/active-operators', require('./src/routes/active-operators.routes')({ pool, verifyToken }));

// ==========================
// SETTINGS — migrated to layered architecture (src/routes/settings.routes.js)
// Endpoints unchanged: GET /api/settings (no auth), PUT /api/settings (verifyToken)
// ==========================
app.use('/api/settings', require('./src/routes/settings.routes')({ pool, verifyToken, requireRole }));

// ==========================
// MAINTENANCE API
// ==========================

// MAINTENANCE RECORDS — layered module (src/routes/maintenance-records.routes.js)
app.use('/api/maintenance', require('./src/routes/maintenance-records.routes')({ pool, verifyToken, requireRole }));
// Needle & sinker change log (per-machine consumable costing) — surfaced on Maintenance.
app.use('/api/needle-changes', require('./src/routes/needle-changes.routes')({ pool, verifyToken, requireRole }));
app.use('/api/needle-capacity', require('./src/routes/needle-capacity.routes')({ pool, verifyToken, requireRole }));

// ==========================
// DATA COLLECTORS API
// ==========================



// ============================================================
// PHASE 5 â€" PRODUCTION & OEE ANALYTICS ENDPOINTS
// ============================================================

// GET /api/production/current â€" live snapshot all machines
// PRODUCTION — layered: src/routes/production.routes.js
app.use('/api/production', require('./src/routes/production.routes')({ pool, verifyToken, getShiftSettings, detectCurrentShift }));

// GET /api/production/daily?date=YYYY-MM-DD

// GET /api/production/shift â€" current shift for today

// ANALYTICS — OEE + utilization + shift analytics (layered: src/routes/analytics.routes.js)
app.use('/api', require('./src/routes/analytics.routes')({ pool, verifyToken, getShiftSettings, detectCurrentShift }));

// GET /api/dashboard/live â€" single-call comprehensive dashboard data

// â"€â"€ Replace hardcoded GET /api/dashboard/oee with real computation â"€â"€
// (original registered earlier; this new registration takes precedence via last-wins in Express)

// COMMAND CENTER — aggregate dashboard (layered: src/routes/command-center.routes.js)
app.use('/api/command-center', require('./src/routes/command-center.routes')({ pool, verifyToken, getShiftSettings, detectCurrentShift }));

// â"€â"€ JSON Report endpoints â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// GET /api/reports/daily-production-report?date=

// GET /api/reports/shift-production-report?date=

// GET /api/reports/machine-performance-report?date=

// GET /api/reports/oee-report?date=

// GET /api/reports/downtime-analysis-report?start=&end=

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PHASE 9 â€" ADVANCED REPORTING SYSTEM
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET /api/reports/filter-options

// GET /api/reports/production?from&to&shift&machine&fabric

// GET /api/reports/rolls?from&to&machine&operator&fabric

// GET /api/reports/shifts?from&to&shift&machine

// GET /api/reports/machines?from&to&machine

// GET /api/reports/downtime?from&to&machine&shift

// GET /api/reports/operators?from&to&operator

// GET /api/reports/rfid?from&to&operator

// GET /api/reports/assignments?from&to&machine&operator

// GET /api/reports/summary?from&to

// GET /api/reports/maintenance?from&to&machine&priority&status

// GET /api/reports/shift-handover?from&to&shift

// GET /api/reports/daily-summary?date=YYYY-MM-DD

// ==========================
// PHASE 6 â€" USER MANAGEMENT
// ==========================

// USERS — management + supervisor PIN (layered: src/routes/users.routes.js)
app.use('/api/users', require('./src/routes/users.routes')({ pool, verifyToken, requireRole }));

// ==========================
// PHASE 6 â€" AUDIT LOGS
// ==========================

// AUDIT LOGS (layered: src/routes/audit-logs.routes.js)
app.use('/api/audit-logs', require('./src/routes/audit-logs.routes')({ pool, verifyToken }));

// ==========================
// AUTH â€" LOGIN (rate-limited)
// ==========================
// AUTH — layered: src/routes/auth.routes.js
app.use('/api/auth', require('./src/routes/auth.routes')({ pool, verifyToken, requireRole, loginLimiter, pinLimiter, JWT_SECRET, JWT_EXPIRES }));

// ==========================
// SUPERVISOR PIN LOGIN
// ==========================

// ==========================
// LOGOUT
// ==========================

// ==========================
// RFID SCAN
// ==========================

// ==========================
// OPERATOR ATTENDANCE
// ==========================

// ATTENDANCE — operator attendance views (layered: src/routes/attendance.routes.js)
app.use('/api/attendance', require('./src/routes/attendance.routes')({ pool, verifyToken, requireRole }));

// BACKUP — on-demand dump + daily trigger/list (layered: src/routes/backup.routes.js)
app.use('/api', require('./src/routes/backup.routes')({ verifyToken, requireRole, runDailyBackup, PG_BIN }));

// ==========================
// ==========================
// FABRIC TYPES
// ==========================

// FABRIC TYPES — migrated to layered architecture (src/routes/fabric-types.routes.js)
// Endpoints unchanged: GET (no auth), POST/PUT(:code)/DELETE(:code) (verifyToken)
app.use('/api/fabric-types', require('./src/routes/fabric-types.routes')({ pool, verifyToken, requireRole }));

// MAINTENANCE WORK ORDERS — layered module (src/routes/work-orders.routes.js)
// Tables (maintenance_work_orders, spare_parts, wo_parts_used) created by ensureMaintenanceSchema.
app.use('/api/work-orders', require('./src/routes/work-orders.routes')({ pool, verifyToken, requireRole }));
app.use('/api/spare-parts', require('./src/routes/spare-parts.routes')({ pool, verifyToken, requireRole }));
app.use('/api/knitting-structures', require('./src/routes/knitting-structures.routes')({ pool, verifyToken, requireRole }));

// ==========================
// PHASE 6 â€" MACHINE SETTINGS
// ==========================

// MACHINE-SETTINGS — per-machine settings (layered: src/routes/machine-settings.routes.js)
app.use('/api/machine-settings', require('./src/routes/machine-settings.routes')({ pool, verifyToken, requireRole }));

// Editable fields only â€" DC ID is intentionally excluded

// ==========================
// DOWNTIME â€" NEW ENDPOINTS
// ==========================

// GET /api/downtime/open â€" live open downtime records with machine names and live timer

// GET /api/downtime/stats?date= â€" KPIs, top reasons, machine ranking

// PUT /api/downtime/:id/reason â€" assign or update reason on auto-created record

// ==========================
// STARTUP: seed default admin
// ==========================


// ==========================
// START SERVER
// ==========================




// ============================================================
// PHASE 2 â€" MAINTENANCE SCHEDULE
// ============================================================

// MAINTENANCE SCHEDULE — layered module (src/routes/maintenance-schedule.routes.js)
app.use('/api/maintenance-schedule', require('./src/routes/maintenance-schedule.routes')({ pool, verifyToken, requireRole }));

// SHIFT HANDOVERS — handover notes (layered: src/routes/shift-handovers.routes.js)
app.use('/api/shift-handovers', require('./src/routes/shift-handovers.routes')({ pool, verifyToken, requireRole }));

// React Router catch-all â€" moved to after warehouse routes below









// ============================================================
// WAREHOUSE MODULE
// ============================================================


// GREIGE — greige-warehouse views (layered: src/routes/greige.routes.js)
app.use('/api/greige', require('./src/routes/greige.routes')({ pool, verifyToken }));

// â"€â"€ BATCHES â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// BATCHES (LOTS) — layered module (src/routes/batches.routes.js): create/add-rolls/remove-roll/seal/delete
app.use('/api/batches', require('./src/routes/batches.routes')({ pool, verifyToken, requireRole, nextDocNumber }));
app.use('/api/purchase-orders', require('./src/routes/purchase-orders.routes')({ pool, verifyToken, requireRole, nextDocNumber, io }));
app.use('/api/sales-orders', require('./src/routes/sales-orders.routes')({ pool, verifyToken, requireRole, nextInvSeq, io, sendTemplate }));
// Bank reconciliation — proves recorded receipts against the bank statement.
app.use('/api/bank', require('./src/routes/bank.routes')({ pool, verifyToken, requireRole }));
// Trash — restore anything soft-deleted.
app.use('/api/trash', require('./src/routes/trash.routes')({ pool, verifyToken, requireRole }));
// Customer complaints — the one business process with no home before this.
app.use('/api/complaints', require('./src/routes/complaints.routes')({ pool, verifyToken, requireRole }));

// OpenAPI, generated from the routes mounted above. Deliberately after every
// app.use() so it describes the surface that actually exists.
app.get('/api/openapi.json', verifyToken, requireRole('OPERATOR'), (req, res) => {
  try { res.json(require('./src/lib/openapi').build(app)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.use('/api/production-plans', require('./src/routes/production-plans.routes')({ pool, verifyToken, requireRole, nextInvSeq, io }));
app.use('/api/payroll', require('./src/routes/payroll.routes')({ pool, verifyToken, requireRole, nextInvSeq, io }));
app.use('/api/tax-invoices', require('./src/routes/tax-invoices.routes')({ pool, verifyToken, requireRole, nextInvSeq, io }));
// Public WhatsApp webhook (Meta reaches it directly — no app JWT; verify token gated).
// WhatsApp AI CRM — see docs/WHATSAPP_CRM_DESIGN.md. The AI reaches MES data
// only through the whitelisted tool layer (wa-tools), never raw SQL.
const waCrm   = require('./src/lib/wa-crm')(pool, { io });
const waInv = require('./src/lib/wa-inventory')(pool);
const waApprovals = require('./src/lib/wa-approvals')(pool);
const waMargin = require('./src/lib/wa-margin')(pool);
const waPayments = require('./src/lib/payments')(pool, { nextInvSeq });
const logistics  = require('./src/lib/logistics')(pool);
const salesReturns = require('./src/lib/returns')(pool, { nextInvSeq, approvals: waApprovals });
const lotAllocation = require('./src/lib/lot-allocation')(pool, { approvals: waApprovals });
const uomConvert   = require('./src/lib/uom')(pool);
const waQuotes = require('./src/lib/wa-quote-service')(pool, { nextInvSeq, io, approvals: waApprovals, inventory: waInv, margin: waMargin });
const waProd  = require('./src/lib/wa-production')(pool);
const waIns   = require('./src/lib/wa-insights')(pool);
const obs = require('./src/lib/observability');
const errorTracker = require('./src/lib/error-tracker')(pool);
const monitor = require('./src/lib/monitor')({ pool, obs, tenant, errors: errorTracker });
const ci = require('./src/lib/ci')(pool);
// Process-level safety net: a rejected promise or thrown error outside a request
// would otherwise vanish into the logs. Record it so it surfaces in the monitor.
process.on('unhandledRejection', (reason) => {
  obs.log('error', 'unhandledRejection', { error: reason && reason.message });
  errorTracker.record({ kind: 'unhandledRejection', message: (reason && reason.message) || String(reason), stack: reason && reason.stack });
});
process.on('uncaughtException', (err) => {
  obs.log('error', 'uncaughtException', { error: err && err.message });
  errorTracker.record({ kind: 'uncaughtException', message: err && err.message, stack: err && err.stack });
  // Deliberately do NOT exit — a single bad handler must not take the whole MES down.
});
const jobLock = require('./src/lib/job-lock')(pool);   // declared before its consumers
const waFollow = require('./src/lib/wa-followups')(pool, { jobLock });
const waConsent = require('./src/lib/wa-consent')(pool);
const waCampaigns = require('./src/lib/wa-campaigns')({ pool, sendTemplate, consent: waConsent });
const healthWatch = require('./src/lib/health-watch')(pool, { sendText, jobLock });
const { describeImage } = require('./src/lib/wa-media');
const waTools = require('./src/lib/wa-tools')(pool, { quotes: waQuotes, production: waProd });
const waMemory = require('./src/lib/wa-memory')(pool);
const waAi    = require('./src/lib/wa-ai')(pool, waTools, { memory: waMemory });

// Staff management assistant over WhatsApp — the SAME agent fleet that powers the
// Ask-AI page (production/quality/analytics/receivables/etc.). Lets a manager text
// "production this week by machine" or "who owes us" and get a grounded answer.
// Read-only tools; role-gated so financial figures need SUPERVISOR+.
const { buildFleet } = require('./src/ai/fleet');
const staffFleet = buildFleet({ pool });
async function staffAssistant(question, { role = 'OPERATOR' } = {}) {
  try {
    const out = await staffFleet.ask({ question, user: { role } });
    if (!out || out.error) return null;
    // Only answer when the reply is actually anchored in fetched facts; a bare,
    // toolless guess is worse than staying silent and letting a person handle it.
    if ((out.confidence ?? 0) < 0.4 || !String(out.answer || '').trim()) return null;
    return out.answer.trim();
  } catch { return null; }
}

const waProcessor = require('./src/lib/wa-processor')({
  pool, crm: waCrm, ai: waAi, consent: waConsent, sendText, sendTemplate,
  handleInboundReply, buildStatusText, describeImage, staffAssistant,
});
const waQueue = require('./src/lib/wa-queue')(pool, { processor: waProcessor });

// The webhook is in the public allow-list (Meta cannot send a JWT); it is
// instead authenticated cryptographically by the HMAC middleware here. The
// GET verify handshake carries no body, so signature checking is POST-only.
app.use('/api/whatsapp/webhook', (req, res, next) => (req.method === 'POST' ? verifyWhatsappSignature(req, res, next) : next()));
app.use('/api/whatsapp/webhook', require('./src/routes/whatsapp-webhook.routes')({ queue: waQueue }));
app.use('/api/health', require('./src/routes/health.routes')({ pool, verifyToken, requireRole, jobLock }));
app.use('/api/monitor', require('./src/routes/monitor.routes')({ verifyToken, requireRole, monitor, errors: errorTracker, ci }));
app.use('/api/allocation', require('./src/routes/allocation.routes')({ pool, verifyToken, requireRole, allocation: lotAllocation, uom: uomConvert, sendTemplate }));
app.use('/api/logistics', require('./src/routes/logistics.routes')({ verifyToken, requireRole, logistics, returns: salesReturns }));
app.use('/api/wa/campaigns', require('./src/routes/wa-campaigns.routes')({ verifyToken, requireRole, campaigns: waCampaigns }));
app.use('/api/wa', require('./src/routes/wa-crm.routes')({ pool, verifyToken, requireRole, aiLimiter, crm: waCrm, ai: waAi, sendText, quotes: waQuotes, production: waProd, insights: waIns, followups: waFollow, consent: waConsent, queue: waQueue, inventory: waInv, approvals: waApprovals, margin: waMargin, payments: waPayments }));

// WhatsApp opt-in growth kit — QR / deep-link so prospects opt themselves in
app.use('/api/wa-optin', require('./src/routes/wa-optin.routes')({ pool, verifyToken, requireRole }));

// PARTNER SCORECARDS — supplier & customer performance (src/routes/scorecard.routes.js)
app.use('/api/scorecard', require('./src/routes/scorecard.routes')({ pool, verifyToken, requireRole }));

// SHADE APPROVALS — sample-approval loop (Shade Cards ↔ Sales)
// Schema is created in the serialized boot block (see server.listen) so it does
// not stampede the pool at module-load time.
app.use('/api/shade-approvals', require('./src/routes/shade-approval.routes')({ pool, verifyToken, requireRole }));

// ITC-04 — job-work GST return from subcontract challans/receipts
app.use('/api/itc04', require('./src/routes/itc04.routes')({ pool, verifyToken, requireRole }));

// ACCOUNTING ENGINE (Phase 1) — double-entry ledger in its own `acct` schema.
// Additive and isolated: nothing in the MES writes to it; Busy stays the book of
// record until a documented cutover (docs/accounting/MIGRATION_AND_CUTOVER.md).
// Schema is created in the serialized boot block (see server.listen) with
// retry/backoff so it does not stampede the pool at module-load time.
app.use('/api/acct', require('./src/routes/accounting.routes')({ pool, verifyToken, requireRole }));
app.use('/api/notify', require('./src/routes/notify.routes')({ verifyToken, requireRole, sendShiftSummary, buildSummary, notifyInvoice, notifyDispatch, notifyPO }));
// Public customer web-chat widget: same AI, same CRM inbox (channel='WEB'). No auth
// (anonymous visitors) — allow-listed in auth.js PUBLIC_ROUTES, rate-limited within.
const rateLimit = require('express-rate-limit');
app.use('/api/webchat', require('./src/routes/webchat.routes')({ pool, crm: waCrm, ai: waAi, rateLimit, tenant: { companyName: tenant.shortName } }));


// Multi-fabric lots: label = all fabrics in the lot joined (e.g. "Rib + Fleece").
// Body fabric + rib + collar/cuffs knit from the same yarn are dyed together so shades match.





// Delete a batch (OPEN or SEALED only) — returns rolls back to GREIGE


// â"€â"€ SUBCONTRACTING â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// SUBCONTRACT — layered module (src/routes/subcontract.routes.js)
app.use('/api/subcontract', require('./src/routes/subcontract.routes')({ pool, verifyToken, requireRole, nextSeq, addCostEntry, postToLedger, generateQR, rollQRContent, getYarnRate }));



// Knitting challan â€" sends yarn lots, receives rolls + balance yarn

// Receive back from knitting â€" rolls + balance yarn



// â"€â"€ FINISHED GOODS â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// FINISHED GOODS — stock/summary/location/edit/delete (layered: src/routes/finished-goods.routes.js)
app.use('/api/finished-goods', require('./src/routes/finished-goods.routes')({ pool, verifyToken, requireRole }));


// Update SC receipt invoice details

// Party-wise subcontract report with pending lots

// SC invoices pending payment — for invoice matching view


// DELETE Finished Goods (IN_STOCK only)

// CANCEL Subcontract Challan (SENT only — not yet received)

// DELETE Subcontract Challan (hard delete — number freed)

// EDIT Subcontract Challan (SENT only)

// ── SC FEATURE #1: Last rate lookup (auto-fill from previous challans) ──

// ── SC FEATURE #2: Auto wastage calculation on receipt ──

// ── SC FEATURE #3: Overdue challan alerts for Dashboard ──

// ── SC FEATURE #4: Analytics — vendor turnaround, wastage trends, cost trends ──

// ── SC FEATURE #5: Multi-process chaining — forward dyed batch to finishing ──

// EDIT Finished Goods

// EDIT Roll (OPEN, CLOSED, APPROVED — not SENT_OUT/DISPATCHED)

// DELETE Roll (CANCELLED only — permanent removal)

// â"€â"€ DISPATCH â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// DISPATCH — layered module (src/routes/dispatch.routes.js)
// Auto-invoicing: a priced dispatch raises a DRAFT tax invoice via the same GST
// service the manual Tax Invoice screen uses, linked by dispatch_challans.invoice_id.
const taxInvoicesService = require('./src/services/tax-invoices.service')(
  require('./src/repositories/tax-invoices.repository')(pool), { nextInvSeq, io });
const dispatchInvoicer = require('./src/lib/dispatch-invoice')({ pool, taxInvoices: taxInvoicesService });
app.use('/api/dispatch', require('./src/routes/dispatch.routes')({ pool, verifyToken, requireRole, nextSeq, numOrNull, postToLedger, autoInvoice: dispatchInvoicer }));

// --- Release Assignment ---

// OPENING BALANCES — one-time opening stock entry (layered: src/routes/opening.routes.js)
app.use('/api/opening', require('./src/routes/opening.routes')({ pool, verifyToken, requireRole, generateQR, rollQRContent }));





// -- WAREHOUSE DASHBOARD â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// INVENTORY VIEWS — warehouse/inventory/qr/work-center (layered: src/routes/inventory-views.routes.js)
app.use('/api', require('./src/routes/inventory-views.routes')({ pool, verifyToken }));

// ============================================================
// ENTERPRISE INVENTORY MODULE
// ============================================================




// â"€â"€ GRN â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// GRN — layered module (src/routes/grn.routes.js)
app.use('/api/grn', require('./src/routes/grn.routes')({ pool, verifyToken, requireRole, nextInvSeq, addCostEntry, postToLedger, io }));

// YARN — store + issues + returns (layered module: src/routes/yarn.routes.js)
app.use('/api', require('./src/routes/yarn.routes')({ pool, verifyToken, requireRole, nextInvSeq, addCostEntry, postToLedger, io }));

// â"€â"€ LIVE INVENTORY DASHBOARD â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// FINISHING — received-challan finishing/QC (layered: src/routes/finishing.routes.js)
app.use('/api/finishing', require('./src/routes/finishing.routes')({ pool, verifyToken, requireRole, io }));

// ============================================================
// QUALITY INSPECTION MODULE
// ============================================================

// QUALITY INSPECTIONS — CRUD + stats (layered: src/routes/quality-inspections.routes.js)
app.use('/api/quality-inspections', require('./src/routes/quality-inspections.routes')({ pool, verifyToken, requireRole, io }));
app.use('/api/fabric-inspection', require('./src/routes/fabric-inspection.routes')({ pool, verifyToken, requireRole }));
app.use('/api/defect-types', require('./src/routes/defect-types.routes')({ pool, verifyToken, requireRole }));
app.use('/api/ai', require('./src/routes/ai.routes')({ pool, verifyToken, requireRole, aiLimiter }));
app.use('/api/ocr', require('./src/routes/ocr.routes')({ verifyToken, requireRole, aiLimiter }));
app.use('/api/shade-swatches', require('./src/routes/shade-swatches.routes')({ pool, verifyToken, requireRole }));
app.use('/api/planning', require('./src/routes/planning.routes')({ pool, verifyToken, requireRole }));
app.use('/api/production-entry', require('./src/routes/production-entry.routes')({ pool, verifyToken, requireRole }));
app.use('/api/finished-entry', require('./src/routes/finished-entry.routes')({ pool, verifyToken, requireRole }));

// QUALITY REPORT — defect types + inspection report/CSV/PDF (layered: src/routes/quality-report.routes.js)
app.use('/api', require('./src/routes/quality-report.routes')({ pool, verifyToken, requireRole }));

// ============================================================
// COSTING MODULE
// ============================================================





// AI helper -- NVIDIA GLM-5.2 (primary), src/ai/glm.js
const { askGLM } = require('./src/ai/glm');


// COSTING — variance, rates, roll/batch/fg cost, summary, AI ask (layered: src/routes/costing.routes.js)
app.use('/api/costing', require('./src/routes/costing.routes')({ pool, verifyToken, requireRole, callOllama }));

// â"€â"€ INVENTORY REPORTS â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// 1. Yarn stock report â€" by type & color, received vs consumed vs remaining

// 2. Lot-wise ledger â€" each lot with full movement history

// 3. Consumption analysis â€" yarn issued vs fabric produced

// 4. Warehouse flow summary â€" rolls at each stage

// 5. Greige stock report — item-wise, lot-wise, colour-wise

// 6. Knitting / Job Work report — vendor-wise, lot-wise, colour-wise

// 7. Dyeing & Finishing report — item-wise, lot-wise, vendor-wise

// 8. Finished fabric report — item-wise, lot-wise, colour-wise

// ── TRACEABILITY ───────────────────────────────────────────
// TRACEABILITY — roll/lot chain + search (layered: src/routes/traceability.routes.js)
app.use('/api/traceability', require('./src/routes/traceability.routes')({ pool, verifyToken }));

// Trace by yarn lot number — forward chain from lot → rolls → batches → SC → FG → dispatch

// Search lots for traceability

// Search rolls for traceability

// â"€â"€ QR lookup â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// React Router catch-all â€" must be after ALL api routes
// ============================================================
// All /api/erp/* routes require a valid JWT
app.use('/api/erp', verifyToken);

// ERP â€" STOCK LEDGER HELPER (Phase 1)
// ============================================================


// ============================================================
// ERP â€" DOC SERIES (Phase 0-A)
// ============================================================


// ERP ITEM MASTER — layered module (src/routes/erp-items.routes.js): items+BOM, hsn, uom, item-categories, doc-series
app.use('/api/erp', require('./src/routes/erp-items.routes')({ pool, verifyToken, requireRole, numOrNull }));



// ============================================================
// ERP â€" ITEM MASTER (Phase 0-B)
// ============================================================

// --- UOM ---

// --- HSN Codes ---


// --- Item Categories ---

// --- Items LIST ---

// --- Item GET single ---

// --- Item CREATE ---

// --- Item UPDATE ---

// --- Item DEACTIVATE ---

// --- BOM (Bill of Materials) for fabric items ---


// Import fabric types from fabric_types table → items master

// ============================================================
// ERP â€" STOCK LEDGER QUERIES (Phase 1)
// ============================================================

// Stock Statement: current balance by item_desc + warehouse
// ERP MASTERS — layered module (src/routes/erp-masters.routes.js): stock-statement/ledger, financial-years, departments, cost-centres, tax-rates, process-routes
app.use('/api/erp', require('./src/routes/erp-masters.routes')({ pool, verifyToken, requireRole }));


// Stock Ledger: transaction log for a specific item or doc

// ============================================================
// ERP â€" PARTNER MASTER (Phase 0-C)
// ============================================================


// Auto-generate partner code

// --- Partner LIST ---
// ERP PARTNERS + LOCATIONS — layered module (src/routes/erp-partners.routes.js): partners, warehouses/racks/bins
app.use('/api/erp', require('./src/routes/erp-partners.routes')({ pool, verifyToken, requireRole }));


// --- Partner GET single (full detail) ---

// --- Partner CREATE ---

// --- Partner UPDATE (core fields + roles) ---

// --- Partner: add address ---

// --- Partner: add contact ---

// --- Partner: delete contact ---

// --- Partner: add bank ---

// --- Partner: deactivate ---

// ============================================================
// ERP â€" LOCATION MASTER (Phase 0-D)
// â"€â"€ WORK CENTER STOCK / SHORTAGE â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// ============================================================








// ============================================================
// ERP â€" OTHER MASTERS (Phase 0-E)
// ============================================================

// Financial Years

// Departments

// Cost Centres

// Tax Rates

// ============================================================
// ERP â€" PROCESS ROUTES (Phase 0-F)
// ============================================================








// BUSY 21 CSV SYNC — GRN + dispatch CSV exports (layered: src/routes/busy-sync.routes.js)
app.use('/api/busy-sync', require('./src/routes/busy-sync.routes')({ pool, verifyToken, requireRole }));

// IMPORT TRACKING & CONTROL TOWER — layered module (src/routes/imports.routes.js)
app.use('/api/imports', require('./src/routes/imports.routes')({ pool, verifyToken, requireRole }));

// DEBT & LOAN MANAGEMENT — CFO module §10 (src/routes/loans.routes.js)
app.use('/api/loans', require('./src/routes/loans.routes')({ pool, verifyToken, requireRole, nextSeq }));

// BUDGET & SCENARIO PLANNING — CFO module §11 (src/routes/budgets.routes.js)
app.use('/api/budgets', require('./src/routes/budgets.routes')({ pool, verifyToken, requireRole }));

// ROLLING CASH-FLOW FORECAST — CFO module §5 (src/routes/cashflow.routes.js)
app.use('/api/cashflow', require('./src/routes/cashflow.routes')({ pool, verifyToken, requireRole }));

// MANUFACTURING PROFITABILITY — CFO module §7 (src/routes/profitability.routes.js)
app.use('/api/profitability', require('./src/routes/profitability.routes')({ pool, verifyToken, requireRole }));

// EXECUTIVE CFO DASHBOARD — CFO module §4 (src/routes/cfo.routes.js)
app.use('/api/cfo', require('./src/routes/cfo.routes')({ pool, verifyToken, requireRole }));

// MORNING BRIEFING — daily owner snapshot (src/routes/briefing.routes.js)
app.use('/api/briefing', require('./src/routes/briefing.routes')({ pool, verifyToken, requireRole }));

// GST summary — output GST from priced dispatches, input GST from yarn purchases (GRN)

// Database constraint violations that a handler did not catch itself. Registered
// before the SPA fallback so an /api error never renders as index.html.
app.use(require('./src/lib/db-errors').dbErrorHandler);

// Final catch-all for any error dbErrorHandler passed through. Without this, an
// unhandled error falls to Express's default handler, which leaks the stack
// trace to the client when NODE_ENV is not 'production'. This returns a clean
// JSON 500 for /api and logs the detail server-side only. 4-arg signature is
// what marks it as an error handler, so `next` must stay even though it is
// unused — the response ends here.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  require('./src/lib/observability').log('error', 'unhandled', {
    path: req.originalUrl, method: req.method, error: err && err.message });
  // Persist so it is queryable/resolvable in the System Monitor, not just in logs.
  errorTracker.record({ kind: 'route', method: req.method, path: req.originalUrl, status: 500,
    message: err && err.message, stack: err && err.stack, user: req.user && req.user.username });
  if (res.headersSent) return;
  if ((req.path || '').startsWith('/api')) {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
  res.status(500).send('Internal Server Error');
});

// Any /api request that matched no route returns a JSON 404 — never the SPA's
// index.html. Without this the catch-all below serves index.html for a mistyped /api
// path, and the frontend's res.json() then throws "Unexpected token '<'".
app.use('/api', (req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));

if (fs.existsSync(path.join(__dirname, '..', 'frontend', 'build'))) {
  // Standalone public customer chat widget — one self-contained page (no SPA build
  // assets), so only THIS path plus /api/webchat/* need to be opened in Cloudflare
  // Access while the rest of the app stays behind the staff login.
  app.get(['/webchat', '/webchat.html'], (_req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'webchat', 'widget.html'));
  });
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
  });
}

// ============================================================

const APP_PORT = parseInt(process.env.PORT || '4000');
server.listen(APP_PORT, async () => {
  await ensureProductionHistory();
  await ensureUsersSchema();
  await ensureMaintenanceSchema();
  await ensureOperatorsSchema();
  await ensurePurchaseOrdersSchema();
  await ensureSalesOrdersSchema();
  await ensureProductionPlansSchema();
  await ensurePayrollSchema();
  await ensureTaxInvoicesSchema();
  await ensureAlertAcksSchema();
  await ensureCollectorRollSchema();
  await ensureWaCrmSchema();
  await ensureLogisticsSchema();
  await ensureAllocationSchema();
  await ensureUomSchema();
  // Last: the balance views read tables created by several steps above.
  await ensureFinancialViews();
  // Baseline reference data — no-op unless a table is empty, so this only does
  // anything on a brand-new tenant database.
  await ensureReferenceData();
  // Last of the schema steps: the tables it constrains must all exist first.
  await ensureKnittingSchema();
  await ensureFinancialConstraints();
  // After payments exists — the match table has an FK to it.
  await ensureBankReconSchema();
  // After every table it touches exists.
  await ensureSoftDelete();
  // After partners exists — complaints reference it.
  await ensureComplaintsSchema();
  await ensureOrderLineWeights();
  await ensureBusyProductionSchema();
  // After rolls + app_settings exist — fabric inspection references the roll and
  // reads its grading thresholds from settings.
  await ensureFabricInspectionSchema();
  await ensureAiAgentsSchema();
  await ensureAiApprovalsSchema();
  await ensureCapaSchema();
  await ensureShadeSwatchesSchema();
  await ensureTimestamps();
  // Last: constrains what every step above has built, and is data-aware so a
  // violating row never stops the boot.
  await ensureCheckConstraints();
  // After the constraints above, so any key they add is indexed in the same boot.
  await ensureForeignKeyIndexes();

  // One-off changes that ensure*() cannot express. Runs last: these alter what
  // the steps above have just built.
  await migrate.run({ by: 'boot' });
  await seedDefaultAdmin();

  // AI Accountant: immutable audit trail table (spec §21). Created at boot so the
  // first AI-prepared action can be recorded.
  //
  // Each ensure runs serially (never a boot-time stampede on the shared pool) and
  // through withDbRetry, which retries transient connection timeouts with backoff
  // and records anything that still fails so the health check below can re-run it.
  // The trailing .catch keeps one failed step from stopping the rest of boot.
  await withDbRetry('ai-audit', () => require('./src/lib/audit')(pool).ensure()).catch(() => {});
  await withDbRetry('busy-bridge', () => require('./src/lib/busy-bridge')(pool).ensure()).catch(() => {});
  await withDbRetry('wa-campaigns', () => waCampaigns.ensure()).catch(() => {});
  await withDbRetry('error-tracker', () => errorTracker.ensure()).catch(() => {});
  await withDbRetry('ci', () => ci.ensure()).catch(() => {});
  await withDbRetry('import-schema', () => require('./src/lib/import-schema')(pool).ensure()).catch(() => {});
  await withDbRetry('loans', () => require('./src/lib/loans')(pool, { nextSeq }).ensure()).catch(() => {});
  await withDbRetry('budgets', () => require('./src/lib/budgets')(pool).ensure()).catch(() => {});
  await withDbRetry('cashflow', () => require('./src/lib/cashflow')(pool).ensure()).catch(() => {});
  await withDbRetry('profitability', () => require('./src/lib/profitability')(pool).ensure()).catch(() => {});
  // Shade approvals + accounting engine: moved here from module-load so they no
  // longer fire concurrently during route registration (the stampede that timed
  // them out on VD). ensureAccountingSchema opens its own transaction-scoped
  // client, so it is the one most sensitive to a saturated pool — retry matters.
  await withDbRetry('shade-approvals', () => require('./src/lib/shade-approvals')(pool).ensure()).catch(() => {});
  await withDbRetry('acct', () => require('./src/lib/accounting/schema').ensureAccountingSchema(pool))
    .then(() => console.log('Accounting schema ready')).catch(() => {});
  // JWT revocation blocklist: ensure table + load the in-memory cache so verifyToken
  // can reject revoked tokens from the first request after boot.
  await require('./src/lib/token-revocation').init(pool).catch((e) => console.error('[token-revocation] init failed:', e.message));

  // Health check: re-run any ensure that still failed now that the boot stampede
  // has cleared and connections are free. Logs loudly if schema is still missing.
  await rerunFailed().catch((e) => console.error('[boot-ensure] health check error:', e.message));

  console.log(`Backend running on port ${APP_PORT} — ${tenant.name} [${tenant.code}] db=${process.env.DB_NAME}`);

  // Staging: a prod-copy instance for testing. It must NOT run scheduled jobs,
  // overwrite backups, burn API credits, or send real WhatsApp — so all of that is
  // skipped when STAGING=true. The HTTP API + UI still work against the copy DB.
  if (process.env.STAGING === 'true') {
    console.log('[STAGING] scheduled jobs, backups, tracking sync and outbound messaging are DISABLED.');
  } else {

  // Daily backup at 2 AM
  scheduleDailyBackup();

  // Retention at 3 AM — an hour after the backup, so anything deleted overnight
  // is already inside a dump that predates the deletion.
  retention.schedule();

  // Preventive-maintenance auto-scheduler: raise PREVENTIVE work orders for schedules
  // that have come due. Runs at startup, then every 6 hours.
  const pmScheduler = require('./src/lib/pm-scheduler')({ pool });
  pmScheduler.run().catch(() => {});
  jobLock.schedule('pm-scheduler', () => pmScheduler.run(), 6 * 60 * 60 * 1000);

  // Analytics warehouse rollup: pre-aggregates raw operational rows into
  // day-grained facts (machine/operator output, yarn, quality, order aging) that
  // the AI assistant and dashboards query. Runs at startup, then every 24 hours.
  // Fail-closed per section; writes little/nothing until source tables fill.
  const warehouseRollup = require('./src/lib/warehouse-rollup')({ pool });
  warehouseRollup.run().catch(() => {});
  jobLock.schedule('warehouse-rollup', () => warehouseRollup.run(), 24 * 60 * 60 * 1000);

  // Import tracking sync — polls the configured tracking provider for active
  // shipments. No-op (clean skip) until TRACKING_PROVIDER + TRACKING_API_KEY are
  // set; never fabricates data. Interval configurable (default 60 min).
  const importTrackingSync = require('./src/lib/import-tracking-sync')(pool);
  const trackMin = Math.max(parseInt(process.env.TRACKING_SYNC_INTERVAL_MIN, 10) || 60, 10);
  jobLock.schedule('import-tracking-sync', () => importTrackingSync.runAll(), trackMin * 60 * 1000);

  // Import exception engine — detects delays/customs-pending/GRN-pending/doc-missing/
  // shortage-risk and reconciles them. Runs at startup, then every 30 min.
  const importExceptions = require('./src/lib/import-exceptions')(pool);
  importExceptions.scan().catch(() => {});
  jobLock.schedule('import-exceptions-scan', () => importExceptions.scan(), 30 * 60 * 1000);

  // Morning Briefing — one honest daily owner snapshot. Tick every 15 min;
  // generates once it is >= 09:00 IST and today's briefing is not yet made.
  const morningBriefing = require('./src/lib/morning-briefing')(pool);
  morningBriefing.ensure().catch(() => {});
  jobLock.schedule('morning-briefing', () => morningBriefing.tick(), 15 * 60 * 1000);

  // Bank statement drop-folder poller — H2H Phase A (read-only). For each bank
  // account with inbox_dir set, picks up MT940/CAMT.053/CSV statement files, imports
  // and auto-reconciles them, and archives the file. No-op until an account
  // configures a folder; never sends money or holds a credential.
  const bankRecon = require('./src/lib/bank-recon')(pool);
  const bankFiles = require('./src/lib/bank-statement-files')(pool, bankRecon);
  const bankInboxMin = Math.max(parseInt(process.env.BANK_INBOX_INTERVAL_MIN, 10) || 5, 1);
  require('./src/lib/bank-statement-inbox')(pool, bankFiles).start({ intervalMs: bankInboxMin * 60 * 1000 });

  // Busy read-bridge drop-folder poller — Phase 1 (read-only). Picks up the
  // Windows extractor's busy-extract_*.json, mirrors Busy masters + TB into the
  // acct schema and reconciles. No-op until BUSY_INBOX_DIR is set; never writes to Busy.
  const busyInboxMin = Math.max(parseInt(process.env.BUSY_INBOX_INTERVAL_MIN, 10) || 10, 1);
  require('./src/lib/accounting/busy-inbox')(pool).start({ intervalMs: busyInboxMin * 60 * 1000 });

  // Start machine alert polling every 60 seconds (WhatsApp Cloud API).
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
    setInterval(checkMachineAlerts, 60 * 1000);
    startSummaryScheduler();
    startLowStockScheduler();
    waFollow.startScheduler();
    healthWatch.start();
    waQueue.startWorker();
    await waApprovals.seedDefaults();
    jobLock.schedule('expire-soft-holds', () => waInv.expireSoftHolds(), 15 * 60 * 1000);
    jobLock.schedule('expire-quotes', () => waQuotes.expireQuotes(), 60 * 60 * 1000);
    // Automated WhatsApp payment reminders — once a day (skips itself until the
    // payment_reminder template is approved at Meta).
    const paymentReminders = require('./src/lib/payment-reminders')({ pool, sendTemplate, consent: waConsent });
    jobLock.schedule('payment-reminders', () => paymentReminders.run(), 24 * 60 * 60 * 1000);

    // AI Accountant daily finance report — builds the brief, persists the latest
    // for the dashboard, and best-effort WhatsApps it to staff. Read-only.
    const financeReport = require('./src/lib/finance-report')({ pool, sendText });
    jobLock.schedule('finance-report', () => financeReport.run(), 24 * 60 * 60 * 1000);
    console.log('[ALERT] WhatsApp auto-alerts enabled (Cloud API)');
  } else {
    console.log('[ALERT] WhatsApp auto-alerts disabled - set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID in .env to enable');
  }

  } // end !STAGING scheduled-jobs guard
});

// Data collectors push to port 8090 â€" same express app, separate HTTP server
const DC_PORT = parseInt(process.env.DC_PORT || '8090');
const dcServer = http.createServer(app);
dcServer.listen(DC_PORT, () => console.log(`DC endpoint listening on port ${DC_PORT}`));

// HTTPS (self-signed, LAN) — required for phone-camera QR scanning, which browsers
// only allow in a secure context. Starts only if certs/ exists (generate with openssl).
try {
  const https = require('https');
  const certDir = require('path').join(__dirname, 'certs');
  const fsx = require('fs');
  if (fsx.existsSync(`${certDir}/key.pem`) && fsx.existsSync(`${certDir}/cert.pem`)) {
    const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || '4443');
    https.createServer(
      { key: fsx.readFileSync(`${certDir}/key.pem`), cert: fsx.readFileSync(`${certDir}/cert.pem`) },
      app
    ).listen(HTTPS_PORT, () => console.log(`HTTPS listening on port ${HTTPS_PORT} (self-signed — accept the browser warning once per device)`));
  } else {
    console.log('[HTTPS] certs/key.pem + certs/cert.pem not found — HTTPS disabled (camera QR scanning needs it)');
  }
} catch (e) { console.error('[HTTPS] failed to start:', e.message); }
