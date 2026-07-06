import React, { useState, useEffect } from "react";

const API = "http://localhost:4000";
const token = () => localStorage.getItem("dhown_token");
const h = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS_COLORS = { PASSED: "#22c55e", FAILED: "#ef4444" };
const GRADE_COLORS = { A: "#22c55e", B: "#f59e0b", C: "#eab308", R: "#ef4444" };

export default function QualityInspectionReport() {
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    machineId: "",
    rollId: "",
    inspectorId: "",
    result: ""
  });
  const [inspections, setInspections] = useState([]);
  const [filtersData, setFiltersData] = useState({ machines: [], rolls: [], inspectors: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch filter data (machines, rolls, inspectors)
  const fetchFilterData = async () => {
    try {
      const res = await fetch(`${API}/api/quality-inspection-report/filters`, { headers: h() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFiltersData(data);
    } catch (err) {
      setError(`Failed to load filter data: ${err.message}`);
    }
  };

  // Fetch inspection data based on filters
  const fetchInspections = async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (filters.dateFrom) query.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) query.append('dateTo', filters.dateTo);
      if (filters.machineId) query.append('machineId', filters.machineId);
      if (filters.rollId) query.append('rollId', filters.rollId);
      if (filters.inspectorId) query.append('inspectorId', filters.inspectorId);
      if (filters.result) query.append('result', filters.result);

      const url = `${API}/api/quality-inspection-report?${query.toString()}`;
      const res = await fetch(url, { headers: h() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInspections(data);
    } catch (err) {
      setError(`Failed to load inspections: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Export to CSV
  const exportToCSV = async () => {
    try {
      const query = new URLSearchParams();
      if (filters.dateFrom) query.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) query.append('dateTo', filters.dateTo);
      if (filters.machineId) query.append('machineId', filters.machineId);
      if (filters.rollId) query.append('rollId', filters.rollId);
      if (filters.inspectorId) query.append('inspectorId', filters.inspectorId);
      if (filters.result) query.append('result', filters.result);

      const url = `${API}/api/quality-inspection-report/csv?${query.toString()}`;
      const res = await fetch(url, { headers: h() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quality_inspection_report_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Failed to export CSV: ${err.message}`);
    }
  };

  // Export to PDF
  const exportToPDF = async () => {
    try {
      const query = new URLSearchParams();
      if (filters.dateFrom) query.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) query.append('dateTo', filters.dateTo);
      if (filters.machineId) query.append('machineId', filters.machineId);
      if (filters.rollId) query.append('rollId', filters.rollId);
      if (filters.inspectorId) query.append('inspectorId', filters.inspectorId);
      if (filters.result) query.append('result', filters.result);

      const url = `${API}/api/quality-inspection-report/pdf?${query.toString()}`;
      const res = await fetch(url, { headers: h() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `quality_inspection_report_${new Date().toISOString().slice(0,10)}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Failed to export PDF: ${err.message}`);
    }
  };

  // Print Preview - opens PDF in new window for printing
  const handlePrintPreview = async () => {
    try {
      const query = new URLSearchParams();
      if (filters.dateFrom) query.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) query.append('dateTo', filters.dateTo);
      if (filters.machineId) query.append('machineId', filters.machineId);
      if (filters.rollId) query.append('rollId', filters.rollId);
      if (filters.inspectorId) query.append('inspectorId', filters.inspectorId);
      if (filters.result) query.append('result', filters.result);

      const url = `${API}/api/quality-inspection-report/pdf?${query.toString()}`;
      // Open PDF in new window for print preview
      window.open(url, '_blank');
    } catch (err) {
      alert(`Failed to open PDF preview: ${err.message}`);
    }
  };

  useEffect(() => {
    fetchFilterData();
    fetchInspections();
  }, []);

  // Refetch inspections when filters change
  useEffect(() => {
    fetchInspections();
  }, [filters]);

  if (loading) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "#7da2d6" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>📊</div>
        <p>Loading Quality Inspection Report...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "#ef4444" }}>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", color: "#e2e8f0", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ margin: 0, color: "#f4ae1f" }}>Quality Inspection Report</h1>
        <div style={{ display: "flex", gap: "12px" }}>
          <button onClick={exportToCSV}
            style={{ background: "#1e3a5f", color: "#e2e8f0", border: "1px solid #3b4f61", padding: "8px 16px", borderRadius: "6px", cursor: "pointer" }}>
            Export CSV
          </button>
          <button onClick={exportToPDF}
            style={{ background: "#1e3a5f", color: "#e2e8f0", border: "1px solid #3b4f61", padding: "8px 16px", borderRadius: "6px", cursor: "pointer" }}>
            Export PDF
          </button>
          <button onClick={handlePrintPreview}
            style={{ background: "#1e3a5f", color: "#e2e8f0", border: "1px solid #3b4f61", padding: "8px 16px", borderRadius: "6px", cursor: "pointer" }}>
            Print Preview
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ background: "#0d1b2a", borderRadius: "10px", padding: "20px", marginBottom: "20px" }}>
        <h2 style={{ margin: "0 0 16px", color: "#f4ae1f" }}>Filters</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          <div>
            <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Date From</label>
            <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              style={{ width: "100%", background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Date To</label>
            <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              style={{ width: "100%", background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Machine</label>
            <select value={filters.machineId} onChange={(e) => setFilters({ ...filters, machineId: e.target.value })}
              style={{ width: "100%", background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }}>
              <option value="">All Machines</option>
              {filtersData.machines.map(m => (
                <option key={m.machine_id} value={m.machine_id}>{m.machine_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Roll</label>
            <select value={filters.rollId} onChange={(e) => setFilters({ ...filters, rollId: e.target.value })}
              style={{ width: "100%", background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }}>
              <option value="">All Rolls</option>
              {filtersData.rolls.map(r => (
                <option key={r.roll_id} value={r.roll_id}>{r.roll_id}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Inspector</label>
            <select value={filters.inspectorId} onChange={(e) => setFilters({ ...filters, inspectorId: e.target.value })}
              style={{ width: "100%", background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }}>
              <option value="">All Inspectors</option>
              {filtersData.inspectors.map(i => (
                <option key={i.operator_id} value={i.operator_id}>{i.operator_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ color: "#7da2d6", fontSize: "12px", marginBottom: "4px", display: "block" }}>Result</label>
            <select value={filters.result} onChange={(e) => setFilters({ ...filters, result: e.target.value })}
              style={{ width: "100%", background: "#0a1828", border: "1px solid #1e3a5f", borderRadius: 4, padding: "5px 8px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }}>
              <option value="">All Results</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Inspections Table */}
      <div style={{ marginTop: "10px" }}>
        <h2 style={{ margin: "0 0 12px", color: "#f4ae1f" }}>Inspections ({inspections.length})</h2>
        {inspections.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px", color: "#7da2d6" }}>
            <div style={{ fontSize: "36px", marginBottom: "12px" }}>📋</div>
            <p>No inspections found matching the filters.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "12px" }}>
              <thead>
                <tr style={{ backgroundColor: "#0d1b2a" }}>
                  <th style={{ padding: "10px", textAlign: "left", color: "#e2e8f0", fontSize: "12px" }}>ID</th>
                  <th style={{ padding: "10px", textAlign: "left", color: "#e2e8f0", fontSize: "12px" }}>Roll ID</th>
                  <th style={{ padding: "10px", textAlign: "left", color: "#e2e8f0", fontSize: "12px" }}>Machine</th>
                  <th style={{ padding: "10px", textAlign: "left", color: "#e2e8f0", fontSize: "12px" }}>Type</th>
                  <th style={{ padding: "10px", textAlign: "left", color: "#e2e8f0", fontSize: "12px" }}>Grade</th>
                  <th style={{ padding: "10px", textAlign: "left", color: "#e2e8f0", fontSize: "12px" }}>Date</th>
                  <th style={{ padding: "10px", textAlign: "left", color: "#e2e8f0", fontSize: "12px" }}>Inspector</th>
                  <th style={{ padding: "10px", textAlign: "left", color: "#e2e8f0", fontSize: "12px" }}>Defects</th>
                  <th style={{ padding: "10px", textAlign: "left", color: "#e2e8f0", fontSize: "12px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {inspections.map(insp => (
                  <tr key={insp.inspection_id} style={{ backgroundColor: insp.passed ? "#0d1b2a" : "#1a0d0d" }}>
                    <td style={{ padding: "10px", color: "#e2e8f0" }}>{insp.inspection_id}</td>
                    <td style={{ padding: "10px", color: "#e2e8f0" }}>{insp.roll_id}</td>
                    <td style={{ padding: "10px", color: "#e2e8f0" }}>{insp.machine_name || 'N/A'}</td>
                    <td style={{ padding: "10px", color: "#f4ae1f" }}>{insp.inspection_type}</td>
                    <td style={{ padding: "10px", color: {A: "#22c55e", B: "#f59e0b", C: "#eab308", R: "#ef4444"}[insp.grade] || "#7da2d6" }}>{insp.grade || '-'}</td>
                    <td style={{ padding: "10px", color: "#e2e8f0" }}>{fmtDateTime(insp.inspection_date)}</td>
                    <td style={{ padding: "10px", color: "#e2e8f0" }}>{insp.inspector || 'N/A'}</td>
                    <td style={{ padding: "10px", color: "#e2e8f0" }}>{insp.defect_count || 0}</td>
                    <td style={{ padding: "10px", color: {true: "#22c55e", false: "#ef4444"}[insp.passed] }}>{insp.passed ? "PASSED" : "FAILED"</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}