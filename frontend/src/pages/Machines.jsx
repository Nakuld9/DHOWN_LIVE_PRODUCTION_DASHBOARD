import React, { useState, useEffect } from "react";

const API = "http://localhost:4000";

const STATUS_COLORS = {
  RUNNING: "#16a34a",
  OFFLINE: "#dc2626",
  STOPPED: "#f59e0b",
  NO_DATA: "#6b7280",
};

const sendWhatsAppAlert = (machine, supervisorMobile) => {
  const status = machine.live_status || machine.machine_status || "OFFLINE";
  const now = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  const text = `ALERT: Machine ${machine.machine_id} (${machine.machine_name}) is ${status} as of ${now}. Please check immediately.`;
  const mobile = supervisorMobile ? `91${supervisorMobile}` : "918727048169";
  window.open(`whatsapp://send?phone=${mobile}&text=${encodeURIComponent(text)}`);
};

const Machines = () => {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [supervisorMobile, setSupervisorMobile] = useState("8727048169");

  useEffect(() => {
    fetch(`${API}/api/machines`)
      .then(res => res.json())
      .then(data => {
        setMachines(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Fetch supervisor mobile dynamically
    const token = localStorage.getItem("dhown_token");
    fetch(`${API}/api/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(users => {
        if (Array.isArray(users)) {
          const sup = users.find(u => u.role === "SUPERVISOR" && u.mobile);
          if (sup) setSupervisorMobile(sup.mobile);
        }
      })
      .catch(() => {});
  }, []);

  if (loading) {
    return <div style={{ padding: "40px", color: "#7da2d6" }}>Loading machines...</div>;
  }

  return (
    <div style={{ padding: "20px", color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ color: "#f4ae1f", margin: 0 }}>MACHINE MASTER</h2>
        <div style={{ background: "rgba(244,174,31,0.1)", border: "1px solid rgba(244,174,31,0.3)", padding: "8px 14px", borderRadius: "6px", color: "#f4ae1f", fontSize: "16px" }}>
          Reference only — edit values in Settings → Machine
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table width="100%" style={{ borderCollapse: "collapse", background: "#04142d", borderRadius: "12px", overflow: "hidden" }}>
          <thead>
            <tr style={{ background: "#061b3a", color: "#f4ae1f" }}>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Machine</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Type</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Dia</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Gauge</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Feeders</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Fabric</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>DC ID</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>RPM Target</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>KG/Counter</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Status</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Alert</th>
            </tr>
          </thead>
          <tbody>
            {machines.map(m => (
              <tr key={m.machine_id} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <td style={{ padding: "10px 8px", fontWeight: "bold", color: "#f4ae1f" }}>{m.machine_name}</td>
                <td style={{ padding: "10px 8px", color: "#7da2d6" }}>{m.machine_type}</td>
                <td style={{ padding: "10px 8px" }}>{m.diameter}"</td>
                <td style={{ padding: "10px 8px" }}>{m.gauge}</td>
                <td style={{ padding: "10px 8px" }}>{m.feeders}</td>
                <td style={{ padding: "10px 8px" }}>{m.fabric_name || m.fabric_code || m.fabric || "—"}</td>
                <td style={{ padding: "10px 8px" }}>
                  <span style={{ background: "#0d1b2f", color: "#7da2d6", padding: "3px 8px", borderRadius: "4px", fontSize: "14px" }}>
                    {m.dc_id || "—"}
                  </span>
                </td>
                <td style={{ padding: "10px 8px" }}>{m.rpm_target || "—"}</td>
                <td style={{ padding: "10px 8px", fontSize: "14px" }}>
                  {m.kg_per_counter ? Number(m.kg_per_counter).toFixed(5) : "—"}
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <span style={{
                    padding: "4px 12px",
                    borderRadius: "20px",
                    color: "#fff",
                    fontWeight: "bold",
                    fontSize: "14px",
                    background: STATUS_COLORS[m.live_status || m.machine_status] || "#6b7280",
                  }}>
                    {m.live_status || m.machine_status || "OFFLINE"}
                  </span>
                </td>
                <td style={{ padding: "10px 8px" }}>
                  {["STOPPED", "OFFLINE"].includes(m.live_status || m.machine_status) && (
                    <button
                      onClick={() => sendWhatsAppAlert(m, supervisorMobile)}
                      title={`Alert supervisor via WhatsApp (${supervisorMobile})`}
                      style={{
                        background: "#25D366", color: "white", border: "none",
                        padding: "4px 10px", borderRadius: "4px", cursor: "pointer",
                        fontSize: "13px", fontWeight: "bold", display: "flex",
                        alignItems: "center", gap: "4px", whiteSpace: "nowrap",
                      }}
                    >
                      📲 Alert
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: "14px", color: "#7da2d6", fontSize: "14px" }}>
        {machines.length} machines — sorted SJ → RB → IL → TV &nbsp;|&nbsp;
        To modify Fabric, Gauge, RPM Target or KG/Counter: go to <strong>Settings → Machine</strong>
      </div>
    </div>
  );
};

export default Machines;
