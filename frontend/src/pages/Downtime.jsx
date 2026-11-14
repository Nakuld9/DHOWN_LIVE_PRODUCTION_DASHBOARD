import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";

const BASE = "";
const TODAY = new Date().toISOString().slice(0, 10);

const PRESET_REASONS = [
  "Yarn Break", "Needle Break", "Power Failure", "Maintenance",
  "Operator Absent", "Quality Issue", "Machine Cleaning", "Changeover",
];

const SOURCE_BADGE = {
  AUTO:   { bg: "var(--border)", color: "var(--link)", label: "AUTO" },
  MANUAL: { bg: "var(--green-dim)", color: "var(--green)", label: "MANUAL" },
};

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "20px",
  marginBottom: "20px",
};

const inputStyle = {
  padding: "9px 12px",
  background: "var(--surface)",
  color: "white",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontSize: "16px",
};

const TAB_STYLE = (active) => ({
  padding: "8px 20px",
  borderRadius: "6px",
  border: active ? "1px solid var(--gold)" : "1px solid var(--border)",
  background: active ? "var(--yellow)" : "var(--surface)",
  color: active ? "black" : "var(--muted)",
  cursor: "pointer",
  fontWeight: active ? "bold" : "normal",
  fontSize: "16px",
});

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-');
}

function LiveTimer({ startTime }) {
  const [mins, setMins] = useState(
    Math.round((Date.now() - new Date(startTime)) / 60000)
  );
  useEffect(() => {
    const t = setInterval(() => {
      setMins(Math.round((Date.now() - new Date(startTime)) / 60000));
    }, 30000);
    return () => clearInterval(t);
  }, [startTime]);
  return <span>{mins} min</span>;
}

