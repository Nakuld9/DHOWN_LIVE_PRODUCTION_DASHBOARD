# DHOWN MES — HANDOFF
*Last updated: 2026-06-22 (evening)*

---

## Current Milestone

**DC Integration — getting SJ03 live data into MES dashboard**

---

## Current Blocker

Waiting for factory visit tomorrow (2026-06-23). SJ03 must be running before 485ToJsonWrite can be linked and vendor DB created.

Also: postgres password that works for psql is unknown — the .env has `dhown123` but it fails via psql. Need to confirm correct password to run migration_phase10_security.sql.

---

## Completed This Session (2026-06-22)

### Backend (server.js)
- P1-01 ✅ PIN rate limiter — 5 attempts / 5 min per IP
- P1-03 ✅ verifyToken added to all unprotected write endpoints (11 endpoints)
- P1-04 ✅ RBAC requireRole middleware — VIEWER/OPERATOR/SUPERVISOR/ADMIN/SUPER_ADMIN
- P1-05 ✅ Audit logs now record real username from JWT (not hardcoded 'system')
- P1-07 ✅ POST /api/auth/logout endpoint added
- P1-08 ✅ POST /api/rfid-scan endpoint implemented
- P1-09 ✅ Duplicate GET /api/rolls at line 339 removed
- P1-13 ✅ Audit logging added for downtime open/close, roll approve

### Frontend
- P1-10 ✅ Production.jsx — uses today_production_kg from machines API (not rolls.actual_weight_kg)
- P1-12 ✅ Rolls.jsx — shift detection reads from app_settings (not hardcoded hour >= 8)
- P1-18 ✅ Sidebar — active-state highlighting + logout button
- P1-19 ✅ Sidebar — RFID Scan link added
- P1-20 ✅ Dashboard.jsx — error banner when API fails

### Database migration created (NOT YET RUN)
- migration_phase10_security.sql — indexes, UNIQUE constraint, FK constraints, drop supervisors table
- **Run this first thing tomorrow before opening the app**

---

## Next Task (do in order tomorrow)

1. **Set PostgreSQL 18 to auto-start** — services.msc → postgresql-x64-18 → Startup Type = Automatic
2. **Find working postgres password** — try logging into pgAdmin; note the password
3. **Run migration** — `cd backend && node -e "require('dotenv').config(); ..."`  (see migration_phase10_security.sql)
4. **Restart backend** — `node server.js` to pick up all security changes
5. **Go to factory** — Open 485ToJsonWrite → COM3 → Link (SJ03 must be running)
6. **Confirm vendor DB created** — psql `\l` — look for new DB name
7. **Run schema_discovery.sql** against vendor DB — find table name + columns
8. **Update mes-bridge .env** — VENDOR_DB_NAME, VENDOR_TABLE_NAME, VENDOR_DB_HOST=127.0.0.1
9. **Map vendor columns** → MES live-data fields in poller.py
10. **Set MES_WEBHOOK_URL=http://127.0.0.1:4000/api/live-data** in mes-bridge .env
11. **Start mes-bridge** — verify SJ03 data appears in MES dashboard

---

## Remaining Phase 1 Tasks (pending)

| ID | Task | Hours | Notes |
|---|---|---|---|
| DB | Run migration_phase10_security.sql | ✅ DONE | Run 2026-06-24 via Node |
| P1-02 | API key auth on port 8090 DC endpoint | 3h | Do after DC connected |
| P1-06 | Replace JWT secret with 256-bit random value | ✅ DONE | New 256-bit secret in .env |
| P1-11 | Counter-reset protection in POST /api/live-data | 3h | Do after DC connected |
| P1-21 | Loading + empty states on all data pages | ✅ DONE | Assignments, RFIDEvents, Maintainence |
| P1-22 | Fix TV Dashboard viewport sizing | ✅ DONE | 100vw/100vh + vw font units |

## Phase 2 — Completed / In Progress

| ID | Task | Status |
|---|---|---|
| P2-18 | WhatsApp alert via wa.me link | ✅ DONE — 📲 button on MachineCard + Machines page; fetches supervisor mobile from /api/users |
| P2-13 | Machine details extended fields | ✅ DONE |
| P2-11 | PM Schedule page | ✅ DONE |
| P2-12 | Shift Handover page | ✅ DONE |
| P2-05 | Responsive UI (mobile vs desktop) | ✅ DONE |
| P2-06 | Mobile hamburger sidebar | ✅ DONE |
| P2-09 | Pagination on list endpoints | Pending |
| P2-10 | Daily auto-backup 7-day retention | Pending |
| P2-03 | Operator attendance from RFID events | Pending |
| P2-14 | Daily production summary report | Pending |
| P2-07 | Yarn inventory | SKIP (scale later) |
| P2-08 | Spare parts | SKIP (scale later) |
| P2-01/P2-15 | Roll quality | SKIP (scale later) |

## Phase 2 — Remaining (~115h)
## Phase 3 — All 13 tasks pending (~74h)
## DC Integration — DC-01 to DC-16 pending (tomorrow)

---

## Known Bugs (critical — still open)

| Bug | File | Status |
|---|---|---|
| Port 8080 DC endpoint has zero auth | server.js:3459 | Pending P1-02 |
| No RBAC on /api/live-data (port 8080) | server.js | Pending P1-02 |
| Counter reset inflates production | server.js:~1582 | Pending P1-11 |
| OEE quality always 100% | server.js | Pending P2-02 |

---

## Key File Locations

| File | Purpose |
|---|---|
| `AUDIT_REPORT.md` | Full system audit — source of truth |
| `PROJECT_STATE.md` | Current state snapshot |
| `HANDOFF.md` | This file |
| `WORKLIST.md` | Full 69-task ordered worklist |
| `migration_phase10_security.sql` | DB migration — indexes, constraints, drop supervisors |
| `backend/server.js` | All API endpoints |
| `frontend/src/components/Sidebar.jsx` | Sidebar with active state + logout |
| `frontend/src/pages/Production.jsx` | Fixed today's production metric |
| `frontend/src/pages/Rolls.jsx` | Fixed shift detection |
| `frontend/src/pages/Dashboard.jsx` | Fixed error state |
| `C:\Users\nakul\Desktop\New folder\mes-bridge\` | DC integration bridge |
| `C:\Users\nakul\Desktop\New folder\485ToJsonWrite\` | Vendor RS-485 software |

---

## Hard Rules

- Never give mes-bridge write access to vendor DB — read-only user only
- Never expose PostgreSQL port 5432 outside 127.0.0.1
- Test on SJ03 pilot before connecting all 18 machines
- Do not skip remaining P1 security fixes before factory pilot
- Restart backend after any server.js change
