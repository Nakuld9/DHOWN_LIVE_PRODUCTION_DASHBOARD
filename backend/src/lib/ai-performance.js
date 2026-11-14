// AI performance — what the assistant is actually doing.
//
// wa_ai_actions has recorded every run since the CRM went in, and nothing read
// it. So there was no answer to the questions that decide whether the AI is
// earning its place: which tools it leans on, how often it is unsure, how often
// a human overrode it, and whether it started behaving differently after a
// prompt or model change.
//
// Everything here is read-only aggregation over that audit table. It measures
// behaviour, not quality — whether an answer was *good* is what the eval
// harness is for. This answers "what is it doing, and has that changed".

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

module.exports = (pool) => {

  async function overview({ from = null, to = null } = {}) {
    const p = [from, to];
    const WHERE = `WHERE ($1::date IS NULL OR created_at::date >= $1::date)
                     AND ($2::date IS NULL OR created_at::date <= $2::date)`;

    const totals = (await pool.query(
      `SELECT COUNT(*)::int AS runs,
              COUNT(*) FILTER (WHERE auto_sent)::int AS auto_sent,
              COUNT(*) FILTER (WHERE approved_by IS NOT NULL)::int AS human_approved,
              COUNT(DISTINCT conversation_id)::int AS conversations,
              MIN(created_at) AS first_run, MAX(created_at) AS last_run
         FROM wa_ai_actions ${WHERE}`, p)).rows[0];

    // Tool usage, unpacked from the recorded tools_called array. A tool that is
    // never chosen is either badly described to the model or unnecessary —
    // either way it is worth knowing before adding a twenty-first.
    const tools = (await pool.query(
      `SELECT t->>'tool' AS tool, COUNT(*)::int AS calls,
              COUNT(*) FILTER (WHERE (t->'result') IS NULL
                               OR (t->'result'->>'error') IS NOT NULL)::int AS failed
         FROM wa_ai_actions a
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(a.tools_called::jsonb) = 'array'
                THEN a.tools_called::jsonb ELSE '[]'::jsonb END) t
        ${WHERE.replace(/created_at/g, 'a.created_at')}
        GROUP BY 1 ORDER BY calls DESC`, p)).rows
      .map(r => ({ tool: r.tool, calls: Number(r.calls), failed: Number(r.failed) }));

    // Intent mix — what customers actually ask, which is the most useful thing
    // in here for deciding what to build next.
    const intents = (await pool.query(
      `SELECT COALESCE(interpretation::jsonb->>'intent','unknown') AS intent, COUNT(*)::int AS n
         FROM wa_ai_actions ${WHERE}
        GROUP BY 1 ORDER BY n DESC`, p)).rows
      .map(r => ({ intent: r.intent, n: Number(r.n) }));

    // Confidence, recorded since the scoring went in. Older rows have none, so
    // the count is reported separately rather than averaged over a mixed set.
    const conf = (await pool.query(
      `SELECT COUNT(*) FILTER (WHERE interpretation::jsonb ? 'confidence')::int AS scored,
              ROUND(AVG((interpretation::jsonb->>'confidence')::numeric)
                    FILTER (WHERE interpretation::jsonb ? 'confidence'), 2) AS avg_confidence,
              COUNT(*) FILTER (WHERE (interpretation::jsonb->>'confidence')::numeric < 0.6)::int AS low
         FROM wa_ai_actions ${WHERE}`, p)).rows[0];

    // Daily volume, so a change in behaviour after a prompt edit is visible
    // rather than inferred.
    const daily = (await pool.query(
      `SELECT created_at::date::text AS day, COUNT(*)::int AS runs,
              COUNT(*) FILTER (WHERE auto_sent)::int AS auto
         FROM wa_ai_actions ${WHERE}
        GROUP BY 1 ORDER BY 1 DESC LIMIT 30`, p)).rows
      .map(r => ({ day: r.day, runs: Number(r.runs), auto: Number(r.auto) }));

    const runs = Number(totals.runs);
    return {
      period: { from, to },
      totals: {
        runs,
        conversations: Number(totals.conversations),
        auto_sent: Number(totals.auto_sent),
        auto_rate: pct(Number(totals.auto_sent), runs),
        // Everything not auto-sent waited for a person. That is the design, so
        // a high number here is the system working, not failing.
        held_for_human: runs - Number(totals.auto_sent),
        first_run: totals.first_run, last_run: totals.last_run,
      },
      confidence: {
        scored: Number(conf.scored),
        unscored: runs - Number(conf.scored),
        average: conf.avg_confidence === null ? null : Number(conf.avg_confidence),
        low_confidence: Number(conf.low),
        low_rate: pct(Number(conf.low), Number(conf.scored)),
      },
      tools,
      unused_tools: [],     // filled by the caller, which knows the registry
      intents,
      daily,
      empty: runs === 0,
    };
  }

  // Tools defined but never chosen. Passed in rather than imported so this
  // module stays a pure reader of the audit table.
  function unusedTools(defined, used) {
    const seen = new Set(used.map(t => t.tool));
    return defined.filter(name => !seen.has(name));
  }

  return { overview, unusedTools };
};
