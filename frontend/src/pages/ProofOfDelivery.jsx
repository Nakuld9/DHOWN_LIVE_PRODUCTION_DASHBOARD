// Proof of delivery.
//
// Built mobile-first and registered at two routes: /m/pod for whoever confirms
// receipt with a phone in their hand, and /pod inside the office layout for
// seeing what is still out. It is one component because it is one task at two
// desks — a second implementation would be a second set of bugs.
//
// Recording a POD closes the dispatch and stops it being reported as an
// in-transit compliance risk. REFUSED deliberately does NOT count as delivered:
// those goods are coming back and belong in the returns queue.

import React, { useEffect, useState, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const auth = () => ({ Authorization: `Bearer ${tok()}` });

const rupee = n => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—";

const wrap = { minHeight: "100vh", background: "var(--surface)", color: "var(--text)", padding: 16, boxSizing: "border-box" };
const bigInp = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, color: "var(--text)", fontSize: 17, boxSizing: "border-box", marginBottom: 12 };
const bigBtn = (bg, fg = "var(--bg)") => ({ width: "100%", background: bg, color: fg, border: "none", borderRadius: 12, padding: 16, fontSize: 18, fontWeight: 700, cursor: "pointer" });
const lbl = { color: "var(--muted)", fontSize: 13, marginBottom: 6, display: "block" };
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 12 };

// The four ways a delivery ends. Colour carries the meaning so it reads at a
// glance on a phone in daylight.
const CONDITIONS = [
  { c: "OK", label: "Received in full", colour: "var(--green)" },
  { c: "SHORT", label: "Short delivery", colour: "var(--gold)" },
  { c: "DAMAGED", label: "Damaged", colour: "var(--idle)" },
  { c: "REFUSED", label: "Refused — coming back", colour: "var(--crit)" },
];

// How long a consignment has been out, as a colour. Anything past a few days
// without confirmation is worth chasing.
const outColour = d => (d >= 5 ? "var(--crit)" : d >= 3 ? "var(--gold)" : "var(--muted)");

