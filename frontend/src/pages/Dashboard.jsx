import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";

import TopBar from "../components/TopBar";
import KPICards from "../components/KPICards";
import MachineGrid from "../components/MachineGrid";
import ProductionTrend from "../components/ProductionTrend";
import OEEGauge from "../components/OEEGauge";
import ProductionGauge from "../components/ProductionGauge";
import DoughnutChart from "../components/DoughnutChart";
import DowntimeSummary from "../components/DowntimeSummary";
import QualityCard from "../components/QualityCard";
import YarnConsumption from "../components/YarnConsumption";
import AlertsBar from "../components/AlertsBar";
import SupervisorCard from "../components/SupervisorCard";
import ShiftStatus from "../components/ShiftStatus";
import FactoryHealth from "../components/FactoryHealth";
import ActiveOperators from "../components/ActiveOperators";
import ProductionLeaderboard from "../components/ProductionLeaderboard";
import DataCollectorStatus from "../components/DataCollectorStatus";
import LiveTrendCharts from "../components/LiveTrendCharts";

const Dashboard = () => {
  const [machines, setMachines] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const res = await fetch("http://localhost:4000/api/machines");
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data = await res.json();
        setMachines(
          data.map((m) => ({
            ...m,
            work_center: m.machine_id,
            operator:
              m.live_status === "NO_DATA"
                ? "Not Assigned"
                : m.operator_name || "Not Assigned",
            dc_status:
              m.live_status === "NO_DATA" ? "No Data" : m.dc_status || "OFFLINE",
            shift: m.live_shift || "",
          }))
        );
        setError(null);
      } catch (err) {
        console.error(err);
        setError("Unable to reach server. Check backend is running.");
      }
    };

    loadData();

    const interval = setInterval(loadData, 5000);
    const socket = io(`http://${window.location.hostname}:4000`, { transports: ['websocket'] });
    socket.on('machine_update', loadData);
    return () => { clearInterval(interval); socket.disconnect(); };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        background: "#050d1a",
        minHeight: "100vh",
        color: "white",
      }}
    >
      {/* Main Content */}
      <div
        style={{
          flex: 1,
          padding: "20px",
        }}
      >
      {error && (
        <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: "12px 16px", borderRadius: "8px", marginBottom: "16px", fontWeight: 500 }}>
          {error}
        </div>
      )}
        <TopBar />

        <KPICards machines={machines} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "5fr 2fr",
            gap: "15px",
            marginTop: "20px",
          }}
        >
          <MachineGrid machines={machines} />

          <div>
            <ProductionTrend />

            <div style={{ height: "15px" }} />

            <DoughnutChart />

            <div style={{ height: "15px" }} />

            <>
              <DowntimeSummary />

              <ProductionLeaderboard />
            </>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: "15px",
            marginTop: "20px",
          }}
        >
          <FactoryHealth />
          <ProductionGauge />
          <QualityCard />
          <YarnConsumption />
        </div>

        <LiveTrendCharts machines={machines} />

        <div style={{ marginTop: "20px" }}>
          <AlertsBar />
        </div>
      </div>

      {/* Right Sidebar */}
      <div
        style={{
          width: "280px",
          padding: "20px",
          borderLeft: "1px solid #16345d",
          background: "#071120",
        }}
      >
        <SupervisorCard />

        <div style={{ height: "20px" }} />

        <DataCollectorStatus />

        <div style={{ height: "20px" }} />

        <ActiveOperators />

        <div style={{ height: "20px" }} />

        <ShiftStatus />
      </div>
    </div>
  );
};

export default Dashboard;
