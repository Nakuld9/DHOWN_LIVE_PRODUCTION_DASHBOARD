// Document / lot numbering helpers.
//
// Numbers follow the INDIAN FINANCIAL YEAR (1 Apr – 31 Mar):
//   PREFIX-<FY>-NNN   e.g.  IMP-26-27-001  (FY 2026-27)
// The sequence resets at the start of each financial year.

const pool = require("../../config/database");

// Indian financial-year short form for a date, e.g. "26-27".
// FY starts in April: Apr–Dec belong to <thisYear>-<next>; Jan–Mar to <prev>-<this>.
function finYearShort(d = new Date()) {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;      // getMonth: 0=Jan … 3=Apr
  return `${String(start).slice(2)}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// PREFIX-<FY>-NNN. Resets each FY by counting only rows already in this FY's series.
async function nextSeq(prefix, table, col) {
  const fy = finYearShort();
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${col} LIKE $1`, [`${prefix}-${fy}-%`]);
  const n = r.rows[0].n + 1;
  return `${prefix}-${fy}-${String(n).padStart(3, '0')}`;
}

// Same format, but derives the next number from the highest existing one in this FY
// (safer than COUNT when rows can be voided/deleted).
async function nextInvSeq(prefix, table, col) {
  const fy = finYearShort();
  const res = await pool.query(
    `SELECT ${col} FROM ${table} WHERE ${col} LIKE $1 ORDER BY ${col} DESC LIMIT 1`,
    [`${prefix}-${fy}-%`]
  );
  if (res.rows.length === 0) return `${prefix}-${fy}-001`;
  const last = res.rows[0][col];
  const n = parseInt(last.split('-').pop(), 10) + 1;
  return `${prefix}-${fy}-${String(n).padStart(3, '0')}`;
}

// Configurable ERP series (doc_series table). Year, when included, is the FY.
async function nextDocNumber(seriesCode) {
  const res = await pool.query('SELECT * FROM doc_series WHERE series_code=$1', [seriesCode]);
  if (res.rows.length === 0) throw new Error(`Unknown doc series: ${seriesCode}`);
  const s = res.rows[0];
  const now = new Date();
  const fy = finYearShort(now);                     // "26-27" (April–March)

  let newSeq = s.current_seq + 1;
  if (s.reset_yearly && s.fin_year && s.fin_year !== fy) newSeq = 1;

  await pool.query(
    `UPDATE doc_series SET current_seq=$1, fin_year=$2, last_reset=CASE WHEN $3 THEN CURRENT_DATE ELSE last_reset END, updated_at=NOW() WHERE series_code=$4`,
    [newSeq, fy, (s.reset_yearly && s.fin_year !== fy), seriesCode]
  );

  let num = s.prefix;
  const dated = s.include_year || s.include_month;
  if (s.include_year) num += `-${fy}`;                                 // -26-27
  if (s.include_month) num += `-${String(now.getMonth() + 1).padStart(2, '0')}`;
  num += dated ? `-${String(newSeq).padStart(s.zero_pad, '0')}`        // dash-separated for FY docs
               : String(newSeq).padStart(s.zero_pad, '0');            // compact for code series (ITEM/PART)
  if (s.suffix) num += s.suffix;
  return num;
}

module.exports = { nextSeq, nextInvSeq, nextDocNumber, finYearShort };
