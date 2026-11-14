// Data retention — what the nightly job would remove, and running it by hand.
//
// The endpoints existed with no screen, which meant the only way to see what
// retention was about to delete was to call the API directly. A destructive
// job nobody can inspect is a job nobody trusts.
//
// The apply button defaults to a dry run and requires a second, explicit
// confirmation, because this is the one screen in the system whose purpose is
// to delete things.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600 };
const td = { padding: "9px 10px", textAlign: "left", fontSize: 13, borderTop: "1px solid var(--surface)" };
const num = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "8px 15px", fontWeight: 600, fontSize: 13, cursor: "pointer" });

export default function Retention() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/settings/retention`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setRows(Array.isArray(j) ? j : (j.tables || j.report || []));
    } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (confirm) => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await fetch(`${API}/api/settings/retention/run`, {
        method: "POST", headers: jsonH(), body: JSON.stringify({ confirm }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setLastRun({ confirm, result: j });
      setMsg(confirm ? "Retention applied." : "Dry run complete — nothing was deleted.");
      setConfirming(false);
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const total = Array.isArray(rows) ? rows.reduce((s, r) => s + (Number(r.would_delete ?? r.expired ?? 0) || 0), 0) : 0;

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Data Retention</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        What the nightly job keeps and what it removes. Financial records are never in this list —
        invoices, receipts and credit notes are kept indefinitely.
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginBottom: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      <div style={{ ...card, overflowX: "auto" }}>
        {!rows && <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>}
        {rows && !rows.length && <div style={{ color: "var(--muted)", fontSize: 13 }}>No retention policies configured.</div>}
        {rows && rows.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr>
                <th style={th}>Table</th>
                <th style={th}>Keep for</th>
                <th style={{ ...th, textAlign: "right" }}>Rows</th>
                <th style={{ ...th, textAlign: "right" }}>Would remove</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const drop = Number(r.would_delete ?? r.expired ?? 0) || 0;
                return (
                  <tr key={r.table || i}>
                    <td style={td}>{r.table || r.table_name}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>
                      {r.keep_days ?? r.days ?? "—"} days
                    </td>
                    <td style={num}>{(r.total ?? r.rows ?? 0).toLocaleString("en-IN")}</td>
                    <td style={{ ...num, color: drop ? "var(--gold)" : "var(--muted)", fontWeight: drop ? 600 : 400 }}>
                      {drop.toLocaleString("en-IN")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ ...card, marginTop: 14 }}>
        <div style={{ fontSize: 13, marginBottom: 10 }}>
          {total > 0
            ? <>Running now would remove <b style={{ color: "var(--gold)" }}>{total.toLocaleString("en-IN")}</b> rows.</>
            : "Nothing is currently past its retention window."}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn("var(--surface)", "var(--text)")} disabled={busy} onClick={() => run(false)}>
            {busy ? "Working…" : "Dry run"}
          </button>
          {!confirming ? (
            <button style={btn("var(--crit-dim)", "var(--crit-edge)")} disabled={busy || !total}
                    onClick={() => setConfirming(true)}>
              Apply retention…
            </button>
          ) : (
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--crit)", fontSize: 13 }}>
                Delete {total.toLocaleString("en-IN")} rows permanently?
              </span>
              <button style={btn("var(--crit-dim)", "var(--crit-edge)")} disabled={busy} onClick={() => run(true)}>
                Yes, delete
              </button>
              <button style={btn("var(--surface)", "var(--text)")} onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          )}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 10 }}>
          The nightly job does this automatically. This screen is for seeing what it will do, and for
          running it early if the disk is filling.
        </div>
      </div>

      {lastRun && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            Last {lastRun.confirm ? "run" : "dry run"}
          </div>
          <pre style={{ margin: 0, fontSize: 12, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(lastRun.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
