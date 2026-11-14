import { useEffect, useState } from "react";
import axios from "axios";

export default function FactoryHealth() {
  const [machines, setMachines] = useState([]);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 5000);
    return () => clearInterval(timer);
  }, []);

  const loadData = async () => {
    try {
      const res = await axios.get("/api/machines");
      setMachines(res.data);
    } catch (err) {
      console.error("FactoryHealth:", err);
    }
  };

  const running = machines.filter(
    m => m.live_status === "RUNNING"
  ).length;

  const offline = machines.filter(
    m => m.live_status !== "RUNNING"
  ).length;

  const dcOnline = machines.filter(
    m => (m.dc_status || "").toLowerCase() === "online"
  ).length;

  const dcOffline = machines.length - dcOnline;

  const health =
    machines.length > 0
      ? Math.round((running / machines.length) * 100)
      : 0;

  return (
    <div className="dashboard-card">
      <h3>FACTORY HEALTH</h3>

      <p>Running : {running}</p>
      <p>Stopped : {offline}</p>

      <hr />

      <p>DC Online : {dcOnline}</p>
      <p>DC Offline : {dcOffline}</p>

      <hr />

      <h2>{health}%</h2>
    </div>
  );
}