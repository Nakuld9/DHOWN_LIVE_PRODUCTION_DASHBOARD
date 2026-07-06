import React from "react";

const KPICards = ({ machines = [] }) => {
  if (!machines) {
    machines = [];
  }
  const totalMachines = machines.length;

  const running = machines.filter(
    (m) => m.status === "RUNNING"
  ).length;

  const production = machines.reduce(
    (sum, m) => sum + m.production_kg,
    0
  );

  const avgEfficiency =
    totalMachines > 0
      ? Math.round(
          (running / totalMachines) * 100
        )
      : 0;

  const cards = [
    {
      title: "TOTAL MACHINES",
      value: totalMachines,
    },
    {
      title: "RUNNING",
      value: running,
    },
    {
      title: "PRODUCTION",
      value: production + " KG",
    },
    {
      title: "EFFICIENCY",
      value: avgEfficiency + "%",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(4,1fr)",
        gap: "15px",
        marginTop: "20px",
      }}
    >
      {cards.map((card) => (
        <div
          key={card.title}
          style={{
            background: "#0d1b2f",
            padding: "20px",
            borderRadius: "12px",
            border:
              "1px solid #16345d",
            color: "white",
          }}
        >
          <p
            style={{
              color: "#7da2d6",
              marginBottom: "10px",
            }}
          >
            {card.title}
          </p>

          <h2>{card.value}</h2>
        </div>
      ))}
    </div>
  );
};

export default KPICards;