import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API = 'http://localhost:4000';

const STATUS_COLOR = {
  RUNNING:  { bg: '#14532d', color: '#86efac', label: 'Running' },
  STOPPED:  { bg: '#450a0a', color: '#fca5a5', label: 'Stopped' },
  DOWNTIME: { bg: '#451a03', color: '#fdba74', label: 'Downtime' },
  OFFLINE:  { bg: '#1c1917', color: '#a8a29e', label: 'Offline' },
  IDLE:     { bg: '#1c1917', color: '#a8a29e', label: 'Idle' },
  NO_DATA:  { bg: '#1c1917', color: '#57534e', label: 'No data' },
};

export default function WorkCenterStock() {
  const navigate  = useNavigate();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('ALL'); // ALL | SHORTAGE | ACTIVE

  const load = () => {
    setLoading(true);
    fetch(`${API}/api/work-center/stock`)
      .then(r => r.json())
      .then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Real shortage = gap remains AFTER all issues are closed (yarn weighed back).
  // While an issue is still open, the gap is just WIP (yarn on machine / cones).
  const isShortage = r => parseFloat(r.gap_kg) > 0 && parseInt(r.active_issues) === 0;
  const isWip      = r => parseFloat(r.gap_kg) > 0 && parseInt(r.active_issues) > 0;

  const displayed = rows.filter(r => {
    if (filter === 'SHORTAGE') return isShortage(r);
    if (filter === 'ACTIVE')   return parseInt(r.active_issues) > 0;
    return true;
  });

  const totalIssued   = rows.reduce((s, r) => s + parseFloat(r.issued_kg   || 0), 0);
  const totalProduced = rows.reduce((s, r) => s + parseFloat(r.produced_kg || 0), 0);
  const totalWip      = rows.filter(isWip).reduce((s, r) => s + parseFloat(r.gap_kg || 0), 0);
  const totalShortage = rows.filter(isShortage).reduce((s, r) => s + parseFloat(r.gap_kg || 0), 0);
  const shortageCount = rows.filter(isShortage).length;

  return (
    <div style={{ padding: '28px', color: '#e2e8f0', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: '#FFD700', fontSize: 32, margin: 0, letterSpacing: 2 }}>WORK CENTER STOCK</h1>
        <p style={{ color: '#7da2d6', margin: '4px 0 0', fontSize: 13 }}>
          Yarn issued to each machine vs. rolls produced — gap = WIP or unaccounted wastage
        </p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total yarn issued', value: totalIssued.toFixed(1) + ' kg', color: '#60a5fa' },
          { label: 'Total rolls produced', value: totalProduced.toFixed(1) + ' kg', color: '#34d399' },
          { label: 'WIP (running, not weighed)', value: totalWip.toFixed(1) + ' kg', color: '#60a5fa' },
          { label: 'Real shortage (after weigh-back)', value: totalShortage.toFixed(1) + ' kg', color: totalShortage > 0 ? '#f87171' : '#34d399' },
        ].map(c => (
          <div key={c.label} style={{ background: '#081830', border: '1px solid #1e3a5f', borderRadius: 12, padding: '18px 20px' }}>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filter + Refresh */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {['ALL', 'SHORTAGE', 'ACTIVE'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? '#1e3a5f' : 'transparent',
              color: filter === f ? '#60a5fa' : '#64748b',
              border: '1px solid ' + (filter === f ? '#3b82f6' : '#334155'),
              padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>
              {f === 'ALL' ? 'All machines' : f === 'SHORTAGE' ? `Shortage only (${shortageCount})` : 'Active issues'}
            </button>
          ))}
        </div>
        <button onClick={load} style={{ background: '#0f172a', color: '#94a3b8', border: '1px solid #334155', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
          ↻ Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 60 }}>Loading...</div>
      ) : (
        <div style={{ background: '#081830', border: '1px solid #1e3a5f', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#0a2040', borderBottom: '1px solid #1e3a5f' }}>
                {['Machine', 'Fabric type', 'Status', 'Yarn issued (kg)', 'Returned (kg)', 'Net consumed (kg)', 'Rolls produced (kg)', 'Rolls', 'Gap / WIP (kg)', 'Active issues'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: '#475569' }}>No machines found</td></tr>
              ) : displayed.map((r, i) => {
                const gap      = parseFloat(r.gap_kg || 0);
                const issued   = parseFloat(r.issued_kg || 0);
                const returned = parseFloat(r.returned_kg || 0);
                const produced = parseFloat(r.produced_kg || 0);
                const netConsumed = Math.max(issued - returned, 0);
                const st = STATUS_COLOR[r.machine_status] || STATUS_COLOR.NO_DATA;
                const openIssues  = parseInt(r.active_issues) > 0;
                const hasShortage = gap > 0 && !openIssues; // real shortage only after weigh-back
                const hasWip      = gap > 0 && openIssues;

                return (
                  <tr key={r.machine_id}
                    onClick={() => navigate(`/machine/${r.machine_id}`)}
                    style={{
                      background: i % 2 === 0 ? '#081830' : '#060f22',
                      borderBottom: '1px solid #0f2040',
                      cursor: 'pointer',
                      borderLeft: hasShortage ? '3px solid #f87171' : hasWip ? '3px solid #3b82f6' : '3px solid transparent',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#0d2040'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#081830' : '#060f22'}
                  >
                    <td style={{ padding: '11px 14px', fontFamily: 'monospace', color: '#38bdf8', fontWeight: 700 }}>{r.machine_id}</td>
                    <td style={{ padding: '11px 14px', color: '#cbd5e1' }}>{r.fabric_type || '—'}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ background: st.bg, color: st.color, padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>{st.label}</span>
                    </td>
                    <td style={{ padding: '11px 14px', color: '#93c5fd' }}>{issued > 0 ? issued.toFixed(2) : '—'}</td>
                    <td style={{ padding: '11px 14px', color: '#94a3b8' }}>{returned > 0 ? returned.toFixed(2) : '—'}</td>
                    <td style={{ padding: '11px 14px', color: '#e2e8f0', fontWeight: 600 }}>{netConsumed > 0 ? netConsumed.toFixed(2) : '—'}</td>
                    <td style={{ padding: '11px 14px', color: '#34d399' }}>{produced > 0 ? produced.toFixed(2) : '—'}</td>
                    <td style={{ padding: '11px 14px', color: '#64748b' }}>{parseInt(r.total_rolls) || '—'}</td>
                    <td style={{ padding: '11px 14px' }}>
                      {hasShortage
                        ? <span style={{ color: '#f87171', fontWeight: 700 }}>{gap.toFixed(2)} ⚠ shortage</span>
                        : hasWip
                          ? <span style={{ color: '#60a5fa', fontWeight: 600 }}>{gap.toFixed(2)} · WIP</span>
                          : <span style={{ color: '#34d399', fontSize: 12 }}>✓ OK</span>
                      }
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      {parseInt(r.active_issues) > 0
                        ? <span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>{r.active_issues} open</span>
                        : <span style={{ color: '#475569', fontSize: 11 }}>—</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop: 16, fontSize: 11, color: '#475569', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <span><span style={{ color: '#60a5fa' }}>Blue = WIP</span> — issue still open, yarn is on the machine / cones (normal while running same fabric)</span>
        <span><span style={{ color: '#f87171' }}>Red = Real shortage</span> — all issues closed (balance yarn weighed back) but gap remains</span>
        <span><span style={{ color: '#93c5fd' }}>Issued</span> − <span style={{ color: '#94a3b8' }}>Returned</span> − <span style={{ color: '#34d399' }}>Produced</span> = Gap</span>
      </div>
    </div>
  );
}
