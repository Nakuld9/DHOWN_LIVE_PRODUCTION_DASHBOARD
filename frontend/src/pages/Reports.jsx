import React from "react";

export default function Reports() {
  const reports = [
    {
      title: "Production Report",
      description:
        "Machine-wise and fabric-wise production report",
      endpoint:
        "http://localhost:4000/api/reports/production-pdf",
      icon: "📊",
    },
    {
      title: "Downtime Report",
      description:
        "Machine downtime and stoppage analysis",
      endpoint:
        "http://localhost:4000/api/reports/downtime-pdf",
      icon: "⏱️",
    },
    {
      title: "Operator Report",
      description:
        "Operator performance and activity report",
      endpoint:
        "http://localhost:4000/api/reports/operator-pdf",
      icon: "👷",
    },
    {
      title: "RFID Activity Report",
      description:
        "RFID scan history and assignments",
      endpoint:
        "http://localhost:4000/api/reports/rfid-pdf",
      icon: "📡",
    },
    {
      title: "Assignments Report",
      description:
        "Operator-machine assignment history",
      endpoint:
        "http://localhost:4000/api/reports/assignments-pdf",
      icon: "🔗",
    },
    {
      title: "Factory Summary",
      description:
        "Management level factory overview",
      endpoint:
        "http://localhost:4000/api/reports/summary-pdf",
      icon: "🏭",
    },
  ];

  const cardStyle = {
    background: "#081830",
    border: "1px solid #FFD700",
    borderRadius: "12px",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    minHeight: "220px",
  };

  const buttonStyle = {
    background: "#FFD700",
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
        color: "#fff",
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
              color: "#FFD700",
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

      <div
        style={{
          background: "#081830",
          borderRadius: "12px",
          padding: "20px",
          marginBottom: "30px",
          border: "1px solid #23395d",
        }}
      >
        <h3
          style={{
            color: "#FFD700",
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
                  color: "#FFD700",
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
              onClick={() =>
                window.open(
                  report.endpoint,
                  "_blank"
                )
              }
            >
              Generate PDF
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}