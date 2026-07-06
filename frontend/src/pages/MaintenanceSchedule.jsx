import React, { useState, useEffect } from "react";

const API = "http://localhost:4000";

const PRIORITY_COLOR = {
  CRITICAL: { bg: "rgba(220,38,38,0.15)", color: "#ef4444", border: "#ef4444" },
  HIGH:     { bg: "rgba(245,158,11,0.15)", color: "#f59e0b", border: "#f59e0b" },
  MEDIUM:   { bg: "rgba(59,130,246,0.15)", color: "#60a5fa", border: "#1d4ed8" },
  LOW:      { bg: "rgba(107,114,128,0.1)",  color: "#9ca3af", border: "#374151" },
};

const DUE_COLOR = {
  OVERDUE:  "#ef4444",
  DUE_SOON: "#f59e0b",
  OK:       "#22c55e",
};

const TASK_TYPES = ["PERIODIC", "PREVENTIVE", "BREAKDOWN", "LUBRICATION", "CALIBRATION", "CLEANING", "ELECTRICAL", "OTHER"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

const inputStyle = {
  width: "100%", padding: "9px", background: "#0d1b2f", color: "white",
  border: "1px solid #16345d", borderRadius: "6px", marginTop: "4px",
  boxSizing: "border-box", fontSize: "14px",
};

const labelStyle = { color: "#7da2d6", fontSize: "13px" };

const th = { padding: "10px 8px", textAlign: "left", color: "#f4ae1f", fontSize: "13px", borderBottom: "2px solid #16345d", whiteSpace: "nowrap" };
const td = { padding: "10px 8px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: "14px" };

const emptyForm = {
  machine_id: "", task_name: "", task_type: "PERIODIC",
  frequency_days: "", last_done_date: "", assigned_to: "", priority: "MEDIUM", notes: "",
};

export default function MaintenanceSchedule() {
  const [schedules, setSchedules] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [completing, setCompleting] = useState(null);
  const [completedDate, setCompletedDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    loadSchedules();
    fetch(`${API}/api/machines`).then(r => r.json()).then(setMachines).catch(() => {});
  }, []);

  const loadSchedules = async () => {
    try {
      const r = await fetch(`${API}/api/maintenance-schedule`);
      setSchedules(await r.json());
      setError("");
    } catch {
      setError("Unable to load maintenance schedule.");
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (text, isError = false) => {
    setMsg({ text, isError });
    setTimeout(() => setMsg(""), 4000);
  };

  const saveSchedule = async () => {
    if (!form.machine_id || !form.task_name) { showMsg("Machine and task name are required", true); return; }
    try {
      const res = await fetch(`${API}/api/maintenance-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { showMsg(data.error || "Save failed", true); return; }
      showMsg("Schedule added successfully");
      setForm({ ...emptyForm });
      setShowForm(false);
      loadSchedules();
    } catch { showMsg("Save failed", true); }
  };

  const markComplete = async (id) => {
    try {
      const res = await fetch(`${API}/api/maintenance-schedule/${id}/complete`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done_date: completedDate }),
      });
      if (!res.ok) { showMsg("Failed to mark complete", true); return; }
      showMsg("Task marked as done. Next due date updated.");
      setCompleting(null);
      loadSchedules();
    } catch { showMsg("Failed", true); }
  };

  const overdue = schedules.filter(s => s.due_status === "OVERDUE").length;
  const dueSoon = schedules.filter(s => s.due_status === "DUE_SOON").length;

  return (
    <div style={{ padding: "20px", background: "#050d1a", minHeight: "100vh", color: "white" }}>
      <h1 style={{ color: "#f4ae1f", marginBottom: "6px" }}>MAINTENANCE SCHEDULE</h1>
      <p style={{ color: "#7da2d6", marginBottom: "20px", fontSize: "14px" }}>
        Preventive maintenance tracker — {schedules.length} active tasks
        {overdue > 0 && <span style={{ color: "#ef4444", marginLeft: "10px" }}>⚠ {overdue} OVERDUE</span>}
        {dueSoon > 0 && <span style={{ color: "#f59e0b", marginLeft: "10px" }}>⏰ {dueSoon} due within 7 days</span>}
      </p>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px", marginBottom: "24px" }}>
        {[
          { label: "Total Tasks", value: schedules.length, color: "#7da2d6" },
          { label: "Overdue", value: overdue, color: "#ef4444" },
          { label: "Due Within 7 Days", value: dueSoon, color: "#f59e0b" },
          { label: "On Schedule", value: schedules.filter(s => s.due_status === "OK").length, color: "#22c55e" },
        ].map(k => (
          <div key={k.label} style={{ background: "#081426", border: "1px solid #16345d", borderRadius: "10px", padding: "16px", textAlign: "center" }}>
            <div style={{ fontSize: "32px", fontWeight: "bold", color: k.color }}>{k.value}</div>
            <div style={{ fontSize: "12px", color: "#7da2d6", marginTop: "4px" }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Message */}
      {msg && (
        <div style={{ background: msg.isError ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", border: `1px solid ${msg.isError ? "#ef4444" : "#22c55e"}`, padding: "10px 16px", borderRadius: "8px", marginBottom: "16px", color: msg.isError ? "#ef4444" : "#22c55e" }}>
          {msg.text}
        </div>
      )}

      {/* Add Button */}
      <button onClick={() => setShowForm(f => !f)} style={{ background: showForm ? "#374151" : "#22c55e", color: "white", border: "none", padding: "10px 18px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", marginBottom: "20px" }}>
        {showForm ? "✕ Cancel" : "+ Add Maintenance Task"}
      </button>

      {/* Add Form */}
      {showForm && (
        <div style={{ background: "#071120", border: "1px solid #f4ae1f", borderRadius: "12px", padding: "24px", marginBottom: "24px" }}>
          <h3 style={{ color: "#f4ae1f", marginTop: 0 }}>New Maintenance Task</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "14px" }}>
            <div>
              <label style={labelStyle}>Machine *</label>
              <select style={inputStyle} value={form.machine_id} onChange={e => setForm(f => ({ ...f, machine_id: e.target.value }))}>
                <option value="">Select Machine</option>
                {machines.map(m => <option key={m.machine_id} value={m.machine_id}>{m.machine_id}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: "2 / 4" }}>
              <label style={labelStyle}>Task Name *</label>
              <input style={inputStyle} placeholder="e.g. Oil Lubrication, Needle Change, Belt Inspection" value={form.task_name} onChange={e => setForm(f => ({ ...f, task_name: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Task Type</label>
              <select style={inputStyle} value={form.task_type} onChange={e => setForm(f => ({ ...f, task_type: e.target.value }))}>
                {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Frequency (days)</label>
              <input type="number" style={inputStyle} placeholder="e.g. 30 for monthly" value={form.frequency_days} onChange={e => setForm(f => ({ ...f, frequency_days: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Last Done Date</label>
              <input type="date" style={inputStyle} value={form.last_done_date} onChange={e => setForm(f => ({ ...f, last_done_date: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Assigned To</label>
              <input style={inputStyle} placeholder="Technician name" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} />
            </div>
            <div style={{ gridColumn: "1 / 4" }}>
              <label style={labelStyle}>Notes</label>
              <input style={inputStyle} placeholder="Additional notes or instructions" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          {error && <div style={{ color: "#ef4444", marginTop: "10px", fontSize: "14px" }}>{error}</div>}
          <button onClick={saveSchedule} style={{ marginTop: "16px", background: "#f4ae1f", color: "black", border: "none", padding: "10px 24px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}>
            Save Task
          </button>
        </div>
      )}

      {/* Schedule Table */}
      <div style={{ background: "#071120", border: "1px solid #16345d", borderRadius: "12px", padding: "20px", overflowX: "auto" }}>
        <table width="100%" style={{ borderCollapse: "collapse", minWidth: "800px" }}>
          <thead>
            <tr>
              {["Machine", "Task", "Type", "Priority", "Frequency", "Last Done", "Next Due", "Status", "Assigned", "Action"].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="10" style={{ padding: "24px", color: "#7da2d6", textAlign: "center" }}>Loading...</td></tr>}
            {!loading && schedules.length === 0 && (
              <tr><td colSpan="10" style={{ padding: "24px", color: "#7da2d6", fontStyle: "italic", textAlign: "center" }}>No maintenance tasks scheduled. Click "+ Add Maintenance Task" to start.</td></tr>
            )}
            {schedules.map(s => {
              const pc = PRIORITY_COLOR[s.priority] || PRIORITY_COLOR.MEDIUM;
              const dueColor = DUE_COLOR[s.due_status] || "#22c55e";
              const isCompleting = completing === s.schedule_id;
              return (
                <tr key={s.schedule_id}>
                  <td style={{ ...td, fontWeight: "bold", color: "#f4ae1f" }}>{s.machine_id}</td>
                  <td style={{ ...td, maxWidth: "200px" }}>{s.task_name}</td>
                  <td style={td}><span style={{ fontSize: "12px", color: "#7da2d6" }}>{s.task_type}</span></td>
                  <td style={td}>
                    <span style={{ background: pc.bg, color: pc.color, border: `1px solid ${pc.border}`, padding: "2px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold" }}>
                      {s.priority}
                    </span>
                  </td>
                  <td style={{ ...td, color: "#7da2d6" }}>{s.frequency_days ? `Every ${s.frequency_days}d` : "—"}</td>
                  <td style={td}>{s.last_done_date ? new Date(s.last_done_date).toLocaleDateString("en-IN") : "—"}</td>
                  <td style={{ ...td, color: dueColor, fontWeight: "bold" }}>
                    {s.next_due_date ? new Date(s.next_due_date).toLocaleDateString("en-IN") : "—"}
                    {s.due_status === "OVERDUE" && <span style={{ display: "block", fontSize: "11px" }}>OVERDUE</span>}
                    {s.due_status === "DUE_SOON" && <span style={{ display: "block", fontSize: "11px" }}>DUE SOON</span>}
                  </td>
                  <td style={td}><span style={{ color: dueColor, fontSize: "12px" }}>● {s.due_status?.replace("_", " ")}</span></td>
                  <td style={{ ...td, color: "#7da2d6" }}>{s.assigned_to || "—"}</td>
                  <td style={td}>
                    {isCompleting ? (
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                        <input type="date" value={completedDate} onChange={e => setCompletedDate(e.target.value)}
                          style={{ ...inputStyle, marginTop: 0, width: "130px", padding: "4px 8px" }} />
                        <button onClick={() => markComplete(s.schedule_id)}
                          style={{ background: "#22c55e", color: "black", border: "none", padding: "4px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "13px", fontWeight: "bold" }}>✓ Done</button>
                        <button onClick={() => setCompleting(null)}
                          style={{ background: "#374151", color: "white", border: "none", padding: "4px 8px", borderRadius: "4px", cursor: "pointer", fontSize: "13px" }}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => { setCompleting(s.schedule_id); setCompletedDate(new Date().toISOString().slice(0, 10)); }}
                        style={{ background: s.due_status === "OVERDUE" ? "#7f1d1d" : "#16345d", color: s.due_status === "OVERDUE" ? "#ef4444" : "#f4ae1f", border: `1px solid ${s.due_status === "OVERDUE" ? "#ef4444" : "#f4ae1f"}`, padding: "4px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "13px" }}>
                        Mark Done
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
