// AI Image — generate concept / pattern / mock-up imagery via the model gateway's
// image providers (OpenAI images or Qwen/DashScope). Needs an image-capable provider
// key set on the server; shows a clear message when none is configured.

import React, { useState } from "react";

const API = "";
const jsonH = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("dhown_token")}` });
const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, padding: 16 };
const SIZES = ["1024x1024", "1024x1536", "1536x1024"];
const IDEAS = [
  "A seamless knitted single-jersey fabric texture, royal blue, studio lighting",
  "A minimalist product catalogue cover for a hosiery mill, black and gold",
  "A rib-knit fabric swatch close-up, natural ivory, soft daylight",
];

async function readJson(r) { const t = await r.text(); try { return JSON.parse(t); } catch { throw new Error(r.ok ? "Bad response" : `Error ${r.status}`); } }

export default function AIImage() {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [img, setImg] = useState(null);   // { src, model, note }

  const generate = async () => {
    if (!prompt.trim()) { setErr("Describe the image you want."); return; }
    setBusy(true); setErr(""); setImg(null);
    try {
      const r = await fetch(`${API}/api/ai/image`, { method: "POST", headers: jsonH(), body: JSON.stringify({ prompt, size }) });
      const j = await readJson(r);
      if (!r.ok || !j.ok) throw new Error(j.error || `Failed (${r.status})`);
      if (j.dataUri || j.url) setImg({ src: j.dataUri || j.url, model: j.model });
      else if (j.taskId) setErr(`${j.provider} accepted the job (async). ${j.note || "Task " + j.taskId}`);
      else throw new Error("No image returned.");
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 20, color: "var(--text)", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--faint)", letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 7 }}>AI · Image Generation</div>
        <h1 style={{ margin: 0, fontFamily: "var(--mono)", fontWeight: 800, fontSize: 24, letterSpacing: ".02em", textTransform: "uppercase" }}>AI Image</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 0" }}>Generate concept, pattern or catalogue imagery. Powered by NVIDIA FLUX (free) — takes ~5–15 seconds per image.</p>
      </div>

      <div style={{ ...card, marginBottom: 16 }}>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Describe the image — fabric texture, shade, mock-up…"
          style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", color: "var(--text)", fontSize: 14, boxSizing: "border-box", resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
          {IDEAS.map((t, i) => (
            <button key={i} onClick={() => setPrompt(t)} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 99, padding: "5px 11px", fontSize: 11.5, cursor: "pointer" }}>{t.slice(0, 34)}…</button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <select value={size} onChange={(e) => setSize(e.target.value)} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "8px 10px", fontFamily: "var(--mono)", fontSize: 12 }}>
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={generate} disabled={busy} style={{ background: "var(--yellow)", color: "var(--on-gold)", border: "none", borderRadius: 7, padding: "10px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{busy ? "Generating…" : "✦ Generate"}</button>
          </div>
        </div>
      </div>

      {err && <div style={{ ...card, borderColor: "var(--crit-dim)", color: "var(--crit-edge)", marginBottom: 16 }}>{err}{/busy|try again|timeout|HTTP/i.test(err) && <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>The free NVIDIA image service can be momentarily busy — just press Generate again.</div>}</div>}

      {busy && <div style={{ ...card, textAlign: "center", color: "var(--muted)", padding: 60 }}>Generating image…</div>}

      {img && (
        <div style={{ ...card, textAlign: "center" }}>
          <img src={img.src} alt="Generated" style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)" }} />
          <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", marginTop: 12 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)" }}>{img.model}</span>
            <a href={img.src} download={`ai-image-${Date.now()}.png`} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 7, padding: "8px 16px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>⬇ Download</a>
          </div>
        </div>
      )}
    </div>
  );
}
