const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { makeBridge, seedMappings, cleanupTempDirs, dispatch } = require('./helpers');
const { createBusyRoutes } = require('../routes');

/**
 * The HTTP surface, mounted exactly as server.js mounts it.
 *
 * verifyToken and requireRole below mirror the dashboard's own implementations
 * (same ROLE_HIERARCHY, same 401/403 shapes), so the role gating asserted here
 * is the gating that will actually apply in production. The point is to prove
 * that only SUPERVISOR and above can act on BUSY data — the brief's rule that
 * only authorised users may perform manual actions.
 */

const ROLE_HIERARCHY = { VIEWER: 1, OPERATOR: 2, SUPERVISOR: 3, ADMIN: 4, SUPER_ADMIN: 5 };

// Test doubles for the dashboard's JWT middleware: the header carries the role
// directly instead of a signed token.
function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  const [role, username] = auth.slice(7).split(':');
  if (!ROLE_HIERARCHY[role]) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = { role, username: username || role.toLowerCase() };
  next();
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if ((ROLE_HIERARCHY[req.user.role] || 0) < (ROLE_HIERARCHY[minRole] || 99)) {
      return res.status(403).json({ error: `Requires ${minRole} role or higher` });
    }
    next();
  };
}

let h;
let server;
let base;

const as = (role, username) => ({ Authorization: `Bearer ${role}${username ? `:${username}` : ''}` });
const json = (extra = {}) => ({ 'Content-Type': 'application/json', ...extra });

before(async () => {
  h = await makeBridge();
  await seedMappings(h);

  const app = express();
  app.use(express.json());
  app.use('/api/busy', createBusyRoutes(h.bridge, { verifyToken, requireRole }));

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await h.close();
  cleanupTempDirs();
});

describe('Authentication and roles', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await fetch(`${base}/api/busy/overview`);
    assert.equal(res.status, 401);
  });

  it('lets any authenticated user read', async () => {
    const res = await fetch(`${base}/api/busy/overview`, { headers: as('VIEWER') });
    assert.equal(res.status, 200);
  });

  it('does not let a VIEWER submit a dispatch to BUSY', async () => {
    const res = await fetch(`${base}/api/busy/dispatches`, {
      method: 'POST',
      headers: json(as('VIEWER')),
      body: JSON.stringify(dispatch({ dhownId: 'DSP-900', documentNumber: 'DH-DSP-00900' })),
    });
    assert.equal(res.status, 403);
  });

  it('does not let an OPERATOR force a manual action', async () => {
    // Shop-floor operators log downtime; they do not push to the accounts.
    const res = await fetch(`${base}/api/busy/reconciliation/run`, { method: 'POST', headers: as('OPERATOR') });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /Requires SUPERVISOR/);
  });

  it('lets a SUPERVISOR act', async () => {
    const res = await fetch(`${base}/api/busy/connection/test`, { method: 'POST', headers: as('SUPERVISOR') });
    assert.equal(res.status, 200);
  });

  it('requires ADMIN to clear a mapping', async () => {
    const asSupervisor = await fetch(`${base}/api/busy/mappings/ITEM/FC-00125`, {
      method: 'DELETE',
      headers: as('SUPERVISOR'),
    });
    assert.equal(asSupervisor.status, 403, 'unmapping is destructive');

    const asAdmin = await fetch(`${base}/api/busy/mappings/ITEM/NOT-A-REAL-ITEM`, {
      method: 'DELETE',
      headers: as('ADMIN'),
    });
    assert.equal(asAdmin.status, 200);
  });
});

