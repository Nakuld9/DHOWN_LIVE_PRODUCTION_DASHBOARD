import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

const API = `http://${window.location.hostname}:4000`;

export default function YarnConsumption() {
  const [data, setData] = useState(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const r = await fetch(`${API}/api/inventory/dashboard`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("dhown_token")}` },
      });
      if (r.ok) setData(await r.json());
    } catch (_) {}
  };

  useEffect(() => {
    load();
    const socket = io(API, { transports: ["websocket"] });
    socket.on("inventory:dashboard_update", load);
    socket.on("inventory:yarn_stock_update", load);
    return () => socket.disconnect();
  }, []);

  const row = (label, value, color = "#e2e8f0", link) => (
    <div
      onClick={link ? () => navigate(link) : undefined}
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #30363d", cursor: link ? "pointer" : "default" }}
    >
      <span style={{ color: "#7da2d6", fontSize: 12 }}>{label}</span>
      <span style={{ color, fontWeight: "bold", fontSize: 13 }}>{value}</span>
    </div>
  );

  return (
    <div style={{ background: "#161B22", border: "1px solid #30363d", borderRadius: 10, padding: 16, minHeight: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ color: "#f4ae1f", margin: 0, fontSize: 13, fontWeight: 700 }}>🧵 INVENTORY</h3>
        <button onClick={() => navigate("/warehouse")} style={{ background: "transparent", border: "1px solid #30363d", color: "#7da2d6", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>View All →</button>
      </div>
      {!data ? (
        <div style={{ color: "#4a5568", fontSize: 12 }}>Loading...</div>
      ) : (
        <>
          {row("Yarn Lots in Store", `${data.yarn_store.lots} lots / ${parseFloat(data.yarn_store.stock_kg).toFixed(0)}kg`, data.yarn_store.stock_kg < 100 ? "#ef4444" : "#10b981", "/yarn-store")}
          {row("Pending GRNs", data.grn_pending, data.grn_pending > 0 ? "#f59e0b" : "#10b981", "/grn")}
          {row("Active Issues", data.active_issues, "#7da2d6", "/yarn-issue")}
          {row("Greige Rolls", `${data.greige.rolls} rolls / ${parseFloat(data.greige.kg).toFixed(0)}kg`, "#e2e8f0", "/greige")}
          {row("Open Batches", data.batches.open, "#f59e0b", "/batching")}
          {row("Finished Stock", `${data.finished.lots} lots / ${parseFloat(data.finished.kg).toFixed(0)}kg`, "#10b981", "/finished-goods")}
        </>
      )}
    </div>
  );
}
