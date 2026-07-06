import React, { useEffect, useState } from "react";

const TopBar = () => {
  const [shift, setShift] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const fetchShift = async () => {
      try {
        const r = await fetch("http://localhost:4000/api/analytics/shifts");
        const d = await r.json();
        setShift(d.current_shift || null);
      } catch {
        setShift(null);
      }
    };
    fetchShift();
    const t = setInterval(fetchShift, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const now = new Date();

  const currentDate = now.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const displayShift = shift ?? (now.getHours() >= 8 && now.getHours() < 20 ? "D" : "N");

  return (
    <div
      style={{
        background: "#081426",
        padding: "20px",
        borderRadius: "12px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: "white",
        border: "1px solid #16345d",
      }}
    >
      <div>
        <h1 style={{ margin: 0 }}>
          LIVE PRODUCTION DASHBOARD
        </h1>

        <p
          style={{
            margin: 0,
            color: "#7da2d6",
          }}
        >
          Custom MES System
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: "20px",
        }}
      >
        <span>📅 {currentDate}</span>
        <span>🕒 Shift {displayShift}</span>
      </div>
    </div>
  );
};

export default TopBar;