describe('Submission', () => {
  it('accepts a dispatch and returns its idempotency key', async () => {
    const res = await fetch(`${base}/api/busy/dispatches`, {
      method: 'POST',
      headers: json(as('SUPERVISOR', 'rajesh')),
      body: JSON.stringify(dispatch({ dhownId: 'DSP-500', documentNumber: 'DH-DSP-00500' })),
    });

    assert.equal(res.status, 202, 'accepted for later delivery, not yet in BUSY');
    const body = await res.json();
    assert.equal(body.externalReference, 'DHOWN-DISPATCH-2026-000500');
    assert.equal(body.status, 'PENDING');
    assert.equal(body.busyReference, null);
  });

  it('is idempotent when the same dispatch is submitted twice', async () => {
    const payload = JSON.stringify(dispatch({ dhownId: 'DSP-501', documentNumber: 'DH-DSP-00501' }));
    const opts = { method: 'POST', headers: json(as('SUPERVISOR')), body: payload };
    const first = await fetch(`${base}/api/busy/dispatches`, opts);
    const second = await fetch(`${base}/api/busy/dispatches`, opts);

    assert.equal(first.status, 202);
    assert.equal(second.status, 200, 'a repeat is a no-op, not a new job');
    assert.equal((await first.json()).queueId, (await second.json()).queueId);
  });

  it('rejects an invalid payload with an actionable explanation', async () => {
    const res = await fetch(`${base}/api/busy/customers`, {
      method: 'POST',
      headers: json(as('SUPERVISOR')),
      body: JSON.stringify({ dhownId: 'CUST-X', name: '', gstin: 'BAD' }),
    });

    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.code, 'VALIDATION_ERROR');
    assert.equal(body.retryable, false);
    assert.ok(body.issues.length >= 2);
    assert.ok(body.action, 'the supervisor must be told what to do');
  });

  it('reports the BUSY reference back once the queue has run', async () => {
    const res = await fetch(`${base}/api/busy/dispatches`, {
      method: 'POST',
      headers: json(as('SUPERVISOR')),
      body: JSON.stringify(dispatch({ dhownId: 'DSP-502', documentNumber: 'DH-DSP-00502' })),
    });
    const { externalReference } = await res.json();

    await h.bridge.drain();

    const status = await fetch(`${base}/api/busy/status/${encodeURIComponent(externalReference)}`, {
      headers: as('VIEWER'),
    });
    const body = await status.json();
    assert.equal(body.status, 'SUCCESS');
    assert.ok(body.busyReference, 'the BUSY reference must flow back to the dashboard');
  });

  it('404s on an unknown external reference rather than inventing one', async () => {
    const res = await fetch(`${base}/api/busy/status/DHOWN-DISPATCH-2026-999999`, { headers: as('VIEWER') });
    assert.equal(res.status, 404);
  });
});

describe('Dashboard data', () => {
  it('summarises everything the BUSY Bridge page needs', async () => {
    const body = await (await fetch(`${base}/api/busy/overview`, { headers: as('ADMIN') })).json();
    for (const field of ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'MANUAL_REVIEW', 'RETRY', 'AWAITING_BUSY']) {
      assert.ok(field in body.queue, `queue counts must include ${field}`);
    }
    assert.ok('online' in body.connection);
    assert.ok('capabilities' in body.connection);
    assert.ok('todaysTransactions' in body);
    assert.ok('lastSuccessfulSync' in body);
  });

  it('never leaks a BUSY credential in any response', async () => {
    const text = await (await fetch(`${base}/api/busy/overview`, { headers: as('ADMIN') })).text();
    assert.ok(!/apiKey"\s*:\s*"[^"]+"/.test(text), 'no raw key may appear');
    assert.match(text, /apiKeyConfigured/);
  });

  it('serves the payload and audit trail for one transaction', async () => {
    const list = await (await fetch(`${base}/api/busy/queue?status=SUCCESS`, { headers: as('ADMIN') })).json();
    assert.ok(list.items.length > 0);
    assert.ok(!('payload' in list.items[0]), 'the list view omits payloads');

    const body = await (await fetch(`${base}/api/busy/queue/${list.items[0].id}`, { headers: as('ADMIN') })).json();
    assert.equal(typeof body.item.payload, 'object', 'the payload must be viewable');
    assert.ok(Array.isArray(body.audit));
  });

  it('refuses to resend a transaction BUSY already booked', async () => {
    const list = await (await fetch(`${base}/api/busy/queue?status=SUCCESS`, { headers: as('ADMIN') })).json();
    const res = await fetch(`${base}/api/busy/queue/${list.items[0].id}/retry`, {
      method: 'POST',
      headers: as('SUPERVISOR'),
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'DUPLICATE_ERROR');
  });

  it('lets a supervisor set a mapping and records who did it', async () => {
    const res = await fetch(`${base}/api/busy/mappings`, {
      method: 'POST',
      headers: json(as('SUPERVISOR', 'rajesh')),
      body: JSON.stringify({ entityType: 'ITEM', dhownId: 'FC-00999', busyId: 'BUSY-ITEM-9999', busyCode: 'B-9999' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).mapping.syncStatus, 'SYNCED');

    const audit = await (await fetch(`${base}/api/busy/audit?limit=50`, { headers: as('ADMIN') })).json();
    assert.ok(audit.entries.some((e) => e.operation === 'FIX_MAPPING' && e.actor === 'rajesh'));
  });

  it('rejects a mapping that would merge two DHOWN records onto one BUSY record', async () => {
    const res = await fetch(`${base}/api/busy/mappings`, {
      method: 'POST',
      headers: json(as('SUPERVISOR')),
      body: JSON.stringify({ entityType: 'ITEM', dhownId: 'FC-01000', busyId: 'BUSY-ITEM-9999' }),
    });
    assert.equal(res.status, 409);
  });

  it('reports which transaction types are enabled', async () => {
    const body = await (await fetch(`${base}/api/busy/entity-types`, { headers: as('VIEWER') })).json();
    assert.ok(body.all.includes('DISPATCH'));
    assert.ok(body.enabled.includes('DISPATCH'));
  });
});
