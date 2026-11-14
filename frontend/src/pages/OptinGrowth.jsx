// WhatsApp Opt-in Growth — generate a QR + deep link so prospects opt THEMSELVES
// in. Scanning opens WhatsApp to the business number with the opt-in keyword
// pre-filled; when they send it, the existing keyword flow records marketing
// consent. Fully compliant (customer-initiated) — no outbound sending here.
import React, { useState, useEffect, useCallback, useRef } from "react";
import QRCode from "qrcode";
import { useTenant } from "../useTenant";

const token = () => localStorage.getItem("dhown_token");

export default function OptinGrowth() {
  const tenant = useTenant();
  const [kit, setKit] = useState(null);
  const [state, setState] = useState("loading");
  const [qr, setQr] = useState("");
  const [numInput, setNumInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrDataRef = useRef("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/wa-optin", { headers: { Authorization: `Bearer ${token()}` } });
      if (r.status === 403) { setState("forbidden"); return; }
      if (!r.ok) { setState("error"); return; }
      const d = await r.json();
      setKit(d); setNumInput(d.number || ""); setState("ok");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (kit && kit.link) {
      QRCode.toDataURL(kit.link, { width: 360, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0e2a1b", light: "#ffffff" } })
        .then((url) => { setQr(url); qrDataRef.current = url; })
        .catch(() => setQr(""));
    } else { setQr(""); }
  }, [kit]);

  const saveNumber = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/wa-optin/number", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ number: numInput }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || "Could not save the number."); return; }
      await load();
    } catch { alert("Could not save the number."); } finally { setSaving(false); }
  };

  const copyLink = () => {
    if (!kit?.link) return;
    navigator.clipboard?.writeText(kit.link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  const downloadQR = () => {
    if (!qrDataRef.current) return;
    const a = document.createElement("a");
    a.href = qrDataRef.current; a.download = `${(tenant.name || "whatsapp").replace(/\s+/g, "-")}-optin-qr.png`; a.click();
  };

  const printPoster = () => {
    if (!qrDataRef.current || !kit) return;
    const name = (tenant.name || "DHOWN") + "";
    const num = kit.number;
    const pretty = num ? `+${num.slice(0, 2)} ${num.slice(2)}` : "";
    const w = window.open("", "_blank", "width=800,height=1000");
    if (!w) { alert("Allow pop-ups to print the poster."); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${name} — WhatsApp Opt-in</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
        body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff}
        .card{width:600px;padding:48px 40px;text-align:center;border:3px solid #1f9d57;border-radius:24px}
        .brand{font-size:26px;font-weight:800;letter-spacing:.02em;color:#0e2a1b}
        .brand b{color:#c9a227}
        .lead{margin:18px 0 6px;font-size:30px;font-weight:800;color:#15231a;line-height:1.2}
        .sub{font-size:16px;color:#586b5d;margin-bottom:26px}
        img{width:340px;height:340px}
        .wa{margin-top:22px;font-size:20px;font-weight:700;color:#1f9d57}
        .num{font-size:17px;color:#15231a;margin-top:4px;font-variant-numeric:tabular-nums}
        .hint{margin-top:18px;font-size:13px;color:#8a978b}
        .kw{display:inline-block;margin-top:8px;padding:5px 14px;border-radius:999px;background:#faf4dc;border:1px solid #ecdc95;color:#a07f16;font-weight:700;font-size:14px}
      </style></head><body onload="window.print()">
      <div class="card">
        <div class="brand">${name.replace(/^(.)/, "<b>$1</b>")} <span style="font-weight:600">HOSIERY</span></div>
        <div class="lead">Scan for our latest<br>rates &amp; offers</div>
        <div class="sub">on WhatsApp — it's instant &amp; free</div>
        <img src="${qrDataRef.current}" alt="WhatsApp QR"/>
        <div class="wa">📲 Scan with your phone camera</div>
        ${pretty ? `<div class="num">or message us: ${pretty}</div>` : ""}
        <div class="hint">You'll send the word</div>
        <div class="kw">${kit.keyword}</div>
        <div class="hint">to subscribe. Reply STOP anytime to opt out.</div>
      </div></body></html>`);
    w.document.close();
  };

  // ── styles (tokenized → theme-aware) ──
  const page = { padding: "22px 26px", maxWidth: 1100, margin: "0 auto" };
  const h1 = { fontSize: 22, fontWeight: 800, color: "var(--text)", margin: "0 0 4px" };
  const sub = { color: "var(--muted)", fontSize: 13.5, marginBottom: 22 };
  const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, padding: 22, boxShadow: "var(--shadow)" };
  const btn = (bg, fg, bd) => ({ font: "inherit", fontSize: 13, fontWeight: 700, color: fg, background: bg, border: `1px solid ${bd}`, borderRadius: 7, padding: "9px 15px", cursor: "pointer" });
  const label = { fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 8 };

  if (state === "forbidden") return <div style={page}><div style={card}>You don't have access to the opt-in kit.</div></div>;
  if (state === "loading") return <div style={page}><div style={card}>Loading…</div></div>;
  if (state === "error") return <div style={page}><div style={card}>Couldn't load the opt-in kit.</div></div>;

  const needsNumber = !kit.number_set;

  return (
    <div style={page}>
      <h1 style={h1}>📲 WhatsApp Opt-in Growth</h1>
      <div style={sub}>
        Let prospects opt in <b>themselves</b> — compliant and ban-safe. They scan the QR (or tap the link),
        WhatsApp opens pre-filled with <b>{kit.keyword}</b>, they hit send, and they're subscribed to your offers.
        Perfect for exhibition stalls, visiting cards and catalogues.
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "stretch" }}>
        {/* QR + actions */}
        <div style={{ ...card, flex: "1 1 340px", minWidth: 300, textAlign: "center" }}>
          <div style={{ ...label, textAlign: "left" }}>Your opt-in QR</div>
          {needsNumber ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: "30px 10px" }}>
              Set your WhatsApp Business number first (right) to generate the QR &amp; link.
            </div>
          ) : (
            <>
              {qr
                ? <img src={qr} alt="WhatsApp opt-in QR" style={{ width: 260, height: 260, borderRadius: 10, border: "1px solid var(--border)" }} />
                : <div style={{ padding: 60, color: "var(--muted)" }}>Generating…</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
                <button style={btn("var(--green)", "var(--on-green)", "var(--green)")} onClick={printPoster}>🖨 Print poster</button>
                <button style={btn("var(--green-dim)", "var(--green-deep)", "var(--green-edge)")} onClick={downloadQR}>⬇ Download QR</button>
              </div>
            </>
          )}
        </div>

        {/* Link + stats + config */}
        <div style={{ flex: "1 1 340px", minWidth: 300, display: "flex", flexDirection: "column", gap: 16 }}>
          {!needsNumber && (
            <div style={card}>
              <div style={label}>Share link</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <code style={{ flex: 1, minWidth: 180, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 7, padding: "9px 11px", fontSize: 12.5, color: "var(--text)", wordBreak: "break-all" }}>{kit.link}</code>
                <button style={btn("var(--gold-dim)", "var(--gold-deep)", "var(--gold-edge)")} onClick={copyLink}>{copied ? "✓ Copied" : "Copy"}</button>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
                Paste into emails, SMS, your website or WhatsApp bio. Tapping it opens a chat to you with <b>{kit.keyword}</b> pre-typed.
              </div>
            </div>
          )}

          <div style={card}>
            <div style={label}>Marketing opt-ins so far</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>{kit.opted_in_count}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>customers who can legitimately receive your WhatsApp campaigns.</div>
          </div>

          <div style={card}>
            <div style={label}>WhatsApp Business number</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={numInput} onChange={(e) => setNumInput(e.target.value)} placeholder="e.g. 917055600009"
                style={{ flex: 1, minWidth: 160, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 7, padding: "9px 11px", fontSize: 14, color: "var(--text)" }} />
              <button style={btn("var(--green)", "var(--on-green)", "var(--green)")} onClick={saveNumber} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 8 }}>
              International format, digits only (country code + number). This is the number the QR/link opens a chat to.
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...card, marginTop: 18, background: "var(--gold-dim)", border: "1px solid var(--gold-edge)" }}>
        <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
          <b>Why this is the right way:</b> WhatsApp bans bulk messaging to people who haven't opted in. This kit flips it —
          the customer sends the first message, which creates consent. Those opt-ins then appear in <b>WhatsApp Campaigns</b>,
          where you can message them with approved offer templates, safely.
        </div>
      </div>
    </div>
  );
}
