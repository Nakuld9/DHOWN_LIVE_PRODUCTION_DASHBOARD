import React, { useState, useEffect, useCallback } from "react";

const API = "http://localhost:4000";
const token = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });
const fmtKg = v => v != null ? parseFloat(v).toFixed(3) : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const JOB_COLORS = { DYEING: "#6366f1", FINISHING: "#10b981", DYEING_FINISHING: "#f59e0b" };

export default function Finishing() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [filterDone, setFilterDone] = useState("all"); // all | pending | done

  const [form, setForm] = useState({
    shade: "", gsm: "", moisture_pct: "", damage_kg: "0",
    shrinkage_pct: "", qa_passed: true, qa_notes: "",
    // QC Checklist fields
    qc_checklist: {},
    defects: [],
    overall_grade: "A", // A, B, C, R (Reject)
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/finishing`, { headers: h() });
      setRecords(await r.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = (rec) => {
    setSelected(rec);
    setSaved(false);
    setForm({
      shade: rec.shade || "",
      gsm: rec.gsm || "",
      moisture_pct: rec.moisture_pct || "",
      damage_kg: rec.damage_kg || "0",
      shrinkage_pct: rec.shrinkage_pct || "",
      qa_passed: rec.qa_passed !== false,
      qa_notes: rec.qa_notes || "",
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const r = await fetch(`${API}/api/finishing/${selected.receipt_id}`, {
      method: "POST", headers: h(),
      body: JSON.stringify({ ...form, gsm: form.gsm || null, moisture_pct: form.moisture_pct || null, shrinkage_pct: form.shrinkage_pct || null }),
    });
    if (r.ok) { setSaved(true); load(); }
    setSaving(false);
  };

  const filtered = records.filter(r => {
    if (filterDone === "pending") return !r.finishing_id;
    if (filterDone === "done") return !!r.finishing_id;
    return true;
  });

  const inputStyle = { width: "100%", background: "#081426", border: "1px solid #1e3a5f", borderRadius: 5, padding: "7px 10px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" };
  const labelStyle = { color: "#7da2d6", fontSize: 12, marginBottom: 3, display: "block" };

  const lossKg = selected
    ? Math.max(0, parseFloat(selected.sent_weight_kg || 0) - parseFloat(selected.received_weight_kg || 0) - parseFloat(form.damage_kg || 0)).toFixed(2)
    : 0;
  const yieldPct = selected && selected.sent_weight_kg > 0
    ? ((parseFloat(selected.received_weight_kg || 0) / parseFloat(selected.sent_weight_kg)) * 100).toFixed(1)
    : null;

  return (
    <div style={{ padding: 20, color: "#e2e8f0" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: "#f4ae1f" }}>🎨 Finishing & QA</h2>
          <div style={{ color: "#7da2d6", fontSize: 13, marginTop: 2 }}>
            Record shade, GSM, moisture, shrinkage · QA pass/fail per dye lot
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["all", "All"], ["pending", "Pending QA"], ["done", "QA Done"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilterDone(v)}
              style={{ padding: "6px 14px", borderRadius: 5, border: "1px solid #1e3a5f", cursor: "pointer", fontSize: 12,
                background: filterDone === v ? "#f4ae1f" : "#0d1b2a", color: filterDone === v ? "#081426" : "#e2e8f0" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {[
          ["Total Receipts", records.length, "#e2e8f0"],
          ["QA Pending", records.filter(r => !r.finishing_id).length, "#f59e0b"],
          ["QA Done", records.filter(r => r.finishing_id).length, "#10b981"],
          ["QA Failed", records.filter(r => r.finishing_id && r.qa_passed === false).length, "#ef4444"],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 8, padding: "10px 18px" }}>
            <div style={{ color: "#7da2d6", fontSize: 11 }}>{label}</div>
            <div style={{ color, fontSize: 22, fontWeight: "bold" }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        {/* Left — receipt list */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? <div style={{ color: "#7da2d6" }}>Loading...</div> :
            filtered.length === 0 ? <div style={{ color: "#7da2d6", textAlign: "center", marginTop: 60 }}>No records found.</div> :
            filtered.map(rec => {
              const done = !!rec.finishing_id;
              const passed = rec.qa_passed !== false;
              return (
                <div key={rec.receipt_id} onClick={() => open(rec)}
                  style={{ background: selected?.receipt_id === rec.receipt_id ? "#1e3a5f" : "#0d1b2a",
                    border: `1px solid ${selected?.receipt_id === rec.receipt_id ? "#f4ae1f" : "#1e3a5f"}`,
                    borderRadius: 8, padding: "14px 16px", marginBottom: 10, cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                        <span style={{ color: "#f4ae1f", fontWeight: "bold", fontSize: 14 }}>{rec.challan_number}</span>
                        <span style={{ background: (JOB_COLORS[rec.job_type] || "#7da2d6") + "22", color: JOB_COLORS[rec.job_type] || "#7da2d6", border: `1px solid ${JOB_COLORS[rec.job_type] || "#7da2d6"}`, borderRadius: 4, padding: "1px 7px", fontSize: 10 }}>
                          {rec.job_type?.replace("_", " ")}
                        </span>
                      </div>
                      <div style={{ color: "#e2e8f0" }}>{rec.vendor_name}</div>
                      <div style={{ color: "#7da2d6", fontSize: 12, marginTop: 2 }}>
                        {rec.batch_number} · {rec.fabric_type} · {rec.color_name}
                      </div>
                      <div style={{ color: "#7da2d6", fontSize: 12, marginTop: 2 }}>
                        Received: <strong style={{ color: "#e2e8f0" }}>{parseFloat(rec.received_weight_kg || 0).toFixed(1)}kg</strong>
                        {rec.sent_weight_kg && <> · Yield: <strong style={{ color: "#10b981" }}>{((rec.received_weight_kg / rec.sent_weight_kg) * 100).toFixed(1)}%</ strong></>}
                        · {rec.received_date?.slice(0, 10)}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      {done ? (
                        <span style={{ background: passed ? "#10b98122" : "#ef444422", color: passed ? "#10b981" : "#ef4444", border: `1px solid ${passed ? "#10b981" : "#ef4444"}`, borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>
                          {passed ? "✓ QA PASS" : "✗ QA FAIL"}
                        </span>
                      ) : (
                        <span style={{ background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>PENDING QA</span>
                      )}
                      {done && rec.shade && <span style={{ color: "#7da2d6", fontSize: 11 }}>Shade: {rec.shade}</span>}
                    </div>
                  </div>
                </div>
              );
            })
          }
        </div>

        {/* Right — QA form */}
        {selected && (
          <div style={{ width: 400, background: "#0d1b2a", border: "1px solid #1e3a5f", borderRadius: 10, padding: 20, flexShrink: 0 }}>
            <div style={{ fontWeight: "bold", color: "#f4ae1f", fontSize: 15, marginBottom: 2 }}>{selected.challan_number}</div>
            <div style={{ color: "#7da2d6", fontSize: 12, marginBottom: 16 }}>{selected.vendor_name} · {selected.batch_number} · {selected.color_name}</div>

            {/* Weight summary */}
            <div style={{ background: "#081426", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[["Sent", `${parseFloat(selected.sent_weight_kg || 0).toFixed(1)}kg`, "#7da2d6"],
                ["Received", `${parseFloat(selected.received_weight_kg || 0).toFixed(1)}kg`, "#10b981"],
                ["Yield", yieldPct ? `${yieldPct}%` : "—", yieldPct >= 90 ? "#10b981" : yieldPct >= 80 ? "#f59e0b" : "#ef4444"]
              ].map(([l, v, c]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ color: "#7da2d6", fontSize: 10 }}>{l}</div>
                  <div style={{ color: c, fontWeight: "bold", fontSize: 15 }}>{v}</div>
                </div>
              ))}
            </div>

            <form onSubmit={save}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Shade / Color Name</label>
                  <input value={form.shade} onChange={e => setForm(f => ({ ...f, shade: e.target.value }))} style={inputStyle} placeholder="e.g. Navy Blue" />
                </div>
                <div>
                  <label style={labelStyle}>GSM (g/m²)</label>
                  <input type="number" step="0.01" value={form.gsm} onChange={e => setForm(f => ({ ...f, gsm: e.target.value }))} style={inputStyle} placeholder="e.g. 180" />
                </div>
                <div>
                  <label style={labelStyle}>Moisture %</label>
                  <input type="number" step="0.1" min="0" max="100" value={form.moisture_pct} onChange={e => setForm(f => ({ ...f, moisture_pct: e.target.value }))} style={inputStyle} placeholder="e.g. 12.5" />
                </div>
                <div>
                  <label style={labelStyle}>Shrinkage %</label>
                  <input type="number" step="0.1" min="0" max="100" value={form.shrinkage_pct} onChange={e => setForm(f => ({ ...f, shrinkage_pct: e.target.value }))} style={inputStyle} placeholder="e.g. 3.0" />
                </div>
                <div>
                  <label style={labelStyle}>Damage / Reject (kg)</label>
                  <input type="number" step="0.01" min="0" value={form.damage_kg} onChange={e => setForm(f => ({ ...f, damage_kg: e.target.value }))} style={inputStyle} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                  <div style={{ color: "#7da2d6", fontSize: 11 }}>Processing Loss</div>
                  <div style={{ color: lossKg > 0 ? "#f59e0b" : "#10b981", fontWeight: "bold", fontSize: 16, padding: "7px 0" }}>{lossKg} kg</div>
                </div>
              </div>

              {/* QA decision */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>QA Decision</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {[true, false].map(v => (
                    <button type="button" key={String(v)} onClick={() => setForm(f => ({ ...f, qa_passed: v }))}
                      style={{ flex: 1, padding: "10px", borderRadius: 6, border: `2px solid ${form.qa_passed === v ? (v ? "#10b981" : "#ef4444") : "#1e3a5f"}`,
                        background: form.qa_passed === v ? (v ? "#10b98122" : "#ef444422") : "#081426",
                        color: form.qa_passed === v ? (v ? "#10b981" : "#ef4444") : "#7da2d6",
                        cursor: "pointer", fontWeight: "bold", fontSize: 14 }}>
                      {v ? "✓ PASS" : "✗ FAIL"}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>QA Notes</label>
                <textarea value={form.qa_notes} onChange={e => setForm(f => ({ ...f, qa_notes: e.target.value }))}
                  style={{ ...inputStyle, minHeight: 60 }} placeholder={form.qa_passed ? "Optional remarks..." : "Describe the defect / reason for rejection"} />
              </div>

              <button type="submit" disabled={saving}
                style={{ width: "100%", background: saving ? "#1e3a5f" : "#f4ae1f", color: saving ? "#7da2d6" : "#081426",
                  border: "none", borderRadius: 6, padding: "10px", fontWeight: "bold", cursor: saving ? "not-allowed" : "pointer", fontSize: 14 }}>
                {saving ? "Saving..." : saved ? "✓ Saved!" : "Save QA Record"}
              </button>

              {saved && (
                <div style={{ marginTop: 10, textAlign: "center", color: "#10b981", fontSize: 13 }}>
                  ✓ Finishing record saved · Finished goods {form.qa_passed ? "IN_STOCK" : "put on HOLD"}
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
