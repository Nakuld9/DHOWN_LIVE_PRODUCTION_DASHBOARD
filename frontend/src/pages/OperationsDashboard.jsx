// Operations Dashboard — one cross-domain view of the mill: production, machines,
// quality, inventory, orders/purchase, and yarn shortfall, plus a live machine
// board. Attention items (overdue, shortfall, rejects) show red.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const kg = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const Tile = ({ label, value, sub, alert }) => (
  <div style={{ ...card, padding: "13px 16px", borderColor: alert ? "var(--crit-dim)" : "var(--surface)" }}>
    <div style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    <div style={{ color: alert ? "var(--crit)" : "var(--yellow)", fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}</div>
    {sub && <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>{sub}</div>}
  </div>
);

const Section = ({ title, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px 2px" }}>{title}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>{children}</div>
  </div>
);

const machStatus = (m) => {
  const dc = String(m.dc_status || "").toLowerCase();
  if (dc !== "online") return "OFFLINE";
  return Number(m.rpm || 0) > 0 ? "RUNNING" : "STOPPED";
};
const SC = { RUNNING: "var(--green)", STOPPED: "var(--gold)", OFFLINE: "var(--border)" };

export default function OperationsDashboard() {
  const [d, setD] = useState(null);
  const [machines, setMachines] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setErr(""); setLoading(true);
    try {
      const [ops, mc] = await Promise.all([
        fetch(`${API}/api/dashboard/operations`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/machines`, { headers: auth() }).then(r => r.ok ? r.json() : []),
      ]);
      if (ops.error) throw new Error(ops.error);
      setD(ops);
      setMachines(Array.isArray(mc) ? mc : (mc.machines || []));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Operations Dashboard</h2>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>The whole mill at a glance · refreshes every minute</div>
        </div>
        <button onClick={load} style={{ background: "var(--surface)", color: "var(--text)", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 13 }}>↻ Refresh</button>
      </div>

      {err && <div style={{ ...card, margin: "12px 0", borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}

      {loading && !d ? <div style={{ ...card, textAlign: "center", color: "var(--muted)", padding: 30, marginTop: 14 }}>Loading…</div> : d && (
        <div style={{ marginTop: 16 }}>
          <Section title="Production">
            <Tile label="Rolls today" value={d.production.rolls_today} />
            <Tile label="Knit today" value={`${kg(d.production.kg_today)} kg`} />
            <Tile label="Machines running" value={`${d.machines.running}/${d.machines.total}`} sub={`${d.machines.offline} offline`} alert={d.machines.total > 0 && d.machines.running === 0} />
            <Tile label="Reject % (30d)" value={`${d.quality.reject_pct}%`} sub={`${d.quality.inspected} inspected`} alert={d.quality.reject_pct > 5} />
          </Section>

          <Section title="Inventory & job-work">
            <Tile label="Yarn on hand" value={`${kg(d.inventory.yarn_kg)} kg`} />
            <Tile label="Greige" value={`${kg(d.inventory.greige_kg)} kg`} />
            <Tile label="Finished" value={`${kg(d.inventory.finished_kg)} kg`} />
            <Tile label="Low-stock yarns" value={d.inventory.low_stock_yarns} alert={d.inventory.low_stock_yarns > 0} />
            <Tile label="At job-worker" value={`${kg(d.inventory.at_vendor_kg)} kg`} sub={`${d.inventory.at_vendor_overdue} overdue`} alert={d.inventory.at_vendor_overdue > 0} />
          </Section>

          <Section title="Orders, purchase & planning">
            <Tile label="Open sales orders" value={d.orders.open} sub={`${d.orders.overdue} overdue`} alert={d.orders.overdue > 0} />
            <Tile label="Open POs" value={d.purchase.open} sub={`${d.purchase.overdue} overdue`} alert={d.purchase.overdue > 0} />
            <Tile label="Yarn short items" value={d.mrp.short_items} alert={d.mrp.short_items > 0} />
            <Tile label="Yarn shortfall" value={`${kg(d.mrp.shortfall_kg)} kg`} alert={d.mrp.shortfall_kg > 0} />
          </Section>

          {/* Live machine board */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px 2px" }}>Live machines</div>
            <div style={{ ...card }}>
              {!machines.length ? <div style={{ color: "var(--muted)", fontSize: 13 }}>No machines.</div> : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {machines.map(m => {
                    const s = machStatus(m);
                    return (
                      <div key={m.machine_id} title={`${m.machine_name || m.machine_id} · ${s}${m.rpm ? " · " + m.rpm + " rpm" : ""}`}
                        style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--surface)", border: `1px solid ${SC[s]}`, borderRadius: 7, padding: "7px 11px", fontSize: 12 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: SC[s] }} />
                        <span style={{ fontFamily: "monospace", color: "var(--text)" }}>{m.machine_id}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11, color: "var(--muted)" }}>
                {["RUNNING", "STOPPED", "OFFLINE"].map(s => (
                  <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: SC[s] }} />{s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
