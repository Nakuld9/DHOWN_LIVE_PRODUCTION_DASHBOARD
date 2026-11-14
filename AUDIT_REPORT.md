# DHOWN HOSIERY MILLS MES — COMPLETE SYSTEM AUDIT REPORT

---

# ▶ AUDIT ADDENDUM — 2026-07-31 (latest; supersedes the June baseline below)

**Scope:** full-project audit on branch `server-refractor`. The June 2026 report
below is retained for history — most of its "not safe for deployment / 7 critical
bugs / 15 security gaps" findings are **resolved**; the system has since shipped the
full commercial/ERP backlog and is operationally live in PAPER-equivalent factory use.

## Headline: ~84/100 engineering-readiness (feature completeness ~92/100)

The gap between the two numbers is deliberate: the **feature set is ~92** (see
`PROJECT_STATE.md`), but **engineering-quality safeguards** (automated tests, uniform
auth) keep true unsupervised-production readiness at ~84.

## Architecture — major win since June
- **`server.js` refactored 7,914 → 791 lines.** The DI-pattern layering is essentially
  complete: **57** layered route mounts, only **1** inline route remains.
- Layered inventory: **31 controllers · 56 route modules · 31 repositories · 11 libs.**
- Backend ~16.7k LOC (excl deps/build); frontend 87 files, ~25.4k LOC.
- **0** `TODO/FIXME/HACK` markers in backend src.

## Machine-collector integration (delivered today)
- `POST /api/live-data` (DC_PORT 8090, `dcApiKeyGuard` via `x-api-key`) is mature:
  cumulative-counter delta → kg, status log, **auto-downtime**, OEE, hourly buckets,
  heartbeat, socket push. **Enhanced** to capture the collector's `stoppage_reason`
  into the downtime record (backward-compatible). Commit `2a4d1b8`.
- Self-hosted **ESP32 collector firmware v1.2.0** (`firmware/esp32-collector/`) aligned
  to that contract: built-in `ETH.h`/W5500, correct XH-600S tower-light semantics
  (green = roll-complete, run/stop from count pulse). Frontend confirmed to render it
  (`Dashboard.jsx`, `TVDashboard.jsx`). Pending hardware (parts ordered 2026-07-31).

## Findings, ranked

| Sev | Finding | Note |
|---|---|---|
| 🔴 High | **Zero automated tests** (0 test files, no `test` script) | System routes production, **costing, GST/financial** data with no regression net. Start with money + `/api/live-data` paths. |
| 🟠 Med | **Unauthenticated API routes** | `production`, `analytics`, `inventory-views`, `greige`, `traceability` (+ `dashboard`/`charts`/`command-center`) mount with no `verifyToken`. May be intentional LAN read-only — **confirm**; guard the business-data ones if not. |
| 🟠 Med | **`main` is 100 commits behind `server-refractor`** | All refactor + features + collector live only on the branch. Plan a promotion so `main` isn't a landmine. |
| 🟡 Low | **20 ad-hoc `migration_*.js`** + loose `.sql`, no ordered framework | Functional but a clean-rebuild is fragile. |
| 🟡 Low | **28 `console.log`** in backend | Move to structured logging / strip for prod. |
| 🟡 Low | CRLF/LF normalization on firmware files | Add `.gitattributes`. |

## Security posture — good
- `.env` gitignored and **not** tracked; no hardcoded secrets found.
- bcrypt passwords, JWT (random 256-bit), `dcApiKeyGuard`, rate limiters.
- WhatsApp webhook uses the correct Meta `hub.verify_token` handshake.

## Recommended next actions (priority order)
1. Confirm/close the **unauthenticated routes**.
2. **Register SJ03** in `machines` (`kg_per_counter`, `rpm_target`) + `data_collectors`
   before the ESP32 goes live, or production shows 0 kg.
3. Seed a **test harness** on money + ingest paths — biggest single risk reducer.
4. Plan the **`main` merge** of `server-refractor`.

---

# ◀ BASELINE AUDIT — 22 June 2026 (historical)

**Date:** 22 June 2026
**Auditor Roles:** Senior MES Architect · Manufacturing Consultant · QA Lead · Database Architect · Cybersecurity Auditor · Textile Industry Expert

---

## EXECUTIVE SUMMARY

The DHOWN MES has been built through 9+ development phases over approximately 12 days. The core engine is functional and architecturally sound for a Phase 1 factory deployment. However, there are **7 critical bugs**, **15 security gaps**, **12 missing textile-industry modules**, and a significant gap between what the codebase does and what the frontend claims to show. The system is **not yet safe for unsupervised factory deployment.**

---

## SECTION 1 — FRONTEND AUDIT

### 1.1 Pages Inventory (18 pages)

