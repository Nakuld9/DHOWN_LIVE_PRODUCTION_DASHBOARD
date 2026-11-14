import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";

const STATUS = { PLANNED: "var(--muted)", IN_PROGRESS: "var(--link)", ON_HOLD: "var(--gold)", COMPLETED: "var(--green)", CANCELLED: "var(--crit)" };
const PRIORITY = { LOW: "var(--muted)", MEDIUM: "var(--link)", HIGH: "var(--gold)", URGENT: "var(--crit)" };

const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: "var(--text)", fontSize: 14, boxSizing: "border-box" };
const lbl = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block" };
const th = { padding: "10px 8px", textAlign: "left", color: "var(--yellow)", fontSize: 13, borderBottom: "2px solid var(--surface)", whiteSpace: "nowrap" };
const td = { padding: "10px 8px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: 14 };
const btn = (bg, fg = "#000") => ({ background: bg, color: fg, border: "none", padding: "6px 12px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 12 });

const emptyPlan = () => ({
  item_name: "", target_qty_kg: "", machine_id: "", priority: "MEDIUM", plan_type: "MTS",
  planned_start: new Date().toISOString().slice(0, 10), planned_end: "", so_id: "", so_number: "", notes: "",
});

const PLAN_TYPE = { MTO: { label: "Make to Order", color: "var(--purple)" }, MTS: { label: "Make to Stock", color: "#2dd4bf" } };

function ProgressBar({ produced, target }) {
  const pct = target > 0 ? Math.min(100, Math.round((produced / target) * 100)) : 0;
  return (
    <div>
      <div style={{ background: "var(--surface)", borderRadius: 6, height: 16, overflow: "hidden", border: "1px solid var(--border)" }}>
        <div style={{ width: pct + "%", height: "100%", background: pct >= 100 ? "var(--green)" : "var(--link)", transition: "width .3s" }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{Number(produced || 0)} / {Number(target || 0)} kg ({pct}%)</div>
    </div>
  );
}

const DAY = 86400000;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

// Gantt-style machine schedule — one row per plan, bar positioned by planned
// start→end, coloured by status, with a progress fill and a "today" marker.
function GanttView({ plans }) {
  const withDates = plans.filter(p => p.planned_start);
  if (!withDates.length) return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 40, textAlign: "center", color: "var(--muted)" }}>
      No scheduled plans to chart — add a <b style={{ color: "var(--text)" }}>Planned Start</b> (and End) to see them on the timeline.
    </div>
  );
  const dayW = 38, labelW = 220;
  let rangeStart = startOfDay(Math.min(...withDates.map(p => new Date(p.planned_start).getTime())));
  let rangeEnd = startOfDay(Math.max(...withDates.map(p => new Date(p.planned_end || p.planned_start).getTime())));
  rangeStart = Math.min(rangeStart, startOfDay(Date.now()));
  let totalDays = Math.round((rangeEnd - rangeStart) / DAY) + 1;
  if (totalDays < 14) { rangeEnd = rangeStart + 13 * DAY; totalDays = 14; }
  if (totalDays > 90) { rangeEnd = rangeStart + 89 * DAY; totalDays = 90; }
  const idx = (t) => Math.round((startOfDay(t) - rangeStart) / DAY);
  const width = totalDays * dayW;
  const todayIdx = idx(Date.now());
  const rows = [...withDates].sort((a, b) => (a.machine_id || "~").localeCompare(b.machine_id || "~") || new Date(a.planned_start) - new Date(b.planned_start));
  const days = Array.from({ length: totalDays }, (_, i) => new Date(rangeStart + i * DAY));

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: labelW + width }}>
          {/* Header ticks */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--surface-2)" }}>
            <div style={{ width: labelW, flex: "none", padding: "8px 12px", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)" }}>Machine · Plan</div>
            <div style={{ position: "relative", height: 34 }}>
              {days.map((d, i) => {
                const wknd = d.getDay() === 0 || d.getDay() === 6;
                const mStart = d.getDate() === 1 || i === 0;
                return (
                  <div key={i} style={{ position: "absolute", left: i * dayW, width: dayW, top: 0, bottom: 0, borderLeft: `1px solid ${mStart ? "var(--border)" : "var(--border-soft)"}`, background: wknd ? "#ffffff05" : "transparent", textAlign: "center", paddingTop: 4 }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: mStart ? "var(--yellow)" : "var(--muted)", fontWeight: mStart ? 700 : 400 }}>{d.getDate()}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 8, color: "var(--faint)", textTransform: "uppercase" }}>{d.toLocaleDateString("en-GB", { month: "short" }).slice(0, 3)}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Rows */}
          <div style={{ position: "relative" }}>
            {/* today line spanning all rows */}
            {todayIdx >= 0 && todayIdx < totalDays && (
              <div style={{ position: "absolute", left: labelW + todayIdx * dayW + dayW / 2, top: 0, bottom: 0, width: 2, background: "var(--yellow)", opacity: .5, zIndex: 2, pointerEvents: "none" }} />
            )}
            {rows.map((p) => {
              const s = idx(p.planned_start);
              const e = Math.max(s, idx(p.planned_end || p.planned_start));
              const span = e - s + 1;
              const col = STATUS[p.status] || "var(--muted)";
              const prog = p.target_qty_kg > 0 ? Math.min(100, Math.round((Number(p.produced_qty_kg || 0) / Number(p.target_qty_kg)) * 100)) : 0;
              return (
                <div key={p.plan_id} style={{ display: "flex", alignItems: "center", height: 42, borderBottom: "1px solid var(--border-soft)" }}>
                  <div style={{ width: labelW, flex: "none", padding: "0 12px", overflow: "hidden" }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.machine_id || "Unassigned"}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.item_name}</div>
                  </div>
                  <div style={{ position: "relative", height: "100%", flex: 1 }}>
                    <div title={`${p.plan_number} · ${p.item_name} · ${p.status} · ${p.produced_qty_kg || 0}/${p.target_qty_kg} kg`}
                      style={{ position: "absolute", left: s * dayW + 2, width: Math.max(dayW - 4, span * dayW - 4), top: 8, height: 26, background: `${col}22`, border: `1px solid ${col}`, borderRadius: 6, overflow: "hidden", cursor: "default", display: "flex", alignItems: "center" }}>
                      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${prog}%`, background: `${col}44` }} />
                      <span style={{ position: "relative", padding: "0 8px", fontSize: 11, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{Number(p.target_qty_kg) || 0}kg · {prog}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, padding: "10px 14px", borderTop: "1px solid var(--border)", flexWrap: "wrap", fontFamily: "var(--mono)", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".05em" }}>
        {Object.entries(STATUS).map(([k, c]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: c, display: "inline-block" }} />{k.replace("_", " ")}</span>)}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}><i style={{ width: 2, height: 12, background: "var(--yellow)", display: "inline-block" }} />Today</span>
      </div>
    </div>
  );
}

export default function ProductionPlanning() {
  const [view, setView] = useState("list");
  const [plans, setPlans] = useState([]);
  const [filter, setFilter] = useState("");
  const [ptFilter, setPtFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyPlan());
  const [saving, setSaving] = useState(false);
  const [machines, setMachines] = useState([]);
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [msg, setMsg] = useState("");
  const [progEdit, setProgEdit] = useState(null); // plan_id being progress-edited
  const [progVal, setProgVal] = useState("");

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (filter) p.set("status", filter);
    if (ptFilter) p.set("plan_type", ptFilter);
    const qs = p.toString();
    try { const r = await fetch(`${API}/api/production-plans${qs ? `?${qs}` : ""}`); const d = await r.json(); setPlans(Array.isArray(d) ? d : []); } catch {}
  }, [filter, ptFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch(`${API}/api/machines`, { headers: h() }).then(r => r.json()).then(d => setMachines(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${API}/api/erp/items?limit=500`).then(r => r.json()).then(d => setItems(d.data || d.items || (Array.isArray(d) ? d : []))).catch(() => {});
    fetch(`${API}/api/sales-orders`).then(r => r.json()).then(d => setOrders(d.data || [])).catch(() => {});
  }, []);

  const flash = (m, ok = true) => { setMsg((ok ? "✓ " : "✗ ") + m); setTimeout(() => setMsg(""), 3000); };

  const onSO = sid => {
    const so = orders.find(x => String(x.so_id) === String(sid));
    // Linking a sales order makes it make-to-order; clearing it reverts to make-to-stock.
    setForm(f => ({ ...f, so_id: sid, so_number: so ? so.so_number : "", plan_type: sid ? "MTO" : "MTS" }));
  };

  const create = async () => {
    if (!form.item_name.trim()) { flash("Fabric/item is required", false); return; }
    if (!(Number(form.target_qty_kg) > 0)) { flash("Target quantity must be > 0", false); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/production-plans`, {
        method: "POST", headers: h(), body: JSON.stringify({ ...form, so_id: form.so_id || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      const p = await res.json();
      flash(`Created ${p.plan_number}`); setForm(emptyPlan()); setShowNew(false); load();
    } catch (e) { flash(e.message, false); } finally { setSaving(false); }
  };

  const act = async (id, path, label) => {
    try {
      const res = await fetch(`${API}/api/production-plans/${id}/${path}`, { method: "PUT", headers: h() });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      flash(label); load();
    } catch (e) { flash(e.message, false); }
  };

  const saveProgress = async id => {
    try {
      const res = await fetch(`${API}/api/production-plans/${id}/progress`, {
        method: "PUT", headers: h(), body: JSON.stringify({ produced_qty_kg: progVal }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      flash("Progress updated"); setProgEdit(null); setProgVal(""); load();
    } catch (e) { flash(e.message, false); }
  };

  const del = async id => {
    if (!window.confirm("Delete this production plan?")) return;
    try {
      const res = await fetch(`${API}/api/production-plans/${id}`, { method: "DELETE", headers: h() });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      flash("Deleted"); load();
    } catch (e) { flash(e.message, false); }
  };

  return (
    <div style={{ padding: 30, color: "var(--text)", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", fontSize: 24, margin: 0 }}>PRODUCTION PLANNING</h1>
          <p style={{ color: "var(--muted)", margin: "4px 0 0" }}>Plan fabric targets per machine, track progress against demand</p>
        </div>
        <button onClick={() => setShowNew(s => !s)} style={btn(showNew ? "var(--crit)" : "var(--green)", showNew ? "var(--text)" : "#000")}>
          {showNew ? "✕ Cancel" : "+ New Plan"}
        </button>
      </div>

      {msg && <div style={{ marginBottom: 14, color: msg[0] === "✓" ? "var(--green)" : "var(--crit)", fontWeight: "bold" }}>{msg}</div>}

      {showNew && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <h3 style={{ color: "var(--yellow)", marginTop: 0 }}>New Production Plan</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
            <div>
              <label style={lbl}>Fabric / Item *</label>
              <input list="pp-items" style={inp} placeholder="Fabric name" value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} />
              <datalist id="pp-items">{items.map(it => <option key={it.item_id} value={it.item_name} />)}</datalist>
            </div>
            <div><label style={lbl}>Target Qty (kg) *</label><input type="number" min="0" style={inp} value={form.target_qty_kg} onChange={e => setForm(f => ({ ...f, target_qty_kg: e.target.value }))} /></div>
            <div>
              <label style={lbl}>Machine</label>
              <select style={inp} value={form.machine_id} onChange={e => setForm(f => ({ ...f, machine_id: e.target.value }))}>
                <option value="">— Unassigned —</option>
                {machines.map(m => <option key={m.machine_id} value={m.machine_id}>{m.machine_id} — {m.machine_name}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Priority</label>
              <select style={inp} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {["LOW", "MEDIUM", "HIGH", "URGENT"].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Plan Type</label>
              <select style={inp} value={form.plan_type} onChange={e => setForm(f => ({ ...f, plan_type: e.target.value }))}>
                <option value="MTS">Make to Stock</option>
                <option value="MTO">Make to Order</option>
              </select>
            </div>
            <div><label style={lbl}>Planned Start</label><input type="date" style={inp} value={form.planned_start} onChange={e => setForm(f => ({ ...f, planned_start: e.target.value }))} /></div>
            <div><label style={lbl}>Planned End</label><input type="date" style={inp} value={form.planned_end} onChange={e => setForm(f => ({ ...f, planned_end: e.target.value }))} /></div>
            <div>
              <label style={lbl}>Link Sales Order (optional)</label>
              <select style={inp} value={form.so_id} onChange={e => onSO(e.target.value)}>
                <option value="">— None —</option>
                {orders.map(so => <option key={so.so_id} value={so.so_id}>{so.so_number} — {so.customer_name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={lbl}>Notes</label>
            <textarea style={{ ...inp, minHeight: 50 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <button onClick={create} disabled={saving} style={{ ...btn(saving ? "#888" : "var(--yellow)"), marginTop: 14, padding: "10px 24px", fontSize: 14 }}>
            {saving ? "Saving…" : "Create Plan"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        {["", "PLANNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ ...btn(filter === s ? "var(--yellow)" : "var(--surface)", filter === s ? "#000" : "var(--muted)"), border: "1px solid var(--border)" }}>
            {s || "All"}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>Type:</span>
        {[["", "All"], ["MTS", "Make to Stock"], ["MTO", "Make to Order"]].map(([v, label]) => (
          <button key={v} onClick={() => setPtFilter(v)} style={{ ...btn(ptFilter === v ? (v ? PLAN_TYPE[v].color : "var(--yellow)") : "var(--surface)", ptFilter === v ? "#000" : "var(--muted)"), border: "1px solid var(--border)" }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["list", "▤ List"], ["gantt", "▦ Timeline"]].map(([v, l]) => (
          <button key={v} onClick={() => setView(v)} style={{ ...btn(view === v ? "var(--yellow)" : "var(--surface)", view === v ? "#000" : "var(--muted)"), border: "1px solid var(--border)" }}>{l}</button>
        ))}
      </div>

      {view === "gantt" ? <GanttView plans={plans} /> : (
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflowX: "auto" }}>
        <table width="100%" style={{ borderCollapse: "collapse", minWidth: 1000 }}>
          <thead><tr>{["Plan #", "Type", "Fabric", "Machine", "Priority", "Schedule", "Progress", "SO", "Status", "Actions"].map(x => <th key={x} style={th}>{x}</th>)}</tr></thead>
          <tbody>
            {plans.length === 0 && <tr><td colSpan="10" style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontStyle: "italic" }}>No production plans{filter ? ` in ${filter}` : ""}.</td></tr>}
            {plans.map(p => (
              <tr key={p.plan_id}>
                <td style={{ ...td, fontWeight: "bold", color: "var(--yellow)" }}>{p.plan_number}</td>
                <td style={td}><span style={{ background: (PLAN_TYPE[p.plan_type]?.color || "#555") + "22", color: PLAN_TYPE[p.plan_type]?.color || "#aaa", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: "bold" }}>{p.plan_type || "MTS"}</span></td>
                <td style={td}>{p.item_name}</td>
                <td style={td}>{p.machine_id || <span style={{ color: "var(--muted)" }}>—</span>}</td>
                <td style={td}><span style={{ color: PRIORITY[p.priority] || "#aaa", fontWeight: "bold", fontSize: 12 }}>{p.priority}</span></td>
                <td style={{ ...td, fontSize: 12, color: "var(--muted)" }}>{fmtDate(p.planned_start)} → {fmtDate(p.planned_end)}</td>
                <td style={{ ...td, minWidth: 140 }}>
                  {progEdit === p.plan_id ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <input type="number" style={{ ...inp, padding: "4px 6px", width: 80 }} value={progVal} onChange={e => setProgVal(e.target.value)} autoFocus />
                      <button onClick={() => saveProgress(p.plan_id)} style={btn("var(--green)")}>✓</button>
                      <button onClick={() => setProgEdit(null)} style={btn("var(--crit-dim)", "var(--text)")}>✕</button>
                    </div>
                  ) : (
                    <div onClick={() => { if (!["COMPLETED", "CANCELLED"].includes(p.status)) { setProgEdit(p.plan_id); setProgVal(String(p.produced_qty_kg || "")); } }} style={{ cursor: ["COMPLETED", "CANCELLED"].includes(p.status) ? "default" : "pointer" }}>
                      <ProgressBar produced={p.produced_qty_kg} target={p.target_qty_kg} />
                    </div>
                  )}
                </td>
                <td style={{ ...td, fontSize: 12 }}>{p.so_number || "—"}</td>
                <td style={td}><span style={{ background: (STATUS[p.status] || "#555") + "33", color: STATUS[p.status] || "#aaa", padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: "bold" }}>{p.status.replace("_", " ")}</span></td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {p.status === "PLANNED" && <button onClick={() => act(p.plan_id, "start", "Started")} style={btn("var(--link)", "var(--text)")}>Start</button>}
                    {p.status === "IN_PROGRESS" && <button onClick={() => act(p.plan_id, "complete", "Completed")} style={btn("var(--green)")}>Complete</button>}
                    {["PLANNED", "IN_PROGRESS"].includes(p.status) && <button onClick={() => act(p.plan_id, "hold", "On hold")} style={btn("var(--gold)")}>Hold</button>}
                    {p.status === "ON_HOLD" && <button onClick={() => act(p.plan_id, "start", "Resumed")} style={btn("var(--link)", "var(--text)")}>Resume</button>}
                    {!["COMPLETED", "CANCELLED"].includes(p.status) && <button onClick={() => act(p.plan_id, "cancel", "Cancelled")} style={btn("var(--crit-dim)", "var(--text)")}>Cancel</button>}
                    {p.status !== "IN_PROGRESS" && <button onClick={() => del(p.plan_id)} style={btn("var(--crit-dim)", "var(--crit-edge)")}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
