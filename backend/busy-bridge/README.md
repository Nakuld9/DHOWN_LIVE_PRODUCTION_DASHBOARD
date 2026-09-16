# BUSY Bridge

Integration middleware between the **DHOWN Live Production Dashboard** and **BUSY**
accounting, which runs on a separate PC on the factory LAN.

The dashboard is the source of truth for production. BUSY is the source of truth for
accounting, commercial and statutory data. This bridge is the only thing that talks to
both.

```
DHOWN Live Production Dashboard (factory PC 192.168.1.18)
   │  POST /api/busy/dispatches
   ▼
BUSY BRIDGE  ── mapping → validation → transform → queue
             ── retry → idempotency → reconciliation → audit
   │  \\BUSY-PC\BusyExchange\
   ▼
BUSY (separate PC)
```

## What it does, and what it must never do

The bridge **translates, validates, queues, synchronises and reconciles commercial
data**. That is the whole job.

It contains no production planning, machine scheduling, OEE calculation, machine
monitoring, roll tracking or shift logic, and no accounting logic is reimplemented on the
dashboard side. Roll numbers may ride along as free text on a document remark so they
print on the challan, but the bridge attaches no meaning to them — and a test asserts no
machine/shift/operator/OEE/downtime/WIP element ever reaches BUSY.

## Before you configure anything

Read [`../../docs/BUSY_INTEGRATION.md`](../../docs/BUSY_INTEGRATION.md). It records the
connectivity audit and the **site verification checklist** that must be completed against
the factory's actual BUSY installation.

The short version: **BUSY has no native public REST API.** The default transport is
BUSY's own XML Data Export/Import over a shared folder on the BUSY PC. A REST gateway
adapter exists for sites that license one. Direct writes to BUSY's SQL database are
deliberately not implemented.

## Setup

1. Run the migration against `dhown_mes`:

   ```
   psql -U postgres -d dhown_mes -f migration_phase11_busy_bridge.sql
   ```

2. Copy the settings from `busy-bridge/.env.example` into `backend/.env` and fill in the
   share paths from checklist section 6.3, e.g.

   ```
   BUSY_XML_OUTBOX=\\BUSY-PC\BusyExchange\Outbox
   BUSY_XML_ACK=\\BUSY-PC\BusyExchange\Ack
   ```

3. Restart the backend. It mounts itself at `/api/busy` and logs the adapter and outbox
   on startup. A BUSY misconfiguration never stops the dashboard from starting —
   machine monitoring matters more than accounting sync.

4. Open **BUSY Bridge** in the sidebar.

## Tests

```
cd backend
npm run test:busy
```

85 tests: the 15 scenarios from the brief, plus the adapter contract, idempotency keys,
the separate-machine/UNC/SMB behaviour, security boundaries and the HTTP routes.

They run against a **real PostgreSQL database**, because the properties that matter live
there — the UNIQUE index that enforces idempotency and `FOR UPDATE SKIP LOCKED` that stops
two workers claiming the same job. Point `BUSY_TEST_DATABASE_URL` at a scratch database
(default `postgres://postgres@127.0.0.1:55432/busy_bridge_test`); each test gets its own
schema and drops it afterwards.

## API

All routes are under `/api/busy` and use the dashboard's own JWT. Reads need any logged-in
user; every state-changing action needs **SUPERVISOR** or above; clearing a mapping needs
**ADMIN**.

| Method | Route | Role | Purpose |
|---|---|---|---|
| POST | `/api/busy/customers` · `/vendors` · `/items` · `/warehouses` | SUPERVISOR | Master sync |
| POST | `/api/busy/sales-references` · `/purchase-references` | SUPERVISOR | Order references |
| POST | `/api/busy/dispatches` · `/invoices` | SUPERVISOR | Dispatch / invoice |
| GET | `/api/busy/status/:externalReference` | any | Status and BUSY reference |
| GET | `/api/busy/overview` | any | Dashboard tiles |
| GET | `/api/busy/queue` · `/queue/:id` | any | Queue and payload |
| POST | `/api/busy/queue/:id/retry` · `/reconcile` | SUPERVISOR | Manual actions |
| GET/POST | `/api/busy/mappings` | any / SUPERVISOR | View / fix mapping |
| DELETE | `/api/busy/mappings/:type/:dhownId` | ADMIN | Unmap |
| GET/POST | `/api/busy/reconciliation` · `/run` | any / SUPERVISOR | Reconciliation |
| GET | `/api/busy/audit` | any | Audit trail |
| GET | `/api/busy/masters/:kind` | any | BUSY → dashboard master sync |
| POST | `/api/busy/worker/tick` | SUPERVISOR | Process queue now |

