// MES ↔ Busy reconciliation (spec §12).
//
// Compares what the MES believes each customer owes (v_partner_outstanding) with
// what Busy's imported outstanding says, matched by party name. Surfaces the
// differences a controller needs to chase: matched, mismatch (with the delta),
// in MES but not Busy, in Busy but not MES.
//
// Read-only. It highlights gaps; a human decides which side is right (Busy is the
// book of accounts, so a mismatch usually means an MES entry that has not been
// posted to Busy yet, or vice-versa).

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d) => { const n = parseFloat(process.env[v]); return Number.isFinite(n) ? n : d; };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(pvt|ltd|private|limited|the|and|co|inds|industries|enterprises|international)\b/g, '').replace(/\s+/g, ' ').trim();

module.exports = (pool) => {
  const busy = require('./busy-bridge')(pool);
  const q = async (sql, p = []) => { try { return (await pool.query(sql, p)).rows; } catch { return null; } };

  async function receivables() {
    await busy.ensure();
    const TOL = num('BUSY_RECON_TOL_RS', 1);

    const mes = (await q(`SELECT p.company_name, COALESCE(v.outstanding,0) outstanding
       FROM v_partner_outstanding v JOIN partners p ON p.partner_id=v.partner_id
      WHERE v.outstanding > 0.009`)) || [];
    const busyRows = (await q(`SELECT party_name, outstanding FROM busy_outstanding WHERE kind='receivable' AND outstanding > 0.009`)) || [];

    if (!busyRows.length) return { available: false, note: 'No Busy receivables imported yet — import Busy Outstanding first.' };

    const byNorm = new Map();
    for (const b of busyRows) byNorm.set(norm(b.party_name), { name: b.party_name, amount: Number(b.outstanding) });
    const seen = new Set();

    const matched = [], mismatch = [], mesOnly = [];
    for (const m of mes) {
      const key = norm(m.company_name);
      const b = byNorm.get(key);
      if (b) {
        seen.add(key);
        const delta = r2(Number(m.outstanding) - b.amount);
        if (Math.abs(delta) <= TOL) matched.push({ party: m.company_name, amount: r2(m.outstanding) });
        else mismatch.push({ party: m.company_name, mes: r2(m.outstanding), busy: r2(b.amount), delta });
      } else {
        mesOnly.push({ party: m.company_name, mes: r2(m.outstanding) });
      }
    }
    const busyOnly = busyRows.filter(b => !seen.has(norm(b.party_name)))
      .map(b => ({ party: b.party_name, busy: r2(b.outstanding) }));

    const sumMes = r2(mes.reduce((s, x) => s + Number(x.outstanding), 0));
    const sumBusy = r2(busyRows.reduce((s, x) => s + Number(x.outstanding), 0));
    return {
      available: true, as_of: busyRows.length ? undefined : null,
      totals: { mes: sumMes, busy: sumBusy, difference: r2(sumMes - sumBusy) },
      counts: { matched: matched.length, mismatch: mismatch.length, mes_only: mesOnly.length, busy_only: busyOnly.length },
      mismatch: mismatch.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 30),
      mes_only: mesOnly.slice(0, 30),
      busy_only: busyOnly.slice(0, 30),
      note: 'Matched by party name (legal suffixes ignored). A mismatch usually means an entry posted on one side but not the other. Busy is the book of accounts.',
    };
  }

  return { receivables };
};
