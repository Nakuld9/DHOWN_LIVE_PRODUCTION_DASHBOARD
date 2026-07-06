import React, { useEffect, useState } from 'react';

const S = {
  bar: {
    background: '#081830',
    border: '1px solid #23395d',
    borderRadius: '10px',
    padding: '18px 20px',
    marginBottom: '24px',
  },
  title: { color: '#FFD700', fontSize: '13px', fontWeight: 'bold', marginBottom: '12px', letterSpacing: '1px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', alignItems: 'flex-end' },
  group: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { color: '#FFD700', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.5px' },
  input: {
    background: '#0d1b2a', border: '1px solid #344a6c', color: '#fff',
    padding: '8px 10px', borderRadius: '6px', fontSize: '13px', width: '100%', boxSizing: 'border-box',
  },
  btn: {
    background: '#FFD700', color: '#000', border: 'none',
    padding: '9px 20px', borderRadius: '6px', fontWeight: 'bold',
    cursor: 'pointer', fontSize: '13px', width: '100%', letterSpacing: '0.5px',
  },
  clearBtn: {
    background: 'transparent', color: '#aaa', border: '1px solid #344a6c',
    padding: '9px 12px', borderRadius: '6px', fontWeight: 'bold',
    cursor: 'pointer', fontSize: '13px', width: '100%',
  },
};

export default function ReportFilterBar({ filters, onChange, onApply }) {
  const [options, setOptions] = useState({ shifts: [], machines: [], operators: [], fabrics: [] });
  const [optionsError, setOptionsError] = useState(false);

  useEffect(() => {
    fetch('http://localhost:4000/api/reports/filter-options')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setOptions(d); setOptionsError(false); })
      .catch(() => setOptionsError(true));
  }, []);

  const set = (key, val) => onChange({ ...filters, [key]: val });

  const clear = () => {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyAgo = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    onChange({ from: thirtyAgo, to: today, shift: '', machine: '', operator: '', fabric: '' });
  };

  return (
    <div style={S.bar}>
      <div style={S.title}>FILTER REPORTS</div>
      {optionsError && <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '8px' }}>Could not load filter options — dropdowns may be empty</div>}
      <div style={S.grid}>
        <div style={S.group}>
          <label style={S.label}>DATE FROM</label>
          <input type="date" style={S.input} value={filters.from}
            onChange={e => set('from', e.target.value)} />
        </div>

        <div style={S.group}>
          <label style={S.label}>DATE TO</label>
          <input type="date" style={S.input} value={filters.to}
            onChange={e => set('to', e.target.value)} />
        </div>

        <div style={S.group}>
          <label style={S.label}>SHIFT</label>
          <select style={S.input} value={filters.shift} onChange={e => set('shift', e.target.value)}>
            <option value="">All Shifts</option>
            {options.shifts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div style={S.group}>
          <label style={S.label}>MACHINE</label>
          <select style={S.input} value={filters.machine} onChange={e => set('machine', e.target.value)}>
            <option value="">All Machines</option>
            {options.machines.map(m => (
              <option key={m.machine_id} value={m.machine_id}>{m.machine_id} – {m.machine_name}</option>
            ))}
          </select>
        </div>

        <div style={S.group}>
          <label style={S.label}>OPERATOR</label>
          <select style={S.input} value={filters.operator} onChange={e => set('operator', e.target.value)}>
            <option value="">All Operators</option>
            {options.operators.map(o => (
              <option key={o.operator_id} value={o.operator_id}>{o.operator_name}</option>
            ))}
          </select>
        </div>

        <div style={S.group}>
          <label style={S.label}>FABRIC TYPE</label>
          <select style={S.input} value={filters.fabric} onChange={e => set('fabric', e.target.value)}>
            <option value="">All Fabrics</option>
            {options.fabrics.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div style={S.group}>
          <label style={{ ...S.label, opacity: 0 }}>ACTION</label>
          <button style={S.btn} onClick={onApply}>Apply Filters</button>
        </div>

        <div style={S.group}>
          <label style={{ ...S.label, opacity: 0 }}>CLEAR</label>
          <button style={S.clearBtn} onClick={clear}>Clear</button>
        </div>
      </div>
    </div>
  );
}
