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

const labelStyle = { color: "#7da2d6", fontSize: "13px" };

export default function Settings() {
  const [settings, setSettings] = useState({
    company_name: "",
    factory_address: "",
    gst_number: "",
    report_footer: "",
    day_shift: "",
    night_shift: "",
    roll_id_format: "",
    downtime_reasons: "",
    downtime_alert_minutes: "",
    critical_alert_minutes: "",
    collector_offline_alert: "",
  });

  const [dataCollectors, setDataCollectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    Promise.all([loadSettings(), loadDataCollectors()]).finally(() => setLoading(false));
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

  if (loading) {
    return (
      <div style={{ padding: "40px", color: "#7da2d6" }}>Loading settings...</div>
    );
  }

  return (
    <div style={{ padding: "20px", color: "white", minHeight: "100vh" }}>
      <h1 style={{ color: "#f4ae1f", marginBottom: "25px" }}>SETTINGS CENTER</h1>

      {/* Company Settings */}
      <div style={cardStyle}>
        <h2 style={{ color: "#f4ae1f" }}>Company Settings</h2>
        <label style={labelStyle}>Company Name</label>
        <input style={inputStyle} value={settings.company_name || ""} onChange={e => handleChange("company_name", e.target.value)} />
        <label style={labelStyle}>Factory Address</label>
        <input style={inputStyle} value={settings.factory_address || ""} onChange={e => handleChange("factory_address", e.target.value)} />
        <label style={labelStyle}>GST Number</label>
        <input style={inputStyle} value={settings.gst_number || ""} onChange={e => handleChange("gst_number", e.target.value)} />
        <label style={labelStyle}>Report Footer</label>
        <input style={inputStyle} value={settings.report_footer || ""} onChange={e => handleChange("report_footer", e.target.value)} />
      </div>

      {/* Shift Settings */}
      <div style={cardStyle}>
        <h2 style={{ color: "#f4ae1f" }}>Shift Settings</h2>
        <label style={labelStyle}>Day Shift</label>
        <input style={inputStyle} value={settings.day_shift || ""} onChange={e => handleChange("day_shift", e.target.value)} />
        <label style={labelStyle}>Night Shift</label>
        <input style={inputStyle} value={settings.night_shift || ""} onChange={e => handleChange("night_shift", e.target.value)} />
      </div>

      {/* Roll ID Format */}
      <div style={cardStyle}>
        <h2 style={{ color: "#f4ae1f" }}>Roll ID Format</h2>
        <label style={labelStyle}>Format Template</label>
        <input style={inputStyle} value={settings.roll_id_format || ""} onChange={e => handleChange("roll_id_format", e.target.value)} />
      </div>

      {/* Downtime Reasons */}
      <div style={cardStyle}>
        <h2 style={{ color: "#f4ae1f" }}>Downtime Reasons</h2>
        <label style={labelStyle}>One reason per line</label>
        <textarea
          rows="7"
          style={{ ...inputStyle, resize: "none" }}
          value={settings.downtime_reasons || ""}
          onChange={e => handleChange("downtime_reasons", e.target.value)}
        />
      </div>

      {/* Alert Settings */}
      <div style={cardStyle}>
        <h2 style={{ color: "#f4ae1f" }}>Alert Settings</h2>
        <label style={labelStyle}>Downtime Alert (Minutes)</label>
        <input style={inputStyle} type="number" value={settings.downtime_alert_minutes || ""} onChange={e => handleChange("downtime_alert_minutes", e.target.value)} />
        <label style={labelStyle}>Critical Alert (Minutes)</label>
        <input style={inputStyle} type="number" value={settings.critical_alert_minutes || ""} onChange={e => handleChange("critical_alert_minutes", e.target.value)} />
        <label style={labelStyle}>Collector Offline Alert (Minutes)</label>
        <input style={inputStyle} type="number" value={settings.collector_offline_alert || ""} onChange={e => handleChange("collector_offline_alert", e.target.value)} />
      </div>

      {/* Data Collectors — read-only view, sourced from DB */}
      <div style={cardStyle}>
        <h2 style={{ color: "#f4ae1f" }}>Data Collectors</h2>
        <table width="100%" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#f4ae1f", borderBottom: "1px solid #16345d" }}>
              <th style={{ padding: "8px", textAlign: "left" }}>DC ID</th>
              <th style={{ padding: "8px", textAlign: "left" }}>Machine</th>
              <th style={{ padding: "8px", textAlign: "left" }}>IP Address</th>
              <th style={{ padding: "8px", textAlign: "left" }}>Status</th>
              <th style={{ padding: "8px", textAlign: "left" }}>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {dataCollectors.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ padding: "14px", color: "#7da2d6", fontStyle: "italic" }}>
                  No data collectors registered in database
                </td>
              </tr>
            ) : (
              dataCollectors.map(dc => (
                <tr key={dc.dc_id} style={{ borderBottom: "1px solid #0d1b2f" }}>
                  <td style={{ padding: "8px" }}>{dc.dc_id}</td>
                  <td style={{ padding: "8px" }}>{dc.machine_id || "—"}</td>
                  <td style={{ padding: "8px" }}>{dc.ip_address || "—"}</td>
                  <td style={{ padding: "8px" }}>
                    <span style={{ color: (dc.status || "").toUpperCase() === "ONLINE" ? "#22c55e" : "#ef4444", fontWeight: "bold" }}>
                      {dc.status || "OFFLINE"}
                    </span>
                  </td>
                  <td style={{ padding: "8px", color: "#7da2d6", fontSize: "12px" }}>
                    {dc.last_seen ? new Date(dc.last_seen).toLocaleString() : "Never"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* User Roles — static reference */}
      <div style={cardStyle}>
        <h2 style={{ color: "#f4ae1f" }}>User Roles</h2>
        <ul style={{ color: "#7da2d6", lineHeight: "2" }}>
          <li>Admin</li>
          <li>Supervisor</li>
          <li>Operator</li>
          <li>Maintenance</li>
        </ul>
      </div>

      {saveMsg && (
        <div style={{
          background: saveMsg.includes("failed") ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
          border: `1px solid ${saveMsg.includes("failed") ? "#ef4444" : "#22c55e"}`,
          padding: "12px 16px",
          borderRadius: "8px",
          marginBottom: "15px",
          color: saveMsg.includes("failed") ? "#ef4444" : "#22c55e",
        }}>
          {saveMsg}
        </div>
      )}

      <button
        onClick={saveSettings}
        disabled={saving}
        style={{
          background: saving ? "#555" : "#f4ae1f",
          color: "black",
          border: "none",
          padding: "12px 28px",
          borderRadius: "8px",
          cursor: saving ? "not-allowed" : "pointer",
          fontWeight: "bold",
          fontSize: "15px",
        }}
      >
        {saving ? "Saving..." : "Save Settings"}
      </button>
    </div>
  );
}
