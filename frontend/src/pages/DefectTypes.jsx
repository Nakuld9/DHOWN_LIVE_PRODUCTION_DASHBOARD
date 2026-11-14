// Defect-type master — add, rename, reorder, and deactivate the fabric defects
// that the 4-point inspection screen offers. Deactivating hides a defect from new
// inspections while keeping it on old ones (inspections store the name as text).

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const input = { padding: "8px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600 };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--surface)" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "6px 12px", fontWeight: 600, fontSize: 12, cursor: "pointer" });

export default function DefectTypes() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ name: "", description: "", sort_order: "" });
  const [edit, setEdit] = useState(null); // {id, name, description, sort_order}

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/defect-types`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setRows(Array.isArray(j) ? j : []);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/defect-types`, { method: "POST", headers: jsonH(), body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      flash(`Added "${j.defect.name}".`);
      setForm({ name: "", description: "", sort_order: "" });
      load();
    } catch (e) { setErr(e.message); }
  };

  const saveEdit = async () => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/defect-types/${edit.id}`, { method: "PUT", headers: jsonH(),
        body: JSON.stringify({ name: edit.name, description: edit.description, sort_order: edit.sort_order }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      flash("Saved."); setEdit(null); load();
    } catch (e) { setErr(e.message); }
  };

  const toggle = async (row) => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/defect-types/${row.id}/active`, { method: "POST", headers: jsonH(),
        body: JSON.stringify({ active: !row.is_active }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Defect Types</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        The fabric defects offered on the 4-point inspection screen. Deactivate to hide from new inspections — history keeps the name.
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginBottom: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      <div style={{ ...card, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>Defect name<br />
          <input style={{ ...input, minWidth: 180 }} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Barré" /></label>
        <label style={{ fontSize: 12, color: "var(--muted)", flex: 1, minWidth: 200 }}>Description<br />
          <input style={{ ...input, width: "100%" }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>Sort<br />
          <input style={{ ...input, width: 70 }} type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} /></label>
        <button style={btn("var(--yellow)", "#000")} disabled={!form.name.trim()} onClick={add}>+ Add defect</button>
      </div>

      <div style={card}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead><tr>
              <th style={{ ...th, width: 50 }}>Sort</th><th style={th}>Name</th><th style={th}>Description</th>
              <th style={th}>Status</th><th style={{ ...th, textAlign: "right" }}>Actions</th>
            </tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={5} style={{ ...td, color: "var(--muted)" }}>No defect types.</td></tr>}
              {rows.map(row => edit && edit.id === row.id ? (
                <tr key={row.id} style={{ background: "var(--surface)" }}>
                  <td style={td}><input style={{ ...input, width: 55 }} type="number" value={edit.sort_order ?? ""} onChange={e => setEdit(x => ({ ...x, sort_order: e.target.value }))} /></td>
                  <td style={td}><input style={input} value={edit.name} onChange={e => setEdit(x => ({ ...x, name: e.target.value }))} /></td>
                  <td style={td}><input style={{ ...input, width: "100%" }} value={edit.description || ""} onChange={e => setEdit(x => ({ ...x, description: e.target.value }))} /></td>
                  <td style={td}>{row.is_active ? "Active" : "Inactive"}</td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button style={btn("var(--green)", "#000")} onClick={saveEdit}>Save</button>{" "}
                    <button style={btn("var(--surface)", "var(--text)")} onClick={() => setEdit(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id} style={{ opacity: row.is_active ? 1 : 0.5 }}>
                  <td style={td}>{row.sort_order ?? "—"}</td>
                  <td style={{ ...td, color: "var(--text)", fontWeight: 600 }}>{row.name}</td>
                  <td style={{ ...td, color: "var(--muted)" }}>{row.description || "—"}</td>
                  <td style={td}><span style={{ color: row.is_active ? "var(--green)" : "var(--muted)", fontSize: 12 }}>{row.is_active ? "● Active" : "○ Inactive"}</span></td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button style={btn("var(--surface)", "var(--yellow)")} onClick={() => setEdit({ id: row.id, name: row.name, description: row.description, sort_order: row.sort_order })}>Edit</button>{" "}
                    <button style={btn(row.is_active ? "var(--crit-dim)" : "var(--bg)", row.is_active ? "var(--crit)" : "var(--green)")} onClick={() => toggle(row)}>
                      {row.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
