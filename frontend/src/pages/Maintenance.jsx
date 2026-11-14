import React, { useState, useEffect } from "react";
import NeedleChanges from "./NeedleChanges";
import NeedleCapacity from "./NeedleCapacity";

const th = { padding: "11px 13px", textAlign: "left", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontFamily: "var(--mono)", fontSize: "10px", letterSpacing: ".1em", textTransform: "uppercase", whiteSpace: "nowrap" };
const td = { padding: "11px 13px", borderBottom: "1px solid var(--border-soft)", fontSize: "13px" };
const inputStyle = { width: "100%", padding: "9px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "6px", marginTop: "4px", boxSizing: "border-box" };
const pill = (bg, c) => ({ background: bg, color: c, padding: "3px 9px", borderRadius: 99, fontFamily: "var(--mono)", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" });

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
      const res = await fetch("/api/maintenance");
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
      const res = await fetch("/api/machines");
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
      const res = await fetch("/api/maintenance", {
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
      await fetch(`/api/maintenance/${id}`, { method: "DELETE" });
      loadRecords();
    } catch (err) {
      alert("Delete failed: " + err.message);
    }
  };

  const totalMachines = new Set(records.map(r => r.machine_id)).size;
  const overdue = records.filter(r => r.next_service_date && new Date(r.next_service_date) <= new Date()).length;
  const scheduled = records.filter(r => r.status === "SCHEDULED").length;

  return (
    <div style={{ padding: "20px", minHeight: "100vh", color: "var(--text)" }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 7 }}>Maintenance</div>
        <h1 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, fontSize: 24, letterSpacing: ".02em", textTransform: "uppercase" }}>Maintenance Records</h1>
      </div>

      {/* KPI row */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        {[
          { label: "Total Records", value: records.length, rail: "var(--mnt)" },
          { label: "Machines Covered", value: totalMachines, rail: "var(--mnt)" },
          { label: "Overdue", value: overdue, rail: overdue > 0 ? "var(--crit)" : "var(--green)", tone: overdue > 0 ? "var(--crit)" : "var(--text)" },
          { label: "Scheduled", value: scheduled, rail: "var(--gold)", tone: "var(--gold)" },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, padding: "13px 14px", position: "relative", overflow: "hidden", flex: 1, minWidth: 130 }}>
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: kpi.rail }} />
            <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>{kpi.label}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 8, lineHeight: 1, color: kpi.tone || "var(--text)" }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <button
        onClick={() => { setShowForm(f => !f); setError(""); }}
        style={{ background: "var(--yellow)", color: "#000", border: "none", padding: "10px 20px", borderRadius: "8px", cursor: "pointer", fontWeight: "bold", marginBottom: "20px" }}
      >
        {showForm ? "✕ Cancel" : "+ New Maintenance Record"}
      </button>

      {/* Add record form */}
      {showForm && (
        <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "10px", padding: "22px", marginBottom: "24px" }}>
          <h3 style={{ color: "var(--yellow)", marginBottom: "16px" }}>New Maintenance Record</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label style={{ color: "var(--muted)", fontSize: "16px" }}>Machine *</label>
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
              <label style={{ color: "var(--muted)", fontSize: "16px" }}>Maintenance Type</label>
              <select
                value={form.maintenance_type}
                onChange={e => setForm({ ...form, maintenance_type: e.target.value })}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {MAINTENANCE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: "var(--muted)", fontSize: "16px" }}>Technician *</label>
              <input
                value={form.technician}
                onChange={e => setForm({ ...form, technician: e.target.value })}
                placeholder="Technician name"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ color: "var(--muted)", fontSize: "16px" }}>Status</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="DONE">Done</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="IN_PROGRESS">In Progress</option>
              </select>
            </div>
            <div>
              <label style={{ color: "var(--muted)", fontSize: "16px" }}>Maintenance Date</label>
              <input
                type="datetime-local"
                value={form.maintenance_date}
                onChange={e => setForm({ ...form, maintenance_date: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ color: "var(--muted)", fontSize: "16px" }}>Next Service Date</label>
              <input
                type="datetime-local"
                value={form.next_service_date}
                onChange={e => setForm({ ...form, next_service_date: e.target.value })}
                style={inputStyle}
              />
            </div>
          </div>
          <div style={{ marginTop: "14px" }}>
            <label style={{ color: "var(--muted)", fontSize: "16px" }}>Remarks</label>
            <textarea
              rows="3"
              value={form.remarks}
              onChange={e => setForm({ ...form, remarks: e.target.value })}
              placeholder="Optional remarks..."
              style={{ ...inputStyle, resize: "none" }}
            />
          </div>
          {error && (
            <div style={{ color: "var(--crit)", fontSize: "16px", marginTop: "10px" }}>{error}</div>
          )}
          <div style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
            <button
              onClick={saveRecord}
              disabled={saving}
              style={{ background: saving ? "#555" : "var(--green)", color: "white", border: "none", padding: "10px 22px", borderRadius: "8px", cursor: saving ? "not-allowed" : "pointer", fontWeight: "bold" }}
            >
              {saving ? "Saving..." : "Save Record"}
            </button>
            <button
              onClick={() => { setShowForm(false); setError(""); }}
              style={{ padding: "10px 18px", borderRadius: "8px", cursor: "pointer", background: "var(--surface)", color: "white", border: "none" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Records table */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
          <thead>
            <tr>
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
                <td colSpan="8" style={{ padding: "30px", textAlign: "center", color: "var(--muted)" }}>
                  Loading maintenance records...
                </td>
              </tr>
            ) : records.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontStyle: "italic" }}>
                  No maintenance records found. Click "+ New Maintenance Record" to add one.
                </td>
              </tr>
            ) : (
              records.map(r => {
                const isOverdue = r.next_service_date && new Date(r.next_service_date) <= new Date();
                return (
                  <tr key={r.id}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--surface)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ ...td, fontFamily: "var(--mono)", color: "var(--text)" }}>{r.machine_id}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{r.maintenance_type}</td>
                    <td style={td}>{r.technician}</td>
                    <td style={{ ...td, fontFamily: "var(--mono)", color: "var(--muted)" }}>{r.maintenance_date ? new Date(r.maintenance_date).toLocaleDateString('en-GB').split('/').join('-') : "—"}</td>
                    <td style={{ ...td, fontFamily: "var(--mono)", color: isOverdue ? "var(--crit)" : "var(--text)", fontWeight: isOverdue ? 700 : 400 }}>
                      {r.next_service_date ? new Date(r.next_service_date).toLocaleDateString('en-GB').split('/').join('-') : "—"}
                    </td>
                    <td style={td}>
                      <span style={pill(
                        r.status === "DONE" ? "var(--green-dim)" : r.status === "SCHEDULED" ? "var(--crit-dim)" : "var(--surface)",
                        r.status === "DONE" ? "var(--green)" : r.status === "SCHEDULED" ? "var(--gold)" : "var(--link)")}>
                        {r.status || "DONE"}
                      </span>
                    </td>
                    <td style={{ ...td, color: "var(--muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.remarks || "—"}
                    </td>
                    <td style={td}>
                      <button onClick={() => deleteRecord(r.id)}
                        style={{ background: "transparent", color: "var(--crit)", border: "1px solid var(--crit-dim)", padding: "5px 11px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>
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

      {/* Needle capacity (spec) + needle/sinker consumable log & costing */}
      <NeedleCapacity />
      <NeedleChanges machines={machines} />
    </div>
  );
};

export default Maintenance;
