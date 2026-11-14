// Import Control Tower — KPIs + filterable, server-paginated shipment table + a
// create-import modal (CIF is the default Incoterm). Partial shipments are shown
// via the shipments count; ordered/shipped/pending live on the detail page.

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ExceptionRow } from "./ImportDetail";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
// Import trade is transacted in USD (CIF invoices) — the Control Tower shows USD.
const USD = (n) => "USD " + Math.round(Number(n) || 0).toLocaleString("en-US");

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", fontSize: 13, borderTop: "1px solid var(--border)", whiteSpace: "nowrap" };
const inp = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", fontSize: 13 };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" });

const STATUS_COLOR = {
  PLANNED: "var(--muted)", BOOKED: "var(--muted)", LOADED: "var(--gold)", IN_TRANSIT: "var(--gold)",
  AT_TRANSSHIPMENT: "var(--gold)", ARRIVED_PORT: "var(--gold)", CUSTOMS: "var(--idle)",
  RELEASED: "var(--green)", INLAND_TRANSIT: "var(--green)", WAREHOUSE: "var(--green)",
  GRN_COMPLETED: "var(--green)", CLOSED: "var(--muted)",
};

// Statuses from port arrival onward — a past ETA for these means "arrived", not overdue.
const ARRIVED_PLUS = new Set(["ARRIVED_PORT", "CUSTOMS", "RELEASED", "INLAND_TRANSIT", "WAREHOUSE", "GRN_COMPLETED", "CLOSED"]);
// Days-to-ETA cell: never show a bare negative. Future → "Nd"; past-ETA but already
// at/after port → "arrived"; past-ETA and still in transit → "overdue".
function daysCell(r) {
  const d = r.days_remaining;
  if (d == null) return <span style={{ color: "var(--muted)" }}>—</span>;
  if (Number(d) >= 0) return <span>{d}d</span>;
  if (ARRIVED_PLUS.has(r.status)) return <span style={{ color: "var(--green)" }}>arrived</span>;
  return <span style={{ color: "var(--gold-2)" }}>overdue</span>;
}

const KPI_DEFS = [
  ["total", "Total imports", "var(--muted)"], ["in_transit", "In transit", "var(--gold)"],
  ["at_port", "At port", "var(--gold)"], ["customs_pending", "Customs pending", "var(--idle)"],
  ["released", "Released", "var(--green)"], ["delivered", "Delivered", "var(--green)"],
  ["delayed", "Delayed", "var(--crit)"], ["critical", "Critical", "var(--crit)"],
  ["expected_this_week", "Due this week", "var(--purple)"], ["expected_this_month", "Due this month", "var(--purple)"],
];