| Page | Route | Status | Issues |
|---|---|---|---|
| Login | `/login` | ✅ Working | Hardcoded `localhost:4000` URL |
| Dashboard | `/` | ✅ Working | Rich but very heavy — 20 components on one page |
| Machines | `/machines` | ✅ Working | Read-only, correct |
| Production | `/production` | ⚠️ Partial | Today's production calculated from rolls.actual_weight_kg (shows 0 until rolls are approved) |
| Operators | `/operators` | ✅ Working | Good CRUD, edit/deactivate implemented |
| Assignments | `/assignments` | ⚠️ Partial | List-only, no delete, no shift column |
| RFID Scan | `/rfid` | ❌ BROKEN | Calls `POST /api/rfid-scan` — endpoint does NOT exist |
| RFID Events | `/rfid-events` | ✅ Working | RFIDScan.jsx is a near-copy of RFIDEvents.jsx with a broken POST |
| Downtime | `/downtime` | ✅ Working | Best-implemented page in the system |
| Rolls | `/rolls` | ⚠️ Partial | Shift detection hardcoded, ignores configurable shift times |
| Reports Dashboard | `/reports` | ✅ Working | 9 report cards, filters |
| Report Preview | `/reports/preview` | ✅ Working | PDF export works |
| Maintenance | `/maintainence` | ⚠️ Minor | Route has a typo (`maintainence` not `maintenance`) |
| Alerts | `/alerts` | ⚠️ Partial | Shows raw data, no notification delivery |
| Settings | `/settings` | ✅ Working | 7 tabs, well-structured |
| User Management | `/users` | ✅ Working | CRUD, PIN management |
| Machine Details | `/machine/:id` | ✅ Working | 5-second refresh |
| TV Dashboard | `/tv-dashboard` | ✅ Working | 1920×1080 layout, proper |

### 1.2 Navigation

- Sidebar has no active-state highlighting — you cannot tell which page you are on.
- No breadcrumb navigation on any page.
- TV Dashboard link opens in a new tab (correct).
- Sidebar has no `RFID Scan` link, only `RFID Events`. The RFIDScan page is unreachable from the sidebar.
- No logout button anywhere in the sidebar.

### 1.3 Responsiveness

- **Zero responsive design.** Every page uses fixed pixel values and CSS Grid with hardcoded column counts.
- Dashboard will break below 1280px width.
- Production table overflows on any screen under 1100px.
- TV Dashboard is hardcoded to `1920px × 1080px` — will not render correctly on any other screen.
- No `@media` queries anywhere in the codebase.
- The system is desktop-only by design; this is acceptable for factory floor PCs but limits supervisor mobility.

### 1.4 Forms & Validation

- Operators form: validates required fields client-side. Good.
- Rolls form: validates machine selection. Good.
- Maintenance form: validates machine and technician. Good.
- Login form: no password strength indicator, no "show password" toggle.
- User Management form: no minimum password length enforcement client-side.
- Settings form: no validation on shift times (could set day shift end before start).
- **No `confirm before delete` dialog anywhere except Settings (DC deletion).**

### 1.5 Error Handling

- Most pages have `console.error(err)` but no visible user error message on data load failure.
- Production.jsx silently fails on API errors — shows blank table.
- Alerts.jsx silently fails — shows "Loading Alerts…" forever.
- Dashboard.jsx has no error state at all — if `/api/machines` fails, it shows an empty grid forever with no message.
- TV Dashboard has an empty `catch {}` — errors are completely swallowed.

### 1.6 User Experience

- The `authFetch.js` monkey-patching of `window.fetch` is clever but dangerous — it silently injects tokens on ALL requests to port 4000.
- `axios` is installed as a dependency but `api.js` is never used anywhere — all pages use raw `fetch`.
- No loading spinners on most pages (just blank states).
- No empty-state messages (e.g., "No rolls today" vs blank table).
- Hardcoded `http://localhost:4000` in Login.jsx (not covered by authFetch).

---

## SECTION 2 — BACKEND AUDIT

### 2.1 API Inventory (server.js — 3460 lines)

