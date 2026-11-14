import React, { useEffect, useState } from "react";

// In-app "Install this app" banner. Floor staff rarely discover the browser's
// own "Add to Home Screen", so we surface it:
//  - Android/Chromium: capture beforeinstallprompt and offer a one-tap Install.
//  - iOS Safari (no beforeinstallprompt): show Share → Add to Home Screen hint.
// Dismissal is remembered so we don't nag.
const DISMISS_KEY = "dhown_pwa_dismissed";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

    const onPrompt = (e) => { e.preventDefault(); setDeferred(e); setShow(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS never fires beforeinstallprompt — show the manual hint instead.
    if (isIos()) { setIosHint(true); setShow(true); }

    const onInstalled = () => { setShow(false); localStorage.setItem(DISMISS_KEY, "1"); };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show) return null;

  const dismiss = () => { setShow(false); localStorage.setItem(DISMISS_KEY, "1"); };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    setDeferred(null); setShow(false); localStorage.setItem(DISMISS_KEY, "1");
  };

  return (
    <div style={{
      position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 9999,
      maxWidth: 460, margin: "0 auto", background: "var(--surface)",
      border: "1px solid var(--gold)", borderRadius: 12, padding: "14px 16px",
      boxShadow: "0 8px 28px rgba(0,0,0,0.5)", display: "flex",
      alignItems: "center", gap: 12,
    }}>
      <img src="/icon-192.png" alt="DHOWN MES" style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0 }} />
      <div style={{ flex: 1, color: "var(--text)", fontSize: 13, lineHeight: 1.45 }}>
        <div style={{ color: "var(--yellow)", fontWeight: "bold", marginBottom: 2 }}>Install DHOWN MES</div>
        {iosHint
          ? <span>Tap <b>Share</b> <span style={{ opacity: 0.8 }}>▵</span> then <b>“Add to Home Screen”</b> to install.</span>
          : <span>Add it to your home screen for full-screen, one-tap access on the floor.</span>}
      </div>
      {!iosHint && (
        <button onClick={install} style={{ background: "var(--yellow)", color: "#000", border: "none", padding: "9px 16px", borderRadius: 8, fontWeight: "bold", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>
          Install
        </button>
      )}
      <button onClick={dismiss} aria-label="Dismiss" style={{ background: "transparent", color: "var(--muted)", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1, flexShrink: 0 }}>×</button>
    </div>
  );
}
