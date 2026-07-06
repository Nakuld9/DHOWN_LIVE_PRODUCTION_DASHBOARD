import React, { useState, useEffect, useCallback } from "react";

const DEPARTMENTS = ["Knitting", "Finishing", "Quality", "Maintenance", "General"];
const SHIFTS = ["D", "N", "A", "B", "C"];

const EMPTY_NEW = {
  operator_code: "",
  operator_name: "",
  rfid_tag: "",
  mobile: "",
  department: "",
  shift: "D",
  employee_id: "",
  join_date: "",
  skill_level: "BASIC",
  emergency_contact: "",
};

const inputStyle = {
  width: "100%",
  padding: "9px",
  marginTop: "5px",
  background: "#0d1b2f",
  color: "white",
  border: "1px solid #16345d",
  borderRadius: "6px",
  boxSizing: "border-box",
  fontSize: "15px",
};

const labelStyle = { color: "#7da2d6", fontSize: "15px" };

const thStyle = {
  padding: "11px 8px",
  borderBottom: "2px solid #16345d",
  textAlign: "left",
  color: "#f4ae1f",
  fontSize: "14px",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 8px",
  borderBottom: "1px solid #0d1b2f",
  color: "white",
  fontSize: "15px",
};

const Operators = () => {
  const [operators, setOperators] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [activeTab, setActiveTab] = useState("operators");
  const [newOp, setNewOp] = useState(EMPTY_NEW);
  const [editingOp, setEditingOp] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState("success");

  const showMessage = (text, type = "success") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 4000);
  };

  const loadOperators = useCallback(async () => {
    try {
      const res = await fetch(
        `http://localhost:4000/api/operators?include_inactive=${showInactive}`
      );
      if (!res.ok) throw new Error("Server error " + res.status);
      const data = await res.json();
      setOperators(Array.isArray(data) ? data : []);
    } catch (err) {
      showMessage("Unable to load operators.", "error");
    }
  }, [showInactive]);

  useEffect(() => {
    loadOperators();
  }, [loadOperators]);

  const saveNew = async () => {
    if (!newOp.operator_code || !newOp.operator_name) {
      showMessage("Operator Code and Name are required.", "error");
      return;
    }
    try {
      const res = await fetch("http://localhost:4000/api/operators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newOp),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      showMessage("Operator added successfully.");
      setNewOp(EMPTY_NEW);
      setShowForm(false);
      loadOperators();
    } catch (err) {
      showMessage("Save operation failed: " + err.message, "error");
    }
  };

  const openEdit = (op) => {
    setEditingOp(op);
    setEditForm({
      operator_name: op.operator_name || "",
      rfid_tag: op.rfid_tag || "",
      mobile: op.mobile || "",
      department: op.department || "",
      shift: op.shift || "D",
      status: op.status || "ACTIVE",
      employee_id: op.employee_id || "",
      join_date: op.join_date ? op.join_date.slice(0, 10) : "",
      skill_level: op.skill_level || "BASIC",
      emergency_contact: op.emergency_contact || "",
    });
  };

  const saveEdit = async () => {
    if (!editForm.operator_name) {
      showMessage("Operator Name is required.", "error");
      return;
    }
    try {
      const res = await fetch(
        `http://localhost:4000/api/operators/${editingOp.operator_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editForm),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Save failed");
      }
      showMessage("Operator updated successfully.");
      setEditingOp(null);
      loadOperators();
    } catch (err) {
      showMessage("Save operation failed: " + err.message, "error");
    }
  };

  const deactivate = async (op) => {
    try {
      const res = await fetch(
        `http://localhost:4000/api/operators/${op.operator_id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed");
      }
      showMessage(`${op.operator_name} deactivated.`);
      loadOperators();
    } catch (err) {
      showMessage("Operation failed: " + err.message, "error");
    }
  };

  const reactivate = async (op) => {
    try {
      const res = await fetch(
        `http://localhost:4000/api/operators/${op.operator_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "ACTIVE" }),
        }
      );
      if (!res.ok) throw new Error("Failed");
      showMessage(`${op.operator_name} reactivated.`);
      loadOperators();
    } catch (err) {
      showMessage("Operation failed: " + err.message, "error");
    }
  };

  const activeCount = operators.filter((o) => o.status !== "INACTIVE").length;
  const inactiveCount = operators.filter((o) => o.status === "INACTIVE").length;

  return (
    <div
      style={{
        padding: "20px",
        background: "#050d1a",
        minHeight: "100vh",
        color: "white",
      }}
    >
      <h1 style={{ color: "#f4ae1f", marginBottom: "6px" }}>OPERATOR MASTER</h1>
      <p style={{ color: "#7da2d6", marginBottom: "14px", fontSize: "15px" }}>
        {activeCount} active{inactiveCount > 0 && ` · ${inactiveCount} inactive`}
      </p>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        {[{ key: "operators", label: "Operators" }, { key: "attendance", label: "Attendance" }].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: "8px 20px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "bold", fontSize: "14px",
            background: activeTab === t.key ? "#f4ae1f" : "#0d1b2f",
            color: activeTab === t.key ? "black" : "#7da2d6",
          }}>{t.label}</button>
        ))}
      </div>

      {activeTab === "attendance" && <AttendanceTab />}
      {activeTab !== "attendance" && <>


      {/* Message Banner */}
      {msg && (
        <div
          style={{
            background:
              msgType === "error"
                ? "rgba(239,68,68,0.15)"
                : "rgba(34,197,94,0.15)",
            border: `1px solid ${
              msgType === "error" ? "#ef4444" : "#22c55e"
            }`,
            padding: "10px 16px",
            borderRadius: "8px",
            marginBottom: "16px",
            color: msgType === "error" ? "#ef4444" : "#22c55e",
            fontSize: "16px",
          }}
        >
          {msg}
        </div>
      )}

      {/* Controls Row */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "20px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setShowForm((f) => !f)}
          style={{
            background: "#22c55e",
            color: "white",
            border: "none",
            padding: "10px 18px",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "bold",
            fontSize: "15px",
          }}
        >
          {showForm ? "✕ Cancel" : "+ New Operator"}
        </button>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            color: "#7da2d6",
            cursor: "pointer",
            fontSize: "15px",
          }}
        >
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Show Inactive Operators
        </label>
      </div>

      {/* Add Form */}
      {showForm && (
        <div
          style={{
            background: "#071120",
            border: "1px solid #f4ae1f",
            padding: "24px",
            borderRadius: "12px",
            marginBottom: "24px",
          }}
        >
          <h3 style={{ color: "#f4ae1f", marginTop: 0, marginBottom: "18px" }}>
            Add New Operator
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "16px",
            }}
          >
            <div>
              <label style={labelStyle}>Code *</label>
              <input
                style={inputStyle}
                placeholder="e.g. OP001"
                value={newOp.operator_code}
                onChange={(e) =>
                  setNewOp({ ...newOp, operator_code: e.target.value })
                }
              />
            </div>
            <div>
              <label style={labelStyle}>Name *</label>
              <input
                style={inputStyle}
                placeholder="Full Name"
                value={newOp.operator_name}
                onChange={(e) =>
                  setNewOp({ ...newOp, operator_name: e.target.value })
                }
              />
            </div>
            <div>
              <label style={labelStyle}>RFID Tag</label>
              <input
                style={inputStyle}
                placeholder="RFID"
                value={newOp.rfid_tag}
                onChange={(e) =>
                  setNewOp({ ...newOp, rfid_tag: e.target.value })
                }
              />
            </div>
            <div>
              <label style={labelStyle}>Mobile</label>
              <input
                style={inputStyle}
                placeholder="Mobile Number"
                value={newOp.mobile}
                onChange={(e) =>
                  setNewOp({ ...newOp, mobile: e.target.value })
                }
              />
            </div>
            <div>
              <label style={labelStyle}>Department</label>
              <select
                style={inputStyle}
                value={newOp.department}
                onChange={(e) =>
                  setNewOp({ ...newOp, department: e.target.value })
                }
              >
                <option value="">Select Department</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Shift</label>
              <select
                style={inputStyle}
                value={newOp.shift}
                onChange={(e) =>
                  setNewOp({ ...newOp, shift: e.target.value })
                }
              >
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Employee ID</label>
              <input style={inputStyle} placeholder="e.g. EMP001" value={newOp.employee_id}
                onChange={e => setNewOp({ ...newOp, employee_id: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Join Date</label>
              <input type="date" style={inputStyle} value={newOp.join_date}
                onChange={e => setNewOp({ ...newOp, join_date: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Skill Level</label>
              <select style={inputStyle} value={newOp.skill_level}
                onChange={e => setNewOp({ ...newOp, skill_level: e.target.value })}>
                <option value="BASIC">Basic</option>
                <option value="INTERMEDIATE">Intermediate</option>
                <option value="EXPERT">Expert</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Emergency Contact</label>
              <input style={inputStyle} placeholder="Emergency mobile" value={newOp.emergency_contact}
                onChange={e => setNewOp({ ...newOp, emergency_contact: e.target.value })} />
            </div>
          </div>
          <button
            onClick={saveNew}
            style={{
              marginTop: "18px",
              background: "#f4ae1f",
              color: "black",
              border: "none",
              padding: "10px 24px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: "16px",
            }}
          >
            Save Operator
          </button>
        </div>
      )}

      {/* Operators Table */}
      <div
        style={{
          background: "#071120",
          border: "1px solid #16345d",
          borderRadius: "12px",
          padding: "20px",
          overflowX: "auto",
        }}
      >
        <h2 style={{ color: "#f4ae1f", marginTop: 0 }}>
          Operators ({operators.length})
        </h2>
        <table width="100%" style={{ borderCollapse: "collapse", minWidth: "800px" }}>
          <thead>
            <tr>
              {[
                "Code",
                "Name",
                "RFID",
                "Mobile",
                "Department",
                "Shift",
                "Status",
                "Actions",
              ].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {operators.length === 0 ? (
              <tr>
                <td
                  colSpan="8"
                  style={{
                    padding: "24px",
                    color: "#7da2d6",
                    fontStyle: "italic",
                  }}
                >
                  No operators found.
                </td>
              </tr>
            ) : (
              operators.map((op) => (
                <tr
                  key={op.operator_id}
                  style={{
                    opacity: op.status === "INACTIVE" ? 0.55 : 1,
                    background:
                      op.status === "INACTIVE" ? "#050d1a" : "transparent",
                  }}
                >
                  <td style={tdStyle}>{op.operator_code}</td>
                  <td style={{ ...tdStyle, fontWeight: "bold" }}>
                    {op.operator_name}
                  </td>
                  <td style={tdStyle}>{op.rfid_tag || "—"}</td>
                  <td style={tdStyle}>{op.mobile || "—"}</td>
                  <td style={tdStyle}>{op.department || "—"}</td>
                  <td style={tdStyle}>{op.shift || "—"}</td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        color:
                          op.status === "INACTIVE" ? "#ef4444" : "#22c55e",
                        fontWeight: "bold",
                        fontSize: "14px",
                      }}
                    >
                      {op.status || "ACTIVE"}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        onClick={() => openEdit(op)}
                        style={{
                          background: "#16345d",
                          color: "#f4ae1f",
                          border: "1px solid #f4ae1f",
                          padding: "4px 12px",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "14px",
                        }}
                      >
                        Edit
                      </button>
                      {op.status === "INACTIVE" ? (
                        <button
                          onClick={() => reactivate(op)}
                          style={{
                            background: "#14532d",
                            color: "#22c55e",
                            border: "1px solid #22c55e44",
                            padding: "4px 12px",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "14px",
                          }}
                        >
                          Activate
                        </button>
                      ) : (
                        <button
                          onClick={() => deactivate(op)}
                          style={{
                            background: "#450a0a",
                            color: "#ef4444",
                            border: "1px solid #ef444444",
                            padding: "4px 12px",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "14px",
                          }}
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {editingOp && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#071120",
              border: "1px solid #f4ae1f",
              borderRadius: "12px",
              padding: "32px",
              width: "560px",
              maxWidth: "95vw",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <h3 style={{ color: "#f4ae1f", marginTop: 0 }}>
              Edit Operator —{" "}
              <span style={{ color: "white" }}>{editingOp.operator_name}</span>
            </h3>
            <p style={{ color: "#7da2d6", fontSize: "14px", marginTop: "-8px" }}>
              Code: {editingOp.operator_code}
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "16px",
              }}
            >
              <div>
                <label style={labelStyle}>Operator Name *</label>
                <input
                  style={inputStyle}
                  value={editForm.operator_name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, operator_name: e.target.value })
                  }
                />
              </div>
              <div>
                <label style={labelStyle}>RFID Tag</label>
                <input
                  style={inputStyle}
                  value={editForm.rfid_tag}
                  onChange={(e) =>
                    setEditForm({ ...editForm, rfid_tag: e.target.value })
                  }
                />
              </div>
              <div>
                <label style={labelStyle}>Mobile</label>
                <input
                  style={inputStyle}
                  value={editForm.mobile}
                  onChange={(e) =>
                    setEditForm({ ...editForm, mobile: e.target.value })
                  }
                />
              </div>
              <div>
                <label style={labelStyle}>Department</label>
                <select
                  style={inputStyle}
                  value={editForm.department}
                  onChange={(e) =>
                    setEditForm({ ...editForm, department: e.target.value })
                  }
                >
                  <option value="">Select Department</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Shift</label>
                <select
                  style={inputStyle}
                  value={editForm.shift}
                  onChange={(e) =>
                    setEditForm({ ...editForm, shift: e.target.value })
                  }
                >
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Status</label>
                <select
                  style={inputStyle}
                  value={editForm.status}
                  onChange={(e) =>
                    setEditForm({ ...editForm, status: e.target.value })
                  }
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Employee ID</label>
                <input style={inputStyle} placeholder="e.g. EMP001" value={editForm.employee_id}
                  onChange={e => setEditForm({ ...editForm, employee_id: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Join Date</label>
                <input type="date" style={inputStyle} value={editForm.join_date}
                  onChange={e => setEditForm({ ...editForm, join_date: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Skill Level</label>
                <select style={inputStyle} value={editForm.skill_level}
                  onChange={e => setEditForm({ ...editForm, skill_level: e.target.value })}>
                  <option value="BASIC">Basic</option>
                  <option value="INTERMEDIATE">Intermediate</option>
                  <option value="EXPERT">Expert</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Emergency Contact</label>
                <input style={inputStyle} placeholder="Emergency mobile" value={editForm.emergency_contact}
                  onChange={e => setEditForm({ ...editForm, emergency_contact: e.target.value })} />
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
              <button
                onClick={saveEdit}
                style={{
                  background: "#f4ae1f",
                  color: "black",
                  border: "none",
                  padding: "10px 28px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  fontSize: "16px",
                }}
              >
                Save Changes
              </button>
              <button
                onClick={() => setEditingOp(null)}
                style={{
                  background: "#374151",
                  color: "white",
                  border: "none",
                  padding: "10px 20px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "16px",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
  );
};

function AttendanceTab() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState("");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ date });
      if (shift) p.set("shift", shift);
      const r = await fetch(`http://localhost:4000/api/attendance?${p}`);
      setRecords(await r.json());
    } catch {}
    finally { setLoading(false); }
  }, [date, shift]);

  useEffect(() => { load(); }, [load]);

  const th = { padding: "10px 8px", textAlign: "left", color: "#f4ae1f", fontSize: "13px", borderBottom: "2px solid #16345d" };
  const td = { padding: "10px 8px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: "14px" };

  const present = records.length;
  const dayShift = records.filter(r => r.shift === "D").length;
  const nightShift = records.filter(r => r.shift === "N").length;

  return (
    <div>
      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "14px", marginBottom: "20px" }}>
        {[
          { label: "Present Today", value: present, color: "#22c55e" },
          { label: "Day Shift (D)", value: dayShift, color: "#fbbf24" },
          { label: "Night Shift (N)", value: nightShift, color: "#818cf8" },
        ].map(k => (
          <div key={k.label} style={{ background: "#081426", border: "1px solid #16345d", borderRadius: "10px", padding: "16px", textAlign: "center" }}>
            <div style={{ fontSize: "28px", fontWeight: "bold", color: k.color }}>{k.value}</div>
            <div style={{ fontSize: "12px", color: "#7da2d6", marginTop: "4px" }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ padding: "8px 10px", background: "#0d1b2f", color: "white", border: "1px solid #16345d", borderRadius: "6px", fontSize: "14px" }} />
        <select value={shift} onChange={e => setShift(e.target.value)}
          style={{ padding: "8px 10px", background: "#0d1b2f", color: "white", border: "1px solid #16345d", borderRadius: "6px", fontSize: "14px" }}>
          <option value="">All Shifts</option>
          <option value="D">Day (D)</option>
          <option value="N">Night (N)</option>
        </select>
        <button onClick={load} style={{ background: "#f4ae1f", color: "black", border: "none", padding: "8px 18px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", fontSize: "14px" }}>
          Refresh
        </button>
      </div>

      {/* Table */}
      <div style={{ background: "#071120", border: "1px solid #16345d", borderRadius: "12px", overflowX: "auto" }}>
        <table width="100%" style={{ borderCollapse: "collapse", minWidth: "700px" }}>
          <thead>
            <tr>
              {["Operator", "Shift", "Clock In", "Last Seen", "Scans", "Status"].map(h => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="6" style={{ padding: "24px", textAlign: "center", color: "#7da2d6" }}>Loading...</td></tr>}
            {!loading && records.length === 0 && (
              <tr><td colSpan="6" style={{ padding: "24px", textAlign: "center", color: "#7da2d6", fontStyle: "italic" }}>
                No attendance records for {date}{shift ? ` (${shift === "D" ? "Day" : "Night"} shift)` : ""}. Records are created automatically when operators scan their RFID.
              </td></tr>
            )}
            {records.map(r => (
              <tr key={r.attendance_id}>
                <td style={{ ...td, fontWeight: "bold", color: "#f4ae1f" }}>{r.operator_name}</td>
                <td style={td}>
                  <span style={{ background: r.shift === "D" ? "rgba(251,191,36,0.2)" : "rgba(129,140,248,0.2)", color: r.shift === "D" ? "#fbbf24" : "#818cf8", padding: "2px 10px", borderRadius: "4px", fontSize: "13px", fontWeight: "bold" }}>
                    {r.shift === "D" ? "☀ Day" : "🌙 Night"}
                  </span>
                </td>
                <td style={{ ...td, color: "#22c55e" }}>{r.clock_in ? new Date(r.clock_in).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}</td>
                <td style={{ ...td, color: "#7da2d6" }}>{r.last_seen ? new Date(r.last_seen).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}</td>
                <td style={{ ...td, color: "#60a5fa" }}>{r.scan_count}</td>
                <td style={td}>
                  <span style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", padding: "2px 10px", borderRadius: "4px", fontSize: "13px", fontWeight: "bold" }}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Operators;
