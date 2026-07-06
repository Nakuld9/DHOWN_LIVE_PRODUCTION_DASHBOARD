import React, { useState, useEffect } from "react";

const th = { padding: "12px", textAlign: "left", borderBottom: "1px solid #16345d", color: "#f4ae1f" };
const td = { padding: "12px", borderBottom: "1px solid rgba(22,52,93,0.5)" };
const inputStyle = { width: "100%", padding: "9px", background: "#0d1b2f", color: "white", border: "1px solid #16345d", borderRadius: "6px", marginTop: "4px", boxSizing: "border-box" };

const MAINTENANCE_TYPES = ["Routine Service", "Breakdown Repair", "Lubrication", "Part Replacement", "Calibration", "Cleaning", "Electrical", "Other"];

const emptyForm = {
  machine_id: "",
  maintenance_type: "Routine Service",
  technician: "",
  remarks: "",
  maintenance_date: new Date().toISOString().slice(0, 16),
  next_service_date: "",
  status: "DONE",
};

const Maintenance = () => {
  const [records, setRecords] = useState([]);
  const [machines, setMachines] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecords();
    loadMachines();
  }, []);

  const loadRecords = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/maintenance");
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadMachines = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/machines");
      const data = await res.json();
      setMachines(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
  };

  const saveRecord = async () => {
    setError("");
    if (!form.machine_id) { setError("Machine is required"); return; }
    if (!form.technician.trim()) { setError("Technician name is required"); return; }
    setSaving(true);
    try {
      const res = await fetch("http://localhost:4000/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); setSaving(false); return; }
      setShowForm(false);
      setForm({ ...emptyForm, maintenance_date: new Date().toISOString().slice(0, 16) });
      loadRecords();
    } catch (err) {
      setError("Save failed: " + err.message);
    }
    setSaving(false);
  };

  const deleteRecord = async (id) => {
    if (!window.confirm("Delete this maintenance record?")) return;
    try {
      await fetch(`http://localhost:4000/api/maintenance/${id}`, { method: "DELETE" });
      loadRecords();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  const totalMachines = new Set(records.map(r => r.machine_id)).size;
  const overdue = records.filter(r => r.next_service_date && new Date(r.next_service_date) <= new Date()).length;
  const scheduled = records.filter(r => r.status === "SCHEDULED").length;

  return (
    <div style={{ padding: "20px", background: "#050d1a", minHeight: "100vh", color: "white" }}>
      <h1 style={{ color: "#f4ae1f", marginBottom: "20px" }}>MAINTENANCE</h1>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "15px", marginBottom: "25px" }}>
        {[
          { label: "TOTAL RECORDS", value: records.length, color: "white" },
          { label: "MACHINES COVERED", value: totalMachines, color: "white" },
          { label: "OVERDUE", value: overdue, color: overdue > 0 ? "#ef4444" : "#22c55e" },
          { label: "SCHEDULED", value: scheduled, color: "#f59e0b" },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: "#081426", border: "1px solid #16345d", borderRadius: "10px", padding: "18px" }}>
            <div style={{ color: "#7da2d6", fontSize: "14px", fontWeight: "600", letterSpacing: "0.5px" }}>{kpi.label}</div>
            <div style={{ fontSize: "34px", fontWeight: "bold", color: kpi.color, marginTop: "6px" }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <button
        onClick={() => { setShowForm(f => !f); setError(""); }}
        style={{ background: "#f4ae1f", color: "#000", border: "none", padding: "10px 20px", borderRadius: "8px", cursor: "pointer", fontWeight: "bold", marginBottom: "20px" }}
      >
        {showForm ? "✕ Cancel" : "+ New Maintenance Record"}
      </button>

      {/* Add record form */}
      {showForm && (
        <div style={{ background: "#081426", border: "1px solid #16345d", borderRadius: "10px", padding: "22px", marginBottom: "24px" }}>
          <h3 style={{ color: "#f4ae1f", marginBottom: "16px" }}>New Maintenance Record</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label style={{ color: "#7da2d6", fontSize: "16px" }}>Machine *</label>
              <select
                value={form.machine_id}
                onChange={e => setForm({ ...form, machine_id: e.target.value })}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                <option value="">— Select Machine —</option>
                {machines.map(m => (
                  <option key={m.machine_id} value={m.machine_id}>{m.machine_id} — {m.machine_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ color: "#7da2d6", fontSize: "16px" }}>Maintenance Type</label>
              <select
                value={form.maintenance_type}
                onChange={e => setForm({ ...form, maintenance_type: e.target.value })}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {MAINTENANCE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: "#7da2d6", fontSize: "16px" }}>Technician *</label>
              <input
                value={form.technician}
                onChange={e => setForm({ ...form, technician: e.target.value })}
                placeholder="Technician name"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ color: "#7da2d6", fontSize: "16px" }}>Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="DONE">Done</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="IN_PROGRESS">In Progress</option>
              </select>
            </div>
            <div>
              <label style={{ color: "#7da2d6", fontSize: "16px" }}>Maintenance Date</label>
              <input
                type="datetime-local"
                value={form.maintenance_date}
                onChange={e => setForm({ ...form, maintenance_date: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ color: "#7da2d6", fontSize: "16px" }}>Next Service Date</label>
              <input
                type="datetime-local"
                value={form.next_service_date}
                onChange={e => setForm({ ...form, next_service_date: e.target.value })}
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ marginTop: "14px" }}>
            <label style={{ color: "#7da2d6", fontSize: "16px" }}>Remarks</label>
            <textarea
              rows="3"
              value={form.remarks}
              onChange={e => setForm({ ...form, remarks: e.target.value })}
              placeholder="Optional remarks..."
              style={{ ...inputStyle, resize: "none" }}
            />
          </div>
          {error && (
            <div style={{ color: "#ef4444", fontSize: "16px", marginTop: "10px" }}>{error}</div>
          )}
          <div style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
            <button
              onClick={saveRecord}
              disabled={saving}
              style={{ background: saving ? "#555" : "#22c55e", color: "white", border: "none", padding: "10px 22px", borderRadius: "8px", cursor: saving ? "not-allowed" : "pointer", fontWeight: "bold" }}
            >
              {saving ? "Saving..." : "Save Record"}
            </button>
            <button
              onClick={() => { setShowForm(false); setError(""); }}
              style={{ padding: "10px 18px", borderRadius: "8px", cursor: "pointer", background: "#16345d", color: "white", border: "none" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Records table */}
      <div style={{ background: "#081426", border: "1px solid #16345d", borderRadius: "10px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#061b3a" }}>
              <th style={th}>Machine</th>
              <th style={th}>Type</th>
              <th style={th}>Technician</th>
              <th style={th}>Last Service</th>
              <th style={th}>Next Service</th>
              <th style={th}>Status</th>
              <th style={th}>Remarks</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" style={{ padding: "30px", textAlign: "center", color: "#7da2d6" }}>
                  Loading maintenance records...
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ padding: "30px", textAlign: "center", color: "#7da2d6", fontStyle: "italic" }}>
                  No maintenance records found. Click "+ New Maintenance Record" to add one.
                </td>
              </tr>
            ) : (
              records.map(r => {
                const isOverdue = r.next_service_date && new Date(r.next_service_date) <= new Date();
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid rgba(22,52,93,0.4)" }}>
                    <td style={td}>{r.machine_id}</td>
                    <td style={td}>{r.maintenance_type}</td>
                    <td style={td}>{r.technician}</td>
                    <td style={td}>{r.maintenance_date ? new Date(r.maintenance_date).toLocaleDateString("en-IN") : "—"}</td>
                    <td style={{ ...td, color: isOverdue ? "#ef4444" : "white", fontWeight: isOverdue ? "bold" : "normal" }}>
                      {r.next_service_date ? new Date(r.next_service_date).toLocaleDateString("en-IN") : "—"}
                    </td>
                    <td style={td}>
                      <span style={{
                        background: r.status === "DONE" ? "#166534" : r.status === "SCHEDULED" ? "#78350f" : "#1e3a8a",
                        color: r.status === "DONE" ? "#86efac" : r.status === "SCHEDULED" ? "#fbbf24" : "#93c5fd",
                        padding: "3px 10px",
                        borderRadius: "12px",
                        fontSize: "14px",
                        fontWeight: "600",
                      }}>
                        {r.status || "DONE"}
                      </span>
                    </td>
                    <td style={{ ...td, color: "#9ca3af", fontSize: "16px", maxWidth: "200px" }}>
                      {r.remarks || "—"}
                    </td>
                    <td style={td}>
                      <button
                        onClick={() => deleteRecord(r.id)}
                        style={{ background: "#7f1d1d", color: "#fca5a5", border: "1px solid #dc2626", padding: "4px 12px", borderRadius: "5px", cursor: "pointer", fontSize: "14px" }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Maintenance;