| Group | Endpoints | Auth |
|---|---|---|
| Machines | GET, PUT `/api/machines`, GET `/api/machines/:id/details` | ❌ None |
| Live Data | GET, POST `/api/live-data` | ❌ None |
| Operators | GET, POST `/api/operators`, PUT `/api/operators/:id`, DELETE `/api/operators/:id` | DELETE only |
| Assignments | GET, POST `/api/assignments`, GET `/api/active-operators` | ❌ None |
| RFID | GET `/api/rfid/:tag`, GET `/api/rfid-events` | ❌ None |
| Downtime | GET, POST, PUT `/api/downtime/*` | ❌ None |
| Rolls | GET `/api/rolls`, POST `/api/rolls`, PUT `/api/rolls/:id/close`, PUT `/api/rolls/approve/:id` | ❌ None |
| Reports | 10+ report endpoints | ❌ None |
| Settings | GET `/api/settings`, PUT `/api/settings` | PUT only |
| Maintenance | GET, POST, PUT, DELETE `/api/maintenance` | ❌ None |
| Data Collectors | GET, PUT, DELETE `/api/data-collectors` | ❌ None |
| Users | GET, POST, PUT, DELETE `/api/users`, PIN endpoints | ✅ All |
| Audit Logs | GET `/api/audit-logs` | ✅ Yes |
| Auth | POST `/api/auth/login`, POST `/api/auth/supervisor-pin` | N/A |
| Fabric Types | GET, POST, PUT, DELETE `/api/fabric-types` | POST/PUT/DELETE |
| Machine Settings | GET, PUT `/api/machine-settings` | PUT only |
| Analytics | GET `/api/analytics/shifts`, `/api/analytics/top-downtime` | ❌ None |
| OEE | GET `/api/oee`, `/api/oee/:id`, `/api/utilization/*` | ❌ None |
| Charts | GET `/api/charts/trends`, `/api/charts/production-hourly` | ❌ None |
| Production | GET `/api/production/current`, `/daily`, `/shift` | ❌ None |
| Dashboard | GET `/api/dashboard/kpis`, `/live`, `/oee`, `/production-trend` | ❌ None |
| Backup | POST `/api/backup` | ✅ Yes |

### 2.2 Authentication & Authorization

**Authentication: PARTIALLY implemented**
- JWT auth exists and works.
- Login is rate-limited (10/15 min per IP). ✅
- authFetch.js sends token on all fetch calls to port 4000. ✅

**Authorization: CRITICALLY MISSING**
- `verifyToken` middleware exists but is only applied to a small subset of endpoints.
- Every other endpoint — including POST /api/live-data, all downtime endpoints, all roll endpoints, all maintenance endpoints, all production endpoints — has **zero authentication**.
- There is a `verifyToken` function but NO role-checking middleware. All 5 roles (SUPER_ADMIN through VIEWER) get identical access to every endpoint. The role system is entirely decorative.
- An unauthenticated HTTP request from curl can create downtime records, close rolls, update machine settings.

### 2.3 API Design Issues

- `GET /api/rolls` is registered **twice** in server.js (lines ~339 and ~1901). Express last-win means second registration takes effect — first is dead code.
- `POST /api/rfid-scan` does not exist. RFIDScan.jsx calls it — immediate 404.
- `/api/dashboard/oee` is registered twice. Fragile pattern.
- No API versioning (`/api/v1/`).
- No pagination on any GET endpoint. Returns all records every time.
- The `supervisor-pin` endpoint has no rate limiting — brute-forceable (10,000 combinations).
- Port 8080 (DC push endpoint) runs the same Express app but with NO auth.

### 2.4 Logging

- `console.error(err)` is the only logging mechanism.
- No structured logging (Winston, Pino, etc.).
- No request logging/access log.
- No log rotation or persistence.
- All errors will be lost when the Node process restarts.

### 2.5 POST /api/live-data — Production Engine Analysis

The core engine is well-structured. However:
- Step 9 (production_records upsert): If a collector restarts and sends counter from 0, the delta calculation resets to full counter value — **production inflation** on collector restart.
- No max-delta sanity check (e.g., reject deltas > 10 KG per cycle).
- At 18 machines pushing every few seconds, a single counter reset of 50,000 counts will add ~50 KG in one step.

---

## SECTION 3 — DATABASE AUDIT

### 3.1 Tables Inventory (18 tables)

`app_settings`, `audit_logs`, `data_collectors`, `fabric_types`, `machine_downtime`, `machine_live_data`, `machine_status_log`, `machines`, `maintenance_records`, `oee_records`, `operator_assignments`, `operators`, `production_history`, `production_records`, `rfid_events`, `rolls`, `supervisors`, `users`

### 3.2 Missing Tables (Critical)

| Missing Table | Required For |
|---|---|
| `yarn_inventory` | Yarn cone stock, consumption per machine |
| `spare_parts_inventory` | Needles, sinkers, oil, belts |
| `quality_inspections` | Defect records per roll |
| `shift_handovers` | Formal handover notes |
| `production_orders` | Customer order → production lot linkage |
| `attendance` | Operator present/absent per shift |
| `maintenance_schedule` | Preventive maintenance calendar |
| `machine_parameters` | Stitch length, loop settings per program |

### 3.3 Missing Columns (Important)

