import React, { useState, useEffect, useRef } from "react";

const S = {
  page: { padding: "30px", color: "white", background: "#050d1a", minHeight: "100vh" },
  title: { color: "#FFD700", fontSize: "22px", fontWeight: "bold", marginBottom: "4px" },
  subtitle: { color: "#7da2d6", fontSize: "14px", marginBottom: "24px" },
  card: { background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "12px", padding: "24px", maxWidth: 520, marginBottom: "24px" },
  label: { color: "#7da2d6", fontSize: "12px", fontWeight: "bold", letterSpacing: "1px", marginBottom: "6px", display: "block" },
  input: { width: "100%", background: "#050d1a", border: "1px solid #16345d", color: "#fff", padding: "12px 14px", borderRadius: "6px", fontSize: "16px", boxSizing: "border-box", marginBottom: "16px" },
  select: { width: "100%", background: "#050d1a", border: "1px solid #16345d", color: "#fff", padding: "10px 12px", borderRadius: "6px", fontSize: "14px", boxSizing: "border-box", marginBottom: "16px" },
  btn: { background: "#FFD700", color: "#111", border: "none", padding: "12px 28px", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", fontSize: "15px", letterSpacing: "0.5px" },
  success: { color: "#22c55e", background: "#052a15", border: "1px solid #166534", borderRadius: "6px", padding: "12px 16px", marginTop: "12px", fontSize: "14px" },
  error: { color: "#ef4444", background: "#2a0505", border: "1px solid #991b1b", borderRadius: "6px", padding: "12px 16px", marginTop: "12px", fontSize: "14px" },
  logTitle: { color: "#FFD700", fontSize: "15px", fontWeight: "bold", marginBottom: "12px" },
  logRow: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #16345d", fontSize: "13px" },
};

export default function RFIDScan() {
  const [rfidTag, setRfidTag]   = useState("");
  const [machineId, setMachineId] = useState("");
  const [machines, setMachines] = useState([]);
  const [status, setStatus]     = useState(null);
  const [log, setLog]           = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    fetch("http://localhost:4000/api/machines")
      .then(r => r.json())
      .then(d => setMachines(d))
      .catch(console.error);
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!rfidTag.trim()) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch("http://localhost:4000/api/rfid-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfid_tag: rfidTag.trim(), machine_id: machineId || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ ok: false, msg: data.error || "Scan failed" });
      } else {
        const entry = {
          tag: rfidTag.trim(),
          machine: machineId || "—",
          operator: data.operator_name || data.operator_id || "Unknown",
          time: new Date().toLocaleTimeString(),
        };
        setLog(prev => [entry, ...prev].slice(0, 20));
        setStatus({ ok: true, msg: `Scanned: ${entry.operator} @ ${entry.machine}` });
        setRfidTag("");
      }
    } catch {
      setStatus({ ok: false, msg: "Cannot connect to server" });
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div style={S.page}>
      <div style={S.title}>RFID Scan</div>
      <div style={S.subtitle}>Manually enter or scan an RFID tag to log operator activity</div>

      <div style={S.card}>
        <form onSubmit={handleSubmit}>
          <label style={S.label}>RFID TAG / CARD NUMBER</label>
          <input
            ref={inputRef}
            style={S.input}
            placeholder="Scan or type RFID tag..."
            value={rfidTag}
            onChange={e => setRfidTag(e.target.value)}
            autoComplete="off"
          />

          <label style={S.label}>MACHINE (OPTIONAL)</label>
          <select style={S.select} value={machineId} onChange={e => setMachineId(e.target.value)}>
            <option value="">— No Machine —</option>
            {machines.map(m => (
              <option key={m.machine_id} value={m.machine_id}>{m.machine_id} – {m.machine_name || m.machine_type}</option>
            ))}
          </select>

          <button style={S.btn} type="submit" disabled={submitting}>
            {submitting ? "Processing…" : "Submit Scan"}
          </button>
        </form>

        {status && (
          <div style={status.ok ? S.success : S.error}>{status.msg}</div>
        )}
      </div>

      {log.length > 0 && (
        <div style={{ ...S.card, maxWidth: 520 }}>
          <div style={S.logTitle}>Recent Scans (this session)</div>
          {log.map((entry, i) => (
            <div key={i} style={S.logRow}>
              <span style={{ color: "#FFD700" }}>{entry.tag}</span>
              <span style={{ color: "#7da2d6" }}>{entry.operator}</span>
              <span style={{ color: "#aaa" }}>{entry.machine}</span>
              <span style={{ color: "#555" }}>{entry.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
