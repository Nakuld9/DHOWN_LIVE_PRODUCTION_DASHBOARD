require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });

async function test() {
  const machine_id = 'SJ03'; const shift = 'D';
  const now = new Date();
  const datePart = now.toISOString().slice(0,10).replace(/-/g,'');
  const [prefixRow, machineRow, seqRow] = await Promise.all([
    pool.query(`SELECT value FROM app_settings WHERE key='roll_prefix'`),
    pool.query(`SELECT fabric_code, fabric, gauge FROM machines WHERE machine_id=$1`, [machine_id]),
    pool.query(`SELECT COUNT(*) AS cnt FROM rolls WHERE machine_id=$1 AND DATE(created_at)=CURRENT_DATE`, [machine_id])
  ]);
  const prefix = (prefixRow.rows[0]?.value || 'DHM-').replace(/[-\s]+$/, '');
  const fabricCode = machineRow.rows[0]?.fabric_code || null;
  const gaugeVal = machineRow.rows[0]?.gauge ? `G${machineRow.rows[0].gauge}` : null;
  const seq = String(parseInt(seqRow.rows[0].cnt) + 1).padStart(3, '0');
  const fabricPart = fabricCode ? `-${fabricCode}` : '';
  const gaugePart = gaugeVal ? `-${gaugeVal}` : '';
  const shiftLabel = shift === 'D' ? 'D' : shift === 'N' ? 'N' : shift;
  const generatedId = `${prefix}-${machine_id}${fabricPart}${gaugePart}-${datePart}-${shiftLabel}-${seq}`;
  console.log('prefix:', prefix);
  console.log('fabricCode:', fabricCode);
  console.log('gaugeVal:', gaugeVal);
  console.log('Generated ID:', generatedId);
  pool.end();
}
test().catch(e => { console.error(e.message); pool.end(); });