| Table | Missing Column |
|---|---|
| `machines` | `install_date`, `manufacturer`, `model_number`, `serial_number` |
| `machines` | `needles_count`, `cylinder_diameter` (specific to circular knitting) |
| `operators` | `employee_id`, `join_date`, `skill_level` |
| `rolls` | `quality_grade` (A/B/C/Reject), `defect_type`, `inspector_id` |
| `rolls` | `lot_number`, `order_id` |
| `maintenance_records` | `parts_used`, `cost`, `downtime_caused_minutes` |
| `operator_assignments` | `shift` column |
| `rfid_events` | `event_type` (ENTRY/EXIT/MACHINE_ASSIGN), proper `machine_id` FK |

### 3.4 Constraints & Integrity Issues

- Most table relationships are enforced by application logic only — no DB-level FK constraints.
- `operators.operator_code` has no UNIQUE constraint — duplicate codes are possible.
- `rolls.operator_id` has no FK constraint to `operators`.
- `rfid_events.operator_id` has no FK constraint.
- `rfid_events.machine_id` is never set by the RFID lookup endpoint.
- `maintenance_records.machine_id` has no FK constraint.
- `supervisor_name` stored as text in `rolls` instead of FK to `users`.
- `operator_assignments` stores `operator_name` as denormalized text — name changes don't propagate.
- `oee_records.quality` is always inserted as `qualityTarget` (default 100). Never actually measured.

### 3.5 Missing Indexes

| Index Needed | Table | Query Pattern |
|---|---|---|
| `(machine_id, DATE(start_time), shift)` | `machine_status_log` | 3 queries per DC push |
| `(machine_id, status)` | `machine_downtime` | Queried on every DC push |
| `(event_time DESC)` | `rfid_events` | Date-range report queries |
| `(status)` | `operator_assignments` | Active assignments filter |
| `(timestamp DESC)` | `audit_logs` | Recent logs query |

### 3.6 Data Consistency

- `machines` has both `fabric` (free-text) and `fabric_code` (FK). Updated independently — will diverge.
- `supervisors` table is an orphan — completely unused after `users` table took over auth.
- `production_records.production_kg` accumulates small floating-point additions each push — potential precision drift over thousands of pushes.

---

## SECTION 4 — MES FUNCTIONAL COVERAGE

| Module | Coverage | Notes |
|---|---|---|
| Production | ✅ 75% | Live counter, production_records, OEE — missing order tracking |
| Operators | ✅ 80% | CRUD, RFID, department, shift — missing attendance |
| Supervisors | ⚠️ 40% | Mobile app exists, PIN auth — orphaned supervisors table |
| Users | ✅ 85% | 5 roles, PIN, CRUD — no RBAC enforcement |
| RFID | ⚠️ 50% | Events stored — scan page broken, machine_id never captured on scan |
| Roll Tracking | ✅ 70% | Auto-ID, open/close/approve — no quality grade, no lot linkage |
| Machine Monitoring | ✅ 85% | Live RPM, status, OEE, downtime — strong |
| Data Collectors | ✅ 75% | Dual port, auto-register, heartbeat — no auth on port 8080 |
| Reports | ✅ 80% | 9 reports, PDF, filters — no attendance report, no QC report |
| Alerts | ⚠️ 35% | Alert page shows data — no notification delivery |
| Maintenance | ✅ 65% | Records CRUD — no preventive schedule, no parts tracking |
| Inventory | ❌ 0% | Not built |
| Shift Management | ✅ 70% | 2/3-shift config — no formal handover workflow |
| Audit Trail | ✅ 60% | audit_logs exists — only USER_MANAGEMENT logged, records "system" not actual user |
| OEE | ✅ 70% | Calculated and stored — Quality dimension always 100% |
| Downtime | ✅ 85% | Auto-detection, manual, reasons, stats — best module in the system |
| Quality | ❌ 5% | Quality component of OEE hardcoded to 100% |
| Backup & Restore | ✅ 60% | Backup works — no restore endpoint, no scheduled auto-backup |

---

## SECTION 5 — TEXTILE FACTORY REQUIREMENTS (Missing Modules)

For a **circular knitting factory**, the following standard MES modules do not exist:

1. **Yarn/Cone Management** — Which yarn (denier, type, color, lot) is on which machine feeder.
2. **Needle & Sinker Inventory** — Circular knitting machines require needle changes every 90–120 days.
3. **Production Orders / Lot Numbers** — Linking fabric produced to specific customer orders.
4. **Quality Inspection Module** — GSM checks, hole count, fabric defects, roll grading (A/B/Reject).
5. **Worker Attendance Module** — RFID events exist but not processed into an attendance register.
6. **Shift Handover Notes** — Formal digital handover between Day/Night shift supervisors.
7. **Preventive Maintenance Calendar** — Service due alerts based on running hours or date.
8. **Wastage Tracking** — Yarn waste, fabric trimmings per machine per roll.
9. **Stitch Program Management** — Machine programs (loop length, tension, speed) per fabric type.
10. **Energy / Power Monitoring** — DB structure should plan for future hardware integration.
11. **Supplier Management** — Yarn suppliers, delivery dates, lot quality for incoming material.
12. **Roll Dispatch / Delivery** — No dispatch module for approved rolls.

