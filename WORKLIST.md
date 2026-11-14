# DHOWN MES — MASTER REMAINING WORKLIST
*Generated: 2026-06-22 | Source: AUDIT_REPORT.md + DC Integration session*
*Total: 67 tasks | ~301 hours | ~38 dev-days at 8h/day*

---

## DC Integration (14 tasks — do first, blocks live data)

| ID | Task | When | Hours | Depends on |
|---|---|---|---|---|
| DC-01 | Set PostgreSQL 18 to auto-start (services.msc) | Tonight | 0.1h | — |
| DC-02 | Fix VENDOR_DB_HOST in mes-bridge .env → 127.0.0.1 | Tonight | 0.1h | — |
| DC-03 | Fill postgres password in mes-bridge .env | Tonight | 0.1h | — |
| DC-04 | Confirm MES dashboard is running and accessible | Tonight | 0.1h | — |
| DC-05 | Open 485ToJsonWrite → COM3 → Link (SJ03 must be ON) | Tomorrow | 0.1h | — |
| DC-06 | Confirm vendor DB created — psql \l | Tomorrow | 0.1h | DC-05 |
| DC-07 | Run schema_discovery.sql — find table + columns | Tomorrow | 0.5h | DC-06 |
| DC-08 | Update VENDOR_DB_NAME + VENDOR_TABLE_NAME in .env | Tomorrow | 0.1h | DC-07 |
| DC-09 | Create read-only postgres user (setup_readonly_user.sql) | Tomorrow | 0.5h | DC-06 |
| DC-10 | Map vendor columns → MES live-data fields in poller.py | Tomorrow | 2h | DC-07 |
| DC-11 | Set MES_WEBHOOK_URL=http://127.0.0.1:4000/api/live-data | Tomorrow | 0.1h | — |
| DC-12 | Start mes-bridge — verify SJ03 data in MES dashboard | Tomorrow | 1h | DC-08, DC-10, DC-11 |
| DC-13 | Add API key auth to MES /api/live-data endpoint | After pilot | 3h | DC-12 |
| DC-14 | Install mes-bridge as Windows service (install_service.bat) | After pilot | 0.5h | DC-12 |
| DC-15 | Connect remaining machines via RS-485 daisy chain | After pilot | 2h | DC-14 |
| DC-16 | Map all 18 machine device IDs to MES machine names (SJ, RB, IL, TV) | After pilot | 1h | DC-15 |

---

## Phase 1 — Factory Go-Live (22 tasks, ~98 hours)

### Security & Auth

| ID | Task | Priority | Hours | Depends on |
|---|---|---|---|---|
| P1-01 | Rate-limit supervisor PIN endpoint — max 5 attempts/5 min per IP (server.js:3142) | CRITICAL | 1h | — |
| P1-02 | Add API key auth to port 8080 DC endpoint — X-DC-Key header validation | CRITICAL | 3h | — |
| P1-03 | Add verifyToken to all unprotected POST/PUT/DELETE endpoints | CRITICAL | 4h | — |
| P1-04 | Implement RBAC middleware — requireRole('ADMIN'), requireRole('SUPERVISOR') etc. | CRITICAL | 6h | P1-03 |
| P1-05 | Fix audit logs — extract req.user.username from JWT instead of hardcoded 'system' | CRITICAL | 1h | P1-03 |
| P1-06 | Replace JWT secret with cryptographically random 256-bit value (openssl rand -hex 32) | HIGH | 0.5h | — |
| P1-07 | Add POST /api/auth/logout + server-side token invalidation | HIGH | 4h | — |

### Critical Bug Fixes

| ID | Task | Priority | Hours | Depends on |
|---|---|---|---|---|
| P1-08 | Add POST /api/rfid-scan endpoint — record machine_id on scan | CRITICAL | 3h | — |
| P1-09 | Remove duplicate GET /api/rolls registration (server.js:339 is dead code) | HIGH | 0.5h | — |
| P1-10 | Fix Production.jsx — use today_production_kg from /api/machines not rolls.actual_weight_kg | CRITICAL | 2h | — |
| P1-11 | Add counter-reset protection in POST /api/live-data — detect count < prev_count; max delta 10 KG | CRITICAL | 3h | — |
| P1-12 | Fix Rolls.jsx shift detection — read from app_settings not hardcoded hour >= 8 | HIGH | 2h | — |
| P1-13 | Add audit logging for: downtime create/close, roll approve, machine settings, maintenance | HIGH | 3h | P1-05 |

### Database — Indexes & Constraints

| ID | Task | Priority | Hours | Depends on |
|---|---|---|---|---|
| P1-14 | Add indexes: machine_status_log(machine_id, DATE, shift), machine_downtime(machine_id, status), rfid_events(event_time DESC) | HIGH | 1h | — |
| P1-15 | Add UNIQUE constraint on operators.operator_code | HIGH | 1h | — |
| P1-16 | Add FK constraints: rfid_events→machines, rolls→operators | MEDIUM | 1h | — |
| P1-17 | Drop orphaned supervisors table (write migration) | MEDIUM | 0.5h | — |

### UI — Minimum Viable

| ID | Task | Priority | Hours | Depends on |
|---|---|---|---|---|
| P1-18 | Add sidebar active-state highlighting + logout button | HIGH | 3h | P1-07 |
| P1-19 | Add RFID Scan to sidebar navigation | HIGH | 0.5h | P1-08 |
| P1-20 | Fix Dashboard.jsx — show error state when /api/machines fails | HIGH | 2h | — |
| P1-21 | Add loading spinners + empty-state messages on all data pages | MEDIUM | 4h | — |
| P1-22 | Fix TV Dashboard — replace hardcoded 1920px with vw/vh units | MEDIUM | 3h | — |

