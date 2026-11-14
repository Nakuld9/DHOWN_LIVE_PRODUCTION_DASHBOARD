import React, { useState, useEffect, useCallback } from "react";
import { io } from "socket.io-client";

const API = "";
const token = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });

let socket;

export default function YarnStore() {
  const [lots, setLots] = useState([]);
  const [summary, setSummary] = useState([]);
  const [movements, setMovements] = useState([]);
  const [selected, setSelected] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [editLoc, setEditLoc] = useState(null);
  const [locVal, setLocVal] = useState("");
  const [view, setView] = useState("lots"); // lots | summary
  const [lowStock, setLowStock] = useState([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/yarn-store${statusFilter ? `?status=${statusFilter}` : ""}`, { headers: h() });
      if (!r.ok) throw new Error(`Failed to load yarn store (${r.status})`);
      const j = await r.json();
      setLots(Array.isArray(j) ? j : []);
      const s = await fetch(`${API}/api/yarn-store/summary`, { headers: h() });
      const sj = s.ok ? await s.json() : [];
      setSummary(Array.isArray(sj) ? sj : []);
      setErr("");
    } catch (e) { setErr(e.message || "Could not load yarn store"); }
  }, [statusFilter]);

  const loadLowStock = useCallback(async () => {
    const r = await fetch(`${API}/api/yarn-store/low-stock`, { headers: h() });
    const j = await r.json();
    setLowStock(Array.isArray(j) ? j : []);
  }, []);

  useEffect(() => {
    load();
    loadLowStock();
    socket = io(API);
    socket.on("inventory:yarn_stock_update", () => { load(); loadLowStock(); });
    return () => socket.disconnect();
  }, [load, loadLowStock]);

  const loadMovements = async (lot_id) => {
    const r = await fetch(`${API}/api/yarn-store/${lot_id}/movements`, { headers: h() });
    setMovements(await r.json());
  };

  const selectLot = (lot) => {
    setSelected(lot);
    loadMovements(lot.lot_id);
  };

  const saveLocation = async (lot_id) => {
    await fetch(`${API}/api/yarn-store/${lot_id}/location`, { method: "PUT", headers: h(), body: JSON.stringify({ location: locVal }) });
    setEditLoc(null);
    load();
  };

  const stockPct = (lot) => {
    const pct = lot.net_weight_kg > 0 ? (lot.current_stock_kg / lot.net_weight_kg) * 100 : 0;
    return Math.min(100, Math.max(0, pct));
  };

  const stockColor = (pct) => pct > 50 ? "var(--green)" : pct > 20 ? "var(--gold)" : "var(--crit)";

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--yellow)" }}>🧵 Yarn Store</h2>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>Live stock levels — updates in real-time</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {["lots", "summary"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "6px 14px", borderRadius: 5, border: "1px solid var(--border)", cursor: "pointer", fontSize: 12, background: view === v ? "var(--yellow)" : "var(--surface)", color: view === v ? "var(--bg)" : "var(--text)", textTransform: "capitalize" }}>{v}</button>
          ))}
          {view === "lots" && ["", "IN_STORE", "EXHAUSTED"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: "6px 14px", borderRadius: 5, border: "1px solid var(--border)", cursor: "pointer", fontSize: 12, background: statusFilter === s ? "var(--border)" : "var(--surface)", color: "var(--text)" }}>{s || "All"}</button>
          ))}
        </div>
      </div>

      {err && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid var(--crit-dim)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: 'var(--crit)', fontSize: 13 }}>{err}</div>
      )}

      {/* Low-stock alert banner */}
      {lowStock.length > 0 && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid var(--crit)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ color: 'var(--crit)', fontWeight: 'bold', fontSize: 13, marginBottom: 8 }}>
            LOW STOCK ALERT — {lowStock.length} lot{lowStock.length !== 1 ? 's' : ''} running low
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {lowStock.map(l => (
              <div key={l.lot_id} style={{ background: 'var(--crit-dim)', border: '1px solid var(--crit-dim)', borderRadius: 6, padding: '6px 12px', fontSize: 12 }}>
                <span style={{ color: 'var(--crit)', fontWeight: 700 }}>{l.lot_number}</span>
                <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{l.yarn_type} {l.color}</span>
                <span style={{ color: 'var(--crit)', marginLeft: 6, fontWeight: 700 }}>{parseFloat(l.current_stock_kg).toFixed(1)} kg ({l.stock_pct}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "summary" ? (
        <div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "var(--border)" }}>
              {["Yarn Type", "Color", "Lots", "Total Received", "Current Stock", "Stock %"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {summary.map((s, i) => {
                const pct = s.total_received_kg > 0 ? (s.stock_kg / s.total_received_kg * 100) : 0;
                return (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 14px", fontWeight: "bold" }}>{s.yarn_type}</td>
                    <td style={{ padding: "10px 14px" }}>{s.color}</td>
                    <td style={{ padding: "10px 14px" }}>{s.lot_count}</td>
                    <td style={{ padding: "10px 14px" }}>{parseFloat(s.total_received_kg).toFixed(1)} kg</td>
                    <td style={{ padding: "10px 14px", color: stockColor(pct) }}>{parseFloat(s.stock_kg).toFixed(1)} kg</td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 8, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: stockColor(pct), borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 12, color: stockColor(pct), minWidth: 36 }}>{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 20 }}>
          {/* Lot grid */}
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, alignContent: "start" }}>
            {lots.map(lot => {
              const pct = stockPct(lot);
              const sc = stockColor(pct);
              return (
                <div key={lot.lot_id} onClick={() => selectLot(lot)}
                  style={{ background: selected?.lot_id === lot.lot_id ? "var(--border)" : "var(--surface)", border: `1px solid ${selected?.lot_id === lot.lot_id ? "var(--yellow)" : "var(--border)"}`, borderRadius: 8, padding: 14, cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: 12 }}>{lot.lot_number}</div>
                      <div style={{ fontSize: 14, marginTop: 2 }}>{lot.yarn_type}</div>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>{lot.count && `${lot.count} · `}{lot.color}</div>
                    </div>
                    {lot.qr_image && <img src={lot.qr_image} alt="QR" style={{ width: 44, height: 44 }} />}
                  </div>
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                      <span style={{ color: "var(--muted)" }}>Stock</span>
                      <span style={{ color: sc, fontWeight: "bold" }}>{parseFloat(lot.current_stock_kg).toFixed(1)} / {parseFloat(lot.net_weight_kg).toFixed(1)} kg</span>
                    </div>
                    <div style={{ height: 6, background: "var(--bg)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: sc, borderRadius: 3, transition: "width 0.3s" }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    📍 {editLoc === lot.lot_id ? (
                      <span onClick={e => e.stopPropagation()} style={{ display: "inline-flex", gap: 4 }}>
                        <input value={locVal} onChange={e => setLocVal(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--gold)", color: "var(--text)", borderRadius: 3, padding: "2px 6px", fontSize: 11, width: 90 }} />
                        <button onClick={() => saveLocation(lot.lot_id)} style={{ background: "var(--green)", color: "var(--text)", border: "none", borderRadius: 3, padding: "2px 6px", cursor: "pointer", fontSize: 10 }}>✓</button>
                      </span>
                    ) : (
                      <span onClick={(e) => { e.stopPropagation(); setEditLoc(lot.lot_id); setLocVal(lot.location || ""); }} style={{ borderBottom: "1px dashed var(--muted)", cursor: "pointer" }}>{lot.location || "Set location"}</span>
                    )}
                  </div>
                </div>
              );
            })}
            {lots.length === 0 && <div style={{ color: "var(--muted)", gridColumn: "1/-1", textAlign: "center", marginTop: 40 }}>No yarn lots. Receive yarn via GRN first.</div>}
          </div>

          {/* Movement history */}
          {selected && (
            <div style={{ width: 340, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, flexShrink: 0 }}>
              <div style={{ fontWeight: "bold", color: "var(--yellow)", marginBottom: 12 }}>{selected.lot_number} — History</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>{selected.yarn_type} · {selected.color} · {selected.supplier_name}</div>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {movements.map(m => (
                  <div key={m.movement_id} style={{ borderLeft: `3px solid ${m.movement_type === 'GRN_RECEIPT' ? 'var(--green)' : m.movement_type === 'ISSUE' ? 'var(--crit)' : 'var(--gold)'}`, paddingLeft: 10, marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: "bold", color: m.movement_type === 'GRN_RECEIPT' ? 'var(--green)' : m.movement_type === 'ISSUE' ? 'var(--crit)' : 'var(--gold)' }}>{m.movement_type.replace(/_/g, " ")}</div>
                    <div style={{ fontSize: 12 }}>{parseFloat(m.quantity_kg).toFixed(2)} kg</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{parseFloat(m.before_kg || 0).toFixed(1)} → {parseFloat(m.after_kg || 0).toFixed(1)} kg</div>
                    <div style={{ fontSize: 10, color: "var(--border)" }}>{new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')}</div>
                  </div>
                ))}
                {movements.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>No movements yet</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
