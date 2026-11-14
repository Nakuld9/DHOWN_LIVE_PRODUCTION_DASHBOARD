// Command-center repository — the 22-query factory snapshot. SQL verbatim from
// the original inline /api/command-center handler.
module.exports = (pool) => ({
  snapshot({ today, currentShift }) {
    return Promise.all([
      // machines live
      pool.query(`SELECT m.machine_id, m.machine_name,
          COALESCE(ld.rpm,0) AS rpm, COALESCE(ld.dc_status,'offline') AS dc_status,
          oa.operator_name,
          dt.id AS dt_id,
          CASE WHEN dt.id IS NOT NULL THEN 'DOWNTIME'
               WHEN ld.machine_id IS NULL AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
               WHEN ld.machine_id IS NULL AND m.dc_id IS NOT NULL THEN 'OFFLINE'
          WHEN ld.machine_id IS NULL THEN 'NO_DATA'
               WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' AND oa.assignment_id IS NOT NULL THEN 'RUNNING'
               WHEN LOWER(COALESCE(ld.dc_status,'offline'))<>'online' THEN 'OFFLINE'
               WHEN COALESCE(ld.rpm,0)>0 THEN 'RUNNING' ELSE 'STOPPED' END AS live_status
        FROM machines m
        LEFT JOIN machine_live_data ld ON m.machine_id=ld.machine_id
        LEFT JOIN LATERAL (SELECT assignment_id, operator_name FROM operator_assignments WHERE machine_id=m.machine_id AND status='ACTIVE' ORDER BY assigned_at DESC LIMIT 1) oa ON true
        LEFT JOIN LATERAL (SELECT id FROM machine_downtime WHERE machine_id=m.machine_id AND status='OPEN' ORDER BY start_time DESC LIMIT 1) dt ON true
        ORDER BY m.machine_id`),
      // production today
      pool.query(`SELECT COALESCE(SUM(production_kg),0) AS kg FROM production_records WHERE record_date=$1`, [today]),
      // production this shift
      pool.query(`SELECT COALESCE(SUM(production_kg),0) AS kg FROM production_records WHERE record_date=$1 AND shift=$2`, [today, currentShift]),
      // OEE
      pool.query(`SELECT ROUND(AVG(oee),2) AS oee FROM oee_records WHERE record_date=$1 AND shift=$2`, [today, currentShift]),
      // GRN today count
      pool.query(`SELECT COUNT(*) AS cnt FROM grn WHERE DATE(receipt_date)=$1`, [today]),
      // recent GRNs
      pool.query(`SELECT g.grn_number, g.supplier_name, g.receipt_date, g.status FROM grn g ORDER BY g.receipt_date DESC LIMIT 3`),
      // dispatch today
      pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(total_weight_kg),0) AS kg FROM dispatch_challans WHERE DATE(dispatch_date)=$1`, [today]),
      // recent dispatch
      pool.query(`SELECT dispatch_number AS challan_number, customer_name, total_weight_kg, dispatch_date AS created_at FROM dispatch_challans ORDER BY dispatch_date DESC LIMIT 3`),
      // SC sent today
      pool.query(`SELECT COUNT(*) AS cnt FROM subcontract_challans WHERE DATE(sent_date)=$1 AND status='SENT'`, [today]),
      // SC received today
      pool.query(`SELECT COUNT(*) AS cnt FROM subcontract_challans WHERE status='RECEIVED'`),
      // recent SC
      pool.query(`SELECT challan_number, vendor_name, status, sent_date FROM subcontract_challans ORDER BY created_at DESC LIMIT 3`),
      // recent yarn issues
      pool.query(`SELECT yi.issue_number, yi.machine_id, yi.issue_date, COALESCE((SELECT SUM(issued_kg) FROM yarn_issue_items WHERE issue_id=yi.issue_id),0) AS total_kg FROM yarn_issues yi ORDER BY yi.issue_date DESC LIMIT 3`),
      // yarn issue today
      pool.query(`SELECT COUNT(*) AS cnt, COALESCE((SELECT SUM(yii.issued_kg) FROM yarn_issue_items yii JOIN yarn_issues yi2 ON yii.issue_id=yi2.issue_id WHERE DATE(yi2.issue_date)=$1),0) AS kg FROM yarn_issues WHERE DATE(issue_date)=$2`, [today, today]),
      // inventory value
      pool.query(`SELECT COALESCE(SUM(current_stock_kg * rate_per_kg),0) AS val, COALESCE(SUM(current_stock_kg),0) AS kg FROM yarn_lots WHERE current_stock_kg>0`),
      // recent rolls
      pool.query(`SELECT roll_id, machine_id, COALESCE(actual_weight_kg, weight_kg) AS net_weight_kg, COALESCE(closed_at, created_at) AS completed_at FROM rolls ORDER BY created_at DESC LIMIT 3`),
      // recent downtime
      pool.query(`SELECT machine_id, reason, start_time, ROUND(EXTRACT(EPOCH FROM COALESCE(end_time, NOW()) - start_time)/60) AS mins FROM machine_downtime ORDER BY start_time DESC LIMIT 3`),
      // top operators (last 7 days)
      pool.query(`SELECT oa.operator_name, oa.machine_id, COUNT(*) AS shifts FROM operator_assignments oa WHERE oa.status='ACTIVE' OR oa.assigned_at >= NOW()-INTERVAL '7 days' GROUP BY oa.operator_name, oa.machine_id ORDER BY shifts DESC LIMIT 4`),
      // top fabrics produced
      pool.query(`SELECT COALESCE(r.fabric_type,'Unknown') AS fabric, ROUND(SUM(COALESCE(r.actual_weight_kg, r.weight_kg, 0))::numeric,1) AS kg FROM rolls r GROUP BY fabric ORDER BY kg DESC LIMIT 5`),
      // top yarn consumed
      pool.query(`SELECT COALESCE(i.item_name, yl.yarn_type) AS yarn, ROUND(SUM(yii.issued_kg)::numeric,1) AS kg FROM yarn_issue_items yii JOIN yarn_lots yl ON yii.lot_id=yl.lot_id LEFT JOIN items i ON UPPER(i.item_code)=UPPER(yl.yarn_type) GROUP BY yarn ORDER BY kg DESC LIMIT 4`),
      // pending SC challans
      pool.query(`SELECT COUNT(*) AS cnt FROM subcontract_challans WHERE status='SENT'`),
      // pending GRN (draft)
      pool.query(`SELECT COUNT(*) AS cnt FROM grn WHERE status='DRAFT'`),
      // pending dispatch (draft)
      pool.query(`SELECT COUNT(*) AS cnt FROM dispatch_challans WHERE status='DRAFT'`),
    ]);
  },
});
