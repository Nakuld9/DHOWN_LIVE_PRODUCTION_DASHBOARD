// Shade Approvals — track a colour sample from sent → approved/rejected, and tie
// an approved shade to a sales order. Bridges Shade Cards and Sales.
import React, { useState, useEffect, useCallback } from "react";

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB").split("/").join("-") : "—");
const role = () => { try { return (JSON.parse(localStorage.getItem("dhown_user") || "{}").role || "").toUpperCase(); } catch { return ""; } };
const canWrite = () => ["SALES", "SUPERVISOR", "ADMIN"].includes(role());

const STATUS_TONE = {
  SENT: "var(--gold-deep)", RESENT: "var(--gold-deep)",
  APPROVED: "var(--green)", REJECTED: "var(--crit)", CANCELLED: "var(--faint)",
};

export default function ShadeApprovals() {
  const [rows, setRows] = useState([]);
  const [sum, setSum] = useState(null);
  const [state, setState] = useState("loading");
  const [filter, setFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ shade_name: "", shade_code: "", hex: "#1f9d57", customer_name: "", fabric_type: "", sample_ref: "", so_number: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const writable = canWrite();

  const load = useCallback(async () => {
    try {
      const q = filter ? `?status=${filter}` : "";
      const [r, s] = await Promise.all([
        fetch(`/api/shade-approvals${q}`, { headers: auth() }),
        fetch(`/api/shade-approvals/summary`, { headers: auth() }),
      ]);
      if (!r.ok) { setState("error"); return; }
      setRows(await r.json()); if (s.ok) setSum(await s.json()); setState("ok");
    } catch { setState("error"); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!form.shade_name.trim()) { alert("Shade name is required."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/shade-approvals", { method: "POST", headers: { "Content-Type": "application/json", ...auth() }, body: JSON.stringify(form) });
      if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); return; }
      setShowForm(false); setForm({ shade_name: "", shade_code: "", hex: "#1f9d57", customer_name: "", fabric_type: "", sample_ref: "", so_number: "", notes: "" });
      load();
    } catch { alert("Failed to save."); } finally { setBusy(false); }
  };

  const decide = async (id, status) => {
    let notes = null, decided_by = null;
    if (status === "REJECTED") { notes = window.prompt("Reason for rejection (optional):") || null; }
    if (status === "APPROVED") { decided_by = window.prompt("Approved by (customer contact, optional):") || null; }
    const r = await fetch(`/api/shade-approvals/${id}/decide`, { method: "POST", headers: { "Content-Type": "application/json", ...auth() }, body: JSON.stringify({ status, notes, decided_by }) });
    if (!r.ok) { const e = await r.json(); alert(e.error || "Failed"); return; }
    load();
  };

  const page = { padding: "22px 26px", maxWidth: 1150, margin: "0 auto" };
  const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow)" };
  const tile = { ...card, padding: "14px 16px", flex: "1 1 150px", minWidth: 130 };
  const th = { padding: "9px 11px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 700, borderBottom: "2px solid var(--border)", whiteSpace: "nowrap" };
  const td = { padding: "9px 11px", fontSize: 13, borderTop: "1px solid var(--border-soft)", verticalAlign: "middle" };
  const inp = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, color: "var(--text)", width: "100%" };
  const btn = (bg, fg, bd) => ({ font: "inherit", fontSize: 12, fontWeight: 700, color: fg, background: bg, border: `1px solid ${bd}`, borderRadius: 6, padding: "6px 11px", cursor: "pointer" });
  const lbl = { fontSize: 11, color: "var(--muted)", marginBottom: 3, display: "block" };

  return (
    <div style={page}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>🎨 Shade Approvals</h1>
        <div style={{ flex: 1 }} />
        {writable && <button style={btn("var(--green)", "var(--on-green)", "var(--green)")} onClick={() => setShowForm((s) => !s)}>{showForm ? "✕ Close" : "+ Log a sample"}</button>}
      </div>
      <div style={{ color: "var(--muted)", fontSize: 13.5, marginBottom: 18 }}>Track each colour sample sent to a customer through to their approval, then tie the approved shade to its sales order.</div>

      {sum && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <div style={tile}><div style={lbl}>Pending</div><div style={{ fontSize: 26, fontWeight: 800, color: "var(--gold-deep)" }}>{sum.pending}</div></div>
          <div style={tile}><div style={lbl}>Approved</div><div style={{ fontSize: 26, fontWeight: 800, color: "var(--green)" }}>{sum.approved}</div></div>
          <div style={tile}><div style={lbl}>Rejected</div><div style={{ fontSize: 26, fontWeight: 800, color: "var(--crit)" }}>{sum.rejected}</div></div>
          <div style={tile}><div style={lbl}>Stale (&gt;7d)</div><div style={{ fontSize: 26, fontWeight: 800, color: sum.stale ? "var(--crit)" : "var(--muted)" }}>{sum.stale}</div></div>
        </div>
      )}

      {showForm && writable && (
        <div style={{ ...card, padding: 18, marginBottom: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            <div><span style={lbl}>Shade name *</span><input style={inp} value={form.shade_name} onChange={(e) => setForm({ ...form, shade_name: e.target.value })} placeholder="e.g. Royal Navy" /></div>
            <div><span style={lbl}>Shade code</span><input style={inp} value={form.shade_code} onChange={(e) => setForm({ ...form, shade_code: e.target.value })} /></div>
            <div><span style={lbl}>Colour</span><div style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="color" value={form.hex} onChange={(e) => setForm({ ...form, hex: e.target.value })} style={{ width: 40, height: 36, border: "1px solid var(--border)", borderRadius: 6, background: "none" }} /><input style={inp} value={form.hex} onChange={(e) => setForm({ ...form, hex: e.target.value })} /></div></div>
            <div><span style={lbl}>Customer</span><input style={inp} value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
            <div><span style={lbl}>Fabric</span><input style={inp} value={form.fabric_type} onChange={(e) => setForm({ ...form, fabric_type: e.target.value })} /></div>
            <div><span style={lbl}>Sample ref (courier)</span><input style={inp} value={form.sample_ref} onChange={(e) => setForm({ ...form, sample_ref: e.target.value })} /></div>
            <div><span style={lbl}>Sales order no</span><input style={inp} value={form.so_number} onChange={(e) => setForm({ ...form, so_number: e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1" }}><span style={lbl}>Notes</span><input style={inp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 14 }}><button style={btn("var(--green)", "var(--on-green)", "var(--green)")} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Log sample as SENT"}</button></div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {["", "SENT", "APPROVED", "REJECTED"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={btn(filter === f ? "var(--surface-2)" : "transparent", filter === f ? "var(--text)" : "var(--muted)", "var(--border)")}>{f || "All"}</button>
        ))}
      </div>

      <div style={{ ...card, overflow: "hidden" }}>
        {state === "loading" && <div style={{ padding: 22, color: "var(--muted)" }}>Loading…</div>}
        {state === "error" && <div style={{ padding: 22, color: "var(--crit)" }}>Couldn't load shade approvals.</div>}
        {state === "ok" && rows.length === 0 && <div style={{ padding: 22, color: "var(--muted)" }}>No shade samples logged yet.</div>}
        {state === "ok" && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
              <thead><tr>
                <th style={th}>No.</th><th style={th}>Shade</th><th style={th}>Customer</th><th style={th}>Fabric</th>
                <th style={th}>Sent</th><th style={th}>Status</th><th style={th}>SO</th><th style={{ ...th, textAlign: "right" }}>Action</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.approval_id}>
                    <td style={{ ...td, fontFamily: "var(--mono)", fontSize: 12 }}>{r.approval_number}</td>
                    <td style={td}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 15, height: 15, borderRadius: 4, border: "1px solid var(--border)", background: r.hex || "transparent", flexShrink: 0 }} />
                        <b>{r.shade_name}</b>{r.shade_code ? <span style={{ color: "var(--faint)", fontSize: 11 }}>({r.shade_code})</span> : null}
                      </span>
                    </td>
                    <td style={td}>{r.customer_name || "—"}</td>
                    <td style={td}>{r.fabric_type || "—"}</td>
                    <td style={td}>{day(r.sent_date)}</td>
                    <td style={{ ...td, fontWeight: 700, color: STATUS_TONE[r.status] || "var(--text)" }}>{r.status}{r.decided_date ? <span style={{ fontWeight: 400, color: "var(--faint)", fontSize: 11 }}> · {day(r.decided_date)}</span> : null}</td>
                    <td style={td}>{r.so_number || "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {writable && (r.status === "SENT" || r.status === "RESENT") ? (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button style={btn("var(--green-dim)", "var(--green-deep)", "var(--green-edge)")} onClick={() => decide(r.approval_id, "APPROVED")}>Approve</button>
                          <button style={btn("var(--crit-dim)", "var(--crit)", "var(--crit-edge)")} onClick={() => decide(r.approval_id, "REJECTED")}>Reject</button>
                        </span>
                      ) : <span style={{ color: "var(--faint)", fontSize: 12 }}>{r.decided_by || "—"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
