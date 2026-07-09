import React, { useState, useEffect, useCallback } from "react";

const API = "http://localhost:4000";
const token = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });
const fmtKg = v => v != null ? parseFloat(v).toFixed(3) : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS_COLORS = { PASSED: "#22c55e", FAILED: "#ef4444", PENDING: "#f59e0b" };
const GRADE_COLORS = { A: "#22c55e", B: "#f59e0b", C: "#eab308", R: "#ef4444" };
const cell = { padding: "6px 8px", border: "1px solid #16294a", fontSize: 12 };
const cinp = { width: "100%", background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 4, padding: "5px 7px", color: "#e2e8f0", fontSize: 12, boxSizing: "border-box" };
const fieldInp = { width: "100%", background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" };

const emptyInspection = () => ({
  roll_id: "",
  inspection_type: "",
  inspection_stage: "",
  grade: "",
  width_mm: "",
  gsm: "",
  length_m: "",
  weight_kg: "",
  defect_type: "",
  defect_description: "",
  defect_location: "",
  defect_severity: "",
  defect_count: "",
  notes: ""
});

// ── Reusable navigator bar (same as other pages) ──
function NavBar({ label, list, selId, idKey, optLabel, onSelect, disabled, onAdd }) {
  const idx = list.findIndex(x => x[idKey] === selId);
  const go = (i) => { if (i >= 0 && i < list.length) onSelect(list[i][idKey]); };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 10, padding: "10px 14px", flexWrap: "wrap", opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      {onAdd && <button onClick={onAdd} style={{ background: "#22c55e", color: "#04120a", border: "none", padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>+ Add</button>}
      <span style={{ color: "#64748b", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{label}</span>
      <select value={selId || ""} onChange={e => e.target.value && onSelect(e.target.value)}
        style={{ background: "#0d1b2f", border: "1px solid #23395d", color: "#f4ae1f", borderRadius: 6, padding: "7px 10px", fontSize: 13, fontFamily: "monospace", fontWeight: 700, minWidth: 320 }}>
        <option value="">— List View ({list.length}) —</option>
        {list.map(x => <option key={x[idKey]} value={x[idKey]}>{optLabel(x)}</option>)}
      </select>
      {selId && idx >= 0 && <span style={{ color: "#64748b", fontSize: 12 }}>{list.length - idx} / {list.length}</span>}
      <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
        <button onClick={() => go(list.length - 1)} disabled={idx < 0 || idx >= list.length - 1} style={{ background: "#0d1b2f", border: "1px solid #23395d", color: idx >= list.length - 1 ? "#334155" : "#93c5fd", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>⏮ First</button>
        <button onClick={() => go(idx + 1)} disabled={idx < 0 || idx >= list.length - 1} style={{ background: "#0d1b2f", border: "1px solid #23395d", color: idx >= list.length - 1 ? "#334155" : "#93c5fd", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>◀ Previous</button>
        <button onClick={() => go(idx - 1)} disabled={idx <= 0} style={{ background: "#0d1b2f", border: "1px solid #23395d", color: idx <= 0 ? "#334155" : "#93c5fd", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Next ▶</button>
        <button onClick={() => go(0)} disabled={!list.length} style={{ background: "#0d1b2f", border: "1px solid #23395d", color: "#fbbf24", padding: "7px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Last ⏭</button>
      </div>
    </div>
  );
}

// ── Inspection Form ──
function InspectionForm({ inspection, onSave, onCancel, loading, defectTypes, rolls, inspections }) {
  const [form, setForm] = useState(inspection || emptyInspection());
  const [isNew, setIsNew] = useState(!inspection);
  const [showDefectFields, setShowDefectFields] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (inspection) setForm(inspection);
  }, [inspection]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value
    }));

    // Show/hide defect fields based on severity
    if (name === "defect_severity") {
      setShowDefectFields(value === "critical" || value === "major");
    }
  };

  const handleSave = async () => {
    if (!form.roll_id || !form.inspection_type) {
      alert("Roll ID and Inspection Type are required");
      return;
    }

    // Validate roll_id exists in rolls
    const rollExists = rolls.some(r => r.roll_id === form.roll_id);
    if (!rollExists) {
      alert("Invalid Roll ID. Please select a valid roll.");
      return;
    }

    // Validate defect_type if provided
    if (form.defect_type && form.defect_type.trim() !== '') {
      const defectTypeExists = defectTypes.some(dt => dt.name === form.defect_type);
      if (!defectTypeExists) {
        alert("Invalid Defect Type. Please select a valid defect type.");
        return;
      }
    }

    // Check for duplicate inspection (only for new inspections)
    if (isNew) {
      const token = localStorage.getItem('dhown_token');
      const decodeToken = (token) => {
        try {
          const base64Url = token.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          }).join(''));
          return JSON.parse(jsonPayload);
        } catch (e) {
          return null;
        }
      };
      const decoded = decodeToken(token);
      const username = decoded ? decoded.username : '';

      if (username) {
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

        const duplicate = inspections.some(insp => {
          if (insp.roll_id !== form.roll_id || insp.inspection_type !== form.inspection_type || insp.inspector !== username) {
            return false;
          }
          const inspDate = new Date(insp.inspection_date);
          return inspDate >= fiveMinutesAgo && inspDate <= now;
        });

        if (duplicate) {
          alert("A similar inspection for this roll, type, and inspector already exists in the last 5 minutes. Please wait or modify the inspection details.");
          return;
        }
      }
    }

    setSaving(true);
    try {
      const method = isNew ? "POST" : "PUT";
      const url = isNew
        ? `${API}/api/quality-inspections`
        : `${API}/api/quality-inspections/${form.inspection_id}`;

      const body = {
        ...form,
        defect_count: form.defect_count ? parseInt(form.defect_count) : 0,
        width_mm: form.width_mm || null,
        gsm: form.gsm || null,
        length_m: form.length_m || null,
        weight_kg: form.weight_kg || null,
        passed: form.grade !== 'R' && !(form.defect_severity === 'critical' && form.defect_count > 0)
      };

      const res = await fetch(url, {
        method,
        headers: h(),
        body: JSON.stringify(body)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      onSave(data);
    } catch (err) {
      alert(`Failed to save inspection: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: "#0d1b2a", borderRadius: "10px", padding: "20px", marginBottom: "20px" }}>
      <h2 style={{ margin: "0 0 16px", color: "#f4ae1f" }}>
        {isNew ? "New Quality Inspection" : "Edit Inspection"}
      </h2>

      {(isNew ? <span style={{ color: "#10b981", fontSize: "14px" }}>Creating new inspection</span> :
        <span style={{ color: "#f4ae1f", fontSize: "14px" }}>Editing Inspection #{form.inspection_id}</span>)}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px", marginBottom: "20px" }}>
        <div>
          <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Roll ID *</label>
          <select name="roll_id" value={form.roll_id} onChange={handleChange}
            style={cinp}>
            <option value="">Select Roll</option>
            {rolls.map(r => (
              <option key={r.roll_id} value={r.roll_id}>
                {r.roll_id} - {r.machine_name || 'No Machine'} ({r.fabric_type || 'Unknown'})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Inspection Type *</label>
          <select name="inspection_type" value={form.inspection_type} onChange={handleChange}
            style={cinp}>
            <option value="">Select Type</option>
            <option value="incoming">Incoming Yarn</option>
            <option value="in_process">In Process</option>
            <option value="final">Final Inspection</option>
            <option value="fabric">Fabric Inspection</option>
          </select>
        </div>

        <div>
          <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Inspection Stage</label>
          <input name="inspection_stage" value={form.inspection_stage || ""} onChange={handleChange}
            style={fieldInp} placeholder="e.g., yarn_issue, roll_production, dyeing, finishing" />
        </div>

        <div>
          <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Grade</label>
          <select name="grade" value={form.grade || ""} onChange={handleChange}
            style={cinp}>
            <option value="">Select Grade</option>
            <option value="A">A - Excellent</option>
            <option value="B">B - Good</option>
            <option value="C">C - Acceptable</option>
            <option value="R">R - Reject</option>
          </select>
        </div>

        <div>
          <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Width (mm)</label>
          <input name="width_mm" type="number" value={form.width_mm || ""} onChange={handleChange}
            style={cinp} step="0.01" min="0" />
        </div>

        <div>
          <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>GSM</label>
          <input name="gsm" type="number" value={form.gsm || ""} onChange={handleChange}
            style={cinp} step="0.01" min="0" />
        </div>

        <div>
          <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Length (m)</label>
          <input name="length_m" type="number" value={form.length_m || ""} onChange={handleChange}
            style={cinp} step="0.01" min="0" />
        </div>

        <div>
          <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Weight (kg)</label>
          <input name="weight_kg" type="number" value={form.weight_kg || ""} onChange={handleChange}
            style={cinp} step="0.001" min="0" />
        </div>
      </div>

      {/* Defect Section */}
      <div style={{ marginBottom: "20px" }}>
        <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Defect Information</label>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
          <div>
            <label style={{ color: "#7da2d6", fontSize: "11px", marginBottom: "2px", display: "block" }}>Defect Type</label>
            <select name="defect_type" value={form.defect_type || ""} onChange={handleChange}
              style={cinp}>
              <option value="">Select Defect Type</option>
              {defectTypes.map(dt => (
                <option key={dt.id} value={dt.name}>
                  {dt.name} ({dt.description || ''})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ color: "#7da2d6", fontSize: "11px", marginBottom: "2px", display: "block" }}>Defect Severity</label>
            <select name="defect_severity" value={form.defect_severity || ""} onChange={handleChange}
              style={cinp}>
              <option value="">Select Severity</option>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div>
            <label style={{ color: "#7da2d6", fontSize: "11px", marginBottom: "2px", display: "block" }}>Defect Location</label>
            <input name="defect_location" value={form.defect_location || ""} onChange={handleChange}
              style={fieldInp} placeholder="e.g., edge, center, corner" />
          </div>

          <div>
            <label style={{ color: "#7da2d6", fontSize: "11px", marginBottom: "2px", display: "block" }}>Defect Count</label>
            <input name="defect_count" type="number" value={form.defect_count || ""} onChange={handleChange}
              style={cinp} min="0" />
          </div>
        </div>

        {showDefectFields && (
          <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #1e3a5f" }}>
            <label style={{ color: "#7da2d6", fontSize: "11px", marginBottom: "4px", display: "block" }}>Defect Description</label>
            <textarea name="defect_description" value={form.defect_description || ""} onChange={handleChange}
              style={{ width: "100%", background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 4, padding: "8px", color: "#e2e8f0", fontSize: "12px", boxSizing: "border-box", minHeight: "60px" }}
              rows="3" />
          </div>
        )}
      </div>

      <div>
        <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Notes</label>
        <textarea name="notes" value={form.notes || ""} onChange={handleChange}
          style={{ width: "100%", background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 4, padding: "8px", color: "#e2e8f0", fontSize: "12px", boxSizing: "border-box", minHeight: "80px" }}
          rows="4" />
      </div>

      <div style={{ marginTop: "20px", display: "flex", gap: "12px" }}>
        <button onClick={handleSave} disabled={saving}
          style={{ background: "#22c55e", color: "#04120a", border: "none", padding: "10px 20px", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
          {saving ? "Saving..." : "Save Inspection"}
        </button>
        <button onClick={onCancel}
          style={{ background: "#1e3a5f", color: "#e2e8f0", border: "1px solid #3b4f61", padding: "10px 20px", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Inspection List Item ──
function InspectionListItem({ inspection, onSelect, onEdit, onDelete }) {
  const status = inspection.passed ? "PASSED" : "FAILED";
  const gradeColor = GRADE_COLORS[inspection.grade] || "#7da2d6";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      padding: "12px",
      border: `1px solid ${inspection.passed ? "#1e3a5f" : "#3b4f61"}`,
      borderRadius: "8px",
      marginBottom: "8px",
      background: inspection.passed ? "#0d1b2a" : "#1a0d0d"
    }}>
      <div style={{ flex: "0 0 100px" }}>
        <div style={{ fontSize: "11px", color: "#7da2d6", marginBottom: "4px" }}>Inspection #</div>
        <div style={{ fontSize: "16px", fontWeight: "600", color: "#e2e8f0" }}>{inspection.inspection_id}</div>
      </div>

      <div style={{ flex: "0 0 120px", marginRight: "12px" }}>
        <div style={{ fontSize: "11px", color: "#7da2d6", marginBottom: "4px" }}>Roll ID</div>
        <div style={{ fontSize: "14px", fontWeight: "500", color: "#e2e8f0" }}>{inspection.roll_id}</div>
      </div>

      <div style={{ flex: "0 0 100px", marginRight: "12px" }}>
        <div style={{ fontSize: "11px", color: "#7da2d6", marginBottom: "4px" }}>Type</div>
        <div style={{ fontSize: "13px", fontWeight: "500", color: "#f4ae1f" }}>{inspection.inspection_type}</div>
      </div>

      <div style={{ flex: "0 0 80px", marginRight: "12px" }}>
        <div style={{ fontSize: "11px", color: "#7da2d6", marginBottom: "4px" }}>Grade</div>
        <div style={{
          fontSize: "16px",
          fontWeight: "600",
          color: gradeColor,
          textTransform: "uppercase"
        }}>{inspection.grade || '-'}</div>
      </div>

      <div style={{ flex: "0 0 80px", marginRight: "12px" }}>
        <div style={{ fontSize: "11px", color: "#7da2d6", marginBottom: "4px" }}>Status</div>
        <div style={{
          fontSize: "13px",
          fontWeight: "500",
          color: inspection.passed ? "#22c55e" : "#ef4444"
        }}>{status}</div>
      </div>

      <div style={{ flex: "0 0 100px", marginRight: "12px" }}>
        <div style={{ fontSize: "11px", color: "#7da2d6", marginBottom: "4px" }}>Date</div>
        <div style={{ fontSize: "13px", color: "#e2e8f0" }}>{fmtDateTime(inspection.inspection_date)}</div>
      </div>

      <div style={{ flex: "0 0 80px", marginRight: "12px" }}>
        <div style={{ fontSize: "11px", color: "#7da2d6", marginBottom: "4px" }}>Defects</div>
        <div style={{ fontSize: "13px", color: inspection.defect_count > 0 ? "#f59e0b" : "#22c55e" }}>
          {inspection.defect_count || 0}
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={(e) => { e.stopPropagation(); onSelect(inspection.inspection_id); }}
          style={{ background: "#1e3a5f", color: "#e2e8f0", border: "1px solid #3b4f61", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>
          View
        </button>
        <button onClick={(e) => { e.stopPropagation(); onEdit(inspection); }}
          style={{ background: "#3b4f61", color: "#e2e8f0", border: "1px solid #4a6478", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>
          Edit
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(inspection); }}
          style={{ background: "#4a1c24", color: "#f87171", border: "1px solid #5a2432", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}>
          Delete
        </button>
      </div>
    </div>
  );
}

export default function QualityInspection() {
  const [inspections, setInspections] = useState([]);
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [defectTypes, setDefectTypes] = useState([]);
  const [rolls, setRolls] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Fetch initial data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // Fetch inspections
        const inspectionsRes = await fetch(`${API}/api/quality-inspections`, { headers: h() });
        const inspectionsData = await inspectionsRes.json();
        setInspections(inspectionsData);

        // Fetch defect types
        const defectsRes = await fetch(`${API}/api/quality-defect-types`, { headers: h() });
        const defectsData = await defectsRes.json();
        setDefectTypes(defectsData);

        // Fetch rolls for dropdown
        const rollsRes = await fetch(`${API}/api/rolls`, { headers: h() });
        const rollsData = await rollsRes.json();
        setRolls(rollsData);

        // Fetch stats
        const statsRes = await fetch(`${API}/api/quality-inspections/stats`, { headers: h() });
        const statsData = await statsRes.json();
        setStats(statsData);
      } catch (err) {
        console.error("Failed to load QC data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const handleSelectInspection = (id) => {
    const inspection = inspections.find(i => i.inspection_id == id);
    setSelectedInspection(inspection || null);
  };

  const handleAddInspection = () => {
    setSelectedInspection(emptyInspection());
  };

  const handleSaveInspection = (savedInspection) => {
    // Update the list
    setInspections(prev => {
      const existingIndex = prev.findIndex(i => i.inspection_id == savedInspection.inspection_id);
      if (existingIndex >= 0) {
        const newList = [...prev];
        newList[existingIndex] = savedInspection;
        return newList;
      } else {
        return [...prev, savedInspection];
      }
    });
    setSelectedInspection(null);
  };

  const handleDeleteInspection = async (inspection) => {
    if (!window.confirm(`Delete inspection #${inspection.inspection_id}?`)) return;

    setDeleting(true);
    try {
      const res = await fetch(`${API}/api/quality-inspections/${inspection.inspection_id}`, {
        method: "DELETE",
        headers: h()
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      setInspections(prev => prev.filter(i => i.inspection_id !== inspection.inspection_id));
      if (selectedInspection && selectedInspection.inspection_id == inspection.inspection_id) {
        setSelectedInspection(null);
      }
    } catch (err) {
      alert(`Failed to delete inspection: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "#7da2d6" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>🔍</div>
        <p>Loading Quality Inspection data...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", color: "#e2e8f0", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ margin: 0, color: "#f4ae1f" }}>Quality Inspection</h1>
        <div style={{ display: "flex", gap: "12px" }}>
          <button onClick={() => setShowStats(!showStats)}
            style={{ background: "#1e3a5f", color: "#e2e8f0", border: "1px solid #3b4f61", padding: "8px 16px", borderRadius: "6px", cursor: "pointer" }}>
            {showStats ? "Hide Stats" : "View Stats"}
          </button>
        </div>
      </div>

      {/* Stats Panel */}
      {showStats && (
        <div style={{ background: "#0d1b2a", borderRadius: "10px", padding: "20px", marginBottom: "20px" }}>
          <h2 style={{ margin: "0 0 16px", color: "#f4ae1f" }}>Quality Statistics (Last 30 Days)</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
            <div>
              <div style={{ color: "#7da2d6", fontSize: "11px", textTransform: "uppercase", letterSpacing: 1, marginBottom: "4px" }}>Total Inspections</div>
              <div style={{ fontSize: "24px", fontWeight: "600", color: "#e2e8f0" }}>{stats.total_inspections || 0}</div>
            </div>
            <div>
              <div style={{ color: "#7da2d6", fontSize: "11px", textTransform: "uppercase", letterSpacing: 1, marginBottom: "4px" }}>Passed</div>
              <div style={{ fontSize: "24px", fontWeight: "600", color: "#22c55e" }}>{stats.passed_inspections || 0}</div>
            </div>
            <div>
              <div style={{ color: "#7da2d6", fontSize: "11px", textTransform: "uppercase", letterSpacing: 1, marginBottom: "4px" }}>Failed</div>
              <div style={{ fontSize: "24px", fontWeight: "600", color: "#ef4444" }}>{stats.failed_inspections || 0}</div>
            </div>
            <div>
              <div style={{ color: "#7da2d6", fontSize: "11px", textTransform: "uppercase", letterSpacing: 1, marginBottom: "4px" }}>Grade A</div>
              <div style={{ fontSize: "24px", fontWeight: "600", color: "#22c55e" }}>{stats.grade_a_count || 0}</div>
            </div>
            <div>
              <div style={{ color: "#7da2d6", fontSize: "11px", textTransform: "uppercase", letterSpacing: 1, marginBottom: "4px" }}>Grade B</div>
              <div style={{ fontSize: "24px", fontWeight: "600", color: "#f59e0b" }}>{stats.grade_b_count || 0}</div>
            </div>
            <div>
              <div style={{ color: "#7da2d6", fontSize: "11px", textTransform: "uppercase", letterSpacing: 1, marginBottom: "4px" }}>Grade C</div>
              <div style={{ fontSize: "24px", fontWeight: "600", color: "#eab308" }}>{stats.grade_c_count || 0}</div>
            </div>
            <div>
              <div style={{ color: "#7da2d6", fontSize: "11px", textTransform: "uppercase", letterSpacing: 1, marginBottom: "4px" }}>Grade R (Reject)</div>
              <div style={{ fontSize: "24px", fontWeight: "600", color: "#ef4444" }}>{stats.grade_r_count || 0}</div>
            </div>
            <div>
              <div style={{ color: "#7da2d6", fontSize: "11px", textTransform: "uppercase", letterSpacing: 1, marginBottom: "4px" }}>Avg Defects</div>
              <div style={{ fontSize: "24px", fontWeight: "600", color: "#e2e8f0" }}>{(stats.avg_defect_count || 0).toFixed(1)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Bar */}
      <NavBar
        label="Quality Inspections"
        list={inspections}
        selId={selectedInspection ? selectedInspection.inspection_id : null}
        idKey="inspection_id"
        optLabel={insp => `#${insp.inspection_id} - ${insp.roll_id} (${insp.inspection_type})`}
        onSelect={handleSelectInspection}
        disabled={!!selectedInspection}
        onAdd={handleAddInspection}
      />

      {/* Form Panel (Add/Edit) */}
      {selectedInspection && (
        <InspectionForm
          inspection={selectedInspection}
          onSave={handleSaveInspection}
          onCancel={() => setSelectedInspection(null)}
          loading={loading}
          defectTypes={defectTypes}
          rolls={rolls}
          inspections={inspections}
        />
      )}

      {/* Inspection List */}
      {!selectedInspection && (
        <div style={{ marginTop: "10px" }}>
          <h2 style={{ margin: "0 0 12px", color: "#f4ae1f" }}>Inspection List</h2>
          {inspections.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#7da2d6" }}>
              <div style={{ fontSize: "36px", marginBottom: "12px" }}>📋</div>
              <p>No inspections found. Click "+ Add" to create your first quality inspection.</p>
            </div>
          ) : (
            <div>
              {inspections.map(inspection => (
                <InspectionListItem
                  key={inspection.inspection_id}
                  inspection={inspection}
                  onSelect={handleSelectInspection}
                  onEdit={(inspection) => setSelectedInspection(inspection)}
                  onDelete={handleDeleteInspection}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}