// Stock valuation, optionally as at a past date.
//
// The valuation basis is shown next to every figure rather than in a footnote,
// because the number means different things per category: yarn is at its actual
// purchase rate, while greige and finished goods are at the average yarn rate
// with no conversion cost in them. Presenting those as one clean total without
// saying so would overstate the balance sheet.
//
// A past date is reconstructed from the stock ledger, which does not go back to
// the beginning of the business. When it cannot reach, the screen says so
// loudly instead of showing a confident near-zero.

import React, { useState, useCallback, useEffect } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600 };
const td = { padding: "10px", textAlign: "left", fontSize: 13, borderTop: "1px solid var(--surface)" };
const numTd = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const input = { padding: "8px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6 };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: "pointer" });

const money = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kg = (v) => `${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`;

export default function StockValuation() {
  const [asAt, setAsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (date) => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${API}/api/reports/stock-valuation?as_at=${date}`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setD(j);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(asAt); }, [load]);   // eslint-disable-line

  const rows = d ? [
    ["Yarn", d.categories.yarn.kg, d.categories.yarn.value, d.categories.yarn.basis,
     `${d.categories.yarn.lots} lot${d.categories.yarn.lots === 1 ? "" : "s"}`],
    ["Greige", d.categories.greige.kg, d.categories.greige.value, d.categories.greige.basis,
     `${d.categories.greige.rolls} roll${d.categories.greige.rolls === 1 ? "" : "s"}`],
    ["Finished goods", d.categories.finished.kg, d.categories.finished.value, d.categories.finished.basis,
     `${d.categories.finished.lots} lot${d.categories.finished.lots === 1 ? "" : "s"}`],
  ] : [];

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Stock Valuation</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        What the stock on hand is worth. The basis differs by category and is shown against each line.
      </div>

      <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ color: "var(--muted)", fontSize: 12 }}>As at</label>
        <input type="date" style={input} value={asAt} onChange={e => setAsAt(e.target.value)} />
        <button style={btn("var(--yellow)", "#000")} disabled={loading} onClick={() => load(asAt)}>
          {loading ? "Working…" : "Value it"}
        </button>
        <button style={btn("var(--surface)", "var(--text)")}
                onClick={() => { const t = new Date().toISOString().slice(0, 10); setAsAt(t); load(t); }}>
          Today
        </button>
      </div>

      {err && <div style={{ ...card, marginTop: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}

      {d && (
        <>
          {/* Reliability before the number, not after it. */}
          {d.reconstructed && d.reliable === false && (
            <div style={{ ...card, marginTop: 12, borderColor: "var(--crit-dim)", background: "rgba(239,68,68,0.08)" }}>
              <div style={{ color: "var(--crit)", fontWeight: 700, fontSize: 13 }}>
                This figure is not reliable for {d.as_at}
              </div>
              {d.warnings.map((w, i) => (
                <div key={i} style={{ color: "var(--crit-edge)", fontSize: 12, marginTop: 4 }}>{w}</div>
              ))}
            </div>
          )}
          {d.reconstructed && d.reliable && (
            <div style={{ ...card, marginTop: 12, borderColor: "var(--gold-deep)" }}>
              <div style={{ color: "var(--gold)", fontSize: 12 }}>
                Reconstructed by rolling today's position back through {d.movements_since.rows} ledger
                movement(s) recorded after {d.as_at}. Accurate only to the extent the ledger is complete.
              </div>
            </div>
          )}
          {!d.reconstructed && d.warnings.length > 0 && (
            <div style={{ ...card, marginTop: 12, borderColor: "var(--gold-deep)" }}>
              {d.warnings.map((w, i) => (
                <div key={i} style={{ color: "var(--gold)", fontSize: 12 }}>⚠ {w}</div>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginTop: 14 }}>
            <KPI title="TOTAL VALUE" value={money(d.total_value)} color="var(--yellow)" />
            <KPI title="TOTAL WEIGHT" value={kg(d.total_kg)} />
            <KPI title="AS AT" value={d.as_at} sub={d.basis} />
          </div>

          <div style={{ ...card, marginTop: 14, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={th}>Category</th>
                  <th style={{ ...th, textAlign: "right" }}>Weight</th>
                  <th style={{ ...th, textAlign: "right" }}>Value</th>
                  <th style={th}>Valued at</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([name, w, v, basis, count]) => (
                  <tr key={name}>
                    <td style={td}>
                      <b>{name}</b>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>{count}</div>
                    </td>
                    <td style={numTd}>{kg(w)}</td>
                    <td style={numTd}>{money(v)}</td>
                    <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>{basis}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 700, borderTop: "2px solid var(--surface)" }}>Total</td>
                  <td style={{ ...numTd, fontWeight: 700, borderTop: "2px solid var(--surface)" }}>{kg(d.total_kg)}</td>
                  <td style={{ ...numTd, fontWeight: 700, borderTop: "2px solid var(--surface)", color: "var(--yellow)" }}>
                    {money(d.total_value)}
                  </td>
                  <td style={{ ...td, borderTop: "2px solid var(--surface)" }} />
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ ...card, marginTop: 14, color: "var(--muted)", fontSize: 12, lineHeight: 1.7 }}>
            <b style={{ color: "var(--text)" }}>How to read this.</b> Yarn is valued at what was actually paid
            for it, per lot. Greige and finished goods carry no purchase price, so they are valued at the
            average yarn rate — that is a floor, not a true cost, because knitting, dyeing and finishing
            are not included. Treating it as a full cost would overstate the stock.
            {d.ledger_coverage && (
              <div style={{ marginTop: 8 }}>
                Stock ledger: {d.ledger_coverage.rows} entr{d.ledger_coverage.rows === 1 ? "y" : "ies"}
                {d.ledger_coverage.from_date ? `, from ${d.ledger_coverage.from_date} to ${d.ledger_coverage.to_date}` : ""}.
                Past-dated valuations can only reach back as far as this.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KPI({ title, value, sub, color }) {
  return (
    <div style={card}>
      <div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: color || "var(--text)" }}>{value}</div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
