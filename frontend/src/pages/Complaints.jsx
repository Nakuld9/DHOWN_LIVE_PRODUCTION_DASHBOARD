// Customer complaints.
//
// Built as a worklist, not an archive: open and overdue first, because the only
// reason to open this screen is to deal with something. The stats band is
// second — one complaint is an incident, twenty about the same category is a
// process problem, and that is the thing worth acting on.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const auth = () => ({ Authorization: `Bearer ${tok()}` });
const jsonH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "9px 10px", textAlign: "left", fontSize: 13, borderTop: "1px solid var(--surface)" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "7px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" });
const input = { width: "100%", padding: "9px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, boxSizing: "border-box" };
const label = { color: "var(--muted)", fontSize: 12, display: "block", marginBottom: 4, marginTop: 10 };

const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—");

const SEVERITY_COLOR = { CRITICAL: "var(--crit)", HIGH: "var(--idle)", MEDIUM: "var(--gold)", LOW: "var(--muted)" };
const STATUS_COLOR = {
  OPEN: "var(--crit)", INVESTIGATING: "var(--gold)", RESOLVED: "var(--green)",
  REJECTED: "var(--muted)", CLOSED: "var(--border)",
};

export default function Complaints() {
  const [meta, setMeta] = useState(null);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState({ status: "", category: "", overdue: false });
  const [partners, setPartners] = useState([]);
  const [open, setOpen] = useState(null);      // the complaint being viewed
  const [showNew, setShowNew] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  const load = useCallback(async () => {
    setErr("");
    try {
      const q = new URLSearchParams();
      if (filter.status) q.set("status", filter.status);
      if (filter.category) q.set("category", filter.category);
      if (filter.overdue) q.set("overdue", "true");
      const [l, s] = await Promise.all([
        fetch(`${API}/api/complaints?${q}`, { headers: auth() }).then(r => r.json()),
        fetch(`${API}/api/complaints/stats`, { headers: auth() }).then(r => r.json()),
      ]);
      if (l.error) throw new Error(l.error);
      setItems(Array.isArray(l) ? l : []);
      setStats(s && !s.error ? s : null);
    } catch (e) { setErr(e.message); }
  }, [filter]);

  useEffect(() => {
    fetch(`${API}/api/complaints/meta`, { headers: auth() }).then(r => r.json()).then(setMeta).catch(() => {});
    fetch(`${API}/api/erp/partners`, { headers: auth() })
      .then(r => r.json())
      .then(d => setPartners(d.data || d.partners || (Array.isArray(d) ? d : [])))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const openOne = async (id) => {
    try {
      const r = await fetch(`${API}/api/complaints/${id}`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setOpen(j);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Complaints</h2>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Open and overdue first. Anything logged here is chased; anything in a WhatsApp thread is not.
          </div>
        </div>
        <button style={btn("var(--yellow)", "#000")} onClick={() => setShowNew(true)}>+ Log a complaint</button>
      </div>

      {err && <div style={{ ...card, marginTop: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginTop: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginTop: 14 }}>
          <KPI title="OPEN" value={stats.totals.open} color={stats.totals.open ? "var(--crit)" : "var(--green)"} />
          <KPI title="OVERDUE" value={stats.totals.overdue} color={stats.totals.overdue ? "var(--crit)" : "var(--green)"} />
          <KPI title="RESOLVED" value={stats.totals.resolved} color="var(--green)" />
          <KPI title="TOTAL" value={stats.totals.total} />
          <KPI title="AVG DAYS TO RESOLVE"
               value={stats.totals.avg_days_to_resolve == null ? "—" : stats.totals.avg_days_to_resolve} />
        </div>
      )}

      {stats && stats.by_category.length > 0 && (
        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>By category</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {stats.by_category.map(c => (
              <button key={c.category}
                      onClick={() => setFilter(f => ({ ...f, category: f.category === c.category ? "" : c.category }))}
                      style={{ ...btn(filter.category === c.category ? "var(--yellow)" : "var(--surface)",
                                      filter.category === c.category ? "#000" : "var(--text)"), fontSize: 12 }}>
                {c.category.replace(/_/g, " ").toLowerCase()} · <b>{c.n}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ ...card, marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
                style={{ ...input, width: "auto" }}>
          <option value="">All statuses</option>
          {["OPEN", "INVESTIGATING", "RESOLVED", "REJECTED", "CLOSED"].map(s => <option key={s}>{s}</option>)}
        </select>
        <label style={{ color: "var(--muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={filter.overdue}
                 onChange={e => setFilter(f => ({ ...f, overdue: e.target.checked }))} />
          Overdue only
        </label>
        {(filter.status || filter.category || filter.overdue) && (
          <button style={btn("var(--surface)", "var(--text)")}
                  onClick={() => setFilter({ status: "", category: "", overdue: false })}>Clear</button>
        )}
      </div>

      <div style={{ ...card, marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead>
            <tr>{["No.", "Raised", "Customer", "Summary", "Category", "Severity", "Status", "Due", "Owner"]
              .map(h => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {!items.length && (
              <tr><td colSpan={9} style={{ ...td, color: "var(--muted)" }}>
                No complaints{filter.status || filter.category || filter.overdue ? " match this filter" : " — nothing outstanding"}.
              </td></tr>
            )}
            {items.map(c => (
              <tr key={c.complaint_id} onClick={() => openOne(c.complaint_id)}
                  style={{ cursor: "pointer", background: c.overdue ? "rgba(239,68,68,0.07)" : "transparent" }}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{c.complaint_no}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{day(c.raised_on)}</td>
                <td style={td}>{c.company_name || "—"}</td>
                <td style={{ ...td, maxWidth: 280 }}>{c.summary}</td>
                <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>{(c.category || "").replace(/_/g, " ")}</td>
                <td style={{ ...td, color: SEVERITY_COLOR[c.severity] || "var(--text)", fontWeight: 600, fontSize: 12 }}>
                  {c.severity}
                </td>
                <td style={{ ...td, color: STATUS_COLOR[c.status] || "var(--text)", fontWeight: 600, fontSize: 12 }}>
                  {c.status}
                </td>
                <td style={{ ...td, color: c.overdue ? "var(--crit)" : "var(--muted)", whiteSpace: "nowrap", fontSize: 12 }}>
                  {day(c.due_date)}{c.overdue ? " ⚠" : ""}
                </td>
                <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>{c.assigned_to || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew && meta && (
        <NewComplaint
          meta={meta} partners={partners} busy={busy} setBusy={setBusy}
          onClose={() => setShowNew(false)}
          onDone={(no) => { setShowNew(false); flash(`Logged as ${no}.`); load(); }}
          onError={setErr}
        />
      )}

      {open && meta && (
        <Detail
          c={open} meta={meta} busy={busy} setBusy={setBusy}
          onClose={() => setOpen(null)}
          onChanged={async (m) => { flash(m); await openOne(open.complaint_id); load(); }}
          onError={setErr}
        />
      )}
    </div>
  );
}

function KPI({ title, value, color }) {
  return (
    <div style={card}>
      <div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: color || "var(--text)" }}>{value}</div>
    </div>
  );
}

function Modal({ children, onClose, width = 620 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex",
                  alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60 }}>
      <div style={{ ...card, width: "100%", maxWidth: width, maxHeight: "86vh", overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}

function NewComplaint({ meta, partners, busy, setBusy, onClose, onDone, onError }) {
  const [f, setF] = useState({
    partner_id: "", summary: "", detail: "", category: "QUALITY",
    severity: "MEDIUM", source: "PHONE", lot_number: "", roll_id: "",
  });
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/complaints`, {
        method: "POST", headers: jsonH(),
        body: JSON.stringify({ ...f, partner_id: Number(f.partner_id) || null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      onDone(j.complaint.complaint_no);
    } catch (e) { onError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 16 }}>Log a complaint</div>
        <button style={btn("var(--surface)", "var(--text)")} onClick={onClose}>✕</button>
      </div>

      <label style={label}>Customer *</label>
      <select style={input} value={f.partner_id} onChange={set("partner_id")}>
        <option value="">Select a customer…</option>
        {partners.map(p => <option key={p.partner_id} value={p.partner_id}>{p.company_name}</option>)}
      </select>

      <label style={label}>What is the problem? *</label>
      <input style={input} value={f.summary} onChange={set("summary")}
             placeholder="e.g. Barre visible across the roll face" maxLength={300} />

      <label style={label}>Detail</label>
      <textarea style={{ ...input, minHeight: 80 }} value={f.detail} onChange={set("detail")}
                placeholder="Anything useful: how many rolls, which shade, what the customer said." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
        <div>
          <label style={label}>Category</label>
          <select style={input} value={f.category} onChange={set("category")}>
            {meta.categories.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Severity</label>
          <select style={input} value={f.severity} onChange={set("severity")}>
            {meta.severities.map(s => <option key={s} value={s}>{s} — due in {meta.sla_days[s]}d</option>)}
          </select>
        </div>
        <div>
          <label style={label}>Heard via</label>
          <select style={input} value={f.source} onChange={set("source")}>
            {meta.sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={label}>Lot number</label>
          <input style={input} value={f.lot_number} onChange={set("lot_number")} placeholder="optional" />
        </div>
        <div>
          <label style={label}>Roll</label>
          <input style={input} value={f.roll_id} onChange={set("roll_id")} placeholder="optional" />
        </div>
      </div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
        Lot and roll are optional — log it now and fill them in when you know. An unrecorded complaint is worse
        than an incomplete one.
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button style={btn("var(--green)", "#000")} disabled={busy || !f.summary || !f.partner_id} onClick={submit}>
          {busy ? "Saving…" : "Log it"}
        </button>
        <button style={btn("var(--surface)", "var(--text)")} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function Detail({ c, meta, busy, setBusy, onClose, onChanged, onError }) {
  const [note, setNote] = useState("");
  const [res, setRes] = useState({ resolution_type: "", resolution: "", root_cause: "" });

  const act = async (path, body, okMsg) => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/complaints/${c.complaint_id}${path}`, {
        method: path === "/status" || path === "/assign" ? "PUT" : "POST",
        headers: jsonH(), body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      onChanged(okMsg);
      setNote("");
    } catch (e) { onError(e.message); }
    finally { setBusy(false); }
  };

  const move = (to) => {
    if (to === "RESOLVED") {
      if (!res.resolution_type || !res.resolution.trim()) {
        onError("Say how it was resolved before marking it resolved.");
        return;
      }
      return act("/status", { status: to, ...res }, "Marked resolved.");
    }
    act("/status", { status: to, note }, `Moved to ${to}.`);
  };

  return (
    <Modal onClose={onClose} width={720}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 16 }}>{c.complaint_no}</div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
            {c.company_name} · {day(c.raised_on)} · {(c.category || "").replace(/_/g, " ")} ·{" "}
            <span style={{ color: SEVERITY_COLOR[c.severity] }}>{c.severity}</span> ·{" "}
            <span style={{ color: STATUS_COLOR[c.status] }}>{c.status}</span>
            {c.overdue && <span style={{ color: "var(--crit)" }}> · overdue</span>}
          </div>
        </div>
        <button style={btn("var(--surface)", "var(--text)")} onClick={onClose}>✕</button>
      </div>

      <div style={{ marginTop: 14, fontSize: 14, fontWeight: 600 }}>{c.summary}</div>
      {c.detail && <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>{c.detail}</div>}

      {(c.lot_number || c.roll_id || c.invoice_number || c.dispatch_number) && (
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
          {c.invoice_number && <>Invoice {c.invoice_number} · </>}
          {c.dispatch_number && <>Dispatch {c.dispatch_number} · </>}
          {c.lot_number && <>Lot {c.lot_number} · </>}
          {c.roll_id && <>Roll {c.roll_id}</>}
        </div>
      )}

      {c.resolution && (
        <div style={{ ...card, marginTop: 12, borderColor: "var(--green-dim)" }}>
          <div style={{ color: "var(--green)", fontSize: 12, fontWeight: 600 }}>
            Resolved — {(c.resolution_type || "").replace(/_/g, " ").toLowerCase()}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{c.resolution}</div>
          {c.root_cause && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>Root cause: {c.root_cause}</div>}
        </div>
      )}

      {/* Only the transitions the state machine actually allows are offered. */}
      {c.allowed_transitions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>Next step</div>

          {c.allowed_transitions.includes("RESOLVED") && (
            <div style={{ ...card, marginBottom: 10 }}>
              <div style={{ color: "var(--green)", fontSize: 12, fontWeight: 600 }}>To resolve, say how</div>
              <select style={{ ...input, marginTop: 8 }} value={res.resolution_type}
                      onChange={e => setRes(r => ({ ...r, resolution_type: e.target.value }))}>
                <option value="">What was done…</option>
                {meta.resolutions.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
              </select>
              <input style={{ ...input, marginTop: 8 }} placeholder="What was done for the customer"
                     value={res.resolution} onChange={e => setRes(r => ({ ...r, resolution: e.target.value }))} />
              <input style={{ ...input, marginTop: 8 }} placeholder="Root cause (optional, but this is what stops it recurring)"
                     value={res.root_cause} onChange={e => setRes(r => ({ ...r, root_cause: e.target.value }))} />
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {c.allowed_transitions.map(t => (
              <button key={t} disabled={busy} onClick={() => move(t)}
                      style={btn(t === "RESOLVED" ? "var(--green)" : t === "REJECTED" ? "var(--crit-dim)" : "var(--surface)",
                                 t === "RESOLVED" ? "#000" : "var(--text)")}>
                {t === "OPEN" ? "Reopen" : t.charAt(0) + t.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 6 }}>History</div>
        <div style={{ borderLeft: "2px solid var(--surface)", paddingLeft: 12 }}>
          {c.events.map(e => (
            <div key={e.event_id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13 }}>
                {e.kind === "STATUS" && e.from_status && (
                  <span style={{ color: "var(--muted)" }}>{e.from_status} → </span>
                )}
                {e.to_status && <b style={{ color: STATUS_COLOR[e.to_status] || "var(--text)" }}>{e.to_status}</b>}
                {e.note && <span>{e.to_status ? " · " : ""}{e.note}</span>}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 11 }}>
                {new Date(e.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')} · {e.created_by || "system"}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input style={input} value={note} onChange={e => setNote(e.target.value)}
                 placeholder="Add a note — what you found, who you spoke to" />
          <button style={btn("var(--surface)", "var(--text)")} disabled={busy || !note.trim()}
                  onClick={() => act("/notes", { note }, "Note added.")}>Add</button>
        </div>
      </div>
    </Modal>
  );
}