export default function ProofOfDelivery({ standalone = false }) {
  const [authed, setAuthed] = useState(!!tok());
  const [pending, setPending] = useState([]);
  const [unresolved, setUnresolved] = useState([]);
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const flash = (m, ok = true) => { setMsg((ok ? "✓ " : "✗ ") + m); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(async () => {
    if (!tok()) { setLoading(false); return; }
    setLoading(true);
    try {
      const [p, u] = await Promise.all([
        fetch(`${API}/api/logistics/pod/pending`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/logistics/pod/unresolved`, { headers: auth() }).then(r => r.json()),
      ]);
      setPending(Array.isArray(p) ? p : []);
      setUnresolved(Array.isArray(u) ? u : []);
    } catch { setPending([]); setUnresolved([]); }
    setLoading(false);
  }, []);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  const open = (d) => {
    setSel(d);
    setForm({ received_by: "", condition: "OK", shortage_kg: "", remarks: "" });
  };

  const submit = async () => {
    if (form.condition === "SHORT" && !(Number(form.shortage_kg) > 0)) {
      return flash("A short delivery needs the shortage quantity", false);
    }
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/logistics/pod/${sel.dispatch_id}`, {
        method: "POST", headers: h(),
        body: JSON.stringify({ ...form, shortage_kg: Number(form.shortage_kg) || 0 }),
      });
      const d = await r.json();
      if (!r.ok) flash(d.error || "Could not record", false);
      else {
        flash(d.delivery_status === "REFUSED"
          ? `${sel.dispatch_number} marked REFUSED — the goods are coming back, raise a return`
          : `${sel.dispatch_number} confirmed delivered`);
        setSel(null); setForm(null); await load();
      }
    } catch (e) { flash(e.message, false); }
    setSaving(false);
  };

  if (standalone && !authed) return <Login onLogin={() => setAuthed(true)} />;

  const body = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: 0, fontSize: standalone ? 22 : 24 }}>📦 Proof of Delivery</h2>
        <button style={{ background: "var(--surface)", color: "var(--text)", border: "none", borderRadius: 8, padding: "8px 12px", fontWeight: "bold", cursor: "pointer" }}
                onClick={load}>↻</button>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>
        Consignments that have left but not been confirmed as received.
      </div>

      {msg && (
        <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, fontSize: 15,
                      background: msg.startsWith("✓") ? "var(--green-dim)" : "var(--crit-dim)",
                      border: `1px solid ${msg.startsWith("✓") ? "var(--green-deep)" : "var(--crit-dim)"}` }}>{msg}</div>
      )}

      {loading && <div style={card}>Loading…</div>}

      {!!unresolved.length && (
        <div style={{ ...card, borderColor: "var(--crit-dim)" }}>
          <div style={{ color: "var(--crit)", fontWeight: "bold", fontSize: 16 }}>
            {unresolved.length} consignment{unresolved.length === 1 ? "" : "s"} coming back
          </div>
          <div style={{ color: "var(--muted)", fontSize: 13, margin: "4px 0 10px" }}>
            Refused, short or damaged, with no sales return raised yet. They are off the pending
            list — nothing else will show them until a return is created.
          </div>
          {unresolved.map(u => (
            <div key={u.dispatch_id} style={{ borderTop: "1px solid rgba(22,52,93,0.6)", paddingTop: 10, marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div style={{ color: "var(--yellow)", fontWeight: "bold" }}>{u.dispatch_number}</div>
                  <div style={{ fontSize: 14 }}>{u.customer_name || "—"}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 3 }}>
                    {u.condition}
                    {Number(u.shortage_kg) > 0 && ` · ${u.shortage_kg} kg short`}
                    {u.received_by && ` · signed ${u.received_by}`}
                  </div>
                  {u.remarks && <div style={{ color: "var(--muted)", fontSize: 12 }}>{u.remarks}</div>}
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div style={{ fontVariantNumeric: "tabular-nums" }}>{rupee(u.grand_total)}</div>
                  <div style={{ color: outColour(Number(u.days_since)), fontSize: 13, fontWeight: "bold", marginTop: 3 }}>
                    {Number(u.days_since) === 0 ? "today" : `${u.days_since}d ago`}
                  </div>
                </div>
              </div>
              <a href="/returns" style={{ display: "block", textAlign: "center", textDecoration: "none",
                        ...bigBtn("var(--crit)", "#fff"), marginTop: 10, padding: 11, fontSize: 15 }}>
                Raise sales return
              </a>
            </div>
          ))}
        </div>
      )}

      {!loading && !pending.length && (
        <div style={{ ...card, borderColor: "var(--green-deep)", textAlign: "center", padding: 28 }}>
          <div style={{ color: "var(--green)", fontWeight: "bold", fontSize: 17 }}>Nothing out</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
            Every dispatch has been confirmed received.
          </div>
        </div>
      )}

      {pending.map(d => (
        <div key={d.dispatch_id} style={card} onClick={() => open(d)} role="button">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: 16 }}>{d.dispatch_number}</div>
              <div style={{ fontSize: 15, marginTop: 2 }}>{d.customer_name || "—"}</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                {fmtDate(d.dispatch_date)}
                {d.vehicle_number && ` · ${d.vehicle_number}`}
                {d.transporter_name && ` · ${d.transporter_name}`}
              </div>
              {d.eway_no && (
                <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                  E-way {d.eway_no}
                  {d.valid_until && new Date(d.valid_until) < new Date() && (
                    <span style={{ color: "var(--crit)", fontWeight: "bold" }}> · EXPIRED</span>
                  )}
                </div>
              )}
            </div>
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <div style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{rupee(d.grand_total)}</div>
              <div style={{ color: outColour(Number(d.days_out)), fontSize: 13, fontWeight: "bold", marginTop: 4 }}>
                {Number(d.days_out) === 0 ? "today" : `${d.days_out}d out`}
              </div>
            </div>
          </div>
          <button style={{ ...bigBtn("var(--yellow)"), marginTop: 12, padding: 12, fontSize: 16 }}
                  onClick={e => { e.stopPropagation(); open(d); }}>
            Confirm delivery
          </button>
        </div>
      ))}
    </>
  );

  return (
    <>
      <div style={standalone ? wrap : { padding: 20, color: "var(--text)", maxWidth: 900 }}>{body}</div>

      {sel && form && (
        <div onClick={() => setSel(null)}
             style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000,
                      display: "flex", alignItems: "flex-end", justifyContent: "center", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()}
               style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px 16px 0 0",
                        padding: 18, width: "min(560px,100%)", maxHeight: "92vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h3 style={{ color: "var(--yellow)", margin: 0 }}>{sel.dispatch_number}</h3>
              <button style={{ background: "var(--surface)", color: "var(--text)", border: "none", borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}
                      onClick={() => setSel(null)}>✕</button>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>{sel.customer_name}</div>

            <label style={lbl}>How did it arrive?</label>
            <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
              {CONDITIONS.map(c => (
                <button key={c.c}
                        onClick={() => setForm(f => ({ ...f, condition: c.c }))}
                        style={{ textAlign: "left", padding: 14, borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: "pointer",
                                 background: form.condition === c.c ? c.colour : "var(--surface)",
                                 color: form.condition === c.c ? "var(--bg)" : "var(--text)",
                                 border: `1px solid ${form.condition === c.c ? c.colour : "var(--surface-2)"}` }}>
                  {c.label}
                </button>
              ))}
            </div>

            {form.condition === "SHORT" && (
              <>
                <label style={lbl}>How many kg short? *</label>
                <input style={bigInp} type="number" inputMode="decimal" value={form.shortage_kg}
                       onChange={e => setForm(f => ({ ...f, shortage_kg: e.target.value }))} />
              </>
            )}

            {form.condition === "REFUSED" && (
              <div style={{ padding: 12, borderRadius: 10, marginBottom: 12, background: "rgba(239,68,68,0.10)", border: "1px solid var(--crit-dim)", fontSize: 14 }}>
                This will <b>not</b> be marked delivered — the goods are coming back. Raise a sales return
                once they are physically here.
              </div>
            )}

            <label style={lbl}>Received by</label>
            <input style={bigInp} value={form.received_by} placeholder="Name of the person who took delivery"
                   onChange={e => setForm(f => ({ ...f, received_by: e.target.value }))} />

            <label style={lbl}>Remarks</label>
            <input style={bigInp} value={form.remarks}
                   onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />

            <button style={{ ...bigBtn(CONDITIONS.find(c => c.c === form.condition).colour, "var(--bg)"), opacity: saving ? 0.6 : 1 }}
                    disabled={saving} onClick={submit}>
              {saving ? "Saving…" : "Record delivery"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Only used on the standalone /m/pod route, where there is no app shell to have
// logged the user in already.
function Login({ onLogin }) {
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await fetch(`${API}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      });
      const j = await r.json();
      if (!r.ok || !j.token) { setErr(j.error || "Login failed"); setBusy(false); return; }
      localStorage.setItem("dhown_token", j.token);
      onLogin();
    } catch { setErr("Cannot reach server"); setBusy(false); }
  };
  return (
    <div style={wrap}>
      <div style={{ textAlign: "center", margin: "40px 0 24px" }}>
        <div style={{ color: "var(--yellow)", fontSize: 26, fontWeight: 700 }}>DHOWN DELIVERY</div>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>Confirm what has been received</div>
      </div>
      {err && <div style={{ background: "#ef444422", border: "1px solid var(--crit)", color: "var(--crit)", padding: 12, borderRadius: 10, marginBottom: 12, fontSize: 14 }}>{err}</div>}
      <input style={bigInp} placeholder="Username" value={u} onChange={e => setU(e.target.value)} autoCapitalize="off" />
      <input style={bigInp} type="password" placeholder="Password" value={p}
             onChange={e => setP(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
      <button style={{ ...bigBtn("var(--yellow)"), opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
        {busy ? "Signing in…" : "Sign In"}
      </button>
    </div>
  );
}
