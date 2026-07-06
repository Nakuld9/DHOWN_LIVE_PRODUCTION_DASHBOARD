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

const PAGE_SIZE = 50;

export default function Rolls() {
  const [rolls, setRolls]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [pages, setPages]       = useState(1);
  const [machines, setMachines] = useState([]);
  const [weights, setWeights]   = useState({});
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ machine_id: "", shift: "D" });
  const [detectedShift, setDetectedShift] = useState("D");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editRoll, setEditRoll] = useState(null);
  const [editWeight, setEditWeight] = useState("");

  useEffect(() => {
    loadRolls(1);
    loadMachines();
    fetch(`${API}/api/settings`)
      .then(r => r.json())
      .then(s => {
        const shift = detectShiftFromSettings(s);
        setDetectedShift(shift);
        setForm(f => ({ ...f, shift }));
      })
      .catch(() => {});
    const t = setInterval(() => loadRolls(1), 10000);
    return () => clearInterval(t);
  }, []);

  const loadRolls = async (p = page) => {
    try {
      const res = await fetch(`${API}/api/rolls?page=${p}&limit=${PAGE_SIZE}`);
      const json = await res.json();
      if (Array.isArray(json)) {
        setRolls(json);
        setTotal(json.length); setPages(1);
      } else {
        setRolls(json.data || []);
        setTotal(json.total ?? 0);
        setPages(json.pages ?? 1);
      }
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
      setForm({ machine_id: "", shift: detectedShift });
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

  const goTo = (p) => { setPage(p); loadRolls(p); };

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
              ● Auto-detected: {detectedShift === "D" ? "Day (08:00–20:00)" : "Night (20:00–08:00)"} — change if needed
            </span>
          </label>
          <select style={inputStyle} value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}>
            {SHIFTS.map(s => (
              <option key={s.value} value={s.value}>
                {s.label}{s.value === detectedShift ? " ← current" : ""}
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
            <button onClick={() => { setShowForm(false); setForm({ machine_id: "", shift: detectedShift }); }} style={cancelBtnStyle}>Cancel</button>
          </div>
        </div>
      )}

      {/* Rolls Table */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <span style={{ color: "#7da2d6", fontSize: "13px" }}>{total.toLocaleString()} total rolls</span>
        {pages > 1 && (
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <PgBtn label="‹" onClick={() => goTo(page - 1)} disabled={page === 1} />
            <span style={{ color: "#FFD700", fontSize: "13px", fontWeight: "bold" }}>Page {page}/{pages}</span>
            <PgBtn label="›" onClick={() => goTo(page + 1)} disabled={page === pages} />
          </div>
        )}
      </div>
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
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {roll.status === "OPEN" && (
                      <>
                        <button onClick={() => approveRoll(roll.roll_id, weights[roll.roll_id])} style={{ background: "#22c55e", border: "none", padding: "6px 14px", color: "white", borderRadius: 5, cursor: "pointer", fontWeight: "bold" }}>
                          Approve
                        </button>
                        <button onClick={async () => { if (!window.confirm("Delete this OPEN roll?")) return; const token = localStorage.getItem("dhown_token"); await fetch(`${API}/api/rolls/${roll.roll_id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); window.location.reload(); }}
                          style={{ background: "#dc2626", border: "none", padding: "6px 10px", color: "white", borderRadius: 5, cursor: "pointer", fontWeight: "bold", fontSize: 12 }}>🗑</button>
                      </>
                    )}
                    {(roll.status === "APPROVED" || roll.status === "CLOSED") && (
                      <>
                        <span style={{ color: "#60a5fa" }}>✓ Done</span>
                        {roll.qr_image && (
                          <img src={roll.qr_image} alt="QR" title={`Roll QR: ${roll.roll_id}`} style={{ width: 32, height: 32, cursor: "pointer" }}
                            onClick={() => { const w = window.open(); w.document.write(`<img src="${roll.qr_image}" style="width:300px"/><p style="font-family:monospace;font-size:18px">${roll.roll_id}</p>`); }} />
                        )}
                        {roll.warehouse_status !== 'SENT_OUT' && roll.warehouse_status !== 'DISPATCHED' && (<>
                          <button onClick={() => { setEditRoll(roll); setEditWeight(roll.actual_weight_kg || ""); }}
                            style={{ background: "#3b82f6", border: "none", padding: "4px 8px", color: "white", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: "bold" }}>✎ Edit</button>
                          <button onClick={async () => { if (!window.confirm("Cancel this roll?")) return; const token = localStorage.getItem("dhown_token"); const r = await fetch(`${API}/api/rolls/${roll.roll_id}/cancel`, { method: "PUT", headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) { const e = await r.json(); alert(e.error); return; } window.location.reload(); }}
                            style={{ background: "#ef4444", border: "none", padding: "4px 8px", color: "white", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>Cancel</button>
                        </>)}
                      </>
                    )}
                    {roll.status === "CANCELLED" && (<>
                      <span style={{ color: "#ef4444" }}>Cancelled</span>
                      <button onClick={async () => { if (!window.confirm("Permanently delete this cancelled roll?")) return; const token = localStorage.getItem("dhown_token"); const r = await fetch(`${API}/api/rolls/${roll.roll_id}/permanent`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) { const e = await r.json(); alert(e.error); return; } window.location.reload(); }}
                        style={{ background: "#dc2626", border: "none", padding: "4px 8px", color: "white", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: "bold" }}>🗑 Delete</button>
                    </>)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Roll Modal */}
      {editRoll && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setEditRoll(null)}>
          <div style={{ background: "#0d1b2f", border: "1px solid #1e3a5f", borderRadius: 12, padding: 24, minWidth: 400 }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ color: "#FFD700", marginTop: 0 }}>Edit Roll Weight</h3>
            <p style={{ color: "#9ca3af", fontSize: 13 }}>Roll: <strong style={{ color: "#e2e8f0" }}>{editRoll.roll_id}</strong></p>
            <p style={{ color: "#9ca3af", fontSize: 13 }}>Machine: {editRoll.machine_id} | Fabric: {editRoll.fabric_type}</p>
            <label style={{ color: "#7da2d6", fontSize: 12 }}>Weight (kg)</label>
            <input type="number" step="0.001" value={editWeight} onChange={e => setEditWeight(e.target.value)}
              style={{ display: "block", width: "100%", background: "#050d1a", border: "1px solid #16345d", color: "#fff", padding: "10px 12px", borderRadius: 6, fontSize: 14, marginTop: 4, marginBottom: 16, boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setEditRoll(null)}
                style={{ background: "#1e3a5f", color: "#9ca3af", border: "none", padding: "8px 16px", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
              <button onClick={async () => {
                if (!editWeight) { alert("Enter weight"); return; }
                const token = localStorage.getItem("dhown_token");
                const r = await fetch(`${API}/api/rolls/${editRoll.roll_id}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ actual_weight_kg: parseFloat(editWeight) }),
                });
                if (!r.ok) { const e = await r.json(); alert(e.error); return; }
                setEditRoll(null);
                window.location.reload();
              }}
                style={{ background: "#22c55e", color: "#fff", border: "none", padding: "8px 20px", borderRadius: 6, cursor: "pointer", fontWeight: "bold" }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PgBtn({ label, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: disabled ? "#0d1b2f" : "#FFD700", color: disabled ? "#455a7c" : "#000",
      border: "1px solid #23395d", padding: "5px 12px", borderRadius: "5px",
      cursor: disabled ? "not-allowed" : "pointer", fontWeight: "bold", fontSize: "13px",
    }}>{label}</button>
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
