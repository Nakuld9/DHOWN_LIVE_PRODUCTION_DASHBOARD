import React, { useEffect, useState } from "react";

const COLORS = ["var(--crit)", "var(--gold)", "var(--purple)", "var(--green)", "var(--muted)"];

const DowntimeSummary = () => {
  const [stats, setStats] = useState(null);
  const [legacy, setLegacy] = useState(null);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    try {
      const [statsRes, legacyRes] = await Promise.all([
        fetch("/api/downtime/stats"),
        fetch("/api/analytics/top-downtime?days=7"),
      ]);
      setStats(await statsRes.json());
      setLegacy(await legacyRes.json());
    } catch (err) {
      console.error("DowntimeSummary:", err);
    }
  };

  const reasons = stats?.top_reasons || legacy?.reasons || [];

  return (
    <div style={{ background: "var(--surface)", borderRadius: "12px", padding: "20px", color: "white", border: "1px solid var(--border)" }}>
      {/* KPI row */}
      {stats && (
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
          <KpiMini label="Open" value={stats.open_count} color={stats.open_count > 0 ? "var(--crit)" : "var(--green)"} />
          <KpiMini label="Today Min" value={Math.round(stats.today_minutes)} color="var(--gold)" />
          <KpiMini label="Today Events" value={stats.today_incidents} color="var(--link)" />
          <KpiMini label="Pending" value={stats.pending_reason_count} color={stats.pending_reason_count > 0 ? "var(--purple)" : "var(--muted)"} />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "12px" }}>
        <h3 style={{ margin: 0, fontSize: "17px" }}>Top Downtime Reasons</h3>
        <span style={{ fontSize: "13px", color: "var(--muted)" }}>Last 7 days</span>
      </div>

      {!stats && !legacy ? (
        <div style={{ color: "var(--muted)", fontSize: "16px" }}>Loading...</div>
      ) : reasons.length === 0 ? (
        <div style={{ color: "var(--green)", fontSize: "16px" }}>No downtime recorded today</div>
      ) : (
        reasons.map((r, i) => {
          const maxMins = parseFloat(reasons[0]?.total_minutes || 1);
          const pct = Math.round((parseFloat(r.total_minutes) / maxMins) * 100);
          const displayPct = r.percentage ?? pct;
          return (
            <div key={i} style={{ marginBottom: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px", marginBottom: "3px" }}>
                <span>{r.reason || "Unknown"}</span>
                <span style={{ color: COLORS[i % COLORS.length], fontWeight: "bold" }}>{displayPct}%</span>
              </div>
              <div style={{ height: "6px", background: "var(--surface)", borderRadius: "4px", overflow: "hidden" }}>
                <div style={{ width: `${displayPct}%`, height: "100%", background: COLORS[i % COLORS.length], borderRadius: "4px" }} />
              </div>
              <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
                {Math.round(parseFloat(r.total_minutes))} min — {r.occurrences || r.occurrences} event{r.occurrences !== 1 ? "s" : ""}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

function KpiMini({ label, value, color }) {
  return (
    <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 10px", textAlign: "center" }}>
      <div style={{ color, fontSize: "26px", fontWeight: "bold", lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "3px" }}>{label}</div>
    </div>
  );
}

export default DowntimeSummary;
