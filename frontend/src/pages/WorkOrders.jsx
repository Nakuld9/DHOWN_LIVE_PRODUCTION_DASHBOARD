import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const fmtDate = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : "—";
const ageOf = d => {
  if (!d) return "—";
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
};

const STATUS = { OPEN: "var(--gold)", IN_PROGRESS: "var(--link)", COMPLETED: "var(--green)", CANCELLED: "var(--crit)" };
const PRIORITY = { LOW: "var(--faint)", MEDIUM: "var(--muted)", HIGH: "var(--gold)", CRITICAL: "var(--crit)" };
const TYPES = ["BREAKDOWN", "PREVENTIVE", "ROUTINE", "CALIBRATION", "REPLACEMENT", "INSPECTION", "OTHER"];

const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: "var(--text)", fontSize: 14, boxSizing: "border-box", marginBottom: 10 };
const lbl = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block", fontFamily: "var(--mono)", letterSpacing: ".04em", textTransform: "uppercase" };
const empty = () => ({ machine_id: "", title: "", work_order_type: "BREAKDOWN", priority: "MEDIUM", assigned_to: "", description: "" });

// shared bits
const th = { fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--muted)", textAlign: "left", padding: "11px 12px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const td = { padding: "11px 12px", borderBottom: "1px solid var(--border-soft)", fontSize: 13, verticalAlign: "top" };
const pill = (c) => ({ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 99, background: `${c}1f`, color: c, border: `1px solid ${c}33`, display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" });
const sbtn = (bg, fg, brd) => ({ background: bg, color: fg, border: brd || "none", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" });

export default function WorkOrders() {
  const [orders, setOrders] = useState([]);
  const [machines, setMachines] = useState([]);
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState("table");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(empty());
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(null);
  const [comp, setComp] = useState({ downtime_hours: "", total_cost: "", resolution_notes: "" });
  const [partsWO, setPartsWO] = useState(null);
  const [parts, setParts] = useState([]);
  const [partsUsed, setPartsUsed] = useState([]);
  const [pForm, setPForm] = useState({ part_id: "", quantity: "", unit_cost: "" });

  const load = useCallback(async () => {
    try { const r = await fetch(`${API}/api/work-orders`, { headers: h() }); const d = await r.json(); setOrders(Array.isArray(d) ? d : []); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch(`${API}/api/machines`, { headers: h() }).then(r => r.json()).then(d => setMachines(Array.isArray(d) ? d : [])).catch(() => {}); }, []);

  const create = async () => {
    if (!form.machine_id || !form.title) { alert("Machine and title are required"); return; }
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/work-orders`, { method: "POST", headers: h(), body: JSON.stringify(form) });
      if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); setSaving(false); return; }
      setShowNew(false); setForm(empty()); await load();
    } catch { alert("Network error"); }
    setSaving(false);
  };

  const setStatus = async (id, status, extra) => {
    try {
      const r = await fetch(`${API}/api/work-orders/${id}/status`, { method: "PUT", headers: h(), body: JSON.stringify({ status, ...extra }) });
      if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); return; }
      await load();
    } catch { alert("Network error"); }
  };

  const del = async (id) => {
    if (!window.confirm("Delete this work order?")) return;
    const r = await fetch(`${API}/api/work-orders/${id}`, { method: "DELETE", headers: h() });
    if (!r.ok) { const e = await r.json(); alert(e.error); return; }
    load();
  };

  const openParts = async (wo) => {
    setPartsWO(wo); setPForm({ part_id: "", quantity: "", unit_cost: "" });
    try {
      const [cat, used] = await Promise.all([
        fetch(`${API}/api/spare-parts`, { headers: h() }).then(r => r.json()),
        fetch(`${API}/api/work-orders/${wo.id}/parts`, { headers: h() }).then(r => r.json()),
      ]);
      setParts(Array.isArray(cat) ? cat : []); setPartsUsed(Array.isArray(used) ? used : []);
    } catch {}
  };

  const addPart = async () => {
    if (!pForm.part_id || !pForm.quantity) { alert("Select a part and quantity"); return; }
    const r = await fetch(`${API}/api/work-orders/${partsWO.id}/parts`, {
      method: "POST", headers: h(),
      body: JSON.stringify({ part_id: pForm.part_id, quantity: pForm.quantity, unit_cost: pForm.unit_cost || 0 }),
    });
    const j = await r.json();
    if (!r.ok) { alert(j.error || "Failed"); return; }
    setPartsUsed(u => [...u, j]); setPForm({ part_id: "", quantity: "", unit_cost: "" });
    await load();
    fetch(`${API}/api/spare-parts`, { headers: h() }).then(r => r.json()).then(d => setParts(Array.isArray(d) ? d : [])).catch(() => {});
  };

  const submitComplete = async () => {
    await setStatus(completing.id, "COMPLETED", {
      downtime_hours: comp.downtime_hours ? parseFloat(comp.downtime_hours) : 0,
      total_cost: comp.total_cost ? parseFloat(comp.total_cost) : 0,
      resolution_notes: comp.resolution_notes || null,
    });
    setCompleting(null); setComp({ downtime_hours: "", total_cost: "", resolution_notes: "" });
  };

  const counts = orders.reduce((a, o) => { a[o.status] = (a[o.status] || 0) + 1; return a; }, {});
  const openActive = orders.filter(o => o.status === "OPEN" || o.status === "IN_PROGRESS");
  const criticalOpen = openActive.filter(o => o.priority === "CRITICAL" || o.priority === "HIGH").length;
  const downtimeH = orders.reduce((s, o) => s + (parseFloat(o.downtime_hours) || 0), 0);
  const cost = orders.reduce((s, o) => s + (parseFloat(o.total_cost) || 0), 0);

  const visible = orders.filter(o =>
    (!filter || o.status === filter) &&
    (!q || `${o.title} ${o.machine_name || o.machine_id} ${o.work_order_type} ${o.assigned_to || ""}`.toLowerCase().includes(q.toLowerCase()))
  );

  const KPI = ({ label, value, rail, tone }) => (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, padding: "12px 13px", position: "relative", overflow: "hidden", flex: 1, minWidth: 120 }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: rail }} />
      <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 8, lineHeight: 1, color: tone || "var(--text)" }}>{value}</div>
    </div>
  );

  return (
    <div style={{ padding: 20, color: "var(--text)", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 7 }}>Maintenance</div>
          <h1 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, fontSize: 24, letterSpacing: ".02em", textTransform: "uppercase" }}>Work Orders</h1>
        </div>
        <button onClick={() => setShowNew(true)} style={{ background: "var(--yellow)", color: "var(--on-gold)", border: "none", padding: "10px 18px", borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>+ New Work Order</button>
      </div>

      {/* KPI strip */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <KPI label="Open" value={counts.OPEN || 0} rail="var(--gold)" tone="var(--gold)" />
        <KPI label="In Progress" value={counts.IN_PROGRESS || 0} rail="var(--link)" tone="var(--link)" />
        <KPI label="High / Critical" value={criticalOpen} rail="var(--crit)" tone={criticalOpen ? "var(--crit)" : "var(--text)"} />
        <KPI label="Completed" value={counts.COMPLETED || 0} rail="var(--green)" tone="var(--green)" />
        <KPI label="Downtime (h)" value={downtimeH.toFixed(1)} rail="var(--mnt)" />
        <KPI label="Parts cost ₹" value={Math.round(cost).toLocaleString("en-IN")} rail="var(--yellow)" />
      </div>

      {/* Toolbar: filter tabs + search */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        {[["", "All"], ["OPEN", "Open"], ["IN_PROGRESS", "In Progress"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"]].map(([s, label]) => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ background: filter === s ? "var(--yellow)" : "var(--surface)", color: filter === s ? "var(--on-gold)" : "var(--muted)", border: "1px solid var(--border)", padding: "7px 13px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            {label}{s && counts[s] ? ` ${counts[s]}` : ""}
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="⌕ Search title / machine / tech…"
          style={{ marginLeft: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 13px", color: "var(--text)", fontSize: 13, minWidth: 200 }} />
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          {[["table", "▤ Table"], ["kanban", "▦ Kanban"]].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} style={{ background: view === v ? "var(--yellow)" : "var(--surface)", color: view === v ? "var(--on-gold)" : "var(--muted)", border: "none", padding: "8px 13px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Kanban board */}
      {view === "kanban" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(220px, 1fr))", gap: 12, overflowX: "auto" }}>
          {[["OPEN", "Open"], ["IN_PROGRESS", "In Progress"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"]].map(([st, label]) => {
            const col = visible.filter(o => o.status === st);
            const c = STATUS[st] || "var(--muted)";
            return (
              <div key={st} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden", minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)", borderTop: `2px solid ${c}` }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>{label}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>{col.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, minHeight: 60 }}>
                  {col.length === 0 && <div style={{ color: "var(--faint)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>—</div>}
                  {col.map(o => (
                    <div key={o.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `3px solid ${c}`, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{o.title}</div>
                      <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)", marginTop: 3 }}>{o.machine_name || o.machine_id} · {o.work_order_type}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, color: PRIORITY[o.priority] || "var(--muted)" }}>{o.priority}</span>
                        {(o.status === "OPEN" || o.status === "IN_PROGRESS") && <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--faint)", marginLeft: "auto" }}>{ageOf(o.opened_at)}</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
                        {o.status === "OPEN" && <button onClick={() => setStatus(o.id, "IN_PROGRESS")} style={sbtn("var(--surface)", "var(--link)", "1px solid var(--surface)")}>▶ Start</button>}
                        {o.status === "IN_PROGRESS" && <button onClick={() => setCompleting(o)} style={sbtn("var(--green-dim)", "var(--green)", "1px solid var(--green-dim)")}>✓ Complete</button>}
                        {(o.status === "OPEN" || o.status === "IN_PROGRESS") && <button onClick={() => openParts(o)} style={sbtn("var(--surface)", "var(--text)", "1px solid var(--border)")}>🔩</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      {view === "table" && (
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Work Order</th><th style={th}>Machine</th><th style={th}>Type</th>
              <th style={th}>Priority</th><th style={th}>Assigned</th><th style={th}>Status</th>
              <th style={th}>Age</th><th style={{ ...th, textAlign: "right" }}>Cost</th><th style={{ ...th, textAlign: "right" }}>Actions</th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td style={{ ...td, textAlign: "center", color: "var(--muted)", padding: 44 }} colSpan={9}>No work orders match. Click <b style={{ color: "var(--yellow)" }}>+ New Work Order</b>.</td></tr>
              )}
              {visible.map(o => (
                <tr key={o.id}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--surface)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ ...td, minWidth: 220 }}>
                    <div style={{ fontWeight: 700, color: "var(--text)" }}>{o.title}</div>
                    {o.description && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.description}</div>}
                    {o.resolution_notes && <div style={{ color: "var(--green)", fontSize: 11.5, marginTop: 3 }}>✔ {o.resolution_notes}</div>}
                  </td>
                  <td style={{ ...td, fontFamily: "var(--mono)" }}>{o.machine_name || o.machine_id}</td>
                  <td style={{ ...td, fontFamily: "var(--mono)", color: "var(--muted)", fontSize: 11.5 }}>{o.work_order_type}</td>
                  <td style={td}><span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, color: PRIORITY[o.priority] || "var(--muted)" }}>{o.priority}</span></td>
                  <td style={{ ...td, color: o.assigned_to ? "var(--text)" : "var(--faint)" }}>{o.assigned_to || "—"}</td>
                  <td style={td}><span style={pill(STATUS[o.status] || "var(--muted)")}><span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS[o.status] }} />{o.status.replace("_", " ")}</span></td>
                  <td style={{ ...td, fontFamily: "var(--mono)", color: "var(--muted)" }} title={`Opened ${fmtDate(o.opened_at)}`}>{o.status === "COMPLETED" || o.status === "CANCELLED" ? "—" : ageOf(o.opened_at)}</td>
                  <td style={{ ...td, fontFamily: "var(--mono)", textAlign: "right", color: parseFloat(o.total_cost) > 0 ? "var(--text)" : "var(--faint)" }}>{parseFloat(o.total_cost) > 0 ? `₹${o.total_cost}` : "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {o.status === "OPEN" && <button onClick={() => setStatus(o.id, "IN_PROGRESS")} style={sbtn("var(--surface)", "var(--link)", "1px solid var(--surface)")}>▶ Start</button>}
                      {o.status === "IN_PROGRESS" && <button onClick={() => setCompleting(o)} style={sbtn("var(--green-dim)", "var(--green)", "1px solid var(--green-dim)")}>✓ Complete</button>}
                      {(o.status === "OPEN" || o.status === "IN_PROGRESS") && <button onClick={() => openParts(o)} style={sbtn("var(--surface)", "var(--text)", "1px solid var(--border)")}>🔩 Parts</button>}
                      {(o.status === "OPEN" || o.status === "IN_PROGRESS") && <button onClick={() => setStatus(o.id, "CANCELLED")} style={sbtn("transparent", "var(--muted)", "1px solid var(--border)")}>✕</button>}
                      <button onClick={() => del(o.id)} title="Delete" style={sbtn("transparent", "var(--crit)", "1px solid var(--crit-dim)")}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* New WO modal */}
      {showNew && (
        <Modal onClose={() => { setShowNew(false); setForm(empty()); }} title="New Work Order">
          <label style={lbl}>Machine *</label>
          <select style={inp} value={form.machine_id} onChange={e => setForm(f => ({ ...f, machine_id: e.target.value }))}>
            <option value="">— Select machine —</option>
            {machines.map(m => <option key={m.machine_id} value={m.machine_id}>{m.machine_name || m.machine_id}</option>)}
          </select>
          <label style={lbl}>Title *</label>
          <input style={inp} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Belt replacement" />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Type</label>
              <select style={inp} value={form.work_order_type} onChange={e => setForm(f => ({ ...f, work_order_type: e.target.value }))}>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={lbl}>Priority</label>
              <select style={inp} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map(p => <option key={p} value={p}>{p}</option>)}</select>
            </div>
          </div>
          <label style={lbl}>Assigned To</label>
          <input style={inp} value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="Technician name" />
          <label style={lbl}>Description</label>
          <textarea style={{ ...inp, minHeight: 60 }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={create} disabled={saving} style={{ flex: 1, background: "var(--yellow)", color: "var(--on-gold)", border: "none", padding: 12, borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>{saving ? "Saving…" : "Create"}</button>
            <button onClick={() => { setShowNew(false); setForm(empty()); }} style={{ flex: 1, background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: 12, borderRadius: 7, cursor: "pointer" }}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Parts modal */}
      {partsWO && (
        <Modal onClose={() => setPartsWO(null)} title="Spare Parts Used" sub={`${partsWO.title} · ${partsWO.machine_name || partsWO.machine_id}`}>
          {partsUsed.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {partsUsed.map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                  <span>{p.part_name} <span style={{ color: "var(--muted)" }}>× {parseFloat(p.quantity)} {p.unit || ""}</span></span>
                  <span style={{ color: "var(--green)", fontWeight: 700 }}>{parseFloat(p.total_cost) > 0 ? `₹${p.total_cost}` : "—"}</span>
                </div>
              ))}
              <div style={{ textAlign: "right", color: "var(--yellow)", fontWeight: 700, fontSize: 13, paddingTop: 6 }}>
                Parts total: ₹{partsUsed.reduce((s, p) => s + parseFloat(p.total_cost || 0), 0).toFixed(2)}
              </div>
            </div>
          )}
          <label style={lbl}>Part</label>
          <select style={inp} value={pForm.part_id} onChange={e => setPForm(f => ({ ...f, part_id: e.target.value }))}>
            <option value="">— Select part —</option>
            {parts.map(p => <option key={p.id} value={p.id}>{p.part_name} ({parseFloat(p.current_stock)} {p.unit} in stock)</option>)}
          </select>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Quantity</label><input style={inp} type="number" step="0.01" value={pForm.quantity} onChange={e => setPForm(f => ({ ...f, quantity: e.target.value }))} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Unit Cost (₹)</label><input style={inp} type="number" step="0.01" value={pForm.unit_cost} onChange={e => setPForm(f => ({ ...f, unit_cost: e.target.value }))} placeholder="0" /></div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={addPart} style={{ flex: 1, background: "var(--yellow)", color: "var(--on-gold)", border: "none", padding: 12, borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>+ Consume Part</button>
            <button onClick={() => setPartsWO(null)} style={{ flex: 1, background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: 12, borderRadius: 7, cursor: "pointer" }}>Close</button>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 10 }}>Consuming a part deducts spare-parts stock and adds the cost to this work order automatically.</div>
        </Modal>
      )}

      {/* Complete modal */}
      {completing && (
        <Modal onClose={() => setCompleting(null)} title="Complete Work Order" sub={`${completing.title} · ${completing.machine_name || completing.machine_id}`}>
          <label style={lbl}>Downtime (hours)</label>
          <input style={inp} type="number" step="0.1" value={comp.downtime_hours} onChange={e => setComp(c => ({ ...c, downtime_hours: e.target.value }))} placeholder="0" />
          <label style={lbl}>Total Cost (₹)</label>
          <input style={inp} type="number" step="0.01" value={comp.total_cost} onChange={e => setComp(c => ({ ...c, total_cost: e.target.value }))} placeholder="0" />
          <label style={lbl}>Resolution Notes</label>
          <textarea style={{ ...inp, minHeight: 60 }} value={comp.resolution_notes} onChange={e => setComp(c => ({ ...c, resolution_notes: e.target.value }))} placeholder="What was done" />
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={submitComplete} style={{ flex: 1, background: "var(--yellow)", color: "var(--on-gold)", border: "none", padding: 12, borderRadius: 7, fontWeight: 700, cursor: "pointer" }}>✓ Mark Completed</button>
            <button onClick={() => setCompleting(null)} style={{ flex: 1, background: "transparent", color: "var(--muted)", border: "1px solid var(--border)", padding: 12, borderRadius: 7, cursor: "pointer" }}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, sub, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, width: "min(96vw, 520px)", maxHeight: "90vh", overflowY: "auto", padding: 22, boxShadow: "0 20px 50px -20px rgba(0,0,0,.8)" }}>
        <h3 style={{ color: "var(--text)", margin: 0, fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", fontSize: 16 }}>{title}</h3>
        {sub && <div style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 16px" }}>{sub}</div>}
        {!sub && <div style={{ height: 14 }} />}
        {children}
      </div>
    </div>
  );
}
