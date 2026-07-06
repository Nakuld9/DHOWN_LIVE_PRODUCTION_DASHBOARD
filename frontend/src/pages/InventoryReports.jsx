import React, { useState, useEffect, useCallback } from "react";

const API = "http://localhost:4000";
const h = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const fmt = (n, dec = 1) => parseFloat(n || 0).toFixed(dec);

const TABS = [
  { key: "stock",    label: "📊 Yarn Stock",       desc: "Current stock by type & color" },
  { key: "greige",   label: "🧶 Greige Stock",      desc: "Greige rolls by item, lot, machine" },
  { key: "knitting", label: "🧵 Knitting / Job Work", desc: "Yarn sent for knitting — vendor & lot wise" },
  { key: "dyefin",   label: "🎨 Dyeing & Finishing", desc: "Rolls at dyer — item, lot, colour wise" },
  { key: "finished", label: "✅ Finished Fabric",    desc: "Finished goods — item, lot, colour wise" },
  { key: "ledger",   label: "📒 Lot Ledger",        desc: "Per-lot movement history" },
  { key: "consume",  label: "⚡ Consumption",        desc: "Yarn issued vs fabric produced" },
  { key: "flow",     label: "🏭 Warehouse Flow",    desc: "Rolls at each warehouse stage" },
];

