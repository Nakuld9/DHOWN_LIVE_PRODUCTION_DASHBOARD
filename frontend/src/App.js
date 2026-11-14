import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import "./App.css";
import "./styles/theme.css";

import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import AskAIWidget from "./components/AskAIWidget";
import InstallPrompt from "./components/InstallPrompt";
import Login from "./pages/Login";
import FabricInspection from "./pages/FabricInspection";
import FabricQualityDashboard from "./pages/FabricQualityDashboard";
import DefectTypes from "./pages/DefectTypes";
import AskAI from "./pages/AskAI";
import AIImage from "./pages/AIImage";
import Approvals from "./pages/Approvals";
import Planning from "./pages/Planning";
import OperationsDashboard from "./pages/OperationsDashboard";
import ShiftProductionEntry from "./pages/ShiftProductionEntry";

import Dashboard from "./pages/Dashboard";
import Machines from "./pages/Machines";
import Production from "./pages/Production";
import Operators from "./pages/Operators";
import Downtime from "./pages/Downtime";
import ReportsDashboard from "./pages/ReportsDashboard";
import ReportPreview from "./pages/ReportPreview";
import Maintenance from "./pages/Maintenance";
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
import MobileQC from "./pages/MobileQC";
import MobileRoll from "./pages/MobileRoll";
import WorkOrders from "./pages/WorkOrders";
import SpareParts from "./pages/SpareParts";
import KnittingLibrary from "./pages/KnittingLibrary";
import GRN from "./pages/GRN";
import InvoiceOCR from "./pages/InvoiceOCR";
import ShadeCards from "./pages/ShadeCards";
import ShadeApprovals from "./pages/ShadeApprovals";
import JobworkReconciliation from "./pages/JobworkReconciliation";
import YarnStore from "./pages/YarnStore";
import YarnIssue from "./pages/YarnIssue";
import Finishing from "./pages/Finishing";
import QualityInspection from "./pages/QualityInspection";
import Traceability from "./pages/Traceability";
import InventoryReports from "./pages/InventoryReports";
import Costing from "./pages/Costing";
import AccountingWorkspace from "./pages/accounting/AccountingWorkspace";
import ItemMaster from "./pages/ItemMaster";
import Partners from "./pages/Partners";
import AdminMasters from "./pages/AdminMasters";
import WhatsAppInbox from "./pages/WhatsAppInbox";
import WhatsAppInsights from "./pages/WhatsAppInsights";
import WhatsAppCampaigns from "./pages/WhatsAppCampaigns";
import OptinGrowth from "./pages/OptinGrowth";
import StockStatement from "./pages/StockStatement";
import WorkCenterStock from "./pages/WorkCenterStock";
import GSTReport from "./pages/GSTReport";
import GSTR1 from "./pages/GSTR1";
import FinancialDashboard from "./pages/FinancialDashboard";
import BankReconciliation from "./pages/BankReconciliation";
import BankPayouts from "./pages/BankPayouts";
import Trash from "./pages/Trash";
import Complaints from "./pages/Complaints";
import Compliance from "./pages/Compliance";
import Retention from "./pages/Retention";
import SystemMonitor from "./pages/SystemMonitor";
import ApprovalMatrix from "./pages/ApprovalMatrix";
import StockValuation from "./pages/StockValuation";
import CreditTerms from "./pages/CreditTerms";
import AIPerformance from "./pages/AIPerformance";
import PartnerScorecard from "./pages/PartnerScorecard";
import ITC04 from "./pages/ITC04";
import BusyProduction from "./pages/BusyProduction";
import AIAccountant from "./pages/AIAccountant";
import ImportControlTower from "./pages/ImportControlTower";
import ImportDetail from "./pages/ImportDetail";
import ImportReports from "./pages/ImportReports";
import ImportVessels from "./pages/ImportVessels";
import ImportIntake from "./pages/ImportIntake";
import ImportPaymentsDesk from "./pages/ImportPaymentsDesk";
import OpeningBalances from "./pages/OpeningBalances";
import MasterDashboard from "./pages/MasterDashboard";
import OperatorMode from "./pages/OperatorMode";
import PurchaseOrders from "./pages/PurchaseOrders";
import SalesOrders from "./pages/SalesOrders";
import ProspectiveBuyers from "./pages/ProspectiveBuyers";
import DebtManagement from "./pages/DebtManagement";
import Budgets from "./pages/Budgets";
import CashFlowForecast from "./pages/CashFlowForecast";
import ManufacturingProfitability from "./pages/ManufacturingProfitability";
import ExecutiveCFO from "./pages/ExecutiveCFO";
import BusyReconcile from "./pages/BusyReconcile";
import ProductionPlanning from "./pages/ProductionPlanning";
import Payroll from "./pages/Payroll";
import TaxInvoices from "./pages/TaxInvoices";
import Receipts from "./pages/Receipts";
import EwayCompliance from "./pages/EwayCompliance";
import ProofOfDelivery from "./pages/ProofOfDelivery";
import SalesReturns from "./pages/SalesReturns";
import Allocation from "./pages/Allocation";
import WebChat from "./pages/WebChat";

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
        <Route path="/m/qc" element={<MobileQC />} />
        <Route path="/m/pod" element={<ProofOfDelivery standalone />} />
        <Route path="/m/roll/:rollId" element={<MobileRoll />} />
        <Route path="/chat" element={<WebChat />} />
        <Route path="/command-center" element={<RequireAuth><MasterDashboard /></RequireAuth>} />
        <Route path="/operator" element={<RequireAuth><OperatorMode /></RequireAuth>} />
        <Route path="/accounting" element={<RequireAuth><AccountingWorkspace /></RequireAuth>} />

        {/* All protected routes — with sidebar */}
        <Route path="*" element={
          <RequireAuth>
            <div className="app-layout">
              <Sidebar />
              <div className="app-content">
                <TopBar />
                <div className="app-main">
                <Routes>
                  <Route path="/"             element={<Dashboard />} />
                  <Route path="/machines"     element={<Machines />} />
                  <Route path="/production"   element={<Production />} />
                  <Route path="/operators"    element={<Operators />} />
                  <Route path="/downtime"     element={<Downtime />} />
                  <Route path="/reports"         element={<ReportsDashboard />} />
                  <Route path="/reports/preview" element={<ReportPreview />} />
                  <Route path="/maintenance"  element={<Maintenance />} />
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
                  <Route path="/purchase-orders"      element={<PurchaseOrders />} />
                  <Route path="/sales-orders"         element={<SalesOrders />} />
                  <Route path="/prospective-buyers"   element={<ProspectiveBuyers />} />
                  <Route path="/debt-management"     element={<DebtManagement />} />
                  <Route path="/budgets"             element={<Budgets />} />
                  <Route path="/cash-flow"           element={<CashFlowForecast />} />
                  <Route path="/profitability"       element={<ManufacturingProfitability />} />
                  <Route path="/cfo"                 element={<ExecutiveCFO />} />
                  <Route path="/busy-reconcile"      element={<BusyReconcile />} />
                  <Route path="/production-planning"  element={<ProductionPlanning />} />
                  <Route path="/payroll"              element={<Payroll />} />
                  <Route path="/tax-invoices"         element={<TaxInvoices />} />
                  <Route path="/receipts"             element={<Receipts />} />
                  <Route path="/eway"                 element={<EwayCompliance />} />
                  <Route path="/pod"                  element={<ProofOfDelivery />} />
                  <Route path="/returns"              element={<SalesReturns />} />
                  <Route path="/allocation"           element={<Allocation />} />
                  <Route path="/grn"                  element={<GRN />} />
                  <Route path="/invoice-ocr"          element={<InvoiceOCR />} />
                  <Route path="/shade-cards"          element={<ShadeCards />} />
                  <Route path="/shade-approvals"      element={<ShadeApprovals />} />
                  <Route path="/jobwork-reconciliation" element={<JobworkReconciliation />} />
                  <Route path="/yarn-store"           element={<YarnStore />} />
                  <Route path="/yarn-issue"           element={<YarnIssue />} />
                  <Route path="/greige"               element={<GreigeWarehouse />} />
                  <Route path="/batching"             element={<Batching />} />
                  <Route path="/subcontracting"       element={<Subcontracting />} />
                  <Route path="/finishing"            element={<Finishing />} />
                  <Route path="/quality-inspection"   element={<QualityInspection />} />
                  <Route path="/fabric-inspection"    element={<FabricInspection />} />
                  <Route path="/fabric-quality"       element={<FabricQualityDashboard />} />
                  <Route path="/defect-types"         element={<DefectTypes />} />
                  <Route path="/ai-image" element={<AIImage />} />
                  <Route path="/ask-ai"               element={<AskAI />} />
                  <Route path="/ai-approvals"         element={<Approvals />} />
                  <Route path="/planning"             element={<Planning />} />
                  <Route path="/operations"          element={<OperationsDashboard />} />
                  <Route path="/shift-entry"          element={<ShiftProductionEntry />} />
                  <Route path="/traceability"         element={<Traceability />} />
                  <Route path="/inventory-reports"    element={<InventoryReports />} />
                  <Route path="/costing"              element={<Costing />} />
                  <Route path="/finished-goods"       element={<FinishedGoods />} />
                  <Route path="/dispatch"             element={<Dispatch />} />
                  <Route path="/vendor-stock"          element={<VendorStock />} />
                  <Route path="/items"               element={<ItemMaster />} />
                  <Route path="/partners"            element={<Partners />} />
                  <Route path="/admin/masters"       element={<AdminMasters />} />
                  <Route path="/whatsapp-inbox"      element={<WhatsAppInbox />} />
                  <Route path="/whatsapp-insights"   element={<WhatsAppInsights />} />
                  <Route path="/whatsapp-campaigns"  element={<WhatsAppCampaigns />} />
                  <Route path="/optin-growth"        element={<OptinGrowth />} />
                  <Route path="/stock-statement"     element={<StockStatement />} />
                  <Route path="/work-center-stock"   element={<WorkCenterStock />} />
                  <Route path="/gst-report"          element={<GSTReport />} />
                  <Route path="/gstr1"               element={<GSTR1 />} />
                  <Route path="/itc04"               element={<ITC04 />} />
                  <Route path="/financial"           element={<FinancialDashboard />} />
                  <Route path="/bank-reconciliation" element={<BankReconciliation />} />
                  <Route path="/bank-payouts" element={<BankPayouts />} />
                  <Route path="/trash"               element={<Trash />} />
                  <Route path="/complaints"          element={<Complaints />} />
                  <Route path="/compliance"          element={<Compliance />} />
                  <Route path="/retention"           element={<Retention />} />
                  <Route path="/system-monitor"      element={<SystemMonitor />} />
                  <Route path="/approval-matrix"     element={<ApprovalMatrix />} />
                  <Route path="/stock-valuation"     element={<StockValuation />} />
                  <Route path="/credit-terms"        element={<CreditTerms />} />
                  <Route path="/ai-performance"      element={<AIPerformance />} />
                  <Route path="/partner-scorecard"   element={<PartnerScorecard />} />
                  <Route path="/busy-production"     element={<BusyProduction />} />
                  <Route path="/ai-accountant"       element={<AIAccountant />} />
                  <Route path="/import-control-tower" element={<ImportControlTower />} />
                  <Route path="/imports"             element={<ImportControlTower />} />
                  <Route path="/imports/:id"         element={<ImportDetail />} />
                  <Route path="/import-reports"      element={<ImportReports />} />
                  <Route path="/import-vessels"      element={<ImportVessels />} />
                  <Route path="/import-intake"       element={<ImportIntake />} />
                  <Route path="/import-payments"     element={<ImportPaymentsDesk />} />
                  <Route path="/opening-balances"   element={<OpeningBalances />} />
                  <Route path="/work-orders"        element={<WorkOrders />} />
                  <Route path="/spare-parts"        element={<SpareParts />} />
                  <Route path="/knitting-library"   element={<KnittingLibrary />} />
                </Routes>
                </div>
              </div>
              <AskAIWidget />
            </div>
          </RequireAuth>
        } />
      </Routes>
      <InstallPrompt />
    </BrowserRouter>
  );
}

export default App;
