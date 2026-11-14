// AI Import Intake (spec §34) — drop shipment PDFs, AI classifies + extracts +
// reconciles into a DRAFT proposal, you review/correct, then approve to create the
// import. Nothing is created or posted until you click Approve. Dates DD-MM-YYYY.

import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}`, "Content-Type": "application/json" });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { width: "100%", padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 13, boxSizing: "border-box" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "9px 18px", fontWeight: 700, fontSize: 13, cursor: "pointer" });

// Editable import fields, in display order.
const EDIT_FIELDS = [
  ["commercial_invoice_number", "Commercial invoice #"], ["proforma_invoice_number", "Proforma invoice #"],
  ["invoice_date", "Invoice date (YYYY-MM-DD)"], ["incoterm", "Incoterm"], ["currency", "Currency"],
  ["invoice_value", "CIF value"], ["unit_price", "Unit price"], ["quantity", "Quantity (kg)"],
  ["goods_description", "Goods"], ["hs_code", "HS code"], ["country_of_origin", "Origin"],
  ["bl_number", "BL number"], ["vessel_name", "Vessel"], ["voyage_no", "Voyage"], ["container_no", "Container"],
  ["port_of_loading", "Port of loading"], ["port_of_discharge", "Port of discharge"], ["final_destination", "Final destination"],
  ["etd", "ETD (YYYY-MM-DD)"],
];

const readFileB64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = rej; r.readAsDataURL(file);
});

export default function ImportIntake() {
  const nav = useNavigate();
  const [files, setFiles] = useState([]);          // [{file_name, file_data}]
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [fields, setFields] = useState({});
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [xr, setXr] = useState("");
  const [advance, setAdvance] = useState("");
  const [partners, setPartners] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/erp/partners?limit=1000`, { headers: auth() }).then(r => r.json()).then(d => setPartners(Array.isArray(d) ? d : (d.data || d.partners || d.rows || []))).catch(() => {});
    fetch(`${API}/api/erp/warehouses`, { headers: auth() }).then(r => r.json()).then(d => setWarehouses(Array.isArray(d) ? d : (d.warehouses || d.rows || []))).catch(() => {});
  }, []);

  const onPick = async (e) => {
    const picked = Array.from(e.target.files || []);
    const out = [];
    for (const f of picked) out.push({ file_name: f.name, file_data: await readFileB64(f) });
    setFiles(out); setProposal(null); setDone(null); setErr("");
  };

  const analyze = useCallback(async () => {
    if (!files.length) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/imports/ai/analyze-docs`, { method: "POST", headers: auth(), body: JSON.stringify({ files }) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || "Analysis failed");
      setProposal(p);
      setFields({ ...p.import_fields });
      setSupplierId(p.suggested_supplier_id || "");
      setAdvance(p.advance_amount != null ? String(p.advance_amount) : "");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }, [files]);

  const apply = async () => {
    if (!supplierId) return setErr("Select the supplier before creating.");
    setBusy(true); setErr("");
    try {
      // Attach each file's classified doc_type from the proposal.
      const documents = files.map(f => {
        const d = proposal.documents.find(x => x.file_name === f.file_name);
        return { file_name: f.file_name, doc_type: d && d.doc_type !== "OTHER" ? d.doc_type : "OTHER", file_data: f.file_data };
      }).filter(d => d.doc_type !== "OTHER");
      const body = { fields, supplier_id: Number(supplierId), warehouse_id: warehouseId ? Number(warehouseId) : null,
        exchange_rate: xr ? Number(xr) : 0, advance_amount: advance ? Number(advance) : 0, documents };
      const r = await fetch(`${API}/api/imports/ai/apply`, { method: "POST", headers: auth(), body: JSON.stringify(body) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || "Create failed");
      setDone(out);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const sevColor = { high: "var(--crit)", medium: "var(--gold-2)", low: "var(--muted)" };

  return (
    <div style={{ padding: 20, color: "var(--text)", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
      <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase" }}>🤖 AI Import Intake</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginTop: -8 }}>Drop the PI / invoice / packing list / BL / CO / insurance PDFs. AI classifies and extracts them into a draft — you review and approve before anything is created. Nothing is posted to Busy.</div>

      {/* Upload */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <input type="file" accept="application/pdf" multiple onChange={onPick} style={{ color: "var(--muted)", fontSize: 13 }} />
        <button onClick={analyze} disabled={!files.length || busy} style={{ ...btn("var(--yellow)", "#000"), opacity: (!files.length || busy) ? 0.5 : 1 }}>{busy && !proposal ? "Analyzing…" : `Analyze ${files.length || ""} doc(s)`}</button>
        {err && <span style={{ color: "var(--crit)", fontSize: 13 }}>{err}</span>}
      </div>

      {done && (
        <div style={{ ...card, borderColor: "var(--green)" }}>
          <div style={{ color: "var(--green)", fontWeight: 700, marginBottom: 6 }}>✓ Created {done.import_no}</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{done.documents} document(s) attached · shipment {done.shipment ? "✓" : "—"} · costing {done.costing ? "✓" : "—"} · advance {done.advance ? "✓" : "—"}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{done.note}</div>
          <button onClick={() => nav(`/imports/${done.import_id}`)} style={{ ...btn("var(--yellow)", "#000"), marginTop: 12 }}>Open {done.import_no} →</button>
        </div>
      )}

      {proposal && !done && (
        <>
          {/* Classified documents */}
          <div style={card}>
            <div style={{ ...label, marginBottom: 8 }}>Documents · {proposal.documents.length}</div>
            {proposal.documents.map((d, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                <span>{d.ok ? "✅" : "⚠️"} <b>{d.doc_type}</b> — {d.file_name}</span>
                <span style={{ color: "var(--muted)", fontSize: 11 }}>{d.ok ? (d.read_by || "") : d.error}</span>
              </div>
            ))}
          </div>

          {/* Reconciliation flags */}
          {proposal.reconciliation.length > 0 && (
            <div style={{ ...card, borderColor: "var(--gold-2)" }}>
              <div style={{ ...label, marginBottom: 8, color: "var(--gold-2)" }}>⚠ Cross-document checks</div>
              {proposal.reconciliation.map((r, i) => <div key={i} style={{ fontSize: 13, color: sevColor[r.level] || "var(--text)", padding: "2px 0" }}>• {r.message}</div>)}
            </div>
          )}

          {/* Approvals: supplier, warehouse, rate, advance */}
          <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
            <div>
              <div style={{ ...label, fontSize: 10, marginBottom: 3 }}>Supplier (partner) *</div>
              <select style={inp} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">— select —</option>
                {partners.map(p => <option key={p.partner_id} value={p.partner_id}>{p.company_name}</option>)}
              </select>
              {proposal.import_fields.supplier_name && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>AI read: {proposal.import_fields.supplier_name}</div>}
            </div>
            <div>
              <div style={{ ...label, fontSize: 10, marginBottom: 3 }}>Warehouse</div>
              <select style={inp} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                <option value="">—</option>
                {warehouses.map(w => <option key={w.warehouse_id} value={w.warehouse_id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ ...label, fontSize: 10, marginBottom: 3 }}>Exchange rate (₹/{fields.currency || "USD"})</div>
              <input style={inp} value={xr} onChange={e => setXr(e.target.value)} placeholder="e.g. 88.5 (for costing)" />
            </div>
            <div>
              <div style={{ ...label, fontSize: 10, marginBottom: 3 }}>Advance paid ({fields.currency || "USD"})</div>
              <input style={inp} value={advance} onChange={e => setAdvance(e.target.value)} placeholder="from PI / down payment" />
            </div>
          </div>

          {/* Editable extracted fields */}
          <div style={card}>
            <div style={{ ...label, marginBottom: 10 }}>Extracted fields — review & correct</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10 }}>
              {EDIT_FIELDS.map(([k, lb]) => (
                <div key={k}>
                  <div style={{ ...label, fontSize: 10, marginBottom: 3 }}>{lb}{proposal.field_sources[k] ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {proposal.field_sources[k].replace(/_/g, " ").toLowerCase()}</span> : ""}</div>
                  <input style={inp} value={fields[k] ?? ""} onChange={e => setFields({ ...fields, [k]: e.target.value })} />
                </div>
              ))}
            </div>
          </div>

          {/* Draft entries */}
          {proposal.draft_entries.length > 0 && (
            <div style={card}>
              <div style={{ ...label, marginBottom: 8 }}>Draft entries (not posted)</div>
              {proposal.draft_entries.map((e, i) => (
                <div key={i} style={{ fontSize: 13, padding: "4px 0" }}>• <b>{e.kind.replace(/_/g, " ")}</b> — {e.amount != null ? `${e.currency || ""} ${e.amount}` : ""}{e.cif_value != null ? `${e.currency || ""} ${e.cif_value} (${e.incoterm})` : ""} <span style={{ color: "var(--muted)" }}>· {e.basis}</span></div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setProposal(null); setFiles([]); }} style={btn("var(--bg)", "var(--text)")}>Discard</button>
            <button onClick={apply} disabled={busy} style={{ ...btn("var(--yellow)", "#000"), opacity: busy ? 0.5 : 1 }}>{busy ? "Creating…" : "Approve & Create Import"}</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{proposal.disclaimer}</div>
        </>
      )}
    </div>
  );
}
