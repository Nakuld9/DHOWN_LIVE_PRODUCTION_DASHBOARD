// Shade Cards — maintain a colour master (name / code / hex) and generate a
// branded DHOWN shade card from real swatches (not AI-invented colours). The card
// is composed on a canvas so it exports to a crisp PNG and prints cleanly; the same
// swatches drive it, so shade 4021 is always the true 4021.

import React, { useState, useEffect, useCallback, useRef } from "react";
import logo from "../assets/images/dhown-logo.png";

const API = "";
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const jsonH = () => ({ "Content-Type": "application/json", ...auth() });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const input = { padding: "8px 10px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" });
const today = () => new Date().toLocaleDateString("en-GB").split("/").join("-");

async function readJson(r) { const t = await r.text(); try { return JSON.parse(t); } catch { throw new Error(r.ok ? "Bad response" : `Error ${r.status}`); } }

export default function ShadeCards() {
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState({});          // swatch_id -> included?
  const [company, setCompany] = useState({ company_name: "DHOWN HOSIERY MILLS" });
  const [form, setForm] = useState({ shade_name: "", shade_code: "", hex: "var(--link)", fabric_type: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const canvasRef = useRef(null);

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch(`${API}/api/shade-swatches`, { headers: auth() });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error || "Failed to load shades");
      setRows(j);
      setSel((prev) => { const n = {}; j.forEach((s) => { n[s.swatch_id] = prev[s.swatch_id] ?? true; }); return n; });
    } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch(`${API}/api/settings`).then((r) => r.json()).then((s) => setCompany(s || {})).catch(() => {});
  }, []);

  const add = async () => {
    if (!form.shade_name.trim()) { setErr("Shade name is required."); return; }
    if (!/^#[0-9a-fA-F]{6}$/.test(form.hex)) { setErr("Pick a valid colour."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`${API}/api/shade-swatches`, { method: "POST", headers: jsonH(), body: JSON.stringify(form) });
      const j = await readJson(r);
      if (!r.ok) throw new Error(j.error || "Could not add");
      setForm({ shade_name: "", shade_code: "", hex: "var(--link)", fabric_type: "" });
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  // Bulk import: one shade per line — "name, code, #hex" (code optional).
  const bulkImport = async () => {
    const rows = bulk.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
      const parts = l.split(",").map(p => p.trim());
      const hex = parts.find(p => /^#[0-9a-fA-F]{6}$/.test(p));
      const rest = parts.filter(p => p !== hex);
      return { shade_name: rest[0] || "", shade_code: rest[1] || "", hex };
    }).filter(r => r.shade_name && r.hex);
    if (!rows.length) { setErr("No valid lines. Use: name, code, #RRGGBB"); return; }
    setBusy(true); setErr("");
    let ok = 0;
    for (const r of rows) {
      try { const res = await fetch(`${API}/api/shade-swatches`, { method: "POST", headers: jsonH(), body: JSON.stringify(r) }); if (res.ok) ok++; } catch {}
    }
    setBusy(false); setBulk(""); setShowBulk(false); load();
    setErr(ok === rows.length ? "" : `Imported ${ok} of ${rows.length} — check the rest.`);
  };

  const del = async (id) => {
    if (!window.confirm("Delete this shade?")) return;
    try {
      const r = await fetch(`${API}/api/shade-swatches/${id}`, { method: "DELETE", headers: auth() });
      if (!r.ok) throw new Error((await readJson(r)).error || "Delete failed");
      load();
    } catch (e) { setErr(e.message); }
  };

  const chosen = rows.filter((s) => sel[s.swatch_id]);

  // Compose the branded card on a canvas. Returns the canvas (for PNG / print).
  const drawCard = useCallback(async () => {
    const swatches = chosen;
    const cols = 4;
    const rowsN = Math.max(1, Math.ceil(swatches.length / cols));
    const M = 48, HEAD = 150, CW = 210, CH = 150, GAP = 20, FOOT = 60;
    const W = M * 2 + cols * CW + (cols - 1) * GAP;
    const H = HEAD + rowsN * (CH + GAP) - GAP + FOOT + M;
    const scale = 2; // crisp export
    const cv = canvasRef.current;
    cv.width = W * scale; cv.height = H * scale;
    const ctx = cv.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);

    // Header band
    ctx.fillStyle = "var(--surface)"; ctx.fillRect(0, 0, W, HEAD);
    await new Promise((res) => {
      const img = new Image();
      img.onload = () => { const h = 84, w = (img.width / img.height) * h; ctx.drawImage(img, M, (HEAD - h) / 2, w, h); res(); };
      img.onerror = () => res();
      img.src = logo;
    });
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff"; ctx.font = "700 30px Arial";
    ctx.fillText(company.company_name || "DHOWN HOSIERY MILLS", M + 120, HEAD / 2 - 16);
    ctx.fillStyle = "var(--gold)"; ctx.font = "600 20px Arial";
    ctx.fillText("Fabric Shade Card", M + 120, HEAD / 2 + 16);
    ctx.fillStyle = "#9fb6d6"; ctx.font = "400 15px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`${company.email || ""}`, W - M, HEAD / 2 - 12);
    ctx.fillText(`Date: ${today()}`, W - M, HEAD / 2 + 12);
    ctx.textAlign = "left";

    // Swatch grid
    swatches.forEach((s, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = M + c * (CW + GAP), y = HEAD + GAP + r * (CH + GAP);
      ctx.fillStyle = s.hex; ctx.fillRect(x, y, CW, CH - 44);
      ctx.strokeStyle = "#d6deea"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, CW - 1, CH - 44 - 1);
      ctx.fillStyle = "var(--surface)"; ctx.font = "700 16px Arial"; ctx.textBaseline = "top";
      ctx.fillText(s.shade_name.slice(0, 22), x + 2, y + CH - 40);
      ctx.fillStyle = "#5b6b82"; ctx.font = "400 13px Arial";
      ctx.fillText([s.shade_code, s.hex.toUpperCase()].filter(Boolean).join("  ·  "), x + 2, y + CH - 20);
    });

    // Footer
    ctx.fillStyle = "#5b6b82"; ctx.font = "400 13px Arial"; ctx.textBaseline = "alphabetic";
    ctx.fillText(`${swatches.length} shade(s) · Colours indicative; approve against a physical swatch before bulk.`, M, H - 24);
    return cv;
  }, [chosen, company]);

  // Live preview: redraw whenever the selection or company details change.
  useEffect(() => { if (canvasRef.current) drawCard().catch(() => {}); }, [drawCard]);

  const downloadPng = async () => {
    if (!chosen.length) { setErr("Select at least one shade."); return; }
    setBusy(true); setErr("");
    try {
      const cv = await drawCard();
      const a = document.createElement("a");
      a.href = cv.toDataURL("image/png");
      a.download = `DHOWN-Shade-Card-${today()}.png`;
      a.click();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const printCard = async () => {
    if (!chosen.length) { setErr("Select at least one shade."); return; }
    const cv = await drawCard();
    const w = window.open("", "_blank");
    w.document.write(`<img src="${cv.toDataURL("image/png")}" style="width:100%" onload="window.print()"/>`);
    w.document.close();
  };

  return (
    <div style={{ padding: 20, color: "var(--text)", maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Shade Cards</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Maintain your colour shades, then generate a branded DHOWN shade card. Colours come from the real hex values you set here — approve against a physical swatch before bulk.
      </div>

      {err && <div style={{ ...card, borderColor: "var(--crit)", color: "var(--crit-edge)", marginBottom: 16 }}>{err}</div>}

      {/* Add a shade */}
      <div style={{ ...card, marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...input, width: 200 }} placeholder="Shade name (e.g. Royal Blue)" value={form.shade_name} onChange={(e) => setForm({ ...form, shade_name: e.target.value })} />
        <input style={{ ...input, width: 120 }} placeholder="Code (4021)" value={form.shade_code} onChange={(e) => setForm({ ...form, shade_code: e.target.value })} />
        <input style={{ ...input, width: 130 }} placeholder="Fabric (optional)" value={form.fabric_type} onChange={(e) => setForm({ ...form, fabric_type: e.target.value })} />
        <input type="color" value={form.hex} onChange={(e) => setForm({ ...form, hex: e.target.value })} style={{ width: 44, height: 38, background: "none", border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }} />
        <span style={{ color: "var(--muted)", fontSize: 12, fontFamily: "monospace" }}>{form.hex.toUpperCase()}</span>
        <button style={btn("var(--yellow)", "var(--surface)")} disabled={busy} onClick={add}>+ Add shade</button>
        <button style={btn("var(--surface)", "var(--muted)")} onClick={() => setShowBulk(s => !s)}>{showBulk ? "✕ Close import" : "⇪ Bulk import"}</button>
      </div>

      {showBulk && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>Paste one shade per line — <b style={{ color: "var(--text)" }}>name, code, #RRGGBB</b> (code optional). Example: <span style={{ fontFamily: "monospace" }}>Royal Blue, 4021, var(--surface)</span></div>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6} placeholder={"Royal Blue, 4021, var(--surface)\nJet Black, 9000, var(--surface)\nIvory, #f5f0e1"}
            style={{ ...input, width: "100%", minHeight: 120, fontFamily: "monospace", resize: "vertical" }} />
          <button style={{ ...btn("var(--yellow)", "var(--surface)"), marginTop: 10 }} disabled={busy} onClick={bulkImport}>{busy ? "Importing…" : "Import shades"}</button>
        </div>
      )}

      {/* Swatch list */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>Tick the shades to include on the card ({chosen.length} selected).</div>
        {rows.length === 0 && <div style={{ color: "var(--muted)" }}>No shades yet — add your first above.</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {rows.map((s) => (
            <div key={s.swatch_id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px" }}>
              <input type="checkbox" checked={!!sel[s.swatch_id]} onChange={(e) => setSel({ ...sel, [s.swatch_id]: e.target.checked })} />
              <span style={{ width: 22, height: 22, borderRadius: 4, background: s.hex, border: "1px solid var(--surface)", display: "inline-block" }} />
              <span style={{ fontSize: 13 }}>{s.shade_name}{s.shade_code ? ` (${s.shade_code})` : ""}</span>
              <span style={{ color: "#5b7aa8", fontSize: 11, fontFamily: "monospace" }}>{s.hex.toUpperCase()}</span>
              <button style={{ ...btn("transparent", "var(--crit)"), padding: "2px 6px", fontSize: 16 }} title="Delete" onClick={() => del(s.swatch_id)}>×</button>
            </div>
          ))}
        </div>
      </div>

      {/* Generate */}
      <div style={{ ...card }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <button style={btn("var(--green)", "var(--green-dim)")} disabled={busy} onClick={downloadPng}>⬇ Download PNG</button>
          <button style={btn("var(--surface)", "var(--link)")} disabled={busy} onClick={printCard}>🖨 Print / Save PDF</button>
        </div>
        <div style={{ overflowX: "auto", background: "var(--surface)", borderRadius: 8, padding: 10 }}>
          <canvas ref={canvasRef} style={{ width: "100%", maxWidth: 1000, background: "var(--surface)", borderRadius: 4 }} />
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>Preview updates when you click a generate button. Selected shades render onto the branded card.</div>
      </div>
    </div>
  );
}
