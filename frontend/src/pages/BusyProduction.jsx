// Push production to Busy, shift by shift.
//
// The flow mirrors what an accountant actually does: pick a period, see the
// shifts that have not been sent yet, generate the batch (which claims those
// rolls so they can never be sent twice), download the CSV, import it into
// Busy, then mark it confirmed. If a Busy import fails, void the batch to
// release its rolls and try again.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600 };
const td = { padding: "8px 10px", textAlign: "left", fontSize: 13, borderTop: "1px solid var(--surface)" };
const numTd = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const input = { padding: "8px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6 };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "8px 15px", fontWeight: 600, fontSize: 13, cursor: "pointer" });

const firstOfMonth = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—");
const STATUS_COLOR = { EXPORTED: "var(--gold)", CONFIRMED: "var(--green)", VOIDED: "var(--muted)" };

export default function BusyProduction() {
  const [range, setRange] = useState({ from: firstOfMonth(), to: new Date().toISOString().slice(0, 10) });
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 6000); };

  const loadPreview = useCallback(async () => {
    setErr("");
    try {
      const q = new URLSearchParams();
      if (range.from) q.set("from", range.from);
      if (range.to) q.set("to", range.to);
      const r = await fetch(`${API}/api/busy-sync/production/preview?${q}`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setPreview(j);
    } catch (e) { setErr(e.message); }
  }, [range]);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/busy-sync/production/history`, { headers: auth() });
      const j = await r.json();
      if (r.ok) setHistory(Array.isArray(j) ? j : []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadPreview(); }, [loadPreview]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const download = async (batchId) => {
    try {
      const r = await fetch(`${API}/api/busy-sync/production/${batchId}/csv`, { headers: auth() });
      if (!r.ok) throw new Error(`Download failed (${r.status})`);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `busy_production_${batchId}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { setErr(e.message); }
  };

  const generate = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await fetch(`${API}/api/busy-sync/production/export`, {
        method: "POST", headers: jsonH(), body: JSON.stringify(range),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      if (j.empty) { flash("Nothing new to export for this period."); }
      else {
        flash(`Exported ${j.total_rolls} rolls in ${j.lines.length} shift lines. Downloading the Busy CSV…`);
        await download(j.batch_id);
      }
      loadPreview(); loadHistory();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const act = async (batchId, path, body, okMsg) => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/busy-sync/production/${batchId}/${path}`, {
        method: "POST", headers: jsonH(), body: JSON.stringify(body || {}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      flash(okMsg);
      loadPreview(); loadHistory();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Production → Busy</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Each shift's production, pushed to Busy as a stock-in. Busy holds the aggregate quantity; the roll
        detail stays here and travels in the reference. A shift is exported once and can never be sent twice.
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginBottom: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      <div style={{ ...card, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input type="date" style={input} value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
        <span style={{ color: "var(--muted)" }}>to</span>
        <input type="date" style={input} value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
        <button style={btn("var(--surface)", "var(--text)")} onClick={loadPreview}>Preview</button>
        <button style={btn("var(--yellow)", "#000")} disabled={busy || !preview?.total_rolls} onClick={generate}>
          {busy ? "Working…" : `Export ${preview?.total_rolls || 0} rolls to Busy`}
        </button>
      </div>

      {preview && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
            Not yet sent — {preview.total_rolls} rolls, {preview.total_kg} kg, {preview.shifts} shift{preview.shifts === 1 ? "" : "s"}
          </div>
          {!preview.lines.length ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>Every produced shift in this period has already been exported.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead><tr>
                  <th style={th}>Date</th><th style={th}>Shift</th><th style={th}>Item</th>
                  <th style={{ ...th, textAlign: "right" }}>Rolls</th><th style={{ ...th, textAlign: "right" }}>Qty (kg)</th>
                </tr></thead>
                <tbody>
                  {preview.lines.map((l, i) => (
                    <tr key={i}>
                      <td style={td}>{day(l.production_date)}</td>
                      <td style={td}>{l.shift}</td>
                      <td style={td}>{l.fabric_type}</td>
                      <td style={numTd}>{l.roll_count}</td>
                      <td style={numTd}>{l.total_kg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{ ...card, marginTop: 14 }}>
        <div style={{ color: "var(--yellow)", fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Export history</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead><tr>
              <th style={th}>#</th><th style={th}>Generated</th><th style={th}>Period</th>
              <th style={{ ...th, textAlign: "right" }}>Rolls</th><th style={{ ...th, textAlign: "right" }}>Kg</th>
              <th style={th}>Status</th><th style={th}>Busy ref</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {!history.length && <tr><td colSpan={8} style={{ ...td, color: "var(--muted)" }}>No exports yet.</td></tr>}
              {history.map(b => (
                <tr key={b.batch_id}>
                  <td style={td}>{b.batch_id}</td>
                  <td style={td}>{new Date(b.generated_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')}</td>
                  <td style={{ ...td, color: "var(--muted)", fontSize: 12 }}>{day(b.from_date)}–{day(b.to_date)}</td>
                  <td style={numTd}>{b.roll_count}</td>
                  <td style={numTd}>{Number(b.total_kg)}</td>
                  <td style={{ ...td, color: STATUS_COLOR[b.status], fontWeight: 600, fontSize: 12 }}>{b.status}</td>
                  <td style={{ ...td, fontSize: 12 }}>{b.busy_ref || "—"}</td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button style={{ ...btn("var(--surface)", "var(--yellow)"), padding: "5px 10px" }} onClick={() => download(b.batch_id)}>CSV</button>
                    {b.status === "EXPORTED" && (
                      <>
                        <button style={{ ...btn("var(--bg)", "var(--green)"), padding: "5px 10px", marginLeft: 6 }}
                          onClick={() => { const ref = window.prompt("Busy voucher ref (optional):", ""); act(b.batch_id, "confirm", { busy_ref: ref || null }, "Marked confirmed in Busy."); }}>
                          Confirm
                        </button>
                        <button style={{ ...btn("var(--crit-dim)", "var(--crit)"), padding: "5px 10px", marginLeft: 6 }}
                          onClick={() => { if (window.confirm("Void this batch and release its rolls to be re-sent? Use this only if the Busy import failed.")) act(b.batch_id, "void", { reason: "Busy import failed" }, "Batch voided; rolls released."); }}>
                          Void
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 10, lineHeight: 1.6 }}>
          <b style={{ color: "var(--text)" }}>Confirm</b> once the CSV is imported into Busy — a confirmed batch can no
          longer be voided, so the same production can never reach Busy twice. <b style={{ color: "var(--text)" }}>Void</b>
          {" "}only if the import failed; it releases the rolls to be exported again.
        </div>
      </div>
    </div>
  );
}
