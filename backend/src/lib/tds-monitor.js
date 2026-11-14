// TDS / statutory monitoring (spec §11) — light, and deliberately cautious.
//
// TDS is deducted on PAYMENTS to vendors, and payments live in Busy, not the MES.
// What the MES CAN see is job-work sent out (subcontract challans), whose value is
// the classic 194C case. So this flags vendors whose job-work value in the current
// financial year crosses the 194C thresholds — as a "confirm TDS with your CA"
// heads-up, NEVER a determination. It cannot know what has already been deducted.
//
// It makes no statutory conclusion and computes no liability.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const INR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const num = (v, d) => { const n = parseFloat(process.env[v]); return Number.isFinite(n) ? n : d; };

module.exports = (pool) => {
  const q = async (sql, p = []) => { try { return (await pool.query(sql, p)).rows; } catch { return null; } };

  async function review() {
    const SINGLE = num('TDS_194C_SINGLE_RS', 30000);       // single payment threshold
    const AGGREGATE = num('TDS_194C_AGGREGATE_RS', 100000); // FY aggregate threshold

    // Current Indian financial year start (1 Apr).
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStart = `${fyStartYear}-04-01`;

    const rows = await q(`
      SELECT COALESCE(vendor_name,'?') vendor,
             COUNT(*)::int challans,
             COALESCE(SUM(COALESCE(sent_weight_kg,0) * COALESCE(rate_per_kg,0)),0)::numeric fy_value,
             COALESCE(MAX(COALESCE(sent_weight_kg,0) * COALESCE(rate_per_kg,0)),0)::numeric max_single
        FROM subcontract_challans
       WHERE COALESCE(is_job_work, true) = true
         AND COALESCE(status,'') <> 'CANCELLED'
         AND sent_date >= $1
       GROUP BY vendor_name`, [fyStart]) || [];

    const flags = [];
    for (const r of rows) {
      const fyValue = Number(r.fy_value), maxSingle = Number(r.max_single);
      const overAgg = fyValue >= AGGREGATE, overSingle = maxSingle >= SINGLE;
      if (overAgg || overSingle) flags.push({
        vendor: r.vendor, challans: r.challans,
        fy_job_work_value: r2(fyValue), largest_single: r2(maxSingle),
        reason: overAgg
          ? `Job-work of ${INR(fyValue)} this financial year crosses the 194C aggregate threshold (${INR(AGGREGATE)}).`
          : `A single job-work challan of ${INR(maxSingle)} crosses the 194C single-payment threshold (${INR(SINGLE)}).`,
      });
    }
    flags.sort((a, b) => b.fy_job_work_value - a.fy_job_work_value);

    return {
      section: '194C (job-work)', fy_start: fyStart, source: 'MES (subcontract challans)',
      flags,
      note: flags.length
        ? 'These vendors may attract TDS under 194C. This is a heads-up from job-work VALUE only — it does not know what has already been deducted or paid. Confirm applicability, rate and deduction with your CA. Payments and the TDS ledger are in Busy.'
        : 'No job-work vendor crosses the 194C thresholds this financial year (on MES data).',
      disclaimer: 'Not tax advice and not a statutory determination. TDS depends on facts (vendor status, PAN, payment type) the MES cannot fully see — your CA decides.',
    };
  }

  return { review };
};
