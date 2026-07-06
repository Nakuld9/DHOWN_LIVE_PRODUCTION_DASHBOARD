import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ReportFilterBar from '../components/ReportFilterBar';
import logo from '../assets/images/dhown-logo.png';

// ─── helpers ──────────────────────────────────────────────────────
const fmt = v => (v == null || v === '' ? '—' : v);
const fmtKg = v => (parseFloat(v) || 0).toFixed(3) + ' kg';
const fmtPct = v => (parseFloat(v) || 0).toFixed(2) + '%';
const fmtNum = (v, d = 2) => (parseFloat(v) || 0).toFixed(d);
const fmtTs = v => v ? new Date(v).toLocaleString() : '—';
const fmtDate = v => v ? new Date(v).toLocaleDateString() : '—';

const REPORT_META = {
  production:  { name: 'Production Report',         icon: '📊' },
  rolls:       { name: 'Roll Production Report',    icon: '🧶' },
  shifts:      { name: 'Shift Report',              icon: '🕐' },
  machines:    { name: 'Machine Performance Report',icon: '⚙️' },
  downtime:    { name: 'Downtime Report',           icon: '⏱️' },
  operators:   { name: 'Operator Report',           icon: '👷' },
  rfid:        { name: 'RFID Activity Report',      icon: '📡' },
  assignments:     { name: 'Assignment Report',         icon: '🔗' },
  summary:         { name: 'Factory Summary Report',    icon: '🏭' },
  maintenance:     { name: 'Maintenance Report',        icon: '🔧' },
  'shift-handover':{ name: 'Shift Handover Report',    icon: '📝' },
};

// PDF brand colors
const C = {
  dark:   [5, 13, 26],
  header: [8, 24, 48],
  gold:   [255, 215, 0],
  text:   [220, 220, 220],
  alt:    [10, 20, 38],
};

