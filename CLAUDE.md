# CLAUDE.md — DHOWN MES Guidance

## What we're building

DHOWN Hosiery Mills MES — a factory Manufacturing Execution System for an 18-machine circular knitting factory. React frontend + Node/Express backend + PostgreSQL. Tracks production, downtime, rolls, OEE, operators, maintenance.

## Session startup (always do this first)

1. Read `PROJECT_STATE.md` — overall completion, hardware status, page status
2. Read `HANDOFF.md` — current blocker, next task, priority list, known bugs
3. Read `WORKLIST.md` only if asked about specific tasks
4. Continue from the next task in HANDOFF.md — do not re-audit or re-scan

## Source of truth

- `AUDIT_REPORT.md` — full system audit (2026-06-22). Do not re-audit.
- `PROJECT_STATE.md` — concise current state snapshot
- `HANDOFF.md` — next actions, blockers, known bugs, file locations
- `WORKLIST.md` — full 69-task ordered worklist with hours and dependencies

## Hard rules

- **Never re-audit the codebase.** AUDIT_REPORT.md is authoritative.
- **Never scan all files to rediscover architecture.** It is documented.
- **Read only files directly related to the current task.** Max 5 files before implementation.
- **After completing a task, update HANDOFF.md** — mark done, update next task.
- **After a major milestone, update PROJECT_STATE.md.**
- **Never give mes-bridge write access to vendor PostgreSQL DB** — read-only user only.
- **Never expose PostgreSQL port 5432 outside 127.0.0.1.**
- **Do not skip Phase 1 security fixes before factory pilot deployment.**

## Project structure

- `backend/server.js` — all API endpoints (3460 lines, single file)
- `frontend/src/pages/` — all React pages
- `frontend/src/utils/authFetch.js` — token injection on all fetch calls to port 4000
- `C:\Users\nakul\Desktop\New folder\mes-bridge\` — DC integration bridge (FastAPI)
- `C:\Users\nakul\Desktop\New folder\485ToJsonWrite\` — vendor RS-485 software

## Hardware setup

- Factory PC IP: 192.168.1.18 (same machine as MES server — everything on one PC)
- RS-485 adapter: COM3
- Pilot machine: SJ03
- PostgreSQL 18 installed at 192.168.1.18:5432
- 485ToJsonWrite writes to a local PostgreSQL DB (vendor DB name TBD — discover tomorrow)
- mes-bridge (FastAPI) polls vendor DB and pushes to MES /api/live-data every 10s

## Conventions

- Backend: Node.js / Express, single server.js file
- Frontend: React (no framework router — plain React Router)
- Database: PostgreSQL 18, parameterized queries throughout (no SQL injection risk)
- Auth: JWT HS256, 8-hour expiry, stored in localStorage
- No ORM — raw pg queries with $1/$2 parameters
- Machine sort order: SJ → RB → IL → TV (apply consistently across all reports)

## Deployment

- All services run directly on Windows (not Docker) on 192.168.1.18
- PostgreSQL 18 must be set to auto-start in Windows services
- mes-bridge runs as a Windows service via install_service.bat (after pilot)

## What NOT to do

- Do not re-read all pages to confirm they are implemented — the audit says which ones work
- Do not re-check DB schema — it is documented in AUDIT_REPORT.md
- Do not re-audit security — findings are in AUDIT_REPORT.md Section 7
- Do not invent new tasks — use WORKLIST.md
