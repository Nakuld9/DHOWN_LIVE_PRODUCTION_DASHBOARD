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
import WarehouseOverview from "./pages/WarehouseOverview";
import GreigeWarehouse from "./pages/GreigeWarehouse";
import Batching from "./pages/Batching";
import Subcontracting from "./pages/Subcontracting";
import FinishedGoods from "./pages/FinishedGoods";
import Dispatch from "./pages/Dispatch";
import VendorStock from "./pages/VendorStock";
import GRN from "./pages/GRN";
import YarnStore from "./pages/YarnStore";
import YarnIssue from "./pages/YarnIssue";
import Finishing from "./pages/Finishing";
import QualityInspection from "./pages/QualityInspection";
import Traceability from "./pages/Traceability";
import InventoryReports from "./pages/InventoryReports";
import Costing from "./pages/Costing";
import ItemMaster from "./pages/ItemMaster";
import Partners from "./pages/Partners";
import AdminMasters from "./pages/AdminMasters";
import StockStatement from "./pages/StockStatement";
import WorkCenterStock from "./pages/WorkCenterStock";
import GSTReport from "./pages/GSTReport";
import OpeningBalances from "./pages/OpeningBalances";
import MasterDashboard from "./pages/MasterDashboard";

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
        <Route path="/command-center" element={<RequireAuth><MasterDashboard /></RequireAuth>} />

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
                  <Route path="/warehouse"            element={<WarehouseOverview />} />
                  <Route path="/grn"                  element={<GRN />} />
                  <Route path="/yarn-store"           element={<YarnStore />} />
                  <Route path="/yarn-issue"           element={<YarnIssue />} />
                  <Route path="/greige"               element={<GreigeWarehouse />} />
                  <Route path="/batching"             element={<Batching />} />
                  <Route path="/subcontracting"       element={<Subcontracting />} />
                  <Route path="/finishing"            element={<Finishing />} />
                  <Route path="/quality-inspection"   element={<QualityInspection />} />
                  <Route path="/traceability"         element={<Traceability />} />
                  <Route path="/inventory-reports"    element={<InventoryReports />} />
                  <Route path="/costing"              element={<Costing />} />
                  <Route path="/finished-goods"       element={<FinishedGoods />} />
                  <Route path="/dispatch"             element={<Dispatch />} />
                  <Route path="/vendor-stock"          element={<VendorStock />} />
                  <Route path="/items"               element={<ItemMaster />} />
                  <Route path="/partners"            element={<Partners />} />
                  <Route path="/admin/masters"       element={<AdminMasters />} />
                  <Route path="/stock-statement"     element={<StockStatement />} />
                  <Route path="/work-center-stock"   element={<WorkCenterStock />} />
                  <Route path="/gst-report"          element={<GSTReport />} />
                  <Route path="/opening-balances"   element={<OpeningBalances />} />
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
