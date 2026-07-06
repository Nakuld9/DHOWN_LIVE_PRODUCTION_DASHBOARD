import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import "./App.css";

import Sidebar from "./components/Sidebar";
import Login from "./pages/Login";

import Dashboard from "./pages/Dashboard";
import Machines from "./pages/Machines";
import Production from "./pages/Production";
import Operators from "./pages/Operators";
import Downtime from "./pages/Downtime";
import ReportsDashboard from "./pages/ReportsDashboard";
import ReportPreview from "./pages/ReportPreview";
import Maintainence from "./pages/Maintainence";
import Alerts from "./pages/Alerts";
import Settings from "./pages/Settings";
import Rolls from "./pages/Rolls";
import MachineDetails from "./pages/MachineDetails";
import Assignments from "./pages/Assignments";
import RFIDScan from "./pages/RFIDScan";
import RFIDEvents from "./pages/RFIDEvents";
import TVDashboard from "./pages/TVDashboard";
import UserManagement from "./pages/UserManagement";
import MaintenanceSchedule from "./pages/MaintenanceSchedule";
import ShiftHandover from "./pages/ShiftHandover";

function RequireAuth({ children }) {
  const location = useLocation();
  const token = localStorage.getItem('dhown_token');
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/tv-dashboard" element={<TVDashboard />} />

        {/* All protected routes — with sidebar */}
        <Route path="*" element={
          <RequireAuth>
            <div className="app-layout">
              <Sidebar />
              <div className="app-content">
                <Routes>
                  <Route path="/"             element={<Dashboard />} />
                  <Route path="/machines"     element={<Machines />} />
                  <Route path="/production"   element={<Production />} />
                  <Route path="/operators"    element={<Operators />} />
                  <Route path="/downtime"     element={<Downtime />} />
                  <Route path="/reports"         element={<ReportsDashboard />} />
                  <Route path="/reports/preview" element={<ReportPreview />} />
                  <Route path="/maintainence" element={<Maintainence />} />
                  <Route path="/maintenance"  element={<Maintainence />} />
                  <Route path="/alerts"       element={<Alerts />} />
                  <Route path="/settings"     element={<Settings />} />
                  <Route path="/rolls"        element={<Rolls />} />
                  <Route path="/machine/:machineId" element={<MachineDetails />} />
                  <Route path="/assignments"  element={<Assignments />} />
                  <Route path="/rfid"         element={<RFIDScan />} />
                  <Route path="/rfid-events"  element={<RFIDEvents />} />
                  <Route path="/users"        element={<UserManagement />} />
                  <Route path="/maintenance-schedule" element={<MaintenanceSchedule />} />
                  <Route path="/shift-handover"       element={<ShiftHandover />} />
                </Routes>
              </div>
            </div>
          </RequireAuth>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
