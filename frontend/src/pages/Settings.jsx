import React, { useState, useEffect } from "react";

const cardStyle = {
  background: "#071120",
  border: "1px solid #16345d",
  borderRadius: "12px",
  padding: "20px",
  marginBottom: "20px",
};

const inputStyle = {
  width: "100%",
  padding: "10px",
  marginTop: "5px",
  marginBottom: "10px",
  background: "#0d1b2f",
  color: "white",
  border: "1px solid #16345d",
  borderRadius: "6px",
  boxSizing: "border-box",
};

const readonlyInputStyle = {
  ...inputStyle,
  background: "#060f1c",
  color: "#7da2d6",
  cursor: "not-allowed",
  border: "1px solid #0d2040",
};

const labelStyle = { color: "#7da2d6", fontSize: "16px" };

const sectionTabs = [
  "General",
  "Users",
  "Shifts",
  "Machine Configuration",
  "Roll Number Format",
  "Data Collectors",
  "Backup & Restore",
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState("General");
  const [settings, setSettings] = useState({
    company_name: "",
    factory_address: "",
    gst_number: "",
    phone_number: "",
    email: "",
    website: "",
    report_footer: "",
    roll_id_format: "",
    downtime_reasons: "",
    downtime_alert_minutes: "",
    critical_alert_minutes: "",
    collector_offline_alert: "",
    default_label_format: "",
    qr_prefix: "",
    roll_prefix: "",
    auto_downtime_enabled: "true",
    auto_downtime_threshold_minutes: "2",
  });

  const [machines, setMachines] = useState([]);
  const [dataCollectors, setDataCollectors] = useState([]);
  const [fabricTypes, setFabricTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [machineMsg, setMachineMsg] = useState({});
  const [dcForm, setDcForm] = useState({ dc_id: "", machine_id: "", ip_address: "" });
  const [dcMsg, setDcMsg] = useState("");
  const [showDcForm, setShowDcForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteMsg, setDeleteMsg] = useState("");
  const [editingMachine, setEditingMachine] = useState(null);
  const [machineEdits, setMachineEdits] = useState({});
  const [fabricForm, setFabricForm] = useState({ code: "", name: "", description: "" });
  const [fabricMsg, setFabricMsg] = useState("");
  const [editingFabric, setEditingFabric] = useState(null);
  const [fabricEdits, setFabricEdits] = useState({});

  useEffect(() => {
    Promise.all([loadSettings(), loadDataCollectors(), loadMachines(), loadFabricTypes()]).finally(() => setLoading(false));
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/settings");
      const data = await res.json();
      setSettings(prev => ({ ...prev, ...data }));
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const loadDataCollectors = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/data-collectors");
      const data = await res.json();
      setDataCollectors(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load data collectors:", err);
    }
  };

  const loadMachines = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/machine-settings");
      const data = await res.json();
      setMachines(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load machine settings:", err);
    }
  };

  const loadFabricTypes = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/fabric-types");
      const data = await res.json();
      setFabricTypes(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
  };

  const addFabric = async () => {
    if (!fabricForm.code || !fabricForm.name) { setFabricMsg("Code and name are required"); return; }
    try {
      const res = await fetch("http://localhost:4000/api/fabric-types", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fabricForm),
      });
      const data = await res.json();
      if (!res.ok) { setFabricMsg(data.error || "Failed"); return; }
      setFabricForm({ code: "", name: "", description: "" });
      setFabricMsg("Added!");
      loadFabricTypes();
    } catch (err) { setFabricMsg("Error: " + err.message); }
    setTimeout(() => setFabricMsg(""), 3000);
  };

  const saveFabric = async (code) => {
    try {
      const res = await fetch(`http://localhost:4000/api/fabric-types/${code}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fabricEdits),
      });
      if (!res.ok) { const d = await res.json(); setFabricMsg(d.error); return; }
      setEditingFabric(null);
      loadFabricTypes();
    } catch (err) { setFabricMsg("Error: " + err.message); }
  };

  const deleteFabric = async (code) => {
    if (!window.confirm(`Delete fabric type "${code}"?`)) return;
    try {
      const res = await fetch(`http://localhost:4000/api/fabric-types/${code}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setFabricMsg(data.error); return; }
      loadFabricTypes();
    } catch (err) { setFabricMsg("Error: " + err.message); }
  };

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveSettings = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("http://localhost:4000/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      setSaveMsg(data.success ? "Settings saved successfully." : "Save failed: " + (data.error || "Unknown error"));
    } catch (err) {
      setSaveMsg("Save failed: " + err.message);
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 4000);
  };

  const startEditMachine = (m) => {
    setEditingMachine(m.machine_id);
    setMachineEdits({
      fabric_code: m.fabric_code || "",
      gauge: m.gauge || "",
      rpm_target: m.rpm_target || "",
      kg_per_counter: m.kg_per_counter || "",
      manufacturer: m.manufacturer || "",
      model: m.model || "",
      serial_number: m.serial_number || "",
      needles_count: m.needles_count || "",
      cylinder_diameter: m.cylinder_diameter || "",
      purchase_date: m.purchase_date ? m.purchase_date.slice(0, 10) : "",
      installation_date: m.installation_date ? m.installation_date.slice(0, 10) : "",
    });
  };

  const saveMachineSetting = async (machineId) => {
    setMachineMsg(prev => ({ ...prev, [machineId]: "Saving..." }));
    try {
      const res = await fetch(`http://localhost:4000/api/machine-settings/${machineId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(machineEdits),
      });
      const data = await res.json();
      if (data.error) {
        setMachineMsg(prev => ({ ...prev, [machineId]: "Error: " + data.error }));
      } else {
        setMachineMsg(prev => ({ ...prev, [machineId]: "Saved!" }));
        setEditingMachine(null);
        loadMachines();
      }
    } catch (err) {
      setMachineMsg(prev => ({ ...prev, [machineId]: "Failed: " + err.message }));
    }
    setTimeout(() => setMachineMsg(prev => ({ ...prev, [machineId]: "" })), 3000);
  };

  const deleteCollector = async () => {
    if (!confirmDelete) return;
    setDeleteMsg("");
    try {
      const res = await fetch(`http://localhost:4000/api/data-collectors/${confirmDelete.dc_id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteMsg(data.error || "Delete failed.");
        return;
      }
      setConfirmDelete(null);
      loadDataCollectors();
      loadMachines();
    } catch (err) {
      setDeleteMsg("Delete failed: " + err.message);
    }
  };

  const registerDC = async () => {
    setDcMsg("");
    if (!dcForm.dc_id || !dcForm.machine_id) {
      setDcMsg("DC ID and Machine ID are required.");
      return;
    }
    try {
      const res = await fetch("http://localhost:4000/api/data-collectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dcForm),
      });
      const data = await res.json();
      if (data.error) { setDcMsg("Error: " + data.error); return; }
      setDcMsg("Registered: " + data.dc_id);
      setDcForm({ dc_id: "", machine_id: "", ip_address: "" });
      setShowDcForm(false);
      loadDataCollectors();
    } catch (err) {
      setDcMsg("Failed: " + err.message);
    }
    setTimeout(() => setDcMsg(""), 5000);
  };

  if (loading) {
    return <div style={{ padding: "40px", color: "#7da2d6" }}>Loading settings...</div>;
  }

  return (
    <div style={{ padding: "20px", color: "white", minHeight: "100vh" }}>
      <h1 style={{ color: "#f4ae1f", marginBottom: "25px" }}>SETTINGS CENTER</h1>

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px", flexWrap: "wrap" }}>
        {sectionTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 18px",
              borderRadius: "6px",
              border: activeTab === tab ? "1px solid #f4ae1f" : "1px solid #16345d",
              background: activeTab === tab ? "#f4ae1f" : "#0d1b2f",
              color: activeTab === tab ? "black" : "#7da2d6",
              cursor: "pointer",
              fontWeight: activeTab === tab ? "bold" : "normal",
              fontSize: "16px",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ─── GENERAL SETTINGS ─── */}
      {activeTab === "General" && (
        <div style={cardStyle}>
          <h2 style={{ color: "#f4ae1f", marginTop: 0 }}>General Settings</h2>
          <label style={labelStyle}>Company Name</label>
          <input style={inputStyle} value={settings.company_name || ""} onChange={e => handleChange("company_name", e.target.value)} />
          <label style={labelStyle}>Factory Address</label>
          <input style={inputStyle} value={settings.factory_address || ""} onChange={e => handleChange("factory_address", e.target.value)} />
          <label style={labelStyle}>GST Number</label>
          <input style={inputStyle} value={settings.gst_number || ""} onChange={e => handleChange("gst_number", e.target.value)} />
          <label style={labelStyle}>Phone Number</label>
          <input style={inputStyle} value={settings.phone_number || ""} onChange={e => handleChange("phone_number", e.target.value)} />
          <label style={labelStyle}>Email</label>
          <input style={inputStyle} type="email" value={settings.email || ""} onChange={e => handleChange("email", e.target.value)} />
          <label style={labelStyle}>Website</label>
          <input style={inputStyle} value={settings.website || ""} onChange={e => handleChange("website", e.target.value)} />
          <label style={labelStyle}>Report Footer</label>
          <input style={inputStyle} value={settings.report_footer || ""} onChange={e => handleChange("report_footer", e.target.value)} />

          <div style={{ borderTop: "1px solid #16345d", marginTop: "16px", paddingTop: "16px" }}>
            <h3 style={{ color: "#f4ae1f", marginTop: 0, marginBottom: "14px", fontSize: "18px" }}>Downtime Automation</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
              <label style={{ ...labelStyle, margin: 0 }}>Auto Downtime Detection</label>
              <div
                onClick={() => handleChange("auto_downtime_enabled", settings.auto_downtime_enabled === "false" ? "true" : "false")}
                style={{
                  width: "48px", height: "26px", borderRadius: "13px",
                  background: settings.auto_downtime_enabled !== "false" ? "#22c55e" : "#374151",
                  cursor: "pointer", position: "relative", transition: "background 0.2s",
                  border: "1px solid " + (settings.auto_downtime_enabled !== "false" ? "#22c55e" : "#4b5563"),
                }}
              >
                <div style={{
                  position: "absolute", top: "3px",
                  left: settings.auto_downtime_enabled !== "false" ? "24px" : "3px",
                  width: "18px", height: "18px", borderRadius: "50%",
                  background: "white", transition: "left 0.2s",
                }} />
              </div>
              <span style={{ color: settings.auto_downtime_enabled !== "false" ? "#22c55e" : "#7da2d6", fontSize: "16px" }}>
                {settings.auto_downtime_enabled !== "false" ? "Enabled" : "Disabled"}
              </span>
            </div>
            <label style={labelStyle}>Threshold (minutes) — downtime created after machine stops for this long</label>
            <input
              type="number" min="1" max="60" step="1"
              style={{ ...inputStyle, width: "120px" }}
              value={settings.auto_downtime_threshold_minutes || "2"}
              onChange={e => handleChange("auto_downtime_threshold_minutes", e.target.value)}
              disabled={settings.auto_downtime_enabled === "false"}
            />
          </div>

          <SaveButton saving={saving} onClick={saveSettings} />
          <SaveMsg msg={saveMsg} />
        </div>
      )}

      {/* ─── SHIFTS SETTINGS (READ-ONLY) ─── */}
      {activeTab === "Shifts" && (
        <div style={cardStyle}>
          <h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Shift Settings</h2>
          <p style={{ color: "#7da2d6", fontSize: "16px", marginBottom: "20px" }}>
            Shift configuration is fixed and cannot be modified. Two shifts operate at all times.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "10px", padding: "20px" }}>
              <div style={{ color: "#f4ae1f", fontWeight: "bold", fontSize: "18px", marginBottom: "10px" }}>
                Day Shift (A)
              </div>
              <div style={{ color: "white", fontSize: "29px", fontWeight: "bold" }}>08:00 – 20:00</div>
              <div style={{ color: "#7da2d6", fontSize: "14px", marginTop: "8px" }}>12 hours</div>
            </div>
            <div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "10px", padding: "20px" }}>
              <div style={{ color: "#a78bfa", fontWeight: "bold", fontSize: "18px", marginBottom: "10px" }}>
                Night Shift (B)
              </div>
              <div style={{ color: "white", fontSize: "29px", fontWeight: "bold" }}>20:00 – 08:00</div>
              <div style={{ color: "#7da2d6", fontSize: "14px", marginTop: "8px" }}>12 hours</div>
            </div>
          </div>
          <div style={{ marginTop: "20px", padding: "12px", background: "rgba(244,174,31,0.08)", border: "1px solid rgba(244,174,31,0.3)", borderRadius: "8px", color: "#f4ae1f", fontSize: "16px" }}>
            Shift logic is managed by the production engine and cannot be edited here.
          </div>
        </div>
      )}

      {/* ─── MACHINE CONFIGURATION ─── */}
      {activeTab === "Machine Configuration" && (
        <>
          {/* Fabric Types Master */}
          <div style={cardStyle}>
            <h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Fabric Types</h2>
            <p style={{ color: "#7da2d6", fontSize: "14px", marginBottom: "16px" }}>
              Define fabric codes used in roll IDs. e.g. code <strong style={{color:"#fff"}}>SJ</strong> = Single Jersey → Roll ID: DHM-SJ01-<strong style={{color:"#FFD700"}}>SJ</strong>-20260615-A-001
            </p>

            {/* Add new fabric */}
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr auto", gap: "10px", marginBottom: "16px", alignItems: "flex-end" }}>
              <div>
                <div style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px" }}>CODE *</div>
                <input style={{ ...inputStyle, marginBottom: 0, textTransform: "uppercase" }}
                  placeholder="SJ" maxLength={10}
                  value={fabricForm.code}
                  onChange={e => setFabricForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <div style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px" }}>NAME *</div>
                <input style={{ ...inputStyle, marginBottom: 0 }}
                  placeholder="Single Jersey"
                  value={fabricForm.name}
                  onChange={e => setFabricForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <div style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px" }}>DESCRIPTION</div>
                <input style={{ ...inputStyle, marginBottom: 0 }}
                  placeholder="Optional description"
                  value={fabricForm.description}
                  onChange={e => setFabricForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <button onClick={addFabric}
                style={{ background: "#FFD700", color: "#111", border: "none", padding: "10px 18px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", whiteSpace: "nowrap" }}>
                + Add
              </button>
            </div>
            {fabricMsg && <p style={{ color: fabricMsg === "Added!" ? "#22c55e" : "#ef4444", fontSize: "13px", margin: "0 0 12px" }}>{fabricMsg}</p>}

            {/* Fabric types table */}
            <table width="100%" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#0d1b2f", borderBottom: "1px solid #16345d" }}>
                  {["Code", "Name", "Description", "Used By", "Actions"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "#f4ae1f", fontSize: "13px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fabricTypes.map(ft => {
                  const usedBy = machines.filter(m => m.fabric_code === ft.code).map(m => m.machine_id).join(", ");
                  const isEdit = editingFabric === ft.code;
                  return (
                    <tr key={ft.code} style={{ borderBottom: "1px solid #0d1b2f" }}>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ background: "#16345d", color: "#FFD700", fontWeight: "bold", padding: "3px 10px", borderRadius: "4px", fontFamily: "monospace" }}>{ft.code}</span>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {isEdit
                          ? <input style={{ ...inputStyle, marginBottom: 0, width: "160px" }} value={fabricEdits.name}
                              onChange={e => setFabricEdits(p => ({ ...p, name: e.target.value }))} />
                          : <span style={{ color: "white" }}>{ft.name}</span>}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {isEdit
                          ? <input style={{ ...inputStyle, marginBottom: 0, width: "200px" }} value={fabricEdits.description || ""}
                              onChange={e => setFabricEdits(p => ({ ...p, description: e.target.value }))} />
                          : <span style={{ color: "#7da2d6", fontSize: "13px" }}>{ft.description || "—"}</span>}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#7da2d6", fontSize: "13px" }}>{usedBy || "—"}</td>
                      <td style={{ padding: "10px 12px" }}>
                        {isEdit ? (
                          <span style={{ display: "flex", gap: "6px" }}>
                            <button onClick={() => saveFabric(ft.code)}
                              style={{ background: "#22c55e", color: "#000", border: "none", padding: "5px 12px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>Save</button>
                            <button onClick={() => setEditingFabric(null)}
                              style={{ background: "#374151", color: "#fff", border: "none", padding: "5px 10px", borderRadius: "4px", cursor: "pointer" }}>Cancel</button>
                          </span>
                        ) : (
                          <span style={{ display: "flex", gap: "6px" }}>
                            <button onClick={() => { setEditingFabric(ft.code); setFabricEdits({ name: ft.name, description: ft.description || "" }); }}
                              style={{ background: "#16345d", color: "#f4ae1f", border: "1px solid #f4ae1f", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "13px" }}>Edit</button>
                            <button onClick={() => deleteFabric(ft.code)}
                              style={{ background: "transparent", color: "#ef4444", border: "1px solid #ef4444", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "13px" }}>Delete</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {fabricTypes.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: "20px", color: "#7da2d6", textAlign: "center" }}>No fabric types yet. Add one above.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Machine Configuration table */}
          <div style={cardStyle}>
            <h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Machine Configuration</h2>
            <p style={{ color: "#7da2d6", fontSize: "14px", marginBottom: "16px" }}>
              Assign a fabric code to each machine. This drives the Roll ID automatically.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table width="100%" style={{ borderCollapse: "collapse", minWidth: "900px" }}>
                <thead>
                  <tr style={{ background: "#0d1b2f", borderBottom: "1px solid #16345d" }}>
                    {["Machine", "Type", "Gauge", "Fabric Code", "RPM Target", "KG/Counter", "DC ID", "Manufacturer", "Model", "Serial No.", "Needles", "Actions"].map(h => (
                      <th key={h} style={{ padding: "10px 8px", textAlign: "left", color: "#f4ae1f", fontSize: "14px", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {machines.map(m => {
                    const isEditing = editingMachine === m.machine_id;
                    const fabricInfo = fabricTypes.find(f => f.code === m.fabric_code);
                    return (
                      <tr key={m.machine_id} style={{ borderBottom: "1px solid #0d1b2f" }}>
                        <td style={{ padding: "8px", fontWeight: "bold", color: "#f4ae1f", fontSize: "16px" }}>{m.machine_name}</td>
                        <td style={{ padding: "8px", color: "#7da2d6", fontSize: "14px" }}>{m.machine_type}</td>
                        <td style={{ padding: "8px" }}>
                          {isEditing
                            ? <input type="number" style={{ ...inputStyle, marginBottom: 0, width: "60px" }}
                                value={machineEdits.gauge} onChange={e => setMachineEdits(p => ({ ...p, gauge: e.target.value }))} />
                            : <span style={{ color: "white" }}>{m.gauge || "—"}</span>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {isEditing
                            ? <select style={{ ...inputStyle, marginBottom: 0, width: "160px" }}
                                value={machineEdits.fabric_code}
                                onChange={e => setMachineEdits(p => ({ ...p, fabric_code: e.target.value }))}>
                                <option value="">— None —</option>
                                {fabricTypes.map(ft => (
                                  <option key={ft.code} value={ft.code}>{ft.code} — {ft.name}</option>
                                ))}
                              </select>
                            : fabricInfo
                              ? <span><span style={{ background: "#16345d", color: "#FFD700", fontWeight: "bold", padding: "2px 8px", borderRadius: "4px", fontFamily: "monospace", marginRight: "6px" }}>{fabricInfo.code}</span><span style={{ color: "#aaa", fontSize: "13px" }}>{fabricInfo.name}</span></span>
                              : <span style={{ color: "#ef4444", fontSize: "13px" }}>Not assigned</span>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {isEditing
                            ? <input type="number" style={{ ...inputStyle, marginBottom: 0, width: "70px" }}
                                value={machineEdits.rpm_target} onChange={e => setMachineEdits(p => ({ ...p, rpm_target: e.target.value }))} />
                            : <span style={{ color: "white" }}>{m.rpm_target || "—"}</span>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {isEditing
                            ? <input type="number" step="0.00001" style={{ ...inputStyle, marginBottom: 0, width: "100px" }}
                                value={machineEdits.kg_per_counter} onChange={e => setMachineEdits(p => ({ ...p, kg_per_counter: e.target.value }))} />
                            : <span style={{ color: "white" }}>{m.kg_per_counter ? parseFloat(m.kg_per_counter).toFixed(5) : "—"}</span>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {isEditing
                            ? <input style={{ ...inputStyle, marginBottom: 0, width: "110px" }} placeholder="e.g. Mayer & Cie"
                                value={machineEdits.manufacturer} onChange={e => setMachineEdits(p => ({ ...p, manufacturer: e.target.value }))} />
                            : <span style={{ color: "white" }}>{m.manufacturer || "—"}</span>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {isEditing
                            ? <input style={{ ...inputStyle, marginBottom: 0, width: "100px" }} placeholder="Model"
                                value={machineEdits.model} onChange={e => setMachineEdits(p => ({ ...p, model: e.target.value }))} />
                            : <span style={{ color: "white" }}>{m.model || "—"}</span>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {isEditing
                            ? <input style={{ ...inputStyle, marginBottom: 0, width: "110px" }} placeholder="Serial No."
                                value={machineEdits.serial_number} onChange={e => setMachineEdits(p => ({ ...p, serial_number: e.target.value }))} />
                            : <span style={{ color: "white" }}>{m.serial_number || "—"}</span>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {isEditing
                            ? <input type="number" style={{ ...inputStyle, marginBottom: 0, width: "70px" }} placeholder="Needles"
                                value={machineEdits.needles_count} onChange={e => setMachineEdits(p => ({ ...p, needles_count: e.target.value }))} />
                            : <span style={{ color: "white" }}>{m.needles_count || "—"}</span>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          <span style={{ color: "#7da2d6", fontSize: "13px", background: "#0d1b2f", padding: "3px 8px", borderRadius: "4px", border: "1px solid #0d2040" }}>
                            {m.dc_id || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                          {isEditing ? (
                            <span style={{ display: "flex", gap: "6px" }}>
                              <button onClick={() => saveMachineSetting(m.machine_id)}
                                style={{ background: "#22c55e", color: "black", border: "none", padding: "5px 12px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: "14px" }}>Save</button>
                              <button onClick={() => setEditingMachine(null)}
                                style={{ background: "#374151", color: "white", border: "none", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "14px" }}>Cancel</button>
                            </span>
                          ) : (
                            <button onClick={() => startEditMachine(m)}
                              style={{ background: "#16345d", color: "#f4ae1f", border: "1px solid #f4ae1f", padding: "5px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "14px" }}>Edit</button>
                          )}
                          {machineMsg[m.machine_id] && (
                            <span style={{ marginLeft: "8px", color: machineMsg[m.machine_id].startsWith("Error") || machineMsg[m.machine_id].startsWith("Failed") ? "#ef4444" : "#22c55e", fontSize: "13px" }}>
                              {machineMsg[m.machine_id]}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ─── USERS TAB ─── */}
      {activeTab === "Users" && (
        <UsersSettingsTab />
      )}

      {/* ─── DATA COLLECTORS ─── */}
      {activeTab === "Data Collectors" && (
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <h2 style={{ color: "#f4ae1f", margin: 0 }}>Data Collectors</h2>
            <button
              onClick={() => setShowDcForm(f => !f)}
              style={{ background: "#16345d", color: "#f4ae1f", border: "1px solid #f4ae1f", padding: "6px 14px", borderRadius: "6px", cursor: "pointer", fontSize: "16px" }}
            >
              {showDcForm ? "✕ Cancel" : "+ Register DC"}
            </button>
          </div>

          {showDcForm && (
            <div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "8px", padding: "16px", marginBottom: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={labelStyle}>DC ID *</label>
                  <input style={inputStyle} placeholder="e.g. DC001" value={dcForm.dc_id} onChange={e => setDcForm({ ...dcForm, dc_id: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Machine ID *</label>
                  <input style={inputStyle} placeholder="e.g. SJ01" value={dcForm.machine_id} onChange={e => setDcForm({ ...dcForm, machine_id: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>IP Address</label>
                  <input style={inputStyle} placeholder="e.g. 192.168.1.101" value={dcForm.ip_address} onChange={e => setDcForm({ ...dcForm, ip_address: e.target.value })} />
                </div>
              </div>
              <button
                onClick={registerDC}
                style={{ marginTop: "12px", background: "#f4ae1f", color: "black", border: "none", padding: "8px 18px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
              >Register</button>
              {dcMsg && (
                <span style={{ marginLeft: "14px", color: dcMsg.startsWith("Error") || dcMsg.startsWith("Failed") ? "#ef4444" : "#22c55e", fontSize: "16px" }}>
                  {dcMsg}
                </span>
              )}
            </div>
          )}

          <table width="100%" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#f4ae1f", borderBottom: "1px solid #16345d" }}>
                <th style={{ padding: "8px", textAlign: "left" }}>DC ID</th>
                <th style={{ padding: "8px", textAlign: "left" }}>Machine</th>
                <th style={{ padding: "8px", textAlign: "left" }}>IP Address</th>
                <th style={{ padding: "8px", textAlign: "left" }}>Network Status</th>
                <th style={{ padding: "8px", textAlign: "left" }}>Last Seen</th>
                <th style={{ padding: "8px", textAlign: "left" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dataCollectors.length === 0 ? (
                <tr><td colSpan="6" style={{ padding: "14px", color: "#7da2d6", fontStyle: "italic" }}>
                  No data collectors registered — use "+ Register DC" to add one
                </td></tr>
              ) : (
                dataCollectors.map(dc => {
                  const isOnline = (dc.status || "").toUpperCase() === "ONLINE";
                  return (
                    <tr key={dc.dc_id} style={{ borderBottom: "1px solid #0d1b2f" }}>
                      <td style={{ padding: "8px" }}>{dc.dc_id}</td>
                      <td style={{ padding: "8px" }}>{dc.machine_id || "—"}</td>
                      <td style={{ padding: "8px" }}>{dc.ip_address || "—"}</td>
                      <td style={{ padding: "8px" }}>
                        <span style={{ color: isOnline ? "#22c55e" : "#ef4444", fontWeight: "bold" }}>
                          {dc.status || "OFFLINE"}
                        </span>
                      </td>
                      <td style={{ padding: "8px", color: "#7da2d6", fontSize: "14px" }}>
                        {dc.last_seen ? new Date(dc.last_seen).toLocaleString() : "Never"}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <button
                          onClick={() => { setDeleteMsg(""); setConfirmDelete(dc); }}
                          disabled={isOnline}
                          title={isOnline ? "Cannot delete — collector is ONLINE" : "Delete collector"}
                          style={{
                            background: isOnline ? "#1a1a2e" : "rgba(239,68,68,0.15)",
                            color: isOnline ? "#374151" : "#ef4444",
                            border: `1px solid ${isOnline ? "#374151" : "#ef4444"}`,
                            padding: "4px 10px",
                            borderRadius: "5px",
                            cursor: isOnline ? "not-allowed" : "pointer",
                            fontSize: "16px",
                          }}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Confirmation Modal */}
          {confirmDelete && (
            <div style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              background: "rgba(0,0,0,0.75)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 1000,
            }}>
              <div style={{
                background: "#071120",
                border: "1px solid #ef4444",
                borderRadius: "12px",
                padding: "32px",
                width: "460px",
                maxWidth: "95vw",
              }}>
                <h3 style={{ color: "#ef4444", marginTop: 0 }}>Delete Data Collector?</h3>
                <p style={{ color: "#cbd5e1", fontSize: "16px", marginBottom: "6px" }}>
                  You are about to permanently delete:
                </p>
                <div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px" }}>
                  <div style={{ color: "#f4ae1f", fontWeight: "bold", fontSize: "17px" }}>{confirmDelete.dc_id}</div>
                  <div style={{ color: "#7da2d6", fontSize: "14px", marginTop: "4px" }}>
                    Machine: {confirmDelete.machine_id || "—"} &nbsp;·&nbsp; IP: {confirmDelete.ip_address || "—"}
                  </div>
                </div>
                <p style={{ color: "#7da2d6", fontSize: "14px", marginBottom: "20px" }}>
                  This will remove the collector mapping from the machine and set its DC status to "No Collector". This action cannot be undone.
                </p>
                {deleteMsg && (
                  <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid #ef4444", borderRadius: "6px", padding: "10px 14px", color: "#ef4444", fontSize: "14px", marginBottom: "16px" }}>
                    {deleteMsg}
                  </div>
                )}
                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => { setConfirmDelete(null); setDeleteMsg(""); }}
                    style={{ background: "#374151", color: "white", border: "none", padding: "9px 20px", borderRadius: "6px", cursor: "pointer", fontSize: "15px" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={deleteCollector}
                    style={{ background: "#ef4444", color: "white", border: "none", padding: "9px 20px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", fontSize: "15px" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── ROLL NUMBER FORMAT ─── */}
      {activeTab === "Roll Number Format" && (
        <div style={cardStyle}>
          <h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Roll Number Format</h2>
          <p style={{ color: "#7da2d6", fontSize: "16px", marginBottom: "16px" }}>
            Configure default values for future QR-based roll tracking. Printing is not yet active.
          </p>
          <label style={labelStyle}>Default Label Format</label>
          <input style={inputStyle} placeholder="e.g. QR" value={settings.default_label_format || ""} onChange={e => handleChange("default_label_format", e.target.value)} />
          <label style={labelStyle}>QR Prefix</label>
          <input style={inputStyle} placeholder="e.g. DHN-QR-" value={settings.qr_prefix || ""} onChange={e => handleChange("qr_prefix", e.target.value)} />
          <label style={labelStyle}>Roll Prefix</label>
          <input style={inputStyle} placeholder="e.g. DHN-" value={settings.roll_prefix || ""} onChange={e => handleChange("roll_prefix", e.target.value)} />
          <label style={labelStyle}>Roll ID Format Template</label>
          <input style={inputStyle} value={settings.roll_id_format || ""} onChange={e => handleChange("roll_id_format", e.target.value)} />
          <SaveButton saving={saving} onClick={saveSettings} />
          <SaveMsg msg={saveMsg} />
        </div>
      )}

      {/* ─── BACKUP & RESTORE ─── */}
      {activeTab === "Backup & Restore" && (
        <BackupRestoreTab />
      )}
    </div>
  );
}

function UsersSettingsTab() {
  const [users, setUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    fetch("http://localhost:4000/api/users")
      .then(r => r.json())
      .then(d => { setUsers(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => { setErr("Unable to load users."); setLoading(false); });
  }, []);

  const ROLE_COLORS = {
    SUPER_ADMIN: "#f4ae1f", ADMIN: "#60a5fa", SUPERVISOR: "#34d399",
    OPERATOR: "#a78bfa", VIEWER: "#6b7280",
  };

  return (
    <div style={{ background: "#071120", border: "1px solid #16345d", borderRadius: "12px", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ color: "#f4ae1f", margin: 0 }}>Users</h2>
        <a
          href="/users"
          style={{ background: "#f4ae1f", color: "black", padding: "7px 18px", borderRadius: "6px", textDecoration: "none", fontWeight: "bold", fontSize: "15px" }}
        >
          Manage Users →
        </a>
      </div>
      <p style={{ color: "#7da2d6", fontSize: "15px", marginBottom: "16px" }}>
        Full user management is available at the User Management page. Quick overview below.
      </p>
      {loading ? (
        <div style={{ color: "#7da2d6" }}>Loading users...</div>
      ) : err ? (
        <div style={{ color: "#ef4444" }}>{err}</div>
      ) : (
        <table width="100%" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #16345d" }}>
              {["Username", "Full Name", "Mobile", "Role", "Status"].map(h => (
                <th key={h} style={{ padding: "8px", textAlign: "left", color: "#f4ae1f", fontSize: "14px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: "1px solid #0d1b2f", opacity: u.active ? 1 : 0.5 }}>
                <td style={{ padding: "8px", color: "white", fontWeight: "bold" }}>{u.username}</td>
                <td style={{ padding: "8px", color: "#cbd5e1" }}>{u.full_name}</td>
                <td style={{ padding: "8px", color: "#7da2d6", fontSize: "14px" }}>{u.mobile || "—"}</td>
                <td style={{ padding: "8px" }}>
                  <span style={{
                    background: (ROLE_COLORS[u.role] || "#6b7280") + "22",
                    color: ROLE_COLORS[u.role] || "#6b7280",
                    border: `1px solid ${(ROLE_COLORS[u.role] || "#6b7280")}44`,
                    padding: "2px 8px", borderRadius: "10px", fontSize: "13px", fontWeight: "bold",
                  }}>{u.role}</span>
                </td>
                <td style={{ padding: "8px", color: u.active ? "#22c55e" : "#ef4444", fontWeight: "bold", fontSize: "14px" }}>
                  {u.active ? "Active" : "Inactive"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BackupRestoreTab() {
  const [status, setStatus] = React.useState("");
  const [statusType, setStatusType] = React.useState("success");
  const [loading, setLoading] = React.useState(false);

  const createBackup = async () => {
    setLoading(true);
    setStatus("");
    try {
      const res = await fetch("http://localhost:4000/api/backup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setStatusType("error");
        setStatus("Backup failed: " + (data.error || "Unknown error"));
      } else {
        setStatusType("success");
        setStatus(`Backup created: ${data.filename}`);
      }
    } catch (err) {
      setStatusType("error");
      setStatus("Backup failed: " + err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ background: "#071120", border: "1px solid #16345d", borderRadius: "12px", padding: "20px" }}>
      <h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Backup & Restore</h2>
      <p style={{ color: "#7da2d6", fontSize: "15px", marginBottom: "20px" }}>
        Create a full database backup using pg_dump. Backups are saved to{" "}
        <code style={{ color: "#f4ae1f", background: "#0d1b2f", padding: "2px 6px", borderRadius: "4px" }}>
          D:\DHOWN_LIVE_PRODUCTION_DASHBOARD\backups\
        </code>
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
        <div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "10px", padding: "18px" }}>
          <div style={{ color: "#f4ae1f", fontWeight: "bold", marginBottom: "8px", fontSize: "16px" }}>
            Create Backup
          </div>
          <p style={{ color: "#7da2d6", fontSize: "14px", marginBottom: "14px" }}>
            Full dump of dhown_mes database in compressed format (.dump).
          </p>
          <button
            onClick={createBackup}
            disabled={loading}
            style={{
              background: loading ? "#374151" : "#f4ae1f",
              color: loading ? "white" : "black",
              border: "none",
              padding: "10px 22px",
              borderRadius: "6px",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: "bold",
              fontSize: "15px",
            }}
          >
            {loading ? "Creating Backup..." : "Create Backup Now"}
          </button>
          {status && (
            <div style={{
              marginTop: "12px",
              background: statusType === "error" ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
              border: `1px solid ${statusType === "error" ? "#ef4444" : "#22c55e"}`,
              padding: "10px 14px", borderRadius: "7px",
              color: statusType === "error" ? "#ef4444" : "#22c55e",
              fontSize: "14px",
            }}>
              {status}
            </div>
          )}
        </div>

        <div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "10px", padding: "18px" }}>
          <div style={{ color: "#7da2d6", fontWeight: "bold", marginBottom: "8px", fontSize: "16px" }}>
            Restore
          </div>
          <p style={{ color: "#7da2d6", fontSize: "14px", marginBottom: "14px" }}>
            To restore from a backup file, run the following command in PostgreSQL terminal:
          </p>
          <code style={{
            display: "block",
            background: "#050d1a",
            border: "1px solid #16345d",
            borderRadius: "6px",
            padding: "12px",
            color: "#22c55e",
            fontSize: "13px",
            wordBreak: "break-all",
          }}>
            pg_restore -U postgres -d dhown_mes -F c backup_file.dump
          </code>
        </div>
      </div>

      <div style={{ background: "rgba(244,174,31,0.08)", border: "1px solid rgba(244,174,31,0.3)", borderRadius: "8px", padding: "14px", color: "#f4ae1f", fontSize: "14px" }}>
        Recommendation: Schedule daily backups and store copies on an external drive or network share.
      </div>
    </div>
  );
}

function SaveButton({ saving, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      style={{
        background: saving ? "#555" : "#f4ae1f",
        color: "black",
        border: "none",
        padding: "12px 28px",
        borderRadius: "8px",
        cursor: saving ? "not-allowed" : "pointer",
        fontWeight: "bold",
        fontSize: "18px",
        marginTop: "8px",
      }}
    >
      {saving ? "Saving..." : "Save Settings"}
    </button>
  );
}

function SaveMsg({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      background: msg.includes("failed") || msg.includes("Failed") ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
      border: `1px solid ${msg.includes("failed") || msg.includes("Failed") ? "#ef4444" : "#22c55e"}`,
      padding: "10px 16px",
      borderRadius: "8px",
      marginTop: "12px",
      color: msg.includes("failed") || msg.includes("Failed") ? "#ef4444" : "#22c55e",
      fontSize: "17px",
    }}>
      {msg}
    </div>
  );
}
