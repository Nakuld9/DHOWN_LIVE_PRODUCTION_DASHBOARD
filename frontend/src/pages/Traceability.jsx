import React, { useState, useRef, useEffect } from "react";

const API = "";
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });

const STATUS_COLOR = {
  OPEN: "var(--green)", CLOSED: "var(--gold)", APPROVED: "var(--link)",
  GREIGE: "var(--purple)", IN_BATCH: "var(--gold)", SENT_OUT: "var(--purple)",
  FINISHED: "var(--green)", DISPATCHED: "var(--green)", IN_STOCK: "var(--green)",
  RECEIVED: "var(--green)", SENT: "var(--purple)",
};

const STEPS = [
  { key: "grn",          label: "Raw Material",    icon: "📥", color: "var(--purple)" },
  { key: "yarnLot",      label: "Yarn Lot",        icon: "🧵", color: "var(--purple)" },
  { key: "yarnIssue",    label: "Yarn Issue",      icon: "🚀", color: "var(--purple)" },
  { key: "roll",         label: "Roll Production", icon: "🧶", color: "var(--yellow)" },
  { key: "batch",        label: "Batching",        icon: "📦", color: "var(--gold)" },
  { key: "challan",      label: "Dye / Finish",    icon: "🎨", color: "var(--pink)" },
  { key: "receipt",      label: "Receipt",         icon: "📋", color: "var(--green)" },
  { key: "finishing",    label: "QA / Finishing",  icon: "✔️", color: "var(--green)" },
  { key: "finishedGoods", label: "Finished Goods", icon: "✅", color: "var(--green)" },
  { key: "dispatch",     label: "Dispatch",        icon: "📤", color: "var(--link)" },
];

