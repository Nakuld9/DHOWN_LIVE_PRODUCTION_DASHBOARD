import React, { useState, useEffect } from "react";

const API = "";

const STATUS_COLORS = {
  RUNNING: "var(--green)",
  OFFLINE: "var(--crit)",
  STOPPED: "var(--gold)",
  NO_DATA: "var(--muted)",
};

const sendWhatsAppAlert = async (machine, supervisorMobile) => {
  const status = machine.live_status || machine.machine_status || "OFFLINE";
  try {
    const res = await fetch(`${API}/api/alerts/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machine_id: machine.machine_id,
        machine_name: machine.machine_name || machine.work_center,
        status,
        mobile: supervisorMobile || undefined,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok && j.sent > 0) {
      window.alert(`WhatsApp alert sent to ${j.sent} recipient(s).`);
    } else {
      window.alert(`Alert not delivered: ${j.error || "the recipient may not be a WhatsApp test number, or the app isn't published yet"}.`);
    }
  } catch (err) {
    window.alert(`Failed to send alert: ${err.message}`);
  }
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
    return <div style={{ padding: "40px", color: "var(--muted)" }}>Loading machines...</div>;
  }

  return (
    <div style={{ padding: "20px", color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: 0 }}>MACHINE MASTER</h2>
        <div style={{ background: "rgba(244,174,31,0.1)", border: "1px solid rgba(244,174,31,0.3)", padding: "8px 14px", borderRadius: "6px", color: "var(--yellow)", fontSize: "16px" }}>
          Reference only — edit values in Settings → Machine
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table width="100%" style={{ borderCollapse: "collapse", background: "var(--surface)", borderRadius: "12px", overflow: "hidden" }}>
          <thead>
            <tr style={{ background: "var(--surface)", color: "var(--yellow)" }}>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Machine</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Type</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Dia</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Gauge</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Feeders</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Fabric</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>DC ID</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>RPM Target</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>KG/Counter</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Operator</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Status</th>
              <th style={{ padding: "10px 8px", textAlign: "left" }}>Alert</th>
            </tr>
          </thead>
          <tbody>
            {machines.map(m => (
              <tr key={m.machine_id} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <td style={{ padding: "10px 8px", fontWeight: "bold", color: "var(--yellow)" }}>{m.machine_name}</td>
                <td style={{ padding: "10px 8px", color: "var(--muted)" }}>{m.machine_type}</td>
                <td style={{ padding: "10px 8px" }}>{m.diameter}"</td>
                <td style={{ padding: "10px 8px" }}>{m.gauge}</td>
                <td style={{ padding: "10px 8px" }}>{m.feeders}</td>
                <td style={{ padding: "10px 8px" }}>{m.fabric_name || m.fabric_code || m.fabric || "—"}</td>
                <td style={{ padding: "10px 8px" }}>
                  <span style={{ background: "var(--surface)", color: "var(--muted)", padding: "3px 8px", borderRadius: "4px", fontSize: "14px" }}>
                    {m.dc_id || "—"}
                  </span>
                </td>
                <td style={{ padding: "10px 8px" }}>{m.rpm_target || "—"}</td>
                <td style={{ padding: "10px 8px", fontSize: "14px" }}>
                  {m.kg_per_counter ? Number(m.kg_per_counter).toFixed(5) : "—"}
                </td>
                <td style={{ padding: "10px 8px" }}>
                  {m.assigned_operator
                    ? <span style={{ color: "var(--green)", fontWeight: "bold", fontSize: 13 }}>{m.assigned_operator}</span>
                    : <span style={{ color: "var(--muted)", fontSize: 13 }}>—</span>}
                </td>
                <td style={{ padding: "10px 8px" }}>
                  <span style={{
                    padding: "4px 12px",
                    borderRadius: "20px",
                    color: "var(--text)",
                    fontWeight: "bold",
                    fontSize: "14px",
                    background: STATUS_COLORS[m.live_status || m.machine_status] || "var(--muted)",
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
                        background: "var(--green)", color: "white", border: "none",
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

      <div style={{ marginTop: "14px", color: "var(--muted)", fontSize: "14px" }}>
        {machines.length} machines — sorted SJ → RB → IL → TV &nbsp;|&nbsp;
        To modify Fabric, Gauge, RPM Target or KG/Counter: go to <strong>Settings → Machine</strong>
      </div>
    </div>
  );
};

export default Machines;
