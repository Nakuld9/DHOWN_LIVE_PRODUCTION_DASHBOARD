import React, { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

const TABS = [
  { key: "rpm",        label: "RPM Trend",        color: "#00ff88" },
  { key: "counter",    label: "Counter Delta",     color: "#60a5fa" },
  { key: "production", label: "Hourly Production", color: "#fb923c" },
];

const HOURS_OPTIONS = [6, 12, 24];

export default function LiveTrendCharts({ machines = [] }) {
  const [activeTab, setActiveTab]     = useState("rpm");
  const [machineId, setMachineId]     = useState("");
  const [hours, setHours]             = useState(12);
  const [trendData, setTrendData]     = useState([]);
  const [loading, setLoading]         = useState(false);

  // Initialise machine selector to first machine that has data
  useEffect(() => {
    if (machines.length > 0 && !machineId) {
      const first = machines.find((m) => m.live_status !== "NO_DATA") || machines[0];
      if (first) setMachineId(first.machine_id || first.work_center);
    }
  }, [machines, machineId]);

  const loadTrend = useCallback(async () => {
    if (!machineId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `http://localhost:4000/api/charts/trends?machine_id=${encodeURIComponent(machineId)}&hours=${hours}`
      );
      const data = await res.json();
      setTrendData(Array.isArray(data) ? data : []);
    } catch {
      setTrendData([]);
    } finally {
      setLoading(false);
    }
  }, [machineId, hours]);

  useEffect(() => {
    loadTrend();
    const timer = setInterval(loadTrend, 30000);
    return () => clearInterval(timer);
  }, [loadTrend]);

  const tab = TABS.find((t) => t.key === activeTab);

  const renderChart = () => {
    if (loading) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#6b7280" }}>
          Loading…
        </div>
      );
    }
    if (trendData.length === 0) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "#6b7280" }}>
          No data yet — waiting for collector pushes
        </div>
      );
    }

    const commonAxis = {
      xKey: "label",
      stroke: "#4b5563",
      tick: { fill: "#9ca3af", fontSize: 11 },
    };

    if (activeTab === "production") {
      return (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#16345d" />
            <XAxis dataKey={commonAxis.xKey} stroke={commonAxis.stroke} tick={commonAxis.tick} />
            <YAxis stroke={commonAxis.stroke} tick={commonAxis.tick} unit=" KG" width={60} />
            <Tooltip
              contentStyle={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: 8 }}
              labelStyle={{ color: "#9ca3af" }}
              formatter={(v) => [Number(v).toFixed(3) + " KG", "Production"]}
            />
            <Bar dataKey="production_kg" fill={tab.color} name="Prod (KG)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    const dataKey = activeTab === "rpm" ? "rpm_avg" : "counter_delta";
    const unit    = activeTab === "rpm" ? " RPM" : "";
    const name    = activeTab === "rpm" ? "RPM" : "Counter Delta";

    return (
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#16345d" />
          <XAxis dataKey={commonAxis.xKey} stroke={commonAxis.stroke} tick={commonAxis.tick} />
          <YAxis stroke={commonAxis.stroke} tick={commonAxis.tick} unit={unit} width={activeTab === "rpm" ? 50 : 60} />
          <Tooltip
            contentStyle={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: 8 }}
            labelStyle={{ color: "#9ca3af" }}
            formatter={(v) => [Number(v).toFixed(activeTab === "rpm" ? 1 : 0) + unit, name]}
          />
          <Legend wrapperStyle={{ color: "#9ca3af", fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={tab.color}
            strokeWidth={2}
            dot={{ r: 3, fill: tab.color }}
            activeDot={{ r: 5 }}
            name={name}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div
      style={{
        background: "#071120",
        border: "1px solid #16345d",
        borderRadius: "12px",
        padding: "16px",
        marginTop: "20px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "14px",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <h3 style={{ color: "#FFD700", margin: 0, fontSize: "15px" }}>Live Production Trends</h3>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          {/* Machine selector */}
          <select
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            style={{
              background: "#0d1b2f",
              color: "#e5e7eb",
              border: "1px solid #16345d",
              borderRadius: "6px",
              padding: "4px 8px",
              fontSize: "12px",
            }}
          >
            {machines.map((m) => (
              <option key={m.machine_id || m.work_center} value={m.machine_id || m.work_center}>
                {m.machine_id || m.work_center}
              </option>
            ))}
          </select>

          {/* Hours selector */}
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            style={{
              background: "#0d1b2f",
              color: "#e5e7eb",
              border: "1px solid #16345d",
              borderRadius: "6px",
              padding: "4px 8px",
              fontSize: "12px",
            }}
          >
            {HOURS_OPTIONS.map((h) => (
              <option key={h} value={h}>{h}h</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              background: activeTab === t.key ? t.color + "22" : "transparent",
              border: `1px solid ${activeTab === t.key ? t.color : "#16345d"}`,
              color: activeTab === t.key ? t.color : "#9ca3af",
              borderRadius: "6px",
              padding: "4px 12px",
              fontSize: "12px",
              cursor: "pointer",
              fontWeight: activeTab === t.key ? "bold" : "normal",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      {renderChart()}

      {/* Data notice */}
      <p style={{ color: "#374151", fontSize: "10px", marginTop: "8px", marginBottom: 0 }}>
        Data sourced exclusively from Modbus TCP collector pushes — no demo values
      </p>
    </div>
  );
}
