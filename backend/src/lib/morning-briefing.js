// Morning Briefing — one honest daily snapshot for the owner, composed from
// data the MES already holds (production, bank cash, in-transit imports, and
// the alert/exception feeds). No fabrication: a section that has no data says so.
//
// Generated once per IST day and cached in `morning_briefings`; the dashboard
// panel reads today's (generating it on first view), and a background tick
// pre-generates it at ~09:00 IST.
module.exports = (pool) => {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // A Date whose local fields equal the current Asia/Kolkata wall-clock,
  // regardless of the server's own timezone.
  const istNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const istDateStr = (d = istNow()) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  async function q(sql, params = []) {
    try { return (await pool.query(sql, params)).rows; } catch { return null; }
  }

  async function ensure() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS morning_briefings (
        briefing_date DATE PRIMARY KEY,
        headline      TEXT,
        payload       JSONB NOT NULL,
        generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
  }

  // ── Section builders (each degrades gracefully) ──────────────────────────
  async function production() {
    // Yesterday's closed greige rolls (works with manual shift entry too).
    const rows = await q(`
      SELECT COUNT(*)::int AS rolls,
             COALESCE(SUM(COALESCE(actual_weight_kg, roll_weight_kg, weight_kg, 0)),0) AS kg
        FROM rolls
       WHERE created_at >= ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1)
         AND created_at <  ((now() AT TIME ZONE 'Asia/Kolkata')::date)`);
    if (!rows) return { available: false, note: 'Production data unavailable.' };
    const row = rows[0] || { rolls: 0, kg: 0 };
    return {
      available: true,
      rolls: Number(row.rolls) || 0,
      kg: r2(row.kg),
      note: (Number(row.rolls) || 0) === 0
        ? 'No rolls recorded yesterday — enter shifts manually or wire collectors to see real output.'
        : null,
    };
  }

  async function cash() {
    try {
      const bc = require('./bank-cashflow')(pool);
      const pos = await bc.bankPosition();
      const flow = await bc.movements({ days: 7 });
      const has = !!pos && pos.has_data;
      return {
        available: has,
        balance: has ? r2(pos.total) : null,
        as_of: pos ? pos.as_of : null,
        accounts: pos ? pos.accounts_with_data : 0,
        in_7d: flow ? r2(flow.money_in) : null,
        out_7d: flow ? r2(flow.money_out) : null,
        note: !has ? 'No bank statement ingested yet — cash position is in Busy.' : null,
      };
    } catch (e) {
      return { available: false, note: 'Bank cash position unavailable.' };
    }
  }

  async function shipments() {
    const rows = await q(`
      SELECT import_no,
             status,
             to_char(current_eta, 'DD-MM-YYYY') AS eta,
             current_eta,
             COALESCE(NULLIF(final_destination,''), NULLIF(port_of_discharge,'')) AS dest
        FROM imports
       WHERE status IN ('IN_TRANSIT','AT_TRANSSHIPMENT','ARRIVED_PORT','CUSTOMS','RELEASED','INLAND_TRANSIT')
       ORDER BY current_eta NULLS LAST, import_no
       LIMIT 12`);
    if (!rows) return { available: false, list: [] };
    const today = istNow(); today.setHours(0, 0, 0, 0);
    const list = rows.map((r) => {
      let arriving = null;
      if (r.current_eta) {
        const d = new Date(r.current_eta); d.setHours(0, 0, 0, 0);
        arriving = Math.round((d - today) / 86400000); // days from today
      }
      return { import_no: r.import_no, status: r.status, eta: r.eta, dest: r.dest, days_to_eta: arriving };
    });
    return { available: true, count: list.length, list };
  }

  async function alerts() {
    const out = [];
    try {
      const ie = await require('./import-exceptions')(pool).insights();
      if (Array.isArray(ie)) for (const i of ie.slice(0, 6)) out.push({ kind: 'import', text: i.title || i.message || String(i) });
    } catch {}
    try {
      const ins = await require('./ai-insights')({ pool }).compute();
      if (Array.isArray(ins)) for (const i of ins.slice(0, 6)) out.push({ kind: i.severity || 'insight', text: i.title || i.message || String(i) });
    } catch {}
    return { available: true, count: out.length, list: out.slice(0, 8) };
  }

  function makeHeadline({ prod, csh, ship, alrt }) {
    const bits = [];
    if (prod.available) bits.push(prod.rolls > 0 ? `${prod.rolls} rolls / ${prod.kg} kg yesterday` : 'no production logged yesterday');
    if (csh.available && csh.balance != null) bits.push(`bank ₹${csh.balance.toLocaleString('en-IN')}`);
    if (ship.available && ship.count) {
      const soon = ship.list.filter((s) => s.days_to_eta != null && s.days_to_eta >= 0 && s.days_to_eta <= 3).length;
      bits.push(`${ship.count} shipment${ship.count === 1 ? '' : 's'} in transit${soon ? ` (${soon} arriving ≤3 days)` : ''}`);
    }
    if (alrt.count) bits.push(`${alrt.count} item${alrt.count === 1 ? '' : 's'} need attention`);
    return bits.length ? bits.join(' · ') : 'Nothing notable to report.';
  }

  async function compose() {
    const [prod, csh, ship, alrt] = await Promise.all([production(), cash(), shipments(), alerts()]);
    return {
      date: istDateStr(),
      generated_at: new Date().toISOString(),
      headline: makeHeadline({ prod, csh, ship, alrt }),
      production: prod,
      cash: csh,
      shipments: ship,
      alerts: alrt,
    };
  }

  async function generateForToday() {
    await ensure();
    const payload = await compose();
    await pool.query(
      `INSERT INTO morning_briefings (briefing_date, headline, payload, generated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (briefing_date) DO UPDATE SET headline=EXCLUDED.headline, payload=EXCLUDED.payload, generated_at=now()`,
      [istDateStr(), payload.headline, payload]
    );
    return payload;
  }

  async function getToday() {
    await ensure();
    const rows = await q(`SELECT payload FROM morning_briefings WHERE briefing_date = $1`, [istDateStr()]);
    if (rows && rows[0]) return rows[0].payload;
    return generateForToday();
  }

  // Background: tick every 15 min; (re)generate once it is >= 09:00 IST and
  // today's briefing has not been made yet. jobLock ensures a single runner.
  async function tick() {
    try {
      await ensure();
      const now = istNow();
      if (now.getHours() < 9) return;
      const rows = await q(`SELECT 1 FROM morning_briefings WHERE briefing_date = $1`, [istDateStr()]);
      if (!rows || rows.length === 0) await generateForToday();
    } catch {}
  }

  return { ensure, compose, generateForToday, getToday, tick };
};