async function getLogoBase64(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function buildPDF(type, reportName, data, filters) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, M = 14;

  // ── Header background ──────────────────────────────────────────
  doc.setFillColor(...C.dark);
  doc.rect(0, 0, W, 48, 'F');
  doc.setFillColor(...C.gold);
  doc.rect(0, 0, W, 2.5, 'F');
  doc.rect(0, 45.5, W, 2.5, 'F');

  // Logo
  const logoData = await getLogoBase64(logo);
  if (logoData) doc.addImage(logoData, 'PNG', M, 7, 18, 18);

  // Title block
  doc.setTextColor(...C.gold);
  doc.setFontSize(15); doc.setFont('helvetica', 'bold');
  doc.text('DHOWN HOSIERY MILLS', W / 2, 14, { align: 'center' });

  doc.setFontSize(11);
  doc.text(reportName.toUpperCase(), W / 2, 22, { align: 'center' });

  doc.setTextColor(...C.text);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(
    `Generated: ${new Date().toLocaleString()}   |   Period: ${filters.from || '—'} to ${filters.to || '—'}`,
    W / 2, 29, { align: 'center' }
  );

  const fParts = [];
  if (filters.shift)    fParts.push(`Shift: ${filters.shift}`);
  if (filters.machine)  fParts.push(`Machine: ${filters.machine}`);
  if (filters.operator) fParts.push(`Operator: ${filters.operator}`);
  if (filters.fabric)   fParts.push(`Fabric: ${filters.fabric}`);
  if (fParts.length) {
    doc.setTextColor(...C.gold);
    doc.setFontSize(7.5);
    doc.text(`Filters: ${fParts.join('  |  ')}`, W / 2, 36, { align: 'center' });
  }

  const tStyle = {
    headStyles: { fillColor: C.header, textColor: C.gold, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fillColor: C.dark, textColor: C.text, fontSize: 7.5 },
    alternateRowStyles: { fillColor: C.alt },
    margin: { left: M, right: M },
    tableLineColor: [30, 50, 80],
    tableLineWidth: 0.1,
  };

  let y = 54;

  // ── Report-specific tables ─────────────────────────────────────
  if (type === 'production') {
    const s = data.summary || {};
    doc.setFillColor(8, 24, 48);
    doc.roundedRect(M, y, W - 2 * M, 18, 2, 2, 'F');
    doc.setTextColor(...C.gold); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    const cols = W / 3;
    doc.text(`Total Production`, M + cols * 0 + cols / 2, y + 6, { align: 'center' });
    doc.text(`Active Machines`,  M + cols * 1 + cols / 2, y + 6, { align: 'center' });
    doc.text(`Shifts Worked`,    M + cols * 2 + cols / 2, y + 6, { align: 'center' });
    doc.setTextColor(255, 255, 255); doc.setFontSize(11);
    doc.text(`${fmtNum(s.total_kg, 3)} kg`, M + cols * 0 + cols / 2, y + 13, { align: 'center' });
    doc.text(`${s.active_machines || 0}`,   M + cols * 1 + cols / 2, y + 13, { align: 'center' });
    doc.text(`${s.shifts_worked || 0}`,     M + cols * 2 + cols / 2, y + 13, { align: 'center' });
    y += 24;

    doc.setTextColor(...C.gold); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('MACHINE-WISE PRODUCTION', M, y); y += 4;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Machine ID', 'Machine Name', 'Fabric', 'Production KG', 'Avg RPM', 'Run Hours']],
      body: (data.machine_wise || []).map(r => [r.machine_id, r.machine_name, r.fabric, fmtNum(r.production_kg, 3), fmtNum(r.rpm_avg), fmtNum(r.running_hours)]),
    });
    y = doc.lastAutoTable.finalY + 8;

    doc.setTextColor(...C.gold); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('FABRIC-WISE PRODUCTION', M, y); y += 4;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Fabric Type', 'Production KG']],
      body: (data.fabric_wise || []).map(r => [r.fabric, fmtNum(r.production_kg, 3)]),
    });
    y = doc.lastAutoTable.finalY + 8;

    doc.setTextColor(...C.gold); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('SHIFT-WISE PRODUCTION', M, y); y += 4;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Shift', 'Production KG']],
      body: (data.shift_wise || []).map(r => [r.shift, fmtNum(r.production_kg, 3)]),
    });
  }

  else if (type === 'rolls') {
    doc.setFillColor(8, 24, 48); doc.roundedRect(M, y, W - 2 * M, 18, 2, 2, 'F');
    doc.setTextColor(...C.gold); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    const cols = W / 2;
    doc.text('Total Rolls',      M + cols * 0 + cols / 2, y + 6, { align: 'center' });
    doc.text('Total Weight',     M + cols * 1 + cols / 2, y + 6, { align: 'center' });
    doc.setTextColor(255, 255, 255); doc.setFontSize(11);
    doc.text(`${data.total_rolls || 0}`,               M + cols * 0 + cols / 2, y + 13, { align: 'center' });
    doc.text(`${fmtNum(data.total_weight_kg, 3)} kg`,  M + cols * 1 + cols / 2, y + 13, { align: 'center' });
    y += 24;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Roll ID', 'Machine', 'Operator', 'Fabric', 'Weight KG', 'Status', 'Created']],
      body: (data.rolls || []).map(r => [r.roll_id, r.machine_id, r.operator_name, r.fabric_type, fmtNum(r.weight_kg, 3), r.status, fmtDate(r.created_at)]),
    });
  }

  else if (type === 'shifts') {
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Shift', 'Production KG', 'Machines', 'Run Min', 'Downtime Min', 'Avg OEE%', 'Availability%', 'Operators']],
      body: (data.shifts || []).map(r => [r.shift, fmtNum(r.production_kg, 3), r.running_machines, r.run_minutes, r.downtime_minutes, fmtNum(r.avg_oee), fmtNum(r.avg_availability), r.active_operators]),
    });
  }

  else if (type === 'machines') {
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Machine ID', 'Name', 'Avg RPM', 'Target RPM', 'Run Hrs', 'DT Hrs', 'Prod KG', 'Util%', 'Eff%', 'OEE%']],
      body: (data.machines || []).map(r => [r.machine_id, r.machine_name, fmtNum(r.rpm_avg), r.rpm_target, fmtNum(r.running_hours), fmtNum(r.downtime_hours), fmtNum(r.production_kg, 3), fmtNum(r.utilization_pct), fmtNum(r.efficiency_pct), fmtNum(r.oee)]),
    });
  }

  else if (type === 'downtime') {
    doc.setFillColor(8, 24, 48); doc.roundedRect(M, y, W - 2 * M, 18, 2, 2, 'F');
    doc.setTextColor(...C.gold); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    const cols = W / 2;
    doc.text('Total Events',    M + cols * 0 + cols / 2, y + 6, { align: 'center' });
    doc.text('Total Duration',  M + cols * 1 + cols / 2, y + 6, { align: 'center' });
    doc.setTextColor(255, 255, 255); doc.setFontSize(11);
    doc.text(`${data.total_events || 0}`,                           M + cols * 0 + cols / 2, y + 13, { align: 'center' });
    doc.text(`${fmtNum(data.total_minutes, 1)} min`,                M + cols * 1 + cols / 2, y + 13, { align: 'center' });
    y += 24;

    doc.setTextColor(...C.gold); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('DOWNTIME EVENTS', M, y); y += 4;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Machine', 'Reason', 'Start', 'End', 'Duration (min)', 'Shift', 'Status']],
      body: (data.events || []).map(r => [r.machine_id, r.reason, fmtTs(r.start_time), r.end_time ? fmtTs(r.end_time) : 'Open', fmtNum(r.duration_minutes, 1), r.shift, r.status]),
    });
    y = doc.lastAutoTable.finalY + 8;

    doc.setTextColor(...C.gold); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('SUMMARY BY REASON', M, y); y += 4;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Reason', 'Events', 'Total Minutes']],
      body: (data.by_reason || []).map(r => [r.reason, r.event_count, fmtNum(r.total_minutes, 1)]),
    });
  }

  else if (type === 'operators') {
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Operator Name', 'RFID', 'Department', 'Shift', 'Machines', 'Production KG', 'Work Hours']],
      body: (data.operators || []).map(r => [r.operator_name, r.rfid, r.department, r.shift, r.machines_worked, fmtNum(r.production_kg, 3), fmtNum(r.working_hours)]),
    });
  }

  else if (type === 'rfid') {
    doc.setFillColor(8, 24, 48); doc.roundedRect(M, y, 60, 18, 2, 2, 'F');
    doc.setTextColor(...C.gold); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text('Total Scan Events', M + 30, y + 6, { align: 'center' });
    doc.setTextColor(255, 255, 255); doc.setFontSize(11);
    doc.text(`${data.total_events || 0}`, M + 30, y + 13, { align: 'center' });
    y += 24;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['RFID Tag', 'Operator', 'Scan Time', 'Machine']],
      body: (data.events || []).map(r => [r.rfid_tag, r.operator_name, fmtTs(r.event_time), r.machine_id]),
    });
  }

  else if (type === 'assignments') {
    doc.setFillColor(8, 24, 48); doc.roundedRect(M, y, 60, 18, 2, 2, 'F');
    doc.setTextColor(...C.gold); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text('Total Assignments', M + 30, y + 6, { align: 'center' });
    doc.setTextColor(255, 255, 255); doc.setFontSize(11);
    doc.text(`${data.total || 0}`, M + 30, y + 13, { align: 'center' });
    y += 24;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Assignment ID', 'Machine', 'Machine Name', 'Operator', 'Assigned At', 'Released At', 'Status']],
      body: (data.assignments || []).map(r => [r.assignment_id, r.machine_id, r.machine_name, r.operator_name, fmtTs(r.assigned_at), r.released_at ? fmtTs(r.released_at) : 'Active', r.status]),
    });
  }

  else if (type === 'maintenance') {
    const s = data.summary || {};
    doc.setFillColor(8, 24, 48);
    doc.roundedRect(M, y, W - 2 * M, 18, 2, 2, 'F');
    doc.setTextColor(...C.gold); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    const cols4 = (W - 2 * M) / 4;
    ['Total Tasks', 'Overdue', 'Due Soon', 'Critical'].forEach((lbl, i) =>
      doc.text(lbl, M + cols4 * i + cols4 / 2, y + 6, { align: 'center' })
    );
    doc.setTextColor(255, 255, 255); doc.setFontSize(11);
    [s.total_tasks || 0, s.overdue || 0, s.due_soon || 0, s.critical_tasks || 0].forEach((v, i) =>
      doc.text(String(v), M + cols4 * i + cols4 / 2, y + 13, { align: 'center' })
    );
    y += 24;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Machine', 'Task', 'Type', 'Priority', 'Frequency', 'Last Done', 'Next Due', 'Status', 'Assigned To']],
      body: (data.tasks || []).map(r => [
        r.machine_id, r.task_name, r.task_type, r.priority,
        r.frequency_days ? `Every ${r.frequency_days}d` : '—',
        r.last_done_date ? new Date(r.last_done_date).toLocaleDateString('en-IN') : '—',
        r.next_due_date  ? new Date(r.next_due_date).toLocaleDateString('en-IN')  : '—',
        r.due_status?.replace('_', ' ') || '—',
        r.assigned_to || '—',
      ]),
    });
  }

  else if (type === 'shift-handover') {
    const s = data.summary || {};
    doc.setFillColor(8, 24, 48);
    doc.roundedRect(M, y, W - 2 * M, 18, 2, 2, 'F');
    doc.setTextColor(...C.gold); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    const cols3 = (W - 2 * M) / 3;
    ['Total Handovers', 'Total Production KG', 'Avg Production KG'].forEach((lbl, i) =>
      doc.text(lbl, M + cols3 * i + cols3 / 2, y + 6, { align: 'center' })
    );
    doc.setTextColor(255, 255, 255); doc.setFontSize(11);
    [s.total_handovers || 0, fmtNum(s.total_production_kg, 2) + ' kg', fmtNum(s.avg_production_kg, 2) + ' kg'].forEach((v, i) =>
      doc.text(String(v), M + cols3 * i + cols3 / 2, y + 13, { align: 'center' })
    );
    y += 24;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Date', 'Shift', 'Supervisor', 'Prod KG', 'Machines Down', 'Issues', 'Actions Taken', 'Pending']],
      body: (data.handovers || []).map(r => [
        new Date(r.shift_date).toLocaleDateString('en-IN'),
        r.shift === 'D' ? 'Day' : 'Night',
        r.supervisor_name || '—',
        r.production_kg ? fmtNum(r.production_kg, 2) : '—',
        r.machines_down || 0,
        r.issues || '—',
        r.actions_taken || '—',
        r.pending_actions || '—',
      ]),
    });
  }

  else if (type === 'summary') {
    const d = data;
    const kpis = [
      ['Total Machines',    d.total_machines   ?? '—'],
      ['Running Machines',  d.running_machines  ?? '—'],
      ['Offline Machines',  d.offline_machines  ?? '—'],
      ['Active Operators',  d.active_operators  ?? '—'],
      ['Production (KG)',   fmtNum(d.production_kg, 3)],
      ['Downtime (min)',    fmtNum(d.downtime_minutes, 1)],
      ['Downtime Events',   d.downtime_events   ?? '—'],
      ['Avg Efficiency %',  fmtNum(d.avg_efficiency)],
      ['Avg Availability%', fmtNum(d.avg_availability)],
      ['Avg RPM',           fmtNum(d.avg_rpm)],
    ];
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Metric', 'Value']],
      body: kpis,
      columnStyles: { 1: { halign: 'right' } },
    });
  }

  // ── Footer / page numbers ──────────────────────────────────────
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFillColor(...C.dark);
    doc.rect(0, 287, W, 10, 'F');
    doc.setFillColor(...C.gold);
    doc.rect(0, 286, W, 0.8, 'F');
    doc.setFontSize(7); doc.setTextColor(140, 140, 140); doc.setFont('helvetica', 'normal');
    doc.text(
      `DHOWN HOSIERY MILLS  |  ${reportName}  |  Page ${i} of ${pages}  |  ${new Date().toLocaleDateString()}`,
      W / 2, 292, { align: 'center' }
    );
  }

  await doc.save(`DHOWN_${type}_${(filters.from || 'report')}.pdf`);
}

