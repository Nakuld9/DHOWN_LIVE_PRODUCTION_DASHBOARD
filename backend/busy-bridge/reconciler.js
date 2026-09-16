const { randomUUID } = require('crypto');
const { classifyError } = require('./errors');

/**
 * Reconciliation.
 *
 * "It said SUCCESS" is not the same as "the two systems agree". This compares
 * what the dashboard sent with what BUSY actually holds, field by field, and
 * classifies every transaction so divergence is visible instead of discovered
 * at audit time.
 */

/** Quantities and money are floats; compare with a tolerance, not equality. */
const QUANTITY_TOLERANCE = 0.001;
const AMOUNT_TOLERANCE = 1; // rupee rounding differs between the two systems

function closeEnough(a, b, tolerance) {
  return Math.abs(a - b) <= tolerance;
}

class Reconciler {
  constructor(pool, adapter, queue, mappings, logger = console) {
    this.pool = pool;
    this.adapter = adapter;
    this.queue = queue;
    this.mappings = mappings;
    this.logger = logger;
  }

  /**
   * Reconcile everything synced in the lookback window.
   *
   * Only SUCCESS/AWAITING_BUSY items are candidates — a failed item is already
   * visible on the dashboard and does not need a second alarm.
   */
  async run(lookbackDays, limit = 500) {
    const runId = randomUUID();
    const summary = { runId, checked: 0, MATCH: 0, MISMATCH: 0, MISSING_IN_BUSY: 0, MISSING_IN_MES: 0, DUPLICATE: 0 };

    if (!this.adapter.capabilities().reconcileTransaction) {
      this.logger.warn(`[BUSY] adapter "${this.adapter.name}" cannot reconcile; skipping run`);
      return summary;
    }

    const items = await this.queue.recentCompleted(lookbackDays, limit);
    const seenBusyReferences = new Map();

    for (const item of items) {
      try {
        const row = await this.reconcileItem(runId, item, seenBusyReferences);
        summary.checked += 1;
        summary[row.result] += 1;
      } catch (err) {
        const be = classifyError(err);
        this.logger.warn(`[BUSY] reconciliation of ${item.externalReference} failed: ${be.code} ${be.message}`);
      }
    }

    return summary;
  }

  /** Reconcile one queue item against BUSY. */
  async reconcileItem(runId, item, seenBusyReferences = new Map()) {
    const snapshot = await this.adapter.reconcileTransaction(item.externalReference);

    if (!snapshot) {
      // The dashboard believes it synced; BUSY has no such transaction. This
      // is the dangerous case — a dispatch that left the factory with no
      // accounting entry behind it.
      return this.persist(runId, item, null, 'MISSING_IN_BUSY', [
        { field: 'transaction', mes: item.externalReference, busy: null },
      ]);
    }

    // Duplicate detection: one BUSY reference claimed by two DHOWN records
    // means the same voucher was posted twice.
    if (snapshot.busyReference) {
      const previous = seenBusyReferences.get(snapshot.busyReference);
      if (previous && previous !== item.externalReference) {
        return this.persist(runId, item, snapshot.busyReference, 'DUPLICATE', [
          { field: 'busyReference', mes: item.externalReference, busy: previous },
        ]);
      }
      seenBusyReferences.set(snapshot.busyReference, item.externalReference);
    }

    const differences = await this.compare(item, snapshot);
    return this.persist(
      runId,
      item,
      snapshot.busyReference || null,
      differences.length === 0 ? 'MATCH' : 'MISMATCH',
      differences,
    );
  }

  /** Field-by-field comparison: reference, party, item, quantity, amount. */
  async compare(item, snapshot) {
    const differences = [];
    const payload = item.payload || {};

    // ── transaction reference ──
    if (item.busyReference && snapshot.busyReference && item.busyReference !== snapshot.busyReference) {
      differences.push({ field: 'busyReference', mes: item.busyReference, busy: snapshot.busyReference });
    }
    if (payload.documentNumber && snapshot.documentNumber && payload.documentNumber !== snapshot.documentNumber) {
      differences.push({ field: 'documentNumber', mes: payload.documentNumber, busy: snapshot.documentNumber });
    }

    // ── customer / vendor ──
    const partyDhownId = payload.customerDhownId || payload.vendorDhownId;
    if (partyDhownId && snapshot.partyBusyId) {
      const entityType = payload.customerDhownId ? 'CUSTOMER' : 'VENDOR';
      const mapping = await this.mappings.find(entityType, partyDhownId);
      if (!mapping || !mapping.busyId) {
        differences.push({ field: 'party', mes: partyDhownId, busy: snapshot.partyBusyId });
      } else if (mapping.busyId !== snapshot.partyBusyId) {
        // The voucher is booked against a different ledger than intended.
        differences.push({ field: 'party', mes: mapping.busyId, busy: snapshot.partyBusyId });
      }
    }

    // ── quantities, per item and in total ──
    const mesLines = Array.isArray(payload.lines) ? payload.lines : [];
    if (mesLines.length > 0) {
      const mesTotal = mesLines.reduce((s, l) => s + (l.quantity || 0), 0);
      if (typeof snapshot.totalQuantity === 'number' && !closeEnough(mesTotal, snapshot.totalQuantity, QUANTITY_TOLERANCE)) {
        differences.push({ field: 'totalQuantity', mes: mesTotal, busy: snapshot.totalQuantity });
      }

      if (Array.isArray(snapshot.lines)) {
        const busyByItem = new Map();
        for (const line of snapshot.lines) {
          busyByItem.set(line.busyItemId, (busyByItem.get(line.busyItemId) || 0) + line.quantity);
        }
        for (const line of mesLines) {
          const mapping = await this.mappings.find('ITEM', line.itemDhownId);
          if (!mapping || !mapping.busyId) {
            differences.push({ field: `item:${line.itemDhownId}`, mes: line.itemDhownId, busy: null });
            continue;
          }
          const busyQty = busyByItem.get(mapping.busyId);
          if (busyQty === undefined) {
            differences.push({ field: `item:${line.itemDhownId}`, mes: line.quantity, busy: null });
          } else if (!closeEnough(busyQty, line.quantity, QUANTITY_TOLERANCE)) {
            differences.push({ field: `quantity:${line.itemDhownId}`, mes: line.quantity, busy: busyQty });
          }
          busyByItem.delete(mapping.busyId);
        }
        // Anything left is in BUSY but not in the DHOWN document.
        for (const [busyItemId, quantity] of busyByItem) {
          differences.push({ field: `item:${busyItemId}`, mes: null, busy: quantity });
        }
      }
    }

    // ── amounts ──
    const mesAmount =
      payload.totalAmount !== undefined
        ? payload.totalAmount
        : mesLines.length > 0
          ? mesLines.reduce((s, l) => s + (l.amount !== undefined ? l.amount : (l.rate || 0) * (l.quantity || 0)), 0)
          : undefined;
    if (typeof mesAmount === 'number' && typeof snapshot.totalAmount === 'number' && mesAmount > 0) {
      if (!closeEnough(mesAmount, snapshot.totalAmount, AMOUNT_TOLERANCE)) {
        differences.push({ field: 'totalAmount', mes: +mesAmount.toFixed(2), busy: snapshot.totalAmount });
      }
    }

    return differences;
  }

