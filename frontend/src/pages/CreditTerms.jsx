// Credit limits and payment terms across the customer book.
//
// The screen leads with how many customers have NO limit recorded, because that
// is the population where the credit gate is silently doing nothing — a limit of
// zero is not "no credit allowed", it is "nothing to enforce".
//
// Edits are staged and applied in one batch, and the API validates the whole
// batch before writing any of it: a half-applied change across a credit book is
// worse than a rejected one, because nobody can tell which half landed.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600 };
const td = { padding: "8px 10px", textAlign: "left", fontSize: 13, borderTop: "1px solid var(--surface)" };
const numTd = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const input = { padding: "6px 8px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, width: 110, textAlign: "right" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "8px 15px", fontWeight: 600, fontSize: 13, cursor: "pointer" });

const money = (v) => `₹${Number(v || 0).toLocaleString("en-IN")}`;

export default function CreditTerms() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [edits, setEdits] = useState({});      // partner_id -> { credit_limit, credit_days }
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (missingOnly) p.set("missing_only", "true");
      const r = await fetch(`${API}/api/wa/credit-terms?${p}`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setData(j);
    } catch (e) { setErr(e.message); }
  }, [q, missingOnly]);

  useEffect(() => { load(); }, [load]);

  const setEdit = (id, field, value) =>
    setEdits(e => ({ ...e, [id]: { ...e[id], [field]: value } }));

  const pending = Object.entries(edits).filter(([, v]) =>
    (v.credit_limit !== undefined && v.credit_limit !== "") ||
    (v.credit_days !== undefined && v.credit_days !== ""));

  const apply = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const changes = pending.map(([id, v]) => ({
        partner_id: Number(id),
        // Omitted rather than sent blank: the API leaves an omitted field
        // alone, so a blank box must not become a zero.
        ...(v.credit_limit !== undefined && v.credit_limit !== "" ? { credit_limit: Number(v.credit_limit) } : {}),
        ...(v.credit_days !== undefined && v.credit_days !== "" ? { credit_days: Number(v.credit_days) } : {}),
      }));
      const r = await fetch(`${API}/api/wa/credit-terms`, {
        method: "PUT", headers: jsonH(), body: JSON.stringify({ changes }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setMsg(`Updated ${j.updated} customer${j.updated === 1 ? "" : "s"}.`);
      setEdits({});
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Credit Limits &amp; Terms</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        A limit of zero means <b>no limit recorded</b>, not "no credit allowed" — the credit gate has
        nothing to enforce for those customers.
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginBottom: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
          <KPI title="CUSTOMERS" value={data.summary.total} />
          <KPI title="NO LIMIT SET" value={data.summary.no_limit}
               color={data.summary.no_limit ? "var(--gold)" : "var(--green)"} sub="gate cannot enforce" />
          <KPI title="NO TERMS SET" value={data.summary.no_terms}
               color={data.summary.no_terms ? "var(--gold)" : "var(--green)"} sub="nothing is ever overdue" />
          <KPI title="OVER LIMIT" value={data.summary.over_limit}
               color={data.summary.over_limit ? "var(--crit)" : "var(--green)"} />
          <KPI title="TOTAL EXPOSURE" value={money(data.summary.exposure)} />
        </div>
      )}

      <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input style={{ ...input, width: 240, textAlign: "left" }} placeholder="Search customer…"
               value={q} onChange={e => setQ(e.target.value)} />
        <label style={{ color: "var(--muted)", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)} />
          Only those with nothing set
        </label>
        {pending.length > 0 && (
          <>
            <span style={{ color: "var(--gold)", fontSize: 13 }}>
              {pending.length} unsaved change{pending.length === 1 ? "" : "s"}
            </span>
            <button style={btn("var(--green)", "#000")} disabled={busy} onClick={apply}>
              {busy ? "Applying…" : `Apply ${pending.length}`}
            </button>
            <button style={btn("var(--surface)", "var(--text)")} onClick={() => setEdits({})}>Discard</button>
          </>
        )}
      </div>

      <div style={{ ...card, marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
          <thead>
            <tr>
              <th style={th}>Customer</th>
              <th style={{ ...th, textAlign: "right" }}>Outstanding</th>
              <th style={{ ...th, textAlign: "right" }}>Credit limit</th>
              <th style={{ ...th, textAlign: "right" }}>Days</th>
              <th style={{ ...th, textAlign: "right" }}>Used</th>
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={5} style={{ ...td, color: "var(--muted)" }}>Loading…</td></tr>}
            {data && !data.customers.length && (
              <tr><td colSpan={5} style={{ ...td, color: "var(--muted)" }}>No customers match.</td></tr>
            )}
            {data && data.customers.map(c => {
              const e = edits[c.partner_id] || {};
              const dirty = (e.credit_limit !== undefined && e.credit_limit !== "") ||
                            (e.credit_days !== undefined && e.credit_days !== "");
              return (
                <tr key={c.partner_id} style={{ background: dirty ? "rgba(234,179,8,0.08)" : "transparent" }}>
                  <td style={td}>
                    {c.company_name}
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>
                      {c.partner_code}
                      {c.no_limit && <span style={{ color: "var(--gold)" }}> · no limit</span>}
                      {c.no_terms && <span style={{ color: "var(--gold)" }}> · no terms</span>}
                      {c.over_limit && <span style={{ color: "var(--crit)" }}> · OVER LIMIT</span>}
                    </div>
                  </td>
                  <td style={numTd}>{money(c.outstanding)}</td>
                  <td style={{ ...numTd }}>
                    <input style={input} placeholder={c.credit_limit ? String(c.credit_limit) : "not set"}
                           value={e.credit_limit ?? ""}
                           onChange={ev => setEdit(c.partner_id, "credit_limit", ev.target.value)} />
                  </td>
                  <td style={{ ...numTd }}>
                    <input style={{ ...input, width: 70 }} placeholder={c.credit_days ? String(c.credit_days) : "not set"}
                           value={e.credit_days ?? ""}
                           onChange={ev => setEdit(c.partner_id, "credit_days", ev.target.value)} />
                  </td>
                  <td style={{ ...numTd, color: c.over_limit ? "var(--crit)" : "var(--muted)" }}>
                    {c.utilisation === null ? "—" : `${c.utilisation}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 12, lineHeight: 1.6 }}>
        Leave a box blank to leave that value unchanged. Everything is validated before anything is
        written — one bad row rejects the whole batch, so a half-applied change is not possible.
      </div>
    </div>
  );
}

function KPI({ title, value, sub, color }) {
  return (
    <div style={card}>
      <div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: color || "var(--text)" }}>{value}</div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