export default function InventoryReports() {
  const [tab, setTab] = useState("stock");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedLot, setSelectedLot] = useState(null);

  const load = useCallback(async (t = tab) => {
    setLoading(true);
    try {
      let url;
      if (t === "stock")    url = `${API}/api/reports/yarn-stock`;
      if (t === "greige")   url = `${API}/api/reports/greige-stock`;
      if (t === "knitting") url = `${API}/api/reports/knitting-jobwork`;
      if (t === "dyefin")   url = `${API}/api/reports/dyeing-finishing`;
      if (t === "finished") url = `${API}/api/reports/finished-fabric`;
      if (t === "ledger")   url = `${API}/api/reports/lot-ledger`;
      if (t === "consume")  url = `${API}/api/reports/consumption?from=${from}&to=${to}`;
      if (t === "flow")     url = `${API}/api/reports/warehouse-flow`;
      const r = await fetch(url, { headers: h() });
      const j = await r.json();
      setData(d => ({ ...d, [t]: j }));
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [tab, from, to]);

  useEffect(() => { if (!data[tab]) load(tab); }, [tab]);

  const refresh = () => { setData(d => ({ ...d, [tab]: undefined })); setTimeout(() => load(tab), 50); };

  const thStyle = { padding: "10px 14px", textAlign: "left", color: "#7da2d6", fontSize: 12, fontWeight: 600, borderBottom: "1px solid #1e3a5f", whiteSpace: "nowrap" };
  const tdStyle = { padding: "9px 14px", borderBottom: "1px solid #0d1b2a", fontSize: 13 };

  const StockBar = ({ pct, color }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 8, background: "#081426", borderRadius: 4, overflow: "hidden", minWidth: 80 }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.4s" }} />
      </div>
      <span style={{ color, fontSize: 12, minWidth: 36 }}>{pct}%</span>
    </div>
  );

  const stockColor = (pct) => pct > 50 ? "#10b981" : pct > 20 ? "#f59e0b" : "#ef4444";

  // ── STOCK TAB ──────────────────────────────────────────────
  const renderStock = () => {
    const rows = data.stock || [];
    const totReceived = rows.reduce((s, r) => s + parseFloat(r.total_received_kg || 0), 0);
    const totStock = rows.reduce((s, r) => s + parseFloat(r.current_stock_kg || 0), 0);
    const totConsumed = rows.reduce((s, r) => s + parseFloat(r.consumed_kg || 0), 0);

    return (
      <>
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          {[["Total Received", `${fmt(totReceived)} kg`, "#60a5fa"], ["Current Stock", `${fmt(totStock)} kg`, "#10b981"], ["Consumed", `${fmt(totConsumed)} kg`, "#f59e0b"],
            ["Overall Stock %", `${totReceived > 0 ? ((totStock / totReceived) * 100).toFixed(1) : 0}%`, stockColor(totReceived > 0 ? (totStock / totReceived) * 100 : 0)]
          ].map(([l, v, c]) => (
            <div key={l} style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 16px", flex: 1 }}>
              <div style={{ color: "#7da2d6", fontSize: 11 }}>{l}</div>
              <div style={{ color: c, fontSize: 20, fontWeight: "bold" }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#1e3a5f" }}>
              {["Yarn Type", "Count", "Color", "Lots", "Received (kg)", "Consumed (kg)", "Stock (kg)", "Stock Level"].map(c => <th key={c} style={thStyle}>{c}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const pct = parseFloat(r.stock_pct || 0);
                const sc = stockColor(pct);
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#081426" }}>
                    <td style={{ ...tdStyle, fontWeight: "bold" }}>{r.yarn_type}</td>
                    <td style={tdStyle}>{r.count || "—"}</td>
                    <td style={tdStyle}>{r.color}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>{r.lot_count}</td>
                    <td style={tdStyle}>{fmt(r.total_received_kg)}</td>
                    <td style={{ ...tdStyle, color: "#f59e0b" }}>{fmt(r.consumed_kg)}</td>
                    <td style={{ ...tdStyle, color: sc, fontWeight: "bold" }}>{fmt(r.current_stock_kg)}</td>
                    <td style={{ ...tdStyle, minWidth: 160 }}><StockBar pct={pct} color={sc} /></td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No yarn lots yet</td></tr>}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  // ── LEDGER TAB ─────────────────────────────────────────────
  const renderLedger = () => {
    const lots = data.ledger || [];
    const lot = selectedLot ? lots.find(l => l.lot_id === selectedLot) : null;

    const mvColor = (type) => type === "GRN_RECEIPT" ? "#10b981" : type === "ISSUE" ? "#ef4444" : "#f59e0b";

    return (
      <div style={{ display: "flex", gap: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#1e3a5f" }}>
              {["Lot Number", "Yarn Type", "Color", "GRN", "Received", "Stock", "Movements"].map(c => <th key={c} style={thStyle}>{c}</th>)}
            </tr></thead>
            <tbody>
              {lots.map((l, i) => (
                <tr key={l.lot_id} onClick={() => setSelectedLot(l.lot_id)}
                  style={{ background: selectedLot === l.lot_id ? "#1e3a5f" : i % 2 === 0 ? "transparent" : "#081426", cursor: "pointer" }}>
                  <td style={{ ...tdStyle, color: "#f4ae1f", fontWeight: "bold" }}>{l.lot_number}</td>
                  <td style={tdStyle}>{l.yarn_type}</td>
                  <td style={tdStyle}>{l.color}</td>
                  <td style={{ ...tdStyle, color: "#7da2d6" }}>{l.grn_number}</td>
                  <td style={tdStyle}>{fmt(l.net_weight_kg)} kg</td>
                  <td style={{ ...tdStyle, color: l.current_stock_kg > 0 ? "#10b981" : "#ef4444", fontWeight: "bold" }}>{fmt(l.current_stock_kg)} kg</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>{l.movements?.length || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {lot && (
          <div style={{ width: 340, background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 10, padding: 16, flexShrink: 0 }}>
            <div style={{ color: "#f4ae1f", fontWeight: "bold", fontSize: 14, marginBottom: 2 }}>{lot.lot_number}</div>
            <div style={{ color: "#7da2d6", fontSize: 12, marginBottom: 14 }}>{lot.yarn_type} · {lot.color} · {lot.supplier_name}</div>
            <div style={{ fontWeight: "bold", color: "#e2e8f0", marginBottom: 10, fontSize: 13 }}>Movement Ledger</div>
            <div style={{ maxHeight: 460, overflowY: "auto" }}>
              {(lot.movements || []).map((mv, i) => (
                <div key={i} style={{ borderLeft: `3px solid ${mvColor(mv.movement_type)}`, paddingLeft: 10, marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: mvColor(mv.movement_type), fontSize: 12, fontWeight: "bold" }}>{mv.movement_type.replace(/_/g, " ")}</span>
                    <span style={{ color: mv.movement_type === "ISSUE" ? "#ef4444" : "#10b981", fontSize: 13, fontWeight: "bold" }}>
                      {mv.movement_type === "ISSUE" ? "−" : "+"}{fmt(mv.quantity_kg)} kg
                    </span>
                  </div>
                  <div style={{ color: "#7da2d6", fontSize: 11 }}>{fmt(mv.before_kg)} → {fmt(mv.after_kg)} kg</div>
                  <div style={{ color: "#4a5568", fontSize: 10 }}>{new Date(mv.created_at).toLocaleString("en-IN")}</div>
                  {mv.notes && <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 2 }}>{mv.notes}</div>}
                </div>
              ))}
              {!lot.movements?.length && <div style={{ color: "#7da2d6", fontSize: 13 }}>No movements yet</div>}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── CONSUMPTION TAB ────────────────────────────────────────
  const renderConsumption = () => {
    const { issues = [], totals = {} } = data.consume || {};
    const yieldPct = totals.yield_pct;
    const yieldColor = yieldPct >= 90 ? "#10b981" : yieldPct >= 80 ? "#f59e0b" : "#ef4444";

    return (
      <>
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-end" }}>
          {[["from", from, setFrom], ["to", to, setTo]].map(([lbl, val, set]) => (
            <div key={lbl}>
              <div style={{ color: "#7da2d6", fontSize: 11, marginBottom: 3, textTransform: "capitalize" }}>{lbl}</div>
              <input type="date" value={val} onChange={e => set(e.target.value)}
                style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 5, padding: "7px 10px", color: "#e2e8f0", fontSize: 13 }} />
            </div>
          ))}
          <button onClick={refresh} style={{ background: "#f4ae1f", color: "#081426", border: "none", borderRadius: 6, padding: "8px 18px", fontWeight: "bold", cursor: "pointer" }}>Apply</button>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          {[["Issued", `${fmt(totals.total_issued_kg)} kg`, "#60a5fa"],
            ["Returned", `${fmt(totals.total_returned_kg)} kg`, "#f59e0b"],
            ["Consumed", `${fmt(totals.total_consumed_kg)} kg`, "#ef4444"],
            ["Fabric Produced", `${fmt(totals.total_fabric_kg)} kg`, "#10b981"],
            ["Yarn Yield", yieldPct ? `${yieldPct}%` : "—", yieldColor],
          ].map(([l, v, c]) => (
            <div key={l} style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 14px", flex: 1 }}>
              <div style={{ color: "#7da2d6", fontSize: 11 }}>{l}</div>
              <div style={{ color: c, fontSize: 18, fontWeight: "bold" }}>{v}</div>
            </div>
          ))}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#1e3a5f" }}>
            {["Issue No", "Date", "Machine", "Issued (kg)", "Returned (kg)", "Consumed (kg)"].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr></thead>
          <tbody>
            {issues.map((r, i) => (
              <tr key={r.issue_id} style={{ background: i % 2 === 0 ? "transparent" : "#081426" }}>
                <td style={{ ...tdStyle, color: "#f4ae1f", fontWeight: "bold" }}>{r.issue_number}</td>
                <td style={tdStyle}>{r.issue_date?.slice(0, 10)}</td>
                <td style={tdStyle}>{r.machine_name || "—"}</td>
                <td style={tdStyle}>{fmt(r.issued_kg)}</td>
                <td style={{ ...tdStyle, color: "#f59e0b" }}>{fmt(r.returned_kg)}</td>
                <td style={{ ...tdStyle, color: "#ef4444", fontWeight: "bold" }}>{fmt(r.consumed_kg)}</td>
              </tr>
            ))}
            {issues.length === 0 && <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No yarn issues in selected period</td></tr>}
          </tbody>
        </table>
      </>
    );
  };

  // ── FLOW TAB ───────────────────────────────────────────────
  const renderFlow = () => {
    const { stages = [], grns = [], batches = [], challans = [], finishedGoods = [] } = data.flow || {};
    const stageOrder = ["GREIGE", "IN_BATCH", "SENT_OUT", "FINISHED", "DISPATCHED"];
    const stageLabel = { GREIGE: "Greige Store", IN_BATCH: "In Batch", SENT_OUT: "At Vendor", FINISHED: "Finished", DISPATCHED: "Dispatched" };
    const stageColor = { GREIGE: "#a78bfa", IN_BATCH: "#f59e0b", SENT_OUT: "#6366f1", FINISHED: "#10b981", DISPATCHED: "#22c55e" };

    const toMap = (arr, keyCol, rollsCol = "cnt") => Object.fromEntries(arr.map(r => [r[keyCol], r]));
    const grnMap = toMap(grns, "status"); const batchMap = toMap(batches, "status"); const challanMap = toMap(challans, "status"); const fgMap = toMap(finishedGoods, "status");

    return (
      <>
        {/* Roll flow by warehouse stage */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: "#7da2d6", fontSize: 12, marginBottom: 12, fontWeight: 600, letterSpacing: 1 }}>ROLL FLOW BY WAREHOUSE STAGE</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {stageOrder.map(stage => {
              const s = stages.find(r => r.warehouse_status === stage) || { rolls: 0, kg: 0 };
              const c = stageColor[stage];
              return (
                <div key={stage} style={{ background: "#0d1b2a", border: `1px solid ${c}44`, borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 130 }}>
                  <div style={{ color: c, fontSize: 11, fontWeight: "bold", letterSpacing: 1 }}>{stageLabel[stage]}</div>
                  <div style={{ color: c, fontSize: 26, fontWeight: "bold", marginTop: 4 }}>{s.rolls}</div>
                  <div style={{ color: "#7da2d6", fontSize: 12 }}>{fmt(s.kg)} kg</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Other module status */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[
            ["GRN Status", grnMap, ["DRAFT", "APPROVED", "REJECTED"], ["#f59e0b", "#10b981", "#ef4444"], "cnt"],
            ["Batch Status", batchMap, ["OPEN", "SEALED", "SENT", "RECEIVED"], ["#22c55e", "#f4ae1f", "#6366f1", "#10b981"], "cnt"],
            ["Challan Status", challanMap, ["SENT", "RECEIVED"], ["#6366f1", "#10b981"], "cnt"],
            ["Finished Goods", fgMap, ["IN_STOCK", "HOLD", "DISPATCHED"], ["#10b981", "#ef4444", "#60a5fa"], "cnt"],
          ].map(([title, map, keys, colors, countKey]) => (
            <div key={title} style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 10, padding: 16 }}>
              <div style={{ color: "#7da2d6", fontSize: 12, fontWeight: 600, letterSpacing: 1, marginBottom: 12 }}>{title.toUpperCase()}</div>
              {keys.map((k, i) => {
                const row = map[k] || { [countKey]: 0 };
                return (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #081426" }}>
                    <span style={{ color: colors[i], fontSize: 13 }}>{k}</span>
                    <span style={{ color: colors[i], fontWeight: "bold", fontSize: 16 }}>{row[countKey]}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </>
    );
  };

  // ── GREIGE STOCK TAB ────────────────────────────────────────
  const renderGreige = () => {
    const { by_item = [], by_lot = [], totals = [] } = data.greige || {};
    const greigeTot = totals.find(t => t.warehouse_status === 'GREIGE') || { roll_count: 0, total_kg: 0 };
    const allTot = totals.reduce((s, t) => ({ rolls: s.rolls + parseInt(t.roll_count || 0), kg: s.kg + parseFloat(t.total_kg || 0) }), { rolls: 0, kg: 0 });
    const stageColor = { GREIGE: "#a78bfa", IN_BATCH: "#f59e0b", SENT_OUT: "#6366f1", FINISHED: "#10b981", DISPATCHED: "#22c55e" };

    return (
      <>
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          {totals.map(t => (
            <div key={t.warehouse_status} style={{ background: "#0d1b2a", border: `1px solid ${stageColor[t.warehouse_status] || '#1e3a5f'}44`, borderRadius: 8, padding: "10px 16px", flex: 1 }}>
              <div style={{ color: stageColor[t.warehouse_status] || '#7da2d6', fontSize: 11 }}>{(t.warehouse_status || 'UNKNOWN').replace('_', ' ')}</div>
              <div style={{ color: stageColor[t.warehouse_status] || '#fff', fontSize: 20, fontWeight: "bold" }}>{t.roll_count} rolls</div>
              <div style={{ color: "#7da2d6", fontSize: 12 }}>{fmt(t.total_kg)} kg</div>
            </div>
          ))}
        </div>
        <div style={{ color: "#7da2d6", fontSize: 12, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>ITEM-WISE BREAKDOWN</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead><tr style={{ background: "#1e3a5f" }}>
            {["Fabric Type", "Stage", "Machine", "Rolls", "Weight (kg)"].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr></thead>
          <tbody>
            {by_item.map((r, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#081426" }}>
                <td style={{ ...tdStyle, fontWeight: "bold" }}>{r.fabric_type || '—'}</td>
                <td style={tdStyle}><span style={{ color: stageColor[r.warehouse_status] || '#7da2d6', fontWeight: 600 }}>{(r.warehouse_status || '').replace('_', ' ')}</span></td>
                <td style={tdStyle}>{r.machine_name || '—'}</td>
                <td style={{ ...tdStyle, textAlign: "center", fontWeight: "bold" }}>{r.roll_count}</td>
                <td style={{ ...tdStyle, color: "#10b981", fontWeight: "bold" }}>{fmt(r.total_kg)}</td>
              </tr>
            ))}
            {by_item.length === 0 && <tr><td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No greige rolls</td></tr>}
          </tbody>
        </table>
        <div style={{ color: "#7da2d6", fontSize: 12, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>LOT-WISE BREAKDOWN</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#1e3a5f" }}>
            {["Lot ID", "Fabric Type", "Machine", "Shift", "Stage", "Rolls", "Weight (kg)"].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr></thead>
          <tbody>
            {by_lot.map((r, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#081426" }}>
                <td style={{ ...tdStyle, color: "#f4ae1f", fontWeight: "bold" }}>{r.lot_id || '—'}</td>
                <td style={tdStyle}>{r.fabric_type || '—'}</td>
                <td style={tdStyle}>{r.machine_name || '—'}</td>
                <td style={{ ...tdStyle, textAlign: "center" }}>{r.shift || '—'}</td>
                <td style={tdStyle}><span style={{ color: stageColor[r.warehouse_status] || '#7da2d6' }}>{(r.warehouse_status || '').replace('_', ' ')}</span></td>
                <td style={{ ...tdStyle, textAlign: "center" }}>{r.roll_count}</td>
                <td style={{ ...tdStyle, color: "#10b981", fontWeight: "bold" }}>{fmt(r.total_kg)}</td>
              </tr>
            ))}
            {by_lot.length === 0 && <tr><td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No greige rolls</td></tr>}
          </tbody>
        </table>
      </>
    );
  };

  // ── KNITTING / JOB WORK TAB ────────────────────────────────
  const renderKnitting = () => {
    const { challans = [], yarn_items = [], by_vendor = [] } = data.knitting || {};
    const totSent = by_vendor.reduce((s, v) => s + parseFloat(v.total_sent_kg || 0), 0);
    const totRecv = by_vendor.reduce((s, v) => s + parseFloat(v.total_received_kg || 0), 0);
    const totPending = by_vendor.reduce((s, v) => s + parseInt(v.pending || 0), 0);

    return (
      <>
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          {[["Total Challans", challans.length, "#60a5fa"], ["Pending", totPending, totPending > 0 ? "#f59e0b" : "#10b981"], ["Sent (kg)", fmt(totSent), "#a78bfa"], ["Received (kg)", fmt(totRecv), "#10b981"]
          ].map(([l, v, c]) => (
            <div key={l} style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 16px", flex: 1 }}>
              <div style={{ color: "#7da2d6", fontSize: 11 }}>{l}</div>
              <div style={{ color: c, fontSize: 20, fontWeight: "bold" }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ color: "#7da2d6", fontSize: 12, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>VENDOR-WISE SUMMARY</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead><tr style={{ background: "#1e3a5f" }}>
            {["Vendor", "Total Challans", "Pending", "Sent (kg)", "Received (kg)", "Pending (kg)"].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr></thead>
          <tbody>
            {by_vendor.map((v, i) => {
              const pendKg = parseFloat(v.total_sent_kg || 0) - parseFloat(v.total_received_kg || 0);
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#081426" }}>
                  <td style={{ ...tdStyle, fontWeight: "bold", color: "#f4ae1f" }}>{v.vendor_name}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>{v.total_challans}</td>
                  <td style={{ ...tdStyle, textAlign: "center", color: parseInt(v.pending) > 0 ? "#f59e0b" : "#10b981", fontWeight: "bold" }}>{v.pending}</td>
                  <td style={tdStyle}>{fmt(v.total_sent_kg)}</td>
                  <td style={{ ...tdStyle, color: "#10b981" }}>{fmt(v.total_received_kg)}</td>
                  <td style={{ ...tdStyle, color: pendKg > 0 ? "#f59e0b" : "#10b981", fontWeight: "bold" }}>{fmt(pendKg, 1)}</td>
                </tr>
              );
            })}
            {by_vendor.length === 0 && <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No knitting challans</td></tr>}
          </tbody>
        </table>

        <div style={{ color: "#7da2d6", fontSize: 12, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>LOT-WISE DETAIL (YARN SENT)</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead><tr style={{ background: "#1e3a5f" }}>
            {["Challan", "Vendor", "Lot No.", "Yarn Type", "Colour", "Sent (kg)", "Status", "Days Out"].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr></thead>
          <tbody>
            {challans.map(ch => {
              const items = yarn_items.filter(yi => yi.challan_id === ch.challan_id);
              return items.map((yi, i) => (
                <tr key={`${ch.challan_id}-${i}`} style={{ background: ch.is_overdue ? "rgba(239,68,68,0.08)" : "transparent", borderLeft: ch.is_overdue ? "3px solid #ef4444" : "3px solid transparent" }}>
                  {i === 0 ? <td rowSpan={items.length} style={{ ...tdStyle, color: "#f4ae1f", fontWeight: "bold", fontFamily: "monospace", verticalAlign: "top" }}>{ch.challan_number}</td> : null}
                  {i === 0 ? <td rowSpan={items.length} style={{ ...tdStyle, verticalAlign: "top" }}>{ch.vendor_name}</td> : null}
                  <td style={{ ...tdStyle, fontWeight: "bold" }}>{yi.lot_number || '—'}</td>
                  <td style={tdStyle}>{yi.yarn_type || '—'}</td>
                  <td style={tdStyle}>{yi.color || '—'}</td>
                  <td style={{ ...tdStyle, fontWeight: "bold" }}>{fmt(yi.sent_kg)}</td>
                  {i === 0 ? <td rowSpan={items.length} style={{ ...tdStyle, verticalAlign: "top" }}>
                    <span style={{ background: ch.is_overdue ? "rgba(239,68,68,0.2)" : ch.status === 'RECEIVED' ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)", color: ch.is_overdue ? "#ef4444" : ch.status === 'RECEIVED' ? "#22c55e" : "#f59e0b", padding: "2px 8px", borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{ch.is_overdue ? 'OVERDUE' : ch.status}</span>
                  </td> : null}
                  {i === 0 ? <td rowSpan={items.length} style={{ ...tdStyle, verticalAlign: "top", color: ch.is_overdue ? "#ef4444" : ch.days_out > 5 ? "#f59e0b" : "#e2e8f0", fontWeight: "bold" }}>{ch.days_out}d</td> : null}
                </tr>
              ));
            }).flat()}
            {challans.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No knitting challans</td></tr>}
          </tbody>
        </table>
      </>
    );
  };

  // ── DYEING & FINISHING TAB ─────────────────────────────────
  const renderDyeFin = () => {
    const { challans = [], by_vendor = [], by_fabric = [] } = data.dyefin || {};
    const totSent = challans.reduce((s, c) => s + parseFloat(c.sent_weight_kg || 0), 0);
    const totRecv = challans.reduce((s, c) => s + parseFloat(c.received_kg || 0), 0);
    const totPending = challans.filter(c => c.status === 'SENT' || c.status === 'PARTIALLY_RECEIVED').length;
    const totOverdue = challans.filter(c => c.is_overdue).length;
    const jobColor = { DYEING: "#6366f1", FINISHING: "#10b981", DYEING_FINISHING: "#f59e0b" };

    return (
      <>
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          {[["Total Challans", challans.length, "#60a5fa"], ["Pending", totPending, totPending > 0 ? "#f59e0b" : "#10b981"], ["Overdue", totOverdue, totOverdue > 0 ? "#ef4444" : "#10b981"], ["Sent (kg)", fmt(totSent), "#a78bfa"], ["Received (kg)", fmt(totRecv), "#10b981"]
          ].map(([l, v, c]) => (
            <div key={l} style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 16px", flex: 1 }}>
              <div style={{ color: "#7da2d6", fontSize: 11 }}>{l}</div>
              <div style={{ color: c, fontSize: 20, fontWeight: "bold" }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ color: "#7da2d6", fontSize: 12, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>VENDOR-WISE SUMMARY</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead><tr style={{ background: "#1e3a5f" }}>
            {["Vendor", "Job Type", "Challans", "Pending", "Overdue", "Rolls", "Sent (kg)", "Received (kg)"].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr></thead>
          <tbody>
            {by_vendor.map((v, i) => (
              <tr key={i} style={{ background: parseInt(v.overdue) > 0 ? "rgba(239,68,68,0.06)" : i % 2 === 0 ? "transparent" : "#081426" }}>
                <td style={{ ...tdStyle, fontWeight: "bold", color: "#f4ae1f" }}>{v.vendor_name}</td>
                <td style={tdStyle}><span style={{ color: jobColor[v.job_type] || "#7da2d6" }}>{(v.job_type || '').replace('_', ' + ')}</span></td>
                <td style={{ ...tdStyle, textAlign: "center" }}>{v.total_challans}</td>
                <td style={{ ...tdStyle, textAlign: "center", color: parseInt(v.pending) > 0 ? "#f59e0b" : "#10b981", fontWeight: "bold" }}>{v.pending}</td>
                <td style={{ ...tdStyle, textAlign: "center", color: parseInt(v.overdue) > 0 ? "#ef4444" : "#10b981", fontWeight: "bold" }}>{v.overdue}</td>
                <td style={{ ...tdStyle, textAlign: "center" }}>{v.total_rolls}</td>
                <td style={tdStyle}>{fmt(v.total_sent_kg)}</td>
                <td style={{ ...tdStyle, color: "#10b981" }}>{fmt(v.total_received_kg)}</td>
              </tr>
            ))}
            {by_vendor.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No dyeing/finishing challans</td></tr>}
          </tbody>
        </table>

        <div style={{ color: "#7da2d6", fontSize: 12, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>ITEM & COLOUR-WISE BREAKDOWN</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead><tr style={{ background: "#1e3a5f" }}>
            {["Fabric Type", "Colour", "Job Type", "Challans", "Rolls", "Sent (kg)", "Received (kg)", "Pending (kg)"].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr></thead>
          <tbody>
            {by_fabric.map((r, i) => {
              const pendKg = parseFloat(r.sent_kg || 0) - parseFloat(r.received_kg || 0);
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#081426" }}>
                  <td style={{ ...tdStyle, fontWeight: "bold" }}>{r.fabric_type || '—'}</td>
                  <td style={tdStyle}>{r.color_name || '—'}</td>
                  <td style={tdStyle}><span style={{ color: jobColor[r.job_type] || "#7da2d6" }}>{(r.job_type || '').replace('_', ' + ')}</span></td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>{r.challans}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>{r.rolls}</td>
                  <td style={tdStyle}>{fmt(r.sent_kg)}</td>
                  <td style={{ ...tdStyle, color: "#10b981" }}>{fmt(r.received_kg)}</td>
                  <td style={{ ...tdStyle, color: pendKg > 0 ? "#f59e0b" : "#10b981", fontWeight: "bold" }}>{fmt(pendKg, 1)}</td>
                </tr>
              );
            })}
            {by_fabric.length === 0 && <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No dyeing/finishing data</td></tr>}
          </tbody>
        </table>

        <div style={{ color: "#7da2d6", fontSize: 12, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>CHALLAN-WISE DETAIL</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#1e3a5f" }}>
            {["Challan", "Vendor", "Job Type", "Batch", "Fabric", "Colour", "Sent (kg)", "Received (kg)", "Status", "Days Out"].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr></thead>
          <tbody>
            {challans.map((c, i) => {
              const pendKg = parseFloat(c.sent_weight_kg || 0) - parseFloat(c.received_kg || 0);
              return (
                <tr key={c.challan_id} style={{ background: c.is_overdue ? "rgba(239,68,68,0.08)" : i % 2 === 0 ? "transparent" : "#081426", borderLeft: c.is_overdue ? "3px solid #ef4444" : "3px solid transparent" }}>
                  <td style={{ ...tdStyle, color: "#f4ae1f", fontWeight: "bold", fontFamily: "monospace" }}>{c.challan_number}</td>
                  <td style={tdStyle}>{c.vendor_name}</td>
                  <td style={tdStyle}><span style={{ color: jobColor[c.job_type] || "#7da2d6" }}>{(c.job_type || '').replace('_', ' + ')}</span></td>
                  <td style={tdStyle}>{c.batch_number || '—'}</td>
                  <td style={tdStyle}>{c.fabric_type || '—'}</td>
                  <td style={tdStyle}>{c.color_name || '—'}</td>
                  <td style={tdStyle}>{fmt(c.sent_weight_kg)}</td>
                  <td style={{ ...tdStyle, color: "#10b981" }}>{fmt(c.received_kg)}</td>
                  <td style={tdStyle}>
                    <span style={{ background: c.is_overdue ? "rgba(239,68,68,0.2)" : c.status === 'RECEIVED' ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)", color: c.is_overdue ? "#ef4444" : c.status === 'RECEIVED' ? "#22c55e" : "#f59e0b", padding: "2px 8px", borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{c.is_overdue ? 'OVERDUE' : c.status}</span>
                  </td>
                  <td style={{ ...tdStyle, color: c.is_overdue ? "#ef4444" : c.days_out > 5 ? "#f59e0b" : "#e2e8f0", fontWeight: "bold" }}>{c.days_out}d</td>
                </tr>
              );
            })}
            {challans.length === 0 && <tr><td colSpan={10} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No dyeing/finishing challans</td></tr>}
          </tbody>
        </table>
      </>
    );
  };

  // ── FINISHED FABRIC TAB ────────────────────────────────────
  const renderFinished = () => {
    const { by_item = [], by_lot = [], totals = [] } = data.finished || {};
    const inStock = totals.find(t => t.status === 'IN_STOCK') || { lots: 0, rolls: 0, kg: 0 };
    const dispatched = totals.find(t => t.status === 'DISPATCHED') || { lots: 0, rolls: 0, kg: 0 };
    const allTot = totals.reduce((s, t) => ({ lots: s.lots + parseInt(t.lots || 0), rolls: s.rolls + parseInt(t.rolls || 0), kg: s.kg + parseFloat(t.kg || 0) }), { lots: 0, rolls: 0, kg: 0 });
    const fgColor = { IN_STOCK: "#10b981", DISPATCHED: "#60a5fa", HOLD: "#ef4444" };
    const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    return (
      <>
        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          {totals.map(t => (
            <div key={t.status} style={{ background: "#0d1b2a", border: `1px solid ${fgColor[t.status] || '#1e3a5f'}44`, borderRadius: 8, padding: "10px 16px", flex: 1 }}>
              <div style={{ color: fgColor[t.status] || '#7da2d6', fontSize: 11 }}>{t.status?.replace('_', ' ')}</div>
              <div style={{ color: fgColor[t.status] || '#fff', fontSize: 20, fontWeight: "bold" }}>{t.lots} lots · {t.rolls} rolls</div>
              <div style={{ color: "#7da2d6", fontSize: 12 }}>{fmt(t.kg)} kg</div>
            </div>
          ))}
        </div>

        <div style={{ color: "#7da2d6", fontSize: 12, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>ITEM & COLOUR-WISE BREAKDOWN</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
          <thead><tr style={{ background: "#1e3a5f" }}>
            {["Fabric Type", "Colour", "Status", "Lots", "Rolls", "Weight (kg)"].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr></thead>
          <tbody>
            {by_item.map((r, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "#081426" }}>
                <td style={{ ...tdStyle, fontWeight: "bold" }}>{r.fabric_type || '—'}</td>
                <td style={tdStyle}>{r.color_name || '—'}</td>
                <td style={tdStyle}><span style={{ color: fgColor[r.status] || '#7da2d6', fontWeight: 600 }}>{(r.status || '').replace('_', ' ')}</span></td>
                <td style={{ ...tdStyle, textAlign: "center" }}>{r.lot_count}</td>
                <td style={{ ...tdStyle, textAlign: "center" }}>{r.total_rolls}</td>
                <td style={{ ...tdStyle, color: "#10b981", fontWeight: "bold" }}>{fmt(r.total_kg)}</td>
              </tr>
            ))}
            {by_item.length === 0 && <tr><td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No finished goods</td></tr>}
          </tbody>
        </table>

        <div style={{ color: "#7da2d6", fontSize: 12, fontWeight: 600, letterSpacing: 1, marginBottom: 10 }}>LOT-WISE DETAIL</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#1e3a5f" }}>
            {["FG ID", "Lot No.", "Fabric Type", "Colour", "Status", "Rolls", "Weight (kg)", "Location", "Date"].map(c => <th key={c} style={thStyle}>{c}</th>)}
          </tr></thead>
          <tbody>
            {by_lot.map((r, i) => (
              <tr key={r.fg_id} style={{ background: i % 2 === 0 ? "transparent" : "#081426" }}>
                <td style={{ ...tdStyle, color: "#f4ae1f", fontWeight: "bold" }}>FG-{r.fg_id}</td>
                <td style={{ ...tdStyle, fontFamily: "monospace", fontWeight: "bold" }}>{r.lot_no || '—'}</td>
                <td style={tdStyle}>{r.fabric_type || '—'}</td>
                <td style={tdStyle}>{r.color_name || '—'}</td>
                <td style={tdStyle}><span style={{ color: fgColor[r.status] || '#7da2d6', fontWeight: 600 }}>{(r.status || '').replace('_', ' ')}</span></td>
                <td style={{ ...tdStyle, textAlign: "center" }}>{r.roll_count}</td>
                <td style={{ ...tdStyle, color: "#10b981", fontWeight: "bold" }}>{fmt(r.weight_kg)}</td>
                <td style={tdStyle}>{r.location || '—'}</td>
                <td style={{ ...tdStyle, color: "#7da2d6", fontSize: 12 }}>{fmtDate(r.created_at)}</td>
              </tr>
            ))}
            {by_lot.length === 0 && <tr><td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: "#7da2d6", padding: 40 }}>No finished goods</td></tr>}
          </tbody>
        </table>
      </>
    );
  };

  const renderMap = { stock: renderStock, greige: renderGreige, knitting: renderKnitting, dyefin: renderDyeFin, finished: renderFinished, ledger: renderLedger, consume: renderConsumption, flow: renderFlow };

  return (
    <div style={{ padding: 20, color: "#e2e8f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: "#f4ae1f" }}>📈 Inventory Reports</h2>
          <div style={{ color: "#7da2d6", fontSize: 13, marginTop: 2 }}>Yarn · Greige · Knitting · Dyeing & Finishing · Finished Fabric · Ledger · Consumption · Flow</div>
        </div>
        <button onClick={refresh} style={{ background: "#0d1b2a", color: "#7da2d6", border: "1px solid #1e3a5f", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontSize: 13 }}>↻ Refresh</button>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, borderBottom: "1px solid #1e3a5f", paddingBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "9px 18px", border: "none", borderBottom: tab === t.key ? "2px solid #f4ae1f" : "2px solid transparent",
              background: "transparent", color: tab === t.key ? "#f4ae1f" : "#7da2d6", cursor: "pointer", fontWeight: tab === t.key ? "bold" : 400, fontSize: 13, whiteSpace: "nowrap" }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#7da2d6", padding: 60, fontSize: 15 }}>Loading report...</div>
      ) : (
        renderMap[tab]?.()
      )}
    </div>
  );
}
