// E-way bills & dispatch compliance.
//
// The alerts sit at the top and nothing else does, because they are the reason
// this screen exists. Two things carry a penalty: goods moving on a bill that has
// expired, and a dispatch over the state threshold with no bill recorded at all.
// Both were previously invisible — the number lived in someone's WhatsApp.
//
// Numbers are generated on the NIC portal and recorded here; this does not talk
// to the portal. What it owns is knowing when a bill was required and missing,
// and when one has run out while the vehicle is still on the road.

import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const auth = () => ({ Authorization: `Bearer ${tok()}` });

const rupee = n => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";
const fmtDateTime = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : "—";

const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: "var(--text)", fontSize: 14, boxSizing: "border-box" };
const lbl = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block" };
const th = { padding: "10px 8px", textAlign: "left", color: "var(--yellow)", fontSize: 13, borderBottom: "2px solid var(--surface)", whiteSpace: "nowrap" };
const td = { padding: "10px 8px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: 14 };
const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const thNum = { ...th, textAlign: "right" };
const btn = (bg, fg = "#000") => ({ background: bg, color: fg, border: "none", padding: "6px 12px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 12 });
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 };

const MODES = ["ROAD", "RAIL", "AIR", "SHIP"];

// Hours left before a bill expires, as a colour. A bill with the goods still
// moving and under a day left is the one to act on.
const validityColour = hrs => {
  if (hrs <= 0) return "var(--crit)";
  if (hrs < 12) return "var(--idle)";
  if (hrs < 24) return "var(--gold)";
  return "var(--green)";
};
const hoursUntil = d => (new Date(d).getTime() - Date.now()) / 36e5;

export default function EwayCompliance() {
  const [tab, setTab] = useState("compliance");
  const [alerts, setAlerts] = useState({ expired: [], missing: [], counts: { expired: 0, missing: 0 } });
  const [bills, setBills] = useState([]);
  const [transporters, setTransporters] = useState([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState(null);       // record-bill form state
  const [req, setReq] = useState(null);         // requirement answer for that dispatch
  const [saving, setSaving] = useState(false);
  const [vehicleFor, setVehicleFor] = useState(null);
  const [tForm, setTForm] = useState(null);     // transporter form

  const flash = (m, ok = true) => { setMsg((ok ? "✓ " : "✗ ") + m); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, b, t] = await Promise.all([
        fetch(`${API}/api/logistics/eway/alerts`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/logistics/eway`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/logistics/transporters?all=true`, { headers: auth() }).then(r => r.json()),
      ]);
      setAlerts(a && a.counts ? a : { expired: [], missing: [], counts: { expired: 0, missing: 0 } });
      setBills(Array.isArray(b) ? b : []);
      setTransporters(Array.isArray(t) ? t : []);
    } catch { flash("Could not load compliance data", false); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Open the record form for a dispatch, asking the server whether a bill is
  // even required — the answer belongs on screen before anyone types a number.
  const openForm = async (dispatch) => {
    setForm({
      eway_no: "", dispatch_id: dispatch?.dispatch_id || "", invoice_id: "",
      partner_id: dispatch?.partner_id || "", doc_value: dispatch?.grand_total || "",
      distance_km: "", transport_mode: "ROAD", transporter_id: "",
      vehicle_number: "", lr_number: "", notes: "",
      _dispatch_number: dispatch?.dispatch_number || "", _customer: dispatch?.customer_name || "",
    });
    setReq(null);
    if (dispatch?.dispatch_id) {
      try {
        const r = await fetch(`${API}/api/logistics/eway/requirement?dispatch_id=${dispatch.dispatch_id}`, { headers: auth() });
        setReq(await r.json());
      } catch { /* the form still works without it */ }
    }
  };

  const saveBill = async () => {
    setSaving(true);
    try {
      const body = { ...form };
      delete body._dispatch_number; delete body._customer;
      const r = await fetch(`${API}/api/logistics/eway`, { method: "POST", headers: h(), body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) flash(d.error || "Could not record the bill", false);
      else {
        flash(`${d.eway_no} recorded — valid ${d.validity_days} day${d.validity_days === 1 ? "" : "s"}, until ${fmtDateTime(d.valid_until)}`);
        setForm(null); await load();
      }
    } catch (e) { flash(e.message, false); }
    setSaving(false);
  };

  const changeVehicle = async () => {
    try {
      const r = await fetch(`${API}/api/logistics/eway/${vehicleFor.eway_id}/vehicle`, {
        method: "POST", headers: h(),
        body: JSON.stringify({ vehicle_number: vehicleFor.vehicle_number, reason: vehicleFor.reason, from_place: vehicleFor.from_place }),
      });
      const d = await r.json();
      if (!r.ok) return flash(d.error || "Could not update the vehicle", false);
      flash(`Vehicle changed to ${d.eway.vehicle_number}`);
      setVehicleFor(null); await load();
    } catch (e) { flash(e.message, false); }
  };

  const cancelBill = async (b) => {
    const hrs = (Date.now() - new Date(b.generated_at).getTime()) / 36e5;
    if (hrs > 24) {
      return flash(`${b.eway_no} was generated ${Math.floor(hrs)} hours ago. The portal only allows cancellation within 24 hours.`, false);
    }
    const reason = window.prompt(`Cancel e-way bill ${b.eway_no}?\n\nOnly possible within 24 hours of generation, and not once the consignment has been verified in transit.\n\nReason:`);
    if (reason === null) return;
    try {
      const r = await fetch(`${API}/api/logistics/eway/${b.eway_id}/cancel`, { method: "POST", headers: h(), body: JSON.stringify({ reason }) });
      const d = await r.json();
      if (!r.ok) return flash(d.error || "Could not cancel", false);
      flash(`${b.eway_no} cancelled`); await load();
    } catch (e) { flash(e.message, false); }
  };

  const saveTransporter = async () => {
    try {
      const isEdit = !!tForm.transporter_id;
      const r = await fetch(`${API}/api/logistics/transporters${isEdit ? "/" + tForm.transporter_id : ""}`, {
        method: isEdit ? "PUT" : "POST", headers: h(), body: JSON.stringify(tForm),
      });
      const d = await r.json();
      if (!r.ok) return flash(d.error || "Could not save", false);
      flash(`${d.name} saved`); setTForm(null); await load();
    } catch (e) { flash(e.message, false); }
  };

  const totalAlerts = alerts.counts.expired + alerts.counts.missing;

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: 0 }}>🚚 E-way Bills &amp; Compliance</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {[["compliance", "Compliance"], ["bills", "All bills"], ["transporters", "Transporters"]].map(([k, label]) => (
            <button key={k} style={btn(tab === k ? "var(--yellow)" : "var(--surface)", tab === k ? "#000" : "var(--text)")}
                    onClick={() => setTab(k)}>
              {label}{k === "compliance" && totalAlerts > 0 ? ` (${totalAlerts})` : ""}
            </button>
          ))}
          <button style={btn("var(--green)", "#000")} onClick={() => openForm(null)}>+ Record bill</button>
          <button style={btn("var(--surface)", "var(--text)")} onClick={load}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
        Bills are generated on the NIC portal and recorded here. This screen tracks whether one was
        required, and whether it is still valid.
      </div>

      {msg && <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 6, background: msg.startsWith("✓") ? "var(--green-dim)" : "var(--crit-dim)", border: `1px solid ${msg.startsWith("✓") ? "var(--green-deep)" : "var(--crit-dim)"}` }}>{msg}</div>}

      {tab === "compliance" && (
        <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
          {loading && <div style={card}>Loading…</div>}

          {!loading && !totalAlerts && (
            <div style={{ ...card, borderColor: "var(--green-deep)" }}>
              <div style={{ color: "var(--green)", fontWeight: "bold" }}>Nothing outstanding</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                No expired bills on undelivered goods, and no dispatch over the threshold without one.
              </div>
            </div>
          )}

          {/* Expired first: the goods are on the road right now. */}
          {!!alerts.expired.length && (
            <div style={{ ...card, borderColor: "var(--crit-dim)" }}>
              <div style={{ color: "var(--crit)", fontWeight: "bold", fontSize: 15 }}>
                ⚠ {alerts.expired.length} bill{alerts.expired.length === 1 ? "" : "s"} expired with goods still in transit
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 10px" }}>
                The consignment is moving on a bill that is no longer valid. Extend or regenerate on the
                portal, then record the new number here.
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>E-way no.</th><th style={th}>Dispatch</th><th style={th}>Customer</th>
                  <th style={th}>Vehicle</th><th style={th}>Expired at</th><th style={thNum}>Expired for</th>
                </tr></thead>
                <tbody>
                  {alerts.expired.map(e => (
                    <tr key={e.eway_id}>
                      <td style={td}>{e.eway_no}</td>
                      <td style={td}>{e.dispatch_number || "—"}</td>
                      <td style={td}>{e.customer_name || "—"}</td>
                      <td style={td}>{e.vehicle_number || "—"}</td>
                      <td style={td}>{fmtDateTime(e.valid_until)}</td>
                      <td style={{ ...tdNum, color: "var(--crit)", fontWeight: "bold" }}>{e.hours_expired}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!!alerts.missing.length && (
            <div style={{ ...card, borderColor: "var(--gold-deep)" }}>
              <div style={{ color: "var(--gold)", fontWeight: "bold", fontSize: 15 }}>
                {alerts.missing.length} dispatch{alerts.missing.length === 1 ? "" : "es"} over the threshold with no bill
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 10px" }}>
                Listed against the lower of the inter-state and intra-state thresholds, so nothing that
                might need a bill is filtered out before someone looks at it.
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Dispatch</th><th style={th}>Date</th><th style={th}>Customer</th>
                  <th style={thNum}>Value</th><th style={th}></th>
                </tr></thead>
                <tbody>
                  {alerts.missing.map(m => (
                    <tr key={m.dispatch_id}>
                      <td style={td}>{m.dispatch_number}</td>
                      <td style={td}>{fmtDate(m.dispatch_date)}</td>
                      <td style={td}>{m.customer_name || "—"}</td>
                      <td style={tdNum}>{rupee(m.grand_total)}</td>
                      <td style={td}>
                        <button style={btn("var(--yellow)", "#000")} onClick={() => openForm(m)}>Record bill</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "bills" && (
        <div style={{ ...card, marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>E-way no.</th><th style={th}>Dispatch</th><th style={th}>Transporter</th>
              <th style={th}>Vehicle</th><th style={thNum}>Value</th><th style={thNum}>Distance</th>
              <th style={th}>Valid until</th><th style={th}>Status</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {!bills.length && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={9}>No e-way bills recorded yet.</td></tr>}
              {bills.map(b => {
                const hrs = hoursUntil(b.valid_until);
                const live = b.status === "ACTIVE";
                const cancellable = live && (Date.now() - new Date(b.generated_at).getTime()) / 36e5 <= 24;
                return (
                  <tr key={b.eway_id} style={{ opacity: live ? 1 : 0.5 }}>
                    <td style={td}>{b.eway_no}</td>
                    <td style={td}>{b.dispatch_id || "—"}</td>
                    <td style={td}>{b.transporter_name || "—"}</td>
                    <td style={td}>
                      {b.vehicle_number || "—"}
                      {live && (
                        <button style={{ ...btn("var(--surface)", "var(--text)"), marginLeft: 6, padding: "2px 7px" }}
                                title="Vehicle breakdown or transhipment — Part-B update"
                                onClick={() => setVehicleFor({ eway_id: b.eway_id, vehicle_number: "", reason: "BREAKDOWN", from_place: "", _no: b.eway_no })}>
                          change
                        </button>
                      )}
                    </td>
                    <td style={tdNum}>{rupee(b.doc_value)}</td>
                    <td style={tdNum}>{b.distance_km ? `${b.distance_km} km` : "—"}</td>
                    <td style={{ ...td, color: live ? validityColour(hrs) : undefined, fontWeight: live ? "bold" : "normal" }}>
                      {fmtDateTime(b.valid_until)}
                      {live && (
                        <div style={{ fontSize: 11, fontWeight: "normal" }}>
                          {hrs <= 0 ? "EXPIRED" : `${Math.floor(hrs)}h left`}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, color: live ? (hrs <= 0 ? "var(--crit)" : "var(--green)") : "var(--muted)" }}>
                      {live ? (hrs <= 0 ? "EXPIRED" : "ACTIVE") : b.status}
                    </td>
                    <td style={td}>
                      {cancellable && <button style={btn("var(--crit-dim)", "#fff")} onClick={() => cancelBill(b)}>Cancel</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "transporters" && (
        <div style={{ ...card, marginTop: 16 }}>
          <button style={{ ...btn("var(--green)", "#000"), marginBottom: 12 }}
                  onClick={() => setTForm({ name: "", gstin: "", transporter_code: "", contact_person: "", mobile: "", address: "" })}>
            + Add transporter
          </button>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Name</th><th style={th}>GSTIN</th><th style={th}>Transporter ID</th>
              <th style={th}>Contact</th><th style={th}>Mobile</th><th style={th}>Active</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {!transporters.length && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={7}>No transporters yet.</td></tr>}
              {transporters.map(t => (
                <tr key={t.transporter_id} style={{ opacity: t.is_active ? 1 : 0.5 }}>
                  <td style={td}>{t.name}</td>
                  <td style={td}>{t.gstin || "—"}</td>
                  <td style={td}>{t.transporter_code || "—"}</td>
                  <td style={td}>{t.contact_person || "—"}</td>
                  <td style={td}>{t.mobile || "—"}</td>
                  <td style={{ ...td, color: t.is_active ? "var(--green)" : "var(--muted)" }}>{t.is_active ? "Yes" : "No"}</td>
                  <td style={td}><button style={btn("var(--surface)", "var(--text)")} onClick={() => setTForm({ ...t })}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title={form._dispatch_number ? `Record e-way bill — ${form._dispatch_number}` : "Record e-way bill"}
               onClose={() => setForm(null)}>
          {/* The requirement answer belongs on screen BEFORE a number is typed —
              it is the question the operator actually has. */}
          {req && (
            <div style={{ padding: 10, borderRadius: 8, marginBottom: 14,
                          background: req.required ? "rgba(239,68,68,0.10)" : "rgba(34,197,94,0.10)",
                          border: `1px solid ${req.required ? "var(--crit-dim)" : "var(--green-deep)"}` }}>
              <b style={{ color: req.required ? "var(--crit)" : "var(--green)" }}>
                {req.required ? "An e-way bill is required" : "No e-way bill required"}
              </b>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3 }}>{req.reason}</div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={lbl}>E-way bill number * (12 digits)</label>
              <input style={inp} autoFocus value={form.eway_no} maxLength={12}
                     onChange={e => setForm(f => ({ ...f, eway_no: e.target.value.replace(/\D/g, "") }))} />
            </div>
            <div>
              <label style={lbl}>Dispatch ID</label>
              <input style={inp} value={form.dispatch_id}
                     onChange={e => setForm(f => ({ ...f, dispatch_id: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Consignment value</label>
              <input style={inp} type="number" value={form.doc_value}
                     onChange={e => setForm(f => ({ ...f, doc_value: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Approximate distance (km)</label>
              <input style={inp} type="number" value={form.distance_km}
                     onChange={e => setForm(f => ({ ...f, distance_km: e.target.value }))} />
              <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 3 }}>
                {form.distance_km
                  ? `Valid ${Math.max(1, Math.ceil(Number(form.distance_km) / 200))} day(s) — one per 200 km`
                  : "Sets validity: one day per 200 km, minimum one"}
              </div>
            </div>
            <div>
              <label style={lbl}>Mode</label>
              <select style={inp} value={form.transport_mode}
                      onChange={e => setForm(f => ({ ...f, transport_mode: e.target.value }))}>
                {MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Vehicle number {form.transport_mode === "ROAD" && "*"}</label>
              <input style={inp} placeholder="PB10AB1234" value={form.vehicle_number}
                     onChange={e => setForm(f => ({ ...f, vehicle_number: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <label style={lbl}>Transporter</label>
              <select style={inp} value={form.transporter_id}
                      onChange={e => setForm(f => ({ ...f, transporter_id: e.target.value }))}>
                <option value="">—</option>
                {transporters.filter(t => t.is_active).map(t => (
                  <option key={t.transporter_id} value={t.transporter_id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>LR / consignment note</label>
              <input style={inp} value={form.lr_number}
                     onChange={e => setForm(f => ({ ...f, lr_number: e.target.value }))} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
            <button style={btn("var(--surface)", "var(--text)")} onClick={() => setForm(null)}>Cancel</button>
            <button style={btn("var(--green)", "#000")} disabled={saving} onClick={saveBill}>
              {saving ? "Saving…" : "Record bill"}
            </button>
          </div>
        </Modal>
      )}

      {vehicleFor && (
        <Modal title={`Change vehicle — ${vehicleFor._no}`} onClose={() => setVehicleFor(null)}>
          <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
            A Part-B update. The previous vehicle stays on record against this bill.
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={lbl}>New vehicle number *</label>
              <input style={inp} autoFocus placeholder="PB65XY9999" value={vehicleFor.vehicle_number}
                     onChange={e => setVehicleFor(v => ({ ...v, vehicle_number: e.target.value.toUpperCase() }))} />
            </div>
            <div>
              <label style={lbl}>Reason</label>
              <select style={inp} value={vehicleFor.reason}
                      onChange={e => setVehicleFor(v => ({ ...v, reason: e.target.value }))}>
                {["BREAKDOWN", "TRANSHIPMENT", "OTHER"].map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>From place</label>
              <input style={inp} value={vehicleFor.from_place}
                     onChange={e => setVehicleFor(v => ({ ...v, from_place: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
            <button style={btn("var(--surface)", "var(--text)")} onClick={() => setVehicleFor(null)}>Cancel</button>
            <button style={btn("var(--green)", "#000")} onClick={changeVehicle}>Update vehicle</button>
          </div>
        </Modal>
      )}

      {tForm && (
        <Modal title={tForm.transporter_id ? `Edit ${tForm.name}` : "Add transporter"} onClose={() => setTForm(null)}>
          <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
            A GSTIN or a 15-character Transporter ID is required — the portal needs one of the two to
            identify the transporter at all.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={lbl}>Name *</label>
              <input style={inp} value={tForm.name || ""} onChange={e => setTForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label style={lbl}>GSTIN</label>
              <input style={inp} value={tForm.gstin || ""} onChange={e => setTForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))} /></div>
            <div><label style={lbl}>Transporter ID</label>
              <input style={inp} value={tForm.transporter_code || ""} onChange={e => setTForm(f => ({ ...f, transporter_code: e.target.value.toUpperCase() }))} /></div>
            <div><label style={lbl}>Contact person</label>
              <input style={inp} value={tForm.contact_person || ""} onChange={e => setTForm(f => ({ ...f, contact_person: e.target.value }))} /></div>
            <div><label style={lbl}>Mobile</label>
              <input style={inp} value={tForm.mobile || ""} onChange={e => setTForm(f => ({ ...f, mobile: e.target.value }))} /></div>
            {tForm.transporter_id && (
              <div><label style={lbl}>Active</label>
                <select style={inp} value={tForm.is_active ? "1" : "0"}
                        onChange={e => setTForm(f => ({ ...f, is_active: e.target.value === "1" }))}>
                  <option value="1">Yes</option><option value="0">No</option>
                </select></div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
            <button style={btn("var(--surface)", "var(--text)")} onClick={() => setTForm(null)}>Cancel</button>
            <button style={btn("var(--green)", "#000")} onClick={saveTransporter}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div onClick={onClose}
         style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex",
                  alignItems: "flex-start", justifyContent: "center", padding: 24, zIndex: 1000, overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: "min(720px,100%)", marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ color: "var(--yellow)", margin: 0 }}>{title}</h3>
          <button style={btn("var(--surface)", "var(--text)")} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
