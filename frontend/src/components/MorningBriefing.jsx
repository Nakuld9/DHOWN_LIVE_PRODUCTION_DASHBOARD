// Morning Briefing — a daily owner snapshot card on the dashboard.
// Reads GET /api/briefing/today (generated once per IST day, cached server-side).
// Honest by design: a section with no data says so rather than inventing numbers.
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const token = () => localStorage.getItem("dhown_token");
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

export default function MorningBriefing() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | forbidden | error
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/briefing/today", { headers: { Authorization: `Bearer ${token()}` } });
      if (r.status === 403) { setState("forbidden"); return; }
      if (!r.ok) { setState("error"); return; }
      setData(await r.json()); setState("ok");
    } catch { setState("error"); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const regenerate = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/briefing/regenerate", { method: "POST", headers: { Authorization: `Bearer ${token()}` } });
      if (r.ok) setData(await r.json());
    } catch {} finally { setBusy(false); }
  };

  if (state === "forbidden") return null; // operators don't see finance figures

  const card = {
    background: "var(--surface)", border: "1px solid var(--gold-edge)", borderRadius: 13,
    padding: "18px 20px", marginBottom: 18, boxShadow: "var(--shadow)",
  };
  const label = { fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 6 };
  const sect = { flex: "1 1 220px", minWidth: 200, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 9, padding: "12px 14px" };
  const big = { fontSize: 22, fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" };
  const note = { fontSize: 11.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.35 };

  const d = data || {};
  const prod = d.production || {}, cash = d.cash || {}, ship = d.shipments || {}, alerts = d.alerts || {};

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18 }}>🌅</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: ".01em" }}>Morning Briefing</span>
        {d.date && <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)" }}>{d.date}</span>}
        <div style={{ flex: 1 }} />
        <button onClick={regenerate} disabled={busy}
          style={{ font: "inherit", fontSize: 11, fontWeight: 700, color: "var(--green-deep)", background: "var(--green-dim)", border: "1px solid var(--green-edge)", borderRadius: 6, padding: "5px 11px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {state === "loading" && <div style={note}>Loading today's briefing…</div>}
      {state === "error" && <div style={note}>Couldn't load the briefing right now.</div>}

      {state === "ok" && (
        <>
          <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 600, marginBottom: 14, lineHeight: 1.4 }}>
            {d.headline}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {/* Production */}
            <div style={sect}>
              <div style={label}>Production (yesterday)</div>
              {prod.available ? (
                <>
                  <div style={big}>{prod.kg} kg</div>
                  <div style={note}>{prod.rolls} roll{prod.rolls === 1 ? "" : "s"}{prod.note ? ` — ${prod.note}` : ""}</div>
                </>
              ) : <div style={note}>{prod.note || "Unavailable."}</div>}
            </div>

            {/* Cash */}
            <div style={sect}>
              <div style={label}>Bank cash</div>
              {cash.available ? (
                <>
                  <div style={big}>{inr(cash.balance)}</div>
                  <div style={note}>
                    7d in {inr(cash.in_7d)} · out {inr(cash.out_7d)}
                    {cash.as_of ? ` · as of ${new Date(cash.as_of).toLocaleDateString("en-GB").split("/").join("-")}` : ""}
                  </div>
                </>
              ) : <div style={note}>{cash.note || "Unavailable."}</div>}
            </div>

            {/* Shipments */}
            <div style={sect}>
              <div style={label}>Shipments in transit</div>
              {ship.available && ship.count ? (
                <>
                  <div style={big}>{ship.count}</div>
                  <div style={note}>
                    {ship.list.slice(0, 3).map((s) => (
                      <div key={s.import_no}>
                        <span style={{ color: "var(--link)", cursor: "pointer" }} onClick={() => nav("/import-control-tower")}>{s.import_no}</span>
                        {" · "}{s.status.replace(/_/g, " ").toLowerCase()}
                        {s.eta ? ` · ETA ${s.eta}` : ""}
                        {s.days_to_eta != null && s.days_to_eta >= 0 && s.days_to_eta <= 3
                          ? <b style={{ color: "var(--gold-deep)" }}> ({s.days_to_eta}d)</b> : ""}
                      </div>
                    ))}
                    {ship.count > 3 && <div style={{ color: "var(--faint)" }}>+{ship.count - 3} more</div>}
                  </div>
                </>
              ) : <div style={note}>No shipments in transit.</div>}
            </div>

            {/* Alerts */}
            <div style={sect}>
              <div style={label}>Needs attention</div>
              {alerts.count ? (
                <>
                  <div style={{ ...big, color: "var(--crit)" }}>{alerts.count}</div>
                  <div style={note}>
                    {alerts.list.slice(0, 3).map((a, i) => <div key={i}>• {a.text}</div>)}
                    {alerts.count > 3 && <div style={{ color: "var(--faint)" }}>+{alerts.count - 3} more</div>}
                  </div>
                </>
              ) : <div style={note}>Nothing flagged. ✅</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
