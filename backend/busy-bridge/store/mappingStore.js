const { MappingError } = require('../errors');

/**
 * Master mapping: DHOWN id <-> BUSY id.
 *
 * The rule "never assume IDs are identical" is enforced structurally — there
 * is no code path that sends a DHOWN id to BUSY as if it were a BUSY id.
 * Resolution always goes through this table and fails loudly when a mapping is
 * missing, because guessing would post a voucher against the wrong ledger.
 */

function toMapping(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    dhownId: row.dhown_id,
    busyId: row.busy_id,
    busyCode: row.busy_code,
    syncStatus: row.sync_status,
    lastSyncedAt: row.last_synced_at,
    error: row.error,
    dhownName: row.dhown_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class MappingStore {
  constructor(pool) {
    this.pool = pool;
  }

  async find(entityType, dhownId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM busy_master_mapping WHERE entity_type = $1 AND dhown_id = $2',
      [entityType, dhownId],
    );
    return rows[0] ? toMapping(rows[0]) : null;
  }

  async findByBusyId(entityType, busyId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM busy_master_mapping WHERE entity_type = $1 AND busy_id = $2',
      [entityType, busyId],
    );
    return rows[0] ? toMapping(rows[0]) : null;
  }

  /**
   * Resolve a DHOWN id to a BUSY id, or fail with a MASTER_MAPPING_ERROR that
   * tells the supervisor exactly which record to map.
   */
  async resolve(entityType, dhownId) {
    const mapping = await this.find(entityType, dhownId);
    if (!mapping || !mapping.busyId) throw new MappingError(entityType, dhownId);
    const out = { busyId: mapping.busyId };
    if (mapping.busyCode) out.busyCode = mapping.busyCode;
    return out;
  }

  /** Register a DHOWN record as awaiting a BUSY counterpart. */
  async upsertPending(entityType, dhownId, dhownName) {
    await this.pool.query(
      `INSERT INTO busy_master_mapping (entity_type, dhown_id, dhown_name, sync_status)
       VALUES ($1, $2, $3, 'PENDING')
       ON CONFLICT (entity_type, dhown_id) DO UPDATE SET
         dhown_name = COALESCE(EXCLUDED.dhown_name, busy_master_mapping.dhown_name),
         updated_at = NOW()`,
      [entityType, dhownId, dhownName || null],
    );
    return this.find(entityType, dhownId);
  }

  /** Record a successful sync and the BUSY identity it produced. */
  async markSynced(entityType, dhownId, busyId, busyCode) {
    await this.pool.query(
      `INSERT INTO busy_master_mapping
         (entity_type, dhown_id, busy_id, busy_code, sync_status, last_synced_at, error, updated_at)
       VALUES ($1, $2, $3, $4, 'SYNCED', NOW(), NULL, NOW())
       ON CONFLICT (entity_type, dhown_id) DO UPDATE SET
         busy_id        = EXCLUDED.busy_id,
         busy_code      = EXCLUDED.busy_code,
         sync_status    = 'SYNCED',
         last_synced_at = NOW(),
         error          = NULL,
         updated_at     = NOW()`,
      [entityType, dhownId, busyId, busyCode || null],
    );
    return this.find(entityType, dhownId);
  }

  async markFailed(entityType, dhownId, error, status = 'FAILED') {
    await this.pool.query(
      `INSERT INTO busy_master_mapping (entity_type, dhown_id, sync_status, error, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (entity_type, dhown_id) DO UPDATE SET
         sync_status = EXCLUDED.sync_status,
         error       = EXCLUDED.error,
         updated_at  = NOW()`,
      [entityType, dhownId, status, error],
    );
  }

  /**
   * Manual mapping from the dashboard's "Fix Mapping" action: a supervisor
   * states that DHOWN record X is BUSY record Y.
   */
  async setManualMapping(entityType, dhownId, busyId, busyCode) {
    const clash = await this.findByBusyId(entityType, busyId);
    if (clash && clash.dhownId !== dhownId) {
      // Two DHOWN records pointing at one BUSY ledger silently merges two
      // customers' accounts. Refuse rather than let the UNIQUE index surface
      // as an opaque Postgres error.
      const err = new Error(
        `BUSY ${entityType} "${busyId}" is already mapped to DHOWN record "${clash.dhownId}". ` +
          'Unmap it first if this is a correction.',
      );
      err.conflict = true;
      throw err;
    }
    return this.markSynced(entityType, dhownId, busyId, busyCode);
  }

  async clearMapping(entityType, dhownId) {
    await this.pool.query(
      `UPDATE busy_master_mapping
          SET busy_id = NULL, busy_code = NULL, sync_status = 'PENDING', error = NULL, updated_at = NOW()
        WHERE entity_type = $1 AND dhown_id = $2`,
      [entityType, dhownId],
    );
  }

  async list(filter = {}) {
    const where = [];
    const params = [];
    if (filter.entityType) {
      params.push(filter.entityType);
      where.push(`entity_type = $${params.length}`);
    }
    if (filter.syncStatus) {
      params.push(filter.syncStatus);
      where.push(`sync_status = $${params.length}`);
    }
    if (filter.search) {
      params.push(`%${filter.search}%`);
      const p = `$${params.length}`;
      where.push(`(dhown_id ILIKE ${p} OR busy_id ILIKE ${p} OR busy_code ILIKE ${p} OR dhown_name ILIKE ${p})`);
    }
    params.push(Math.min(filter.limit || 200, 500));
    const sql =
      `SELECT * FROM busy_master_mapping${where.length ? ` WHERE ${where.join(' AND ')}` : ''}` +
      ` ORDER BY updated_at DESC LIMIT $${params.length}`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(toMapping);
  }

  /** Counts per status, for the dashboard's mapping health panel. */
  async counts() {
    const { rows } = await this.pool.query(
      'SELECT sync_status, COUNT(*)::int AS n FROM busy_master_mapping GROUP BY sync_status',
    );
    const out = { PENDING: 0, SYNCED: 0, FAILED: 0, MANUAL_REVIEW: 0 };
    for (const r of rows) out[r.sync_status] = r.n;
    return out;
  }

  /** Every DHOWN id with no BUSY counterpart — the supervisor's to-do list. */
  async unmapped(entityType) {
    const params = [];
    let sql = 'SELECT * FROM busy_master_mapping WHERE busy_id IS NULL';
    if (entityType) {
      params.push(entityType);
      sql += ` AND entity_type = $${params.length}`;
    }
    sql += ' ORDER BY updated_at DESC LIMIT 500';
    const { rows } = await this.pool.query(sql, params);
    return rows.map(toMapping);
  }
}

module.exports = { MappingStore };
