// Invoice OCR — upload a supplier invoice / order PDF, let the AI extract the
// supplier, invoice no/date, line items and totals, review/edit them, then draft a
// GRN header from it (which goes through the normal GRN approval on the GRN screen).
// The extraction reads only; nothing is created until you click "Draft GRN".

import React, { useState } from "react";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const input = { padding: "8px 10px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, width: "100%" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer" });
const label = { color: "var(--muted)", fontSize: 12, marginBottom: 4, display: "block" };

// DD-MM-YYYY (what the AI returns) → YYYY-MM-DD (what the GRN date field wants).
const toISO = (d) => {
  const m = String(d || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};
const money = (n) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

async function readJson(r) {
  const t = await r.text();
  try { return JSON.parse(t); }
  catch { throw new Error(r.ok ? "Unexpected response from the server." : `Server error (${r.status}).`); }
}

export default function InvoiceOCR() {
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [ex, setEx] = useState(null);          // extracted, editable
  const [excerpt, setExcerpt] = useState("");

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 8000); };

  const onFile = async (file) => {
    if (!file) return;
    setErr(""); setMsg(""); setEx(null); setExcerpt(""); setFileName(file.name);
    const isImg = /\.(jpe?g|png|webp)$/i.test(file.name) || /^image\//.test(file.type || "");
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    if (!isImg && !isPdf) { setErr("Choose a PDF, or a JPG/PNG/WEBP photo of the invoice."); return; }
    setBusy(true);
    try {
      const b64 = await new Promise((res, rej) => {
        const rd = new FileReader();
        rd.onload = () => res(String(rd.result).split(",")[1]);
        rd.onerror = () => rej(new Error("Could not read the file."));
        rd.readAsDataURL(file);
      });
      const payload = isImg ? { image_base64: b64, mime: file.type || "image/jpeg" } : { pdf_base64: b64 };
      const r = await fetch(`${API}/api/ocr/invoice`, { method: "POST", headers: jsonH(), body: JSON.stringify(payload) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      if (!j.ok) { setErr(j.error || "Could not extract this document."); return; }
      setEx(j.extracted); setExcerpt(j.raw_excerpt || "");
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const setField = (k, v) => setEx((p) => ({ ...p, [k]: v }));
  const setItem = (i, k, v) => setEx((p) => ({ ...p, items: p.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }));

  const draftGrn = async () => {
    if (!ex?.supplier_name) { setErr("A supplier name is required to draft a GRN."); return; }
    setBusy(true); setErr("");
    try {
      const notes = [
        `Drafted from OCR of ${ex.doc_type || "document"}${ex.invoice_no ? ` ${ex.invoice_no}` : ""}${ex.invoice_date ? ` dated ${ex.invoice_date}` : ""}.`,
        ...(ex.items || []).map((it) => `• ${it.description}${it.quantity ? ` — ${it.quantity}${it.unit || ""}` : ""}${it.rate ? ` @ ${it.rate}` : ""}${it.amount ? ` = ${it.amount}` : ""}`),
        ex.total_amount != null ? `Total: ${ex.total_amount}` : "",
      ].filter(Boolean).join("\n");
      const body = {
        supplier_name: ex.supplier_name,
        supplier_invoice: ex.invoice_no || null,
        receipt_date: toISO(ex.invoice_date) || new Date().toISOString().slice(0, 10),
        notes,
      };
      const r = await fetch(`${API}/api/grn`, { method: "POST", headers: jsonH(), body: JSON.stringify(body) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      flash(`Draft GRN created${j.grn_number ? ` — ${j.grn_number}` : ""}. Open the GRN screen to add lots and approve it.`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 20, color: "var(--text)", maxWidth: 980, margin: "0 auto" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Invoice OCR</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Upload a supplier invoice or order — a digital <b>PDF</b> (text extracted) or a <b>photo / scan</b> (JPG/PNG, read by a vision model). The AI extracts supplier, invoice details, line items and totals to review, then you can draft a GRN. Nothing is created until you click <b>Draft GRN</b>.
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <label style={btn("var(--surface)", "var(--link)")}>
          {busy ? "Working…" : "Choose PDF or photo"}
          <input type="file" accept="application/pdf,.pdf,image/*" style={{ display: "none" }} disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {fileName && <span style={{ marginLeft: 12, color: "var(--muted)", fontSize: 13 }}>{fileName}</span>}
      </div>

      {err && <div style={{ ...card, borderColor: "var(--crit)", color: "var(--crit-edge)", marginBottom: 16 }}>{err}</div>}
      {msg && <div style={{ ...card, borderColor: "var(--green)", color: "var(--green-edge)", marginBottom: 16 }}>{msg}</div>}

      {ex && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
            <div><label style={label}>Supplier</label><input style={input} value={ex.supplier_name || ""} onChange={(e) => setField("supplier_name", e.target.value)} /></div>
            <div><label style={label}>GSTIN</label><input style={input} value={ex.supplier_gstin || ""} onChange={(e) => setField("supplier_gstin", e.target.value)} /></div>
            <div><label style={label}>Type</label><input style={input} value={ex.doc_type || ""} onChange={(e) => setField("doc_type", e.target.value)} /></div>
            <div><label style={label}>Invoice / Order No.</label><input style={input} value={ex.invoice_no || ""} onChange={(e) => setField("invoice_no", e.target.value)} /></div>
            <div><label style={label}>Date (DD-MM-YYYY)</label><input style={input} value={ex.invoice_date || ""} onChange={(e) => setField("invoice_date", e.target.value)} /></div>
            <div><label style={label}>Currency</label><input style={input} value={ex.currency || ""} onChange={(e) => setField("currency", e.target.value)} /></div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                  <th style={{ padding: 6 }}>Description</th><th style={{ padding: 6 }}>HSN</th>
                  <th style={{ padding: 6 }}>Qty</th><th style={{ padding: 6 }}>Unit</th>
                  <th style={{ padding: 6 }}>Rate</th><th style={{ padding: 6 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {(ex.items || []).map((it, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: 4, minWidth: 220 }}><input style={input} value={it.description || ""} onChange={(e) => setItem(i, "description", e.target.value)} /></td>
                    <td style={{ padding: 4 }}><input style={{ ...input, width: 80 }} value={it.hsn || ""} onChange={(e) => setItem(i, "hsn", e.target.value)} /></td>
                    <td style={{ padding: 4 }}><input style={{ ...input, width: 70 }} value={it.quantity ?? ""} onChange={(e) => setItem(i, "quantity", e.target.value)} /></td>
                    <td style={{ padding: 4 }}><input style={{ ...input, width: 60 }} value={it.unit || ""} onChange={(e) => setItem(i, "unit", e.target.value)} /></td>
                    <td style={{ padding: 4 }}><input style={{ ...input, width: 80 }} value={it.rate ?? ""} onChange={(e) => setItem(i, "rate", e.target.value)} /></td>
                    <td style={{ padding: 4 }}><input style={{ ...input, width: 100 }} value={it.amount ?? ""} onChange={(e) => setItem(i, "amount", e.target.value)} /></td>
                  </tr>
                ))}
                {(!ex.items || ex.items.length === 0) && <tr><td colSpan={6} style={{ padding: 8, color: "var(--muted)" }}>No line items were detected.</td></tr>}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 24, marginTop: 14, color: "var(--muted)", fontSize: 13 }}>
            <div>Subtotal: <b>{money(ex.subtotal)}</b></div>
            <div>Tax: <b>{money(ex.tax_amount)}</b></div>
            <div>Total: <b style={{ color: "var(--yellow)" }}>{money(ex.total_amount)}</b></div>
          </div>

          <div style={{ marginTop: 18 }}>
            <button style={btn("var(--yellow)", "var(--surface)")} disabled={busy} onClick={draftGrn}>Draft GRN from this</button>
            <span style={{ marginLeft: 12, color: "var(--muted)", fontSize: 12 }}>Creates a GRN header awaiting approval; add received lots on the GRN screen.</span>
          </div>
        </div>
      )}

      {excerpt && (
        <details style={{ ...card, color: "var(--muted)", fontSize: 12 }}>
          <summary style={{ cursor: "pointer" }}>Extracted text (first 600 chars)</summary>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{excerpt}</pre>
        </details>
      )}
    </div>
  );
}
