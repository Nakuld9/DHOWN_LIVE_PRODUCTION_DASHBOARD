// Yarn repository — data access for yarn store + issues + returns.
// Tables: yarn_lots, yarn_lot_movements, yarn_issues, yarn_issue_items,
//         yarn_returns, yarn_return_items.
// Transaction helpers (nextInvSeq, addCostEntry, postToLedger) are injected so
// FIFO cost + stock-ledger postings stay identical to the original inline code.
module.exports = (pool, { nextInvSeq, addCostEntry, postToLedger }) => {

  // Reverse yarn issue stock back to lots (used by delete + cancel).
  async function reverseYarnIssueStock(client, issue_id) {
    const items = await client.query(`SELECT * FROM yarn_issue_items WHERE issue_id=$1`, [issue_id]);
    for (const item of items.rows) {
      const net = parseFloat(item.issued_kg) - parseFloat(item.returned_kg || 0);
      if (net > 0) {
        const lot = await client.query(`SELECT current_stock_kg, current_cones FROM yarn_lots WHERE lot_id=$1 FOR UPDATE`, [item.lot_id]);
        const before = parseFloat(lot.rows[0].current_stock_kg);
        const after = before + net;
        const conesRestore = parseInt(item.issued_cones || 0);
        await client.query(`UPDATE yarn_lots SET current_stock_kg=$1, current_cones=current_cones+$2, updated_at=NOW() WHERE lot_id=$3`, [after, conesRestore, item.lot_id]);
        await client.query(
          `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_type, reference_id, notes)
           VALUES ($1,'CANCEL_RETURN',$2,$3,$4,'ISSUE',$5,'Issue reversed')`,
          [item.lot_id, net, before, after, issue_id]
        );
      }
    }
  }

  return {
    // ── STORE ──────────────────────────────────────────────
    storeList(status) {
      let q = `SELECT yl.*, g.supplier_name, g.receipt_date
               FROM yarn_lots yl JOIN grn g ON g.grn_id = yl.grn_id`;
      const params = [];
      if (status) { q += ` WHERE yl.status = $1`; params.push(status); }
      q += ` ORDER BY yl.created_at DESC`;
      return pool.query(q, params);
    },

    storeSummary() {
      return pool.query(`
        SELECT yarn_type, color,
               COUNT(*) AS lot_count,
               SUM(current_stock_kg) AS stock_kg,
               SUM(net_weight_kg) AS total_received_kg
        FROM yarn_lots GROUP BY yarn_type, color ORDER BY stock_kg DESC`);
    },

    storeLowStock(threshold) {
      return pool.query(`
        SELECT yl.*, g.supplier_name,
          CASE WHEN yl.net_weight_kg > 0 THEN ROUND((yl.current_stock_kg / yl.net_weight_kg * 100)::NUMERIC, 1) ELSE 0 END AS stock_pct
        FROM yarn_lots yl JOIN grn g ON g.grn_id = yl.grn_id
        WHERE yl.status = 'IN_STORE'
          AND yl.net_weight_kg > 0
          AND yl.current_stock_kg < (yl.net_weight_kg * $1)
        ORDER BY (yl.current_stock_kg / yl.net_weight_kg) ASC
      `, [threshold]);
    },

    storeMovements(id) {
      return pool.query(`SELECT * FROM yarn_lot_movements WHERE lot_id = $1 ORDER BY created_at DESC`, [id]);
    },

    storeSetLocation(id, location) {
      return pool.query(`UPDATE yarn_lots SET location=$1, updated_at=NOW() WHERE lot_id=$2 RETURNING *`, [location, id]);
    },

    // ── ISSUES ─────────────────────────────────────────────
    issuesList({ status, machine_id } = {}) {
      let q = `SELECT yi.*, COUNT(ii.item_id) AS item_count, SUM(ii.issued_kg) AS total_issued_kg
               FROM yarn_issues yi LEFT JOIN yarn_issue_items ii ON ii.issue_id = yi.issue_id WHERE 1=1`;
      const params = [];
      if (status) { params.push(status); q += ` AND yi.status=$${params.length}`; }
      if (machine_id) { params.push(machine_id); q += ` AND yi.machine_id=$${params.length}`; }
      q += ` GROUP BY yi.issue_id ORDER BY yi.created_at DESC`;
      return pool.query(q, params);
    },

    async createIssue(body) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { machine_id, machine_name, issued_by, received_by, notes, items } = body;
        if (!items || !items.length) throw new Error('No items provided');
        const issue_number = await nextInvSeq('ISS', 'yarn_issues', 'issue_number');
        const iss = await client.query(
          `INSERT INTO yarn_issues (issue_number, machine_id, machine_name, issued_by, received_by, notes)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [issue_number, machine_id || null, machine_name || null, issued_by || null, received_by || null, notes || null]
        );
        const issue_id = iss.rows[0].issue_id;

        for (const item of items) {
          const lot = await client.query(`SELECT current_stock_kg, current_cones FROM yarn_lots WHERE lot_id = $1 FOR UPDATE`, [item.lot_id]);
          if (!lot.rows.length) throw new Error(`Lot ${item.lot_id} not found`);
          const before = parseFloat(lot.rows[0].current_stock_kg);
          if (before < item.issued_kg) throw new Error(`Insufficient stock in lot ${item.lot_id}: have ${before}kg, need ${item.issued_kg}kg`);
          const after = before - item.issued_kg;
          const issuedCones = parseInt(item.issued_cones || 0);
          const conesBefore = parseInt(lot.rows[0].current_cones || 0);
          const conesAfter = Math.max(0, conesBefore - issuedCones);
          await client.query(`UPDATE yarn_lots SET current_stock_kg=$1, current_cones=$2, updated_at=NOW() WHERE lot_id=$3`, [after, conesAfter, item.lot_id]);
          await client.query(
            `INSERT INTO yarn_issue_items (issue_id, lot_id, issued_kg, issued_cones) VALUES ($1,$2,$3,$4)`,
            [issue_id, item.lot_id, item.issued_kg, issuedCones]
          );
          await client.query(
            `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_id, reference_type, notes)
             VALUES ($1,'ISSUE',$2,$3,$4,$5,'ISSUE','Issued to machine')`,
            [item.lot_id, item.issued_kg, before, after, issue_id]
          );
          // FIFO yarn cost: record cost at this lot's GRN rate
          const lotInfo = await client.query('SELECT yl.item_id, yl.yarn_type, yl.color, yl.rate_per_kg, g.warehouse_id FROM yarn_lots yl LEFT JOIN grn g ON g.grn_id = yl.grn_id WHERE yl.lot_id=$1', [item.lot_id]);
          const l = lotInfo.rows[0] || {};
          // FIFO cost entry at this lot's GRN rate
          if (l.rate_per_kg && parseFloat(l.rate_per_kg) > 0) {
            const issuedKg  = parseFloat(item.issued_kg);
            const fifoRate  = parseFloat(l.rate_per_kg);
            await addCostEntry(client, {
              reference_type: 'ISSUE', reference_id: issue_id,
              cost_component: 'YARN_COST',
              amount_rs: (issuedKg * fifoRate).toFixed(2),
              quantity_kg: issuedKg, rate_used: fifoRate,
              notes: `FIFO: ${l.yarn_type||''} ${l.color||''} Lot ${item.lot_id} @ ₹${fifoRate}/kg → machine ${machine_name || machine_id || ''}`.trim(),
            });
          }
          await postToLedger(client, {
            doc_type: 'ISSUE', doc_id: issue_number,
            item_id: l.item_id || null,
            item_desc: `${l.yarn_type||''} ${l.color||''}`.trim() || `Lot ${item.lot_id}`,
            warehouse_id: l.warehouse_id || null,
            movement_type: 'OUT',
            quantity: item.issued_kg,
            uom_code: 'KG',
            notes: `Issued to ${machine_name || machine_id || 'machine'}`,
            created_by: issued_by || 'system',
          });
        }
        await client.query('COMMIT');
        return { row: iss.rows[0], issue_id };
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    },

    async issueById(id) {
      const iss = await pool.query(`SELECT * FROM yarn_issues WHERE issue_id = $1`, [id]);
      if (!iss.rows.length) return { notFound: true };
      const items = await pool.query(`
        SELECT ii.*,
          yl.lot_number, yl.yarn_type, yl.color, yl.count,
          yl.supplier_lot_no, yl.net_weight_kg AS lot_net_kg, yl.current_stock_kg,
          yl.location, yl.brand,
          COALESCE(i.item_name, yl.yarn_type) AS item_name,
          COALESCE(h.hsn_code, '') AS hsn_code
        FROM yarn_issue_items ii
        JOIN yarn_lots yl ON yl.lot_id = ii.lot_id
        LEFT JOIN items i ON UPPER(i.item_code) = UPPER(yl.yarn_type) OR UPPER(i.item_name) = UPPER(yl.yarn_type)
        LEFT JOIN hsn_codes h ON h.hsn_id = i.hsn_id
        WHERE ii.issue_id = $1
      `, [id]);
      return { row: { ...iss.rows[0], items: items.rows } };
    },

    // Yarn return — partial return from machine (against an issue)
    async returnAgainstIssue(issue_id, returns) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const ret of returns) {
          const item = await client.query(
            `SELECT ii.*, yl.current_stock_kg FROM yarn_issue_items ii
             JOIN yarn_lots yl ON yl.lot_id = ii.lot_id
             WHERE ii.item_id = $1 FOR UPDATE`, [ret.item_id]
          );
          if (!item.rows.length) continue;
          const { lot_id, issued_kg, returned_kg } = item.rows[0];
          const new_returned = parseFloat(returned_kg) + parseFloat(ret.returned_kg);
          if (new_returned > issued_kg) throw new Error(`Return exceeds issued: item ${ret.item_id}`);
          const before = parseFloat(item.rows[0].current_stock_kg);
          const after = before + parseFloat(ret.returned_kg);
          await client.query(`UPDATE yarn_issue_items SET returned_kg=$1 WHERE item_id=$2`, [new_returned, ret.item_id]);
          await client.query(`UPDATE yarn_lots SET current_stock_kg=$1, updated_at=NOW() WHERE lot_id=$2`, [after, lot_id]);
          await client.query(
            `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_id, reference_type)
             VALUES ($1,'RETURN',$2,$3,$4,$5,'ISSUE')`,
            [lot_id, ret.returned_kg, before, after, issue_id]
          );
        }
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    },

    async deleteIssue(id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const iss = await client.query(`SELECT * FROM yarn_issues WHERE issue_id=$1`, [id]);
        if (!iss.rows.length) { await client.query('ROLLBACK'); return { notFound: true }; }
        if (iss.rows[0].status === 'CANCELLED') { await client.query('ROLLBACK'); return { badRequest: 'Already cancelled, cannot delete' }; }
        await reverseYarnIssueStock(client, id);
        await client.query(`DELETE FROM cost_entries WHERE reference_type='ISSUE' AND reference_id=$1`, [id]);
        await client.query(`DELETE FROM yarn_issue_items WHERE issue_id=$1`, [id]);
        await client.query(`DELETE FROM yarn_issues WHERE issue_id=$1`, [id]);
        await client.query('COMMIT');
        return { ok: true };
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    },

    async cancelIssue(id) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const iss = await client.query(`SELECT * FROM yarn_issues WHERE issue_id=$1`, [id]);
        if (!iss.rows.length) { await client.query('ROLLBACK'); return { notFound: true }; }
        if (iss.rows[0].status === 'CANCELLED') { await client.query('ROLLBACK'); return { badRequest: 'Already cancelled' }; }
        await reverseYarnIssueStock(client, id);
        await client.query(`UPDATE yarn_issues SET status='CANCELLED', updated_at=NOW() WHERE issue_id=$1`, [id]);
        await client.query('COMMIT');
        return { ok: true };
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    },

    async editIssue(id, body) {
      const iss = await pool.query(`SELECT status FROM yarn_issues WHERE issue_id=$1`, [id]);
      if (!iss.rows.length) return { notFound: true };
      if (iss.rows[0].status === 'CANCELLED') return { badRequest: 'Cannot edit cancelled issue' };
      const { notes, received_by } = body;
      const r = await pool.query(
        `UPDATE yarn_issues SET notes=$1, received_by=$2, updated_at=NOW() WHERE issue_id=$3 RETURNING *`,
        [notes||null, received_by||null, id]
      );
      return { row: r.rows[0] };
    },

    // ── RETURNS (separate documents) ───────────────────────
    returnsList() {
      return pool.query(`
        SELECT yr.*, yi.issue_number,
          (SELECT COUNT(*) FROM yarn_return_items WHERE return_id=yr.return_id) AS item_count
        FROM yarn_returns yr
        LEFT JOIN yarn_issues yi ON yi.issue_id = yr.issue_id
        ORDER BY yr.created_at DESC
      `);
    },

    async returnById(id) {
      const [ret, items] = await Promise.all([
        pool.query(`SELECT yr.*, yi.issue_number FROM yarn_returns yr LEFT JOIN yarn_issues yi ON yi.issue_id=yr.issue_id WHERE yr.return_id=$1`, [id]),
        pool.query(`
          SELECT ri.*, COALESCE(it.item_name, ri.yarn_type) AS item_name, yl.supplier_lot_no, yl.brand
          FROM yarn_return_items ri
          LEFT JOIN yarn_lots yl ON yl.lot_id = ri.lot_id
          LEFT JOIN items it ON UPPER(it.item_code) = UPPER(ri.yarn_type)
          WHERE ri.return_id=$1 ORDER BY ri.id
        `, [id]),
      ]);
      if (!ret.rows.length) return { notFound: true };
      return { row: { ...ret.rows[0], items: items.rows } };
    },

    async createReturn({ issue_id, return_date, notes, returns }, username) {
      const client = await pool.connect();
      try {
        const iss = await client.query(`SELECT * FROM yarn_issues WHERE issue_id=$1`, [issue_id]);
        if (!iss.rows.length) return { notFound: true };

        await client.query('BEGIN');
        const cnt = await client.query(`SELECT COUNT(*) FROM yarn_returns`);
        const return_number = `YR-${new Date().getFullYear()}-${String(parseInt(cnt.rows[0].count) + 1).padStart(4, '0')}`;
        const rr = await client.query(
          `INSERT INTO yarn_returns (return_number, issue_id, machine_id, machine_name, return_date, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [return_number, issue_id, iss.rows[0].machine_id, iss.rows[0].machine_name, return_date || new Date().toISOString().slice(0, 10), notes || null, username]
        );
        const returnId = rr.rows[0].return_id;
        let totalKg = 0;

        for (const ret of returns) {
          const qty = parseFloat(ret.returned_kg);
          if (!(qty > 0)) continue;
          const item = await client.query(
            `SELECT ii.*, yl.current_stock_kg FROM yarn_issue_items ii JOIN yarn_lots yl ON yl.lot_id=ii.lot_id WHERE ii.item_id=$1 FOR UPDATE`, [ret.item_id]
          );
          if (!item.rows.length) continue;
          const { lot_id, issued_kg, returned_kg, yarn_type, color, lot_number } = item.rows[0];
          const new_returned = parseFloat(returned_kg) + qty;
          if (new_returned > parseFloat(issued_kg)) throw new Error(`Return exceeds issued for lot ${lot_number}`);
          const before = parseFloat(item.rows[0].current_stock_kg);
          const after = before + qty;
          await client.query(`UPDATE yarn_issue_items SET returned_kg=$1 WHERE item_id=$2`, [new_returned, ret.item_id]);
          await client.query(`UPDATE yarn_lots SET current_stock_kg=$1, updated_at=NOW() WHERE lot_id=$2`, [after, lot_id]);
          await client.query(
            `INSERT INTO yarn_lot_movements (lot_id, movement_type, quantity_kg, before_kg, after_kg, reference_id, reference_type, notes)
             VALUES ($1,'RETURN',$2,$3,$4,$5,'RETURN',$6)`,
            [lot_id, qty, before, after, returnId, return_number]
          );
          await client.query(
            `INSERT INTO yarn_return_items (return_id, item_id, lot_id, lot_number, yarn_type, color, returned_kg)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [returnId, ret.item_id, lot_id, lot_number, yarn_type, color, qty]
          );
          totalKg += qty;
        }
        await client.query(`UPDATE yarn_returns SET total_kg=$1 WHERE return_id=$2`, [totalKg.toFixed(3), returnId]);
        await client.query('COMMIT');
        return { row: { ...rr.rows[0], total_kg: totalKg.toFixed(3) } };
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    },
  };
};