  async persist(runId, item, busyReference, result, differences) {
    const { rows } = await this.pool.query(
      `INSERT INTO busy_reconciliation
         (run_id, entity_type, dhown_entity_id, external_reference, busy_reference, result, differences)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
      [runId, item.entityType, item.dhownEntityId, item.externalReference, busyReference, result, JSON.stringify(differences)],
    );

    if (result !== 'MATCH') {
      this.logger.warn(`[BUSY] reconciliation divergence ${item.externalReference}: ${result}`);
    }

    return {
      id: rows[0].id,
      runId,
      entityType: item.entityType,
      dhownEntityId: item.dhownEntityId,
      externalReference: item.externalReference,
      busyReference,
      result,
      differences,
      resolved: false,
      createdAt: rows[0].created_at,
    };
  }

  /**
   * BUSY-side records with no DHOWN counterpart.
   *
   * Runs the comparison in the other direction: masters BUSY knows about that
   * the bridge has never mapped.
   */
  async findMissingInMes(entityType) {
    const caps = this.adapter.capabilities();
    const capable = entityType === 'CUSTOMER' ? caps.getCustomers : entityType === 'VENDOR' ? caps.getVendors : caps.getItems;
    if (!capable) return [];

    const records =
      entityType === 'CUSTOMER'
        ? await this.adapter.getCustomers()
        : entityType === 'VENDOR'
          ? await this.adapter.getVendors()
          : await this.adapter.getItems();

    const runId = randomUUID();
    const out = [];
    for (const record of records) {
      if (await this.mappings.findByBusyId(entityType, record.busyId)) continue;
      const differences = [{ field: 'name', mes: null, busy: record.name }];
      const { rows } = await this.pool.query(
        `INSERT INTO busy_reconciliation
           (run_id, entity_type, dhown_entity_id, external_reference, busy_reference, result, differences)
         VALUES ($1,$2,NULL,NULL,$3,'MISSING_IN_MES',$4) RETURNING id, created_at`,
        [runId, entityType, record.busyId, JSON.stringify(differences)],
      );
      out.push({
        id: rows[0].id,
        runId,
        entityType,
        dhownEntityId: null,
        externalReference: null,
        busyReference: record.busyId,
        result: 'MISSING_IN_MES',
        differences,
        resolved: false,
        createdAt: rows[0].created_at,
      });
    }
    return out;
  }

  async list(filter = {}) {
    const where = [];
    const params = [];
    if (filter.result) {
      params.push(filter.result);
      where.push(`result = $${params.length}`);
    }
    if (filter.resolved !== undefined) {
      params.push(filter.resolved);
      where.push(`resolved = $${params.length}`);
    }
    if (filter.runId) {
      params.push(filter.runId);
      where.push(`run_id = $${params.length}`);
    }
    params.push(Math.min(filter.limit || 200, 500));
    const sql =
      `SELECT * FROM busy_reconciliation${where.length ? ` WHERE ${where.join(' AND ')}` : ''}` +
      ` ORDER BY id DESC LIMIT $${params.length}`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      entityType: row.entity_type,
      dhownEntityId: row.dhown_entity_id,
      externalReference: row.external_reference,
      busyReference: row.busy_reference,
      result: row.result,
      differences: row.differences || [],
      resolved: row.resolved,
      createdAt: row.created_at,
    }));
  }

  async markResolved(id) {
    await this.pool.query('UPDATE busy_reconciliation SET resolved = TRUE WHERE id = $1', [id]);
  }

  async summary() {
    const base = { MATCH: 0, MISMATCH: 0, MISSING_IN_BUSY: 0, MISSING_IN_MES: 0, DUPLICATE: 0 };
    const { rows } = await this.pool.query(
      'SELECT result, COUNT(*)::int AS n FROM busy_reconciliation WHERE resolved = FALSE GROUP BY result',
    );
    for (const r of rows) base[r.result] = r.n;
    return base;
  }
}

module.exports = { Reconciler };
