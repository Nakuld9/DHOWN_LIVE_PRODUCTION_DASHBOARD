// Job-work Reconciliation — greige sent to the dye house / finisher vs what came
// back. For each challan: sent, received, rejected, and the balance (still at the
// vendor for open challans, or process loss once closed). Rolls up per vendor so
// you can see who is holding your material and where weight is being lost.

import React, { useState, useEffect, useMemo, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const input = { padding: "7px 10px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 };
const th = { padding: "8px 6px", textAlign: "left", color: "var(--muted)", fontSize: 12, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const td = { padding: "6px", fontSize: 13, borderBottom: "1px solid var(--surface)", whiteSpace: "nowrap" };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB").split("/").join("-") : "—");
const kg = (n) => (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
const OPEN = ["SENT", "PARTIALLY_RECEIVED"];

async function readJson(r) { const t = await r.text(); try { return JSON.parse(t); } catch { throw new Error(r.ok ? "Bad response" : `Error ${r.status}`); } }

export default function JobworkReconciliation() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ vendor: "", job: "", status: "", overdue: false, q: "" });

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/subcontract/party-report`, { headers: auth() });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error || "Failed to load");
      setRows(j);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Derive reconciliation figures per challan.
  const recon = useMemo(() => rows.map((c) => {
    const sent = Number(c.sent_weight_kg) || 0;
    const received = Number(c.total_received_kg) || 0;
    const rejected = Number(c.total_rejected_kg) || 0;
    const open = OPEN.includes(c.status);
    const balance = Math.max(0, +(sent - received - rejected).toFixed(2)); // at vendor (open) or loss (closed)
    const lossPct = sent > 0 ? +(balance / sent * 100).toFixed(1) : 0;
    return { ...c, sent, received, rejected, open, balance, lossPct };
  }), [rows]);

  const vendors = useMemo(() => [...new Set(recon.map((c) => c.vendor_name).filter(Boolean))].sort(), [recon]);
  const jobs = useMemo(() => [...new Set(recon.map((c) => c.job_type).filter(Boolean))].sort(), [recon]);

  const filtered = useMemo(() => recon.filter((c) =>
    (!f.vendor || c.vendor_name === f.vendor) &&
    (!f.job || c.job_type === f.job) &&
    (!f.status || c.status === f.status) &&
    (!f.overdue || c.is_overdue) &&
    (!f.q || `${c.challan_number} ${c.vendor_name} ${c.fabric_type || ""} ${c.color_name || ""}`.toLowerCase().includes(f.q.toLowerCase()))
  ), [recon, f]);

  const totals = useMemo(() => filtered.reduce((a, c) => ({
    sent: a.sent + c.sent, received: a.received + c.received, rejected: a.rejected + c.rejected,
    atVendor: a.atVendor + (c.open ? c.balance : 0), loss: a.loss + (!c.open ? c.balance : 0),
    overdue: a.overdue + (c.is_overdue ? 1 : 0),
  }), { sent: 0, received: 0, rejected: 0, atVendor: 0, loss: 0, overdue: 0 }), [filtered]);

  // Per-vendor rollup.
  const byVendor = useMemo(() => {
    const m = {};
    for (const c of filtered) {
      const v = m[c.vendor_name] || (m[c.vendor_name] = { vendor: c.vendor_name, challans: 0, sent: 0, received: 0, atVendor: 0, loss: 0, closedSent: 0, overdue: 0 });
      v.challans++; v.sent += c.sent; v.received += c.received;
      if (c.open) v.atVendor += c.balance; else { v.loss += c.balance; v.closedSent += c.sent; }
      if (c.is_overdue) v.overdue++;
    }
    return Object.values(m).map((v) => ({ ...v, lossPct: v.closedSent > 0 ? +(v.loss / v.closedSent * 100).toFixed(1) : 0 }))
      .sort((a, b) => b.atVendor - a.atVendor);
  }, [filtered]);

  const Stat = ({ label, value, color }) => (
    <div style={{ ...card, flex: 1, minWidth: 130 }}>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "var(--text)", marginTop: 4 }}>{value}</div>
    </div>
  );

  return (
    <div style={{ padding: 20, color: "var(--text)", maxWidth: 1200, margin: "0 auto" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Job-work Reconciliation</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Greige sent to the dye house / finisher vs received back. Balance = still at the vendor (open challans) or process loss (closed).
      </div>

      {err && <div style={{ ...card, borderColor: "var(--crit)", color: "var(--crit-edge)", marginBottom: 16 }}>{err}</div>}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="Sent (kg)" value={kg(totals.sent)} />
        <Stat label="Received (kg)" value={kg(totals.received)} color="var(--green)" />
        <Stat label="At vendor (kg)" value={kg(totals.atVendor)} color="var(--gold)" />
        <Stat label="Process loss (kg)" value={kg(totals.loss)} color="var(--yellow)" />
        <Stat label="Overdue challans" value={totals.overdue} color={totals.overdue ? "var(--crit)" : "var(--green)"} />
      </div>

      {/* Filters */}
      <div style={{ ...card, marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...input, width: 200 }} placeholder="Search challan / vendor / fabric…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select style={input} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })}><option value="">All vendors</option>{vendors.map((v) => <option key={v}>{v}</option>)}</select>
        <select style={input} value={f.job} onChange={(e) => setF({ ...f, job: e.target.value })}><option value="">All jobs</option>{jobs.map((j) => <option key={j}>{j}</option>)}</select>
        <select style={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All statuses</option>{["SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].map((s) => <option key={s}>{s}</option>)}</select>
        <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} />Overdue only</label>
      </div>

      {/* Per-vendor rollup */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ color: "var(--yellow)", fontWeight: 700, marginBottom: 8 }}>By vendor</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Vendor</th><th style={th}>Challans</th><th style={th}>Sent</th><th style={th}>Received</th>
              <th style={th}>At vendor</th><th style={th}>Loss</th><th style={th}>Loss %</th><th style={th}>Overdue</th>
            </tr></thead>
            <tbody>
              {byVendor.map((v) => (
                <tr key={v.vendor}>
                  <td style={td}>{v.vendor}</td><td style={td}>{v.challans}</td>
                  <td style={td}>{kg(v.sent)}</td><td style={{ ...td, color: "var(--green)" }}>{kg(v.received)}</td>
                  <td style={{ ...td, color: v.atVendor > 0 ? "var(--gold)" : "var(--muted)" }}>{kg(v.atVendor)}</td>
                  <td style={{ ...td, color: "var(--yellow)" }}>{kg(v.loss)}</td>
                  <td style={td}>{v.lossPct}%</td>
                  <td style={{ ...td, color: v.overdue ? "var(--crit)" : "var(--muted)" }}>{v.overdue || "—"}</td>
                </tr>
              ))}
              {byVendor.length === 0 && <tr><td style={td} colSpan={8}>No job-work challans match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-challan detail */}
      <div style={{ ...card }}>
        <div style={{ color: "var(--yellow)", fontWeight: 700, marginBottom: 8 }}>Challans ({filtered.length})</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Challan</th><th style={th}>Vendor</th><th style={th}>Job</th><th style={th}>Fabric</th>
              <th style={th}>Sent</th><th style={th}>Due</th><th style={th}>Sent kg</th><th style={th}>Recv</th>
              <th style={th}>Rej</th><th style={th}>Balance</th><th style={th}>Loss%</th><th style={th}>Status</th><th style={th}>Days out</th>
            </tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.challan_id} style={c.is_overdue ? { background: "var(--crit-dim)" } : undefined}>
                  <td style={td}>{c.challan_number}</td>
                  <td style={td}>{c.vendor_name}</td>
                  <td style={td}>{c.job_type}</td>
                  <td style={td}>{[c.fabric_type, c.color_name].filter(Boolean).join(" ") || "—"}</td>
                  <td style={td}>{fmtDate(c.sent_date)}</td>
                  <td style={{ ...td, color: c.is_overdue ? "var(--crit)" : "var(--text)" }}>{fmtDate(c.expected_return_date)}</td>
                  <td style={td}>{kg(c.sent)}</td>
                  <td style={{ ...td, color: "var(--green)" }}>{kg(c.received)}</td>
                  <td style={td}>{c.rejected ? kg(c.rejected) : "—"}</td>
                  <td style={{ ...td, color: c.open ? "var(--gold)" : "var(--yellow)", fontWeight: 600 }}>{kg(c.balance)}</td>
                  <td style={td}>{c.lossPct}%</td>
                  <td style={td}>{c.status}{c.is_overdue ? " ⚠" : ""}</td>
                  <td style={td}>{c.days_out}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td style={td} colSpan={13}>No challans match the filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
