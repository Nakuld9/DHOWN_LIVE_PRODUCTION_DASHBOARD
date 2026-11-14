import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";

const API = ``;

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

  const row = (label, value, color = "var(--text)", link) => (
    <div
      onClick={link ? () => navigate(link) : undefined}
      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--border)", cursor: link ? "pointer" : "default" }}
    >
      <span style={{ color: "var(--muted)", fontSize: 12 }}>{label}</span>
      <span style={{ color, fontWeight: "bold", fontSize: 13 }}>{value}</span>
    </div>
  );

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, minHeight: 150 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ color: "var(--yellow)", margin: 0, fontSize: 13, fontWeight: 700 }}>🧵 INVENTORY</h3>
        <button onClick={() => navigate("/warehouse")} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 4, padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>View All →</button>
      </div>
      {!data ? (
        <div style={{ color: "var(--border)", fontSize: 12 }}>Loading...</div>
      ) : (
        <>
          {row("Yarn Lots in Store", `${data.yarn_store.lots} lots / ${parseFloat(data.yarn_store.stock_kg).toFixed(0)}kg`, data.yarn_store.stock_kg < 100 ? "var(--crit)" : "var(--green)", "/yarn-store")}
          {row("Pending GRNs", data.grn_pending, data.grn_pending > 0 ? "var(--gold)" : "var(--green)", "/grn")}
          {row("Active Issues", data.active_issues, "var(--muted)", "/yarn-issue")}
          {row("Greige Rolls", `${data.greige.rolls} rolls / ${parseFloat(data.greige.kg).toFixed(0)}kg`, "var(--text)", "/greige")}
          {row("Open Batches", data.batches.open, "var(--gold)", "/batching")}
          {row("Finished Stock", `${data.finished.lots} lots / ${parseFloat(data.finished.kg).toFixed(0)}kg`, "var(--green)", "/finished-goods")}
        </>
      )}
    </div>
  );
}