---

## SECTION 6 — INDUSTRY 4.0 READINESS

| Capability | Status | Notes |
|---|---|---|
| Real-time monitoring | ✅ 70% | 5-second polling + Socket.io. Socket.io fires on data push only. |
| Predictive maintenance | ❌ 0% | No run-hour counters, no statistical models |
| Mobile app support | ✅ 60% | Expo app exists (iOS/Android) — only 4 screens |
| Dashboard TV mode | ✅ 80% | TV Dashboard well-designed for 1080p |
| QR code support | ⚠️ 5% | qr_prefix in app_settings but zero QR functionality built |
| AI assistant | ❌ 0% | Not built |
| Advanced analytics | ⚠️ 25% | OEE, downtime trends, production trends exist. No trend prediction. |
| API for 3rd party | ⚠️ 40% | APIs exist but no auth on most, no API docs |
| MQTT support | ⚠️ 10% | `backend/config/mqtt.js` exists but is never imported or used |
| Edge computing | ❌ 0% | All computation on central server |

---

## SECTION 7 — SECURITY AUDIT

### 7.1 Password Storage — PASS ✅
- bcrypt with cost factor 10 for passwords.
- bcrypt with cost factor 6 for PINs (intentionally lower — acceptable).

### 7.2 Authentication — PARTIAL ⚠️
- JWT with HS256, 8-hour expiry. ✅
- Login rate-limited (10/15 min per IP). ✅
- No refresh token mechanism. ⚠️
- No token blacklist/revocation. ⚠️
- **POST /api/auth/supervisor-pin has NO rate limit. Full 10,000 PIN space brute-forceable in seconds over LAN.** ❌

### 7.3 Session Management — PARTIAL ⚠️
- Token stored in localStorage (XSS-vulnerable vs. httpOnly cookie). ⚠️
- authFetch auto-redirects to `/login` on 401. ✅
- No logout endpoint — client-side localStorage deletion only. ⚠️
- No session invalidation on password change. ❌

### 7.4 SQL Injection — PASS ✅
- All database queries use parameterized statements (`$1`, `$2`).
- No string concatenation in SQL.
- Dynamic WHERE clause building uses parameter arrays (correct pattern).

### 7.5 API Security — CRITICAL FAILURES ❌
- **Port 8080 (DC push endpoint): Zero authentication.** Any device on the factory LAN can send any production data.
- **RBAC does not exist.** A VIEWER user can execute PUT /api/settings, DELETE /api/maintenance, POST /api/rolls.
- **Most production/operations endpoints require no login at all.** A curl command from any network PC can create downtime records.
- CORS allows all 192.168.x.x origins — acceptable for a closed factory LAN. ✅

### 7.6 Audit Logging — PARTIAL ⚠️
- audit_logs table exists and captures user management actions. ✅
- `username` field hardcoded as `'system'` instead of extracting from JWT. All audit records say "system". ❌
- Downtime create/close, machine settings changes, roll approvals are NOT audit-logged. ❌

### 7.7 Secrets Management — PARTIAL ⚠️
- `.env` file exists. ✅
- JWT secret: `dhown_mes_jwt_secret_2026_hosiery_mills` — predictable, should be a random 256-bit value. ⚠️
- DB password: `dhown123` — weak, should be changed before production. ⚠️
- Backup command uses `PGPASSWORD` environment variable (visible in OS process list during backup). ⚠️

### 7.8 Transport Security
- Entire system runs over HTTP. Tokens and passwords transmitted in cleartext over the LAN.
- Acceptable for a closed factory network initially, unacceptable if ever internet-connected.

---

## SECTION 8 — DEPLOYMENT READINESS SCORES

| Tier | Score | Key Blockers |
|---|---|---|
| **Development (Local)** | **72%** | Broken RFID scan, duplicate route, production page metric wrong |
| **Factory Pilot (10 machines, supervised)** | **45%** | No DC auth, no RBAC, supervisor PIN brute-forceable, no inventory, audit logs broken |
| **Full Production (18 machines, autonomous)** | **28%** | All of above + no quality module, no attendance, no preventive maintenance, no order tracking |

---

## SECTION A — STRENGTHS

