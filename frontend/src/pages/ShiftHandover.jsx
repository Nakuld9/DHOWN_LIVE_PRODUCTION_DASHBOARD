import React, { useState, useEffect } from "react";

const API = "http://localhost:4000";

const inputStyle = {
  width: "100%", padding: "9px", background: "#0d1b2f", color: "white",
  border: "1px solid #16345d", borderRadius: "6px", marginTop: "4px",
  boxSizing: "border-box", fontSize: "14px",
};
const textareaStyle = {
  ...inputStyle, minHeight: "80px", resize: "vertical", fontFamily: "inherit",
};
const labelStyle = { color: "#7da2d6", fontSize: "13px" };
const th = { padding: "10px 8px", textAlign: "left", color: "#f4ae1f", fontSize: "13px", borderBottom: "2px solid #16345d" };
const td = { padding: "10px 8px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: "14px", verticalAlign: "top" };

const today = new Date().toISOString().slice(0, 10);
const currentShift = new Date().getHours() >= 8 && new Date().getHours() < 20 ? "D" : "N";

const emptyForm = {
  shift_date: today, shift: currentShift, supervisor_name: "", production_kg: "",
  machines_down: "", issues: "", actions_taken: "", pending_actions: "",
};

export default function ShiftHandover() {
  const [handovers, setHandovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    loadHandovers();
    // Pre-fill supervisor name from localStorage
    try {
      const user = JSON.parse(localStorage.getItem("dhown_user") || "{}");
      if (user.full_name) setForm(f => ({ ...f, supervisor_name: user.full_name }));
    } catch {}
  }, []);

  const loadHandovers = async () => {
    try {
      const r = await fetch(`${API}/api/shift-handovers`);
      setHandovers(await r.json());
    } catch {}
    finally { setLoading(false); }
  };

  const showMessage = (text, isError = false) => {
    setMsg({ text, isError });
    setTimeout(() => setMsg(""), 4000);
  };

  const save = async () => {
    if (!form.shift_date || !form.shift) { showMessage("Date and shift are required", true); return; }
    try {
      const res = await fetch(`${API}/api/shift-handovers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { showMessage(data.error || "Save failed", true); return; }
      showMessage("Handover note saved");
      setForm({ ...emptyForm });
      setShowForm(false);
      loadHandovers();
    } catch { showMessage("Save failed", true); }
  };

  return (
    <div style={{ padding: "20px", background: "#050d1a", minHeight: "100vh", color: "white" }}>
      <h1 style={{ color: "#f4ae1f", marginBottom: "6px" }}>SHIFT HANDOVER</h1>
      <p style={{ color: "#7da2d6", marginBottom: "20px", fontSize: "14px" }}>
        Supervisor notes at end of each shift — {handovers.length} records
      </p>

      {msg && (
        <div style={{ background: msg.isError ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", border: `1px solid ${msg.isError ? "#ef4444" : "#22c55e"}`, padding: "10px 16px", borderRadius: "8px", marginBottom: "16px", color: msg.isError ? "#ef4444" : "#22c55e" }}>
          {msg.text}
        </div>
      )}

      <button onClick={() => setShowForm(f => !f)} style={{ background: showForm ? "#374151" : "#22c55e", color: "white", border: "none", padding: "10px 18px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", marginBottom: "20px" }}>
        {showForm ? "✕ Cancel" : "+ New Handover Note"}
      </button>

      {showForm && (
        <div style={{ background: "#071120", border: "1px solid #f4ae1f", borderRadius: "12px", padding: "24px", marginBottom: "24px" }}>
          <h3 style={{ color: "#f4ae1f", marginTop: 0 }}>Shift Handover Note</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "14px" }}>
            <div>
              <label style={labelStyle}>Date *</label>
              <input type="date" style={inputStyle} value={form.shift_date} onChange={e => setForm(f => ({ ...f, shift_date: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Shift *</label>
              <select style={inputStyle} value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))}>
                <option value="D">Day (D)</option>
                <option value="N">Night (N)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Supervisor Name</label>
              <input style={inputStyle} placeholder="Your name" value={form.supervisor_name} onChange={e => setForm(f => ({ ...f, supervisor_name: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Production (kg)</label>
              <input type="number" step="0.01" style={inputStyle} placeholder="Total KG this shift" value={form.production_kg} onChange={e => setForm(f => ({ ...f, production_kg: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Machines Down</label>
              <input type="number" style={inputStyle} placeholder="Number of machines stopped" value={form.machines_down} onChange={e => setForm(f => ({ ...f, machines_down: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px", marginTop: "14px" }}>
            <div>
              <label style={labelStyle}>Issues / Problems</label>
              <textarea style={textareaStyle} placeholder="Any issues that occurred this shift..." value={form.issues} onChange={e => setForm(f => ({ ...f, issues: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Actions Taken</label>
              <textarea style={textareaStyle} placeholder="What was done to resolve issues..." value={form.actions_taken} onChange={e => setForm(f => ({ ...f, actions_taken: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Pending Actions</label>
              <textarea style={textareaStyle} placeholder="What needs to be done in next shift..." value={form.pending_actions} onChange={e => setForm(f => ({ ...f, pending_actions: e.target.value }))} />
            </div>
          </div>
          <button onClick={save} style={{ marginTop: "16px", background: "#f4ae1f", color: "black", border: "none", padding: "10px 24px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}>
            Save Handover Note
          </button>
        </div>
      )}

      {/* Handover List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {loading && <div style={{ color: "#7da2d6", textAlign: "center", padding: "24px" }}>Loading...</div>}
        {!loading && handovers.length === 0 && (
          <div style={{ color: "#7da2d6", fontStyle: "italic", textAlign: "center", padding: "24px" }}>
            No handover notes yet. Add the first one above.
          </div>
        )}
        {handovers.map(h => (
          <div key={h.handover_id} style={{ background: "#071120", border: "1px solid #16345d", borderRadius: "12px", padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
              <div>
                <span style={{ color: "#f4ae1f", fontWeight: "bold", fontSize: "16px" }}>
                  {new Date(h.shift_date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                </span>
                <span style={{ marginLeft: "10px", background: h.shift === "D" ? "rgba(251,191,36,0.2)" : "rgba(99,102,241,0.2)", color: h.shift === "D" ? "#fbbf24" : "#818cf8", padding: "2px 10px", borderRadius: "4px", fontSize: "13px", fontWeight: "bold" }}>
                  {h.shift === "D" ? "☀ Day" : "🌙 Night"}
                </span>
              </div>
              <div style={{ color: "#7da2d6", fontSize: "13px" }}>
                Supervisor: <strong style={{ color: "white" }}>{h.supervisor_name || "—"}</strong>
                {h.production_kg > 0 && <span style={{ marginLeft: "16px", color: "#22c55e" }}>⚖ {parseFloat(h.production_kg).toFixed(2)} kg</span>}
                {h.machines_down > 0 && <span style={{ marginLeft: "12px", color: "#ef4444" }}>⚠ {h.machines_down} machines down</span>}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "14px" }}>
              {[
                { label: "Issues / Problems", value: h.issues, color: "#ef4444" },
                { label: "Actions Taken", value: h.actions_taken, color: "#22c55e" },
                { label: "Pending Actions", value: h.pending_actions, color: "#f59e0b" },
              ].map(s => s.value ? (
                <div key={s.label} style={{ background: "#0d1b2f", borderRadius: "8px", padding: "12px" }}>
                  <div style={{ color: s.color, fontSize: "12px", fontWeight: "bold", marginBottom: "6px" }}>{s.label}</div>
                  <div style={{ color: "white", fontSize: "14px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{s.value}</div>
                </div>
              ) : null)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