export default function Traceability() {
  const [mode, setMode] = useState("roll"); // "roll" | "lot"
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [chain, setChain] = useState(null);
  const [lotData, setLotData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const debounce = useRef(null);

  const switchMode = (m) => {
    setMode(m); setQuery(""); setSuggestions([]); setChain(null); setLotData(null); setError("");
  };

  const search = async (val) => {
    setQuery(val);
    clearTimeout(debounce.current);
    if (!val || val.length < 2) { setSuggestions([]); return; }
    debounce.current = setTimeout(async () => {
      const url = mode === "roll"
        ? `${API}/api/traceability?q=${encodeURIComponent(val)}`
        : `${API}/api/traceability/lot-search?q=${encodeURIComponent(val)}`;
      const r = await fetch(url, { headers: h() });
      setSuggestions(await r.json());
    }, 300);
  };

  const loadRoll = async (roll_id) => {
    setLoading(true); setError(""); setChain(null); setLotData(null); setSuggestions([]);
    setQuery(roll_id);
    try {
      const r = await fetch(`${API}/api/traceability/${encodeURIComponent(roll_id)}`, { headers: h() });
      const j = await r.json();
      if (!r.ok) { setError(j.error || "Not found"); setLoading(false); return; }
      setChain(j);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const loadLot = async (lot_number) => {
    setLoading(true); setError(""); setChain(null); setLotData(null); setSuggestions([]);
    setQuery(lot_number);
    try {
      const r = await fetch(`${API}/api/traceability/lot/${encodeURIComponent(lot_number)}`, { headers: h() });
      const j = await r.json();
      if (!r.ok) { setError(j.error || "Not found"); setLoading(false); return; }
      setLotData(j);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  const handleLoad = () => {
    if (!query) return;
    mode === "roll" ? loadRoll(query) : loadLot(query);
  };

  // Deep link from a scanned QR label: /traceability?roll=<id> or ?lot=<no>.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const roll = p.get("roll"); const lot = p.get("lot");
    if (roll) loadRoll(roll);
    else if (lot) { setMode("lot"); loadLot(lot); }
  }, []);

  const field = (label, value, color = "var(--text)") => value ? (
    <div style={{ marginBottom: 6 }}>
      <span style={{ color: "var(--muted)", fontSize: 11 }}>{label}: </span>
      <span style={{ color, fontWeight: 500, fontSize: 13 }}>{value}</span>
    </div>
  ) : null;

  const StatusBadge = ({ status }) => {
    const c = STATUS_COLOR[status] || "var(--muted)";
    return <span style={{ background: c + "22", color: c, border: `1px solid ${c}`, borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>{status}</span>;
  };

  const StepCard = ({ step, data, children }) => {
    const active = !!data;
    return (
      <div style={{ display: "flex", gap: 0, alignItems: "stretch" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 40, flexShrink: 0 }}>
          <div style={{ width: 3, flex: 1, background: active ? step.color : "var(--border)", minHeight: 16 }} />
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: active ? step.color : "var(--border)", border: `3px solid ${active ? step.color : "var(--surface)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, zIndex: 1 }}>
            {active ? step.icon : "○"}
          </div>
          <div style={{ width: 3, flex: 1, background: active ? step.color : "var(--border)", minHeight: 16 }} />
        </div>
        <div style={{ flex: 1, margin: "8px 0 8px 12px", background: active ? "var(--surface)" : "var(--bg)", border: `1px solid ${active ? step.color + "55" : "var(--border)"}`, borderRadius: 8, padding: active ? "14px 16px" : "10px 16px", opacity: active ? 1 : 0.45 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: active ? 8 : 0 }}>
            <span style={{ color: active ? step.color : "var(--border)", fontWeight: "bold", fontSize: 13 }}>{step.label}</span>
            {!active && <span style={{ color: "var(--border)", fontSize: 11 }}>— not linked</span>}
          </div>
          {active && children}
        </div>
      </div>
    );
  };

  // ──── ROLL TRACEABILITY VIEW ────
  const renderRollChain = () => {
    if (!chain) return null;
    const rollWs = chain.roll?.warehouse_status;
    const rollStatus = chain.roll?.status;
    return (
      <>
        <div style={{ background: "var(--surface)", border: "2px solid var(--gold)", borderRadius: 10, padding: "16px 20px", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: 20 }}>{chain.roll.roll_id}</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>{chain.roll.machine_name} · {chain.roll.operator_name || "No operator"}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <StatusBadge status={rollStatus} />
              {rollWs && <StatusBadge status={`WH: ${rollWs}`} />}
            </div>
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 12, flexWrap: "wrap" }}>
            {[["Weight", `${parseFloat(chain.roll.actual_weight_kg || 0).toFixed(2)} kg`],
              ["Shift", chain.roll.shift === "D" ? "☀ Day" : "🌙 Night"],
              ["Fabric", chain.roll.fabric_type || "—"],
              ["Closed", chain.roll.closed_at ? new Date(chain.roll.closed_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : "—"],
              ["Approved", chain.roll.approved_at ? new Date(chain.roll.approved_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : "—"],
            ].map(([l, v]) => (
              <div key={l}><div style={{ color: "var(--muted)", fontSize: 10 }}>{l}</div><div style={{ fontSize: 13 }}>{v}</div></div>
            ))}
            {chain.roll.qr_image && (
              <img src={chain.roll.qr_image} alt="QR" title="Click to print" style={{ width: 56, height: 56, cursor: "pointer", marginLeft: "auto" }}
                onClick={() => { const w = window.open(); w.document.write(`<img src="${chain.roll.qr_image}" style="width:280px"/><p style="font-family:monospace;font-size:16px;margin-top:8px">${chain.roll.roll_id}</p>`); }} />
            )}
          </div>
        </div>

        <div style={{ paddingLeft: 4 }}>
          <StepCard step={STEPS[0]} data={chain.grn}>
            {field("GRN Number", chain.grn?.grn_number, "var(--yellow)")}
            {field("Supplier", chain.grn?.supplier_name)}
            {field("Receipt Date", chain.grn?.receipt_date?.slice(0, 10))}
          </StepCard>
          <StepCard step={STEPS[1]} data={chain.yarnLot}>
            {field("Lot Number", chain.yarnLot?.lot_number, "var(--yellow)")}
            {field("Yarn Type", `${chain.yarnLot?.yarn_type}${chain.yarnLot?.count ? " · " + chain.yarnLot.count : ""}`)}
            {field("Color", chain.yarnLot?.color)}
            {field("Net Weight", `${parseFloat(chain.yarnLot?.net_weight_kg || 0).toFixed(2)} kg received`)}
            {chain.yarnLot?.qr_image && <img src={chain.yarnLot.qr_image} alt="QR" style={{ width: 40, height: 40 }} />}
          </StepCard>
          <StepCard step={STEPS[2]} data={chain.yarnIssue}>
            {field("Issue Number", chain.yarnIssue?.issue_number, "var(--yellow)")}
            {field("Issued To", chain.yarnIssue?.machine_name)}
            {field("Date", chain.yarnIssue?.issue_date?.slice(0, 10))}
            {field("Issued By", chain.yarnIssue?.issued_by)}
          </StepCard>
          <StepCard step={STEPS[3]} data={chain.roll}>
            {field("Machine", chain.roll.machine_name, "var(--yellow)")}
            {field("Operator", chain.roll.operator_name)}
            {field("Shift", chain.roll.shift === "D" ? "Day" : "Night")}
            {field("Weight", `${parseFloat(chain.roll.actual_weight_kg || 0).toFixed(2)} kg`)}
            {field("Approved By", chain.roll.supervisor_name)}
          </StepCard>
          <StepCard step={STEPS[4]} data={chain.batch}>
            {field("Batch Number", chain.batch?.batch_number, "var(--yellow)")}
            {field("Fabric Type", chain.batch?.fabric_type)}
            {field("Color", chain.batch?.color_name)}
            {field("Status", chain.batch?.status)}
            {field("Total Weight", `${parseFloat(chain.batch?.total_weight_kg || 0).toFixed(2)} kg`)}
          </StepCard>
          <StepCard step={STEPS[5]} data={chain.challan}>
            {field("Challan", chain.challan?.challan_number, "var(--yellow)")}
            {field("Vendor", chain.challan?.vendor_name)}
            {field("Job Type", chain.challan?.job_type?.replace("_", " "))}
            {field("Sent Date", chain.challan?.sent_date?.slice(0, 10))}
            {field("Sent Weight", `${parseFloat(chain.challan?.sent_weight_kg || 0).toFixed(2)} kg`)}
          </StepCard>
          <StepCard step={STEPS[6]} data={chain.receipt}>
            {field("Received Date", chain.receipt?.received_date?.slice(0, 10), "var(--yellow)")}
            {field("Received Weight", `${parseFloat(chain.receipt?.received_weight_kg || 0).toFixed(2)} kg`)}
            {field("Rejected", `${parseFloat(chain.receipt?.rejected_weight_kg || 0).toFixed(2)} kg`)}
            {field("Quality", chain.receipt?.quality_status)}
            {field("Received By", chain.receipt?.received_by)}
          </StepCard>
          <StepCard step={STEPS[7]} data={chain.finishing}>
            {field("Shade", chain.finishing?.shade, "var(--yellow)")}
            {field("GSM", chain.finishing?.gsm ? `${chain.finishing.gsm} g/m²` : null)}
            {field("Moisture", chain.finishing?.moisture_pct ? `${chain.finishing.moisture_pct}%` : null)}
            {field("Shrinkage", chain.finishing?.shrinkage_pct ? `${chain.finishing.shrinkage_pct}%` : null)}
            {field("Damage", chain.finishing?.damage_kg ? `${chain.finishing.damage_kg} kg` : null)}
            {field("QA Result", chain.finishing?.qa_passed === false ? "FAIL ✗" : "PASS ✓", chain.finishing?.qa_passed === false ? "var(--crit)" : "var(--green)")}
            {field("QA Notes", chain.finishing?.qa_notes)}
            {field("Finished By", chain.finishing?.finished_by)}
          </StepCard>
          <StepCard step={STEPS[8]} data={chain.finishedGoods}>
            {field("FG Status", chain.finishedGoods?.status, chain.finishedGoods?.status === "IN_STOCK" ? "var(--green)" : chain.finishedGoods?.status === "HOLD" ? "var(--crit)" : "var(--muted)")}
            {field("Location", chain.finishedGoods?.location)}
            {field("Weight", `${parseFloat(chain.finishedGoods?.weight_kg || 0).toFixed(2)} kg`)}
          </StepCard>
          <StepCard step={STEPS[9]} data={chain.dispatch}>
            {field("Dispatch No", chain.dispatch?.dispatch_number, "var(--yellow)")}
            {field("Customer", chain.dispatch?.customer_name)}
            {field("Dispatch Date", chain.dispatch?.dispatch_date?.slice(0, 10))}
            {field("Vehicle", chain.dispatch?.vehicle_number)}
            {field("Invoice", chain.dispatch?.invoice_number)}
            {field("Weight Dispatched", `${parseFloat(chain.dispatch?.weight_kg || 0).toFixed(2)} kg`)}
          </StepCard>
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", marginTop: 16 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>JOURNEY SUMMARY</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {STEPS.map((step, i) => {
              const keys = ["grn","yarnLot","yarnIssue","roll","batch","challan","receipt","finishing","finishedGoods","dispatch"];
              const active = !!chain[keys[i]];
              return (
                <React.Fragment key={step.key}>
                  <span style={{ background: active ? step.color + "22" : "var(--bg)", color: active ? step.color : "var(--border)", border: `1px solid ${active ? step.color : "var(--border)"}`, borderRadius: 4, padding: "3px 10px", fontSize: 11, fontWeight: active ? "bold" : 400 }}>
                    {step.icon} {step.label}
                  </span>
                  {i < STEPS.length - 1 && <span style={{ color: "var(--surface)", fontSize: 14 }}>→</span>}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  // ──── LOT TRACEABILITY VIEW ────
  const renderLotChain = () => {
    if (!lotData) return null;
    const { lot, grn, issues, downstream, totalRolls } = lotData;
    const totalFabricKg = downstream.reduce((s, d) => s + parseFloat(d.roll.weight_kg || 0), 0);
    const dispatched = downstream.filter(d => d.dispatch);
    const inStock = downstream.filter(d => d.fg && !d.dispatch);
    const inProcess = downstream.filter(d => d.challan && !d.fg);

    return (
      <>
        {/* Lot header */}
        <div style={{ background: "var(--surface)", border: "2px solid var(--purple)", borderRadius: 10, padding: "16px 20px", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ color: "var(--purple)", fontWeight: "bold", fontSize: 20 }}>LOT: {lot.lot_number}</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>{lot.yarn_type}{lot.brand ? ` · ${lot.brand}` : ""}{lot.color ? ` · ${lot.color}` : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {grn && <span style={{ background: "#6366f122", color: "var(--purple)", border: "1px solid var(--purple)", borderRadius: 4, padding: "3px 10px", fontSize: 11 }}>{grn.grn_number}</span>}
            </div>
          </div>

          {/* KPI row */}
          <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
            {[
              ["Received", `${parseFloat(lot.net_weight_kg || 0).toFixed(1)} kg`, "var(--purple)"],
              ["Current Stock", `${parseFloat(lot.current_stock_kg || 0).toFixed(1)} kg`, parseFloat(lot.current_stock_kg || 0) > 0 ? "var(--green)" : "var(--crit)"],
              ["Issues", `${issues.length}`, "var(--purple)"],
              ["Rolls Produced", `${totalRolls}`, "var(--yellow)"],
              ["Fabric Output", `${totalFabricKg.toFixed(1)} kg`, "var(--gold)"],
              ["Dispatched", `${dispatched.length}`, "var(--link)"],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: color + "11", border: `1px solid ${color}33`, borderRadius: 8, padding: "10px 16px", minWidth: 100 }}>
                <div style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase" }}>{label}</div>
                <div style={{ color, fontWeight: "bold", fontSize: 18, marginTop: 2 }}>{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* GRN source */}
        {grn && (
          <div style={{ background: "var(--surface)", border: "1px solid #6366f155", borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ color: "var(--purple)", fontWeight: "bold", fontSize: 13, marginBottom: 6 }}>📥 Source — GRN</div>
            {field("GRN Number", grn.grn_number, "var(--yellow)")}
            {field("Supplier", grn.supplier_name)}
            {field("Receipt Date", grn.receipt_date?.slice(0, 10))}
            {field("Rate/kg", lot.rate_per_kg ? `₹${parseFloat(lot.rate_per_kg).toFixed(2)}` : "—")}
          </div>
        )}

        {/* Yarn Issues */}
        <div style={{ background: "var(--surface)", border: "1px solid #a78bfa55", borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ color: "var(--purple)", fontWeight: "bold", fontSize: 13, marginBottom: 8 }}>🚀 Yarn Issues ({issues.length})</div>
          {issues.length === 0 && <div style={{ color: "var(--border)", fontSize: 13 }}>No issues yet — yarn still in store</div>}
          {issues.map((iss, i) => (
            <div key={i} style={{ display: "flex", gap: 16, alignItems: "center", padding: "8px 0", borderBottom: i < issues.length - 1 ? "1px solid var(--border)" : "none", flexWrap: "wrap" }}>
              <span style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: 13, minWidth: 110 }}>{iss.issue_number}</span>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>→ {iss.machine_name || "—"}</span>
              <span style={{ color: "var(--text)", fontSize: 12 }}>{parseFloat(iss.issued_kg || 0).toFixed(1)} kg</span>
              <span style={{ color: "var(--border)", fontSize: 11 }}>{iss.issue_date?.slice(0, 10)}</span>
            </div>
          ))}
        </div>

        {/* Downstream — Rolls & beyond */}
        <div style={{ background: "var(--surface)", border: "1px solid #f4ae1f55", borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: 13, marginBottom: 8 }}>🧶 Fabric Produced ({totalRolls} rolls)</div>
          {downstream.length === 0 && <div style={{ color: "var(--border)", fontSize: 13 }}>No rolls produced yet</div>}
          {downstream.map((d, i) => {
            const stages = [];
            stages.push({ label: "Roll", icon: "🧶", done: true });
            stages.push({ label: "Batch", icon: "📦", done: !!d.batch });
            stages.push({ label: "SC", icon: "🎨", done: !!d.challan });
            stages.push({ label: "Received", icon: "📋", done: !!d.receipt });
            stages.push({ label: "FG", icon: "✅", done: !!d.fg });
            stages.push({ label: "Dispatched", icon: "📤", done: !!d.dispatch });

            return (
              <div key={i} style={{ padding: "10px 0", borderBottom: i < downstream.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                  <span
                    style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => { switchMode("roll"); setTimeout(() => loadRoll(d.roll.roll_id), 50); }}
                  >{d.roll.roll_id}</span>
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{d.roll.machine_name}</span>
                  <span style={{ color: "var(--text)", fontSize: 12 }}>{parseFloat(d.roll.weight_kg || 0).toFixed(1)} kg</span>
                  <span style={{ color: "var(--border)", fontSize: 11 }}>{d.roll.produced_at?.slice(0, 10)}</span>
                  {d.roll.status && <StatusBadge status={d.roll.warehouse_status || d.roll.status} />}
                </div>
                {/* Mini journey bar */}
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {stages.map((s, si) => (
                    <React.Fragment key={si}>
                      <span style={{ fontSize: 10, color: s.done ? "var(--green)" : "var(--border)", padding: "1px 6px", background: s.done ? "#22c55e11" : "transparent", borderRadius: 3 }}>
                        {s.icon} {s.label}
                      </span>
                      {si < stages.length - 1 && <span style={{ color: "var(--surface)", fontSize: 10 }}>→</span>}
                    </React.Fragment>
                  ))}
                </div>
                {d.dispatch && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "var(--link)" }}>
                    Dispatched to {d.dispatch.customer_name} on {d.dispatch.dispatch_date?.slice(0, 10)} — {d.dispatch.dispatch_number}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Summary */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", marginTop: 8 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>LOT JOURNEY SUMMARY</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { label: "GRN", icon: "📥", active: !!grn },
              { label: "Yarn Lot", icon: "🧵", active: true },
              { label: "Yarn Issues", icon: "🚀", active: issues.length > 0 },
              { label: `${totalRolls} Rolls`, icon: "🧶", active: totalRolls > 0 },
              { label: `${inProcess.length} In Process`, icon: "🎨", active: inProcess.length > 0 },
              { label: `${inStock.length} In Stock`, icon: "✅", active: inStock.length > 0 },
              { label: `${dispatched.length} Dispatched`, icon: "📤", active: dispatched.length > 0 },
            ].map((s, i) => (
              <React.Fragment key={i}>
                <span style={{ background: s.active ? "#8b5cf622" : "var(--bg)", color: s.active ? "var(--purple)" : "var(--border)", border: `1px solid ${s.active ? "var(--purple)" : "var(--border)"}`, borderRadius: 4, padding: "3px 10px", fontSize: 11, fontWeight: s.active ? "bold" : 400 }}>
                  {s.icon} {s.label}
                </span>
                {i < 6 && <span style={{ color: "var(--surface)", fontSize: 14 }}>→</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
      </>
    );
  };

  return (
    <div style={{ padding: 20, color: "var(--text)", maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 6px", color: "var(--yellow)" }}>🔍 Traceability</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Full genealogy chain: Raw Material → Production → Warehouse → Dispatch
      </div>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
        {[["roll", "🧶 By Roll ID"], ["lot", "🧵 By Lot No"]].map(([m, label]) => (
          <button key={m} onClick={() => switchMode(m)}
            style={{
              flex: 1, padding: "10px 16px", border: "1px solid var(--gold)",
              background: mode === m ? "var(--yellow)" : "transparent",
              color: mode === m ? "var(--bg)" : "var(--yellow)",
              fontWeight: "bold", fontSize: 13, cursor: "pointer",
              borderRadius: m === "roll" ? "8px 0 0 8px" : "0 8px 8px 0",
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Search box */}
      <div style={{ position: "relative", marginBottom: 28 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={query}
            onChange={e => search(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLoad()}
            placeholder={mode === "roll" ? "Search roll ID (e.g. SJ01-C40-240701-D-001)..." : "Search lot number, yarn type, or brand..."}
            style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--gold)", borderRadius: 8, padding: "12px 16px", color: "var(--text)", fontSize: 14 }}
          />
          <button onClick={handleLoad} disabled={loading}
            style={{ background: "var(--yellow)", color: "var(--bg)", border: "none", borderRadius: 8, padding: "12px 24px", fontWeight: "bold", cursor: "pointer", fontSize: 14 }}>
            {loading ? "..." : "Trace"}
          </button>
        </div>

        {/* Autocomplete */}
        {suggestions.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 60, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, zIndex: 100, marginTop: 4, overflow: "hidden" }}>
            {mode === "roll" ? suggestions.map(s => (
              <div key={s.roll_id} onClick={() => loadRoll(s.roll_id)}
                style={{ padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--border)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: 13 }}>{s.roll_id}</span>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{s.machine_name} · {s.warehouse_status || s.status} · {parseFloat(s.actual_weight_kg || 0).toFixed(1)}kg</span>
              </div>
            )) : suggestions.map(s => (
              <div key={s.lot_number} onClick={() => loadLot(s.lot_number)}
                style={{ padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--border)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{ color: "var(--purple)", fontWeight: "bold", fontSize: 13 }}>{s.lot_number}</span>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{s.yarn_type}{s.brand ? ` · ${s.brand}` : ""} · {parseFloat(s.net_weight_kg || 0).toFixed(1)}kg{s.supplier_name ? ` · ${s.supplier_name}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div style={{ background: "#ef444422", border: "1px solid var(--crit)", borderRadius: 8, padding: "12px 16px", color: "var(--crit)", marginBottom: 20 }}>{error}</div>}

      {mode === "roll" ? renderRollChain() : renderLotChain()}

      {!chain && !lotData && !loading && !error && (
        <div style={{ textAlign: "center", color: "var(--border)", marginTop: 80 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{mode === "roll" ? "🧶" : "🧵"}</div>
          <div style={{ fontSize: 15, color: "var(--muted)" }}>
            {mode === "roll" ? "Search for a roll ID to view its full production chain" : "Search for a yarn lot number to trace it through the factory"}
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {mode === "roll" ? "e.g. SJ01-C40-240701-D-001" : "e.g. LOT-001, or search by yarn type"}
          </div>
        </div>
      )}
    </div>
  );
}