// ─── Styled table ───────────────────────────────────────────────────
const TH = ({ children }) => (
  <th style={{ background: '#081830', color: '#FFD700', padding: '10px 12px', textAlign: 'left', fontSize: '12px', letterSpacing: '0.5px', borderBottom: '1px solid #344a6c', whiteSpace: 'nowrap' }}>
    {children}
  </th>
);
const TD = ({ children, color }) => (
  <td style={{ padding: '9px 12px', color: color || '#ddd', fontSize: '13px', borderBottom: '1px solid #1a2d45' }}>
    {children}
  </td>
);

function Table({ head, rows, emptyMsg = 'No data for selected filters.' }) {
  if (!rows || rows.length === 0) return (
    <div style={{ padding: '40px', textAlign: 'center', color: '#666', fontSize: '14px' }}>{emptyMsg}</div>
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table width="100%" style={{ borderCollapse: 'collapse' }}>
        <thead><tr>{head.map(h => <TH key={h}>{h}</TH>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#0a1726' : '#081526' }}>
              {r.map((cell, j) => <TD key={j} color={cell && cell.color}>{cell && cell.color ? cell.val : cell}</TD>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({ label, value, accent }) {
  return (
    <div style={{ background: '#081830', border: `1px solid ${accent || '#344a6c'}`, borderRadius: '8px', padding: '16px 20px', textAlign: 'center' }}>
      <div style={{ color: accent || '#aaa', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '6px' }}>{label}</div>
      <div style={{ color: '#fff', fontSize: '22px', fontWeight: 'bold' }}>{value}</div>
    </div>
  );
}

function oeeColor(v) {
  const n = parseFloat(v) || 0;
  if (n >= 70) return '#22c55e';
  if (n >= 50) return '#f59e0b';
  return '#ef4444';
}

// ─── Report renderers ────────────────────────────────────────────────
function RenderProduction({ data }) {
  const s = data.summary || {};
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <SummaryCard label="TOTAL PRODUCTION" value={fmtKg(s.total_kg)} accent="#FFD700" />
        <SummaryCard label="ACTIVE MACHINES"  value={s.active_machines || 0} />
        <SummaryCard label="SHIFTS WORKED"    value={s.shifts_worked || 0} />
      </div>

      <Section title="MACHINE-WISE PRODUCTION">
        <Table head={['Machine ID', 'Machine Name', 'Fabric', 'Production KG', 'Avg RPM', 'Run Hours']}
          rows={(data.machine_wise || []).map(r => [r.machine_id, r.machine_name, r.fabric, fmtKg(r.production_kg), fmtNum(r.rpm_avg), fmtNum(r.running_hours) + ' h'])} />
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
        <Section title="FABRIC-WISE">
          <Table head={['Fabric', 'Production KG']}
            rows={(data.fabric_wise || []).map(r => [r.fabric, fmtKg(r.production_kg)])} />
        </Section>
        <Section title="SHIFT-WISE">
          <Table head={['Shift', 'Production KG']}
            rows={(data.shift_wise || []).map(r => [r.shift, fmtKg(r.production_kg)])} />
        </Section>
      </div>
    </>
  );
}

function RenderRolls({ data }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <SummaryCard label="TOTAL ROLLS"  value={data.total_rolls || 0} accent="#FFD700" />
        <SummaryCard label="TOTAL WEIGHT" value={fmtKg(data.total_weight_kg)} accent="#FFD700" />
      </div>
      <Table
        head={['Roll ID', 'Machine', 'Operator', 'Fabric', 'Weight KG', 'Status', 'Created']}
        rows={(data.rolls || []).map(r => [r.roll_id, r.machine_id, r.operator_name, r.fabric_type, fmtKg(r.weight_kg), r.status, fmtTs(r.created_at)])}
      />
    </>
  );
}

function RenderShifts({ data }) {
  return (
    <Table
      head={['Shift', 'Production KG', 'Machines', 'Run Min', 'Downtime Min', 'Avg OEE %', 'Availability %', 'Operators']}
      rows={(data.shifts || []).map(r => [r.shift, fmtKg(r.production_kg), r.running_machines, r.run_minutes, r.downtime_minutes, fmtPct(r.avg_oee), fmtPct(r.avg_availability), r.active_operators])}
    />
  );
}

function RenderMachines({ data }) {
  return (
    <Table
      head={['Machine ID', 'Name', 'Avg RPM', 'Target RPM', 'Run Hrs', 'DT Hrs', 'Prod KG', 'Util %', 'Eff %', 'OEE %']}
      rows={(data.machines || []).map(r => {
        const c = oeeColor(r.oee);
        return [r.machine_id, r.machine_name, fmtNum(r.rpm_avg), r.rpm_target,
          fmtNum(r.running_hours), fmtNum(r.downtime_hours), fmtKg(r.production_kg),
          fmtPct(r.utilization_pct), fmtPct(r.efficiency_pct),
          { val: fmtPct(r.oee), color: c }];
      })}
    />
  );
}

function RenderDowntime({ data }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <SummaryCard label="TOTAL EVENTS"   value={data.total_events || 0} accent="#ef4444" />
        <SummaryCard label="TOTAL DURATION" value={fmtNum(data.total_minutes, 1) + ' min'} accent="#ef4444" />
      </div>
      <Section title="DOWNTIME EVENTS">
        <Table
          head={['Machine', 'Reason', 'Start Time', 'End Time', 'Duration (min)', 'Shift', 'Status']}
          rows={(data.events || []).map(r => [r.machine_name, r.reason, fmtTs(r.start_time), r.end_time ? fmtTs(r.end_time) : 'Open', fmtNum(r.duration_minutes, 1), r.shift, r.status])}
        />
      </Section>
      <div style={{ marginTop: '20px' }}>
        <Section title="SUMMARY BY REASON">
          <Table head={['Reason', 'Events', 'Total Minutes']}
            rows={(data.by_reason || []).map(r => [r.reason, r.event_count, fmtNum(r.total_minutes, 1)])} />
        </Section>
      </div>
    </>
  );
}

function RenderOperators({ data }) {
  return (
    <Table
      head={['Operator Name', 'RFID', 'Department', 'Shift', 'Machines', 'Production KG', 'Work Hours']}
      rows={(data.operators || []).map(r => [r.operator_name, r.rfid, r.department, r.shift, r.machines_worked, fmtKg(r.production_kg), fmtNum(r.working_hours) + ' h'])}
    />
  );
}

function RenderRFID({ data }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 200px)', gap: '16px', marginBottom: '24px' }}>
        <SummaryCard label="TOTAL SCAN EVENTS" value={data.total_events || 0} accent="#FFD700" />
      </div>
      <Table
        head={['RFID Tag', 'Operator', 'Scan Time', 'Machine']}
        rows={(data.events || []).map(r => [r.rfid_tag, r.operator_name, fmtTs(r.event_time), r.machine_id])}
      />
    </>
  );
}

function RenderAssignments({ data }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 200px)', gap: '16px', marginBottom: '24px' }}>
        <SummaryCard label="TOTAL ASSIGNMENTS" value={data.total || 0} accent="#FFD700" />
      </div>
      <Table
        head={['ID', 'Machine ID', 'Machine Name', 'Operator', 'Assigned At', 'Released At', 'Status']}
        rows={(data.assignments || []).map(r => [r.assignment_id, r.machine_id, r.machine_name, r.operator_name, fmtTs(r.assigned_at), r.released_at ? fmtTs(r.released_at) : 'Active', r.status])}
      />
    </>
  );
}

