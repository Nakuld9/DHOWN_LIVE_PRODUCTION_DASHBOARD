// Finishing repository — received-challan finishing/QC records.
// SQL + transaction kept verbatim from the original inline /api/finishing handlers.
module.exports = (pool) => ({
  listReceipts() {
    return pool.query(`
      SELECT
        sr.receipt_id, sr.received_date, sr.received_weight_kg, sr.quality_status,
        sr.rejected_weight_kg, sr.shade,
        sr.notes, sr.received_by,
        sc.challan_number, sc.vendor_name, sc.job_type, sc.sent_weight_kg,
        b.batch_number, b.fabric_type, b.color_name, b.color_code,
        fr.finishing_id, fr.qa_passed, fr.finished_by, fr.finished_at,
        fr.shrinkage_pct, fr.qa_notes
      FROM subcontract_receipts sr
      JOIN subcontract_challans sc ON sc.challan_id = sr.challan_id
      LEFT JOIN batches b ON b.batch_id = sc.batch_id
      LEFT JOIN finishing_records fr ON fr.receipt_id = sr.receipt_id
      ORDER BY sr.created_at DESC
    `);
  },

  // Upsert finishing record + HOLD finished goods on QA fail, atomically.
  async saveQC(receipt_id, { shade, gsm, qa_passed, shrinkage_pct, qa_notes }, username) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT finishing_id FROM finishing_records WHERE receipt_id=$1`, [receipt_id]
      );
      let fr;
      if (existing.rows.length) {
        fr = await client.query(
          `UPDATE finishing_records
           SET shade=$1, gsm=$2, qa_passed=$3,
               shrinkage_pct=$4, qa_notes=$5, finished_by=$6, finished_at=NOW()
           WHERE receipt_id=$7 RETURNING *`,
          [shade||null, gsm||null, qa_passed !== false, shrinkage_pct||null, qa_notes||null, username, receipt_id]
        );
      } else {
        const rec = await client.query(`SELECT batch_id FROM subcontract_challans sc JOIN subcontract_receipts sr ON sc.challan_id=sr.challan_id WHERE sr.receipt_id=$1`, [receipt_id]);
        fr = await client.query(
          `INSERT INTO finishing_records
             (receipt_id, batch_id, shade, gsm, qa_passed, shrinkage_pct, qa_notes, finished_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [receipt_id, rec.rows[0]?.batch_id||null, shade||null, gsm||null,
           qa_passed !== false, shrinkage_pct||null, qa_notes||null, username]
        );
      }

      if (qa_passed === false) {
        await client.query(
          `UPDATE finished_goods SET status='HOLD' WHERE receipt_id=$1`, [receipt_id]
        );
      }

      await client.query('COMMIT');
      return { row: fr.rows[0] };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  },
});
