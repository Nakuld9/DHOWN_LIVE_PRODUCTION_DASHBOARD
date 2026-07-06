import React, { useState, useEffect } from 'react';

const API = 'http://localhost:4000';
const h = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('dhown_token')}` });

const inp = { width: '100%', background: '#0a1828', border: '1px solid #1e3a5f', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' };
const lbl = { color: '#7da2d6', fontSize: 11, marginBottom: 3, display: 'block', fontWeight: 600 };
const sectionStyle = { background: '#081426', border: '1px solid #1e3a5f', borderRadius: 10, padding: 20, marginBottom: 20 };

const SECTIONS = ['Yarn Store', 'Yarn at Work Centers', 'Greige Stock', 'Sent for Subcontracting', 'Finished Goods'];

export default function OpeningBalances() {
  const [active, setActive] = useState(0);
  const [machines, setMachines] = useState([]);
  const [yarnItems, setYarnItems] = useState([]);
  const [fabricItems, setFabricItems] = useState([]);
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    fetch(`${API}/api/machines`, { headers: h() }).then(r => r.json()).then(setMachines).catch(() => {});
    fetch(`${API}/api/erp/items?category=YARN&limit=500`, { headers: h() }).then(r => r.json()).then(d => setYarnItems(d.data || [])).catch(() => {});
    fetch(`${API}/api/erp/items?category=FABRIC&limit=500`, { headers: h() }).then(r => r.json()).then(d => setFabricItems(d.data || [])).catch(() => {});
  }, []);

  const showMsg = (text, ok) => { setMsg(text); setMsgOk(ok); setTimeout(() => setMsg(''), 3000); };

  const postEntry = async (url, body, label) => {
    setSaving(true);
    try {
      const r = await fetch(`${API}${url}`, { method: 'POST', headers: h(), body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { showMsg(j.error || 'Failed', false); setSaving(false); return; }
      setEntries(e => [...e, { type: label, ...body, id: Date.now() }]);
      showMsg(`${label} added successfully`, true);
    } catch { showMsg('Network error', false); }
    setSaving(false);
  };

  return (
    <div style={{ padding: 24, color: '#e2e8f0' }}>
      <h2 style={{ color: '#f4ae1f', margin: '0 0 6px' }}>Opening Balances</h2>
      <p style={{ color: '#7da2d6', fontSize: 13, margin: '0 0 20px' }}>Enter existing stock to start with realistic data. These entries are tagged as "OPENING" in the system.</p>

      {msg && <div style={{ background: msgOk ? '#052e1622' : '#ef444422', border: `1px solid ${msgOk ? '#22c55e' : '#ef4444'}`, borderRadius: 6, padding: '8px 14px', color: msgOk ? '#22c55e' : '#ef4444', fontSize: 13, marginBottom: 14 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid #1e3a5f', flexWrap: 'wrap' }}>
        {SECTIONS.map((s, i) => (
          <button key={s} onClick={() => setActive(i)}
            style={{ padding: '10px 18px', border: 'none', borderBottom: active === i ? '2px solid #f4ae1f' : '2px solid transparent', background: 'transparent', color: active === i ? '#f4ae1f' : '#7da2d6', cursor: 'pointer', fontWeight: active === i ? 'bold' : 400, fontSize: 13 }}>
            {s}
          </button>
        ))}
      </div>

      {active === 0 && <YarnStoreForm yarnItems={yarnItems} saving={saving} onSubmit={(d) => postEntry('/api/opening/yarn', d, 'Yarn Lot')} />}
      {active === 1 && <YarnAtMachineForm machines={machines} yarnItems={yarnItems} saving={saving} onSubmit={(d) => postEntry('/api/opening/yarn-at-machine', d, 'Yarn at Machine')} />}
      {active === 2 && <GreigeForm fabricItems={fabricItems} saving={saving} onSubmit={(d) => postEntry('/api/opening/greige', d, 'Greige Roll')} />}
      {active === 3 && <SubcontractForm fabricItems={fabricItems} saving={saving} onSubmit={(d) => postEntry('/api/opening/subcontract', d, 'SC Challan')} />}
      {active === 4 && <FinishedGoodsForm fabricItems={fabricItems} saving={saving} onSubmit={(d) => postEntry('/api/opening/finished-goods', d, 'Finished Good')} />}

      {entries.length > 0 && (
        <div style={{ ...sectionStyle, marginTop: 20 }}>
          <h3 style={{ color: '#f4ae1f', margin: '0 0 12px', fontSize: 15 }}>Entries Added This Session ({entries.length})</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#0d2040' }}>
                {['#', 'Type', 'Details', 'Weight (kg)', 'Value'].map(c => (
                  <th key={c} style={{ padding: '7px 10px', textAlign: 'left', color: '#64748b', borderBottom: '1px solid #1e3a5f' }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #0f2040' }}>
                  <td style={{ padding: '6px 10px', color: '#64748b' }}>{i + 1}</td>
                  <td style={{ padding: '6px 10px', color: '#f4ae1f', fontWeight: 600 }}>{e.type}</td>
                  <td style={{ padding: '6px 10px' }}>{e.yarn_type || e.fabric_type || e.vendor_name || e.color_name || '-'} {e.machine_id ? `@ ${e.machine_id}` : ''}</td>
                  <td style={{ padding: '6px 10px', color: '#fbbf24', fontWeight: 700 }}>{e.weight_kg} kg</td>
                  <td style={{ padding: '6px 10px', color: '#22c55e', fontWeight: 700 }}>{e.value ? `₹${e.value}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Yarn Store: same columns as GRN lots but no vendor details
