import React, { useState, useEffect } from "react";

const ROLES = ["SUPER_ADMIN", "ADMIN", "SUPERVISOR", "OPERATOR", "VIEWER"];

const ROLE_COLORS = {
  SUPER_ADMIN: "#f4ae1f",
  ADMIN: "#60a5fa",
  SUPERVISOR: "#34d399",
  OPERATOR: "#a78bfa",
  VIEWER: "#6b7280",
};

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: "Full access — create, edit, delete users, change all settings",
  ADMIN: "Create & edit users, production, downtime, maintenance, reports",
  SUPERVISOR: "Production, downtime, rolls, reports",
  OPERATOR: "Roll operations only",
  VIEWER: "Read-only access to all modules",
};

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
  marginBottom: "12px",
  background: "#0d1b2f",
  color: "white",
  border: "1px solid #16345d",
  borderRadius: "6px",
  boxSizing: "border-box",
};

const labelStyle = { color: "#7da2d6", fontSize: "16px" };

const emptyForm = { username: "", full_name: "", password: "", role: "VIEWER", mobile: "" };

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("success");
  const [deletingId, setDeletingId] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [showAudit, setShowAudit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pinUserId, setPinUserId] = useState(null);
  const [pinInput, setPinInput] = useState("");

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:4000/api/users");
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const loadAuditLogs = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/audit-logs?module=USER_MANAGEMENT&limit=50", {
        headers: { Authorization: `Bearer ${localStorage.getItem("dhown_token")}` },
      });
      const json = await res.json();
      setAuditLogs(Array.isArray(json) ? json : (json.data || []));
    } catch (err) {
      console.error(err);
    }
  };

  const showMessage = (text, type = "success") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 4000);
  };

  const handleSubmit = async () => {
    if (!form.username || !form.full_name || (!editingId && !form.password) || !form.role) {
      showMessage("All fields are required. Password required for new users.", "error");
      return;
    }
    setSaving(true);
    try {
      const url = editingId ? `http://localhost:4000/api/users/${editingId}` : "http://localhost:4000/api/users";
      const method = editingId ? "PUT" : "POST";
      const body = { ...form };
      if (editingId && !body.password) delete body.password;
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        showMessage("Error: " + data.error, "error");
      } else {
        showMessage(editingId ? "User updated successfully." : "User created successfully.");
        setForm(emptyForm);
        setEditingId(null);
        setShowForm(false);
        loadUsers();
      }
    } catch (err) {
      showMessage("Failed: " + err.message, "error");
    }
    setSaving(false);
  };

  const startEdit = (user) => {
    setEditingId(user.id);
    setForm({ username: user.username, full_name: user.full_name, password: "", role: user.role, mobile: user.mobile || "" });
    setShowForm(true);
  };

  const toggleActive = async (user) => {
    try {
      const res = await fetch(`http://localhost:4000/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !user.active }),
      });
      const data = await res.json();
      if (data.error) showMessage("Error: " + data.error, "error");
      else { showMessage(`User ${user.active ? "deactivated" : "activated"}.`); loadUsers(); }
    } catch (err) {
      showMessage("Failed: " + err.message, "error");
    }
  };

  const setPin = async () => {
    if (!/^\d{4}$/.test(pinInput)) { showMessage("PIN must be exactly 4 digits", "error"); return; }
    try {
      const res = await fetch(`http://localhost:4000/api/users/${pinUserId}/pin`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pinInput }),
      });
      const data = await res.json();
      if (data.error) showMessage("Error: " + data.error, "error");
      else { showMessage("PIN set successfully. Supervisor can now log into the Android app."); setPinUserId(null); setPinInput(""); }
    } catch (err) { showMessage("Failed: " + err.message, "error"); }
  };

  const clearPin = async (id) => {
    try {
      await fetch(`http://localhost:4000/api/users/${id}/pin`, { method: "DELETE" });
      showMessage("PIN cleared.");
    } catch (err) { showMessage("Failed: " + err.message, "error"); }
  };

  const deleteUser = async (id) => {
    setDeletingId(null);
    try {
      const res = await fetch(`http://localhost:4000/api/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) showMessage("Error: " + data.error, "error");
      else { showMessage("User deleted."); loadUsers(); }
    } catch (err) {
      showMessage("Failed: " + err.message, "error");
    }
  };

  if (loading) {
    return <div style={{ padding: "40px", color: "#7da2d6" }}>Loading users...</div>;
  }

  const pinUser = users.find(u => u.id === pinUserId);

  return (
    <div style={{ padding: "20px", color: "white", minHeight: "100vh" }}>
      {/* PIN Modal */}
      {pinUserId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(2,13,26,0.92)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#061730", border: "1px solid #f4ae1f", borderRadius: "12px", padding: "32px", width: "340px" }}>
            <h3 style={{ color: "#f4ae1f", marginTop: 0 }}>Set PIN — {pinUser?.full_name}</h3>
            <p style={{ color: "#7da2d6", fontSize: "15px" }}>Enter a 4-digit PIN for the supervisor Android app login.</p>
            <input
              type="password"
              maxLength={4}
              inputMode="numeric"
              pattern="[0-9]*"
              value={pinInput}
              onChange={e => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4-digit PIN"
              style={{ ...inputStyle, fontSize: "24px", letterSpacing: "8px", textAlign: "center" }}
            />
            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button onClick={setPin} style={{ background: "#f4ae1f", color: "black", border: "none", padding: "10px 20px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", flex: 1 }}>Set PIN</button>
              <button onClick={() => clearPin(pinUserId)} style={{ background: "#1f0808", color: "#ef4444", border: "1px solid #ef444433", padding: "10px 14px", borderRadius: "6px", cursor: "pointer" }}>Clear PIN</button>
              <button onClick={() => { setPinUserId(null); setPinInput(""); }} style={{ background: "#374151", color: "white", border: "none", padding: "10px 14px", borderRadius: "6px", cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
        <h1 style={{ color: "#f4ae1f", margin: 0 }}>USER MANAGEMENT</h1>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => { setShowAudit(!showAudit); if (!showAudit) loadAuditLogs(); }}
            style={{ background: "#0d1b2f", color: "#7da2d6", border: "1px solid #16345d", padding: "8px 16px", borderRadius: "6px", cursor: "pointer", fontSize: "16px" }}
          >
            {showAudit ? "Hide Audit Log" : "Audit Log"}
          </button>
          <button
            onClick={() => { setShowForm(f => !f); setEditingId(null); setForm(emptyForm); }}
            style={{ background: "#f4ae1f", color: "black", border: "none", padding: "8px 18px", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", fontSize: "17px" }}
          >
            {showForm && !editingId ? "✕ Cancel" : "+ Add User"}
          </button>
        </div>
      </div>

      {/* Inline message */}
      {msg && (
        <div style={{
          background: msgType === "error" ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
          border: `1px solid ${msgType === "error" ? "#ef4444" : "#22c55e"}`,
          padding: "10px 16px", borderRadius: "8px", marginBottom: "16px",
          color: msgType === "error" ? "#ef4444" : "#22c55e", fontSize: "17px",
        }}>
          {msg}
        </div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <div style={{ ...cardStyle, border: "1px solid #f4ae1f" }}>
          <h3 style={{ color: "#f4ae1f", marginTop: 0 }}>{editingId ? "Edit User" : "Create New User"}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <label style={labelStyle}>Username *</label>
              <input
                style={{ ...inputStyle, ...(editingId ? { color: "#7da2d6", cursor: "not-allowed" } : {}) }}
                value={form.username}
                readOnly={!!editingId}
                onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))}
                placeholder="e.g. john.doe"
              />
            </div>
            <div>
              <label style={labelStyle}>Full Name *</label>
              <input
                style={inputStyle}
                value={form.full_name}
                onChange={e => setForm(prev => ({ ...prev, full_name: e.target.value }))}
                placeholder="e.g. John Doe"
              />
            </div>
            <div>
              <label style={labelStyle}>Password {editingId ? "(leave blank to keep current)" : "*"}</label>
              <input
                type="password"
                style={inputStyle}
                value={form.password}
                onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
                placeholder={editingId ? "Leave blank to keep password" : "Enter password"}
              />
            </div>
            <div>
              <label style={labelStyle}>Mobile</label>
              <input
                style={inputStyle}
                value={form.mobile}
                onChange={e => setForm(prev => ({ ...prev, mobile: e.target.value }))}
                placeholder="e.g. 9876543210"
              />
            </div>
            <div>
              <label style={labelStyle}>Role *</label>
              <select
                style={{ ...inputStyle, cursor: "pointer" }}
                value={form.role}
                onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))}
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          {form.role && (
            <div style={{ padding: "10px 14px", background: "#0d1b2f", borderRadius: "6px", marginBottom: "14px", color: "#7da2d6", fontSize: "16px" }}>
              <strong style={{ color: ROLE_COLORS[form.role] }}>{form.role}:</strong> {ROLE_PERMISSIONS[form.role]}
            </div>
          )}
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{ background: saving ? "#555" : "#f4ae1f", color: "black", border: "none", padding: "10px 24px", borderRadius: "6px", cursor: saving ? "not-allowed" : "pointer", fontWeight: "bold" }}
            >
              {saving ? "Saving..." : editingId ? "Update User" : "Create User"}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }}
              style={{ background: "#374151", color: "white", border: "none", padding: "10px 18px", borderRadius: "6px", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Users Table */}
      <div style={cardStyle}>
        <h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Users ({users.length})</h2>
        {users.length === 0 ? (
          <div style={{ color: "#7da2d6", fontStyle: "italic", padding: "20px 0" }}>No users found. Create the first user above.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "14%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "22%" }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#061730", borderBottom: "2px solid #16345d" }}>
                  {["Username", "Full Name", "Mobile", "Role", "Status", "Created", "Actions"].map(h => (
                    <th key={h} style={{ padding: "12px 10px", textAlign: "left", color: "#f4ae1f", fontSize: "15px", fontWeight: "bold", letterSpacing: "0.5px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((user, idx) => (
                  <tr key={user.id} style={{
                    borderBottom: "1px solid #0d2040",
                    background: idx % 2 === 0 ? "#04111f" : "#050e1c",
                    opacity: user.active ? 1 : 0.55,
                  }}>
                    <td style={{ padding: "11px 10px", fontWeight: "600", color: "#e2e8f0", fontSize: "15px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.username}</td>
                    <td style={{ padding: "11px 10px", color: "#cbd5e1", fontSize: "15px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.full_name}</td>
                    <td style={{ padding: "11px 10px", color: "#94a3b8", fontSize: "15px", fontFamily: "monospace" }}>{user.mobile || "—"}</td>
                    <td style={{ padding: "11px 10px" }}>
                      <span style={{
                        display: "inline-block",
                        background: (ROLE_COLORS[user.role] || "#6b7280") + "20",
                        color: ROLE_COLORS[user.role] || "#6b7280",
                        border: `1px solid ${ROLE_COLORS[user.role] || "#6b7280"}55`,
                        padding: "3px 10px",
                        borderRadius: "10px",
                        fontSize: "13px",
                        fontWeight: "bold",
                        letterSpacing: "0.3px",
                        whiteSpace: "nowrap",
                      }}>
                        {user.role}
                      </span>
                    </td>
                    <td style={{ padding: "11px 10px" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: "5px",
                        color: user.active ? "#22c55e" : "#ef4444",
                        fontWeight: "600", fontSize: "14px",
                      }}>
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: user.active ? "#22c55e" : "#ef4444", display: "inline-block" }} />
                        {user.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td style={{ padding: "11px 10px", color: "#94a3b8", fontSize: "14px" }}>
                      {user.created_at ? new Date(user.created_at).toLocaleDateString('en-IN') : "—"}
                    </td>
                    <td style={{ padding: "11px 10px" }}>
                      <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                        <button
                          onClick={() => startEdit(user)}
                          style={{ background: "#0f2444", color: "#f4ae1f", border: "1px solid #f4ae1f55", padding: "4px 12px", borderRadius: "5px", cursor: "pointer", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" }}
                        >Edit</button>
                        {['SUPER_ADMIN','ADMIN','SUPERVISOR'].includes(user.role) && (
                          <button
                            onClick={() => { setPinUserId(user.id); setPinInput(""); }}
                            style={{ background: "#0a1f12", color: "#34d399", border: "1px solid #34d39933", padding: "4px 10px", borderRadius: "5px", cursor: "pointer", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" }}
                          >PIN</button>
                        )}
                        <button
                          onClick={() => toggleActive(user)}
                          style={{ background: user.active ? "#1f0808" : "#0a1f12", color: user.active ? "#ef4444" : "#22c55e", border: `1px solid ${user.active ? "#ef444433" : "#22c55e33"}`, padding: "4px 12px", borderRadius: "5px", cursor: "pointer", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" }}
                        >{user.active ? "Deactivate" : "Activate"}</button>
                        {deletingId === user.id ? (
                          <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            <span style={{ color: "#ef4444", fontSize: "13px", whiteSpace: "nowrap" }}>Sure?</span>
                            <button onClick={() => deleteUser(user.id)}
                              style={{ background: "#7f1d1d", color: "#ef4444", border: "1px solid #ef4444", padding: "4px 10px", borderRadius: "5px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Yes</button>
                            <button onClick={() => setDeletingId(null)}
                              style={{ background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", padding: "4px 8px", borderRadius: "5px", cursor: "pointer", fontSize: "13px" }}>No</button>
                          </span>
                        ) : (
                          <button onClick={() => setDeletingId(user.id)}
                            style={{ background: "#1f0808", color: "#ef4444", border: "1px solid #ef444433", padding: "4px 12px", borderRadius: "5px", cursor: "pointer", fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap" }}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Role Reference */}
      <div style={cardStyle}>
        <h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Role Permissions Reference</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
          {ROLES.map(role => (
            <div key={role} style={{ background: "#0d1b2f", border: `1px solid ${ROLE_COLORS[role]}33`, borderRadius: "8px", padding: "14px" }}>
              <div style={{ color: ROLE_COLORS[role], fontWeight: "bold", fontSize: "16px", marginBottom: "8px" }}>{role}</div>
              <div style={{ color: "#7da2d6", fontSize: "14px", lineHeight: "1.5" }}>{ROLE_PERMISSIONS[role]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Audit Log */}
      {showAudit && (
        <div style={cardStyle}>
          <h2 style={{ color: "#f4ae1f", marginTop: 0 }}>Audit Log — User Management</h2>
          {auditLogs.length === 0 ? (
            <div style={{ color: "#7da2d6", fontStyle: "italic" }}>No audit entries yet.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table width="100%" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #16345d" }}>
                    {["Time", "User", "Action", "Old Value", "New Value"].map(h => (
                      <th key={h} style={{ padding: "8px", textAlign: "left", color: "#f4ae1f", fontSize: "14px" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map(log => (
                    <tr key={log.id} style={{ borderBottom: "1px solid #0d1b2f" }}>
                      <td style={{ padding: "8px", color: "#7da2d6", fontSize: "14px", whiteSpace: "nowrap" }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td style={{ padding: "8px", color: "white", fontSize: "14px" }}>{log.username}</td>
                      <td style={{ padding: "8px", color: "#f4ae1f", fontSize: "14px" }}>{log.action}</td>
                      <td style={{ padding: "8px", color: "#ef4444", fontSize: "14px" }}>{log.old_value || "—"}</td>
                      <td style={{ padding: "8px", color: "#22c55e", fontSize: "14px" }}>{log.new_value || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
