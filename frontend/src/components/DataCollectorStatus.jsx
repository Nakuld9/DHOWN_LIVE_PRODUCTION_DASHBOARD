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
      const res = await fetch("http://localhost:4000/api/data-collectors");
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
        background: "#161B22",
        border: "1px solid #30363d",
        borderRadius: "10px",
        padding: "15px",
        color: "white",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <h3 style={{ color: "#facc15", margin: 0, fontSize: "14px", letterSpacing: "1px" }}>
          DATA COLLECTORS
        </h3>
        <div style={{ display: "flex", gap: "8px", fontSize: "12px" }}>
          <span style={{ color: "#22c55e", fontWeight: "bold" }}>{online} ON</span>
          <span style={{ color: "#6b7280" }}>|</span>
          <span style={{ color: "#ef4444", fontWeight: "bold" }}>{offline} OFF</span>
        </div>
      </div>

      {dcs.length === 0 ? (
        <div style={{ color: "#7da2d6", fontSize: "13px", fontStyle: "italic" }}>
          No data collectors registered
        </div>
      ) : (
        dcs.map((dc) => {
          const isOnline = (dc.status || "").toUpperCase() === "ONLINE";
          const statusColor = isOnline ? "#22c55e" : "#ef4444";
          return (
            <div
              key={dc.dc_id}
              style={{
                borderLeft: `3px solid ${statusColor}`,
                paddingLeft: "10px",
                marginBottom: "10px",
                paddingBottom: "10px",
                borderBottom: "1px solid #0f2447",
              }}
            >
              {/* DC ID + machine */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#facc15", fontWeight: "bold", fontSize: "13px" }}>
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
              <div style={{ color: "#7da2d6", fontSize: "12px", marginTop: "2px" }}>
                {dc.machine_name || dc.machine_id || "—"}
              </div>

              {/* IP address — highlight when present */}
              <div style={{ marginTop: "4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span
                  style={{
                    color: dc.ip_address ? "#60a5fa" : "#4b5563",
                    fontFamily: "monospace",
                    fontSize: "13px",
                    fontWeight: dc.ip_address ? "bold" : "normal",
                  }}
                >
                  {dc.ip_address || "No IP yet"}
                </span>
                <span style={{ color: "#4b5563", fontSize: "11px" }}>
                  {fmtLastSeen(dc.last_seen)}
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