export default function Downtime() {
  const [tab, setTab]               = useState("overview");
  const [stats, setStats]           = useState(null);
  const [openDt, setOpenDt]         = useState([]);
  const [history, setHistory]       = useState([]);
  const [machines, setMachines]     = useState([]);
  const [reasons, setReasons]       = useState(PRESET_REASONS);
  const [msg, setMsg]               = useState("");
  const [msgType, setMsgType]       = useState("ok");

  // Manual entry form
  const [manMachineId, setManMachineId] = useState("");
  const [manReason, setManReason]       = useState("");
  const [manStarting, setManStarting]   = useState(false);

  // History filters
  const [fDate,   setFDate]   = useState(TODAY);
  const [fMach,   setFMach]   = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fSource, setFSource] = useState("");

  // Reason assignment (pending records)
  const [assigning, setAssigning] = useState({}); // id → selected reason

  const showMsg = (text, type = "ok") => {
    setMsg(text); setMsgType(type);
    setTimeout(() => setMsg(""), 4000);
  };

  const loadOverview = useCallback(async () => {
    try {
      const [sRes, oRes] = await Promise.all([
        fetch(`${BASE}/api/downtime/stats`),
        fetch(`${BASE}/api/downtime/open`),
      ]);
      setStats(await sRes.json());
      setOpenDt(await oRes.json());
    } catch (err) { console.error(err); }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (fDate)   params.append("date", fDate);
      if (fMach)   params.append("machine_id", fMach);
      if (fStatus) params.append("status", fStatus);
      if (fSource) params.append("source", fSource);
      const r = await fetch(`${BASE}/api/downtime?${params}`);
      setHistory(await r.json());
    } catch (err) { console.error(err); }
  }, [fDate, fMach, fStatus, fSource]);

  const loadMachines = async () => {
    try {
      const r = await fetch(`${BASE}/api/machines`);
      setMachines(await r.json());
    } catch (err) { console.error(err); }
  };

  const loadReasons = async () => {
    try {
      const r = await fetch(`${BASE}/api/settings`);
      const s = await r.json();
      if (s.downtime_reasons) {
        const parsed = s.downtime_reasons.split("\n").map(x => x.trim()).filter(Boolean);
        if (parsed.length > 0) setReasons(parsed);
      }
    } catch (err) { /* use defaults */ }
  };

  useEffect(() => {
    loadOverview();
    loadMachines();
    loadReasons();
    const iv = setInterval(loadOverview, 10000);
    return () => clearInterval(iv);
  }, [loadOverview]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  // Assign reason to pending record
  const assignReason = async (id) => {
    const reason = assigning[id];
    if (!reason) { showMsg("Select a reason first", "err"); return; }
    try {
      const r = await fetch(`${BASE}/api/downtime/${id}/reason`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const d = await r.json();
      if (d.error) { showMsg("Error: " + d.error, "err"); return; }
      showMsg("Reason assigned successfully");
      setAssigning(prev => { const n = { ...prev }; delete n[id]; return n; });
      loadOverview();
    } catch (err) { showMsg("Failed: " + err.message, "err"); }
  };

  // Manual close
  const closeDowntime = async (id) => {
    try {
      await fetch(`${BASE}/api/downtime/${id}/close`, { method: "PUT" });
      showMsg("Downtime closed");
      loadOverview();
      if (tab === "history") loadHistory();
    } catch (err) { showMsg("Failed: " + err.message, "err"); }
  };

  // Start manual downtime
  const startManual = async () => {
    if (!manMachineId) { showMsg("Select a machine", "err"); return; }
    setManStarting(true);
    try {
      const r = await fetch(`${BASE}/api/downtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machine_id: manMachineId, reason: manReason || "Manual Entry" }),
      });
      const d = await r.json();
      if (d.error) { showMsg("Error: " + d.error, "err"); }
      else { showMsg("Manual downtime started"); setManMachineId(""); setManReason(""); loadOverview(); }
    } catch (err) { showMsg("Failed: " + err.message, "err"); }
    setManStarting(false);
  };

  const pendingCount = openDt.filter(d => d.reason === "Reason Pending").length;

  return (
    <div style={{ padding: "24px", color: "white", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <h1 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: 0, fontSize: "34px" }}>DOWNTIME MONITOR</h1>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px var(--green)" }} />
          <span style={{ color: "var(--muted)", fontSize: "14px" }}>Auto-detection active · refreshes every 10s</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        {["overview", "history", "manual"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={TAB_STYLE(tab === t)}>
            {t === "overview" ? "Overview" : t === "history" ? "History" : "Manual Entry"}
          </button>
        ))}
      </div>

      {/* Global message */}
      {msg && (
        <div style={{
          background: msgType === "err" ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
          border: `1px solid ${msgType === "err" ? "var(--crit)" : "var(--green)"}`,
          padding: "10px 16px", borderRadius: "8px", marginBottom: "16px",
          color: msgType === "err" ? "var(--crit)" : "var(--green)", fontSize: "17px",
        }}>{msg}</div>
      )}

      {/* ────────────────── OVERVIEW TAB ────────────────── */}
      {tab === "overview" && (
        <>
          {/* KPI Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px", marginBottom: "20px" }}>
            <KpiCard label="Open Downtimes"      value={stats?.open_count ?? "—"}          color="var(--crit)" />
            <KpiCard label="Today's Minutes"     value={stats ? Math.round(stats.today_minutes) : "—"} color="var(--gold)" unit="min" />
            <KpiCard label="Today's Incidents"   value={stats?.today_incidents ?? "—"}      color="var(--link)" />
            <KpiCard label="Pending Reasons"     value={pendingCount}                       color="var(--purple)" blink={pendingCount > 0} />
          </div>

          {/* Open Downtime Cards */}
          {openDt.length === 0 ? (
            <div style={{ ...card, textAlign: "center", padding: "32px" }}>
              <div style={{ color: "var(--green)", fontSize: "22px", fontWeight: "bold", marginBottom: "8px" }}>All machines running normally</div>
              <div style={{ color: "var(--muted)", fontSize: "16px" }}>No open downtime records</div>
            </div>
          ) : (
            <div style={{ ...card }}>
              <h3 style={{ color: "var(--yellow)", marginTop: 0, marginBottom: "14px" }}>
                Open Downtimes ({openDt.length})
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "12px" }}>
                {openDt.map(d => {
                  const isPending = d.reason === "Reason Pending";
                  const src = SOURCE_BADGE[d.source] || SOURCE_BADGE.MANUAL;
                  return (
                    <div key={d.id} style={{
                      background: "var(--surface)",
                      border: `1px solid ${isPending ? "var(--gold)" : "var(--crit)"}`,
                      borderRadius: "10px",
                      padding: "16px",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                        <div>
                          <div style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: "19px" }}>
                            {d.machine_name || d.machine_id}
                          </div>
                          <div style={{ color: "var(--muted)", fontSize: "13px" }}>{d.machine_type} · Shift {d.shift || "?"}</div>
                        </div>
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <span style={{ background: src.bg, color: src.color, padding: "2px 8px", borderRadius: "10px", fontSize: "13px", fontWeight: "bold" }}>
                            {src.label}
                          </span>
                          <span style={{ background: "var(--surface)", color: "var(--crit)", padding: "2px 8px", borderRadius: "10px", fontSize: "14px", fontWeight: "bold" }}>
                            <LiveTimer startTime={d.start_time} />
                          </span>
                        </div>
                      </div>

                      {/* Reason display or assignment */}
                      {isPending ? (
                        <div style={{ marginBottom: "10px" }}>
                          <div style={{ color: "var(--gold)", fontSize: "14px", marginBottom: "6px", fontWeight: "bold" }}>
                            Reason Pending — assign:
                          </div>
                          <div style={{ display: "flex", gap: "6px" }}>
                            <select
                              style={{ ...inputStyle, flex: 1 }}
                              value={assigning[d.id] || ""}
                              onChange={e => setAssigning(prev => ({ ...prev, [d.id]: e.target.value }))}
                            >
                              <option value="">Select reason…</option>
                              {reasons.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button
                              onClick={() => assignReason(d.id)}
                              style={{ background: "var(--yellow)", color: "black", border: "none", padding: "6px 14px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", fontSize: "14px" }}
                            >Assign</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: "white", fontSize: "17px", marginBottom: "10px", fontWeight: "bold" }}>
                          {d.reason}
                        </div>
                      )}

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--muted)", fontSize: "13px" }}>
                          Started: {fmtTime(d.start_time)}
                        </span>
                        <button
                          onClick={() => closeDowntime(d.id)}
                          style={{ background: "var(--green-dim)", color: "var(--green)", border: "1px solid #22c55e44", padding: "4px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "14px" }}
                        >Close</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Analytics: Top Reasons + Machine Ranking */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            {/* Top Reasons */}
            <div style={card}>
              <h3 style={{ color: "var(--yellow)", marginTop: 0 }}>Today's Top Reasons</h3>
              {!stats || stats.top_reasons.length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: "16px" }}>No downtime today</div>
              ) : (
                stats.top_reasons.map((r, i) => {
                  const COLORS = ["var(--crit)", "var(--gold)", "var(--purple)", "var(--green)", "var(--muted)", "var(--purple)", "var(--link)", "var(--idle)"];
                  const maxMins = stats.top_reasons[0]?.total_minutes || 1;
                  const pct = Math.round((parseFloat(r.total_minutes) / parseFloat(maxMins)) * 100);
                  return (
                    <div key={r.reason} style={{ marginBottom: "12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px", marginBottom: "4px" }}>
                        <span style={{ color: "white" }}>{r.reason}</span>
                        <span style={{ color: COLORS[i % COLORS.length], fontWeight: "bold" }}>{r.total_minutes} min</span>
                      </div>
                      <div style={{ height: "6px", background: "var(--surface)", borderRadius: "4px", overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: COLORS[i % COLORS.length], borderRadius: "4px" }} />
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--muted)", marginTop: "2px" }}>
                        {r.occurrences} incident{r.occurrences !== 1 ? "s" : ""}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Machine Ranking */}
            <div style={card}>
              <h3 style={{ color: "var(--yellow)", marginTop: 0 }}>Machine Downtime Ranking (Today)</h3>
              {!stats || stats.machine_ranking.length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: "16px" }}>No downtime today</div>
              ) : (
                stats.machine_ranking.map((m, i) => {
                  const maxMins = parseFloat(stats.machine_ranking[0]?.total_minutes || 1);
                  const pct = Math.round((parseFloat(m.total_minutes) / maxMins) * 100);
                  return (
                    <div key={m.machine_id} style={{ marginBottom: "10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px", marginBottom: "4px" }}>
                        <span style={{ color: "var(--yellow)", fontWeight: "bold" }}>{m.machine_name}</span>
                        <span style={{ color: "var(--crit)" }}>{m.total_minutes} min · {m.incidents} events</span>
                      </div>
                      <div style={{ height: "6px", background: "var(--surface)", borderRadius: "4px", overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: i === 0 ? "var(--crit)" : i === 1 ? "var(--gold)" : "var(--purple)", borderRadius: "4px" }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* ────────────────── HISTORY TAB ────────────────── */}
      {tab === "history" && (
        <div style={card}>
          <h3 style={{ color: "var(--yellow)", marginTop: 0 }}>Downtime History</h3>

          {/* Filters */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
            <div>
              <div style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "4px" }}>Date</div>
              <input type="date" style={inputStyle} value={fDate} onChange={e => setFDate(e.target.value)} />
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "4px" }}>Machine</div>
              <select style={inputStyle} value={fMach} onChange={e => setFMach(e.target.value)}>
                <option value="">All Machines</option>
                {machines.map(m => <option key={m.machine_id} value={m.machine_id}>{m.machine_name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "4px" }}>Status</div>
              <select style={inputStyle} value={fStatus} onChange={e => setFStatus(e.target.value)}>
                <option value="">All</option>
                <option value="OPEN">Open</option>
                <option value="CLOSED">Closed</option>
              </select>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "4px" }}>Source</div>
              <select style={inputStyle} value={fSource} onChange={e => setFSource(e.target.value)}>
                <option value="">All</option>
                <option value="AUTO">Auto</option>
                <option value="MANUAL">Manual</option>
              </select>
            </div>
            <div style={{ alignSelf: "flex-end" }}>
              <button onClick={loadHistory} style={{ ...inputStyle, background: "var(--surface)", color: "var(--yellow)", border: "1px solid var(--gold)", cursor: "pointer" }}>
                Refresh
              </button>
            </div>
          </div>

          {/* Summary line */}
          {history.length > 0 && (
            <div style={{ color: "var(--muted)", fontSize: "14px", marginBottom: "12px" }}>
              {history.length} records ·&nbsp;
              {Math.round(history.reduce((s, d) => s + parseFloat(d.current_minutes || d.duration_minutes || 0), 0))} total minutes
            </div>
          )}

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table width="100%" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Machine", "Reason", "Source", "Shift", "Start", "End", "Duration", "Status", "Action"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--yellow)", fontSize: "14px", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr><td colSpan="9" style={{ padding: "20px", color: "var(--muted)", fontStyle: "italic" }}>No records found</td></tr>
                ) : (
                  history.map(d => {
                    const src = SOURCE_BADGE[d.source] || SOURCE_BADGE.MANUAL;
                    const isPending = d.reason === "Reason Pending";
                    return (
                      <tr key={d.id} style={{ borderBottom: "1px solid var(--surface)" }}>
                        <td style={{ padding: "8px 10px" }}>
                          <Link to={`/machine/${d.machine_id}`} style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: "16px" }}>
                            {d.machine_name || d.machine_id}
                          </Link>
                        </td>
                        <td style={{ padding: "8px 10px", color: isPending ? "var(--gold)" : "white", fontSize: "16px" }}>
                          {d.reason || "—"}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <span style={{ background: src.bg, color: src.color, padding: "2px 8px", borderRadius: "10px", fontSize: "13px", fontWeight: "bold" }}>
                            {src.label}
                          </span>
                        </td>
                        <td style={{ padding: "8px 10px", color: "var(--muted)", fontSize: "14px" }}>{d.shift || "—"}</td>
                        <td style={{ padding: "8px 10px", color: "var(--muted)", fontSize: "14px", whiteSpace: "nowrap" }}>{fmtTime(d.start_time)}</td>
                        <td style={{ padding: "8px 10px", color: "var(--muted)", fontSize: "14px", whiteSpace: "nowrap" }}>{fmtTime(d.end_time)}</td>
                        <td style={{ padding: "8px 10px", color: d.status === "OPEN" ? "var(--crit)" : "white", fontWeight: "bold", fontSize: "16px" }}>
                          {Math.round(parseFloat(d.current_minutes || 0))} min
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <span style={{
                            background: d.status === "OPEN" ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
                            color: d.status === "OPEN" ? "var(--crit)" : "var(--green)",
                            padding: "2px 8px", borderRadius: "10px", fontSize: "13px",
                          }}>
                            {d.status || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ display: "flex", gap: "6px" }}>
                            {d.status === "OPEN" && (
                              <button
                                onClick={() => closeDowntime(d.id)}
                                style={{ background: "var(--green-dim)", color: "var(--green)", border: "none", padding: "4px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "13px" }}
                              >Close</button>
                            )}
                            {isPending && d.status === "OPEN" && (
                              <button
                                onClick={() => { setTab("overview"); }}
                                style={{ background: "var(--crit-dim)", color: "var(--gold)", border: "none", padding: "4px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "13px" }}
                              >Assign</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ────────────────── MANUAL ENTRY TAB ────────────────── */}
      {tab === "manual" && (
        <div style={{ ...card, border: "1px solid var(--border)" }}>
          <h3 style={{ color: "var(--yellow)", marginTop: 0 }}>Manual Downtime Entry</h3>
          <p style={{ color: "var(--muted)", fontSize: "16px", marginBottom: "20px" }}>
            Use this only when automatic detection is insufficient or for planned stops.
            Automatic detection handles most cases — set reason via the Overview tab.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", maxWidth: "600px" }}>
            <div>
              <label style={{ color: "var(--muted)", fontSize: "16px", display: "block", marginBottom: "6px" }}>Machine *</label>
              <select
                style={{ ...inputStyle, width: "100%" }}
                value={manMachineId}
                onChange={e => setManMachineId(e.target.value)}
              >
                <option value="">Select Machine</option>
                {machines.map(m => (
                  <option key={m.machine_id} value={m.machine_id}>{m.machine_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ color: "var(--muted)", fontSize: "16px", display: "block", marginBottom: "6px" }}>Reason</label>
              <select
                style={{ ...inputStyle, width: "100%" }}
                value={manReason}
                onChange={e => setManReason(e.target.value)}
              >
                <option value="">Select Reason (optional)</option>
                {reasons.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>

          <button
            onClick={startManual}
            disabled={manStarting || !manMachineId}
            style={{
              marginTop: "20px",
              background: manStarting || !manMachineId ? "var(--border)" : "var(--crit)",
              color: "white",
              border: "none",
              padding: "12px 28px",
              borderRadius: "8px",
              cursor: manStarting || !manMachineId ? "not-allowed" : "pointer",
              fontWeight: "bold",
              fontSize: "17px",
            }}
          >
            {manStarting ? "Starting..." : "Start Manual Downtime"}
          </button>

          <div style={{ marginTop: "20px", padding: "14px", background: "rgba(244,174,31,0.07)", border: "1px solid rgba(244,174,31,0.2)", borderRadius: "8px" }}>
            <div style={{ color: "var(--yellow)", fontSize: "16px", fontWeight: "bold", marginBottom: "6px" }}>Auto-detection is primary</div>
            <div style={{ color: "var(--muted)", fontSize: "14px", lineHeight: "1.6" }}>
              When RPM = 0 and machine is confirmed STOPPED for the configured threshold (default: 2 minutes),
              a downtime record is created automatically with "Reason Pending".
              Supervisors assign reasons from the Overview tab.
              Manual entry is for planned maintenance, shift changes, or cases not captured by DC data.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, color, unit = "", blink = false }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: `1px solid ${color}33`,
      borderRadius: "12px",
      padding: "18px 20px",
    }}>
      <div style={{ color: "var(--muted)", fontSize: "14px", marginBottom: "8px" }}>{label}</div>
      <div style={{
        color,
        fontSize: "43px",
        fontWeight: "bold",
        lineHeight: 1,
        animation: blink && value > 0 ? "none" : undefined,
      }}>
        {value}{unit && <span style={{ fontSize: "19px", marginLeft: "4px" }}>{unit}</span>}
      </div>
    </div>
  );
}
