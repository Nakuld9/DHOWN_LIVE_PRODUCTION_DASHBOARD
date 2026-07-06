import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReportFilterBar from '../components/ReportFilterBar';
import logo from '../assets/images/dhown-logo.png';

const today = new Date().toISOString().slice(0, 10);
const thirtyAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

const REPORTS = [
  {
    type: 'production',
    title: 'Production Report',
    icon: '📊',
    desc: 'Machine-wise, fabric-wise, shift-wise and operator-wise production analysis',
    tags: ['Production KG', 'Machine Wise', 'Fabric Wise', 'Shift Wise'],
  },
  {
    type: 'rolls',
    title: 'Roll Production Report',
    icon: '🧶',
    desc: 'Individual roll records with weight, operator, machine and fabric details',
    tags: ['Roll Number', 'Weight KG', 'Operator', 'Fabric'],
  },
  {
    type: 'shifts',
    title: 'Shift Report',
    icon: '🕐',
    desc: 'Shift-wise production, downtime, OEE, operators and supervisor handover notes',
    tags: ['Production', 'Downtime', 'OEE', 'Handover Notes'],
  },
  {
    type: 'machines',
    title: 'Machine Performance',
    icon: '⚙️',
    desc: 'Per-machine RPM, production, utilization, efficiency and downtime analysis',
    tags: ['RPM', 'Utilization %', 'Efficiency %', 'OEE'],
  },
  {
    type: 'downtime',
    title: 'Downtime Report',
    icon: '⏱️',
    desc: 'Machine downtime events with reason, duration and summary by cause',
    tags: ['Duration', 'Reason', 'Machine', 'Trend'],
  },
  {
    type: 'operators',
    title: 'Operator Report',
    icon: '👷',
    desc: 'Operator productivity, machine assignments, RFID scans and hours worked',
    tags: ['Production KG', 'Assignments', 'RFID Scans', 'Hours'],
  },
  {
    type: 'summary',
    title: 'Factory Summary',
    icon: '🏭',
    desc: 'Management-level overview: machines, production, downtime, operators and OEE',
    tags: ['Total Machines', 'Production', 'Downtime', 'Avg OEE'],
  },
  {
    type: 'maintenance',
    title: 'Maintenance Report',
    icon: '🔧',
    desc: 'PM schedule status — overdue tasks, due-soon alerts, completion history by machine and priority',
    tags: ['Overdue', 'Due Soon', 'Priority', 'Machine-wise'],
  },
];

export default function ReportsDashboard() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    from: thirtyAgo, to: today, shift: '', machine: '', operator: '', fabric: '',
  });

  const buildParams = (type, autodownload = false) => {
    const p = new URLSearchParams({ type, from: filters.from, to: filters.to });
    if (filters.shift)    p.set('shift',    filters.shift);
    if (filters.machine)  p.set('machine',  filters.machine);
    if (filters.operator) p.set('operator', filters.operator);
    if (filters.fabric)   p.set('fabric',   filters.fabric);
    if (autodownload)     p.set('autodownload', '1');
    return p.toString();
  };

  return (
    <div style={{ padding: '30px', color: '#fff', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '28px' }}>
        <img src={logo} alt="DHOWN" style={{ width: '72px', height: '72px', objectFit: 'contain', filter: 'drop-shadow(0 0 8px #FFD700)' }} />
        <div>
          <h1 style={{ color: '#FFD700', fontSize: '48px', margin: 0, letterSpacing: '2px' }}>REPORT CENTER</h1>
          <p style={{ color: '#aaa', margin: '4px 0 0', fontSize: '14px' }}>DHOWN HOSIERY MILLS — Select a report to preview or download</p>
        </div>
      </div>

      {/* Global Filter Bar */}
      <ReportFilterBar
        filters={filters}
        onChange={setFilters}
        onApply={() => {}}
      />

      {/* Report Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        {REPORTS.map(r => (
          <ReportCard
            key={r.type}
            report={r}
            onPreview={() => navigate(`/reports/preview?${buildParams(r.type)}`)}
            onDownload={() => navigate(`/reports/preview?${buildParams(r.type, true)}`)}
          />
        ))}
      </div>
    </div>
  );
}

function ReportCard({ report, onPreview, onDownload }) {
  return (
    <div style={{
      background: '#081830',
      border: '1px solid #23395d',
      borderRadius: '12px',
      padding: '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      transition: 'border-color 0.2s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#FFD700'}
      onMouseLeave={e => e.currentTarget.style.borderColor = '#23395d'}
    >
      {/* Icon + Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '36px' }}>{report.icon}</span>
        <h2 style={{ color: '#FFD700', margin: 0, fontSize: '18px', fontWeight: 'bold' }}>{report.title}</h2>
      </div>

      {/* Description */}
      <p style={{ color: '#bbb', margin: 0, fontSize: '13px', lineHeight: '1.5' }}>{report.desc}</p>

      {/* Tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {report.tags.map(t => (
          <span key={t} style={{
            background: '#0d2240', border: '1px solid #344a6c',
            color: '#88aacc', fontSize: '11px', padding: '3px 8px', borderRadius: '4px',
          }}>{t}</span>
        ))}
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
        <button
          onClick={onPreview}
          style={{
            flex: 1, background: '#FFD700', color: '#000', border: 'none',
            padding: '10px', borderRadius: '7px', fontWeight: 'bold',
            cursor: 'pointer', fontSize: '13px', letterSpacing: '0.3px',
          }}
        >
          Preview Report
        </button>
        <button
          onClick={onDownload}
          style={{
            flex: 1, background: 'transparent', color: '#FFD700',
            border: '1px solid #FFD700',
            padding: '10px', borderRadius: '7px', fontWeight: 'bold',
            cursor: 'pointer', fontSize: '13px', letterSpacing: '0.3px',
          }}
        >
          Download PDF
        </button>
      </div>
    </div>
  );
}
