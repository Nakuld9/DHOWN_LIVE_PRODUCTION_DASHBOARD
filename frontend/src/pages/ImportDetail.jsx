// Import detail — Overview (with ordered/shipped/pending rollup + status changer),
// Shipments & Containers (partial shipments allowed), Costing (CIF landed cost with
// double-count confirmation), and Timeline (status history + tracking events).

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const INR = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB").replace(/\//g, "-") : "—");
const dt = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-") : "—");

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const inp = { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", fontSize: 13 };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer" });
const STATUS_ORDER = ["PLANNED", "BOOKED", "LOADED", "IN_TRANSIT", "AT_TRANSSHIPMENT", "ARRIVED_PORT", "CUSTOMS", "RELEASED", "INLAND_TRANSIT", "WAREHOUSE", "GRN_COMPLETED", "CLOSED"];

export default function ImportDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [imp, setImp] = useState(null);
  const [tab, setTab] = useState("overview");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/imports/${id}`, { headers: auth() });
      if (!r.ok) throw new Error((await r.json()).error || `Failed (${r.status})`);
      setImp(await r.json());
    } catch (e) { setErr(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div style={{ padding: 20, color: "var(--crit)" }}>{err}</div>;
  if (!imp) return <div style={{ padding: 20, color: "var(--muted)" }}>Loading…</div>;
  const q = imp.quantities || {};

  const changeStatus = async (to) => {
    const override = STATUS_ORDER.indexOf(to) !== STATUS_ORDER.indexOf(imp.status) + 1 && STATUS_ORDER.indexOf(to) > STATUS_ORDER.indexOf(imp.status);
    const r = await fetch(`${API}/api/imports/${id}`, { method: "PATCH", headers: jsonH(), body: JSON.stringify({ status: to, override: true }) });
    const j = await r.json();
    if (!r.ok) alert(j.error || "Failed"); else load();
  };

  const tabs = ["overview", "shipments", "grn", "customs", "documents", "logistics", "payments", "costing", "exceptions", "timeline"];
  return (
    <div style={{ padding: 20, color: "var(--text)", display: "flex", flexDirection: "column", gap: 16 }}>
      <button style={{ ...btn("var(--bg)", "var(--muted)"), width: "fit-content" }} onClick={() => nav("/import-control-tower")}>← Control Tower</button>

      {/* Header */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 style={{ margin: "0 0 4px" }}>{imp.import_no} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>· {imp.incoterm}</span></h2>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{imp.supplier || "—"} · {imp.material || "—"} · PO {imp.po_number || "—"}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{imp.currency} {Math.round(Number(imp.invoice_value) || 0).toLocaleString()}</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>ETA {day(imp.current_eta)}{Number(imp.current_eta) > Number(imp.original_eta) ? " (delayed)" : ""}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <span style={label}>Status</span>
          <select style={inp} value={imp.status} onChange={e => changeStatus(e.target.value)}>
            {STATUS_ORDER.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <span style={{ ...label, marginLeft: 12 }}>Priority</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: imp.priority === "CRITICAL" ? "var(--crit)" : "var(--text)" }}>{imp.priority}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={btn(tab === t ? "var(--yellow)" : "var(--bg)", tab === t ? "#000" : "var(--muted)")}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <VesselStatusPanel imp={imp} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={card}>
            <div style={{ ...label, marginBottom: 10 }}>Quantities (partial shipments allowed)</div>
            {[["Ordered", q.ordered], ["Shipped", q.shipped], ["Received", q.received], ["Rejected", q.rejected], ["Pending", q.pending]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--muted)" }}>{k}</span><b>{Number(v) || 0} {imp.unit}</b>
              </div>
            ))}
            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>{q.note}</div>
          </div>
          <div style={card}>
            <div style={{ ...label, marginBottom: 10 }}>Shipment route</div>
            {[["Country of origin", imp.country_of_origin], ["Port of loading", imp.port_of_loading], ["Transshipment", imp.transshipment_port], ["Port of discharge", imp.port_of_discharge], ["Final destination", imp.final_destination], ["Shipping line", imp.shipping_line], ["BL number", imp.bl_number], ["ETD", day(imp.etd)], ["Original ETA", day(imp.original_eta)], ["Current ETA", day(imp.current_eta)]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
                <span style={{ color: "var(--muted)" }}>{k}</span><span>{v || "—"}</span>
              </div>
            ))}
          </div>
          </div>
        </div>
      )}

      {tab === "shipments" && <ShipmentsTab imp={imp} reload={load} />}
      {tab === "grn" && <GrnTab imp={imp} reload={load} />}
      {tab === "customs" && <CustomsTab id={id} />}
      {tab === "documents" && <DocumentsTab id={id} />}
      {tab === "logistics" && <LogisticsTab id={id} />}
      {tab === "exceptions" && <ExceptionsTab id={id} />}
      {tab === "payments" && <PaymentsTab id={id} imp={imp} reload={load} />}
      {tab === "costing" && <CostingTab id={id} incoterm={imp.incoterm} reload={load} />}
      {tab === "timeline" && <TimelineTab id={id} imp={imp} reload={load} />}
    </div>
  );
}

const EXC_COLOR = { CRITICAL: "var(--crit)", HIGH: "var(--idle)", MEDIUM: "var(--gold)", LOW: "var(--muted)", INFO: "var(--muted)" };

export function ExceptionRow({ e, onStatus }) {
  return (
    <div style={{ borderLeft: `3px solid ${EXC_COLOR[e.severity] || "#555"}`, background: "var(--bg)", borderRadius: 6, padding: "8px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13 }}>{e.import_no ? `${e.import_no} · ` : ""}{e.exception_type.replace(/_/g, " ")}</b>
        <span style={{ fontSize: 11, fontWeight: 700, color: EXC_COLOR[e.severity] }}>{e.severity} · {e.status}</span>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>{e.description}{e.owner ? ` · owner ${e.owner}` : ""}</div>
      {onStatus && e.status !== "RESOLVED" && e.status !== "DISMISSED" && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {e.status === "OPEN" && <button style={{ ...btn("var(--surface)", "var(--muted)"), padding: "3px 10px", fontSize: 12 }} onClick={() => onStatus(e.exception_id, "ACKNOWLEDGED")}>Acknowledge</button>}
          <button style={{ ...btn("var(--gold-dim)", "var(--gold)"), padding: "3px 10px", fontSize: 12 }} onClick={() => onStatus(e.exception_id, "IN_PROGRESS")}>In progress</button>
          <button style={{ ...btn("var(--bg)", "var(--green)"), padding: "3px 10px", fontSize: 12 }} onClick={() => { const r = window.prompt("Resolution note:"); if (r != null) onStatus(e.exception_id, "RESOLVED", r); }}>Resolve</button>
          <button style={{ ...btn("var(--surface)", "var(--muted)"), padding: "3px 10px", fontSize: 12 }} onClick={() => onStatus(e.exception_id, "DISMISSED")}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

function ExceptionsTab({ id }) {
  const [list, setList] = useState([]);
  const load = useCallback(async () => { const r = await fetch(`${API}/api/imports/exceptions?import_id=${id}`, { headers: auth() }); if (r.ok) setList(await r.json()); }, [id]);
  useEffect(() => { load(); }, [load]);
  const onStatus = async (excId, status, resolution) => {
    const r = await fetch(`${API}/api/imports/exceptions/${excId}`, { method: "PATCH", headers: jsonH(), body: JSON.stringify({ status, resolution }) });
    if (r.ok) load(); else alert("Failed");
  };
  return (
    <div style={card}>
      <div style={{ ...label, marginBottom: 10 }}>Open exceptions</div>
      {!list.length ? <div style={{ color: "var(--muted)", fontSize: 13 }}>No open exceptions. Auto-detected on a schedule (delays, customs pending, GRN pending, docs missing, shortage risk).</div> :
        list.map(e => <ExceptionRow key={e.exception_id} e={e} onStatus={onStatus} />)}
    </div>
  );
}

// Live vessel tracking — surfaces the latest AIS fix per shipment (status, position,
// speed, how long ago) plus the carrier-declared ETA. Derives everything from the
// tracking_events already loaded with the import; shows honest states when a vessel
// lacks an IMO/MMSI or no fix has been recorded yet.
function VesselStatusPanel({ imp }) {
  const shipments = (imp.shipments || []).filter(s => s.vessel_id);
  const events = imp.tracking_events || [];
  const latestFor = (sid) => events
    .filter(e => e.event_type === "POSITION" && String(e.shipment_id) === String(sid))
    .sort((a, b) => new Date(b.event_timestamp || 0) - new Date(a.event_timestamp || 0))[0] || null;
  const hrsAgo = (ts) => ts ? Math.round((Date.now() - new Date(ts).getTime()) / 3.6e6) : null;

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <div style={label}>🛰 Live vessel tracking</div>
        <div style={{ fontSize: 11.5, color: imp.current_eta ? "var(--green)" : "var(--muted)" }}>
          Carrier ETA: {imp.current_eta ? day(imp.current_eta) : "— not connected (add carrier tracking key)"}
        </div>
      </div>
      {!shipments.length ? (
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>No vessel assigned to any shipment yet — assign one (with an IMO/MMSI) in the Shipments tab to track live position and ETA.</div>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {shipments.map(s => {
            const p = latestFor(s.shipment_id);
            const trackable = s.imo_number || s.mmsi;
            const hrs = p ? hrsAgo(p.event_timestamp) : null;
            return (
              <div key={s.shipment_id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                  <b>{s.vessel_name || "Vessel"}{s.imo_number ? ` · IMO ${s.imo_number}` : s.mmsi ? ` · MMSI ${s.mmsi}` : ""}</b>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>BL {s.bl_number || "—"}</span>
                </div>
                {!trackable ? (
                  <div style={{ color: "var(--gold)", fontSize: 12.5, marginTop: 6 }}>⚠ No IMO/MMSI on this vessel — can't fetch AIS position. Add it on the vessel to enable live tracking.</div>
                ) : p ? (
                  <div style={{ marginTop: 6, fontSize: 13, display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
                    <span>📍 <b>{p.event_status || "Position"}</b></span>
                    <span style={{ color: "var(--muted)" }}>{Number(p.latitude).toFixed(3)}, {Number(p.longitude).toFixed(3)}</span>
                    {p.location ? <span style={{ color: "var(--muted)" }}>→ {p.location}</span> : null}
                    {p.remarks ? <span style={{ color: "var(--muted)" }}>{p.remarks}</span> : null}
                    <span style={{ color: hrs != null && hrs > 24 ? "var(--gold)" : "var(--green)" }}>as of {dt(p.event_timestamp)}{hrs != null ? ` (${hrs}h ago)` : ""}</span>
                  </div>
                ) : (
                  <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 6 }}>No AIS fix recorded yet — use “Sync tracking” in the Timeline tab (needs provider credits).</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TimelineTab({ id, imp, reload }) {
  const [prov, setProv] = useState(null);
  const [eta, setEta] = useState([]);
  const [nb, setNb] = useState({});
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [p, e] = await Promise.all([
      fetch(`${API}/api/imports/tracking/provider-status`, { headers: auth() }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/api/imports/${id}/eta-history`, { headers: auth() }).then(r => r.ok ? r.json() : []).catch(() => []),
    ]);
    setProv(p); setEta(e);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setMsg("Syncing…");
    const r = await fetch(`${API}/api/imports/${id}/sync-tracking`, { method: "POST", headers: jsonH() });
    const j = await r.json();
    setMsg(j.available ? `Synced — ${j.events_written} new event(s).` : (j.reason || "No provider configured."));
    reload();
  };
  const set = (k, v) => setNb(s => ({ ...s, [k]: v }));
  const addManual = async () => {
    const r = await fetch(`${API}/api/imports/${id}/tracking/manual`, { method: "POST", headers: jsonH(), body: JSON.stringify(nb) });
    const j = await r.json(); if (!r.ok) return alert(j.error || "Failed"); setNb({}); load(); reload();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={label}>Automatic tracking</div>
            <div style={{ color: prov?.configured ? "var(--green)" : "var(--muted)", fontSize: 12, marginTop: 4 }}>
              Position (AIS): {prov ? (prov.configured ? `${prov.provider} (connected)` : prov.reason) : "…"}
            </div>
            <div style={{ color: prov?.container_configured ? "var(--green)" : "var(--muted)", fontSize: 12, marginTop: 3 }}>
              Carrier ETA/BL: {prov ? (prov.container_configured ? `${prov.container_provider} (connected)` : (prov.container_reason || "not configured")) : "…"}
            </div>
          </div>
          <button style={btn("var(--bg)", "var(--text)")} onClick={sync}>Sync tracking</button>
        </div>
        {msg && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>{msg}</div>}
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Add manual update (source: MANUAL)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select style={inp} value={nb.event_type || ""} onChange={e => set("event_type", e.target.value)}>
            <option value="">Event type…</option>
            {["BOOKED", "GATE_IN", "LOADED", "VESSEL_DEPARTED", "TRANSSHIPMENT", "VESSEL_ARRIVED", "DISCHARGED", "CUSTOMS_CLEARED", "CONTAINER_RELEASED", "INLAND_TRANSIT", "WAREHOUSE_ARRIVAL", "UPDATE"].map(t => <option key={t}>{t}</option>)}
          </select>
          <input style={inp} placeholder="Location" value={nb.location || ""} onChange={e => set("location", e.target.value)} />
          <input style={inp} type="date" title="New ETA (optional)" value={nb.new_eta || ""} onChange={e => set("new_eta", e.target.value)} />
          <input style={{ ...inp, flex: 1, minWidth: 160 }} placeholder="Remarks" value={nb.remarks || ""} onChange={e => set("remarks", e.target.value)} />
          <button style={btn("var(--yellow)", "#000")} onClick={addManual}>Add</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>ETA history (original {day(imp.original_eta)} → current {day(imp.current_eta)})</div>
        {!eta.length ? <div style={{ color: "var(--muted)", fontSize: 13 }}>No ETA changes recorded.</div> :
          eta.map(h => (
            <div key={h.id} style={{ fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
              {day(h.old_eta)} → <b>{day(h.new_eta)}</b> <span style={{ color: Number(h.delay_days) > 0 ? "var(--gold-2)" : "var(--green)" }}>({Number(h.delay_days) > 0 ? "+" : ""}{h.delay_days}d)</span>
              <span style={{ color: "var(--muted)" }}> · {h.source} · {dt(h.created_at)}{h.changed_by ? ` · ${h.changed_by}` : ""}</span>
            </div>
          ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={card}>
          <div style={{ ...label, marginBottom: 10 }}>Tracking events</div>
          {!(imp.tracking_events || []).length ? <div style={{ color: "var(--muted)", fontSize: 13 }}>None yet — add a manual update above.</div> :
            imp.tracking_events.slice().reverse().map(e => (
              <div key={e.event_id} style={{ fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                <b>{e.event_status || e.event_type}</b> {e.location ? `· ${e.location}` : ""}
                {e.latitude != null && e.longitude != null ? <span style={{ color: "var(--muted)" }}> · {Number(e.latitude).toFixed(3)},{Number(e.longitude).toFixed(3)}</span> : null}
                <span style={{ color: "var(--muted)" }}> · {dt(e.event_timestamp)} · <span style={{ color: e.source === "MANUAL" ? "var(--purple)" : "var(--muted)" }}>{e.source}</span>{e.remarks ? ` · ${e.remarks}` : ""}</span>
              </div>
            ))}
        </div>
        <div style={card}>
          <div style={{ ...label, marginBottom: 10 }}>Status history</div>
          {(imp.status_history || []).map(h => (
            <div key={h.id} style={{ fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
              <b>{(h.from_status || "—").replace(/_/g, " ")} → {h.to_status.replace(/_/g, " ")}</b>{h.is_override ? <span style={{ color: "var(--gold-2)" }}> (override)</span> : ""}
              <span style={{ color: "var(--muted)" }}> · {dt(h.created_at)}{h.changed_by ? ` · ${h.changed_by}` : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ShipmentsTab({ imp, reload }) {
  const [nb, setNb] = useState({});
  const [vessels, setVessels] = useState([]);
  useEffect(() => { fetch(`${API}/api/imports/vessels`, { headers: auth() }).then(r => r.json()).then(d => setVessels(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  const add = async () => {
    const r = await fetch(`${API}/api/imports/${imp.import_id}/shipments`, { method: "POST", headers: jsonH(), body: JSON.stringify(nb) });
    const j = await r.json(); if (!r.ok) return alert(j.error || "Failed"); setNb({}); reload();
  };
  const addContainer = async (shipmentId) => {
    const cn = window.prompt("Container number:"); if (!cn) return;
    const r = await fetch(`${API}/api/imports/shipments/${shipmentId}/containers`, { method: "POST", headers: jsonH(), body: JSON.stringify({ container_number: cn }) });
    const j = await r.json(); if (!r.ok) return alert(j.error || "Failed"); reload();
  };
  const assignVessel = async (shipmentId, vessel_id) => {
    const r = await fetch(`${API}/api/imports/shipments/${shipmentId}/vessel`, { method: "PATCH", headers: jsonH(), body: JSON.stringify({ vessel_id: vessel_id || null }) });
    const j = await r.json(); if (!r.ok) return alert(j.error || "Failed"); reload();
  };
  const set = (k, v) => setNb(s => ({ ...s, [k]: v }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Add shipment (partial quantities allowed — pending: {imp.quantities?.pending} {imp.unit})</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={inp} placeholder="Booking #" value={nb.booking_number || ""} onChange={e => set("booking_number", e.target.value)} />
          <input style={inp} placeholder="Quantity" type="number" value={nb.quantity || ""} onChange={e => set("quantity", e.target.value)} />
          <input style={inp} placeholder="Shipping line" value={nb.shipping_line || ""} onChange={e => set("shipping_line", e.target.value)} />
          <input style={inp} placeholder="BL #" value={nb.bl_number || ""} onChange={e => set("bl_number", e.target.value)} />
          <input style={inp} type="date" value={nb.eta || ""} onChange={e => set("eta", e.target.value)} />
          <select style={inp} value={nb.vessel_id || ""} onChange={e => set("vessel_id", e.target.value)}>
            <option value="">Vessel (for tracking)…</option>
            {vessels.map(v => <option key={v.vessel_id} value={v.vessel_id}>{v.vessel_name}{v.imo_number ? ` · IMO ${v.imo_number}` : v.mmsi ? ` · MMSI ${v.mmsi}` : " · ⚠ no IMO"}</option>)}
          </select>
          <button style={btn("var(--yellow)", "#000")} onClick={add}>Add</button>
        </div>
      </div>
      {(imp.shipments || []).map(s => {
        const conts = (imp.containers || []).filter(c => c.shipment_id === s.shipment_id);
        return (
          <div key={s.shipment_id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <b>{s.booking_number || `Shipment ${s.shipment_id}`} · {Number(s.quantity) || 0} {imp.unit}</b>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>{s.shipping_line || "—"} · BL {s.bl_number || "—"} · ETA {day(s.eta)} · {s.status}</span>
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ ...label, fontSize: 10 }}>Containers:</span>
              {conts.length ? conts.map(c => <span key={c.container_id} style={{ fontSize: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px" }}>{c.container_number} {c.current_status ? `· ${c.current_status}` : ""}</span>) : <span style={{ color: "var(--muted)", fontSize: 12 }}>none</span>}
              <button style={{ ...btn("var(--bg)", "var(--text)"), padding: "4px 10px", fontSize: 12 }} onClick={() => addContainer(s.shipment_id)}>+ container</button>
            </div>
            {(s.imo_number || s.mmsi) ? (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
                🛰 Tracking via <b>{s.vessel_name}</b> ({s.imo_number ? `IMO ${s.imo_number}` : `MMSI ${s.mmsi}`})
                {" · "}<button style={{ ...btn("var(--bg)", "var(--text)"), padding: "2px 8px", fontSize: 11 }} onClick={() => assignVessel(s.shipment_id, "")}>unassign</button>
              </div>
            ) : (
              <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(234,179,8,0.12)", border: "1px solid var(--gold)", borderRadius: 6, fontSize: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: "var(--gold)" }}>⚠ No vessel/IMO — its containers won't be tracked on the position map.</span>
                <select style={{ ...inp, padding: "4px 8px", fontSize: 12 }} value="" onChange={e => e.target.value && assignVessel(s.shipment_id, e.target.value)}>
                  <option value="">Assign vessel…</option>
                  {vessels.map(v => <option key={v.vessel_id} value={v.vessel_id}>{v.vessel_name}{v.imo_number ? ` · IMO ${v.imo_number}` : v.mmsi ? ` · MMSI ${v.mmsi}` : " · ⚠ no IMO"}</option>)}
                </select>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GrnTab({ imp, reload }) {
  const [g, setG] = useState({ linked: [], available: [] });
  const [pick, setPick] = useState("");
  const q = imp.quantities || {};
  const GRN_COLOR = { PENDING: "var(--muted)", PARTIAL: "var(--gold)", COMPLETED: "var(--green)" };

  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/imports/${imp.import_id}/grn`, { headers: auth() });
    if (r.ok) setG(await r.json());
  }, [imp.import_id]);
  useEffect(() => { load(); }, [load]);

  const link = async () => {
    if (!pick) return;
    const r = await fetch(`${API}/api/imports/${imp.import_id}/grn/link`, { method: "POST", headers: jsonH(), body: JSON.stringify({ grn_id: Number(pick) }) });
    const j = await r.json(); if (!r.ok) return alert(j.error || "Failed"); setPick(""); load(); reload();
  };
  const unlink = async (grn_id) => {
    if (!window.confirm("Unlink this GRN from the import?")) return;
    const r = await fetch(`${API}/api/imports/${imp.import_id}/grn/unlink`, { method: "POST", headers: jsonH(), body: JSON.stringify({ grn_id }) });
    if (r.ok) { load(); reload(); } else alert("Failed");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={label}>GRN receipt status</div>
          <span style={{ fontWeight: 800, color: GRN_COLOR[q.grn_status] || "var(--text)" }}>{q.grn_status || "PENDING"}</span>
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 10, flexWrap: "wrap", fontSize: 14 }}>
          <span style={{ color: "var(--muted)" }}>Ordered <b style={{ color: "var(--text)" }}>{q.ordered} {imp.unit}</b></span>
          <span style={{ color: "var(--muted)" }}>Received <b style={{ color: "var(--text)" }}>{q.received} {imp.unit}</b></span>
          <span style={{ color: "var(--muted)" }}>Pending to receive <b style={{ color: "var(--text)" }}>{q.pending_to_receive} {imp.unit}</b></span>
        </div>
        <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>Received is read live from the linked GRN(s). Inventory is authoritative in the stock ledger — this only links receipts to the import.</div>
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Link an existing GRN</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select style={{ ...inp, minWidth: 320 }} value={pick} onChange={e => setPick(e.target.value)}>
            <option value="">Select a GRN from this supplier…</option>
            {g.available.map(x => <option key={x.grn_id} value={x.grn_id}>{x.grn_number} · {x.status} · {x.received_kg} kg · {day(x.receipt_date)}</option>)}
          </select>
          <button style={btn("var(--yellow)", "#000")} disabled={!pick} onClick={link}>Link GRN</button>
        </div>
        {!g.available.length && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>No unlinked GRNs for this supplier. GRNs are created in the existing GRN module.</div>}
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Linked GRNs</div>
        {!g.linked.length ? <div style={{ color: "var(--muted)", fontSize: 13 }}>No GRN linked yet.</div> :
          g.linked.map(x => (
            <div key={x.grn_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <span><b>{x.grn_number}</b> · {x.received_kg} {imp.unit} · <span style={{ color: x.status === "APPROVED" ? "var(--green)" : "var(--muted)" }}>{x.status}</span>{x.supplier_invoice ? ` · inv ${x.supplier_invoice}` : ""} · {day(x.receipt_date)}</span>
              <button style={{ ...btn("var(--bg)", "var(--crit)"), padding: "3px 10px", fontSize: 12 }} onClick={() => unlink(x.grn_id)}>Unlink</button>
            </div>
          ))}
      </div>
    </div>
  );
}

const CUSTOMS_STATUS = ["NOT_FILED", "FILED", "UNDER_ASSESSMENT", "EXAMINATION", "DUTY_PAID", "OUT_OF_CHARGE", "RELEASED"];

function CustomsTab({ id }) {
  const [f, setF] = useState({});
  const [msg, setMsg] = useState("");
  const [boeNote, setBoeNote] = useState("");
  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/imports/${id}/customs`, { headers: auth() });
    if (r.ok) { const j = await r.json(); setF(j || {}); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  // Read a Bill of Entry PDF → merge the extracted customs draft into the form (review + Save).
  const readBoe = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setMsg(""); setBoeNote("Reading Bill of Entry…");
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
      let password, out;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(`${API}/api/imports/${id}/customs/analyze-boe`, { method: "POST", headers: jsonH(), body: JSON.stringify({ file: { file_name: file.name, file_data: b64 }, password }) });
        out = await r.json();
        if (!r.ok && attempt === 0 && (out.needsPassword || /password-protected|password/i.test(out.error || ""))) {
          password = window.prompt("This PDF is password-protected. Enter the password:");
          if (!password) throw new Error("Password required to read this PDF.");
          continue;
        }
        if (!r.ok) throw new Error(out.error || "Could not read the Bill of Entry");
        break;
      }
      setF(s => ({ ...s, ...out.customs_draft }));
      const flags = [out.match?.warning, ...(out.warnings || [])].filter(Boolean);
      setBoeNote(`${flags.length ? "⚠ " + flags.join("  •  ") : (out.note || "Read")} — review the duties and Save. (read by ${out.read_by || "AI"})`);
    } catch (err) { setBoeNote(""); alert(err.message); }
    finally { e.target.value = ""; }
  };
  const save = async () => {
    const r = await fetch(`${API}/api/imports/${id}/customs`, { method: "PATCH", headers: jsonH(), body: JSON.stringify(f) });
    if (r.ok) { setMsg("Saved."); setTimeout(() => setMsg(""), 3000); load(); } else alert("Failed");
  };
  const Fld = ({ k, lb, type = "text" }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ ...label, fontSize: 10 }}>{lb}</span>
      <input style={inp} type={type} value={f[k] ?? ""} onChange={e => set(k, e.target.value)} /></div>
  );
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ ...label, marginBottom: 4 }}>Customs — recorded from the Bill of Entry by the CHA / accounts team</div>
        <label style={{ ...btn("var(--bg)", "var(--text)"), fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
          📄 Read BoE (AI)
          <input type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={readBoe} />
        </label>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 12 }}>No government/customs API — entered manually, or read from the BoE PDF. BCD + SWS add to landed cost; IGST is recoverable ITC (excluded).</div>
      {boeNote && <div style={{ fontSize: 12, color: boeNote.includes("⚠") ? "var(--gold-2)" : "var(--muted)", marginBottom: 10 }}>{boeNote}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <Fld k="boe_number" lb="Bill of Entry #" /><Fld k="boe_date" lb="BOE date" type="date" />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ ...label, fontSize: 10 }}>Customs status</span>
          <select style={inp} value={f.customs_status || "NOT_FILED"} onChange={e => set("customs_status", e.target.value)}>{CUSTOMS_STATUS.map(s => <option key={s}>{s}</option>)}</select></div>
        <Fld k="assessable_value" lb="Assessable value" type="number" /><Fld k="customs_duty" lb="Customs duty" type="number" />
        <Fld k="igst" lb="IGST" type="number" /><Fld k="other_taxes" lb="Other taxes" type="number" />
        <Fld k="duty_payment_date" lb="Duty payment date" type="date" /><Fld k="examination_status" lb="Examination status" />
        <Fld k="out_of_charge_date" lb="Out-of-charge date" type="date" /><Fld k="cha" lb="CHA" /><Fld k="remarks" lb="Remarks" />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        <button style={btn("var(--yellow)", "#000")} onClick={save}>Save customs</button>
        {msg && <span style={{ color: "var(--green)", fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}

const DOC_TYPES = ["PURCHASE_ORDER", "PROFORMA_INVOICE", "COMMERCIAL_INVOICE", "PACKING_LIST", "BILL_OF_LADING", "CERTIFICATE_OF_ORIGIN", "INSURANCE", "BILL_OF_ENTRY", "DUTY_PAYMENT", "TRANSPORT_LR", "EWAY_BILL", "POD", "OTHER"];
const DOC_COLOR = { UPLOADED: "var(--muted)", VERIFIED: "var(--green)", REJECTED: "var(--crit)", MISSING: "var(--muted)" };

function DocumentsTab({ id }) {
  const [d, setD] = useState({ documents: [], missing: [], completion_pct: 0, verified_pct: 0, required: [] });
  const [dt, setDt] = useState("COMMERCIAL_INVOICE");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await fetch(`${API}/api/imports/${id}/documents`, { headers: auth() }); if (r.ok) setD(await r.json()); }, [id]);
  useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    setBusy(true);
    try {
      let body = { doc_type: dt };
      if (file) {
        const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
        body = { ...body, file_name: file.name, mime_type: file.type, file_data: b64 };
      }
      const r = await fetch(`${API}/api/imports/${id}/documents`, { method: "POST", headers: jsonH(), body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) alert(j.error || "Failed"); else load();
    } finally { setBusy(false); }
  };
  const setStatus = async (docId, status) => { const r = await fetch(`${API}/api/imports/${id}/documents/${docId}`, { method: "PATCH", headers: jsonH(), body: JSON.stringify({ status }) }); if (r.ok) load(); };
  const del = async (docId) => { if (!window.confirm("Delete this document?")) return; const r = await fetch(`${API}/api/imports/${id}/documents/${docId}`, { method: "DELETE", headers: auth() }); if (r.ok) load(); };
  // Fetch the file WITH the auth header (a plain link navigation can't send it → 401),
  // then open it via a blob URL.
  const viewFile = async (docId) => {
    try {
      const r = await fetch(`${API}/api/imports/${id}/documents/${docId}/file`, { headers: auth() });
      if (!r.ok) { alert(r.status === 401 ? "Session expired — please log in again." : `Could not open file (${r.status})`); return; }
      const url = URL.createObjectURL(await r.blob());
      window.open(url, "_blank", "noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { alert(e.message); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={label}>Document completeness</div>
          <b>{d.completion_pct}% present · {d.verified_pct}% verified</b>
        </div>
        <div style={{ height: 8, background: "var(--bg)", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
          <div style={{ width: `${d.completion_pct}%`, height: "100%", background: "var(--yellow)" }} />
        </div>
        {d.missing?.length > 0 && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>Missing: {d.missing.join(", ")}</div>}
      </div>
      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Add / upload document</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select style={inp} value={dt} onChange={e => setDt(e.target.value)}>{DOC_TYPES.map(t => <option key={t}>{t}</option>)}</select>
          <label style={{ ...btn("var(--yellow)", "#000"), display: "inline-block" }}>{busy ? "Uploading…" : "Upload file"}
            <input type="file" style={{ display: "none" }} disabled={busy} onChange={e => upload(e.target.files?.[0])} /></label>
          <button style={btn("var(--bg)", "var(--text)")} disabled={busy} onClick={() => upload(null)}>Mark expected (no file)</button>
        </div>
      </div>
      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Documents</div>
        {!d.documents.length ? <div style={{ color: "var(--muted)", fontSize: 13 }}>None yet.</div> :
          d.documents.map(x => (
            <div key={x.document_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--border)", gap: 8, flexWrap: "wrap" }}>
              <span><b>{x.doc_type.replace(/_/g, " ")}</b> <span style={{ color: DOC_COLOR[x.status], fontWeight: 600 }}>· {x.status}</span>{x.file_name ? ` · ${x.file_name}` : ""}{x.verified_by ? ` · by ${x.verified_by}` : ""}</span>
              <span style={{ display: "flex", gap: 6 }}>
                {x.has_file && <button onClick={() => viewFile(x.document_id)} style={{ ...btn("var(--bg)", "var(--muted)"), padding: "3px 10px", fontSize: 12 }}>View</button>}
                <button style={{ ...btn("var(--bg)", "var(--green)"), padding: "3px 10px", fontSize: 12 }} onClick={() => setStatus(x.document_id, "VERIFIED")}>Verify</button>
                <button style={{ ...btn("var(--crit-dim)", "var(--crit)"), padding: "3px 10px", fontSize: 12 }} onClick={() => setStatus(x.document_id, "REJECTED")}>Reject</button>
                <button style={{ ...btn("var(--bg)", "var(--muted)"), padding: "3px 10px", fontSize: 12 }} onClick={() => del(x.document_id)}>Del</button>
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

function LogisticsTab({ id }) {
  const [legs, setLegs] = useState([]);
  const [nb, setNb] = useState({});
  const load = useCallback(async () => { const r = await fetch(`${API}/api/imports/${id}/logistics`, { headers: auth() }); if (r.ok) setLegs(await r.json()); }, [id]);
  useEffect(() => { load(); }, [load]);
  const set = (k, v) => setNb(s => ({ ...s, [k]: v }));
  const add = async () => { const r = await fetch(`${API}/api/imports/${id}/logistics`, { method: "POST", headers: jsonH(), body: JSON.stringify(nb) }); const j = await r.json(); if (!r.ok) return alert(j.error || "Failed"); setNb({}); load(); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ ...label, marginBottom: 4 }}>Post-port transport (port → Ludhiana warehouse → GRN)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input style={inp} placeholder="Transporter" value={nb.transporter || ""} onChange={e => set("transporter", e.target.value)} />
          <input style={inp} placeholder="Vehicle #" value={nb.vehicle_number || ""} onChange={e => set("vehicle_number", e.target.value)} />
          <input style={inp} placeholder="Driver" value={nb.driver || ""} onChange={e => set("driver", e.target.value)} />
          <input style={inp} placeholder="LR #" value={nb.lr_number || ""} onChange={e => set("lr_number", e.target.value)} />
          <input style={inp} type="date" title="Dispatch date" value={nb.dispatch_date || ""} onChange={e => set("dispatch_date", e.target.value)} />
          <input style={inp} type="date" title="Expected delivery" value={nb.expected_delivery || ""} onChange={e => set("expected_delivery", e.target.value)} />
          <input style={inp} placeholder="Freight ₹" type="number" value={nb.freight || ""} onChange={e => set("freight", e.target.value)} />
          <select style={inp} value={nb.status || "PLANNED"} onChange={e => set("status", e.target.value)}>{["PLANNED", "DISPATCHED", "IN_TRANSIT", "DELIVERED"].map(s => <option key={s}>{s}</option>)}</select>
          <button style={btn("var(--yellow)", "#000")} onClick={add}>Add leg</button>
        </div>
      </div>
      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Transport legs</div>
        {!legs.length ? <div style={{ color: "var(--muted)", fontSize: 13 }}>No transport recorded.</div> :
          legs.map(l => (
            <div key={l.leg_id} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <b>{l.transporter || "—"}</b> · {l.vehicle_number || "—"} · LR {l.lr_number || "—"} · {l.status}
              <span style={{ color: "var(--muted)" }}> · dispatch {day(l.dispatch_date)} · ETA {day(l.expected_delivery)}{l.actual_delivery ? ` · delivered ${day(l.actual_delivery)}` : ""}{l.freight ? ` · freight ${INR(l.freight)}` : ""}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function PaymentsTab({ id, imp, reload }) {
  const empty = { kind: "ADVANCE", amount_fc: "", currency: imp.currency || "USD", exchange_rate: "", amount_inr: "", swift_charges: "", advance_import_charges: "", fx_conversion_charges: "", bank_charges: "", tt_reference: "", tt_date: "", bank: "" };
  const [data, setData] = useState({ payments: [], summary: null });
  const [form, setForm] = useState(empty);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ttNote, setTtNote] = useState("");

  const load = useCallback(() => {
    fetch(`${API}/api/imports/${id}/payments`, { headers: auth() }).then(r => r.json()).then(setData).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const readTT = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setErr(""); setTtNote("");
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
      let password, out;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(`${API}/api/imports/${id}/payments/analyze-tt`, { method: "POST", headers: jsonH(), body: JSON.stringify({ file: { file_name: file.name, file_data: b64 }, password }) });
        out = await r.json();
        if (!r.ok && attempt === 0 && (out.needsPassword || /password-protected|password/i.test(out.error || ""))) {
          password = window.prompt("This PDF is password-protected. Enter the password:");
          if (!password) throw new Error("Password required to read this PDF.");
          continue;
        }
        if (!r.ok) throw new Error(out.error || "Could not read the TT advice");
        break;
      }
      const d = out.payment_draft || {};
      setForm(f => ({ ...f, kind: d.kind || "ADVANCE", amount_fc: d.amount_fc ?? "", currency: d.currency || f.currency, exchange_rate: d.exchange_rate ?? "", amount_inr: d.amount_inr ?? "", swift_charges: d.swift_charges ?? "", advance_import_charges: d.advance_import_charges ?? "", fx_conversion_charges: d.fx_conversion_charges ?? "", bank_charges: d.bank_charges ?? "", tt_reference: d.tt_reference || "", tt_date: d.tt_date || "", bank: d.bank || "" }));
      setTtNote(`Read by ${out.read_by || "AI"}${out.match && out.match.warning ? " — ⚠ " + out.match.warning : (out.match ? " — matches this import ✓" : "")}`);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const add = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/imports/${id}/payments`, { method: "POST", headers: jsonH(), body: JSON.stringify(form) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || "Save failed");
      setForm(empty); setTtNote(""); load(); reload && reload();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const del = async (pid) => {
    if (!window.confirm("Remove this payment?")) return;
    const r = await fetch(`${API}/api/imports/payments/${pid}`, { method: "DELETE", headers: auth() });
    if (r.ok) { load(); reload && reload(); }
  };

  const s = data.summary || {};
  const th = { padding: "7px 9px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
  const td = { padding: "7px 9px", fontSize: 13, borderTop: "1px solid var(--border)", whiteSpace: "nowrap" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Summary */}
      <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap" }}>
        {[["Paid (FC)", `${s.currency || "USD"} ${(s.total_fc || 0).toLocaleString("en-IN")}`], ["Paid (INR)", INR(s.total_inr)], ["Blended rate", s.blended_rate ? `₹${s.blended_rate}` : "—"], ["Invoice (FC)", `${s.currency || "USD"} ${(s.invoice_value_fc || 0).toLocaleString("en-IN")}`], ["Outstanding (FC)", `${s.currency || "USD"} ${(s.outstanding_fc || 0).toLocaleString("en-IN")}`], ["Status", s.fully_paid ? "Fully paid ✓" : "Part paid"]].map(([t, v]) => (
          <div key={t}><div style={{ ...label, fontSize: 10 }}>{t}</div><div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>{v}</div></div>
        ))}
      </div>

      {/* Payment list */}
      <div style={{ ...card, overflowX: "auto" }}>
        <div style={{ ...label, marginBottom: 8 }}>Payments (TTs) · each at its own rate</div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead><tr>{["Kind", "TT ref", "Date", "FC", "Rate", "Allocated (this import)", "Bank chg", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {!data.payments.length && <tr><td colSpan={8} style={{ ...td, color: "var(--muted)" }}>No payments recorded.</td></tr>}
            {data.payments.map(p => (
              <tr key={p.allocation_id}>
                <td style={td}>{p.kind}</td><td style={td}>{p.tt_reference || "—"}</td><td style={td}>{day(p.tt_date)}</td>
                <td style={td}>{p.currency} {Number(p.amount_fc).toLocaleString("en-IN")}</td><td style={td}>₹{p.exchange_rate}</td>
                <td style={td}>{p.currency} {Number(p.allocated_fc).toLocaleString("en-IN")} · {INR(p.allocated_inr)}</td>
                <td style={td}>{INR(p.bank_charges)}</td>
                <td style={{ ...td, textAlign: "right" }}><button onClick={() => del(p.payment_id)} style={{ ...btn("var(--bg)", "var(--crit)"), padding: "3px 9px" }}>Del</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add payment */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={label}>Record a payment</div>
          <label style={{ ...btn("var(--bg)", "var(--text)"), display: "inline-block" }}>
            📄 Read a bank TT advice (PDF)
            <input type="file" accept="application/pdf" onChange={readTT} style={{ display: "none" }} />
          </label>
        </div>
        {ttNote && <div style={{ fontSize: 12, color: ttNote.includes("⚠") ? "var(--gold-2)" : "var(--muted)", marginBottom: 8 }}>{ttNote}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}>
          <select style={inp} value={form.kind} onChange={e => set("kind", e.target.value)}>{["ADVANCE", "BALANCE", "OTHER"].map(k => <option key={k}>{k}</option>)}</select>
          <input style={inp} placeholder="Amount (FC)" value={form.amount_fc} onChange={e => set("amount_fc", e.target.value)} />
          <input style={inp} placeholder="Currency" value={form.currency} onChange={e => set("currency", e.target.value)} />
          <input style={inp} placeholder="Exchange rate" value={form.exchange_rate} onChange={e => set("exchange_rate", e.target.value)} />
          <input style={inp} placeholder="Amount (INR)" value={form.amount_inr} onChange={e => set("amount_inr", e.target.value)} />
          <input style={inp} placeholder="SWIFT/remittance chg (INR)" title="Remittance / SWIFT charges" value={form.swift_charges} onChange={e => set("swift_charges", e.target.value)} />
          <input style={inp} placeholder="Fgn advance import chg (INR)" title="Foreign advance import charges" value={form.advance_import_charges} onChange={e => set("advance_import_charges", e.target.value)} />
          <input style={inp} placeholder="FX conversion chg (INR)" title="Foreign currency conversion charges" value={form.fx_conversion_charges} onChange={e => set("fx_conversion_charges", e.target.value)} />
          <input style={inp} placeholder="Other bank charges (INR)" value={form.bank_charges} onChange={e => set("bank_charges", e.target.value)} />
          <input style={inp} placeholder="TT reference" value={form.tt_reference} onChange={e => set("tt_reference", e.target.value)} />
          <input style={inp} type="date" value={form.tt_date} onChange={e => set("tt_date", e.target.value)} />
          <input style={inp} placeholder="Bank" value={form.bank} onChange={e => set("bank", e.target.value)} />
        </div>
        {err && <div style={{ color: "var(--crit)", fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Allocates fully to this import. For an advance covering several containers, record it here then split it on the Payments desk.</div>
        <button onClick={add} disabled={busy} style={{ ...btn("var(--yellow)", "#000"), marginTop: 10, opacity: busy ? 0.5 : 1 }}>{busy ? "Working…" : "Record payment"}</button>
      </div>
    </div>
  );
}

function CostingTab({ id, incoterm, reload }) {
  const [c, setC] = useState(null);
  const [f, setF] = useState({});
  const [warn, setWarn] = useState("");
  const [msg, setMsg] = useState("");
  const [dnNote, setDnNote] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/imports/${id}/costing`, { headers: auth() });
    if (r.ok) { const j = await r.json(); setC(j); setF(j.cost || {}); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Read a shipping-line / forwarder debit note → merge freight/THC/IHC etc. into the
  // costing form (FOB-aware: freight comes back marked ADDITIONAL). Review, then Save.
  const readDebitNote = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setMsg(""); setWarn(""); setDnNote("Reading debit note…");
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
      let password, out;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(`${API}/api/imports/${id}/costing/analyze-debit-note`, { method: "POST", headers: jsonH(), body: JSON.stringify({ file: { file_name: file.name, file_data: b64 }, password }) });
        out = await r.json();
        if (!r.ok && attempt === 0 && (out.needsPassword || /password-protected|password/i.test(out.error || ""))) {
          password = window.prompt("This PDF is password-protected. Enter the password:");
          if (!password) throw new Error("Password required to read this PDF.");
          continue;
        }
        if (!r.ok) throw new Error(out.error || "Could not read the debit note");
        break;
      }
      const d = out.costing_draft || {};
      setF(s => ({ ...s, ...d }));
      setDnNote(`${out.note || "Read"} — review the highlighted charges and Save. (read by ${out.read_by || "AI"})`);
    } catch (err) { setDnNote(""); alert(err.message); }
    finally { e.target.value = ""; }
  };

  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const save = async (confirm) => {
    setWarn(""); setMsg("");
    const body = { ...f };
    if (confirm) body.confirm_additional = true;
    const r = await fetch(`${API}/api/imports/${id}/costing`, { method: "PATCH", headers: jsonH(), body: JSON.stringify(body) });
    const j = await r.json();
    if (j.needs_confirmation) { setWarn(j.warning); return; }
    if (!r.ok) return alert(j.error || "Failed");
    setMsg(`Saved. Landed cost ${INR(j.breakdown.total_landed_cost)} · ${INR(j.landed_cost_per_kg)}/kg`);
    load(); reload();
  };

  const NUM = ({ k, lb }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...label, fontSize: 10 }}>{lb}</span>
      <input style={inp} type="number" value={f[k] ?? ""} onChange={e => set(k, e.target.value)} />
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          <div style={label}>Landed cost inputs</div>
          <label style={{ ...btn("var(--bg)", "var(--text)"), fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
            📄 Read debit note (AI)
            <input type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={readDebitNote} />
          </label>
        </div>
        {dnNote && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{dnNote}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <NUM k="cif_value" lb="CIF value (foreign)" />
          <NUM k="exchange_rate" lb="Exchange rate → INR" />
          <NUM k="cif_value_in_inr" lb="CIF value (INR, auto if 0)" />
          <NUM k="customs_duty" lb="Customs duty" />
          <NUM k="other_customs_levies" lb="Other customs levies" />
          <NUM k="igst" lb="IGST (BoE / inter-state)" />
          <NUM k="cgst" lb="CGST (local invoices)" />
          <NUM k="sgst" lb="SGST (local invoices)" />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ ...label, fontSize: 10 }}>GST recoverable (ITC)?</span>
            <select style={inp} value={String(f.igst_recoverable !== false)} onChange={e => set("igst_recoverable", e.target.value === "true")}><option value="true">Yes (excluded from cost)</option><option value="false">No (adds to cost)</option></select>
          </div>
          <NUM k="port_charges" lb="Port charges" />
          <NUM k="terminal_charges" lb="Terminal charges" />
          <NUM k="cfs_charges" lb="CFS charges" />
          <NUM k="cha_charges" lb="CHA charges" />
          <NUM k="documentation_charges" lb="Documentation" />
          <NUM k="bank_charges" lb="Bank charges (used only if no TT recorded)" />
          <NUM k="local_transport" lb="IHC / Inland haulage" />
          <NUM k="other_import_expenses" lb="Other import expenses" />
        </div>
        {c?.breakdown?.remittance_forex_charges > 0 && (
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8, padding: "7px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8 }}>
            ℹ️ Bank/forex charges of <b>{INR(c.breakdown.remittance_forex_charges)}</b> (SWIFT / foreign advance-import / FX conversion) are captured from the recorded TTs and already included in the landed cost (see panel →). The <b>Bank charges</b> field above is only for any extra non-TT bank charge; it stays 0 when TTs carry the charges.
          </div>
        )}
        {(
          <div style={{ marginTop: 12, padding: 10, background: "var(--bg)", borderRadius: 8, border: "1px solid var(--border)" }}>
            <div style={{ ...label, fontSize: 10, marginBottom: 6 }}>{incoterm === "CIF" ? "Ocean freight / marine insurance (CIF: included in supplier price by default)" : `Ocean freight / marine insurance (${incoterm}: buyer's cost — set treatment ADDITIONAL and enter the amount, or use Read debit note)`}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ ...label, fontSize: 10 }}>Ocean freight treatment</span>
                <select style={inp} value={f.ocean_freight_treatment || "INCLUDED_IN_CIF"} onChange={e => set("ocean_freight_treatment", e.target.value)}>{["INCLUDED_IN_CIF", "ADDITIONAL", "NOT_APPLICABLE"].map(x => <option key={x}>{x}</option>)}</select>
              </div>
              <NUM k="ocean_freight_amount" lb="Ocean freight amount" />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ ...label, fontSize: 10 }}>Marine insurance treatment</span>
                <select style={inp} value={f.marine_insurance_treatment || "INCLUDED_IN_CIF"} onChange={e => set("marine_insurance_treatment", e.target.value)}>{["INCLUDED_IN_CIF", "ADDITIONAL", "NOT_APPLICABLE"].map(x => <option key={x}>{x}</option>)}</select>
              </div>
              <NUM k="marine_insurance_amount" lb="Marine insurance amount" />
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "var(--muted)" }}>
            <input type="checkbox" checked={f.is_actual === true} onChange={e => set("is_actual", e.target.checked)} /> These are ACTUAL costs (else estimate)
          </label>
          <button style={btn("var(--yellow)", "#000")} onClick={() => save(false)}>Save costing</button>
        </div>
        {warn && (
          <div style={{ marginTop: 10, padding: 10, background: "var(--crit-dim)", border: "1px solid #7a5", borderRadius: 8, color: "var(--gold-2)", fontSize: 13 }}>
            ⚠ {warn}
            <div style={{ marginTop: 8 }}><button style={btn("var(--idle)", "#000")} onClick={() => save(true)}>Confirm — add outside CIF</button></div>
          </div>
        )}
        {msg && <div style={{ marginTop: 10, color: "var(--green)", fontSize: 13 }}>{msg}</div>}
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 10 }}>Landed cost</div>
        {c && c.breakdown ? (
          <div style={{ fontSize: 13 }}>
            {[["CIF value (INR)", c.breakdown.cif_value_in_inr], ["+ Freight added", c.breakdown.freight_added], ["+ Insurance added", c.breakdown.insurance_added], ["+ Import-side expenses", c.breakdown.import_side_expenses]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}><span style={{ color: "var(--muted)" }}>{k}</span><b>{INR(v)}</b></div>
            ))}
            {c.breakdown.forex_charge_breakdown && c.breakdown.remittance_forex_charges > 0 && (
              <div style={{ padding: "4px 0 6px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--muted)" }}>+ Remittance & forex charges (from TTs)</span><b>{INR(c.breakdown.remittance_forex_charges)}</b></div>
                {[["SWIFT / remittance", c.breakdown.forex_charge_breakdown.swift_charges], ["Foreign advance-import", c.breakdown.forex_charge_breakdown.advance_import_charges], ["FX conversion", c.breakdown.forex_charge_breakdown.fx_conversion_charges], ["Other bank", c.breakdown.forex_charge_breakdown.other_bank_charges]].filter(([, v]) => Number(v) > 0).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--muted)", paddingLeft: 10 }}><span>· {k}</span><span>{INR(v)}</span></div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 15 }}><b>Total landed cost</b><b>{INR(c.breakdown.total_landed_cost)}</b></div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}><span style={{ color: "var(--muted)" }}>Landed cost / kg</span><b>{INR(c.landed_cost_per_kg)}</b></div>
            {c.per_kg_basis && <div style={{ fontSize: 11, color: c.grn_status === "COMPLETED" ? "var(--green)" : "var(--muted)", marginTop: 2 }}>{c.grn_status === "COMPLETED" ? "✅ FINAL · " : ""}per kg on {c.per_kg_basis}</div>}
            {c.variance && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <div style={{ ...label, fontSize: 10, marginBottom: 4 }}>Estimated vs actual</div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}><span style={{ color: "var(--muted)" }}>Estimated</span><span>{INR(c.variance.estimated)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}><span style={{ color: "var(--muted)" }}>Actual</span><b>{INR(c.variance.actual)}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: Math.abs(c.variance.variance_pct) >= 5 ? "var(--gold-2)" : "var(--muted)" }}><span>Variance</span><b>{INR(c.variance.variance)} ({c.variance.variance_pct > 0 ? "+" : ""}{c.variance.variance_pct}%)</b></div>
              </div>
            )}
            {c.breakdown.gst && c.breakdown.gst.total > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                  <span style={{ color: c.breakdown.gst.recoverable ? "var(--green)" : "var(--gold-2)" }}>{c.breakdown.gst.recoverable ? "GST — recoverable ITC (excluded from cost)" : "GST — added to cost (not claimed)"}</span>
                  <b>{INR(c.breakdown.gst.total)}</b>
                </div>
                {[["IGST", c.breakdown.gst.igst], ["CGST", c.breakdown.gst.cgst], ["SGST", c.breakdown.gst.sgst]].filter(([, v]) => Number(v) > 0).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)", paddingLeft: 10 }}><span>· {k}{k !== "IGST" && c.breakdown.gst.cha_cgst > 0 ? " (incl. CHA 9%)" : ""}</span><span>{INR(v)}</span></div>
                ))}
              </div>
            )}
            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 6 }}>{c.note}</div>
          </div>
        ) : <div style={{ color: "var(--muted)", fontSize: 13 }}>No costing saved yet.</div>}
      </div>
    </div>
  );
}
