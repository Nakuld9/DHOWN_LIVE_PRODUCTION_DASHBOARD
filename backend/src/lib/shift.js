// Shift helpers — shift window config + which shift is running right now.

const pool = require("../../config/database");

async function getShiftSettings() {
  const r = await pool.query(
    `SELECT key, value FROM app_settings
     WHERE key IN ('day_shift','night_shift','shift_mode',
                   'shift_a_start','shift_a_end','shift_b_start','shift_b_end',
                   'shift_c_start','shift_c_end',
                   'planned_hours_per_shift','quality_target_pct',
                   'auto_downtime_enabled','auto_downtime_threshold_minutes')`
  );
  const s = {};
  r.rows.forEach(row => { s[row.key] = row.value; });
  return s;
}

function parseHHMM(str) {
  const parts = (str || '00:00').replace(/[^0-9:]/g,'').split(':');
  return parseInt(parts[0] || 0) + parseInt(parts[1] || 0) / 60;
}

function detectCurrentShift(s) {
  const now = new Date();
  const t = now.getHours() + now.getMinutes() / 60;
  const mode = s.shift_mode || '2-shift';

  if (mode === '3-shift') {
    const aS = parseHHMM(s.shift_a_start || '06:00');
    const aE = parseHHMM(s.shift_a_end   || '14:00');
    const bS = parseHHMM(s.shift_b_start || '14:00');
    const bE = parseHHMM(s.shift_b_end   || '22:00');
    if (t >= aS && t < aE) return 'D';
    if (t >= bS && t < bE) return 'N';
    return 'C';
  }

  // 2-shift: Day (D) 08:00-20:00, Night (N) 20:00-08:00
  const dayStr = s.day_shift || '08:00 - 20:00';
  const [dStart, dEnd] = dayStr.split(' - ').map(x => parseHHMM(x.trim()));
  if (t >= dStart && t < dEnd) return 'D';
  return 'N';
}

module.exports = { getShiftSettings, parseHHMM, detectCurrentShift };
