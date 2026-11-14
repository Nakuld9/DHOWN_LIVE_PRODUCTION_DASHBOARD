import React, { useEffect, useRef, useState, useCallback } from 'react';

// Reusable QR scan modal for roll labels.
// - Camera scanning via the native BarcodeDetector API (Chrome/Edge/Android).
// - Manual input always available — also catches USB gun scanners (keyboard wedge + Enter).
// - Continuous: every successful decode calls onScan(rollId) and keeps scanning.
// Roll id is extracted from any label format: "ROLL:SJ03-..." | plain id | .../m/roll/<id> URL.

export function parseRollId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^ROLL:/i.test(s)) return s.replace(/^ROLL:/i, '').trim();
  if (/^https?:\/\//i.test(s)) {
    const parts = s.split('?')[0].split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }
  return s;
}

const beep = (ok = true) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, ok ? 120 : 350);
  } catch {}
};

export default function QRScanner({ title = 'Scan Roll QR', hint, onScan, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const lastRef = useRef({ id: '', at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan; // keep latest without restarting the camera effect
  const [cameraState, setCameraState] = useState('starting'); // starting | on | unavailable
  const [manual, setManual] = useState('');
  const [log, setLog] = useState([]); // {id, ok, note}

  const report = useCallback(async (rollId) => {
    if (!rollId) return;
    const now = Date.now();
    if (lastRef.current.id === rollId && now - lastRef.current.at < 2500) return; // debounce same code
    lastRef.current = { id: rollId, at: now };
    const res = await onScanRef.current(rollId); // { ok, note } from the caller
    const ok = res?.ok !== false;
    beep(ok);
    setLog(l => [{ id: rollId, ok, note: res?.note || (ok ? 'added' : 'rejected'), key: now }, ...l].slice(0, 30));
  }, []);

  useEffect(() => {
    let raf; let detector; let stopped = false;
    (async () => {
      if (!('BarcodeDetector' in window)) { setCameraState('unavailable'); return; }
      try {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraState('on');
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length) await report(parseRollId(codes[0].rawValue));
          } catch {}
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch { setCameraState('unavailable'); }
    })();
    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [report]);

  const submitManual = () => {
    const id = parseRollId(manual);
    if (id) report(id);
    setManual('');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--link)', borderRadius: 12, width: 'min(96vw, 480px)', maxHeight: '92vh', overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h3 style={{ color: 'var(--link)', margin: 0, fontSize: 17 }}>📷 {title}</h3>
            {hint && <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>{hint}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'var(--border)', color: 'var(--text)', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontWeight: 700 }}>Done</button>
        </div>

        {cameraState !== 'unavailable' ? (
          <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#000', marginBottom: 10 }}>
            <video ref={videoRef} muted playsInline style={{ width: '100%', display: 'block', maxHeight: 300, objectFit: 'cover' }} />
            {cameraState === 'starting' && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>Starting camera…</div>}
            <div style={{ position: 'absolute', inset: 0, border: '2px solid rgba(56,189,248,0.5)', borderRadius: 10, pointerEvents: 'none' }} />
          </div>
        ) : (
          <div style={{ background: 'var(--surface)', border: '1px dashed var(--surface-2)', borderRadius: 8, padding: '10px 12px', color: 'var(--muted)', fontSize: 12, marginBottom: 10 }}>
            Camera scanning not available in this browser — type the roll ID below, or use a USB scanner gun (it types + presses Enter automatically).
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input autoFocus value={manual} onChange={e => setManual(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitManual(); }}
            placeholder="Roll ID (scan gun or type) ⏎"
            style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 12px', color: 'var(--text)', fontSize: 14 }} />
          <button onClick={submitManual} style={{ background: 'var(--link)', color: 'var(--surface)', border: 'none', borderRadius: 6, padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>Add</button>
        </div>

        {log.length > 0 && (
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {log.map(e => (
              <div key={e.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderRadius: 5, marginBottom: 3, background: e.ok ? '#052e1633' : '#4a0d1433', border: `1px solid ${e.ok ? 'var(--green-dim)' : 'var(--crit-dim)'}` }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: e.ok ? 'var(--green)' : 'var(--crit)', fontWeight: 700 }}>{e.ok ? '✓' : '✕'} {e.id}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{e.note}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