1. Core architecture (React + Express + PostgreSQL) is solid and appropriate.
2. Production engine (POST /api/live-data) is technically impressive — 11-step pipeline.
3. Auto downtime detection is a genuine MES feature, correctly implemented.
4. OEE calculation is mathematically correct (Availability × Performance × Quality).
5. Machine sort order (SJ→RB→IL→TV) consistently applied across all reports.
6. TV Dashboard is purpose-built for factory floor display — good UX for the use case.
7. Roll ID auto-generation with machine, fabric, date, shift embedded — excellent traceability.
8. Shift detection is configurable from app_settings — no hardcodes in the engine.
9. bcrypt password hashing correctly implemented.
10. Parameterized SQL throughout — no injection risk.
11. Dual-port DC listener (4000 and 8080) is the right design for factory hardware.
12. 7-tab Settings page is comprehensive.
13. Supervisor mobile app (Expo) with PIN auth is forward-thinking.
14. Rate limiting on login endpoint.
15. Fabric type master table with FK linking is correct data modelling.

---

## SECTION B — WEAKNESSES

1. RBAC is a facade — roles exist in DB but never enforced in any API endpoint.
2. Most API endpoints have no authentication at all.
3. Port 8080 (DC endpoint) has zero authentication — most critical attack surface.
4. Supervisor PIN endpoint has no rate limit.
5. Audit logs record "system" instead of the actual logged-in user.
6. The `supervisors` table is an orphan — completely unused.
7. `axios` is installed but never used — dead dependency.
8. `mqtt.js` config exists but is never imported.
9. Socket.io emits fewer events than the dashboard expects.
10. RFID scan page is broken (calls non-existent endpoint).
11. Dashboard has no error state — fails silently.
12. Production.jsx shows "Today's Production" from wrong data source.
13. Rolls.jsx hardcodes shift detection, ignoring user settings.
14. OEE quality factor is hardcoded to 100% — not measured.
15. All front-end pages are non-responsive (desktop-only).

---

## SECTION C — MISSING FEATURES

1. `POST /api/rfid-scan` endpoint
2. Role-based access control middleware
3. Rate limiting on supervisor PIN endpoint
4. Restore endpoint (`POST /api/restore`)
5. Scheduled automatic backup
6. QR code generation and label printing
7. Attendance module (from RFID events)
8. Quality inspection module
9. Yarn/cone inventory management
10. Spare parts inventory
11. Preventive maintenance scheduler
12. Shift handover notes
13. Production order/lot number management
14. Roll grading (A/B/C/Reject)
15. Wastage tracking
16. Email/SMS/WhatsApp alert delivery
17. MQTT integration
18. Pagination on all list endpoints
19. Logout endpoint (server-side token invalidation)
20. API documentation

---

## SECTION D — CRITICAL BUGS

| # | Severity | Bug | Location |
|---|---|---|---|
| 1 | 🔴 CRITICAL | `RFIDScan.jsx` calls `POST /api/rfid-scan` — endpoint does not exist → 404 | `RFIDScan.jsx:41` |
| 2 | 🔴 CRITICAL | Port 8080 DC endpoint has zero auth — any LAN device can inject production data | `server.js:3459` |
| 3 | 🔴 CRITICAL | No RBAC — all 5 roles have identical API access | Global |
| 4 | 🔴 CRITICAL | Supervisor PIN endpoint has no rate limiting — brute-forceable | `server.js:3142` |
| 5 | 🟠 HIGH | `GET /api/rolls` registered twice — first (line 339) is dead code | `server.js:339, 1901` |
| 6 | 🟠 HIGH | Production.jsx "Today's Production" uses wrong data source (shows 0 all day) | `Production.jsx:63` |
| 7 | 🟠 HIGH | Counter reset on DC restart causes production inflation | `server.js:1582` |
| 8 | 🟡 MEDIUM | Rolls.jsx shift detection hardcoded to `hour >= 8` ignoring app_settings | `Rolls.jsx:11` |
| 9 | 🟡 MEDIUM | Audit logs write `'system'` as username — audit trail useless | `server.js:3001, 3033` |
| 10 | 🟡 MEDIUM | No loading/error state on Dashboard — blank screen on API failure | `Dashboard.jsx` |
| 11 | 🟡 MEDIUM | OEE quality always 100% — never measured from actual defect data | `server.js:1533` |
| 12 | 🟡 MEDIUM | `machine_status_log` has no index on `(machine_id, DATE(start_time), shift)` — 3 heavy queries per DC push | DB schema |

---

## SECTION E — RECOMMENDED DATABASE CHANGES

### Critical (before factory pilot)

