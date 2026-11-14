import React, { useState, useEffect } from "react";
import MachineCard from "./MachineCard";

const MachineGrid = ({ machines = [] }) => {
  const [supervisorMobile, setSupervisorMobile] = useState("8727048169");

  useEffect(() => {
    const token = localStorage.getItem("dhown_token");
    fetch("/api/users", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(users => {
        if (Array.isArray(users)) {
          const sup = users.find(u => u.role === "SUPERVISOR" && u.mobile);
          if (sup) setSupervisorMobile(String(sup.mobile));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "15px"
      }}
    >
      {machines.map((machine) => (
        <MachineCard
          key={machine.machine_id}
          machine={machine}
          supervisorMobile={supervisorMobile}
        />
      ))}
    </div>
  );
};

export default MachineGrid;