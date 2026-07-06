import React, { useEffect, useState } from "react";

const ShiftStatus = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    try {
      const r = await fetch("http://localhost:4000/api/analytics/shifts");
      const d = await r.json();
      setData(d);
    } catch (err) {
      console.error("ShiftStatus:", err);
    }
  };

  const shift = data?.current_shift || "—";
  const timing = data?.shift_timings?.[shift] || "";
  const shiftProd = data?.production_by_shift?.find(s => s.shift === shift);
  const shiftOEE  = data?.oee_by_shift?.find(s => s.shift === shift);
  const prodKg = shiftProd ? parseFloat(shiftProd.production_kg || 0).toFixed(3) : "0.000";
  const oee    = shiftOEE  ? parseFloat(shiftOEE.avg_oee || 0).toFixed(1) : "—";

  // Calculate elapsed progress from shift timing "HH:MM - HH:MM" or "HH:MM"
  let progress = 0;
  let elapsedText = "—";
  if (timing) {
    const parts = timing.split(' - ');
    if (parts.length === 2) {
      const now = new Date();
      const cur = now.getHours() + now.getMinutes() / 60;
      const start = parseFloat(parts[0].split(':')[0]) + parseFloat(parts[0].split(':')[1] || 0) / 60;
      const end   = parseFloat(parts[1].split(':')[0]) + parseFloat(parts[1].split(':')[1] || 0) / 60;
      const duration = end > start ? end - start : 24 - start + end;
      let elapsed = cur >= start ? cur - start : 24 - start + cur;
      if (elapsed < 0) elapsed = 0;
      if (elapsed > duration) elapsed = duration;
      progress = Math.min(100, Math.round((elapsed / duration) * 100));
      const eh = Math.floor(elapsed);
      const em = Math.round((elapsed % 1) * 60);
      elapsedText = `${eh}h ${em}m elapsed`;
    }
  }

  const shiftLabel = shift === 'D' ? 'Day Shift' : shift === 'N' ? 'Night Shift' : `Shift ${shift}`;

  return (
    <div style={{ background: "#161B22", border: "1px solid #30363d", borderRadius: "12px", padding: "20px", color: "white" }}>
      <h3 style={{ margin: "0 0 8px" }}>SHIFT STATUS</h3>

      {!data ? (
        <div style={{ color: "#7da2d6", fontSize: "16px" }}>Loading...</div>
      ) : (
        <>
          <h4 style={{ margin: "4px 0", color: "#f4ae1f" }}>{shiftLabel}</h4>
          <p style={{ margin: "0 0 10px", color: "#7da2d6", fontSize: "16px" }}>{timing}</p>

          <div style={{ height: "10px", background: "#2d3748", borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "#4ade80" }} />
          </div>

          <p style={{ marginTop: "8px", fontSize: "16px", color: "#7da2d6" }}>
            {elapsedText} | {progress}%
          </p>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px", fontSize: "16px" }}>
            <div>
              <div style={{ color: "#7da2d6" }}>Production</div>
              <div style={{ color: "#f4ae1f", fontWeight: "bold" }}>{prodKg} kg</div>
            </div>
            <div>
              <div style={{ color: "#7da2d6" }}>Shift OEE</div>
              <div style={{ color: oee === "—" ? "#7da2d6" : parseFloat(oee) >= 65 ? "#00ff88" : "#ef4444", fontWeight: "bold" }}>{oee}{oee !== "—" ? "%" : ""}</div>
            </div>
            <div>
              <div style={{ color: "#7da2d6" }}>Machines</div>
              <div style={{ color: "#22c55e", fontWeight: "bold" }}>{shiftProd?.machines_active || 0}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ShiftStatus;