1. Add UNIQUE constraint on `operators.operator_code`
2. Add index: `CREATE INDEX idx_status_log_machine_date ON machine_status_log(machine_id, DATE(start_time), shift)`
3. Add index: `CREATE INDEX idx_downtime_machine_status ON machine_downtime(machine_id, status)`
4. Add index: `CREATE INDEX idx_rfid_events_time ON rfid_events(event_time DESC)`
5. Add index: `CREATE INDEX idx_assignments_status ON operator_assignments(status)`
6. Add FK: `rfid_events.machine_id → machines(machine_id)`
7. Deprecate/drop `supervisors` table (replace with `users` WHERE role='SUPERVISOR')
8. Remove `machines.fabric` TEXT column, use only `machines.fabric_code` FK

### Important (before full production)

9. Add `quality_grade`, `defect_type`, `lot_number` columns to `rolls`
10. Add `employee_id`, `join_date`, `skill_level` to `operators`
11. Add `parts_used`, `cost` to `maintenance_records`
12. Add `shift` column to `operator_assignments`
13. Create `quality_inspections` table
14. Create `yarn_inventory` table
15. Create `production_orders` table
16. Create `shift_handovers` table
17. Create `maintenance_schedule` table
18. Create `attendance` table (from rfid_events processing)

---

## SECTION F — RECOMMENDED API CHANGES

### Critical

1. Add `POST /api/rfid-scan` endpoint (machine-specific RFID scan that records machine_id)
2. Add rate limiting to `POST /api/auth/supervisor-pin` (max 5 attempts/5 min per IP)
3. Add authentication to `POST /api/live-data` — at minimum an API key check for DC devices
4. Add role-based middleware — `requireRole('ADMIN')`, `requireRole('SUPERVISOR')` etc.
5. Fix audit_log inserts to use `req.user.username` from JWT instead of `'system'`
6. Add pagination to all list endpoints (`?page=&limit=`)
7. Add `DELETE /api/assignments/:id` endpoint
8. Add `PUT /api/operators/:id/activate` endpoint
9. Remove duplicate `GET /api/rolls` registration

### Important

10. Add `POST /api/restore` endpoint
11. Add `GET /api/attendance` endpoint (derived from rfid_events)
12. Add `POST /api/alerts/send` endpoint (email/SMS notification)
13. Add API key header validation for DC push on port 8080
14. Add `GET /api/health` endpoint for monitoring
15. Add API versioning (`/api/v1/`)

---

## SECTION G — RECOMMENDED UI CHANGES

### Critical

1. Add active-state highlighting to sidebar
2. Add a **Logout button** to the sidebar or top bar
3. Fix `Dashboard.jsx` to show error state when API fails
4. Fix `Production.jsx` to use `today_production_kg` from `/api/machines` (already available)
5. Fix `Rolls.jsx` to use shift from app_settings not hardcoded hours
6. Add `RFID Scan` to sidebar navigation
7. Fix TV Dashboard to handle viewport sizes other than 1920px (use `vw/vh` units)

### Important

8. Add empty-state messages on all tables
9. Add loading spinners on all data-fetching pages
10. Replace `window.confirm()` alerts with proper modals
11. Rename route from `/maintainence` to `/maintenance`
12. Fix `machines.fabric` display in Production.jsx
13. Add "Forgot Password" flow (admin reset)
14. Add pagination to RFID Events table
15. Add responsive breakpoints for at least 1280px screens

---

## SECTION H — RECOMMENDED REPORTS

Currently missing reports that a hosiery factory needs daily:

1. **Daily Production Summary** — Per machine, per shift, total KG vs target
2. **Operator Attendance & Performance** — Present/absent, machines worked, KG produced
3. **Roll Quality Register** — All rolls with grade, weight, defects, inspector
4. **OEE Trend Report (7/30 days)** — Availability, Performance, Quality over time
5. **Preventive Maintenance Due** — Machines due for service in next 7/15/30 days
6. **Yarn Consumption Report** — KG yarn consumed vs KG fabric produced (yield)
7. **Downtime Pareto (Shift-wise)** — Top reasons by downtime minutes
8. **Machine Efficiency Ranking** — All 18 machines ranked by OEE for current week
9. **Night Shift Production Report** — Auto-generated at shift end for management
10. **Customer Order Progress Report** — Lot-wise production vs order quantity

---

## SECTION I — RECOMMENDED MOBILE FEATURES

Current Supervisor App has 4 screens. Recommended additions:

1. **Roll Start/Close from mobile** — Supervisor starts/closes roll with weight entry on phone
2. **Downtime Reason Assignment** — Tap machine → assign reason → close downtime from floor
3. **Push notifications** — Alert when machine stops > threshold (Firebase/Expo Push)
4. **Maintenance work order** — Log technician work from mobile
5. **NFC/RFID scan** — Most Android phones can read 125kHz RFID
6. **Barcode/QR roll scanning** — Scan roll QR for quality inspection or dispatch
7. **Shift dashboard** — Shift supervisor view of his own machines
8. **Photo attachment** — Attach photo to downtime reason or maintenance record