function RenderSummary({ data: d }) {
  const kpis = [
    { label: 'TOTAL MACHINES',    value: d.total_machines  ?? '—', accent: '#88aacc' },
    { label: 'RUNNING',           value: d.running_machines ?? '—', accent: '#22c55e' },
    { label: 'OFFLINE',           value: d.offline_machines ?? '—', accent: '#ef4444' },
    { label: 'ACTIVE OPERATORS',  value: d.active_operators ?? '—', accent: '#FFD700' },
    { label: 'PRODUCTION (KG)',   value: fmtNum(d.production_kg, 3), accent: '#FFD700' },
    { label: 'DOWNTIME (MIN)',    value: fmtNum(d.downtime_minutes, 1), accent: '#f59e0b' },
    { label: 'DOWNTIME EVENTS',  value: d.downtime_events ?? '—', accent: '#f59e0b' },
    { label: 'AVG EFFICIENCY %', value: fmtPct(d.avg_efficiency), accent: oeeColor(d.avg_efficiency) },
    { label: 'AVG AVAILABILITY%',value: fmtPct(d.avg_availability), accent: oeeColor(d.avg_availability) },
    { label: 'AVG RPM',          value: fmtNum(d.avg_rpm), accent: '#88aacc' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
      {kpis.map(k => <SummaryCard key={k.label} label={k.label} value={k.value} accent={k.accent} />)}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{ color: '#FFD700', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #1a2d45' }}>{title}</div>
      {children}
    </div>
  );
}

const PRIORITY_COLOR = {
  CRITICAL: '#ef4444', HIGH: '#f59e0b', MEDIUM: '#60a5fa', LOW: '#9ca3af',
};

function RenderMaintenance({ data }) {
  const s = data.summary || {};
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <SummaryCard label="TOTAL TASKS"    value={s.total_tasks || 0}    accent="#88aacc" />
        <SummaryCard label="OVERDUE"        value={s.overdue || 0}         accent="#ef4444" />
        <SummaryCard label="DUE WITHIN 7D"  value={s.due_soon || 0}        accent="#f59e0b" />
        <SummaryCard label="CRITICAL TASKS" value={s.critical_tasks || 0}  accent="#ef4444" />
      </div>
      <Table
        head={['Machine', 'Task Name', 'Type', 'Priority', 'Frequency', 'Last Done', 'Next Due', 'Status', 'Assigned To']}
        rows={(data.tasks || []).map(r => {
          const pc = PRIORITY_COLOR[r.priority] || '#9ca3af';
          const dc = r.due_status === 'OVERDUE' ? '#ef4444' : r.due_status === 'DUE_SOON' ? '#f59e0b' : '#22c55e';
          return [
            r.machine_id,
            r.task_name,
            r.task_type,
            { val: r.priority, color: pc },
            r.frequency_days ? `Every ${r.frequency_days}d` : '—',
            r.last_done_date ? new Date(r.last_done_date).toLocaleDateString('en-IN') : '—',
            { val: r.next_due_date ? new Date(r.next_due_date).toLocaleDateString('en-IN') : '—', color: dc },
            { val: r.due_status?.replace('_', ' ') || '—', color: dc },
            r.assigned_to || '—',
          ];
        })}
      />
    </>
  );
}

function RenderShiftHandover({ data }) {
  const s = data.summary || {};
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <SummaryCard label="TOTAL HANDOVERS"     value={s.total_handovers || 0}                        accent="#FFD700" />
        <SummaryCard label="TOTAL PRODUCTION KG" value={fmtNum(s.total_production_kg, 2) + ' kg'}      accent="#22c55e" />
        <SummaryCard label="AVG PRODUCTION KG"   value={fmtNum(s.avg_production_kg, 2) + ' kg/shift'}  accent="#60a5fa" />
      </div>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
        <div style={{ background: '#081830', border: '1px solid #344a6c', borderRadius: '8px', padding: '12px 20px', textAlign: 'center' }}>
          <div style={{ color: '#fbbf24', fontSize: '11px', fontWeight: 'bold' }}>DAY SHIFTS</div>
          <div style={{ color: '#fff', fontSize: '20px', fontWeight: 'bold' }}>{s.day_shifts || 0}</div>
        </div>
        <div style={{ background: '#081830', border: '1px solid #344a6c', borderRadius: '8px', padding: '12px 20px', textAlign: 'center' }}>
          <div style={{ color: '#818cf8', fontSize: '11px', fontWeight: 'bold' }}>NIGHT SHIFTS</div>
          <div style={{ color: '#fff', fontSize: '20px', fontWeight: 'bold' }}>{s.night_shifts || 0}</div>
        </div>
      </div>
      <Table
        head={['Date', 'Shift', 'Supervisor', 'Prod KG', 'Machines Down', 'Issues', 'Actions Taken', 'Pending Actions']}
        rows={(data.handovers || []).map(r => [
          new Date(r.shift_date).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }),
          { val: r.shift === 'D' ? '☀ Day' : '🌙 Night', color: r.shift === 'D' ? '#fbbf24' : '#818cf8' },
          r.supervisor_name || '—',
          r.production_kg ? fmtNum(r.production_kg, 2) + ' kg' : '—',
          r.machines_down > 0 ? { val: String(r.machines_down), color: '#ef4444' } : '0',
          r.issues || '—',
          r.actions_taken || '—',
          r.pending_actions ? { val: r.pending_actions, color: '#f59e0b' } : '—',
        ])}
      />
    </>
  );
}

