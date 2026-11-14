import React, { useState, useEffect } from "react";

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "20px",
  marginBottom: "20px",
};

const inputStyle = {
  width: "100%",
  padding: "10px",
  marginTop: "5px",
  marginBottom: "10px",
  background: "var(--surface)",
  color: "white",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  boxSizing: "border-box",
};

const readonlyInputStyle = {
  ...inputStyle,
  background: "var(--surface)",
  color: "var(--muted)",
  cursor: "not-allowed",
  border: "1px solid var(--surface)",
};

const labelStyle = { color: "var(--muted)", fontSize: "16px" };

const sectionTabs = [
  "General",
  "Users",
  "Shifts",
  "Machine Configuration",
  "Roll Number Format",
  "Data Collectors",
  "Busy Sync",
  "Backup & Restore",
  "Display Token",
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
  const [fabricItems, setFabricItems] = useState([]);
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
    Promise.all([loadSettings(), loadDataCollectors(), loadMachines(), loadFabricTypes(), loadFabricItems()]).finally(() => setLoading(false));
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings(prev => ({ ...prev, ...data }));
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const loadDataCollectors = async () => {
    try {
      const res = await fetch("/api/data-collectors");
      const data = await res.json();
      setDataCollectors(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load data collectors:", err);
    }
  };

  const loadMachines = async () => {
    try {
      const res = await fetch("/api/machine-settings");
      const data = await res.json();
      setMachines(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load machine settings:", err);
    }
  };

  const loadFabricTypes = async () => {
    try {
      const res = await fetch("/api/fabric-types");
      const data = await res.json();
      setFabricTypes(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
  };

  const loadFabricItems = async () => {
    try {
      const t = localStorage.getItem('dhown_token');
      const res = await fetch("/api/erp/items?limit=200", {
        headers: { Authorization: `Bearer ${t}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      const rows = data.data || data;
      // Keep only fabric categories
      const fabricCats = ['FABRIC'];
      setFabricItems(rows.filter(i => fabricCats.includes(i.category_code) || i.category_name?.toLowerCase().includes('fabric')));
    } catch (err) { console.error(err); }
  };

  const addFabric = async () => {
    if (!fabricForm.code || !fabricForm.name) { setFabricMsg("Code and name are required"); return; }
    try {
      const res = await fetch("/api/fabric-types", {
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
      const res = await fetch(`/api/fabric-types/${code}`, {
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
      const res = await fetch(`/api/fabric-types/${code}`, { method: "DELETE" });
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
      const res = await fetch("/api/settings", {
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
      const res = await fetch(`/api/machine-settings/${machineId}`, {
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
      const res = await fetch(`/api/data-collectors/${confirmDelete.dc_id}`, {
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
      const res = await fetch("/api/data-collectors", {
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
    return <div style={{ padding: "40px", color: "var(--muted)" }}>Loading settings...</div>;
  }

  return (
    <div style={{ padding: "20px", color: "white", minHeight: "100vh" }}>
      <h1 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", marginBottom: "25px" }}>SETTINGS CENTER</h1>

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "24px", flexWrap: "wrap" }}>
        {sectionTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 18px",
              borderRadius: "6px",
              border: activeTab === tab ? "1px solid var(--gold)" : "1px solid var(--border)",
              background: activeTab === tab ? "var(--yellow)" : "var(--surface)",
              color: activeTab === tab ? "black" : "var(--muted)",
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
          <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", marginTop: 0 }}>General Settings</h2>
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

          <div style={{ borderTop: "1px solid var(--border)", marginTop: "16px", paddingTop: "16px" }}>
            <h3 style={{ color: "var(--yellow)", marginTop: 0, marginBottom: "14px", fontSize: "18px" }}>Downtime Automation</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
              <label style={{ ...labelStyle, margin: 0 }}>Auto Downtime Detection</label>
              <div
                onClick={() => handleChange("auto_downtime_enabled", settings.auto_downtime_enabled === "false" ? "true" : "false")}
                style={{
                  width: "48px", height: "26px", borderRadius: "13px",
                  background: settings.auto_downtime_enabled !== "false" ? "var(--green)" : "var(--border)",
                  cursor: "pointer", position: "relative", transition: "background 0.2s",
                  border: "1px solid " + (settings.auto_downtime_enabled !== "false" ? "var(--green)" : "var(--surface)"),
                }}
              >
                <div style={{
                  position: "absolute", top: "3px",
                  left: settings.auto_downtime_enabled !== "false" ? "24px" : "3px",
                  width: "18px", height: "18px", borderRadius: "50%",
                  background: "white", transition: "left 0.2s",
                }} />
              </div>
              <span style={{ color: settings.auto_downtime_enabled !== "false" ? "var(--green)" : "var(--muted)", fontSize: "16px" }}>
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
          <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", marginTop: 0 }}>Shift Settings</h2>
          <p style={{ color: "var(--muted)", fontSize: "16px", marginBottom: "20px" }}>
            Shift configuration is fixed and cannot be modified. Two shifts operate at all times.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "20px" }}>
              <div style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: "18px", marginBottom: "10px" }}>
                Day Shift (A)
              </div>
              <div style={{ color: "white", fontSize: "29px", fontWeight: "bold" }}>08:00 – 20:00</div>
              <div style={{ color: "var(--muted)", fontSize: "14px", marginTop: "8px" }}>12 hours</div>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "20px" }}>
              <div style={{ color: "var(--purple)", fontWeight: "bold", fontSize: "18px", marginBottom: "10px" }}>
                Night Shift (B)
              </div>
              <div style={{ color: "white", fontSize: "29px", fontWeight: "bold" }}>20:00 – 08:00</div>
              <div style={{ color: "var(--muted)", fontSize: "14px", marginTop: "8px" }}>12 hours</div>
            </div>
          </div>
          <div style={{ marginTop: "20px", padding: "12px", background: "rgba(244,174,31,0.08)", border: "1px solid rgba(244,174,31,0.3)", borderRadius: "8px", color: "var(--yellow)", fontSize: "16px" }}>
            Shift logic is managed by the production engine and cannot be edited here.
          </div>
        </div>
      )}

      {/* ─── MACHINE CONFIGURATION ─── */}
      {activeTab === "Machine Configuration" && (
        <>
          {/* Machine Configuration table */}
          <div style={cardStyle}>
            <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", marginTop: 0 }}>Machine Configuration</h2>
            <p style={{ color: "var(--muted)", fontSize: "14px", marginBottom: "16px" }}>
              Assign a fabric to each machine from <strong style={{ color: "var(--yellow)" }}>Item Master</strong>. To add new fabric types go to <strong style={{ color: "var(--yellow)" }}>Master Data → Item Master</strong>.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table width="100%" style={{ borderCollapse: "collapse", minWidth: "900px" }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    {["Machine", "Type", "Gauge", "Fabric Code", "RPM Target", "KG/Counter", "DC ID", "Manufacturer", "Model", "Serial No.", "Needles", "Actions"].map(h => (
                      <th key={h} style={{ padding: "10px 8px", textAlign: "left", color: "var(--yellow)", fontSize: "14px", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {machines.map(m => {
                    const isEditing = editingMachine === m.machine_id;
                    const fabricInfo = fabricItems.find(f => (f.item_code || f.code) === m.fabric_code) || fabricTypes.find(f => f.code === m.fabric_code);
                    return (
                      <tr key={m.machine_id} style={{ borderBottom: "1px solid var(--surface)" }}>
                        <td style={{ padding: "8px", fontWeight: "bold", color: "var(--yellow)", fontSize: "16px" }}>{m.machine_name}</td>
                        <td style={{ padding: "8px", color: "var(--muted)", fontSize: "14px" }}>{m.machine_type}</td>
                        <td style={{ padding: "8px" }}>
                          {isEditing
                            ? <input type="number" style={{ ...inputStyle, marginBottom: 0, width: "60px" }}
                                value={machineEdits.gauge} onChange={e => setMachineEdits(p => ({ ...p, gauge: e.target.value }))} />
                            : <span style={{ color: "white" }}>{m.gauge || "—"}</span>}
                        </td>
                        <td style={{ padding: "8px" }}>
                          {isEditing
                            ? <select style={{ ...inputStyle, marginBottom: 0, width: "200px" }}
                                value={machineEdits.fabric_code}
                                onChange={e => setMachineEdits(p => ({ ...p, fabric_code: e.target.value }))}>
                                <option value="">— None —</option>
                                {(fabricItems.length > 0 ? fabricItems : fabricTypes).map(ft => (
                                  <option key={ft.item_code || ft.code} value={ft.item_code || ft.code}>
                                    {ft.item_code || ft.code} — {ft.item_name || ft.name}
                                  </option>
                                ))}
                              </select>
                            : fabricInfo
                              ? <span><span style={{ background: "var(--surface)", color: "var(--yellow)", fontWeight: "bold", padding: "2px 8px", borderRadius: "4px", fontFamily: "monospace", marginRight: "6px" }}>{fabricInfo.item_code || fabricInfo.code}</span><span style={{ color: "#aaa", fontSize: "13px" }}>{fabricInfo.item_name || fabricInfo.name}</span></span>
                              : <span style={{ color: "var(--crit)", fontSize: "13px" }}>Not assigned</span>}
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
                          <span style={{ color: "var(--muted)", fontSize: "13px", background: "var(--surface)", padding: "3px 8px", borderRadius: "4px", border: "1px solid var(--surface)" }}>
                            {m.dc_id || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                          {isEditing ? (
                            <span style={{ display: "flex", gap: "6px" }}>
                              <button onClick={() => saveMachineSetting(m.machine_id)}
                                style={{ background: "var(--green)", color: "black", border: "none", padding: "5px 12px", borderRadius: "4px", cursor: "pointer", fontWeight: "bold", fontSize: "14px" }}>Save</button>
                              <button onClick={() => setEditingMachine(null)}
                                style={{ background: "var(--border)", color: "white", border: "none", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "14px" }}>Cancel</button>
                            </span>
                          ) : (
                            <button onClick={() => startEditMachine(m)}
                              style={{ background: "var(--surface)", color: "var(--yellow)", border: "1px solid var(--gold)", padding: "5px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "14px" }}>Edit</button>
                          )}
                          {machineMsg[m.machine_id] && (
                            <span style={{ marginLeft: "8px", color: machineMsg[m.machine_id].startsWith("Error") || machineMsg[m.machine_id].startsWith("Failed") ? "var(--crit)" : "var(--green)", fontSize: "13px" }}>
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
            <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: 0 }}>Data Collectors</h2>
            <button
              onClick={() => setShowDcForm(f => !f)}
              style={{ background: "var(--surface)", color: "var(--yellow)", border: "1px solid var(--gold)", padding: "6px 14px", borderRadius: "6px", cursor: "pointer", fontSize: "16px" }}
            >
              {showDcForm ? "✕ Cancel" : "+ Register DC"}
            </button>
          </div>

          {showDcForm && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px", marginBottom: "16px" }}>
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
                style={{ marginTop: "12px", background: "var(--yellow)", color: "black", border: "none", padding: "8px 18px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}
              >Register</button>
              {dcMsg && (
                <span style={{ marginLeft: "14px", color: dcMsg.startsWith("Error") || dcMsg.startsWith("Failed") ? "var(--crit)" : "var(--green)", fontSize: "16px" }}>
                  {dcMsg}
                </span>
              )}
            </div>
          )}

          <table width="100%" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--yellow)", borderBottom: "1px solid var(--border)" }}>
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
                <tr><td colSpan="6" style={{ padding: "14px", color: "var(--muted)", fontStyle: "italic" }}>
                  No data collectors registered — use "+ Register DC" to add one
                </td></tr>
              ) : (
                dataCollectors.map(dc => {
                  const isOnline = (dc.status || "").toUpperCase() === "ONLINE";
                  return (
                    <tr key={dc.dc_id} style={{ borderBottom: "1px solid var(--surface)" }}>
                      <td style={{ padding: "8px" }}>{dc.dc_id}</td>
                      <td style={{ padding: "8px" }}>{dc.machine_id || "—"}</td>
                      <td style={{ padding: "8px" }}>{dc.ip_address || "—"}</td>
                      <td style={{ padding: "8px" }}>
                        <span style={{ color: isOnline ? "var(--green)" : "var(--crit)", fontWeight: "bold" }}>
                          {dc.status || "OFFLINE"}
                        </span>
                      </td>
                      <td style={{ padding: "8px", color: "var(--muted)", fontSize: "14px" }}>
                        {dc.last_seen ? new Date(dc.last_seen).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : "Never"}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <button
                          onClick={() => { setDeleteMsg(""); setConfirmDelete(dc); }}
                          disabled={isOnline}
                          title={isOnline ? "Cannot delete — collector is ONLINE" : "Delete collector"}
                          style={{
                            background: isOnline ? "var(--surface)" : "rgba(239,68,68,0.15)",
                            color: isOnline ? "var(--border)" : "var(--crit)",
                            border: `1px solid ${isOnline ? "var(--border)" : "var(--crit)"}`,
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
                background: "var(--surface)",
                border: "1px solid var(--crit)",
                borderRadius: "12px",
                padding: "32px",
                width: "460px",
                maxWidth: "95vw",
              }}>
                <h3 style={{ color: "var(--crit)", marginTop: 0 }}>Delete Data Collector?</h3>
                <p style={{ color: "var(--muted)", fontSize: "16px", marginBottom: "6px" }}>
                  You are about to permanently delete:
                </p>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px" }}>
                  <div style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: "17px" }}>{confirmDelete.dc_id}</div>
                  <div style={{ color: "var(--muted)", fontSize: "14px", marginTop: "4px" }}>
                    Machine: {confirmDelete.machine_id || "—"} &nbsp;·&nbsp; IP: {confirmDelete.ip_address || "—"}
                  </div>
                </div>
                <p style={{ color: "var(--muted)", fontSize: "14px", marginBottom: "20px" }}>
                  This will remove the collector mapping from the machine and set its DC status to "No Collector". This action cannot be undone.
                </p>
                {deleteMsg && (
                  <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid var(--crit)", borderRadius: "6px", padding: "10px 14px", color: "var(--crit)", fontSize: "14px", marginBottom: "16px" }}>
                    {deleteMsg}
                  </div>
                )}
                <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => { setConfirmDelete(null); setDeleteMsg(""); }}
                    style={{ background: "var(--border)", color: "white", border: "none", padding: "9px 20px", borderRadius: "6px", cursor: "pointer", fontSize: "15px" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={deleteCollector}
                    style={{ background: "var(--crit)", color: "white", border: "none", padding: "9px 20px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", fontSize: "15px" }}
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
          <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", marginTop: 0 }}>Roll Number Format</h2>
          <p style={{ color: "var(--muted)", fontSize: "16px", marginBottom: "16px" }}>
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
      {activeTab === "Busy Sync" && (
        <BusySyncTab />
      )}

      {activeTab === "Backup & Restore" && (
        <BackupRestoreTab />
      )}

      {activeTab === "Display Token" && (
        <DisplayTokenTab />
      )}
    </div>
  );
}

function BusySyncTab() {
  const API = "";
  const token = () => localStorage.getItem("dhown_token");
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [from, setFrom] = React.useState(firstOfMonth);
  const [to, setTo]     = React.useState(today);

  const download = (type) => {
    const params = new URLSearchParams({ from, to });
    const url = `${API}/api/busy-sync/${type}-csv?${params}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `busy_${type}_${from}_${to}.csv`;
    const headers = { Authorization: `Bearer ${token()}` };
    fetch(url, { headers }).then(r => r.blob()).then(blob => {
      a.href = URL.createObjectURL(blob);
      a.click();
    });
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '24px', maxWidth: 600 }}>
      <h3 style={{ color: 'var(--gold)', margin: '0 0 6px' }}>Busy 21 CSV Export</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 20px' }}>
        Download CSV files for manual import into Busy 21 accounting software.
        GRN CSV → Purchase Vouchers. Dispatch CSV → Delivery Challan / Sales.
      </p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 4 }}>FROM DATE</div>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ background: 'var(--bg)', border: '1px solid var(--surface)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontSize: 13 }} />
        </div>
        <div>
          <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 4 }}>TO DATE</div>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ background: 'var(--bg)', border: '1px solid var(--surface)', color: 'var(--text)', padding: '8px 10px', borderRadius: 6, fontSize: 13 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={() => download('grn')}
          style={{ background: 'var(--gold)', color: '#000', border: 'none', borderRadius: 7, padding: '10px 24px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
          ⬇ GRN Purchases CSV
        </button>
        <button onClick={() => download('dispatch')}
          style={{ background: 'var(--green)', color: '#000', border: 'none', borderRadius: 7, padding: '10px 24px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
          ⬇ Dispatch / Sales CSV
        </button>
      </div>
    </div>
  );
}

function UsersSettingsTab() {
  const [users, setUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    fetch("/api/users")
      .then(r => r.json())
      .then(d => { setUsers(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => { setErr("Unable to load users."); setLoading(false); });
  }, []);

  const ROLE_COLORS = {
    SUPER_ADMIN: "var(--yellow)", ADMIN: "var(--link)", SUPERVISOR: "var(--green-2)",
    OPERATOR: "var(--purple)", VIEWER: "var(--muted)",
  };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: 0 }}>Users</h2>
        <a
          href="/users"
          style={{ background: "var(--yellow)", color: "black", padding: "7px 18px", borderRadius: "6px", textDecoration: "none", fontWeight: "bold", fontSize: "15px" }}
        >
          Manage Users →
        </a>
      </div>
      <p style={{ color: "var(--muted)", fontSize: "15px", marginBottom: "16px" }}>
        Full user management is available at the User Management page. Quick overview below.
      </p>
      {loading ? (
        <div style={{ color: "var(--muted)" }}>Loading users...</div>
      ) : err ? (
        <div style={{ color: "var(--crit)" }}>{err}</div>
      ) : (
        <table width="100%" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Username", "Full Name", "Mobile", "Role", "Status"].map(h => (
                <th key={h} style={{ padding: "8px", textAlign: "left", color: "var(--yellow)", fontSize: "14px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: "1px solid var(--surface)", opacity: u.active ? 1 : 0.5 }}>
                <td style={{ padding: "8px", color: "white", fontWeight: "bold" }}>{u.username}</td>
                <td style={{ padding: "8px", color: "var(--muted)" }}>{u.full_name}</td>
                <td style={{ padding: "8px", color: "var(--muted)", fontSize: "14px" }}>{u.mobile || "—"}</td>
                <td style={{ padding: "8px" }}>
                  <span style={{
                    background: (ROLE_COLORS[u.role] || "var(--muted)") + "22",
                    color: ROLE_COLORS[u.role] || "var(--muted)",
                    border: `1px solid ${(ROLE_COLORS[u.role] || "var(--muted)")}44`,
                    padding: "2px 8px", borderRadius: "10px", fontSize: "13px", fontWeight: "bold",
                  }}>{u.role}</span>
                </td>
                <td style={{ padding: "8px", color: u.active ? "var(--green)" : "var(--crit)", fontWeight: "bold", fontSize: "14px" }}>
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
  const [msg, setMsg] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [backups, setBackups] = React.useState([]);
  const [loadingList, setLoadingList] = React.useState(true);

  const token = localStorage.getItem("dhown_token");
  const headers = { Authorization: `Bearer ${token}` };

  const loadBackups = async () => {
    try {
      const r = await fetch("/api/admin/backups", { headers });
      setBackups(await r.json());
    } catch {}
    finally { setLoadingList(false); }
  };

  React.useEffect(() => { loadBackups(); }, []);

  const showMsg = (text, isError = false) => {
    setMsg({ text, isError });
    setTimeout(() => setMsg(null), 5000);
  };

  const createBackup = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/backup", { method: "POST", headers });
      const data = await res.json();
      if (!res.ok) { showMsg("Backup failed: " + (data.error || "Unknown error"), true); return; }
      showMsg("Backup created successfully");
      loadBackups();
    } catch (err) { showMsg("Backup failed: " + err.message, true); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", marginTop: 0 }}>Backup &amp; Restore</h2>

      {msg && (
        <div style={{ background: msg.isError ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)", border: `1px solid ${msg.isError ? "var(--crit)" : "var(--green)"}`, padding: "10px 16px", borderRadius: "8px", marginBottom: "16px", color: msg.isError ? "var(--crit)" : "var(--green)", fontSize: "14px" }}>
          {msg.text}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "18px" }}>
          <div style={{ color: "var(--yellow)", fontWeight: "bold", marginBottom: "6px" }}>Manual Backup</div>
          <p style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "14px" }}>
            Creates a full SQL dump of the database right now. Auto-backup runs daily at 2:00 AM.
          </p>
          <button onClick={createBackup} disabled={loading} style={{ background: loading ? "var(--border)" : "var(--yellow)", color: loading ? "white" : "black", border: "none", padding: "10px 20px", borderRadius: "6px", cursor: loading ? "not-allowed" : "pointer", fontWeight: "bold", fontSize: "14px" }}>
            {loading ? "Creating..." : "Backup Now"}
          </button>
        </div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "18px" }}>
          <div style={{ color: "var(--muted)", fontWeight: "bold", marginBottom: "6px" }}>Restore</div>
          <p style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "10px" }}>Run in PostgreSQL terminal to restore:</p>
          <code style={{ display: "block", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "6px", padding: "10px", color: "var(--green)", fontSize: "12px", wordBreak: "break-all" }}>
            psql -U postgres -d dhown_mes -f dhown_mes_YYYY-MM-DD.sql
          </code>
        </div>
      </div>

      {/* Backup list */}
      <div style={{ color: "var(--yellow)", fontWeight: "bold", marginBottom: "10px", fontSize: "14px" }}>
        Saved Backups <span style={{ color: "var(--muted)", fontWeight: "normal", fontSize: "13px" }}>(7-day retention)</span>
      </div>
      {loadingList && <div style={{ color: "var(--muted)", fontSize: "14px" }}>Loading...</div>}
      {!loadingList && backups.length === 0 && (
        <div style={{ color: "var(--muted)", fontStyle: "italic", fontSize: "14px" }}>No backups yet. Click "Backup Now" to create the first one.</div>
      )}
      {backups.map(b => (
        <div key={b.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 14px", marginBottom: "8px" }}>
          <div>
            <div style={{ color: "white", fontSize: "14px", fontWeight: "bold" }}>{b.name}</div>
            <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "2px" }}>{new Date(b.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')} &nbsp;·&nbsp; {b.size_kb} KB</div>
          </div>
          <span style={{ background: "rgba(34,197,94,0.15)", color: "var(--green)", padding: "3px 10px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold" }}>✓ OK</span>
        </div>
      ))}

      <div style={{ marginTop: "16px", background: "rgba(244,174,31,0.08)", border: "1px solid rgba(244,174,31,0.3)", borderRadius: "8px", padding: "12px 14px", color: "var(--yellow)", fontSize: "13px" }}>
        Auto-backup runs every day at 2:00 AM · Backups saved to <code style={{ color: "var(--yellow)" }}>backend/backups/</code> · Older than 7 days are deleted automatically
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
        background: saving ? "#555" : "var(--yellow)",
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
      border: `1px solid ${msg.includes("failed") || msg.includes("Failed") ? "var(--crit)" : "var(--green)"}`,
      padding: "10px 16px",
      borderRadius: "8px",
      marginTop: "12px",
      color: msg.includes("failed") || msg.includes("Failed") ? "var(--crit)" : "var(--green)",
      fontSize: "17px",
    }}>
      {msg}
    </div>
  );
}

// Mint a credential for a wall-mounted screen.
//
// The TV has nobody logged into it and no keyboard to log back in with, so it
// needs a long-lived token — which is exactly why the token is scoped. The
// server restricts scope:'display' to the live dashboard alone, so a token read
// off a screen in a corridor cannot reach invoices, costing or staff records.
function DisplayTokenTab() {
  const [days, setDays] = React.useState(365);
  const [result, setResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  const generate = async () => {
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/auth/display-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: Number(days) }),
      });
      const d = await r.json();
      if (!r.ok) setErr(d.error || "Could not generate a token");
      else setResult(d);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const box = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 18 };

  return (
    <div style={{ ...box, color: "var(--text)", maxWidth: 720 }}>
      <h3 style={{ color: "var(--yellow)", marginTop: 0 }}>Display token</h3>
      <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
        For the shop-floor TV. Generate a token, then open <code>/tv-dashboard</code> on
        that screen and paste it once. It is stored on that screen only and can read
        the live dashboard and nothing else — not invoices, costing or staff records.
      </p>

      <label style={{ color: "var(--muted)", fontSize: 12, display: "block", marginBottom: 4 }}>
        Valid for (days)
      </label>
      <input type="number" value={days} min={1} max={730}
             onChange={e => setDays(e.target.value)}
             style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
                      padding: "9px 11px", color: "var(--text)", width: 140 }} />

      <div style={{ marginTop: 14 }}>
        <button onClick={generate} disabled={busy}
                style={{ background: "var(--yellow)", color: "#000", border: "none", padding: "10px 18px",
                         borderRadius: 8, fontWeight: "bold", cursor: "pointer" }}>
          {busy ? "Generating…" : "Generate token"}
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: "var(--crit-dim)",
                      border: "1px solid var(--crit-dim)", fontSize: 14 }}>{err}</div>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 6 }}>
            Valid {result.expires_days} days. Copy it now — it is not stored here.
          </div>
          <textarea readOnly value={result.token}
                    onFocus={e => e.target.select()}
                    style={{ width: "100%", height: 110, background: "var(--surface)", color: "var(--text)",
                             border: "1px solid var(--border)", borderRadius: 8, padding: 12,
                             fontFamily: "monospace", fontSize: 12, boxSizing: "border-box" }} />
          <button onClick={() => navigator.clipboard?.writeText(result.token)}
                  style={{ marginTop: 8, background: "var(--surface)", color: "var(--text)", border: "none",
                           padding: "8px 14px", borderRadius: 6, cursor: "pointer" }}>
            Copy
          </button>
        </div>
      )}
    </div>
  );
}