`202` on submission means the bridge has taken responsibility for the record. It does
**not** mean BUSY has booked it.

## Idempotency

Every transaction carries a deterministic external reference:

```
DHOWN-DISPATCH-2026-000091
```

Derived from the document number, so a resend — a retry, a double click, a replayed
request — produces the same key. A `UNIQUE` index enforces it in PostgreSQL, so two
concurrent submissions cannot both win.

Before creating anything in BUSY the bridge asks BUSY whether that reference already
exists. If it does, the existing BUSY reference is recovered and reconciled; nothing is
posted twice. This is what makes a crash between "sent" and "recorded" safe.

## Offline mode

If the BUSY PC is unreachable, **the dashboard keeps running**. The worker detects the
outage, holds the queue *without burning retry attempts*, and drains it in order when BUSY
returns. A BUSY outage never stops factory production.

## Retry

Exponential backoff with jitter, and a finite budget:

```
Attempt 1 → Attempt 2 → Attempt 3 → Attempt 4 → MANUAL_REVIEW
```

Only transport-class failures retry. Bad data, missing mappings and BUSY business
rejections go straight to `MANUAL_REVIEW`, because retrying them cannot help.

## Queue states

`PENDING` · `PROCESSING` · `AWAITING_BUSY` · `SUCCESS` · `FAILED` · `RETRY` ·
`MANUAL_REVIEW`

`AWAITING_BUSY` exists because the XML transport is asynchronous: the file is on the BUSY
PC's share but BUSY has not acknowledged it. Collapsing that into `SUCCESS` would show a
reference the dashboard never received.

## Errors

Written for the supervisor who has to fix them:

```
FAILED   Dispatch DH-DSP-00091
Reason:  DHOWN item "FC-00125" is not mapped to a BUSY item.
Action:  Map DHOWN item "FC-00125" to the matching BUSY item, then retry.
         [FIX MAPPING] [RETRY]
```

Classes: `CONNECTION_ERROR`, `AUTHENTICATION_ERROR`, `VALIDATION_ERROR`,
`MASTER_MAPPING_ERROR`, `DUPLICATE_ERROR`, `BUSY_TRANSACTION_ERROR`, `TIMEOUT`,
`UNSUPPORTED_OPERATION`, `UNKNOWN_ERROR`.

## Security

- BUSY credentials come from `backend/.env`, never from frontend code.
- No API response can carry a credential; `redactedConfig()` is the only config shape
  allowed out.
- Authentication and roles are the dashboard's own — one login, one role hierarchy.
- The bridge holds no customer-facing surface. Nothing outside the dashboard talks to it.

## Replacing the BUSY adapter

Everything BUSY-specific is behind the contract in `adapters/busyAdapter.js`.

1. Implement it.
2. Declare truthful `capabilities()` — operations the installation cannot perform must
   throw `UnsupportedOperationError`, never be faked.
3. Register it in `adapters/index.js`.
4. Set `BUSY_ADAPTER=<name>`.

Shipped adapters: `xml` (default), `rest` (gateway, opt-in), `memory` (test double;
refused when `NODE_ENV=production`).

## Layout

```
busy-bridge/
  adapters/      contract + xml (file share), rest (gateway), memory (test double)
  store/         mappingStore, queueStore, auditLog   (PostgreSQL)
  transform/     DHOWN -> BUSY XML
  test/          85 tests against a real PostgreSQL
  bridge.js      composition root; submit(), drain(), start()
  routes.js      Express router mounted at /api/busy
  syncService.js one transaction: map, guard idempotency, send, classify, audit
  worker.js      poll loop; holds the queue while BUSY is offline
  reconciler.js  field-by-field comparison
  errors.js      classification + operator-facing explanations
  index.js       mountBusyBridge(app, pool, { verifyToken, requireRole })
```

## Known open item

The BUSY XML element names in `transform/busyXml.js` follow the structure described in
the audit but have **not** been validated against a sample export from the factory's own
BUSY installation — checklist section 6.3 is still open. That file is the only place that
needs to change when real samples arrive.
