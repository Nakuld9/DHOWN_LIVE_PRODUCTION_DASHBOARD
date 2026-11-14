// Lot allocation, shade continuity and quarantine.
//
// The decision this screen exists to make visible: whether an order can be met
// from a single dye lot. Two rolls of the same colour from different lots do not
// match, and panels cut from both come back as a rejected consignment. So the
// plan is shown BEFORE anything is committed, with its basis stated — the lot
// this customer had last time, a single lot, or a split that needs approval.
//
// Planning is a dry run with no side effects. Committing re-picks under a lock,
// because the plan on screen is a proposal and the stock may have moved since.

import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const auth = () => ({ Authorization: `Bearer ${tok()}` });

const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";
const kg = n => `${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg`;

const inp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "9px 11px", color: "var(--text)", fontSize: 14, boxSizing: "border-box" };
const lbl = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block" };
const th = { padding: "10px 8px", textAlign: "left", color: "var(--yellow)", fontSize: 13, borderBottom: "2px solid var(--surface)", whiteSpace: "nowrap" };
const td = { padding: "10px 8px", borderBottom: "1px solid rgba(22,52,93,0.4)", fontSize: 14 };
const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const thNum = { ...th, textAlign: "right" };
const btn = (bg, fg = "#000") => ({ background: bg, color: fg, border: "none", padding: "6px 12px", borderRadius: 6, fontWeight: "bold", cursor: "pointer", fontSize: 12 });
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 };

// Why the plan chose what it chose. Stating this is the point of the screen —
// "one lot" and "the lot they had last time" are different assurances.
const BASIS = {
  REPEAT_LOT: { colour: "var(--green)", label: "Same lot as last time",
                note: "This customer already has fabric from this dye lot. Shades will match their previous delivery." },
  SINGLE_LOT: { colour: "var(--green)", label: "Single dye lot",
                note: "The whole quantity comes from one lot, so every roll matches. The oldest sufficient lot was used." },
  SPLIT:      { colour: "var(--crit)", label: "Split across lots",
                note: "No single lot could cover this. Shades will NOT match between lots — needs approval before dispatch." },
};

const FAIL = {
  NO_STOCK: "No finished, unquarantined, unallocated stock matches this fabric and colour.",
  INSUFFICIENT: "Not enough stock to meet this order.",
  NO_SINGLE_LOT: "No single dye lot can cover this quantity. Allow splitting if a shade difference is acceptable.",
};

const QSTATES = ["QUARANTINED", "REWORK", "SCRAP", "NONE"];
const QCOLOUR = { QUARANTINED: "var(--gold)", REWORK: "var(--idle)", SCRAP: "var(--crit)", NONE: "var(--green)" };