export default function ImportControlTower() {
  const nav = useNavigate();
  const [kpis, setKpis] = useState(null);
  const [excSummary, setExcSummary] = useState(null);
  const [exc, setExc] = useState([]);
  const [shortage, setShortage] = useState(null);
  const [data, setData] = useState({ rows: [], total: 0, limit: 25, offset: 0 });
  const [filters, setFilters] = useState({ search: "", status: "", delayed: false });
  const [offset, setOffset] = useState(0);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const q = new URLSearchParams({ limit: "25", offset: String(offset), active: "true" });
      if (filters.search) q.set("search", filters.search);
      if (filters.status) q.set("status", filters.status);
      if (filters.delayed) q.set("delayed", "true");
      const [k, l, e, sh] = await Promise.all([
        fetch(`${API}/api/imports/control-tower`, { headers: auth() }),
        fetch(`${API}/api/imports?${q}`, { headers: auth() }),
        fetch(`${API}/api/imports/exceptions`, { headers: auth() }).catch(() => null),
        fetch(`${API}/api/imports/shortage-analysis`, { headers: auth() }).catch(() => null),
      ]);
      if (k.ok) { const ct = await k.json(); setKpis(ct.kpis); setExcSummary(ct.exceptions); }
      if (!l.ok) throw new Error((await l.json()).error || `Failed (${l.status})`);
      setData(await l.json());
      if (e && e.ok) setExc(await e.json());
      if (sh && sh.ok) setShortage(await sh.json());
    } catch (e) { setErr(e.message); }
  }, [offset, filters]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.ceil((data.total || 0) / (data.limit || 25));
  const page = Math.floor(offset / (data.limit || 25)) + 1;

  return (
    <div style={{ padding: 20, color: "var(--text)", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase" }}>🌐 Import Control Tower</h2>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Every imported shipment PO → CIF → vessel → customs → Ludhiana → GRN. Live from PostgreSQL.</div>
        </div>
        <button style={btn("var(--yellow)", "#000")} onClick={() => setShowCreate(true)}>+ New Import</button>
      </div>

      {err && <div style={{ ...card, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}

      {/* KPIs */}
      {kpis && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
          {KPI_DEFS.map(([key, title, color]) => (
            <div key={key} style={{ ...card, padding: 12 }}>
              <div style={label}>{title}</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: (key === "delayed" || key === "critical") && kpis[key] > 0 ? color : "var(--text)", fontVariantNumeric: "tabular-nums" }}>{kpis[key] ?? 0}</div>
            </div>
          ))}
          <div style={{ ...card, padding: 12 }}>
            <div style={label}>CIF value in transit</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 6 }}>{USD(kpis.cif_value_in_transit)}</div>
          </div>
          {excSummary && (
            <div style={{ ...card, padding: 12 }}>
              <div style={label}>Open exceptions</div>
              <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: excSummary.critical > 0 ? "var(--crit)" : excSummary.high > 0 ? "var(--idle)" : "var(--text)" }}>{excSummary.open}</div>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>{excSummary.critical} critical · {excSummary.high} high</div>
            </div>
          )}
        </div>
      )}

      {/* Exceptions panel */}
      {exc.length > 0 && (
        <div style={{ ...card, borderColor: exc.some(e => e.severity === "CRITICAL") ? "var(--crit-dim)" : "var(--crit-dim)" }}>
          <div style={{ ...label, fontSize: 13, marginBottom: 10 }}>⚠ Import exceptions needing attention</div>
          {exc.slice(0, 12).map(e => (
            <ExceptionRow key={e.exception_id} e={e} onStatus={async (excId, status, resolution) => {
              const r = await fetch(`${API}/api/imports/exceptions/${excId}`, { method: "PATCH", headers: jsonH(), body: JSON.stringify({ status, resolution }) });
              if (r.ok) load();
            }} />
          ))}
        </div>
      )}

      {/* Material shortage risk (AI analysis — never auto-purchases) */}
      {shortage && shortage.materials?.length > 0 && (
        <div style={card}>
          <div style={{ ...label, fontSize: 13, marginBottom: 4 }}>📦 Material shortage analysis {shortage.at_risk > 0 ? <span style={{ color: "var(--crit)" }}>· {shortage.at_risk} at risk</span> : ""}</div>
          <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 10 }}>Analysis & recommendations only — the system never places a PO or changes stock.</div>
          {shortage.materials.map(m => (
            <div key={m.material.id} style={{ borderLeft: `3px solid ${m.shortage.is_shortage ? "var(--crit)" : "var(--green)"}`, background: "var(--bg)", borderRadius: 6, padding: "8px 12px", marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 13 }}>{m.material.name}</b>
                <span style={{ fontSize: 12, color: m.shortage.is_shortage ? "var(--crit)" : "var(--muted)" }}>
                  stock {m.current_stock.value} kg · {m.avg_daily_consumption.value != null ? `~${m.avg_daily_consumption.value}/day · cover ${m.days_of_cover ?? "—"}d` : "consumption unknown"} · incoming {m.incoming_total} kg
                </span>
              </div>
              {m.shortage.is_shortage && <div style={{ color: "var(--gold-2)", fontSize: 12, marginTop: 3 }}>{m.shortage.reasons.join(" ")}</div>}
              {m.considerations?.length > 0 && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>Consider: {m.considerations.join(" · ")}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input style={{ ...inp, flex: 1, minWidth: 220 }} placeholder="Search import #, BL, booking, invoice…"
          value={filters.search} onChange={e => { setOffset(0); setFilters(f => ({ ...f, search: e.target.value })); }} />
        <select style={inp} value={filters.status} onChange={e => { setOffset(0); setFilters(f => ({ ...f, status: e.target.value })); }}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_COLOR).map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "var(--muted)" }}>
          <input type="checkbox" checked={filters.delayed} onChange={e => { setOffset(0); setFilters(f => ({ ...f, delayed: e.target.checked })); }} /> Delayed only
        </label>
      </div>

      {/* Table */}
      <div style={{ ...card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead><tr>
            {["Import", "PI / Date", "PO", "Supplier", "Material", "Qty", "CIF Value", "Incoterm", "ETD", "ETA", "Days", "Delay", "Ship.", "Status"].map(h => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {!data.rows.length && <tr><td colSpan={14} style={{ ...td, color: "var(--muted)" }}>No imports match.</td></tr>}
            {data.rows.map(r => (
              <tr key={r.import_id} style={{ cursor: "pointer" }} onClick={() => nav(`/imports/${r.import_id}`)}>
                <td style={{ ...td, fontWeight: 700 }}>{r.import_no}</td>
                <td style={td}>
                  <div>{r.proforma_invoice_number || r.commercial_invoice_number || "—"}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.invoice_date ? new Date(r.invoice_date).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }).replace(/\//g, "-") : "—"}</div>
                </td>
                <td style={td}>{r.po_number || "—"}</td>
                <td style={td}>{r.supplier || "—"}</td>
                <td style={td}>{r.material || "—"}</td>
                <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Number(r.quantity) || 0} {r.unit}</td>
                <td style={{ ...td, textAlign: "right" }}>{r.currency} {Math.round(Number(r.invoice_value) || 0).toLocaleString()}</td>
                <td style={td}>{r.incoterm}</td>
                <td style={td}>{r.etd ? new Date(r.etd).toLocaleDateString("en-GB").replace(/\//g, "-") : "—"}</td>
                <td style={td}>{r.current_eta ? new Date(r.current_eta).toLocaleDateString("en-GB").replace(/\//g, "-") : "—"}</td>
                <td style={{ ...td, textAlign: "right" }}>{daysCell(r)}</td>
                <td style={{ ...td, textAlign: "right", color: Number(r.delay_days) > 0 ? "var(--gold-2)" : "var(--muted)" }}>{Number(r.delay_days) > 0 ? `+${r.delay_days}d` : "—"}</td>
                <td style={{ ...td, textAlign: "right" }}>{r.shipments}</td>
                <td style={td}><span style={{ color: STATUS_COLOR[r.status] || "var(--text)", fontWeight: 600, fontSize: 12 }}>{String(r.status).replace(/_/g, " ")}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, color: "var(--muted)", fontSize: 12 }}>
          <span>{data.total} import(s) · page {page}/{pages || 1}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button style={btn("var(--bg)", "var(--text)")} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Prev</button>
            <button style={btn("var(--bg)", "var(--text)")} disabled={page >= pages} onClick={() => setOffset(offset + 25)}>Next</button>
          </span>
        </div>
      </div>

      {showCreate && <CreateImportModal onClose={() => setShowCreate(false)} onCreated={(id) => { setShowCreate(false); nav(`/imports/${id}`); }} />}
    </div>
  );
}

function CreateImportModal({ onClose, onCreated }) {
  const [suppliers, setSuppliers] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [pos, setPos] = useState([]);
  const [f, setF] = useState({ incoterm: "CIF", currency: "USD", unit: "KG", priority: "NORMAL", final_destination: "Ludhiana" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const arr = (d) => d.data || d.items || d.rows || (Array.isArray(d) ? d : []);
    fetch(`${API}/api/erp/partners`, { headers: auth() }).then(r => r.json()).then(d => setSuppliers(arr(d))).catch(() => {});
    fetch(`${API}/api/erp/items`, { headers: auth() }).then(r => r.json()).then(d => setMaterials(arr(d))).catch(() => {});
    fetch(`${API}/api/purchase-orders`, { headers: auth() }).then(r => r.json()).then(d => setPos(arr(d))).catch(() => {});
  }, []);

  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const submit = async () => {
    if (!f.supplier_id) { setErr("Select a supplier."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/imports`, { method: "POST", headers: jsonH(), body: JSON.stringify(f) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      onCreated(j.import.import_id);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const F = ({ k, label: lb, type = "text" }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...label, fontSize: 10 }}>{lb}</span>
      <input style={inp} type={type} value={f[k] || ""} onChange={e => set(k, e.target.value)} />
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 1000, overflowY: "auto" }} onClick={onClose}>
      <div style={{ ...card, width: 720, maxWidth: "100%" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 12px" }}>New Import <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 400 }}>· default Incoterm CIF</span></h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ ...label, fontSize: 10 }}>Supplier *</span>
            <select style={inp} value={f.supplier_id || ""} onChange={e => set("supplier_id", e.target.value)}>
              <option value="">Select…</option>
              {suppliers.map(s => <option key={s.partner_id} value={s.partner_id}>{s.company_name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ ...label, fontSize: 10 }}>Material</span>
            <select style={inp} value={f.material_id || ""} onChange={e => set("material_id", e.target.value)}>
              <option value="">Select…</option>
              {materials.map(m => <option key={m.item_id} value={m.item_id}>{m.item_name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ ...label, fontSize: 10 }}>Purchase Order</span>
            <select style={inp} value={f.purchase_order_id || ""} onChange={e => set("purchase_order_id", e.target.value)}>
              <option value="">None</option>
              {pos.map(p => <option key={p.po_id} value={p.po_id}>{p.po_number}</option>)}
            </select>
          </div>
          <F k="quantity" label="Quantity" type="number" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ ...label, fontSize: 10 }}>Unit</span>
            <select style={inp} value={f.unit} onChange={e => set("unit", e.target.value)}>{["KG", "MT", "PCS", "M"].map(u => <option key={u}>{u}</option>)}</select>
          </div>
          <F k="unit_price" label="Unit price" type="number" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ ...label, fontSize: 10 }}>Currency</span>
            <select style={inp} value={f.currency} onChange={e => set("currency", e.target.value)}>{["USD", "EUR", "CNY", "GBP", "INR"].map(c => <option key={c}>{c}</option>)}</select>
          </div>
          <F k="exchange_rate" label="Exchange rate → INR" type="number" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ ...label, fontSize: 10 }}>Incoterm</span>
            <select style={inp} value={f.incoterm} onChange={e => set("incoterm", e.target.value)}>{["CIF", "CFR", "FOB", "EXW", "DDP", "DAP", "CIP", "FCA", "CPT"].map(i => <option key={i}>{i}</option>)}</select>
          </div>
          <F k="commercial_invoice_number" label="Commercial invoice #" />
          <F k="proforma_invoice_number" label="Proforma invoice #" />
          <F k="country_of_origin" label="Country of origin" />
          <F k="port_of_loading" label="Port of loading" />
          <F k="port_of_discharge" label="Port of discharge" />
          <F k="shipping_line" label="Shipping line" />
          <F k="bl_number" label="BL number" />
          <F k="etd" label="ETD" type="date" />
          <F k="original_eta" label="ETA" type="date" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ ...label, fontSize: 10 }}>Priority</span>
            <select style={inp} value={f.priority} onChange={e => set("priority", e.target.value)}>{["LOW", "NORMAL", "HIGH", "CRITICAL"].map(p => <option key={p}>{p}</option>)}</select>
          </div>
        </div>
        {err && <div style={{ color: "var(--crit)", fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
          <button style={btn("var(--bg)", "var(--text)")} onClick={onClose}>Cancel</button>
          <button style={btn("var(--yellow)", "#000")} disabled={busy} onClick={submit}>{busy ? "Creating…" : "Create import"}</button>
        </div>
      </div>
    </div>
  );
}
