import React, { useEffect, useState } from "react";

const API = `http://localhost:4000`;

const SHIFTS = [
  { value: "D", label: "Day Shift" },
  { value: "N", label: "Night Shift" },
];

function detectShiftFromSettings(settings) {
  const hour = new Date().getHours();
  const dayStart = parseInt((settings?.shift_day_start || "08:00").split(":")[0]);
  const dayEnd   = parseInt((settings?.shift_day_end   || "20:00").split(":")[0]);
  return (hour >= dayStart && hour < dayEnd) ? "D" : "N";
}

export default function Rolls() {
  const [rolls, setRolls]       = useState([]);
  const [machines, setMachines] = useState([]);
  const [weights, setWeights]   = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ machine_id: "", shift: "D" });
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadRolls();
    loadMachines();
    fetch(`${API}/api/settings`)
      .then(r => r.json())
      .then(s => setForm(f => ({ ...f, shift: detectShiftFromSettings(s) })))
      .catch(() => {});
    const t = setInterval(loadRolls, 5000);
    return () => clearInterval(t);
  }, []);

  const loadRolls = async () => {
    try {
      const res = await fetch(`${API}/api/rolls`);
      setRolls(await res.json());
    } catch (err) { console.error(err); }
  };

  const loadMachines = async () => {
    try {
      const res = await fetch(`${API}/api/machines`);
      setMachines(await res.json());
    } catch (err) { console.error(err); }
  };

  const handleMachineChange = (machine_id) => {
    setForm(f => ({ ...f, machine_id }));
  };

  const openRoll = async () => {
    if (!form.machine_id) { setFormError("Select a machine"); return; }
    if (!form.shift)      { setFormError("Select a shift"); return; }
    setFormError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/rolls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || "Failed to open roll"); return; }
      setShowForm(false);
      setForm({ machine_id: "", shift: detectShift() });
      loadRolls();
    } catch { setFormError("Cannot connect to server"); }
    finally { setSubmitting(false); }
  };

  const approveRoll = async (rollId, weight) => {
    if (!weight) { alert("Enter roll weight"); return; }
    try {
      const supervisorName = (() => {
        try { return JSON.parse(localStorage.getItem("dhown_current_user") || "{}").full_name || "Admin"; }
        catch { return "Admin"; }
      })();
      await fetch(`${API}/api/rolls/approve/${rollId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual_weight_kg: parseFloat(weight), supervisor_name: supervisorName }),
      });
      loadRolls();
    } catch (err) { console.error(err); }
  };

  const openRolls    = rolls.filter(r => r.status === "OPEN").length;
  const pendingRolls = rolls.filter(r => r.status === "WAITING_WEIGHT").length;
  const approvedRolls= rolls.filter(r => r.status === "APPROVED").length;

  return (
    <div style={{ padding: "24px", color: "white", background: "#050d1a", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h2 style={{ color: "#FFD700", margin: 0, letterSpacing: 1 }}>ROLL MANAGEMENT</h2>
        <button onClick={() => { setShowForm(true); setFormError(""); }} style={btnStyle}>
          + Open New Roll
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "14px", marginBottom: "24px" }}>
        <KPICard title="OPEN ROLLS"  value={openRolls}     color="#22c55e" />
        <KPICard title="PENDING"     value={pendingRolls}  color="#f59e0b" />
        <KPICard title="APPROVED"    value={approvedRolls} color="#60a5fa" />
      </div>

      {/* New Roll Form */}
      {showForm && (
        <div style={{ background: "#0d1b2f", border: "1px solid #FFD700", borderRadius: "10px", padding: "20px", marginBottom: "24px", maxWidth: 480 }}>
          <h3 style={{ color: "#FFD700", margin: "0 0 16px" }}>Open New Roll</h3>

          <label style={labelStyle}>Machine</label>
          <select style={inputStyle} value={form.machine_id} onChange={e => handleMachineChange(e.target.value)}>
            <option value="">— Select Machine —</option>
            {machines.map(m => (
              <option key={m.machine_id} value={m.machine_id}>{m.machine_id} — {m.machine_name || m.machine_type}</option>
            ))}
          </select>

          <label style={labelStyle}>
            Shift
            <span style={{ color: "#22c55e", fontWeight: "normal", marginLeft: 8, fontSize: 11 }}>
              ● Auto-detected: {detectShift() === "D" ? "Day (08:00–20:00)" : "Night (20:00–08:00)"} — change if needed
            </span>
          </label>
          <select style={inputStyle} value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}>
            {SHIFTS.map(s => (
              <option key={s.value} value={s.value}>
                {s.label}{s.value === detectShift() ? " ← current" : ""}
              </option>
            ))}
          </select>

          {form.machine_id && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "#050d1a", border: "1px solid #16345d", borderRadius: 6, fontSize: 13, color: "#7da2d6" }}>
              Fabric code will be auto-read from machine master.
              <span style={{ color: "#FFD700", marginLeft: 6 }}>
                {machines.find(m => m.machine_id === form.machine_id)?.fabric_code
                  ? `Code: ${machines.find(m => m.machine_id === form.machine_id).fabric_code}`
                  : "⚠ No fabric code set — assign one in Settings → Machine Configuration"}
              </span>
            </div>
          )}

          {formError && <p style={{ color: "#ef4444", fontSize: 13, margin: "8px 0" }}>{formError}</p>}

          <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
            <button onClick={openRoll} disabled={submitting} style={btnStyle}>
              {submitting ? "Opening..." : "Open Roll"}
            </button>
            <button onClick={() => { setShowForm(false); setForm({ machine_id: "", shift: detectShift() }); }} style={cancelBtnStyle}>Cancel</button>
          </div>
        </div>
      )}

      {/* Rolls Table */}
      {rolls.length === 0 ? (
        <div style={{ color: "#7da2d6", textAlign: "center", padding: "60px 0", fontSize: 16 }}>
          No rolls yet. Click <strong style={{ color: "#FFD700" }}>+ Open New Roll</strong> to start.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#081426" }}>
            <thead>
              <tr>
                {["Roll ID", "Machine", "Fabric", "Shift", "Opened At", "Weight (kg)", "Status", "Action"].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rolls.map(roll => (
                <tr key={roll.roll_id} style={{ background: roll.status === "OPEN" ? "rgba(34,197,94,0.05)" : "transparent" }}>
                  <td style={td}><span style={{ color: "#FFD700", fontWeight: "bold" }}>{roll.roll_id}</span></td>
                  <td style={td}>{roll.machine_id}</td>
                  <td style={td}>{roll.fabric_type || "—"}</td>
                  <td style={td}>{roll.shift}</td>
                  <td style={td}>{roll.created_at ? new Date(roll.created_at).toLocaleString() : "—"}</td>
                  <td style={td}>
                    {roll.status === "OPEN" ? (
                      <input
                        type="number"
                        placeholder="Enter kg"
                        value={weights[roll.roll_id] || ""}
                        onChange={e => setWeights({ ...weights, [roll.roll_id]: e.target.value })}
                        style={{ padding: "6px 8px", width: "90px", background: "#0d1b2f", color: "#fff", border: "1px solid #344a6c", borderRadius: 4 }}
                      />
                    ) : (
                      <strong>{roll.actual_weight_kg} kg</strong>
                    )}
                  </td>
                  <td style={td}>
                    <span style={{
                      padding: "3px 10px", borderRadius: 10, fontSize: 12, fontWeight: "bold",
                      background: roll.status === "OPEN" ? "rgba(34,197,94,0.15)" : roll.status === "APPROVED" ? "rgba(96,165,250,0.15)" : "rgba(245,158,11,0.15)",
                      color: roll.status === "OPEN" ? "#22c55e" : roll.status === "APPROVED" ? "#60a5fa" : "#f59e0b",
                    }}>{roll.status}</span>
                  </td>
                  <td style={td}>
                    {roll.status === "OPEN" ? (
                      <button onClick={() => approveRoll(roll.roll_id, weights[roll.roll_id])} style={{ background: "#22c55e", border: "none", padding: "6px 14px", color: "white", borderRadius: 5, cursor: "pointer", fontWeight: "bold" }}>
                        Approve
                      </button>
                    ) : (
                      <span style={{ color: "#60a5fa" }}>✓ Done</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const KPICard = ({ title, value, color }) => (
  <div style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: 10, padding: "18px 20px" }}>
    <div style={{ fontSize: 12, color: "#7da2d6", letterSpacing: 1, marginBottom: 6 }}>{title}</div>
    <div style={{ fontSize: 32, fontWeight: "bold", color }}>{value}</div>
  </div>
);

const btnStyle = {
  background: "#FFD700", color: "#111", border: "none", padding: "10px 20px",
  borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 14,
};
const cancelBtnStyle = {
  background: "transparent", color: "#aaa", border: "1px solid #344a6c",
  padding: "10px 20px", borderRadius: 6, cursor: "pointer", fontSize: 14,
};
const labelStyle = { display: "block", color: "#7da2d6", fontSize: 12, fontWeight: "bold", letterSpacing: 1, marginBottom: 5, marginTop: 12 };
const inputStyle = { width: "100%", background: "#050d1a", border: "1px solid #16345d", color: "#fff", padding: "9px 12px", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const th = { padding: "12px 14px", borderBottom: "1px solid #16345d", textAlign: "left", color: "#7da2d6", fontSize: 12, letterSpacing: 1 };
const td = { padding: "12px 14px", borderBottom: "1px solid #0d1b2f" };