const RENDERERS = {
  production:       RenderProduction,
  rolls:            RenderRolls,
  shifts:           RenderShifts,
  machines:         RenderMachines,
  downtime:         RenderDowntime,
  operators:        RenderOperators,
  rfid:             RenderRFID,
  assignments:      RenderAssignments,
  summary:          RenderSummary,
  maintenance:      RenderMaintenance,
  'shift-handover': RenderShiftHandover,
};

// ─── Main Component ──────────────────────────────────────────────────
export default function ReportPreview() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const autodownload = searchParams.get('autodownload') === '1';
  const type = searchParams.get('type') || 'production';
  const meta = REPORT_META[type] || { name: 'Report', icon: '📋' };

  const initFilters = {
    from:     searchParams.get('from')     || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10),
    to:       searchParams.get('to')       || new Date().toISOString().slice(0, 10),
    shift:    searchParams.get('shift')    || '',
    machine:  searchParams.get('machine')  || '',
    operator: searchParams.get('operator') || '',
    fabric:   searchParams.get('fabric')   || '',
  };

  const [filters, setFilters] = useState(initFilters);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const autodownloaded = useRef(false);

  const fetchData = useCallback(async (f) => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams();
      if (f.from)     p.set('from',     f.from);
      if (f.to)       p.set('to',       f.to);
      if (f.shift)    p.set('shift',    f.shift);
      if (f.machine)  p.set('machine',  f.machine);
      if (f.operator) p.set('operator', f.operator);
      if (f.fabric)   p.set('fabric',   f.fabric);

      const res = await fetch(`http://localhost:4000/api/reports/${type}?${p.toString()}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { fetchData(filters); }, []);

  useEffect(() => {
    if (data && autodownload && !autodownloaded.current) {
      autodownloaded.current = true;
      handleDownloadPDF();
    }
  }, [data]);

  const handleDownloadPDF = async () => {
    if (!data) return;
    setPdfLoading(true);
    try {
      await buildPDF(type, meta.name, data, filters);
    } catch (e) {
      console.error('PDF error:', e);
    } finally {
      setPdfLoading(false);
    }
  };

  const Renderer = RENDERERS[type];

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
          .print-area { padding: 0 !important; }
          table th { background: #f0f0f0 !important; color: #000 !important; }
          table td { color: #333 !important; }
        }
      `}</style>

      <div style={{ padding: '24px', color: '#fff', minHeight: '100vh' }}>
        {/* Top Bar */}
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button onClick={() => navigate('/reports')} style={{ background: 'transparent', color: '#FFD700', border: '1px solid #FFD700', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
              ← Back
            </button>
            <span style={{ fontSize: '28px' }}>{meta.icon}</span>
            <div>
              <h2 style={{ color: '#FFD700', margin: 0, fontSize: '22px' }}>{meta.name}</h2>
              <p style={{ color: '#aaa', margin: 0, fontSize: '12px' }}>Preview — Review data before printing or downloading</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => window.print()} style={{ background: '#0d2240', color: '#FFD700', border: '1px solid #FFD700', padding: '9px 20px', borderRadius: '7px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>
              Print
            </button>
            <button onClick={handleDownloadPDF} disabled={pdfLoading || !data} style={{ background: pdfLoading ? '#888' : '#FFD700', color: '#000', border: 'none', padding: '9px 20px', borderRadius: '7px', fontWeight: 'bold', cursor: pdfLoading ? 'default' : 'pointer', fontSize: '13px' }}>
              {pdfLoading ? 'Generating…' : 'Download PDF'}
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="no-print">
          <ReportFilterBar filters={filters} onChange={setFilters} onApply={() => fetchData(filters)} />
        </div>

        {/* Report Content */}
        <div className="print-area" style={{ background: '#081830', border: '1px solid #23395d', borderRadius: '12px', overflow: 'hidden' }}>
          {/* Report Header (shows in print) */}
          <div style={{ background: '#050d1a', borderBottom: '2px solid #FFD700', padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <img src={logo} alt="DHOWN" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />
            <div style={{ flex: 1 }}>
              <div style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '16px' }}>DHOWN HOSIERY MILLS</div>
              <div style={{ color: '#ddd', fontSize: '14px' }}>{meta.name}</div>
              <div style={{ color: '#888', fontSize: '11px', marginTop: '2px' }}>
                Generated: {new Date().toLocaleString()}  |  Period: {filters.from} to {filters.to}
                {filters.shift    && `  |  Shift: ${filters.shift}`}
                {filters.machine  && `  |  Machine: ${filters.machine}`}
                {filters.operator && `  |  Operator: ${filters.operator}`}
                {filters.fabric   && `  |  Fabric: ${filters.fabric}`}
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '24px' }}>
            {loading && (
              <div style={{ textAlign: 'center', padding: '60px', color: '#FFD700', fontSize: '16px' }}>
                Loading report data…
              </div>
            )}
            {error && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#ef4444', fontSize: '14px' }}>
                Error: {error}
              </div>
            )}
            {!loading && !error && data && Renderer && <Renderer data={data} />}
          </div>
        </div>
      </div>
    </>
  );
}
