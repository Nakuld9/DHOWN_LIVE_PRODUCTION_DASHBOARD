import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ReportFilterBar from '../components/ReportFilterBar';
import logo from '../assets/images/dhown-logo.png';
import { downloadFile } from '../utils/download';

// ─── helpers ──────────────────────────────────────────────────────
const fmt = v => (v == null || v === '' ? '—' : v);
const fmtKg = v => (parseFloat(v) || 0).toFixed(3) + ' kg';
const fmtPct = v => (parseFloat(v) || 0).toFixed(2) + '%';
const fmtNum = (v, d = 2) => (parseFloat(v) || 0).toFixed(d);
const fmtTs = v => v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-') : '—';
const fmtDate = v => v ? new Date(v).toLocaleDateString('en-GB').split('/').join('-') : '—';

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
  maintenance:      { name: 'Maintenance Report',         icon: '🔧' },
  'shift-handover': { name: 'Shift Handover Report',     icon: '📝' },
  'daily-summary':  { name: 'Daily Production Summary',  icon: '📅' },
  'machine-log':    { name: 'Machine Utilization Log',   icon: '🖥️' },
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
    `Generated: ${new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')}   |   Period: ${filters.from || '—'} to ${filters.to || '—'}`,
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
        r.last_done_date ? new Date(r.last_done_date).toLocaleDateString('en-GB').split('/').join('-') : '—',
        r.next_due_date  ? new Date(r.next_due_date).toLocaleDateString('en-GB').split('/').join('-')  : '—',
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
        new Date(r.shift_date).toLocaleDateString('en-GB').split('/').join('-'),
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

  else if (type === 'daily-summary') {
    const ro = data.rolls || {}; const dt = data.downtime || {}; const at = data.attendance || {};
    doc.setFillColor(8, 24, 48);
    doc.roundedRect(M, y, W - 2 * M, 18, 2, 2, 'F');
    doc.setTextColor(...C.gold); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    const cw4 = (W - 2 * M) / 4;
    ['Total Production', 'Rolls Approved', 'Downtime (hrs)', 'Operators'].forEach((lbl, i) =>
      doc.text(lbl, M + cw4 * i + cw4 / 2, y + 6, { align: 'center' })
    );
    doc.setTextColor(255, 255, 255); doc.setFontSize(11);
    [
      fmtNum(ro.total_kg, 3) + ' kg',
      String(ro.approved || 0),
      fmtNum(dt.total_downtime_hrs, 2),
      String(at.total_operators || 0),
    ].forEach((v, i) => doc.text(v, M + cw4 * i + cw4 / 2, y + 13, { align: 'center' }));
    y += 24;

    doc.setTextColor(...C.gold); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('MACHINE-WISE SUMMARY', M, y); y += 4;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Machine', 'Name', 'Fabric', 'Prod KG', 'Rolls', 'OEE %', 'Avail %', 'Perf %']],
      body: (data.machines || []).map(r => [
        r.machine_id, r.machine_name || '—', r.fabric || '—',
        fmtNum(r.production_kg, 3), r.rolls_approved || 0,
        fmtNum(r.avg_oee), fmtNum(r.avg_availability), fmtNum(r.avg_performance),
      ]),
    });
    y = doc.lastAutoTable.finalY + 8;

    doc.setTextColor(...C.gold); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('SHIFT TOTALS', M, y); y += 4;
    autoTable(doc, { startY: y, ...tStyle,
      head: [['Shift', 'Production KG', 'Rolls Approved', 'Machines Active']],
      body: (data.shifts || []).map(r => [
        r.shift === 'D' ? 'Day' : r.shift === 'N' ? 'Night' : r.shift,
        fmtNum(r.production_kg, 3), r.rolls_approved || 0, r.machines_active || 0,
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
      `DHOWN HOSIERY MILLS  |  ${reportName}  |  Page ${i} of ${pages}  |  ${new Date().toLocaleDateString('en-GB').split('/').join('-')}`,
      W / 2, 292, { align: 'center' }
    );
  }

  await doc.save(`DHOWN_${type}_${(filters.from || 'report')}.pdf`);
}

// ─── Styled table ───────────────────────────────────────────────────
const TH = ({ children }) => (
  <th style={{ background: 'var(--surface)', color: 'var(--gold)', padding: '10px 12px', textAlign: 'left', fontSize: '12px', letterSpacing: '0.5px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
    {children}
  </th>
);
const TD = ({ children, color }) => (
  <td style={{ padding: '9px 12px', color: color || '#ddd', fontSize: '13px', borderBottom: '1px solid var(--surface)' }}>
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
            <tr key={i} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface)' }}>
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
    <div style={{ background: 'var(--surface)', border: `1px solid ${accent || 'var(--border)'}`, borderRadius: '8px', padding: '16px 20px', textAlign: 'center' }}>
      <div style={{ color: accent || '#aaa', fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '6px' }}>{label}</div>
      <div style={{ color: 'var(--text)', fontSize: '22px', fontWeight: 'bold' }}>{value}</div>
    </div>
  );
}

function oeeColor(v) {
  const n = parseFloat(v) || 0;
  if (n >= 70) return 'var(--green)';
  if (n >= 50) return 'var(--gold)';
  return 'var(--crit)';
}

// ─── Report renderers ────────────────────────────────────────────────
function RenderProduction({ data }) {
  const s = data.summary || {};
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <SummaryCard label="TOTAL PRODUCTION" value={fmtKg(s.total_kg)} accent="var(--yellow)" />
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
        <SummaryCard label="TOTAL ROLLS"  value={data.total_rolls || 0} accent="var(--yellow)" />
        <SummaryCard label="TOTAL WEIGHT" value={fmtKg(data.total_weight_kg)} accent="var(--yellow)" />
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
        <SummaryCard label="TOTAL EVENTS"   value={data.total_events || 0} accent="var(--crit)" />
        <SummaryCard label="TOTAL DURATION" value={fmtNum(data.total_minutes, 1) + ' min'} accent="var(--crit)" />
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
        <SummaryCard label="TOTAL SCAN EVENTS" value={data.total_events || 0} accent="var(--yellow)" />
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
        <SummaryCard label="TOTAL ASSIGNMENTS" value={data.total || 0} accent="var(--yellow)" />
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
    { label: 'TOTAL MACHINES',    value: d.total_machines  ?? '—', accent: 'var(--muted)' },
    { label: 'RUNNING',           value: d.running_machines ?? '—', accent: 'var(--green)' },
    { label: 'OFFLINE',           value: d.offline_machines ?? '—', accent: 'var(--crit)' },
    { label: 'ACTIVE OPERATORS',  value: d.active_operators ?? '—', accent: 'var(--gold)' },
    { label: 'PRODUCTION (KG)',   value: fmtNum(d.production_kg, 3), accent: 'var(--gold)' },
    { label: 'DOWNTIME (MIN)',    value: fmtNum(d.downtime_minutes, 1), accent: 'var(--gold)' },
    { label: 'DOWNTIME EVENTS',  value: d.downtime_events ?? '—', accent: 'var(--gold)' },
    { label: 'AVG EFFICIENCY %', value: fmtPct(d.avg_efficiency), accent: oeeColor(d.avg_efficiency) },
    { label: 'AVG AVAILABILITY%',value: fmtPct(d.avg_availability), accent: oeeColor(d.avg_availability) },
    { label: 'AVG RPM',          value: fmtNum(d.avg_rpm), accent: 'var(--muted)' },
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
      <div style={{ color: 'var(--gold)', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid var(--surface)' }}>{title}</div>
      {children}
    </div>
  );
}

const PRIORITY_COLOR = {
  CRITICAL: 'var(--crit)', HIGH: 'var(--gold)', MEDIUM: 'var(--link)', LOW: 'var(--muted)',
};

function RenderMaintenance({ data }) {
  const s = data.summary || {};
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <SummaryCard label="TOTAL TASKS"    value={s.total_tasks || 0}    accent="var(--muted)" />
        <SummaryCard label="OVERDUE"        value={s.overdue || 0}         accent="var(--crit)" />
        <SummaryCard label="DUE WITHIN 7D"  value={s.due_soon || 0}        accent="var(--gold)" />
        <SummaryCard label="CRITICAL TASKS" value={s.critical_tasks || 0}  accent="var(--crit)" />
      </div>
      <Table
        head={['Machine', 'Task Name', 'Type', 'Priority', 'Frequency', 'Last Done', 'Next Due', 'Status', 'Assigned To']}
        rows={(data.tasks || []).map(r => {
          const pc = PRIORITY_COLOR[r.priority] || 'var(--muted)';
          const dc = r.due_status === 'OVERDUE' ? 'var(--crit)' : r.due_status === 'DUE_SOON' ? 'var(--gold)' : 'var(--green)';
          return [
            r.machine_id,
            r.task_name,
            r.task_type,
            { val: r.priority, color: pc },
            r.frequency_days ? `Every ${r.frequency_days}d` : '—',
            r.last_done_date ? new Date(r.last_done_date).toLocaleDateString('en-GB').split('/').join('-') : '—',
            { val: r.next_due_date ? new Date(r.next_due_date).toLocaleDateString('en-GB').split('/').join('-') : '—', color: dc },
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
        <SummaryCard label="TOTAL HANDOVERS"     value={s.total_handovers || 0}                        accent="var(--yellow)" />
        <SummaryCard label="TOTAL PRODUCTION KG" value={fmtNum(s.total_production_kg, 2) + ' kg'}      accent="var(--green)" />
        <SummaryCard label="AVG PRODUCTION KG"   value={fmtNum(s.avg_production_kg, 2) + ' kg/shift'}  accent="var(--link)" />
      </div>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 20px', textAlign: 'center' }}>
          <div style={{ color: 'var(--gold-2)', fontSize: '11px', fontWeight: 'bold' }}>DAY SHIFTS</div>
          <div style={{ color: 'var(--text)', fontSize: '20px', fontWeight: 'bold' }}>{s.day_shifts || 0}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 20px', textAlign: 'center' }}>
          <div style={{ color: 'var(--purple)', fontSize: '11px', fontWeight: 'bold' }}>NIGHT SHIFTS</div>
          <div style={{ color: 'var(--text)', fontSize: '20px', fontWeight: 'bold' }}>{s.night_shifts || 0}</div>
        </div>
      </div>
      <Table
        head={['Date', 'Shift', 'Supervisor', 'Prod KG', 'Machines Down', 'Issues', 'Actions Taken', 'Pending Actions']}
        rows={(data.handovers || []).map(r => [
          new Date(r.shift_date).toLocaleDateString('en-GB').split('/').join('-'),
          { val: r.shift === 'D' ? '☀ Day' : '🌙 Night', color: r.shift === 'D' ? 'var(--gold-2)' : 'var(--purple)' },
          r.supervisor_name || '—',
          r.production_kg ? fmtNum(r.production_kg, 2) + ' kg' : '—',
          r.machines_down > 0 ? { val: String(r.machines_down), color: 'var(--crit)' } : '0',
          r.issues || '—',
          r.actions_taken || '—',
          r.pending_actions ? { val: r.pending_actions, color: 'var(--gold)' } : '—',
        ])}
      />
    </>
  );
}

function RenderDailySummary({ data }) {
  const ro = data.rolls || {}; const dt = data.downtime || {}; const at = data.attendance || {};
  const date = data.date || new Date().toISOString().slice(0, 10);
  return (
    <>
      <div style={{ color: 'var(--gold)', fontSize: '13px', marginBottom: '16px', fontWeight: 'bold' }}>
        Date: {new Date(date + 'T12:00:00').toLocaleDateString('en-GB').split('/').join('-')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '24px' }}>
        <SummaryCard label="TOTAL PRODUCTION"   value={fmtNum(ro.total_kg, 3) + ' kg'}    accent="var(--green)" />
        <SummaryCard label="ROLLS APPROVED"      value={ro.approved || 0}                   accent="var(--yellow)" />
        <SummaryCard label="DOWNTIME HRS"        value={fmtNum(dt.total_downtime_hrs, 2)}   accent="var(--crit)" />
        <SummaryCard label="OPERATORS PRESENT"   value={at.total_operators || 0}            accent="var(--link)" />
      </div>

      <div style={{ display: 'flex', gap: '14px', marginBottom: '24px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 22px', flex: 1 }}>
          <div style={{ color: 'var(--gold-2)', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>☀ DAY SHIFT OPERATORS</div>
          <div style={{ color: 'var(--text)', fontSize: '24px', fontWeight: 'bold' }}>{at.day_shift_ops || 0}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 22px', flex: 1 }}>
          <div style={{ color: 'var(--purple)', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>🌙 NIGHT SHIFT OPERATORS</div>
          <div style={{ color: 'var(--text)', fontSize: '24px', fontWeight: 'bold' }}>{at.night_shift_ops || 0}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 22px', flex: 1 }}>
          <div style={{ color: 'var(--gold)', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>DOWNTIME EVENTS</div>
          <div style={{ color: 'var(--text)', fontSize: '24px', fontWeight: 'bold' }}>{dt.total_events || 0}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px 22px', flex: 1 }}>
          <div style={{ color: 'var(--crit)', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>MACHINES AFFECTED</div>
          <div style={{ color: 'var(--text)', fontSize: '24px', fontWeight: 'bold' }}>{dt.machines_affected || 0}</div>
        </div>
      </div>

      {(data.shifts || []).length > 0 && (
        <>
          <h3 style={{ color: 'var(--gold)', fontSize: '13px', marginBottom: '12px', letterSpacing: 1 }}>SHIFT TOTALS</h3>
          <Table
            head={['Shift', 'Production KG', 'Rolls Approved', 'Machines Active']}
            rows={(data.shifts || []).map(r => [
              { val: r.shift === 'D' ? '☀ Day' : '🌙 Night', color: r.shift === 'D' ? 'var(--gold-2)' : 'var(--purple)' },
              fmtNum(r.production_kg, 3) + ' kg',
              r.rolls_approved || 0,
              r.machines_active || 0,
            ])}
          />
        </>
      )}

      <h3 style={{ color: 'var(--gold)', fontSize: '13px', margin: '24px 0 12px', letterSpacing: 1 }}>PER-MACHINE BREAKDOWN</h3>
      <Table
        head={['Machine', 'Name', 'Fabric', 'Production KG', 'Rolls', 'OEE %', 'Avail %', 'Perf %']}
        rows={(data.machines || []).map(r => [
          r.machine_id,
          r.machine_name || '—',
          r.fabric || '—',
          { val: fmtNum(r.production_kg, 3) + ' kg', color: parseFloat(r.production_kg) > 0 ? 'var(--green)' : 'var(--muted)' },
          r.rolls_approved || 0,
          fmtNum(r.avg_oee) + '%',
          fmtNum(r.avg_availability) + '%',
          fmtNum(r.avg_performance) + '%',
        ])}
      />
    </>
  );
}

// Cloud-format machine utilization log — data is { columns:[...], rows:[[...]] }.
function RenderMachineLog({ data }) {
  const cols = data.columns || [];
  const rows = data.rows || [];
  return (
    <div>
      <p style={{ color: 'var(--muted)', fontSize: '12px', margin: '0 0 14px' }}>
        {data.granularity === 'shift'
          ? 'Shift view — one row per machine & shift (same 13-column layout as the cloud portal export).'
          : 'Hourly view — one row per machine & hour. Use “Download Excel” for the .xlsx file.'}
      </p>
      <Table head={cols} rows={rows} emptyMsg="No machine activity recorded for the selected period." />
    </div>
  );
}

const RENDERERS = {
  production:       RenderProduction,
  'machine-log':    RenderMachineLog,
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
  'daily-summary':  RenderDailySummary,
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
  const [granularity, setGranularity] = useState(searchParams.get('gran') === 'shift' ? 'shift' : 'hourly');
  const autodownloaded = useRef(false);

  const fetchData = useCallback(async (f, gran = granularity) => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams();
      if (type === 'daily-summary') {
        p.set('date', f.to || new Date().toISOString().slice(0, 10));
      } else {
        if (f.from)     p.set('from',     f.from);
        if (f.to)       p.set('to',       f.to);
        if (f.shift)    p.set('shift',    f.shift);
        if (f.machine)  p.set('machine',  f.machine);
        if (f.operator) p.set('operator', f.operator);
        if (f.fabric)   p.set('fabric',   f.fabric);
      }
      if (type === 'machine-log') p.set('granularity', gran);

      const res = await fetch(`/api/reports/${type}?${p.toString()}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [type, granularity]);

  useEffect(() => { fetchData(filters); }, []);

  useEffect(() => {
    if (data && autodownload && !autodownloaded.current) {
      autodownloaded.current = true;
      handleDownloadPDF();
    }
  }, [data]);

  const handleDownloadPDF = async () => {
    if (!data) return;
    // Machine Utilization Log downloads as Excel (.xlsx) to match the cloud portal export.
    if (type === 'machine-log') {
      const p = new URLSearchParams();
      if (filters.from)    p.set('from',    filters.from);
      if (filters.to)      p.set('to',      filters.to);
      if (filters.shift)   p.set('shift',   filters.shift);
      if (filters.machine) p.set('machine', filters.machine);
      p.set('granularity', granularity);
      // Fetched as a blob rather than window.open'd: window.open cannot carry
      // the auth header, which is why /api/reports had to stay unauthenticated.
      setPdfLoading(true);
      try {
        await downloadFile(`/api/reports/machine-log-excel?${p.toString()}`,
          { filename: `machine-log-${filters.from || 'today'}.xlsx` });
      } catch (e) {
        setError(e.message);
      } finally {
        setPdfLoading(false);
      }
      return;
    }
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
          body { background: var(--surface) !important; color: #000 !important; }
          .print-area { padding: 0 !important; }
          table th { background: #f0f0f0 !important; color: #000 !important; }
          table td { color: #333 !important; }
        }
      `}</style>

      <div style={{ padding: '24px', color: 'var(--text)', minHeight: '100vh' }}>
        {/* Top Bar */}
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button onClick={() => navigate('/reports')} style={{ background: 'transparent', color: 'var(--gold)', border: '1px solid var(--gold)', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
              ← Back
            </button>
            <span style={{ fontSize: '28px' }}>{meta.icon}</span>
            <div>
              <h2 style={{ color: 'var(--gold)', margin: 0, fontSize: '22px' }}>{meta.name}</h2>
              <p style={{ color: '#aaa', margin: 0, fontSize: '12px' }}>Preview — Review data before printing or downloading</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {type === 'machine-log' && (
              <div style={{ display: 'flex', border: '1px solid var(--gold)', borderRadius: '7px', overflow: 'hidden' }}>
                {['hourly', 'shift'].map(g => (
                  <button
                    key={g}
                    onClick={() => { if (g !== granularity) { setGranularity(g); fetchData(filters, g); } }}
                    style={{
                      background: granularity === g ? 'var(--gold)' : 'transparent',
                      color: granularity === g ? '#000' : 'var(--gold)',
                      border: 'none', padding: '9px 18px', fontWeight: 'bold',
                      cursor: 'pointer', fontSize: '13px', textTransform: 'capitalize',
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => window.print()} style={{ background: 'var(--surface)', color: 'var(--gold)', border: '1px solid var(--gold)', padding: '9px 20px', borderRadius: '7px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}>
              Print
            </button>
            <button onClick={handleDownloadPDF} disabled={pdfLoading || !data} style={{ background: pdfLoading ? '#888' : 'var(--gold)', color: '#000', border: 'none', padding: '9px 20px', borderRadius: '7px', fontWeight: 'bold', cursor: pdfLoading ? 'default' : 'pointer', fontSize: '13px' }}>
              {pdfLoading ? 'Generating…' : (type === 'machine-log' ? 'Download Excel' : 'Download PDF')}
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="no-print">
          <ReportFilterBar filters={filters} onChange={setFilters} onApply={() => fetchData(filters)} />
        </div>

        {/* Report Content */}
        <div className="print-area" style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '12px', overflow: 'hidden' }}>
          {/* Report Header (shows in print) */}
          <div style={{ background: 'var(--bg)', borderBottom: '2px solid var(--gold)', padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <img src={logo} alt="DHOWN" style={{ width: '48px', height: '48px', objectFit: 'contain' }} />
            <div style={{ flex: 1 }}>
              <div style={{ color: 'var(--gold)', fontWeight: 'bold', fontSize: '16px' }}>DHOWN HOSIERY MILLS</div>
              <div style={{ color: '#ddd', fontSize: '14px' }}>{meta.name}</div>
              <div style={{ color: '#888', fontSize: '11px', marginTop: '2px' }}>
                Generated: {new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')}  |  Period: {filters.from} to {filters.to}
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
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--gold)', fontSize: '16px' }}>
                Loading report data…
              </div>
            )}
            {error && (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--crit)', fontSize: '14px' }}>
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
