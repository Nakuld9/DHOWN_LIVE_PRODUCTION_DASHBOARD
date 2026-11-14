// Bank reconciliation.
//
// The screen is built around the two exception lists, because those are the
// only rows anyone acts on: money we recorded that the bank has not seen, and
// money the bank has that we never recorded. Everything else — the matched
// lines, the balance — is there to prove the exceptions are complete.
//
// CSV parsing happens here rather than on the server because every bank exports
// a different shape, and the column mapping should be something the user can
// see and correct rather than a guess made out of sight.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const jsonHeaders = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });
const auth = () => ({ Authorization: `Bearer ${tok()}` });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const money = (v) => (v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : "—");

const th = { padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const thL = { ...th, textAlign: "left" };
const td = { padding: "8px 10px", textAlign: "right", fontSize: 13, fontVariantNumeric: "tabular-nums", borderTop: "1px solid var(--surface)" };
const tdL = { ...td, textAlign: "left" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "7px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" });

// ── CSV ────────────────────────────────────────────────────────────────────
// Handles quoted fields and embedded commas, which bank exports do use.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

// Indian bank statements are overwhelmingly DD/MM/YYYY. Guessing wrong turns
// 03/04 into the wrong month, so ISO is detected explicitly and everything else
// is read day-first.
function toIsoDate(s) {
  const v = String(s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(v);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const num = (s) => {
  const v = String(s ?? "").replace(/[₹,\s]/g, "").trim();
  if (!v || v === "-") return 0;
  return Math.abs(Number(v)) || 0;
};

const GUESS = {
  txn_date: ["date", "txn date", "transaction date", "value date", "tran date"],
  description: ["description", "narration", "particulars", "remarks", "details"],
  reference: ["ref", "reference", "utr", "cheque", "chq", "ref no", "reference no"],
  debit: ["debit", "withdrawal", "dr", "withdrawal amt", "paid out"],
  credit: ["credit", "deposit", "cr", "deposit amt", "paid in"],
  balance: ["balance", "closing balance", "running balance"],
};

function guessMapping(header) {
  const lower = header.map(h => String(h || "").trim().toLowerCase());
  const out = {};
  for (const [field, names] of Object.entries(GUESS)) {
    const i = lower.findIndex(h => names.some(n => h === n)) >= 0
      ? lower.findIndex(h => names.some(n => h === n))
      : lower.findIndex(h => names.some(n => h.includes(n)));
    out[field] = i >= 0 ? i : -1;
  }
  return out;
}

export default function BankReconciliation() {
  const [accounts, setAccounts] = useState([]);
  const [acct, setAcct] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // import state
  const [csv, setCsv] = useState(null);         // { header, rows, mapping }
  const [picking, setPicking] = useState(null); // { line, candidates }

  // Deliberately depends on nothing: the current selection is read through the
  // functional setState form rather than closed over, so this can run once on
  // mount without going stale or re-creating itself on every selection change.
  const loadAccounts = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/bank/accounts`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setAccounts(j);
      setAcct(cur => (cur == null && j.length ? j[0].account_id : cur));
    } catch (e) { setErr(e.message); }
  }, []);

  const loadSummary = useCallback(async () => {
    if (acct == null) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/bank/accounts/${acct}/summary`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setData(j);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }, [acct]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 5000); };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const rows = parseCsv(await f.text());
    if (rows.length < 2) { setErr("That file has no data rows."); return; }
    setErr("");
    setCsv({ header: rows[0], rows: rows.slice(1), mapping: guessMapping(rows[0]) });
  };

  // Host-to-host statement file: the bank's own MT940 / CAMT.053 / CSV file is sent
  // raw and the server parses, imports and auto-reconciles it in one step. Read-only
  // — it brings money IN; nothing is ever sent to the bank.
  const onH2HFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f || acct == null) return;
    e.target.value = "";
    setBusy(true); setErr("");
    try {
      // .xls/.xlsx are binary (Union Bank / ICICI export legacy .xls) — send base64
      // so the bytes survive; text formats (MT940/CAMT/CSV) go as plain text.
      const isBinary = /\.(xls|xlsx)$/i.test(f.name);
      const body = { filename: f.name, auto_match: true };
      if (isBinary) {
        const buf = new Uint8Array(await f.arrayBuffer());
        let s = ""; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
        body.content_base64 = btoa(s);
      } else {
        body.content = await f.text();
      }
      const r = await fetch(`${API}/api/bank/accounts/${acct}/ingest-file`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      if (j.duplicate_file) flash(`"${f.name}" was already ingested — nothing to add.`);
      else flash(`${j.format}: ${j.rows_parsed} lines read, ${j.inserted} new, ${j.auto_matched} auto-matched.`);
      loadSummary();
    } catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  const mappedRows = () => {
    if (!csv) return [];
    const m = csv.mapping;
    return csv.rows.map(r => ({
      txn_date: toIsoDate(r[m.txn_date]),
      description: m.description >= 0 ? r[m.description] : "",
      reference: m.reference >= 0 ? r[m.reference] : "",
      debit: m.debit >= 0 ? num(r[m.debit]) : 0,
      credit: m.credit >= 0 ? num(r[m.credit]) : 0,
      balance: m.balance >= 0 ? num(r[m.balance]) : null,
    }));
  };

  const doImport = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/bank/accounts/${acct}/import`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({ rows: mappedRows() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Import failed (${r.status})`);
      flash(`Imported ${j.inserted} line${j.inserted === 1 ? "" : "s"}` +
        (j.duplicates ? `, skipped ${j.duplicates} already present` : "") +
        (j.rejected?.length ? `, rejected ${j.rejected.length}` : ""));
      setCsv(null);
      loadSummary();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const doAutoMatch = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/bank/accounts/${acct}/auto-match`, { method: "POST", headers: jsonHeaders(), body: "{}" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      flash(`Matched ${j.matched}. ${j.ambiguous.length} need a decision, ${j.unmatched} have no candidate.`);
      loadSummary();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const openPicker = async (line) => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/bank/lines/${line.line_id}/candidates`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setPicking(j);
    } catch (e) { setErr(e.message); }
  };

  const confirmMatch = async (paymentId) => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/bank/lines/${picking.line.line_id}/match`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({ payment_id: paymentId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setPicking(null); flash("Matched."); loadSummary();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Bank Reconciliation</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Proves recorded receipts against the bank statement. The two lists below are what needs action.
      </div>

      {!accounts.length && (
        <div style={{ ...card, borderColor: "var(--gold-deep)" }}>
          No bank account set up yet. An administrator can add one from this page's API
          (<code>POST /api/bank/accounts</code>) with the account name and its opening balance.
        </div>
      )}

      {accounts.length > 0 && (
        <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <select value={acct ?? ""} onChange={(e) => setAcct(Number(e.target.value))}
                  style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>
            {accounts.map(a => (
              <option key={a.account_id} value={a.account_id}>
                {a.account_name}{a.bank_name ? ` — ${a.bank_name}` : ""} ({a.lines} lines)
              </option>
            ))}
          </select>
          <label style={{ ...btn("var(--surface)", "var(--text)"), display: "inline-block" }}>
            Import statement (CSV)
            <input type="file" accept=".csv,text/csv" onChange={onFile} style={{ display: "none" }} />
          </label>
          <label style={{ ...btn("var(--border)", "var(--text)"), display: "inline-block" }}
                 title="Bank host-to-host file: MT940, CAMT.053 (XML) or CSV — parsed, imported and auto-reconciled in one step (read-only)">
            Import bank file (H2H)
            <input type="file" accept=".txt,.sta,.mt940,.940,.xml,.camt,.csv,.dat,.xls,.xlsx" onChange={onH2HFile} style={{ display: "none" }} />
          </label>
          <button style={btn("var(--yellow)", "#000")} onClick={doAutoMatch} disabled={busy}>
            {busy ? "Working…" : "Auto-match"}
          </button>
          <button style={btn("var(--surface)", "var(--text)")} onClick={loadSummary} disabled={busy}>Refresh</button>
        </div>
      )}

      {err && <div style={{ ...card, marginTop: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginTop: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      {/* How-to: loading statements. Two ways in — upload, or drop a file in the
          account's watched folder. Read-only: nothing is ever sent to the bank. */}
      {accounts.length > 0 && (() => {
        const sel = accounts.find(a => a.account_id === acct) || {};
        return (
          <details style={{ ...card, marginTop: 12 }}>
            <summary style={{ cursor: "pointer", color: "var(--yellow)", fontWeight: 700, fontSize: 13 }}>
              How to load a statement (bank → MES, read-only)
            </summary>
            <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginTop: 10 }}>
              Statements flow <b>in</b> only — this reconciles what the bank reports. Nothing is ever sent to the bank, and no money moves from here.
              <div style={{ margin: "10px 0 4px", color: "var(--text)", fontWeight: 600 }}>Two ways to load:</div>
              <ol style={{ margin: "0 0 4px 18px", padding: 0 }}>
                <li><b>Upload now</b> — click <i>Import bank file (H2H)</i> above and pick the file. Formats: <code>.xls / .xlsx</code> (Union Bank net-banking export), CSV, MT940 or CAMT.053. It parses, imports and auto-reconciles in one step.</li>
                <li style={{ marginTop: 6 }}><b>Automatic drop-folder</b> — save the file into this account's folder and it ingests itself within ~5 minutes, then moves to a <code>processed\</code> subfolder.
                  {sel.inbox_dir
                    ? <div style={{ marginTop: 6 }}>Folder for <b>{sel.account_name}</b>:<br /><code style={{ background: "var(--surface)", padding: "3px 7px", borderRadius: 5, display: "inline-block", marginTop: 3, fontSize: 12.5 }}>{sel.inbox_dir}</code></div>
                    : <div style={{ marginTop: 6, color: "var(--gold)" }}>No drop-folder set for this account yet — an admin can configure one (<code>PATCH /api/bank/accounts/:id</code> with <code>inbox_dir</code>).</div>}
                </li>
              </ol>
              <div style={{ marginTop: 8 }}>Keep each account's statements in its own folder — that's how the system knows which account they belong to. Re-loading a file you've already imported is a safe no-op.</div>
            </div>
          </details>
        );
      })()}

      {/* Column mapping — shown before anything is sent, so a wrong guess is
          the user's to correct rather than a silent import of nonsense. */}
      {csv && (
        <div style={{ ...card, marginTop: 12 }}>
          <div style={{ color: "var(--yellow)", fontWeight: 700, marginBottom: 8 }}>
            Check the columns ({csv.rows.length} rows)
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {Object.keys(GUESS).map(field => (
              <label key={field} style={{ fontSize: 12, color: "var(--muted)" }}>
                {field}<br />
                <select value={csv.mapping[field]}
                        onChange={(e) => setCsv({ ...csv, mapping: { ...csv.mapping, [field]: Number(e.target.value) } })}
                        style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", marginTop: 4 }}>
                  <option value={-1}>— none —</option>
                  {csv.header.map((h, i) => <option key={i} value={i}>{h || `column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>{["Date", "Description", "Reference", "Debit", "Credit"].map((h, i) => <th key={h} style={i < 3 ? thL : th}>{h}</th>)}</tr></thead>
              <tbody>
                {mappedRows().slice(0, 3).map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...tdL, color: r.txn_date ? "var(--text)" : "var(--crit)" }}>{r.txn_date || "unreadable date"}</td>
                    <td style={tdL}>{r.description}</td>
                    <td style={tdL}>{r.reference}</td>
                    <td style={td}>{r.debit ? money(r.debit) : ""}</td>
                    <td style={td}>{r.credit ? money(r.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button style={btn("var(--green)", "#000")} onClick={doImport} disabled={busy}>
              Import {csv.rows.length} rows
            </button>
            <button style={btn("var(--surface)", "var(--text)")} onClick={() => setCsv(null)}>Cancel</button>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
            Re-importing a statement you have already loaded is safe — lines already present are skipped.
          </div>
        </div>
      )}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginTop: 14 }}>
            <KPI title="BANK BALANCE" value={money(data.bank_balance)} sub="opening + credits − debits" />
            <KPI title="RECONCILED" value={`${data.statement.matched_lines} / ${data.statement.credit_lines}`} sub="credit lines matched" />
            <KPI title="RECEIPTS NOT IN BANK" value={money(data.difference.receipts_not_in_bank)}
                 color={data.difference.receipts_not_in_bank > 0 ? "var(--crit)" : "var(--green)"}
                 sub={`${data.unreconciled_receipts.length} receipts`} />
            <KPI title="BANK NOT IN RECEIPTS" value={money(data.difference.bank_not_in_receipts)}
                 color={data.difference.bank_not_in_receipts > 0 ? "var(--gold)" : "var(--green)"}
                 sub={`${data.unreconciled_lines.length} credits`} />
          </div>

          <div style={{ ...card, marginTop: 12, color: data.reconciled ? "var(--green)" : "var(--muted)", fontSize: 13 }}>
            {data.reconciled
              ? "✓ Fully reconciled — every receipt appears on the statement and every bank credit has a receipt."
              : "Not reconciled. Work the two lists below; each row is either money that never arrived, or money that arrived unrecorded."}
          </div>

          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ color: "var(--crit)", fontWeight: 700, marginBottom: 4 }}>
              Receipts we recorded that the bank has not seen
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
              The customer's balance has already been reduced by these. If one never arrives, we are not chasing money we are owed.
            </div>
            <Table
              head={["Receipt", "Date", "Customer", "Mode", "Reference", "Amount"]}
              rows={data.unreconciled_receipts.map(p => [
                p.receipt_no, day(p.payment_date), p.company_name || "—", p.mode || "—", p.reference || "—", money(p.amount),
              ])}
              leftCols={5}
              empty="None — every recorded receipt is on the statement."
            />
          </div>

          <div style={{ ...card, marginTop: 14 }}>
            <div style={{ color: "var(--gold)", fontWeight: 700, marginBottom: 4 }}>
              Bank credits with no receipt against them
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 10 }}>
              Money is in the account but no customer has been credited. Someone here has paid and is still being chased.
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead><tr>
                  {["Date", "Description", "Reference", "Credit", ""].map((h, i) => <th key={h || "act"} style={i < 3 ? thL : th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {!data.unreconciled_lines.length && (
                    <tr><td colSpan={5} style={{ ...tdL, color: "var(--muted)" }}>None — every bank credit has a receipt.</td></tr>
                  )}
                  {data.unreconciled_lines.map(l => (
                    <tr key={l.line_id}>
                      <td style={tdL}>{day(l.txn_date)}</td>
                      <td style={tdL}>{l.description || "—"}</td>
                      <td style={tdL}>{l.reference || "—"}</td>
                      <td style={td}>{money(l.credit)}</td>
                      <td style={td}>
                        <button style={btn("var(--surface)", "var(--yellow)")} onClick={() => openPicker(l)}>Find receipt</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {picking && (
        <Picker picking={picking} busy={busy} onPick={confirmMatch} onClose={() => setPicking(null)} />
      )}
    </div>
  );
}

function Picker({ picking, busy, onPick, onClose }) {
  const { line, candidates, note } = picking;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}>
      <div style={{ ...card, maxWidth: 720, width: "100%", maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "var(--yellow)", fontWeight: 700 }}>Match {money(line.credit)}</div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              {day(line.txn_date)} · {line.description || "no description"}{line.reference ? ` · ${line.reference}` : ""}
            </div>
          </div>
          <button style={btn("var(--surface)", "var(--text)")} onClick={onClose}>✕</button>
        </div>

        {note && <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>{note}</div>}

        {!note && !candidates.length && (
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>
            No receipt of {money(line.credit)} was recorded near this date. Either this money has not been
            entered yet, or it is not a customer receipt at all.
          </div>
        )}

        {candidates.length > 0 && (
          <>
            <div style={{ color: "var(--muted)", fontSize: 12, margin: "12px 0 8px" }}>
              Only receipts of exactly this amount are offered. Pick the one this credit belongs to.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Receipt", "Date", "Customer", "Reference", ""].map((h, i) => <th key={h || "a"} style={i < 4 ? thL : th}>{h}</th>)}</tr></thead>
              <tbody>
                {candidates.map(c => (
                  <tr key={c.payment_id}>
                    <td style={tdL}>{c.receipt_no}</td>
                    <td style={tdL}>{day(c.payment_date)}{c.day_gap ? ` (${c.day_gap}d)` : ""}</td>
                    <td style={tdL}>{c.company_name || "—"}</td>
                    <td style={tdL}>
                      {c.reference || "—"}
                      {c.reference_match && <span style={{ color: "var(--green)", marginLeft: 6 }}>✓ reference matches</span>}
                    </td>
                    <td style={td}>
                      <button style={btn("var(--green)", "#000")} disabled={busy} onClick={() => onPick(c.payment_id)}>Match</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function KPI({ title, value, sub, color }) {
  return (
    <div style={card}>
      <div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 4, color: color || "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Table({ head, rows, leftCols = 1, empty }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead><tr>{head.map((h, i) => <th key={h} style={i < leftCols ? thL : th}>{h}</th>)}</tr></thead>
        <tbody>
          {!rows.length && <tr><td colSpan={head.length} style={{ ...tdL, color: "var(--muted)" }}>{empty}</td></tr>}
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={j < leftCols ? tdL : td}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
