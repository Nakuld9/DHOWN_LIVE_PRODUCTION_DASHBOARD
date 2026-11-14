// Busy READ BRIDGE (Phase 1) — mirror + reconciliation.
// Shows the MES-side Trial Balance (rebuilt from the imported Busy masters) against
// Busy's own TB, which must match to the rupee. Busy stays the statutory book of
// record; this is the parallel-run / cutover-readiness view. Read-only w.r.t. Busy.
import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });
const inr = (n) => (n === null || n === undefined || n === "" ? "—" : "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dt = (s) => (s ? new Date(s).toLocaleString("en-GB") : "—");

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 };
const label = { color: "var(--muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 7, padding: "7px 14px", fontWeight: 600, fontSize: 12, cursor: "pointer" });
const th = { padding: "7px 8px", textAlign: "right", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid var(--border)" };
const td = { padding: "5px 8px", fontSize: 12, borderTop: "1px solid var(--border)", textAlign: "right" };
const tdL = { ...td, textAlign: "left" };

function Stat({ k, v, sub, good }) {
  return (
    <div style={{ ...card, marginBottom: 0, padding: 14 }}>
      <div style={label}>{k}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: good === undefined ? "var(--text)" : good ? "var(--ok,#1a8a3a)" : "var(--crit,#c0392b)" }}>{v}</div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function BusyReconcile() {
  const [imports, setImports] = useState([]);
  const [recon, setRecon] = useState(null);
  const [sel, setSel] = useState(null);
  const [msg, setMsg] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);

  const loadImports = useCallback(async () => {
    const r = await fetch(`${API}/api/acct/busy/imports`, { headers: auth() }).then((x) => x.json()).catch(() => []);
    setImports(Array.isArray(r) ? r : []);
  }, []);

  const loadRecon = useCallback(async (id) => {
    const q = id ? `/${id}` : "";
    const r = await fetch(`${API}/api/acct/busy/reconcile${q}`, { headers: auth() }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r && !r.error) { setRecon(r); setSel(r.import_id); } else { setRecon(null); setMsg(r?.error || "No import yet — run the Windows extractor and ingest."); }
  }, []);

  useEffect(() => { loadImports(); loadRecon(null); }, [loadImports, loadRecon]);

  const doImport = async () => {
    let obj;
    try { obj = JSON.parse(paste); } catch { setMsg("That is not valid JSON."); return; }
    setBusy(true); setMsg("Importing…");
    const r = await fetch(`${API}/api/acct/busy/import`, { method: "POST", headers: jsonH(), body: JSON.stringify(obj) });
    const d = await r.json();
    setBusy(false);
    if (r.ok) { setMsg(d.duplicate ? "Already imported (deduped)." : `Imported — reconciled_ok=${d.reconciliation?.ok}`); setPaste(""); await loadImports(); await loadRecon(d.import_id || null); }
    else setMsg(d.error || "Import failed.");
  };

  const doPoll = async () => {
    setBusy(true); setMsg("Polling drop folder…");
    const r = await fetch(`${API}/api/acct/busy/poll`, { method: "POST", headers: jsonH() });
    setBusy(false);
    setMsg(r.ok ? "Drop folder polled." : "Poll failed (BUSY_INBOX_DIR set?).");
    await loadImports(); await loadRecon(null);
  };

  const C = recon?.checks || {};
  const ok = recon?.ok;

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: ".04em" }}>Busy Read Bridge — Reconciliation</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
        MES mirrors Busy's chart of accounts + Trial Balance (extracted on Windows from the <code>.bds</code>) and
        rebuilds a MES-side TB that must equal Busy's <b>to the rupee</b>. Busy stays the statutory book; this is the
        parallel-run foundation. MES never writes to Busy.
      </p>

      {msg && <div style={{ ...card, color: "var(--muted)", fontSize: 13 }}>{msg}</div>}

      {recon && (
        <>
          <div style={{ ...card, borderColor: ok ? "var(--ok,#1a8a3a)" : "var(--crit,#c0392b)", background: ok ? "rgba(26,138,58,.08)" : "rgba(192,57,43,.08)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: ok ? "var(--ok,#1a8a3a)" : "var(--crit,#c0392b)" }}>
              {ok ? "✓ RECONCILED — MES Trial Balance matches Busy to the rupee" : "✗ VARIANCE — review below"}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
              {recon.busy_company} {recon.busy_gstin ? `· ${recon.busy_gstin}` : ""} · {recon.fy_db} · extracted {dt(recon.extracted_at)} · import #{recon.import_id}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 16 }}>
            <Stat k="MES Trial Balance" v={inr(recon.mes_tb.debit)} sub={`Dr = Cr · diff ${recon.mes_tb.diff}`} good={C.tb_balanced} />
            <Stat k="Busy Trial Balance" v={inr(recon.busy_tb.debit)} sub={`${recon.mes_tb.accounts} accounts`} />
            <Stat k="TB Variance (Dr / Cr)" v={`${recon.difference.debit} / ${recon.difference.credit}`} good={C.matches_busy_debit && C.matches_busy_credit} />
            <Stat k="Net Profit" v={inr(recon.profit_and_loss.net_profit)} sub={`variance ${recon.difference.net_profit}`} good={C.net_profit_matches_busy} />
            <Stat k="Balance Sheet" v={C.balance_sheet_balances ? "Balanced" : "Out by " + recon.balance_sheet.diff} sub={`assets ${inr(recon.balance_sheet.assets)}`} good={C.balance_sheet_balances} />
            <Stat k="Classification" v={C.no_classification_variance ? "Matches Busy" : `${recon.classification_variances.length} differ`} good={C.no_classification_variance} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={card}>
              <div style={{ ...label, marginBottom: 8 }}>Balance Sheet — by primary group</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={{ ...th, textAlign: "left" }}>Group</th><th style={th}>Debit</th><th style={th}>Credit</th></tr></thead>
                <tbody>{(recon.breakdown.balance_sheet || []).map((g) => (
                  <tr key={g.primary}><td style={tdL}>{g.primary} <span style={{ color: "var(--muted)" }}>({g.nature})</span></td><td style={td}>{inr(g.debit)}</td><td style={td}>{inr(g.credit)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div style={card}>
              <div style={{ ...label, marginBottom: 8 }}>Profit &amp; Loss — by primary group</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={{ ...th, textAlign: "left" }}>Group</th><th style={th}>Debit</th><th style={th}>Credit</th></tr></thead>
                <tbody>{(recon.breakdown.profit_and_loss || []).map((g) => (
                  <tr key={g.primary}><td style={tdL}>{g.primary} <span style={{ color: "var(--muted)" }}>({g.nature})</span></td><td style={td}>{inr(g.debit)}</td><td style={td}>{inr(g.credit)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          {recon.classification_variances?.length > 0 && (
            <div style={{ ...card, borderColor: "var(--crit,#c0392b)" }}>
              <div style={{ ...label, marginBottom: 8, color: "var(--crit,#c0392b)" }}>Classification variances (MES vs Busy)</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={{ ...th, textAlign: "left" }}>Ledger</th><th style={{ ...th, textAlign: "left" }}>MES</th><th style={{ ...th, textAlign: "left" }}>Busy</th></tr></thead>
                <tbody>{recon.classification_variances.map((v) => (<tr key={v.code}><td style={tdL}>{v.name}</td><td style={tdL}>{v.mes}</td><td style={tdL}>{v.busy}</td></tr>))}</tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div style={card}>
        <div style={{ ...label, marginBottom: 8 }}>Imports</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <button style={btn("var(--accent,#1a8a3a)", "#fff")} onClick={doPoll} disabled={busy}>Poll drop folder</button>
          <button style={btn("var(--surface)", "var(--text)")} onClick={() => { loadImports(); loadRecon(null); }} disabled={busy}>Refresh</button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>#</th><th style={{ ...th, textAlign: "left" }}>Company</th><th style={{ ...th, textAlign: "left" }}>FY file</th><th style={th}>Extracted</th><th style={th}>OK</th><th style={th}></th></tr></thead>
          <tbody>{imports.map((i) => (
            <tr key={i.import_id} style={{ background: sel === i.import_id ? "var(--bg)" : "transparent" }}>
              <td style={tdL}>{i.import_id}</td>
              <td style={tdL}>{i.busy_company || "—"}</td>
              <td style={tdL}>{i.fy_db || "—"}</td>
              <td style={td}>{dt(i.extracted_at)}</td>
              <td style={{ ...td, color: i.reconciled_ok ? "var(--ok,#1a8a3a)" : "var(--crit,#c0392b)" }}>{i.reconciled_ok ? "✓" : "✗"}</td>
              <td style={td}><button style={btn("var(--surface)", "var(--text)")} onClick={() => loadRecon(i.import_id)}>Reconcile</button></td>
            </tr>
          ))}{imports.length === 0 && <tr><td style={tdL} colSpan={6}>No imports yet. Run <code>tools/busy-bridge/extract-busy.ps1</code> and drop the JSON into the inbox, or paste it below.</td></tr>}</tbody>
        </table>
      </div>

      <div style={card}>
        <div style={{ ...label, marginBottom: 8 }}>Import an extract (paste busy-mirror/v1 JSON)</div>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder='{"schema":"busy-mirror/v1", ...}'
          style={{ width: "100%", height: 90, background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 7, padding: 8, fontSize: 12, fontFamily: "monospace", boxSizing: "border-box" }} />
        <div style={{ marginTop: 8 }}><button style={btn("var(--accent,#1a8a3a)", "#fff")} onClick={doImport} disabled={busy || !paste.trim()}>Import &amp; reconcile</button></div>
      </div>
    </div>
  );
}