export default function Allocation() {
  const [tab, setTab] = useState("allocate");
  const [lots, setLots] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [quarantine, setQuarantine] = useState([]);
  const [partners, setPartners] = useState([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [q, setQ] = useState({ fabric_type: "", color_name: "", quantity_kg: "", partner_id: "", allow_split: true });
  const [plan, setPlan] = useState(null);
  const [detail, setDetail] = useState(null);
  const [qForm, setQForm] = useState(null);

  const flash = (m, ok = true) => { setMsg((ok ? "✓ " : "✗ ") + m); setTimeout(() => setMsg(""), 6000); };

  const load = useCallback(async () => {
    try {
      const [l, a, qr] = await Promise.all([
        fetch(`${API}/api/allocation/lots`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/allocation/allocations`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/allocation/quarantine`, { headers: auth() }).then(r => r.json()),
      ]);
      setLots(Array.isArray(l) ? l : []);
      setAllocations(Array.isArray(a) ? a : []);
      setQuarantine(Array.isArray(qr) ? qr : []);
    } catch { flash("Could not load stock", false); }
  }, []);

  useEffect(() => {
    load();
    fetch(`${API}/api/erp/partners`, { headers: auth() })
      .then(r => r.json()).then(d => setPartners(d.data || d.partners || (Array.isArray(d) ? d : []))).catch(() => {});
  }, [load]);

  // Dry run. Nothing is held, so this can be re-run freely while deciding.
  const runPlan = async () => {
    if (!(Number(q.quantity_kg) > 0)) return flash("Enter a quantity", false);
    setBusy(true); setPlan(null);
    try {
      const p = new URLSearchParams({
        fabric_type: q.fabric_type || "", color_name: q.color_name || "",
        quantity_kg: q.quantity_kg, allow_split: String(q.allow_split),
      });
      if (q.partner_id) p.set("partner_id", q.partner_id);
      const r = await fetch(`${API}/api/allocation/plan?${p}`, { headers: auth() });
      const d = await r.json();
      if (!r.ok) flash(d.error || "Could not plan", false);
      else setPlan(d);
    } catch (e) { flash(e.message, false); }
    setBusy(false);
  };

  const commit = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/allocation/allocations`, {
        method: "POST", headers: h(),
        body: JSON.stringify({
          ref_type: "MANUAL", partner_id: q.partner_id || null,
          fabric_type: q.fabric_type || null, color_name: q.color_name || null,
          quantity_kg: Number(q.quantity_kg), allow_split: q.allow_split,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) flash(d.error || d.note || "Could not allocate", false);
      else {
        flash(`Allocated ${kg(d.allocated)} across ${d.lots.length} lot${d.lots.length === 1 ? "" : "s"}` +
              (d.shade_risk ? " — SHADE RISK, needs approval before dispatch" : ""));
        setPlan(null); await load(); setTab("allocations");
      }
    } catch (e) { flash(e.message, false); }
    setBusy(false);
  };

  const act = async (row, action) => {
    if (action === "approve-shade" && !window.confirm(
      `Approve the shade split on allocation ${row.allocation_id}?\n\n` +
      `This consignment spans ${row.lot_count} dye lots. The shades will not match between them. ` +
      `Confirm only if the customer has accepted that.`)) return;
    if (action === "release" && !window.confirm(`Release the rolls on allocation ${row.allocation_id} back to available stock?`)) return;
    if (action === "consume" && !window.confirm(`Mark allocation ${row.allocation_id} dispatched? The rolls leave stock.`)) return;
    try {
      const r = await fetch(`${API}/api/allocation/allocations/${row.allocation_id}/${action}`, { method: "POST", headers: h(), body: "{}" });
      const d = await r.json();
      if (!r.ok) return flash(d.error || `Could not ${action}`, false);
      flash(action === "approve-shade" ? "Shade split approved" : action === "release" ? "Rolls released" : "Marked dispatched");
      await load();
    } catch (e) { flash(e.message, false); }
  };

  const saveQuarantine = async () => {
    try {
      const r = await fetch(`${API}/api/allocation/quarantine/${encodeURIComponent(qForm.roll_id)}`, {
        method: "POST", headers: h(), body: JSON.stringify({ status: qForm.status, reason: qForm.reason, defect_type: qForm.defect_type }),
      });
      const d = await r.json();
      if (!r.ok) return flash(d.error || "Could not update", false);
      flash(`Roll ${d.roll_id}: ${d.from} → ${d.to}` +
            (d.allocations_affected?.length ? ` — released from ${d.allocations_affected.length} allocation(s), which are now short` : ""));
      setQForm(null); await load();
    } catch (e) { flash(e.message, false); }
  };

  const openDetail = async (row) => {
    try {
      const r = await fetch(`${API}/api/allocation/allocations/${row.allocation_id}`, { headers: auth() });
      setDetail(await r.json());
    } catch { flash("Could not load", false); }
  };

  const basis = plan?.ok ? BASIS[plan.basis] : null;

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: 0 }}>🎯 Lot Allocation &amp; Shade</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {[["allocate", "Allocate"], ["stock", `Stock by lot (${lots.length})`],
            ["allocations", "Allocations"], ["quarantine", `Quarantine (${quarantine.length})`]].map(([k, label]) => (
            <button key={k} style={btn(tab === k ? "var(--yellow)" : "var(--surface)", tab === k ? "#000" : "var(--text)")}
                    onClick={() => setTab(k)}>{label}</button>
          ))}
          <button style={btn("var(--surface)", "var(--text)")} onClick={load}>↻</button>
        </div>
      </div>

      {msg && <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 6, background: msg.startsWith("✓") ? "var(--green-dim)" : "var(--crit-dim)", border: `1px solid ${msg.startsWith("✓") ? "var(--green-deep)" : "var(--crit-dim)"}` }}>{msg}</div>}

      {tab === "allocate" && (
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "start" }}>
          <div style={card}>
            <div style={{ color: "var(--yellow)", fontWeight: "bold", marginBottom: 12 }}>What is needed</div>
            <label style={lbl}>Customer</label>
            <select style={{ ...inp, marginBottom: 10 }} value={q.partner_id}
                    onChange={e => setQ(s => ({ ...s, partner_id: e.target.value }))}>
              <option value="">— none (new customer) —</option>
              {partners.map(p => <option key={p.partner_id} value={p.partner_id}>{p.company_name}</option>)}
            </select>
            <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 12, marginTop: -6 }}>
              Naming the customer lets the plan reuse the dye lot they had last time.
            </div>

            <label style={lbl}>Fabric</label>
            <input style={{ ...inp, marginBottom: 10 }} value={q.fabric_type} placeholder="e.g. Single Jersey"
                   onChange={e => setQ(s => ({ ...s, fabric_type: e.target.value }))} />
            <label style={lbl}>Colour</label>
            <input style={{ ...inp, marginBottom: 10 }} value={q.color_name} placeholder="e.g. White"
                   onChange={e => setQ(s => ({ ...s, color_name: e.target.value }))} />
            <label style={lbl}>Quantity (kg) *</label>
            <input style={{ ...inp, marginBottom: 10 }} type="number" value={q.quantity_kg}
                   onChange={e => setQ(s => ({ ...s, quantity_kg: e.target.value }))}
                   onKeyDown={e => e.key === "Enter" && runPlan()} />

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, margin: "10px 0 14px", cursor: "pointer" }}>
              <input type="checkbox" checked={q.allow_split}
                     onChange={e => setQ(s => ({ ...s, allow_split: e.target.checked }))} />
              Allow splitting across dye lots
            </label>

            <button style={{ ...btn("var(--yellow)", "#000"), width: "100%", padding: "10px" }} disabled={busy} onClick={runPlan}>
              {busy ? "Planning…" : "Plan allocation"}
            </button>
            <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 8 }}>
              Planning holds nothing — run it as often as you like.
            </div>
          </div>

          <div>
            {!plan && (
              <div style={{ ...card, color: "var(--muted)" }}>
                Enter what is needed and plan the allocation. Nothing is held until you commit.
              </div>
            )}

            {plan && plan.ok === false && (
              <div style={{ ...card, borderColor: "var(--crit-dim)" }}>
                <div style={{ color: "var(--crit)", fontWeight: "bold", fontSize: 15 }}>Cannot allocate</div>
                <div style={{ fontSize: 14, marginTop: 6 }}>{FAIL[plan.reason] || plan.note}</div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
                  Requested {kg(plan.requested)} · available {kg(plan.available)}
                  {plan.shortfall > 0 && ` · short by ${kg(plan.shortfall)}`}
                  {plan.largest_lot_kg && ` · largest single lot ${kg(plan.largest_lot_kg)}`}
                </div>
              </div>
            )}

            {plan?.ok && (
              <>
                <div style={{ ...card, borderColor: plan.shade_risk ? "var(--crit-dim)" : "var(--green-deep)", marginBottom: 12 }}>
                  <div style={{ color: basis.colour, fontWeight: "bold", fontSize: 16 }}>
                    {plan.shade_risk ? "⚠ " : "✓ "}{basis.label}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{basis.note}</div>
                  <div style={{ marginTop: 10, fontSize: 14 }}>
                    Requested {kg(plan.requested)} · allocating <b>{kg(plan.allocated)}</b>
                    <span style={{ color: "var(--muted)" }}>
                      {" "}({plan.variance_pct >= 0 ? "+" : ""}{plan.variance_pct}% — rolls are whole units)
                    </span>
                  </div>
                </div>

                <div style={{ ...card, marginBottom: 12 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                      <th style={th}>Dye lot</th><th style={thNum}>Rolls</th><th style={thNum}>Weight</th>
                    </tr></thead>
                    <tbody>
                      {plan.lots.map(l => (
                        <tr key={l.batch_id}>
                          <td style={td}>{l.batch_number || `lot ${l.batch_id}`}</td>
                          <td style={tdNum}>{l.rolls}</td>
                          <td style={tdNum}>{kg(l.kg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ ...card, marginBottom: 12, maxHeight: 260, overflowY: "auto" }}>
                  <div style={{ color: "var(--yellow)", fontSize: 13, marginBottom: 8 }}>Rolls that will be held</div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                      <th style={th}>Roll</th><th style={th}>Lot</th><th style={th}>Grade</th><th style={thNum}>Weight</th>
                    </tr></thead>
                    <tbody>
                      {plan.rolls.map(r => (
                        <tr key={r.roll_id}>
                          <td style={td}>{r.roll_id}</td>
                          <td style={td}>{r.batch_number || r.batch_id}</td>
                          <td style={td}>{r.grade || "A"}</td>
                          <td style={tdNum}>{kg(r.weight_kg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button style={{ ...btn(plan.shade_risk ? "var(--crit)" : "var(--green)", plan.shade_risk ? "#fff" : "#000"), padding: "11px 16px", fontSize: 14 }}
                        disabled={busy} onClick={commit}>
                  {busy ? "Allocating…" : plan.shade_risk ? "Commit anyway (raises approval)" : "Commit allocation"}
                </button>
                <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 10 }}>
                  Re-checked under a lock when committing — the final pick may differ if stock moved.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "stock" && (
        <div style={{ ...card, marginTop: 16, overflowX: "auto" }}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
            Finished, grade A, not quarantined, not already committed. Anything missing one of those is
            not shippable and is deliberately not counted here.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Dye lot</th><th style={th}>Fabric</th><th style={th}>Colour</th>
              <th style={thNum}>Rolls</th><th style={thNum}>Available</th><th style={th}>Oldest roll</th>
            </tr></thead>
            <tbody>
              {!lots.length && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={6}>No allocatable stock.</td></tr>}
              {lots.map(l => (
                <tr key={l.batch_id}>
                  <td style={td}>{l.batch_number || `lot ${l.batch_id}`}</td>
                  <td style={td}>{l.fabric_type || "—"}</td>
                  <td style={td}>{l.color_name || "—"}</td>
                  <td style={tdNum}>{l.roll_count}</td>
                  <td style={tdNum}>{kg(l.available_kg)}</td>
                  <td style={td}>{fmtDate(l.lot_created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "allocations" && (
        <div style={{ ...card, marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>#</th><th style={th}>Customer</th><th style={th}>Fabric / colour</th>
              <th style={thNum}>Requested</th><th style={thNum}>Allocated</th><th style={thNum}>Lots</th>
              <th style={th}>Shade</th><th style={th}>Status</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {!allocations.length && <tr><td style={{ ...td, color: "var(--muted)" }} colSpan={9}>Nothing allocated.</td></tr>}
              {allocations.map(a => (
                <tr key={a.allocation_id} style={{ cursor: "pointer", opacity: a.status === "ACTIVE" ? 1 : 0.55 }}
                    onClick={() => openDetail(a)}>
                  <td style={td}>{a.allocation_id}</td>
                  <td style={td}>{a.company_name || "—"}</td>
                  <td style={td}>{[a.fabric_type, a.color_name].filter(Boolean).join(" · ") || "—"}</td>
                  <td style={tdNum}>{kg(a.requested_kg)}</td>
                  <td style={tdNum}>{kg(a.allocated_kg)}</td>
                  <td style={tdNum}>{a.lot_count}</td>
                  <td style={td}>
                    {a.shade_risk
                      ? (a.shade_approved_at
                          ? <span style={{ color: "var(--green)" }}>split · approved</span>
                          : <span style={{ color: "var(--crit)", fontWeight: "bold" }}>split · NEEDS APPROVAL</span>)
                      : <span style={{ color: "var(--green)" }}>single lot</span>}
                  </td>
                  <td style={td}>{a.status}</td>
                  <td style={td} onClick={e => e.stopPropagation()}>
                    {a.status === "ACTIVE" && (
                      <span style={{ display: "flex", gap: 6 }}>
                        {a.shade_risk && !a.shade_approved_at && (
                          <button style={btn("var(--gold)")} onClick={() => act(a, "approve-shade")}>Approve shade</button>
                        )}
                        <button style={btn("var(--green)")} onClick={() => act(a, "consume")}>Dispatch</button>
                        <button style={btn("var(--surface)", "var(--text)")} onClick={() => act(a, "release")}>Release</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "quarantine" && (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              Quarantined rolls are never allocated. Quarantining a roll already committed releases it and
              marks that allocation short.
            </div>
            <button style={btn("var(--gold)")} onClick={() => setQForm({ roll_id: "", status: "QUARANTINED", reason: "", defect_type: "" })}>
              Quarantine a roll
            </button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Roll</th><th style={th}>Lot</th><th style={th}>Colour</th>
              <th style={thNum}>Weight</th><th style={th}>State</th><th style={th}>Reason</th>
              <th style={th}>Since</th><th style={th}>By</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {!quarantine.length && (
                <tr><td style={{ ...td, color: "var(--green)" }} colSpan={9}>No rolls quarantined.</td></tr>
              )}
              {quarantine.map(r => (
                <tr key={r.roll_id}>
                  <td style={td}>{r.roll_id}</td>
                  <td style={td}>{r.batch_number || "—"}</td>
                  <td style={td}>{r.color_name || "—"}</td>
                  <td style={tdNum}>{kg(r.weight_kg)}</td>
                  <td style={{ ...td, color: QCOLOUR[r.quarantine_status], fontWeight: "bold" }}>{r.quarantine_status}</td>
                  <td style={td}>{r.quarantine_reason || "—"}</td>
                  <td style={td}>{fmtDate(r.quarantined_at)}</td>
                  <td style={td}>{r.quarantined_by || "—"}</td>
                  <td style={td}>
                    <button style={btn("var(--surface)", "var(--text)")}
                            onClick={() => setQForm({ roll_id: r.roll_id, status: "NONE", reason: "", defect_type: "", _current: r.quarantine_status })}>
                      Change
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {qForm && (
        <Modal title={qForm._current ? `Roll ${qForm.roll_id} — currently ${qForm._current}` : "Quarantine a roll"}
               onClose={() => setQForm(null)}>
          {!qForm._current && (
            <>
              <label style={lbl}>Roll number *</label>
              <input style={{ ...inp, marginBottom: 12 }} autoFocus value={qForm.roll_id}
                     onChange={e => setQForm(f => ({ ...f, roll_id: e.target.value }))} />
            </>
          )}
          <label style={lbl}>New state</label>
          <select style={{ ...inp, marginBottom: 4 }} value={qForm.status}
                  onChange={e => setQForm(f => ({ ...f, status: e.target.value }))}>
            {QSTATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 12 }}>
            {qForm.status === "NONE"
              ? "Releases the roll back to sellable stock."
              : "The roll will not be allocated while in this state."}
          </div>

          {qForm.status !== "NONE" && (
            <>
              <label style={lbl}>Reason *</label>
              <input style={{ ...inp, marginBottom: 12 }} value={qForm.reason}
                     onChange={e => setQForm(f => ({ ...f, reason: e.target.value }))} />
              <label style={lbl}>Defect type</label>
              <input style={{ ...inp, marginBottom: 12 }} value={qForm.defect_type}
                     onChange={e => setQForm(f => ({ ...f, defect_type: e.target.value }))} />
            </>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={btn("var(--surface)", "var(--text)")} onClick={() => setQForm(null)}>Cancel</button>
            <button style={btn("var(--gold)")} onClick={saveQuarantine}>Save</button>
          </div>
        </Modal>
      )}

      {detail && (
        <Modal title={`Allocation ${detail.allocation_id} · ${detail.status}`} onClose={() => setDetail(null)}>
          <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
            {detail.company_name || "no customer"} · {[detail.fabric_type, detail.color_name].filter(Boolean).join(" · ")} ·{" "}
            {detail.ref_type}{detail.ref_id ? ` ${detail.ref_id}` : ""}
          </div>
          {detail.shade_risk && (
            <div style={{ padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13,
                          background: detail.shade_approved_at ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
                          border: `1px solid ${detail.shade_approved_at ? "var(--green-deep)" : "var(--crit-dim)"}` }}>
              Spans {detail.lot_count} dye lots — shades will not match between them.{" "}
              {detail.shade_approved_at
                ? `Approved by ${detail.shade_approved_by} on ${fmtDate(detail.shade_approved_at)}.`
                : "Not yet approved; it cannot be dispatched."}
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Roll</th><th style={th}>Dye lot</th><th style={th}>Grade</th>
              <th style={th}>Warehouse</th><th style={thNum}>Weight</th><th style={th}>Released</th>
            </tr></thead>
            <tbody>
              {(detail.rolls || []).map(r => (
                <tr key={r.line_id} style={{ opacity: r.released_at ? 0.45 : 1 }}>
                  <td style={td}>{r.roll_id}</td>
                  <td style={td}>{r.batch_number || r.batch_id}</td>
                  <td style={td}>{r.quality_grade || "—"}</td>
                  <td style={td}>{r.warehouse_status}</td>
                  <td style={tdNum}>{kg(r.weight_kg)}</td>
                  <td style={td}>{r.released_at ? fmtDate(r.released_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.notes && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>{detail.notes}</div>}
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
      <div onClick={e => e.stopPropagation()} style={{ ...card, width: "min(820px,100%)", marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ color: "var(--yellow)", margin: 0 }}>{title}</h3>
          <button style={btn("var(--surface)", "var(--text)")} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
