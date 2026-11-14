import React, { useState } from "react";
import { downloadFile } from "../utils/download";

export default function Reports() {
  // These used to be window.open(endpoint), which cannot send the auth header
  // and so required /api/reports to stay unauthenticated. Fetched as a blob
  // instead, the report router can be guarded like every other one.
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  const generate = async (report) => {
    setBusy(report.endpoint);
    setError("");
    try {
      await downloadFile(report.endpoint, { open: true });
    } catch (e) {
      setError(`${report.title}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const reports = [
    {
      title: "Production Report",
      description:
        "Machine-wise and fabric-wise production report",
      endpoint:
        "/api/reports/production-pdf",
      icon: "📊",
    },
    {
      title: "Downtime Report",
      description:
        "Machine downtime and stoppage analysis",
      endpoint:
        "/api/reports/downtime-pdf",
      icon: "⏱️",
    },
    {
      title: "Operator Report",
      description:
        "Operator performance and activity report",
      endpoint:
        "/api/reports/operator-pdf",
      icon: "👷",
    },
    {
      title: "RFID Activity Report",
      description:
        "RFID scan history and assignments",
      endpoint:
        "/api/reports/rfid-pdf",
      icon: "📡",
    },
    {
      title: "Assignments Report",
      description:
        "Operator-machine assignment history",
      endpoint:
        "/api/reports/assignments-pdf",
      icon: "🔗",
    },
    {
      title: "Factory Summary",
      description:
        "Management level factory overview",
      endpoint:
        "/api/reports/summary-pdf",
      icon: "🏭",
    },
  ];

  const cardStyle = {
    background: "var(--surface)",
    border: "1px solid var(--gold)",
    borderRadius: "12px",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    minHeight: "220px",
  };

  const buttonStyle = {
    background: "var(--yellow)",
    color: "#000",
    border: "none",
    padding: "12px 18px",
    borderRadius: "8px",
    fontWeight: "bold",
    cursor: "pointer",
    marginTop: "15px",
  };

  return (
    <div
      style={{
        padding: "30px",
        color: "var(--text)",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: "30px",
          gap: "20px",
        }}
      >
        <img
          src="/logo.png"
          alt="DHOWN"
          style={{
            width: "80px",
            height: "80px",
            objectFit: "contain",
          }}
        />

        <div>
          <h1
            style={{
              color: "var(--yellow)",
              fontSize: "58px",
              margin: 0,
            }}
          >
            REPORT CENTER
          </h1>

          <p
            style={{
              color: "#ccc",
              marginTop: "8px",
            }}
          >
            DHOWN HOSIERY MILLS
          </p>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: "var(--crit-dim)",
            border: "1px solid var(--crit-dim)",
            color: "var(--crit)",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "20px",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          background: "var(--surface)",
          borderRadius: "12px",
          padding: "20px",
          marginBottom: "30px",
          border: "1px solid var(--border)",
        }}
      >
        <h3
          style={{
            color: "var(--yellow)",
            marginBottom: "10px",
          }}
        >
          REPORTS MODULE
        </h3>

        <p style={{ color: "#ccc" }}>
          Generate PDF reports for
          Production, Downtime,
          Operators, RFID Events,
          Assignments and Factory
          Summary.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit,minmax(320px,1fr))",
          gap: "25px",
        }}
      >
        {reports.map((report) => (
          <div
            key={report.title}
            style={cardStyle}
          >
            <div>
              <div
                style={{
                  fontSize: "50px",
                  marginBottom: "10px",
                }}
              >
                {report.icon}
              </div>

              <h2
                style={{
                  color: "var(--yellow)",
                  marginBottom: "10px",
                }}
              >
                {report.title}
              </h2>

              <p
                style={{
                  color: "#ccc",
                }}
              >
                {report.description}
              </p>
            </div>

            <button
              style={buttonStyle}
              disabled={busy === report.endpoint}
              onClick={() => generate(report)}
            >
              {busy === report.endpoint ? "Generating…" : "Generate PDF"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}