---

## Phase 2 — Advanced MES (18 tasks, ~115 hours)

### Core MES Features

| ID | Task | Priority | Hours | Depends on |
|---|---|---|---|---|
| P2-01 | Quality inspection module — quality_inspections table, roll grading A/B/C/Reject, defect type, QC form | HIGH | 12h | P1-04 |
| P2-02 | Fix OEE quality dimension — derive from actual defect data, remove hardcoded 100% | HIGH | 4h | P2-01 |
| P2-03 | Operator attendance module — process rfid_events into attendance register, daily report | HIGH | 10h | P1-08 |
| P2-04 | Production order / lot number management — production_orders table, link rolls to orders | HIGH | 14h | P1-04 |
| P2-05 | Preventive maintenance scheduler — maintenance_schedule table, due-date alerts by hours or date | HIGH | 10h | P1-04 |
| P2-06 | Shift handover notes module — shift_handovers table, form for supervisor, view previous notes | MEDIUM | 8h | P1-04 |
| P2-07 | Yarn / cone inventory management — yarn_inventory table, denier/type/color/lot, consumption tracking | HIGH | 16h | P1-04 |
| P2-08 | Spare parts inventory — needles, sinkers, oil; consumption on maintenance; low-stock alerts | MEDIUM | 8h | P2-05 |

### API & Database

| ID | Task | Priority | Hours | Depends on |
|---|---|---|---|---|
| P2-09 | Add pagination to all list endpoints — ?page=&limit= on rolls, rfid-events, audit-logs etc. | HIGH | 5h | — |
| P2-10 | POST /api/restore endpoint + scheduled daily auto-backup with 7-day retention | MEDIUM | 5h | — |
| P2-11 | Add machine columns — manufacturer, model, serial, needles_count, cylinder_diameter | MEDIUM | 3h | — |
| P2-12 | Add operator columns — employee_id, join_date, skill_level | MEDIUM | 2h | — |
| P2-13 | Rename /maintainence route to /maintenance (typo fix + redirect) | LOW | 0.5h | — |

### Missing Reports

| ID | Task | Priority | Hours | Depends on |
|---|---|---|---|---|
| P2-14 | Daily production summary report — per machine, per shift, KG vs target, auto-email at shift end | HIGH | 6h | — |
| P2-15 | Roll quality register report — grade, weight, defects, inspector; PDF export | HIGH | 5h | P2-01 |
| P2-16 | Operator attendance & performance report — present/absent, machines worked, KG produced | HIGH | 4h | P2-03 |
| P2-17 | Preventive maintenance due report — machines due in 7/15/30 days | MEDIUM | 3h | P2-05 |
| P2-18 | Alert notification delivery — email/WhatsApp webhook; alerts for machine stop, OEE < threshold | HIGH | 8h | P1-04 |

---

## Phase 3 — Industry 4.0 (13 tasks, ~74 hours)

| ID | Task | Priority | Hours | Depends on |
|---|---|---|---|---|
| P3-01 | QR code label printing for rolls — generate on roll creation, print via PDF | MEDIUM | 6h | P2-04 |
| P3-02 | Roll dispatch & delivery tracking — scan QR → mark dispatched, customer acknowledgement | MEDIUM | 10h | P3-01, P2-04 |
| P3-03 | Wastage tracking per machine per roll — yarn waste + fabric trimmings, yield % | MEDIUM | 6h | P2-07 |
| P3-04 | Stitch program management — machine_parameters table, loop length/tension/speed per fabric type | MEDIUM | 8h | — |
| P3-05 | MQTT integration — import mqtt.js (already exists, never imported); subscribe to machine topics | MEDIUM | 8h | P1-02 |
| P3-06 | Structured logging — replace console.error with Winston; request log; daily rotation | MEDIUM | 4h | — |
| P3-07 | Supervisor mobile app — 4 additional screens: roll start/close, downtime tap, push notifications, shift dashboard | MEDIUM | 16h | P2-06, P2-18 |
| P3-08 | Supplier management — suppliers table, yarn delivery dates, incoming lot quality | LOW | 8h | P2-07 |
| P3-09 | Predictive maintenance — track run hours from live_data; alert near service interval | LOW | 10h | P2-05, P3-06 |
| P3-10 | Energy / power monitoring DB structure — energy_readings table placeholder for future hardware | LOW | 2h | — |
| P3-11 | OEE trend report — 7/30 day Availability × Performance × Quality; machine ranking by OEE | MEDIUM | 4h | P2-02 |
| P3-12 | Yarn consumption report — KG yarn consumed vs KG fabric produced (yield %) per machine per week | LOW | 4h | P2-07, P3-03 |
| P3-13 | API versioning + documentation — /api/v1/ prefix; OpenAPI spec; Swagger UI at /api/docs | LOW | 6h | All P1+P2 API tasks |

---

## Summary

| Phase | Tasks | Hours | Status |
|---|---|---|---|
| DC Integration | 16 | ~11h | 🔴 In progress — blocked until tomorrow |
| Phase 1 — Go-Live | 22 | ~98h | 🔴 Not started |
| Phase 2 — Advanced MES | 18 | ~115h | 🔴 Not started |
| Phase 3 — Industry 4.0 | 13 | ~74h | 🔴 Not started |
| **Total** | **69** | **~298h** | **56% complete** |

---

*Update this file after completing each task. Update PROJECT_STATE.md after each major milestone.*
