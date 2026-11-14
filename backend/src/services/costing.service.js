const tenant = require('../../config/tenant');
// Costing service — variance math, cost roll-ups, and the AI cost assistant.
// Calculation logic kept verbatim from the original inline handlers.
module.exports = (repo, { callOllama }) => ({
  async knittingVariance({ from, to }) {
    const issued = await repo.knittingIssued({ from, to });
    const produced = await repo.knittingProduced({ from, to });

    const issuedMap = {};
    for (const row of issued.rows) {
      const key = `${row.machine_id}__${row.issue_date}`;
      issuedMap[key] = { machine_id: row.machine_id, machine_name: row.machine_name, date: row.issue_date, yarn_issued_kg: parseFloat(row.yarn_issued_kg) };
    }
    return produced.rows.map(p => {
      const key = `${p.machine_id}__${p.prod_date}`;
      const iss = issuedMap[key] || {};
      const yarnIssued   = iss.yarn_issued_kg || 0;
      const fabricOut    = parseFloat(p.fabric_produced_kg);
      const stdLossPct   = parseFloat(p.std_loss_pct);
      const stdLossKg    = (yarnIssued * stdLossPct / 100);
      const actualLossKg = yarnIssued - fabricOut;
      const varianceKg   = actualLossKg - stdLossKg;
      return {
        machine_id:        p.machine_id,
        machine_name:      iss.machine_name || p.machine_id,
        date:              p.prod_date,
        yarn_issued_kg:    yarnIssued.toFixed(3),
        fabric_produced_kg: fabricOut.toFixed(3),
        roll_count:        p.roll_count,
        std_loss_pct:      stdLossPct,
        std_loss_kg:       stdLossKg.toFixed(3),
        actual_loss_kg:    actualLossKg.toFixed(3),
        variance_kg:       varianceKg.toFixed(3),
        variance_status:   varianceKg > 0.01 ? 'UNFAVORABLE' : varianceKg < -0.01 ? 'FAVORABLE' : 'ON_TARGET',
      };
    });
  },

  async bomVariance({ from, to }) {
    const produced = await repo.bomProduced({ from, to });
    if (!produced.rows.length) return [];

    const fabricIds = [...new Set(produced.rows.map(r => r.fabric_item_id).filter(Boolean))];
    const bomRes = await repo.bomLines(fabricIds);
    const bomMap = {};
    for (const b of bomRes.rows) {
      if (!bomMap[b.fabric_item_id]) bomMap[b.fabric_item_id] = [];
      bomMap[b.fabric_item_id].push(b);
    }

    const actual = await repo.bomActual({ from, to });
    const actualMap = {};
    for (const a of actual.rows) {
      const key = `${a.machine_id}__${a.yarn_item_id}`;
      actualMap[key] = parseFloat(a.net_consumed_kg || 0);
    }

    const result = [];
    for (const p of produced.rows) {
      const bom = bomMap[p.fabric_item_id] || [];
      if (!bom.length) continue;
      const fabricKg = parseFloat(p.fabric_kg);
      const stdLossPct = parseFloat(p.std_loss_pct);
      const yarnNeeded = fabricKg / (1 - stdLossPct / 100);

      for (const b of bom) {
        const stdKg = (yarnNeeded * parseFloat(b.percentage) / 100);
        const actKey = `${p.machine_id}__${b.yarn_item_id}`;
        const actKg = actualMap[actKey] || 0;
        const varianceKg = actKg - stdKg;
        result.push({
          machine_id: p.machine_id,
          machine_name: p.machine_name,
          fabric_code: p.fabric_code,
          fabric_name: p.fabric_name,
          fabric_produced_kg: fabricKg.toFixed(2),
          roll_count: parseInt(p.roll_count),
          yarn_code: b.yarn_code,
          yarn_name: b.yarn_name,
          bom_pct: parseFloat(b.percentage),
          std_consumption_kg: stdKg.toFixed(3),
          actual_consumption_kg: actKg.toFixed(3),
          variance_kg: varianceKg.toFixed(3),
          variance_pct: stdKg > 0 ? ((varianceKg / stdKg) * 100).toFixed(1) : '0.0',
          status: varianceKg > 0.5 ? 'OVER' : varianceKg < -0.5 ? 'SHORT' : 'OK',
        });
      }
    }
    return result;
  },

  async rates() { return (await repo.ratesList()).rows; },

  async upsertRate(body, username) { return (await repo.upsertRate(body, username)).rows[0]; },

  async rollCost(id) {
    const roll = await repo.rollWithMachine(id);
    if (!roll.rows.length) return { notFound: true };
    const entries = await repo.rollEntries(id);
    const total = entries.rows.reduce((s, e) => s + parseFloat(e.amount_rs), 0);
    const r = roll.rows[0];
    const cost_per_kg = r.actual_weight_kg > 0 ? (total / r.actual_weight_kg).toFixed(2) : null;
    return { row: { roll: r, entries: entries.rows, total_cost_rs: total.toFixed(2), cost_per_kg } };
  },

  async batchCost(id) {
    const batch = await repo.batchById(id);
    if (!batch.rows.length) return { notFound: true };
    const rolls = await repo.batchRolls(id);
    const rollIds = rolls.rows.map(r => r.roll_id);

    const rollEntries = rollIds.length ? await repo.rollEntriesAgg(rollIds) : { rows: [] };
    const batchEntries = await repo.batchEntriesAgg(id);
    const challanEntries = await repo.challanEntriesAgg(id);

    const all = [...rollEntries.rows, ...batchEntries.rows, ...challanEntries.rows];
    const byComponent = {};
    all.forEach(e => {
      if (!byComponent[e.cost_component]) byComponent[e.cost_component] = { amount_rs: 0, quantity_kg: 0 };
      byComponent[e.cost_component].amount_rs += parseFloat(e.total);
      byComponent[e.cost_component].quantity_kg += parseFloat(e.kg || 0);
    });
    const total_cost_rs = Object.values(byComponent).reduce((s, v) => s + v.amount_rs, 0);
    const b = batch.rows[0];
    const cost_per_kg = b.total_weight_kg > 0 ? (total_cost_rs / b.total_weight_kg).toFixed(2) : null;
    return { row: { batch: b, breakdown: byComponent, total_cost_rs: total_cost_rs.toFixed(2), cost_per_kg, roll_count: rollIds.length } };
  },

  async summary({ from, to }) {
    const [byComponent, byFabric, totalWastage, totalJobwork, snapshots] = await repo.summary({ from, to });
    const total_spend = byComponent.rows.reduce((s, r) => s + parseFloat(r.total_rs), 0);
    return {
      byComponent: byComponent.rows, byFabric: byFabric.rows,
      total_spend_rs: total_spend.toFixed(2),
      wastage_rs: parseFloat(totalWastage.rows[0].wastage_rs).toFixed(2),
      jobwork_rs: parseFloat(totalJobwork.rows[0].jobwork_rs).toFixed(2),
      snapshots: snapshots.rows,
    };
  },

  async fgCost(id) {
    const fg = await repo.fgWithBatch(id);
    if (!fg.rows.length) return { notFound: true };
    const f = fg.rows[0];
    const costs = f.batch_id ? await repo.fgBatchCost(f.batch_id) : { rows: [{ total: 0 }] };
    const total_cost_rs = parseFloat(costs.rows[0]?.total || 0);
    const cost_per_kg = f.weight_kg > 0 ? (total_cost_rs / f.weight_kg).toFixed(2) : null;
    return { row: { fg: f, total_cost_rs: total_cost_rs.toFixed(2), cost_per_kg } };
  },

  async ask(question) {
    if (!question) return { badRequest: 'question required' };
    const [rates, summary, fabrics, knitRates, variance] = await repo.askContext();
    const dataUsed = { rates: rates.rows, last30Days: summary.rows, byFabric: fabrics.rows, knittingRates: knitRates.rows, machineVariance: variance.rows };
    const context = `
${tenant.name} — Cost Data (last 30 days):

YARN RATES:
${rates.rows.map(r => `  ${r.yarn_type}: â‚¹${r.price_per_kg}/kg`).join('\n')}

COST BREAKDOWN (last 30 days):
${summary.rows.map(r => `  ${r.cost_component}: â‚¹${r.total_rs} (${r.total_kg}kg)`).join('\n') || '  No cost entries yet'}

COST PER KG BY FABRIC:
${fabrics.rows.map(r => `  ${r.fabric_type}: â‚¹${r.cost_per_kg}/kg (${r.kg}kg produced)`).join('\n') || '  No data yet'}

KNITTING RATES (from Item Master, standard loss %):
${knitRates.rows.map(r => `  ${r.item_code} ${r.item_name}: â‚¹${r.knitting_rate_per_kg}/kg (std loss ${r.standard_loss_pct}%)`).join('\n') || '  No rates set'}

KNITTING LOSS BY MACHINE (last 30 days, yarn issued vs fabric out):
${variance.rows.map(r => `  ${r.machine_name || r.machine_id}: issued ${r.yarn_issued_kg}kg, fabric ${r.fabric_out_kg}kg, loss ${r.actual_loss_kg}kg`).join('\n') || '  No yarn issues yet'}
`;
    const answer = await callOllama(
      `You are a costing assistant for ${tenant.name}, a circular knitting factory in India. Answer in plain English with specific â‚¹ numbers from the data provided. Be concise â€" 2-4 sentences max.`,
      `${context}\n\nQuestion: ${question}`
    );
    return { row: { answer, data_used: dataUsed, model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile' } };
  },
});
