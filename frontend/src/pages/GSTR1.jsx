// GSTR-1 summary — outward supplies for a return period.
//
// Built for the hour before filing: pick the month, see the return split the
// way the portal wants it, and check it ties back to our own sales figure.
// The warnings band is the point of the screen — a missing HSN or a header
// that disagrees with its own lines is cheap to fix now and expensive after
// the return is filed.

import React, { useState } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");

const card = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "16px",
};

const money = (v) =>
  v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (v) => (v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 }));

const th = { padding: "8px 10px", textAlign: "right", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const thL = { ...th, textAlign: "left" };
const td = { padding: "7px 10px", textAlign: "right", fontSize: 13, fontVariantNumeric: "tabular-nums", borderTop: "1px solid var(--surface)" };
const tdL = { ...td, textAlign: "left" };

// First of the current month through today — the period an accountant wants.
const firstOfMonth = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

export default function GSTR1() {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("b2b");

  const load = async () => {
    setLoading(true); setErr(""); setData(null);
    try {
      const r = await fetch(`${API}/api/reports/gstr1?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setData(j);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const TABS = data ? [
    ["b2b", `B2B (${data.b2b.length})`],
    ["b2cl", `B2CL (${data.b2cl.length})`],
    ["b2cs", `B2CS (${data.b2cs.length})`],
    ["cdnr", `Credit notes (${data.cdnr.length + data.cdnur.length})`],
    ["hsn", `HSN (${data.hsn.length})`],
  ] : [];

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>GSTR-1 Summary</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Outward supplies from tax invoices. Prepared for checking a return before filing — not a portal upload.
      </div>

      <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          From<br />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                 style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          To<br />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                 style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 9px", marginTop: 4 }} />
        </label>
        <button onClick={load} disabled={loading}
                style={{ background: "var(--yellow)", color: "#000", border: "none", borderRadius: 6, padding: "9px 18px", fontWeight: 700, cursor: "pointer" }}>
          {loading ? "Loading…" : "Run"}
        </button>
        {data && (
          <button onClick={() => window.print()}
                  style={{ background: "var(--surface)", color: "var(--text)", border: "none", borderRadius: 6, padding: "9px 16px", cursor: "pointer" }}>
            Print
          </button>
        )}
      </div>

      {err && <div style={{ ...card, marginTop: 14, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}

      {data && (
        <>
          {/* Warnings first — they are the reason to look at this screen. */}
          {data.warnings.length > 0 && (
            <div style={{ ...card, marginTop: 14, borderColor: "var(--gold-deep)", background: "rgba(234,179,8,0.08)" }}>
              {data.warnings.map((w, i) => (
                <div key={i} style={{ color: "var(--gold)", fontSize: 13 }}>⚠ {w}</div>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginTop: 14 }}>
            <KPI title="INVOICES" value={data.totals.invoices} />
            <KPI title="TAXABLE VALUE" value={money(data.totals.taxable)} />
            <KPI title="CGST" value={money(data.totals.cgst)} />
            <KPI title="SGST" value={money(data.totals.sgst)} />
            <KPI title="IGST" value={money(data.totals.igst)} />
            <KPI title="TOTAL TAX" value={money(data.totals.total_tax)} color="var(--yellow)" />
          </div>

          <div style={{ ...card, marginTop: 12, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, fontSize: 13 }}>
            <span>
              Document series:{" "}
              <b>{data.documents.from_no || "—"}</b> to <b>{data.documents.to_no || "—"}</b>{" "}
              · {data.documents.issued} issued, {data.documents.cancelled} cancelled
            </span>
            <span style={{ color: data.reconciles ? "var(--green)" : "var(--crit)", fontWeight: 600 }}>
              {data.reconciles
                ? "✓ Sections reconcile with invoice totals"
                : "✗ Sections do not match invoice totals — check before filing"}
            </span>
          </div>

          {data.totals.credit_notes > 0 && (
            <div style={{ ...card, marginTop: 12, fontSize: 13 }}>
              {data.totals.credit_notes} credit note{data.totals.credit_notes === 1 ? "" : "s"} in this
              period reducing taxable value by <b>{money(data.totals.credit_note_taxable)}</b> and
              tax by <b>{money(data.totals.credit_note_tax)}</b>.
            </div>
          )}

          <div style={{ display: "flex", gap: 6, margin: "16px 0 10px", flexWrap: "wrap" }}>
            {TABS.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                      style={{
                        background: tab === k ? "var(--yellow)" : "var(--surface)",
                        color: tab === k ? "#000" : "var(--text)",
                        border: "none", borderRadius: 6, padding: "7px 14px",
                        fontWeight: 600, fontSize: 13, cursor: "pointer",
                      }}>
                {label}
              </button>
            ))}
          </div>

          <div style={{ ...card, overflowX: "auto" }}>
            {tab === "b2b" && (
              <Table
                head={["Invoice", "Date", "Customer", "GSTIN", "POS", "Rate", "Taxable", "CGST", "SGST", "IGST"]}
                rows={data.b2b.map(r => [
                  r.invoice_number, fmtDate(r.invoice_date), r.customer_name, r.gstin, r.place_of_supply,
                  `${r.gst_rate}%`, money(r.taxable), money(r.cgst), money(r.sgst), money(r.igst),
                ])}
                leftCols={5}
                empty="No B2B supplies in this period."
              />
            )}
            {tab === "b2cl" && (
              <Table
                head={["Invoice", "Date", "Customer", "POS", "Rate", "Taxable", "IGST", "Invoice value"]}
                rows={data.b2cl.map(r => [
                  r.invoice_number, fmtDate(r.invoice_date), r.customer_name, r.place_of_supply,
                  `${r.gst_rate}%`, money(r.taxable), money(r.igst), money(r.invoice_value),
                ])}
                leftCols={4}
                empty="No large inter-state unregistered sales in this period."
              />
            )}
            {tab === "b2cs" && (
              <Table
                head={["Type", "POS", "Rate", "Invoices", "Taxable", "CGST", "SGST", "IGST"]}
                rows={data.b2cs.map(r => [
                  r.type === "INTER" ? "Inter-state" : "Intra-state", r.place_of_supply, `${r.gst_rate}%`,
                  r.invoice_count, money(r.taxable), money(r.cgst), money(r.sgst), money(r.igst),
                ])}
                leftCols={2}
                empty="No small unregistered sales in this period."
              />
            )}
            {tab === "cdnr" && (
              <Table
                head={["Note", "Date", "Against invoice", "Customer", "GSTIN", "Taxable", "Tax", "Total"]}
                rows={[...data.cdnr, ...data.cdnur].map(r => [
                  r.note_number, fmtDate(r.note_date), r.against_invoice || "—", r.customer_name || "—",
                  r.gstin || "Unregistered", money(r.taxable), money(r.tax), money(r.total),
                ])}
                leftCols={5}
                empty="No credit notes in this period."
              />
            )}
            {tab === "hsn" && (
              <Table
                head={["HSN", "UoM", "Rate", "Quantity", "Taxable", "CGST", "SGST", "IGST"]}
                rows={data.hsn.map(r => [
                  r.hsn_code, r.uom, `${r.gst_rate}%`, qty(r.quantity),
                  money(r.taxable), money(r.cgst), money(r.sgst), money(r.igst),
                ])}
                leftCols={3}
                empty="No line items in this period."
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString('en-GB').split('/').join('-');
}

function KPI({ title, value, color }) {
  return (
    <div style={card}>
      <div style={{ color: "var(--muted)", fontSize: 11, letterSpacing: 0.4 }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: color || "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}

// leftCols = how many leading columns are text and should align left.
function Table({ head, rows, leftCols = 1, empty }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
      <thead>
        <tr>{head.map((h, i) => <th key={h} style={i < leftCols ? thL : th}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {!rows.length && (
          <tr><td colSpan={head.length} style={{ ...tdL, color: "var(--muted)" }}>{empty}</td></tr>
        )}
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} style={j < leftCols ? tdL : td}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