// Yarn Type | Lot No | Brand | Boxes/Bags | Weight | Rate | Value
function YarnStoreForm({ yarnItems, saving, onSubmit }) {
  const empty = { item_id: '', yarn_type: '', supplier_lot_no: '', brand: '', cones: '', weight_kg: '', rate_per_kg: '', value: '' };
  const [rows, setRows] = useState([{ ...empty }]);

  const setField = (idx, k, v) => setRows(r => r.map((row, i) => i === idx ? { ...row, [k]: v } : row));
  const addRow = () => setRows(r => [...r, { ...empty }]);
  const removeRow = (idx) => setRows(r => r.filter((_, i) => i !== idx));

  const submitAll = async () => {
    for (const row of rows) {
      if (!row.yarn_type || !row.weight_kg) continue;
      await onSubmit(row);
    }
    setRows([{ ...empty }]);
  };

  return (
    <div style={sectionStyle}>
      <h3 style={{ color: '#f4ae1f', margin: '0 0 14px', fontSize: 15 }}>Add Yarn to Store (Same as GRN — No Vendor)</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Yarn Type *', 'Lot No', 'Brand', 'Boxes/Bags', 'Weight (kg) *', 'Rate/kg', 'Value (₹)', ''].map(c => (
                <th key={c} style={{ padding: '8px 6px', textAlign: 'left', color: '#7da2d6', fontSize: 11, borderBottom: '1px solid #1e3a5f', whiteSpace: 'nowrap' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td style={{ padding: '4px 4px' }}>
                  <select value={row.item_id} onChange={e => { setField(idx, 'item_id', e.target.value); const yi = yarnItems.find(y => String(y.item_id) === e.target.value); if (yi) setField(idx, 'yarn_type', yi.item_name); }} style={{ ...inp, minWidth: 140 }}>
                    <option value="">-- Select --</option>
                    {yarnItems.map(y => <option key={y.item_id} value={y.item_id}>{y.item_code} - {y.item_name}</option>)}
                  </select>
                </td>
                <td style={{ padding: '4px 4px' }}><input value={row.supplier_lot_no} onChange={e => setField(idx, 'supplier_lot_no', e.target.value)} style={{ ...inp, width: 100 }} placeholder="Lot #" /></td>
                <td style={{ padding: '4px 4px' }}><input value={row.brand} onChange={e => setField(idx, 'brand', e.target.value)} style={{ ...inp, width: 100 }} placeholder="Brand" /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" value={row.cones} onChange={e => setField(idx, 'cones', e.target.value)} style={{ ...inp, width: 80 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.001" value={row.weight_kg} onChange={e => setField(idx, 'weight_kg', e.target.value)} style={{ ...inp, width: 100 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.01" value={row.rate_per_kg} onChange={e => { setField(idx, 'rate_per_kg', e.target.value); if (e.target.value && row.weight_kg) setField(idx, 'value', (parseFloat(e.target.value) * parseFloat(row.weight_kg)).toFixed(2)); }} style={{ ...inp, width: 90 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.01" value={row.value} onChange={e => { setField(idx, 'value', e.target.value); if (e.target.value && row.weight_kg) setField(idx, 'rate_per_kg', (parseFloat(e.target.value) / parseFloat(row.weight_kg)).toFixed(2)); }} style={{ ...inp, width: 100 }} /></td>
                <td style={{ padding: '4px 4px' }}>
                  {rows.length > 1 && <button onClick={() => removeRow(idx)} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button onClick={addRow} style={{ background: '#1e3a5f', color: '#7da2d6', border: '1px solid #23395d', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Row</button>
        <button onClick={submitAll} disabled={saving} style={{ background: '#f4ae1f', color: '#081426', border: 'none', borderRadius: 6, padding: '9px 24px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
          {saving ? 'Adding...' : '+ Save All Yarn Lots'}
        </button>
      </div>
    </div>
  );
}

// Yarn at Work Centers: same as Yarn Store + Machine column
function YarnAtMachineForm({ machines, yarnItems, saving, onSubmit }) {
  const empty = { machine_id: '', item_id: '', yarn_type: '', supplier_lot_no: '', brand: '', cones: '', weight_kg: '', rate_per_kg: '', value: '' };
  const [rows, setRows] = useState([{ ...empty }]);

  const setField = (idx, k, v) => setRows(r => r.map((row, i) => i === idx ? { ...row, [k]: v } : row));
  const addRow = () => setRows(r => [...r, { ...empty }]);
  const removeRow = (idx) => setRows(r => r.filter((_, i) => i !== idx));

  const submitAll = async () => {
    for (const row of rows) {
      if (!row.machine_id || !row.yarn_type || !row.weight_kg) continue;
      await onSubmit(row);
    }
    setRows([{ ...empty }]);
  };

  return (
    <div style={sectionStyle}>
      <h3 style={{ color: '#f4ae1f', margin: '0 0 14px', fontSize: 15 }}>Add Yarn at Work Centers (Machine)</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Machine *', 'Yarn Type *', 'Lot No', 'Brand', 'Boxes/Bags', 'Weight (kg) *', 'Rate/kg', 'Value (₹)', ''].map(c => (
                <th key={c} style={{ padding: '8px 6px', textAlign: 'left', color: '#7da2d6', fontSize: 11, borderBottom: '1px solid #1e3a5f', whiteSpace: 'nowrap' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td style={{ padding: '4px 4px' }}>
                  <select value={row.machine_id} onChange={e => setField(idx, 'machine_id', e.target.value)} style={{ ...inp, minWidth: 130 }}>
                    <option value="">-- Select --</option>
                    {machines.map(m => <option key={m.machine_id} value={m.machine_id}>{m.machine_id} - {m.machine_name || m.fabric || ''}</option>)}
                  </select>
                </td>
                <td style={{ padding: '4px 4px' }}>
                  <select value={row.item_id} onChange={e => { setField(idx, 'item_id', e.target.value); const yi = yarnItems.find(y => String(y.item_id) === e.target.value); if (yi) setField(idx, 'yarn_type', yi.item_name); }} style={{ ...inp, minWidth: 140 }}>
                    <option value="">-- Select --</option>
                    {yarnItems.map(y => <option key={y.item_id} value={y.item_id}>{y.item_code} - {y.item_name}</option>)}
                  </select>
                </td>
                <td style={{ padding: '4px 4px' }}><input value={row.supplier_lot_no} onChange={e => setField(idx, 'supplier_lot_no', e.target.value)} style={{ ...inp, width: 100 }} placeholder="Lot #" /></td>
                <td style={{ padding: '4px 4px' }}><input value={row.brand} onChange={e => setField(idx, 'brand', e.target.value)} style={{ ...inp, width: 100 }} placeholder="Brand" /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" value={row.cones} onChange={e => setField(idx, 'cones', e.target.value)} style={{ ...inp, width: 80 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.001" value={row.weight_kg} onChange={e => setField(idx, 'weight_kg', e.target.value)} style={{ ...inp, width: 100 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.01" value={row.rate_per_kg} onChange={e => { setField(idx, 'rate_per_kg', e.target.value); if (e.target.value && row.weight_kg) setField(idx, 'value', (parseFloat(e.target.value) * parseFloat(row.weight_kg)).toFixed(2)); }} style={{ ...inp, width: 90 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.01" value={row.value} onChange={e => { setField(idx, 'value', e.target.value); if (e.target.value && row.weight_kg) setField(idx, 'rate_per_kg', (parseFloat(e.target.value) / parseFloat(row.weight_kg)).toFixed(2)); }} style={{ ...inp, width: 100 }} /></td>
                <td style={{ padding: '4px 4px' }}>
                  {rows.length > 1 && <button onClick={() => removeRow(idx)} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button onClick={addRow} style={{ background: '#1e3a5f', color: '#7da2d6', border: '1px solid #23395d', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Row</button>
        <button onClick={submitAll} disabled={saving} style={{ background: '#f4ae1f', color: '#081426', border: 'none', borderRadius: 6, padding: '9px 24px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
          {saving ? 'Adding...' : '+ Save All'}
        </button>
      </div>
    </div>
  );
}

// Greige Stock: Fabric Type + generic roll no (auto) + Weight + Value
function GreigeForm({ fabricItems, saving, onSubmit }) {
  const empty = { fabric_type: '', weight_kg: '', value: '' };
  const [rows, setRows] = useState([{ ...empty }]);

  const setField = (idx, k, v) => setRows(r => r.map((row, i) => i === idx ? { ...row, [k]: v } : row));
  const addRow = () => setRows(r => [...r, { ...empty }]);
  const removeRow = (idx) => setRows(r => r.filter((_, i) => i !== idx));

  const submitAll = async () => {
    for (const row of rows) {
      if (!row.fabric_type || !row.weight_kg) continue;
      await onSubmit(row);
    }
    setRows([{ ...empty }]);
  };

  return (
    <div style={sectionStyle}>
      <h3 style={{ color: '#f4ae1f', margin: '0 0 14px', fontSize: 15 }}>Add Greige Stock (Generic Roll No — auto generated)</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Fabric Type *', 'Weight (kg) *', 'Value (₹)', ''].map(c => (
                <th key={c} style={{ padding: '8px 6px', textAlign: 'left', color: '#7da2d6', fontSize: 11, borderBottom: '1px solid #1e3a5f' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td style={{ padding: '4px 4px' }}>
                  <select value={row.fabric_type} onChange={e => setField(idx, 'fabric_type', e.target.value)} style={{ ...inp, minWidth: 180 }}>
                    <option value="">-- Select Fabric --</option>
                    {fabricItems.map(fi => <option key={fi.item_id} value={fi.item_name}>{fi.item_code} - {fi.item_name}</option>)}
                  </select>
                </td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.001" value={row.weight_kg} onChange={e => setField(idx, 'weight_kg', e.target.value)} style={{ ...inp, width: 120 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.01" value={row.value} onChange={e => setField(idx, 'value', e.target.value)} style={{ ...inp, width: 120 }} /></td>
                <td style={{ padding: '4px 4px' }}>
                  {rows.length > 1 && <button onClick={() => removeRow(idx)} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button onClick={addRow} style={{ background: '#1e3a5f', color: '#7da2d6', border: '1px solid #23395d', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Row</button>
        <button onClick={submitAll} disabled={saving} style={{ background: '#f4ae1f', color: '#081426', border: 'none', borderRadius: 6, padding: '9px 24px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
          {saving ? 'Adding...' : '+ Save All Greige'}
        </button>
      </div>
    </div>
  );
}

// Subcontracting: Dyeing / Finishing / Outsource Knitting — columns like original challans
function SubcontractForm({ fabricItems, saving, onSubmit }) {
  const empty = { process_type: 'DYEING', vendor_name: '', fabric_type: '', weight_kg: '', sent_date: new Date().toISOString().slice(0, 10), rate_per_kg: '', value: '' };
  const [rows, setRows] = useState([{ ...empty }]);

  const setField = (idx, k, v) => setRows(r => r.map((row, i) => i === idx ? { ...row, [k]: v } : row));
  const addRow = () => setRows(r => [...r, { ...empty }]);
  const removeRow = (idx) => setRows(r => r.filter((_, i) => i !== idx));

  const submitAll = async () => {
    for (const row of rows) {
      if (!row.weight_kg || !row.process_type) continue;
      await onSubmit(row);
    }
    setRows([{ ...empty }]);
  };

  return (
    <div style={sectionStyle}>
      <h3 style={{ color: '#f4ae1f', margin: '0 0 14px', fontSize: 15 }}>Add Sent for Subcontracting</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Process Type *', 'Vendor Name', 'Fabric Type', 'Weight (kg) *', 'Sent Date', 'Rate/kg', 'Value (₹)', ''].map(c => (
                <th key={c} style={{ padding: '8px 6px', textAlign: 'left', color: '#7da2d6', fontSize: 11, borderBottom: '1px solid #1e3a5f', whiteSpace: 'nowrap' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td style={{ padding: '4px 4px' }}>
                  <select value={row.process_type} onChange={e => setField(idx, 'process_type', e.target.value)} style={{ ...inp, minWidth: 150 }}>
                    <option value="DYEING">Dyeing</option>
                    <option value="FINISHING">Finishing</option>
                    <option value="OUTSOURCE_KNITTING">Outsource Knitting</option>
                  </select>
                </td>
                <td style={{ padding: '4px 4px' }}><input value={row.vendor_name} onChange={e => setField(idx, 'vendor_name', e.target.value)} style={{ ...inp, width: 130 }} placeholder="Vendor" /></td>
                <td style={{ padding: '4px 4px' }}>
                  <select value={row.fabric_type} onChange={e => setField(idx, 'fabric_type', e.target.value)} style={{ ...inp, minWidth: 140 }}>
                    <option value="">-- Select --</option>
                    {fabricItems.map(fi => <option key={fi.item_id} value={fi.item_name}>{fi.item_code} - {fi.item_name}</option>)}
                  </select>
                </td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.001" value={row.weight_kg} onChange={e => setField(idx, 'weight_kg', e.target.value)} style={{ ...inp, width: 100 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="date" value={row.sent_date} onChange={e => setField(idx, 'sent_date', e.target.value)} style={{ ...inp, width: 130 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.01" value={row.rate_per_kg} onChange={e => { setField(idx, 'rate_per_kg', e.target.value); if (e.target.value && row.weight_kg) setField(idx, 'value', (parseFloat(e.target.value) * parseFloat(row.weight_kg)).toFixed(2)); }} style={{ ...inp, width: 90 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.01" value={row.value} onChange={e => { setField(idx, 'value', e.target.value); if (e.target.value && row.weight_kg) setField(idx, 'rate_per_kg', (parseFloat(e.target.value) / parseFloat(row.weight_kg)).toFixed(2)); }} style={{ ...inp, width: 100 }} /></td>
                <td style={{ padding: '4px 4px' }}>
                  {rows.length > 1 && <button onClick={() => removeRow(idx)} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button onClick={addRow} style={{ background: '#1e3a5f', color: '#7da2d6', border: '1px solid #23395d', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Row</button>
        <button onClick={submitAll} disabled={saving} style={{ background: '#f4ae1f', color: '#081426', border: 'none', borderRadius: 6, padding: '9px 24px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
          {saving ? 'Adding...' : '+ Save All SC Entries'}
        </button>
      </div>
    </div>
  );
}

// Finished Goods: Fabric Type | Colour | Lot No | Weight | Value
function FinishedGoodsForm({ fabricItems, saving, onSubmit }) {
  const empty = { fabric_type: '', color_name: '', lot_no: '', weight_kg: '', value: '' };
  const [rows, setRows] = useState([{ ...empty }]);

  const setField = (idx, k, v) => setRows(r => r.map((row, i) => i === idx ? { ...row, [k]: v } : row));
  const addRow = () => setRows(r => [...r, { ...empty }]);
  const removeRow = (idx) => setRows(r => r.filter((_, i) => i !== idx));

  const submitAll = async () => {
    for (const row of rows) {
      if (!row.weight_kg) continue;
      await onSubmit(row);
    }
    setRows([{ ...empty }]);
  };

  return (
    <div style={sectionStyle}>
      <h3 style={{ color: '#f4ae1f', margin: '0 0 14px', fontSize: 15 }}>Add Finished Goods</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Fabric Type', 'Colour', 'Lot No', 'Weight (kg) *', 'Value (₹)', ''].map(c => (
                <th key={c} style={{ padding: '8px 6px', textAlign: 'left', color: '#7da2d6', fontSize: 11, borderBottom: '1px solid #1e3a5f' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx}>
                <td style={{ padding: '4px 4px' }}>
                  <select value={row.fabric_type} onChange={e => setField(idx, 'fabric_type', e.target.value)} style={{ ...inp, minWidth: 160 }}>
                    <option value="">-- Select --</option>
                    {fabricItems.map(fi => <option key={fi.item_id} value={fi.item_name}>{fi.item_code} - {fi.item_name}</option>)}
                  </select>
                </td>
                <td style={{ padding: '4px 4px' }}><input value={row.color_name} onChange={e => setField(idx, 'color_name', e.target.value)} style={{ ...inp, width: 120 }} placeholder="e.g. Navy Blue" /></td>
                <td style={{ padding: '4px 4px' }}><input value={row.lot_no} onChange={e => setField(idx, 'lot_no', e.target.value)} style={{ ...inp, width: 100 }} placeholder="Lot #" /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.001" value={row.weight_kg} onChange={e => setField(idx, 'weight_kg', e.target.value)} style={{ ...inp, width: 110 }} /></td>
                <td style={{ padding: '4px 4px' }}><input type="number" step="0.01" value={row.value} onChange={e => setField(idx, 'value', e.target.value)} style={{ ...inp, width: 110 }} /></td>
                <td style={{ padding: '4px 4px' }}>
                  {rows.length > 1 && <button onClick={() => removeRow(idx)} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button onClick={addRow} style={{ background: '#1e3a5f', color: '#7da2d6', border: '1px solid #23395d', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Row</button>
        <button onClick={submitAll} disabled={saving} style={{ background: '#f4ae1f', color: '#081426', border: 'none', borderRadius: 6, padding: '9px 24px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
          {saving ? 'Adding...' : '+ Save All FG'}
        </button>
      </div>
    </div>
  );
}
