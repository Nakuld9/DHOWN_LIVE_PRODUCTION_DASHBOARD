import React, { useEffect, useState } from "react";

const COLORS = ["#ef4444", "#f59e0b", "#6366f1", "#22c55e", "#7da2d6"];

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
        fetch("http://localhost:4000/api/downtime/stats"),
        fetch("http://localhost:4000/api/analytics/top-downtime?days=7"),
      ]);
      setStats(await statsRes.json());
      setLegacy(await legacyRes.json());
    } catch (err) {
      console.error("DowntimeSummary:", err);
    }
  };

  const reasons = stats?.top_reasons || legacy?.reasons || [];

  return (
    <div style={{ background: "#0d1b2f", borderRadius: "12px", padding: "20px", color: "white", border: "1px solid #16345d" }}>
      {/* KPI row */}
      {stats && (
        <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
          <KpiMini label="Open" value={stats.open_count} color={stats.open_count > 0 ? "#ef4444" : "#22c55e"} />
          <KpiMini label="Today Min" value={Math.round(stats.today_minutes)} color="#f59e0b" />
          <KpiMini label="Today Events" value={stats.today_incidents} color="#60a5fa" />
          <KpiMini label="Pending" value={stats.pending_reason_count} color={stats.pending_reason_count > 0 ? "#a78bfa" : "#7da2d6"} />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "12px" }}>
        <h3 style={{ margin: 0, fontSize: "17px" }}>Top Downtime Reasons</h3>
        <span style={{ fontSize: "13px", color: "#7da2d6" }}>Last 7 days</span>
      </div>

      {!stats && !legacy ? (
        <div style={{ color: "#7da2d6", fontSize: "16px" }}>Loading...</div>
      ) : reasons.length === 0 ? (
        <div style={{ color: "#22c55e", fontSize: "16px" }}>No downtime recorded today</div>
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
              <div style={{ height: "6px", background: "#16345d", borderRadius: "4px", overflow: "hidden" }}>
                <div style={{ width: `${displayPct}%`, height: "100%", background: COLORS[i % COLORS.length], borderRadius: "4px" }} />
              </div>
              <div style={{ fontSize: "13px", color: "#7da2d6", marginTop: "2px" }}>
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
    <div style={{ flex: 1, background: "#071120", border: "1px solid #16345d", borderRadius: "8px", padding: "8px 10px", textAlign: "center" }}>
      <div style={{ color, fontSize: "26px", fontWeight: "bold", lineHeight: 1 }}>{value ?? "—"}</div>
      <div style={{ color: "#7da2d6", fontSize: "12px", marginTop: "3px" }}>{label}</div>
    </div>
  );
}

export default DowntimeSummary;
