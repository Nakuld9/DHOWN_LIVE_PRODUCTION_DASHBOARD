import React, {
  useEffect,
  useState,
} from "react";

import axios from "axios";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function ProductionTrend() {
  const [data, setData] = useState([]);

  useEffect(() => {
    loadData();

    const timer = setInterval(
      loadData,
      5000
    );

    return () =>
      clearInterval(timer);

  }, []);

  const loadData = async () => {
    try {

      const res =
        await axios.get(
          "http://localhost:4000/api/dashboard/production-trend"
        );

      setData(res.data);

    } catch (err) {

      console.error(err);

    }
  };

  return (
    <div
      style={{
        background: "#071120",
        border: "1px solid #16345d",
        borderRadius: "10px",
        padding: "15px",
        height: "320px",
      }}
    >
      <h3
        style={{
          color: "#FFD700",
          marginBottom: "15px",
        }}
      >
        Production Trend
      </h3>

      <ResponsiveContainer
        width="100%"
        height={250}
      >
        <BarChart data={data}>
          <XAxis
            dataKey="machine_id"
          />

          <YAxis />

          <Tooltip />

          <Bar
            dataKey="production_kg"
            fill="#FFD700"
            name="KG"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}