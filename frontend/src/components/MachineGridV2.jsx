import React, { useState, useEffect, memo } from "react";
import MachineCardV2 from "./MachineCardV2";

const MachineGridV2 = memo(({ machines = [] }) => {
  const [supervisorMobile, setSupervisorMobile] = useState("8727048169");

  useEffect(() => {
    const token = localStorage.getItem("dhown_token");
    fetch("http://localhost:4000/api/users", {
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
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "8px",
    }}>
      {machines.map((machine) => (
        <MachineCardV2
          key={machine.machine_id}
          machine={machine}
          supervisorMobile={supervisorMobile}
        />
      ))}
    </div>
  );
});

MachineGridV2.displayName = "MachineGridV2";
export default MachineGridV2;
