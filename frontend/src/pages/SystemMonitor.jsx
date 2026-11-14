// System Monitor — health at a glance + grouped, resolvable error tracking.
// Polls /api/monitor/status every 20s. Ops data (SUPERVISOR+).

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const dt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-") : "—");
const dur = (s) => { s = Number(s) || 0; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return (d ? d + "d " : "") + (h ? h + "h " : "") + m + "m"; };

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--border)", verticalAlign: "top" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "5px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" });
const OVERALL = { ok: ["var(--green)", "All systems normal"], warning: ["var(--gold)", "Needs attention"], critical: ["var(--crit)", "Critical"] };

export default function SystemMonitor() {
  const [s, setS] = useState(null);
  const [errs, setErrs] = useState([]);
  const [showResolved, setShowResolved] = useState(false);
  const [err, setErr] = useState("");
  const [ci, setCi] = useState(null);
  const [ciBusy, setCiBusy] = useState(false);

  const loadStatus = useCallback(() => {
    fetch(`${API}/api/monitor/status`, { headers: auth() }).then(r => r.ok ? r.json() : Promise.reject(r)).then(setS).catch(() => setErr("Could not load status (SUPERVISOR+ required)."));
  }, []);
  const loadErrs = useCallback(() => {
    fetch(`${API}/api/monitor/errors?resolved=${showResolved}`, { headers: auth() }).then(r => r.ok ? r.json() : []).then(d => setErrs(Array.isArray(d) ? d : [])).catch(() => {});
  }, [showResolved]);

  const loadCi = useCallback(() => {
    fetch(`${API}/api/monitor/ci`, { headers: auth() }).then(r => r.ok ? r.json() : null).then(setCi).catch(() => {});
  }, []);
  useEffect(() => { loadStatus(); loadErrs(); loadCi(); const t = setInterval(() => { loadStatus(); loadErrs(); loadCi(); }, 20000); return () => clearInterval(t); }, [loadStatus, loadErrs, loadCi]);

  const resolve = async (id, resolved) => {
    await fetch(`${API}/api/monitor/errors/${id}/resolve`, { method: "POST", headers: jsonH(), body: JSON.stringify({ resolved }) });
    loadErrs(); loadStatus();
  };
  const runCi = async () => {
    setCiBusy(true);
    const r = await fetch(`${API}/api/monitor/ci/run`, { method: "POST", headers: jsonH(), body: "{}" });
    if (!r.ok) { const o = await r.json().catch(() => ({})); alert(o.error || "Could not start (ADMIN only)"); }
    setTimeout(() => { loadCi(); setCiBusy(false); }, 3000);
  };

  const [ocolor, otext] = OVERALL[s?.overall] || OVERALL.ok;
  const tiles = s ? [
    ["Overall", otext, ocolor],
    ["Uptime", dur(s.uptime_s), "var(--text)"],
    ["Database", s.database?.ok ? `OK · ${s.database.latency_ms}ms` : "DOWN", s.database?.ok ? (s.database.latency_ms > 500 ? "var(--gold)" : "var(--green)") : "var(--crit)"],
    ["Errors (24h)", String(s.errors?.last_24h ?? 0), (s.errors?.last_24h > 0 ? "var(--gold)" : "var(--green)")],
    ["Open error groups", String(s.errors?.open_groups ?? 0), (s.errors?.open_groups > 0 ? "var(--gold)" : "var(--green)")],
    ["DB backup", s.backup?.ok ? `${s.backup.age_hours}h ago` : (s.backup?.stale ? "STALE" : "—"), s.backup?.ok ? "var(--green)" : "var(--crit)"],
  ] : [];

  return (
    <div style={{ padding: 20, color: "var(--text)", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase" }}>🩺 System Monitor</h2>
        {s && <span style={{ fontSize: 12, color: "var(--muted)" }}>updated {dt(s.generated_at)} · auto-refresh 20s</span>}
      </div>
      {err && <div style={{ color: "var(--crit)", fontSize: 13 }}>{err}</div>}

      {/* Health tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
        {tiles.map(([t, v, c]) => (
          <div key={t} style={{ ...card, padding: 13, borderColor: c === "var(--crit)" ? "var(--crit)" : "var(--border)" }}>
            <div style={label}>{t}</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 5, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* AI providers */}
      {s?.ai_providers && Object.keys(s.ai_providers).length > 0 && (
        <div style={card}>
          <div style={{ ...label, marginBottom: 8 }}>AI providers</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {Object.entries(s.ai_providers).map(([name, p]) => (
              <div key={name} style={{ fontSize: 13 }}>
                <span style={{ color: (p.fail > p.ok ? "var(--crit)" : "var(--green)") }}>●</span> <b>{name}</b>
                <span style={{ color: "var(--muted)" }}> ok {p.ok || 0} / fail {p.fail || 0}{p.lastMs != null ? ` · ${p.lastMs}ms` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CI / tests */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
          <div style={label}>CI — full test suite</div>
          <button onClick={runCi} disabled={ciBusy || ci?.running} style={{ ...btn("var(--yellow)", "#000"), opacity: (ciBusy || ci?.running) ? 0.5 : 1 }}>
            {ci?.running ? "Running…" : ciBusy ? "Starting…" : "▶ Run tests now"}
          </button>
        </div>
        {ci?.latest ? (() => {
          const l = ci.latest;
          const c = l.overall === "pass" ? "var(--green)" : l.overall === "running" ? "var(--gold)" : "var(--crit)";
          return (
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
              <div><div style={label}>Last run</div><div style={{ fontSize: 18, fontWeight: 800, color: c, marginTop: 4 }}>{(l.overall || "—").toUpperCase()}</div></div>
              <div><div style={label}>Unit</div><div style={{ fontSize: 15, marginTop: 4 }}>{l.unit_pass}/{l.unit_total}</div></div>
              <div><div style={label}>E2E</div><div style={{ fontSize: 15, marginTop: 4 }}>{l.e2e_pass}/{l.e2e_total}{l.e2e_fail ? <span style={{ color: "var(--crit)" }}> · {l.e2e_fail} failed</span> : ""}</div></div>
              <div><div style={label}>Duration</div><div style={{ fontSize: 15, marginTop: 4 }}>{l.duration_ms ? Math.round(l.duration_ms / 1000) + "s" : "—"}</div></div>
              <div><div style={label}>When · by</div><div style={{ fontSize: 13, marginTop: 4, color: "var(--muted)" }}>{dt(l.finished_at || l.started_at)} · {l.trigger}</div></div>
              {Array.isArray(l.failed_suites) && l.failed_suites.length > 0 &&
                <div style={{ color: "var(--crit)", fontSize: 13 }}>Failed: {l.failed_suites.join(", ")}</div>}
            </div>
          );
        })() : <div style={{ color: "var(--muted)", fontSize: 13 }}>No CI run yet. Click “Run tests now”.</div>}
        {ci?.history?.length > 1 && (
          <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
            {ci.history.slice().reverse().map(h => (
              <span key={h.run_id} title={`run ${h.run_id} · ${h.overall} · ${dt(h.started_at)}`}
                style={{ width: 14, height: 22, borderRadius: 3, background: h.overall === "pass" ? "var(--green)" : h.overall === "running" ? "var(--gold)" : "var(--crit)" }} />
            ))}
          </div>
        )}
      </div>

      {/* Errors */}
      <div style={{ ...card, overflowX: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
          <div style={label}>Errors — grouped by signature</div>
          <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> show resolved
          </label>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead><tr>{["Where", "Message", "Kind", "Count", "Last seen", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {!errs.length && <tr><td colSpan={6} style={{ ...td, color: "var(--muted)" }}>{showResolved ? "No resolved errors." : "No open errors 🎉"}</td></tr>}
            {errs.map(e => (
              <tr key={e.error_id} style={{ opacity: e.resolved ? 0.6 : 1 }}>
                <td style={{ ...td, fontFamily: "var(--mono)", fontSize: 12, whiteSpace: "nowrap" }}>{e.method || ""} {e.path || e.kind}</td>
                <td style={{ ...td, maxWidth: 360 }}>{e.message}</td>
                <td style={td}>{e.kind}</td>
                <td style={{ ...td, fontWeight: 700, color: e.occurrences > 10 ? "var(--gold)" : "var(--text)" }}>{e.occurrences}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{dt(e.last_seen)}</td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                  {e.resolved
                    ? <button onClick={() => resolve(e.error_id, false)} style={btn("var(--bg)", "var(--muted)")}>Reopen</button>
                    : <button onClick={() => resolve(e.error_id, true)} style={btn("var(--bg)", "var(--green)")}>Resolve</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
