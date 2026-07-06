import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Sidebar from "./components/Sidebar";

import Dashboard from "./pages/Dashboard";
import Machines from "./pages/Machines";
import Production from "./pages/Production";
import Operators from "./pages/Operators";
import Downtime from "./pages/Downtime";
import Reports from "./pages/Reports";
import Maintainence from "./pages/Maintainence";
import Alerts from "./pages/Alerts";
import Settings from "./pages/Settings";
import Rolls from "./pages/Rolls";
import MachineDetails from "./pages/MachineDetails";
import Assignments from "./pages/Assignments";
import RFIDScan from "./pages/RFIDScan";
import RFIDEvents from "./pages/RFIDEvents";

function App() {

const machineNames = [
"SJ-KNIT-01",
"SJ-KNIT-02",
"SJ-KNIT-03",
"RB-KNIT-04",
"RB-KNIT-05",
"SJ-KNIT-06",
"SJ-KNIT-07",
"SJ-KNIT-08",
"IL-KNIT-09",
"IL-KNIT-10",
"TV-KNIT-11",
"SJ-KNIT-12",
"SJ-KNIT-13",
"IL-KNIT-14",
"TV-KNIT-15",
"SJ-KNIT-16",
"SJ-KNIT-17",
"IL-KNIT-18"
];

const machines = machineNames.map((name, index) => ({
machine_id: index + 1,
machine_no: name,
operator: `Operator ${index + 1}`,
rpm: Math.floor(Math.random() * 30) + 25,
efficiency: Math.floor(Math.random() * 20) + 75,
production_kg: Math.floor(Math.random() * 800) + 500,
fabric: "Single Jersey",
gauge: "24G",
status: "RUNNING"
}));

return ( <BrowserRouter>
<div
style={{
display: "flex",
background: "#050d1a",
minHeight: "100vh",
}}
> <Sidebar />

    <div style={{ flex: 1 }}>
      <Routes>

        <Route
          path="/"
          element={<Dashboard machines={machines} />}
        />

        <Route
          path="/machines"
          element={<Machines />}
        />

        <Route
          path="/production"
          element={<Production />}
        />

        <Route
          path="/operators"
          element={<Operators />}
        />

        <Route
          path="/downtime"
          element={<Downtime />}
        />

        <Route
          path="/reports"
          element={<Reports />}
        />

        <Route
          path="/maintainence"
          element={<Maintainence />}
        />

        <Route
          path="/alerts"
          element={<Alerts />}
        />

        <Route
          path="/settings"
          element={<Settings />}
        />

        <Route
          path="/rolls"
          element={<Rolls />}
        />
        
        <Route
          path="/machine/:machineId"
          element={<MachineDetails />}
        />

        <Route
          path="/assignments"
          element={<Assignments />}
        />

        <Route
          path="/rfid"
          element={<RFIDScan />}
        />

        <Route
          path="/rfid-events"
          element={<RFIDEvents />}
        />

      </Routes>
    </div>
  </div>
</BrowserRouter>
);
}

export default App;