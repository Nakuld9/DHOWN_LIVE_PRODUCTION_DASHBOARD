import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";
const rupee = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS = { DRAFT: "var(--muted)", FINALIZED: "var(--link)", PAID: "var(--green)", CANCELLED: "var(--crit)" };

const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: "var(--text)", fontSize: 14, boxSizing: "border-box" };
const cell = { width: 80, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5, padding: "5px 7px", color: "var(--text)", fontSize: 13, boxSizing: "border-box" };
const lbl = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block" };
const th = { padding: "9px 7px", textAlign: "left", color: "var(--yellow)", fontSize: 12, borderBottom: "2px solid var(--surface)", whiteSpace: "nowrap" };
const td = { padding: "7px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: 13 };
const btn = (bg, fg = "#000") => ({ background: bg, color: fg, border: "none", padding: "6px 12px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 12 });

const today = new Date();
const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

export default function Payroll() {
  const [runs, setRuns] = useState([]);
  const [sel, setSel] = useState(null);          // full run with items
  const [form, setForm] = useState({ period_from: firstOfMonth, period_to: today.toISOString().slice(0, 10), notes: "" });
  const [showNew, setShowNew] = useState(false);
  const [msg, setMsg] = useState("");
  const [denied, setDenied] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/payroll`, { headers: h() });
      if (r.status === 401 || r.status === 403) { setDenied(true); return; }
      setRuns(await r.json());
    } catch {}
  }, []);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  const flash = (m, ok = true) => { setMsg((ok ? "✓ " : "✗ ") + m); setTimeout(() => setMsg(""), 3000); };

  const openRun = async id => {
    try { const r = await fetch(`${API}/api/payroll/${id}`, { headers: h() }); setSel(await r.json()); } catch {}
  };

  const createRun = async () => {
    try {
      const res = await fetch(`${API}/api/payroll`, { method: "POST", headers: h(), body: JSON.stringify(form) });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      const run = await res.json();
      flash(`Created ${run.run_number} (${run.items.length} workers)`);
      setShowNew(false); loadRuns(); setSel(run);
    } catch (e) { flash(e.message, false); }
  };

  const saveItem = async (item, patch) => {
    try {
      const res = await fetch(`${API}/api/payroll/${sel.run_id}/items/${item.item_id}`, {
        method: "PUT", headers: h(), body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      openRun(sel.run_id);
    } catch (e) { flash(e.message, false); }
  };

  const runAct = async (id, path, label) => {
    try {
      const res = await fetch(`${API}/api/payroll/${id}/${path}`, { method: "PUT", headers: h() });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      flash(label); loadRuns(); if (sel && sel.run_id === id) openRun(id);
    } catch (e) { flash(e.message, false); }
  };

  const del = async id => {
    if (!window.confirm("Delete this payroll run?")) return;
    try {
      const res = await fetch(`${API}/api/payroll/${id}`, { method: "DELETE", headers: h() });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      flash("Deleted"); setSel(null); loadRuns();
    } catch (e) { flash(e.message, false); }
  };

  if (denied) return (
    <div style={{ padding: 40, color: "var(--crit-edge)" }}>
      <h1 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase" }}>PAYROLL</h1>
      Payroll is restricted to Supervisors and Admins. Please sign in with an authorised account.
    </div>
  );

  const editable = sel && sel.status === "DRAFT";

  return (
    <div style={{ padding: 30, color: "var(--text)", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", fontSize: 40, margin: 0 }}>PAYROLL</h1>
          <p style={{ color: "var(--muted)", margin: "4px 0 0" }}>Attendance-driven wages · daily rate × days present, or flat monthly</p>
        </div>
        <button onClick={() => { setShowNew(s => !s); setSel(null); }} style={btn(showNew ? "var(--crit)" : "var(--green)", showNew ? "#fff" : "#000")}>
          {showNew ? "✕ Cancel" : "+ New Payroll Run"}
        </button>
      </div>

      {msg && <div style={{ marginBottom: 14, color: msg[0] === "✓" ? "var(--green)" : "var(--crit)", fontWeight: "bold" }}>{msg}</div>}

      {showNew && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <h3 style={{ color: "var(--yellow)", marginTop: 0 }}>New Payroll Run</h3>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>Generates a line for every active worker, with days pulled from attendance for this period. You can adjust each line before finalising.</p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><label style={lbl}>Period From</label><input type="date" style={inp} value={form.period_from} onChange={e => setForm(f => ({ ...f, period_from: e.target.value }))} /></div>
            <div><label style={lbl}>Period To</label><input type="date" style={inp} value={form.period_to} onChange={e => setForm(f => ({ ...f, period_to: e.target.value }))} /></div>
            <div style={{ flex: 1, minWidth: 200 }}><label style={lbl}>Notes</label><input style={inp} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <button onClick={createRun} style={{ ...btn("var(--yellow)"), padding: "10px 20px", fontSize: 14 }}>Generate Run</button>
          </div>
        </div>
      )}

      {/* Run detail */}
      {sel && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
            <div>
              <span style={{ color: "var(--yellow)", fontSize: 20, fontWeight: "bold" }}>{sel.run_number}</span>
              <span style={{ color: "var(--muted)", marginLeft: 12 }}>{fmtDate(sel.period_from)} → {fmtDate(sel.period_to)}</span>
              <span style={{ background: (STATUS[sel.status] || "#555") + "33", color: STATUS[sel.status] || "#aaa", padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: "bold", marginLeft: 12 }}>{sel.status}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {sel.status === "DRAFT" && <button onClick={() => runAct(sel.run_id, "finalize", "Finalised")} style={btn("var(--link)", "#fff")}>Finalise</button>}
              {sel.status === "FINALIZED" && <button onClick={() => runAct(sel.run_id, "pay", "Marked paid")} style={btn("var(--green)")}>Mark Paid</button>}
              {sel.status === "FINALIZED" && <button onClick={() => runAct(sel.run_id, "reopen", "Reopened")} style={btn("var(--gold)")}>Reopen</button>}
              {["DRAFT", "FINALIZED"].includes(sel.status) && <button onClick={() => runAct(sel.run_id, "cancel", "Cancelled")} style={btn("var(--crit-dim)", "#fff")}>Cancel</button>}
              {sel.status !== "PAID" && <button onClick={() => del(sel.run_id)} style={btn("var(--crit-dim)", "var(--crit-edge)")}>Delete</button>}
              <button onClick={() => setSel(null)} style={btn("var(--surface)", "var(--yellow)")}>Close</button>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table width="100%" style={{ borderCollapse: "collapse", minWidth: 900 }}>
              <thead><tr>{["Worker", "Type", "Wage", "Days", "Gross", "+ OT", "+ Bonus", "− Deduct", "− Advance", "Net"].map(x => <th key={x} style={th}>{x}</th>)}</tr></thead>
              <tbody>
                {(sel.items || []).map(it => (
                  <tr key={it.item_id}>
                    <td style={td}>{it.operator_name}<div style={{ color: "var(--muted)", fontSize: 11 }}>{it.operator_code}</div></td>
                    <td style={td}>{it.worker_type}</td>
                    <td style={td}>{rupee(it.wage_rate)}<div style={{ color: "var(--muted)", fontSize: 11 }}>{it.wage_type === "MONTHLY" ? "/mo" : "/day"}</div></td>
                    <td style={td}>{editable
                      ? <input type="number" style={cell} defaultValue={Number(it.days_present)} onBlur={e => saveItem(it, { days_present: e.target.value })} />
                      : Number(it.days_present)}</td>
                    <td style={{ ...td, color: "var(--link)" }}>{rupee(it.gross_amount)}</td>
                    {["overtime", "bonus", "deductions", "advance"].map(k => (
                      <td key={k} style={td}>{editable
                        ? <input type="number" style={cell} defaultValue={Number(it[k])} onBlur={e => saveItem(it, { [k]: e.target.value })} />
                        : rupee(it[k])}</td>
                    ))}
                    <td style={{ ...td, color: "var(--green)", fontWeight: "bold" }}>{rupee(it.net_amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan="9" style={{ ...td, textAlign: "right", fontWeight: "bold", color: "var(--yellow)" }}>Total Net Payable</td>
                  <td style={{ ...td, color: "var(--yellow)", fontWeight: "bold", fontSize: 15 }}>{rupee(sel.total_net)}</td></tr>
              </tfoot>
            </table>
          </div>
          {editable && <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>Tip: edit Days / OT / Bonus / Deduct / Advance and click away to save — Net recalculates automatically.</p>}
        </div>
      )}

      {/* Runs list */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflowX: "auto" }}>
        <table width="100%" style={{ borderCollapse: "collapse", minWidth: 700 }}>
          <thead><tr>{["Run #", "Period", "Workers", "Total Net", "Status", ""].map(x => <th key={x} style={th}>{x}</th>)}</tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan="6" style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontStyle: "italic" }}>No payroll runs yet. Create one for a pay period above.</td></tr>}
            {runs.map(r => (
              <tr key={r.run_id} style={{ cursor: "pointer", background: sel && sel.run_id === r.run_id ? "var(--surface)" : "transparent" }} onClick={() => openRun(r.run_id)}>
                <td style={{ ...td, fontWeight: "bold", color: "var(--yellow)" }}>{r.run_number}</td>
                <td style={td}>{fmtDate(r.period_from)} → {fmtDate(r.period_to)}</td>
                <td style={td}>{r.worker_count}</td>
                <td style={{ ...td, color: "var(--green)", fontWeight: "bold" }}>{rupee(r.total_net)}</td>
                <td style={td}><span style={{ background: (STATUS[r.status] || "#555") + "33", color: STATUS[r.status] || "#aaa", padding: "3px 10px", borderRadius: 4, fontSize: 12, fontWeight: "bold" }}>{r.status}</span></td>
                <td style={td}><button onClick={e => { e.stopPropagation(); openRun(r.run_id); }} style={btn("var(--surface)", "var(--yellow)")}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