---

## SECTION J — FINAL COMPLETENESS SCORE

| Dimension | Score |
|---|---|
| Core Machine Monitoring | 85/100 |
| Production Tracking | 70/100 |
| Downtime Management | 85/100 |
| Roll Tracking | 70/100 |
| RFID Integration | 45/100 |
| Operator Management | 75/100 |
| User Security & Access | 40/100 |
| Reports & Analytics | 70/100 |
| Maintenance Module | 55/100 |
| Inventory Management | 0/100 |
| Quality Management | 5/100 |
| Shift Management | 60/100 |
| Mobile App | 45/100 |
| Database Integrity | 55/100 |
| Industry 4.0 Readiness | 35/100 |
| **OVERALL MES COMPLETENESS** | **56/100** |

---

## PRIORITY MATRIX

### PRIORITY 1 — Must Complete Before Factory Deployment

| # | Task | Risk if Skipped |
|---|---|---|
| P1-01 | Add rate limiting to supervisor PIN endpoint | PIN brute-force in seconds |
| P1-02 | Add API key authentication to port 8080 DC endpoint | Fake production data injection |
| P1-03 | Fix `POST /api/rfid-scan` endpoint | RFID scan feature is completely dead |
| P1-04 | Fix audit_log inserts to use `req.user.username` from JWT | Audit trail useless — all actions say "system" |
| P1-05 | Fix Production.jsx "Today's Production" to use correct data source | Floor managers see 0 production all day |
| P1-06 | Add counter-reset protection in POST /api/live-data | Production figures inflate dramatically on DC restart |
| P1-07 | Add active sidebar highlighting + logout button | No UX for current page; no way to log out |
| P1-08 | Add missing DB indexes (machine_status_log, machine_downtime, rfid_events) | Poor performance with 18-machine concurrent data |
| P1-09 | Fix Rolls.jsx shift detection to read from app_settings | Wrong shift label on rolls from day one |
| P1-10 | Remove duplicate `GET /api/rolls` registration | Unpredictable behavior |

### PRIORITY 2 — Important Improvements (First Month)

| # | Task |
|---|---|
| P2-01 | Implement role-based access control middleware |
| P2-02 | Add authentication to all unprotected write endpoints |
| P2-03 | Add Dashboard error state |
| P2-04 | Fix OEE quality dimension |
| P2-05 | Add `POST /api/restore` and scheduled auto-backup |
| P2-06 | Add QR code label printing for rolls |
| P2-07 | Create shift handover module |
| P2-08 | Add preventive maintenance scheduler |
| P2-09 | Add pagination to all list endpoints |
| P2-10 | Add push notification delivery for critical alerts |
| P2-11 | Replace weak JWT secret with cryptographically random 256-bit value |
| P2-12 | Add `quality_grade` and `lot_number` columns to rolls |
| P2-13 | Add UNIQUE constraint on operators.operator_code |
| P2-14 | Add loading and empty states across all pages |
| P2-15 | Rename `/maintainence` route to `/maintenance` |

### PRIORITY 3 — Future Enhancements

| # | Task |
|---|---|
| P3-01 | Yarn/cone inventory management module |
| P3-02 | Spare parts (needle/sinker) inventory |
| P3-03 | Quality inspection module (GSM, defects, roll grading) |
| P3-04 | Operator attendance module (from RFID data) |
| P3-05 | Production order / lot number management |
| P3-06 | Wastage tracking per machine |
| P3-07 | MQTT integration for compatible DC devices |
| P3-08 | AI-driven OEE recommendations |
| P3-09 | Predictive maintenance (run-hour based alerts) |
| P3-10 | Roll dispatch and delivery tracking |
| P3-11 | Supplier management |
| P3-12 | Energy monitoring integration |
| P3-13 | Full responsive design for tablet use |
| P3-14 | API versioning (`/api/v1/`) |
| P3-15 | Structured logging with rotation (Winston/Pino) |

---

## FINAL VERDICT

The DHOWN MES has a solid foundation with genuinely impressive work across 9+ phases. The production engine, OEE calculation, downtime auto-detection, and TV dashboard are production-grade quality. However, the system has never had a security review — the combination of unauthenticated DC push (port 8080), no role enforcement, and a brute-forceable PIN login means **the system should not be put on a live factory network without completing all Priority 1 items.**

The textile-specific gaps (no inventory, no quality module, no orders) are not blockers for a pilot but will limit factory manager buy-in beyond the first 30 days. With 2–3 focused development sessions addressing P1 items, this system can safely go to a 10-machine supervised pilot.

---

*Report generated by Claude Code — DHOWN MES System Audit — 22 June 2026*
