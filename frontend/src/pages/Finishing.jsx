import React, { useState, useEffect, useCallback } from "react";

const API = "";
const token = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });
const fmtKg = v => v != null ? parseFloat(v).toFixed(3) : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : "—";

const JOB_COLORS = { DYEING: "var(--purple)", FINISHING: "var(--green)", DYEING_FINISHING: "var(--gold)" };

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

  const inputStyle = { width: "100%", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, padding: "7px 10px", color: "var(--text)", fontSize: 13, boxSizing: "border-box" };
  const labelStyle = { color: "var(--muted)", fontSize: 12, marginBottom: 3, display: "block" };

  const lossKg = selected
    ? Math.max(0, parseFloat(selected.sent_weight_kg || 0) - parseFloat(selected.received_weight_kg || 0) - parseFloat(form.damage_kg || 0)).toFixed(2)
    : 0;
  const yieldPct = selected && selected.sent_weight_kg > 0
    ? ((parseFloat(selected.received_weight_kg || 0) / parseFloat(selected.sent_weight_kg)) * 100).toFixed(1)
    : null;

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--yellow)" }}>🎨 Finishing & QA</h2>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
            Record shade, GSM, moisture, shrinkage · QA pass/fail per dye lot
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["all", "All"], ["pending", "Pending QA"], ["done", "QA Done"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilterDone(v)}
              style={{ padding: "6px 14px", borderRadius: 5, border: "1px solid var(--border)", cursor: "pointer", fontSize: 12,
                background: filterDone === v ? "var(--yellow)" : "var(--surface)", color: filterDone === v ? "var(--bg)" : "var(--text)" }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {[
          ["Total Receipts", records.length, "var(--text)"],
          ["QA Pending", records.filter(r => !r.finishing_id).length, "var(--gold)"],
          ["QA Done", records.filter(r => r.finishing_id).length, "var(--green)"],
          ["QA Failed", records.filter(r => r.finishing_id && r.qa_passed === false).length, "var(--crit)"],
        ].map(([label, val, color]) => (
          <div key={label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 18px" }}>
            <div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div>
            <div style={{ color, fontSize: 22, fontWeight: "bold" }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        {/* Left — receipt list */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading ? <div style={{ color: "var(--muted)" }}>Loading...</div> :
            filtered.length === 0 ? <div style={{ color: "var(--muted)", textAlign: "center", marginTop: 60 }}>No records found.</div> :
            filtered.map(rec => {
              const done = !!rec.finishing_id;
              const passed = rec.qa_passed !== false;
              return (
                <div key={rec.receipt_id} onClick={() => open(rec)}
                  style={{ background: selected?.receipt_id === rec.receipt_id ? "var(--border)" : "var(--surface)",
                    border: `1px solid ${selected?.receipt_id === rec.receipt_id ? "var(--yellow)" : "var(--border)"}`,
                    borderRadius: 8, padding: "14px 16px", marginBottom: 10, cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                        <span style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: 14 }}>{rec.challan_number}</span>
                        <span style={{ background: (JOB_COLORS[rec.job_type] || "var(--muted)") + "22", color: JOB_COLORS[rec.job_type] || "var(--muted)", border: `1px solid ${JOB_COLORS[rec.job_type] || "var(--muted)"}`, borderRadius: 4, padding: "1px 7px", fontSize: 10 }}>
                          {rec.job_type?.replace("_", " ")}
                        </span>
                      </div>
                      <div style={{ color: "var(--text)" }}>{rec.vendor_name}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                        {rec.batch_number} · {rec.fabric_type} · {rec.color_name}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                        Received: <strong style={{ color: "var(--text)" }}>{parseFloat(rec.received_weight_kg || 0).toFixed(1)}kg</strong>
                        {rec.sent_weight_kg && <> · Yield: <strong style={{ color: "var(--green)" }}>{((rec.received_weight_kg / rec.sent_weight_kg) * 100).toFixed(1)}%</ strong></>}
                        · {rec.received_date?.slice(0, 10)}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      {done ? (
                        <span style={{ background: passed ? "#10b98122" : "#ef444422", color: passed ? "var(--green)" : "var(--crit)", border: `1px solid ${passed ? "var(--green)" : "var(--crit)"}`, borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>
                          {passed ? "✓ QA PASS" : "✗ QA FAIL"}
                        </span>
                      ) : (
                        <span style={{ background: "#f59e0b22", color: "var(--gold)", border: "1px solid var(--gold)", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>PENDING QA</span>
                      )}
                      {done && rec.shade && <span style={{ color: "var(--muted)", fontSize: 11 }}>Shade: {rec.shade}</span>}
                    </div>
                  </div>
                </div>
              );
            })
          }
        </div>

        {/* Right — QA form */}
        {selected && (
          <div style={{ width: 400, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 20, flexShrink: 0 }}>
            <div style={{ fontWeight: "bold", color: "var(--yellow)", fontSize: 15, marginBottom: 2 }}>{selected.challan_number}</div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 16 }}>{selected.vendor_name} · {selected.batch_number} · {selected.color_name}</div>

            {/* Weight summary */}
            <div style={{ background: "var(--bg)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[["Sent", `${parseFloat(selected.sent_weight_kg || 0).toFixed(1)}kg`, "var(--muted)"],
                ["Received", `${parseFloat(selected.received_weight_kg || 0).toFixed(1)}kg`, "var(--green)"],
                ["Yield", yieldPct ? `${yieldPct}%` : "—", yieldPct >= 90 ? "var(--green)" : yieldPct >= 80 ? "var(--gold)" : "var(--crit)"]
              ].map(([l, v, c]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ color: "var(--muted)", fontSize: 10 }}>{l}</div>
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
                  <div style={{ color: "var(--muted)", fontSize: 11 }}>Processing Loss</div>
                  <div style={{ color: lossKg > 0 ? "var(--gold)" : "var(--green)", fontWeight: "bold", fontSize: 16, padding: "7px 0" }}>{lossKg} kg</div>
                </div>
              </div>

              {/* QA decision */}
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>QA Decision</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {[true, false].map(v => (
                    <button type="button" key={String(v)} onClick={() => setForm(f => ({ ...f, qa_passed: v }))}
                      style={{ flex: 1, padding: "10px", borderRadius: 6, border: `2px solid ${form.qa_passed === v ? (v ? "var(--green)" : "var(--crit)") : "var(--border)"}`,
                        background: form.qa_passed === v ? (v ? "#10b98122" : "#ef444422") : "var(--bg)",
                        color: form.qa_passed === v ? (v ? "var(--green)" : "var(--crit)") : "var(--muted)",
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
                style={{ width: "100%", background: saving ? "var(--border)" : "var(--yellow)", color: saving ? "var(--muted)" : "var(--bg)",
                  border: "none", borderRadius: 6, padding: "10px", fontWeight: "bold", cursor: saving ? "not-allowed" : "pointer", fontSize: 14 }}>
                {saving ? "Saving..." : saved ? "✓ Saved!" : "Save QA Record"}
              </button>

              {saved && (
                <div style={{ marginTop: 10, textAlign: "center", color: "var(--green)", fontSize: 13 }}>
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
