import { useEffect, useState } from "react";

export default function DataCollectorStatus() {
  const [dcs, setDcs] = useState([]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    try {
      const res = await fetch("/api/data-collectors");
      const data = await res.json();
      setDcs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("DataCollectorStatus:", err);
    }
  };

  const online  = dcs.filter(d => (d.status || "").toUpperCase() === "ONLINE").length;
  const offline = dcs.length - online;

  const fmtLastSeen = (ts) => {
    if (!ts) return "Never";
    const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (diff <  60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        padding: "15px",
        color: "white",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <h3 style={{ color: "var(--yellow)", margin: 0, fontSize: "14px", letterSpacing: "1px" }}>
          DATA COLLECTORS
        </h3>
        <div style={{ display: "flex", gap: "8px", fontSize: "12px" }}>
          <span style={{ color: "var(--green)", fontWeight: "bold" }}>{online} ON</span>
          <span style={{ color: "var(--muted)" }}>|</span>
          <span style={{ color: "var(--crit)", fontWeight: "bold" }}>{offline} OFF</span>
        </div>
      </div>

      <div style={{ maxHeight: "168px", overflowY: "auto", paddingRight: "4px", marginRight: "-4px" }}>
      {dcs.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: "13px", fontStyle: "italic" }}>
          No data collectors registered
        </div>
      ) : (
        dcs.map((dc) => {
          const isOnline = (dc.status || "").toUpperCase() === "ONLINE";
          const statusColor = isOnline ? "var(--green)" : "var(--crit)";
          return (
            <div
              key={dc.dc_id}
              style={{
                borderLeft: `3px solid ${statusColor}`,
                paddingLeft: "10px",
                marginBottom: "6px",
                paddingBottom: "6px",
                borderBottom: "1px solid var(--border-soft)",
              }}
            >
              {/* DC ID + machine */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: "13px" }}>
                  {dc.dc_id}
                </span>
                <span
                  style={{
                    background: isOnline ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                    color: statusColor,
                    border: `1px solid ${statusColor}44`,
                    borderRadius: "10px",
                    padding: "1px 7px",
                    fontSize: "11px",
                    fontWeight: "bold",
                  }}
                >
                  {isOnline ? "ONLINE" : "OFFLINE"}
                </span>
              </div>

              {/* Machine name */}
              <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "2px" }}>
                {dc.machine_name || dc.machine_id || "—"}
              </div>

              {/* IP address — highlight when present */}
              <div style={{ marginTop: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span
                  style={{
                    color: dc.ip_address ? "var(--link)" : "var(--surface)",
                    fontFamily: "monospace",
                    fontSize: "13px",
                    fontWeight: dc.ip_address ? "bold" : "normal",
                  }}
                >
                  {dc.ip_address || "No IP yet"}
                </span>
                <span style={{ color: "var(--surface)", fontSize: "11px" }}>
                  {fmtLastSeen(dc.last_seen)}
                </span>
              </div>
            </div>
          );
        })
      )}
      </div>
    </div>
  );
}
