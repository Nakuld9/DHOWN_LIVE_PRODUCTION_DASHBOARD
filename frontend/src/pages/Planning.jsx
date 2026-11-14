// Planning — yarn requirement (MRP-lite). Shows what yarn the open order book needs,
// what's on hand and on order, and the shortfall to buy.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "9px 12px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase" };
const td = { padding: "9px 12px", fontSize: 13, borderTop: "1px solid var(--surface)" };
const numTd = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const kg = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const Tile = ({ label, value, color }) => (
  <div style={{ ...card, padding: "12px 16px" }}>
    <div style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    <div style={{ color: color || "var(--yellow)", fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}</div>
  </div>
);

export default function Planning() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr(""); setLoading(true);
    try {
      const r = await fetch(`${API}/api/planning/yarn-requirement`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setData(j);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const lines = data?.lines || [];

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Planning — Yarn Requirement</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        The open order book exploded through the BOM, netted against yarn on hand and on order. Shortfall is what to buy.
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}

      {loading ? <div style={{ ...card, textAlign: "center", color: "var(--muted)", padding: 30 }}>Loading…</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
            <Tile label="Yarns planned" value={data?.count || 0} />
            <Tile label="Total required" value={`${kg(data?.total_required_kg || 0)} kg`} />
            <Tile label="Short items" value={data?.short_items || 0} color={data?.short_items ? "var(--crit)" : "var(--green)"} />
            <Tile label="Total shortfall" value={`${kg(data?.total_shortfall_kg || 0)} kg`} color={data?.total_shortfall_kg ? "var(--crit)" : "var(--green)"} />
          </div>

          <div style={card}>
            {data?.note && <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 8 }}>{data.note}</div>}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                <thead><tr>
                  <th style={th}>Yarn</th>
                  <th style={{ ...th, textAlign: "right" }}>Required</th>
                  <th style={{ ...th, textAlign: "right" }}>On hand</th>
                  <th style={{ ...th, textAlign: "right" }}>On order</th>
                  <th style={{ ...th, textAlign: "right" }}>Shortfall</th>
                </tr></thead>
                <tbody>
                  {!lines.length && <tr><td colSpan={5} style={{ ...td, color: "var(--muted)" }}>Nothing to plan.</td></tr>}
                  {lines.map(l => (
                    <tr key={l.yarn_item_id} style={{ background: l.shortfall_kg > 0 ? "rgba(239,68,68,0.06)" : "transparent" }}>
                      <td style={{ ...td, color: "var(--text)", fontWeight: 600 }}>{l.yarn}</td>
                      <td style={numTd}>{kg(l.required_kg)}</td>
                      <td style={numTd}>{kg(l.on_hand_kg)}</td>
                      <td style={numTd}>{kg(l.on_order_kg)}</td>
                      <td style={{ ...numTd, color: l.shortfall_kg > 0 ? "var(--crit)" : "var(--green)", fontWeight: 700 }}>
                        {l.shortfall_kg > 0 ? kg(l.shortfall_kg) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 12 }}>
            Gross demand on all open sales orders (not time-phased). Shortfall = required − on hand − on order.
          </div>
        </>
      )}
    </div>
  );
}
