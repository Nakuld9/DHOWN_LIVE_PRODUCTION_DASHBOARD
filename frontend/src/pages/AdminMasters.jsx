import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || '';

export default function AdminMasters() {
  const [tab, setTab] = useState('locations');
  const token = localStorage.getItem('dhown_token');
  const headers = { Authorization: `Bearer ${token}` };

  const TABS = [
    { key: 'locations',  label: '🏭 Locations' },
    { key: 'departments',label: '🏢 Departments' },
    { key: 'costcentres',label: '💰 Cost Centres' },
    { key: 'taxrates',   label: '📊 Tax Rates' },
    { key: 'finyears',   label: '📅 Financial Years' },
    { key: 'routes',     label: '🔄 Process Routes' },
    { key: 'docseries',  label: '🔢 Doc Series' },
  ];

  return (
    <div style={{ padding: 24, color: 'var(--text)', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: 22, color: '#f1f5f9' }}>Admin Masters</h2>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 24, borderBottom: '1px solid var(--surface-2)', paddingBottom: 12 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? 'var(--border)' : 'none',
              color: tab === t.key ? 'var(--link)' : 'var(--muted)',
              border: 'none', padding: '7px 16px', borderRadius: 6,
              cursor: 'pointer', fontSize: 13, fontWeight: tab === t.key ? 700 : 500,
            }}>{t.label}</button>
        ))}
      </div>

      {tab === 'locations'   && <Locations headers={headers} />}
      {tab === 'departments' && <Departments headers={headers} />}
      {tab === 'costcentres' && <CostCentres headers={headers} />}
      {tab === 'taxrates'    && <TaxRates headers={headers} />}
      {tab === 'finyears'    && <FinancialYears headers={headers} />}
      {tab === 'routes'      && <ProcessRoutes headers={headers} />}
      {tab === 'docseries'   && <DocSeries headers={headers} />}
    </div>
  );
}

// ── LOCATIONS ─────────────────────────────────────────────────
function Locations({ headers }) {
  const [tree, setTree] = useState([]);
  const [selected, setSelected] = useState(null); // { type, data }
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('INTERNAL');
  const [adding, setAdding] = useState(null); // 'warehouse'|rack_id|bin rack_id

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/api/erp/warehouses`, { headers });
      setTree(r.data);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const addWarehouse = async () => {
    if (!newCode || !newName) return;
    try {
      await axios.post(`${API}/api/erp/warehouses`, { code: newCode.toUpperCase(), name: newName, type: newType }, { headers });
      setNewCode(''); setNewName(''); setAdding(null); load();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const addRack = async (wid) => {
    if (!newCode) return;
    try {
      await axios.post(`${API}/api/erp/warehouses/${wid}/racks`, { code: newCode.toUpperCase(), name: newName }, { headers });
      setNewCode(''); setNewName(''); setAdding(null); load();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const addBin = async (rid) => {
    if (!newCode) return;
    try {
      await axios.post(`${API}/api/erp/racks/${rid}/bins`, { code: newCode.toUpperCase() }, { headers });
      setNewCode(''); setAdding(null); load();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const deleteRack = async (rack) => {
    if (!window.confirm(`Delete rack ${rack.code}${rack.bins.length ? ` and its ${rack.bins.length} bin(s)` : ''}? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API}/api/erp/racks/${rack.rack_id}`, { headers });
      if (selected?.type === 'rack' && selected.data.rack_id === rack.rack_id) setSelected(null);
      load();
    } catch (e) { alert(e.response?.data?.error || 'Failed to delete rack'); }
  };

  const deleteBin = async (bin) => {
    if (!window.confirm(`Delete bin ${bin.code}? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API}/api/erp/bins/${bin.bin_id}`, { headers });
      load();
    } catch (e) { alert(e.response?.data?.error || 'Failed to delete bin'); }
  };

  const toggleWh = async (wh) => {
    try {
      await axios.put(`${API}/api/erp/warehouses/${wh.warehouse_id}`,
        { name: wh.name, type: wh.type, is_active: !wh.is_active }, { headers });
      load();
    } catch {}
  };

  // Production flow order for sorting/labelling (TRANSIT hidden — not in active flow)
  const FLOW = ['YARN-STORE', 'GREIGE-STORE', 'DYE-HOUSE', 'FINISHING', 'FG-STORE'];
  const flowIcon = { 'YARN-STORE': '🧵', 'GREIGE-STORE': '🧶', 'DYE-HOUSE': '🎨', 'FINISHING': '✂️', 'FG-STORE': '✅' };

  // Sort tree by flow order; hide TRANSIT
  const sorted = [...tree]
    .filter(w => w.code !== 'TRANSIT')
    .sort((a, b) => {
      const ai = FLOW.indexOf(a.code); const bi = FLOW.indexOf(b.code);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  return (
    <div>
      {/* Production flow banner */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 20px', marginBottom: 20, overflowX: 'auto' }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Production Flow</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap' }}>
          {[
            { icon: '🧵', label: 'Yarn Store',    sub: 'GRN → Issue' },
            { icon: '▶', label: null },
            { icon: '⚙️', label: 'Work Center',   sub: 'Machines' },
            { icon: '▶', label: null },
            { icon: '🧶', label: 'Greige Store',  sub: 'Rolls → Batch' },
            { icon: '▶', label: null },
            { icon: '🎨', label: 'Dye House',     sub: 'SC Challan out' },
            { icon: '▶', label: null },
            { icon: '✂️', label: 'Finishing',     sub: 'SC Challan out' },
            { icon: '▶', label: null },
            { icon: '✅', label: 'Finished Goods', sub: 'FG Store' },
            { icon: '▶', label: null },
            { icon: '📤', label: 'Dispatch',      sub: 'Customer' },
          ].map((step, i) =>
            step.label === null
              ? <div key={i} style={{ color: 'var(--border)', fontSize: 18, margin: '0 4px' }}>{step.icon}</div>
              : <div key={i} style={{ textAlign: 'center', minWidth: 72 }}>
                  <div style={{ fontSize: 20 }}>{step.icon}</div>
                  <div style={{ color: 'var(--link)', fontSize: 10, fontWeight: 700, marginTop: 2 }}>{step.label}</div>
                  <div style={{ color: 'var(--border)', fontSize: 9 }}>{step.sub}</div>
                </div>
          )}
        </div>
      </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Tree */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <h4 style={{ margin: 0, color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>Warehouse / Rack / Bin</h4>
          <button onClick={() => setAdding('warehouse')} style={s.btnSm}>+ Warehouse</button>
        </div>

        {adding === 'warehouse' && (
          <div style={s.addBox}>
            <input placeholder="Code e.g. WH-01" value={newCode} onChange={e => setNewCode(e.target.value)} style={s.input} />
            <input placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} style={{ ...s.input, marginTop: 6 }} />
            <select value={newType} onChange={e => setNewType(e.target.value)} style={{ ...s.input, marginTop: 6 }}>
              <option value="INTERNAL">Internal</option>
              <option value="EXTERNAL">External (Subcontractor)</option>
            </select>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={addWarehouse} style={s.btnPrimary}>Add</button>
              <button onClick={() => setAdding(null)} style={s.btnSec}>Cancel</button>
            </div>
          </div>
        )}

        {sorted.map(wh => (
          <div key={wh.warehouse_id} style={{ marginBottom: 8 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: 'var(--surface)', borderRadius: 8, padding: '10px 14px',
              cursor: 'pointer', border: `1px solid ${selected?.data?.warehouse_id === wh.warehouse_id ? 'var(--link)' : 'var(--surface-2)'}`,
            }} onClick={() => setSelected({ type: 'warehouse', data: wh })}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {flowIcon[wh.code] && <span style={{ fontSize: 18 }}>{flowIcon[wh.code]}</span>}
                <span style={{ fontFamily: 'monospace', color: 'var(--link)', fontWeight: 700, fontSize: 13 }}>{wh.code}</span>
                <span style={{ fontSize: 13 }}>{wh.name}</span>
                <span style={{ fontSize: 10, color: wh.type === 'EXTERNAL' ? 'var(--idle)' : wh.type === 'TRANSIT' ? 'var(--purple)' : 'var(--muted)',
                  background: wh.type === 'EXTERNAL' ? 'var(--crit-dim)' : wh.type === 'TRANSIT' ? 'var(--surface)' : 'var(--surface)',
                  padding: '1px 6px', borderRadius: 8 }}>
                  {wh.type}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: wh.is_active ? 'var(--green)' : 'var(--crit)' }}>
                  {wh.is_active ? '● Active' : '○ Inactive'}
                </span>
                <button onClick={e => { e.stopPropagation(); setAdding(`rack-${wh.warehouse_id}`); }} style={s.btnXs}>+Rack</button>
                <button onClick={e => { e.stopPropagation(); toggleWh(wh); }} style={{ ...s.btnXs, color: 'var(--crit)' }}>
                  {wh.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>

            {adding === `rack-${wh.warehouse_id}` && (
              <div style={{ ...s.addBox, marginLeft: 24, marginTop: 4 }}>
                <input placeholder="Rack code e.g. R4" value={newCode} onChange={e => setNewCode(e.target.value)} style={s.input} />
                <input placeholder="Rack name" value={newName} onChange={e => setNewName(e.target.value)} style={{ ...s.input, marginTop: 6 }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => addRack(wh.warehouse_id)} style={s.btnPrimary}>Add</button>
                  <button onClick={() => setAdding(null)} style={s.btnSec}>Cancel</button>
                </div>
              </div>
            )}

            {/* Racks */}
            {wh.racks.map(rack => (
              <div key={rack.rack_id} style={{ marginLeft: 24, marginTop: 4 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: 'var(--surface)', borderRadius: 6, padding: '7px 12px',
                  border: `1px solid ${selected?.data?.rack_id === rack.rack_id ? 'var(--purple)' : 'var(--surface)'}`,
                  cursor: 'pointer',
                }} onClick={() => setSelected({ type: 'rack', data: rack })}>
                  <span style={{ fontSize: 12 }}>
                    <span style={{ fontFamily: 'monospace', color: 'var(--purple)' }}>{rack.code}</span>
                    {rack.name && <span style={{ marginLeft: 8, color: 'var(--muted)' }}>{rack.name}</span>}
                    <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--border)' }}>{rack.bins.length} bins</span>
                  </span>
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button onClick={e => { e.stopPropagation(); setAdding(`bin-${rack.rack_id}`); }} style={s.btnXs}>+Bin</button>
                    <button onClick={e => { e.stopPropagation(); deleteRack(rack); }} style={{ ...s.btnXs, color: 'var(--crit)' }} title="Delete rack">✕</button>
                  </span>
                </div>

                {adding === `bin-${rack.rack_id}` && (
                  <div style={{ ...s.addBox, marginLeft: 24, marginTop: 4 }}>
                    <input placeholder="Bin code e.g. B5" value={newCode} onChange={e => setNewCode(e.target.value)} style={s.input} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button onClick={() => addBin(rack.rack_id)} style={s.btnPrimary}>Add</button>
                      <button onClick={() => setAdding(null)} style={s.btnSec}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Bins */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, marginLeft: 24 }}>
                  {rack.bins.map(bin => (
                    <span key={bin.bin_id} style={{
                      background: bin.is_active ? 'var(--border)' : 'var(--surface)',
                      color: bin.is_active ? 'var(--link)' : 'var(--border)',
                      padding: '2px 4px 2px 8px', borderRadius: 5, fontSize: 11, fontFamily: 'monospace',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                      {bin.code}
                      <button onClick={e => { e.stopPropagation(); deleteBin(bin); }} title="Delete bin"
                        style={{ background: 'none', border: 'none', color: 'var(--crit)', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}>✕</button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Detail panel */}
      <div>
        {selected ? (
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 20, border: '1px solid var(--surface-2)' }}>
            <h4 style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: 13, textTransform: 'uppercase' }}>
              {selected.type === 'warehouse' ? 'Warehouse Details' : 'Rack Details'}
            </h4>
            {selected.type === 'warehouse' && (
              <div>
                <InfoRow label="Code" value={selected.data.code} mono />
                <InfoRow label="Name" value={selected.data.name} />
                <InfoRow label="Type" value={selected.data.type} />
                <InfoRow label="Racks" value={selected.data.racks?.length} />
                <InfoRow label="Total Bins" value={selected.data.racks?.reduce((a,r) => a + r.bins.length, 0)} />
                <InfoRow label="Status" value={selected.data.is_active ? 'Active' : 'Inactive'} />
              </div>
            )}
            {selected.type === 'rack' && (
              <div>
                <InfoRow label="Code" value={selected.data.code} mono />
                <InfoRow label="Name" value={selected.data.name || '—'} />
                <InfoRow label="Bins" value={selected.data.bins?.length} />
              </div>
            )}
          </div>
        ) : (
          <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 20, border: '1px solid var(--surface)', color: 'var(--border)', textAlign: 'center' }}>
            Click a warehouse or rack to see details
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--surface)', fontSize: 13 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontFamily: mono ? 'monospace' : 'inherit', color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

// ── DEPARTMENTS ────────────────────────────────────────────────
function Departments({ headers }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', head_user: '' });
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try { setRows((await axios.get(`${API}/api/erp/departments`, { headers })).data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.code || !form.name) return;
    try {
      await axios.post(`${API}/api/erp/departments`, form, { headers });
      setForm({ code: '', name: '', head_user: '' }); setAdding(false); load();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const toggle = async (d) => {
    try {
      await axios.put(`${API}/api/erp/departments/${d.dept_id}`, { ...d, is_active: !d.is_active }, { headers });
      load();
    } catch {}
  };

  return (
    <SimpleTable
      title="Departments" rows={rows} adding={adding} setAdding={setAdding}
      cols={[['Code','code',true],['Name','name'],['Head','head_user'],['Status','is_active']]}
      renderVal={(col, row) => col === 'is_active'
        ? <ActiveBadge active={row.is_active} />
        : col === 'code' ? <Mono>{row[col]}</Mono> : row[col] || '—'}
      actions={row => <button onClick={() => toggle(row)} style={{ ...s.btnXs, color: row.is_active ? 'var(--crit)' : 'var(--green-2)' }}>{row.is_active ? 'Deactivate' : 'Activate'}</button>}
      addForm={
        <div style={s.grid2}>
          <LabelInput label="Code" value={form.code} onChange={v => setForm(f => ({...f, code: v.toUpperCase()}))} />
          <LabelInput label="Name" value={form.name} onChange={v => setForm(f => ({...f, name: v}))} />
          <LabelInput label="Head User" value={form.head_user} onChange={v => setForm(f => ({...f, head_user: v}))} />
        </div>
      }
      onSave={save} onCancel={() => setAdding(false)}
    />
  );
}

// ── COST CENTRES ───────────────────────────────────────────────
function CostCentres({ headers }) {
  const [rows, setRows] = useState([]);
  const [depts, setDepts] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', dept_id: '' });
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      setRows((await axios.get(`${API}/api/erp/cost-centres`, { headers })).data);
      setDepts((await axios.get(`${API}/api/erp/departments`, { headers })).data);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.code || !form.name) return;
    try {
      await axios.post(`${API}/api/erp/cost-centres`, form, { headers });
      setForm({ code: '', name: '', dept_id: '' }); setAdding(false); load();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  return (
    <SimpleTable
      title="Cost Centres" rows={rows} adding={adding} setAdding={setAdding}
      cols={[['Code','code',true],['Name','name'],['Department','dept_name']]}
      renderVal={(col, row) => col === 'code' ? <Mono>{row[col]}</Mono> : row[col] || '—'}
      actions={() => null}
      addForm={
        <div style={s.grid2}>
          <LabelInput label="Code" value={form.code} onChange={v => setForm(f => ({...f, code: v.toUpperCase()}))} />
          <LabelInput label="Name" value={form.name} onChange={v => setForm(f => ({...f, name: v}))} />
          <label style={s.label}>Department
            <select value={form.dept_id} onChange={e => setForm(f => ({...f, dept_id: e.target.value}))} style={s.input}>
              <option value="">— none —</option>
              {depts.map(d => <option key={d.dept_id} value={d.dept_id}>{d.name}</option>)}
            </select>
          </label>
        </div>
      }
      onSave={save} onCancel={() => setAdding(false)}
    />
  );
}

// ── TAX RATES ─────────────────────────────────────────────────
function TaxRates({ headers }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', cgst: '', sgst: '', igst: '' });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try { setRows((await axios.get(`${API}/api/erp/tax-rates`, { headers })).data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.code || !form.name) return;
    try {
      if (editing) {
        await axios.put(`${API}/api/erp/tax-rates/${editing}`, form, { headers });
        setEditing(null);
      } else {
        await axios.post(`${API}/api/erp/tax-rates`, form, { headers });
      }
      setForm({ code: '', name: '', cgst: '', sgst: '', igst: '' }); setAdding(false); load();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const startEdit = (r) => {
    setForm({ code: r.code, name: r.name, cgst: r.cgst, sgst: r.sgst, igst: r.igst });
    setEditing(r.tax_id); setAdding(true);
  };

  return (
    <SimpleTable
      title="Tax Rates" rows={rows} adding={adding} setAdding={setAdding}
      cols={[['Code','code',true],['Name','name'],['CGST%','cgst'],['SGST%','sgst'],['IGST%','igst'],['Status','is_active']]}
      renderVal={(col, row) => {
        if (col === 'code') return <Mono>{row[col]}</Mono>;
        if (col === 'is_active') return <ActiveBadge active={row.is_active} />;
        return row[col];
      }}
      actions={row => <button onClick={() => startEdit(row)} style={s.btnXs}>Edit</button>}
      addForm={
        <div style={s.grid2}>
          <LabelInput label="Code" value={form.code} onChange={v => setForm(f => ({...f, code: v.toUpperCase()}))} disabled={!!editing} />
          <LabelInput label="Name" value={form.name} onChange={v => setForm(f => ({...f, name: v}))} />
          <LabelInput label="CGST %" type="number" value={form.cgst} onChange={v => setForm(f => ({...f, cgst: v}))} />
          <LabelInput label="SGST %" type="number" value={form.sgst} onChange={v => setForm(f => ({...f, sgst: v}))} />
          <LabelInput label="IGST %" type="number" value={form.igst} onChange={v => setForm(f => ({...f, igst: v}))} />
        </div>
      }
      onSave={save} onCancel={() => { setAdding(false); setEditing(null); }}
    />
  );
}

// ── FINANCIAL YEARS ────────────────────────────────────────────
// Indian FY: starts 1 Apr of startYear, ends 31 Mar of startYear+1
function indFY(startYear) {
  return {
    label:      `${startYear}-${String(startYear + 1).slice(2)}`,
    start_date: `${startYear}-04-01`,
    end_date:   `${startYear + 1}-03-31`,
  };
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB').split('/').join('-');
}
// Current Indian FY start year: if today >= Apr 1 use this year, else last year
function currentFYStart() {
  const today = new Date();
  return today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
}

function FinancialYears({ headers }) {
  const [rows,    setRows]    = useState([]);
  const [adding,  setAdding]  = useState(false);
  const [fyStart, setFyStart] = useState(currentFYStart());

  const form = indFY(fyStart);

  const load = async () => {
    try { setRows((await axios.get(`${API}/api/erp/financial-years`, { headers })).data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      await axios.post(`${API}/api/erp/financial-years`, form, { headers });
      setAdding(false); load();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const setActive = async (fy) => {
    try {
      await axios.put(`${API}/api/erp/financial-years/${fy.fy_id}`, { is_active: true, is_closed: false }, { headers });
      load();
    } catch {}
  };

  const close = async (fy) => {
    if (!window.confirm(`Close FY ${fy.label}? This cannot be undone.`)) return;
    try {
      await axios.put(`${API}/api/erp/financial-years/${fy.fy_id}`, { is_active: false, is_closed: true }, { headers });
      load();
    } catch {}
  };

  // Quick-add buttons: previous 2 FYs + current + next
  const curStart = currentFYStart();
  const quickYears = [curStart - 2, curStart - 1, curStart, curStart + 1];

  return (
    <div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: 'var(--muted)' }}>
        <span style={{ color: 'var(--link)', fontWeight: 600 }}>Indian Financial Year:</span> 1 April → 31 March &nbsp;|&nbsp; Current FY: <span style={{ color: 'var(--green-2)', fontWeight: 600 }}>{indFY(curStart).label}</span>
      </div>

      <SimpleTable
        title="Financial Years" rows={rows} adding={adding} setAdding={setAdding}
        cols={[['FY Label','label',true],['Start','start_date'],['End','end_date'],['Active','is_active'],['Closed','is_closed']]}
        renderVal={(col, row) => {
          if (col === 'label')     return <Mono>{row[col]}</Mono>;
          if (col === 'start_date' || col === 'end_date') return fmtDate(row[col]);
          if (col === 'is_active') return <ActiveBadge active={row.is_active} />;
          if (col === 'is_closed') return row.is_closed ? <span style={{ color: 'var(--crit)' }}>Closed</span> : '—';
          return row[col];
        }}
        actions={row => !row.is_closed && (
          <div style={{ display: 'flex', gap: 6 }}>
            {!row.is_active && <button onClick={() => setActive(row)} style={{ ...s.btnXs, color: 'var(--green-2)' }}>Set Active</button>}
            <button onClick={() => close(row)} style={{ ...s.btnXs, color: 'var(--crit)' }}>Close</button>
          </div>
        )}
        addForm={
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Select the FY start year — dates are auto-filled (1 Apr → 31 Mar):</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {quickYears.map(y => (
                <button key={y} onClick={() => setFyStart(y)} style={{
                  background: fyStart === y ? 'var(--border)' : 'var(--surface)',
                  color: fyStart === y ? 'var(--link)' : 'var(--muted)',
                  border: '1px solid ' + (fyStart === y ? 'var(--link)' : 'var(--surface-2)'),
                  padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}>FY {indFY(y).label}</button>
              ))}
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 24 }}>
                <div><span style={{ color: 'var(--muted)' }}>Label: </span><span style={{ color: 'var(--link)', fontWeight: 700, fontFamily: 'monospace' }}>{form.label}</span></div>
                <div><span style={{ color: 'var(--muted)' }}>Start: </span><span style={{ color: 'var(--text)' }}>{fmtDate(form.start_date)}</span></div>
                <div><span style={{ color: 'var(--muted)' }}>End: </span><span style={{ color: 'var(--text)' }}>{fmtDate(form.end_date)}</span></div>
              </div>
            </div>
          </div>
        }
        onSave={save} onCancel={() => { setAdding(false); setFyStart(currentFYStart()); }}
      />
    </div>
  );
}

// ── PROCESS ROUTES ────────────────────────────────────────────
function ProcessRoutes({ headers }) {
  const [routes, setRoutes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [depts, setDepts] = useState([]);
  const [addingStep, setAddingStep] = useState(false);
  const [addingRoute, setAddingRoute] = useState(false);
  const [routeForm, setRouteForm] = useState({ code: '', name: '', description: '', item_category: '' });
  const [stepForm, setStepForm] = useState({ step_order: '', step_code: '', step_name: '', location_type: 'INTERNAL', dept_id: '', generates_document: '', is_optional: false });

  const load = async () => {
    try {
      const [r, d] = await Promise.all([
        axios.get(`${API}/api/erp/process-routes`, { headers }),
        axios.get(`${API}/api/erp/departments`, { headers }),
      ]);
      setRoutes(r.data);
      setDepts(d.data);
      if (selected) setSelected(r.data.find(x => x.route_id === selected.route_id) || null);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const createRoute = async () => {
    if (!routeForm.code || !routeForm.name) return alert('Code and Name are required');
    try {
      const r = await axios.post(`${API}/api/erp/process-routes`, routeForm, { headers });
      setRouteForm({ code: '', name: '', description: '', item_category: '' });
      setAddingRoute(false);
      await load();
      setSelected(routes.find(x => x.route_id === r.data.route_id) || null);
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const deleteRoute = async (routeId) => {
    if (!window.confirm('Delete this route and all its steps?')) return;
    try {
      await axios.delete(`${API}/api/erp/process-routes/${routeId}`, { headers });
      setSelected(null); load();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const addStep = async () => {
    if (!stepForm.step_code || !stepForm.step_name) return;
    try {
      await axios.post(`${API}/api/erp/process-routes/${selected.route_id}/steps`, stepForm, { headers });
      setStepForm({ step_order: '', step_code: '', step_name: '', location_type: 'INTERNAL', dept_id: '', generates_document: '', is_optional: false });
      setAddingStep(false); load();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const deleteStep = async (sid) => {
    if (!window.confirm('Remove step?')) return;
    try {
      await axios.delete(`${API}/api/erp/process-routes/${selected.route_id}/steps/${sid}`, { headers });
      load();
    } catch {}
  };

  const CATEGORY_OPTIONS = [
    { value: '', label: 'All categories' },
    { value: 'YARN', label: 'Yarn' },
    { value: 'GREIGE', label: 'Greige / Fabric' },
    { value: 'FINISHED', label: 'Finished Goods' },
    { value: 'KNITTING', label: 'Knitting (Yarn → Greige)' },
    { value: 'JOB_WORK', label: 'Job Work (Inward Knitting)' },
    { value: 'DYEING', label: 'Dyeing' },
    { value: 'FINISHING', label: 'Finishing' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
      {/* Route list */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h4 style={{ margin: 0, color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>Process Routes</h4>
          <button onClick={() => setAddingRoute(v => !v)} style={{ ...s.btnPrimary, padding: '4px 12px', fontSize: 12 }}>+ New Route</button>
        </div>

        {addingRoute && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <LabelInput label="Code (e.g. KNIT-OUT)" value={routeForm.code} onChange={v => setRouteForm(f => ({ ...f, code: v.toUpperCase() }))} />
              <LabelInput label="Name" value={routeForm.name} onChange={v => setRouteForm(f => ({ ...f, name: v }))} />
              <LabelInput label="Description" value={routeForm.description} onChange={v => setRouteForm(f => ({ ...f, description: v }))} />
              <label style={s.label}>Category
                <select value={routeForm.item_category} onChange={e => setRouteForm(f => ({ ...f, item_category: e.target.value }))} style={s.input}>
                  {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={createRoute} style={s.btnPrimary}>Create</button>
              <button onClick={() => setAddingRoute(false)} style={s.btnSec}>Cancel</button>
            </div>
          </div>
        )}

        {routes.map(r => (
          <div key={r.route_id}
            onClick={() => setSelected(r)}
            style={{
              background: selected?.route_id === r.route_id ? 'var(--border)' : 'var(--surface)',
              border: `1px solid ${selected?.route_id === r.route_id ? 'var(--link)' : 'var(--surface-2)'}`,
              borderRadius: 8, padding: '10px 14px', marginBottom: 8, cursor: 'pointer', position: 'relative',
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{r.name}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--link)' }}>{r.code}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{r.steps?.length || 0} steps · {r.item_category || 'all'}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); deleteRoute(r.route_id); }}
                style={{ background: 'none', border: 'none', color: 'var(--border)', cursor: 'pointer', fontSize: 13, padding: 2 }}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* Steps detail */}
      {selected ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h4 style={{ margin: 0, fontSize: 16 }}>{selected.name}</h4>
              <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12 }}>{selected.description}</p>
            </div>
            <button onClick={() => setAddingStep(true)} style={s.btnPrimary}>+ Add Step</button>
          </div>

          {/* Steps timeline */}
          {selected.steps?.map((step, i) => (
            <div key={step.step_id} style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: step.location_type === 'EXTERNAL' ? 'var(--crit-dim)' : 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text)', fontWeight: 700, flexShrink: 0 }}>{step.step_order}</div>
                {i < selected.steps.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--surface-2)', minHeight: 20 }} />}
              </div>
              <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 8, padding: '10px 14px', border: '1px solid var(--surface-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{step.step_name}</span>
                    {step.is_optional && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--gold-2)', background: 'var(--crit-dim)', padding: '1px 6px', borderRadius: 8 }}>OPTIONAL</span>}
                    {step.location_type === 'EXTERNAL' && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--idle)', background: 'var(--crit-dim)', padding: '1px 6px', borderRadius: 8 }}>EXTERNAL</span>}
                  </div>
                  <button onClick={() => deleteStep(step.step_id)} style={{ background: 'none', border: 'none', color: 'var(--crit)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {step.dept_name && <span>{step.dept_name} · </span>}
                  <span style={{ fontFamily: 'monospace' }}>{step.step_code}</span>
                  {step.generates_document && <span> · Doc: {step.generates_document}</span>}
                </div>
              </div>
            </div>
          ))}

          {addingStep && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 8, padding: 16, marginTop: 12 }}>
              <div style={s.grid2}>
                <LabelInput label="Step Order" type="number" value={stepForm.step_order} onChange={v => setStepForm(f => ({...f, step_order: v}))} />
                <LabelInput label="Step Code" value={stepForm.step_code} onChange={v => setStepForm(f => ({...f, step_code: v.toUpperCase()}))} />
                <LabelInput label="Step Name" value={stepForm.step_name} onChange={v => setStepForm(f => ({...f, step_name: v}))} />
                <label style={s.label}>Location Type
                  <select value={stepForm.location_type} onChange={e => setStepForm(f => ({...f, location_type: e.target.value}))} style={s.input}>
                    <option value="INTERNAL">Internal</option>
                    <option value="EXTERNAL">External</option>
                  </select>
                </label>
                <label style={s.label}>Department
                  <select value={stepForm.dept_id} onChange={e => setStepForm(f => ({...f, dept_id: e.target.value}))} style={s.input}>
                    <option value="">— none —</option>
                    {depts.map(d => <option key={d.dept_id} value={d.dept_id}>{d.name}</option>)}
                  </select>
                </label>
                <LabelInput label="Generates Document" value={stepForm.generates_document} onChange={v => setStepForm(f => ({...f, generates_document: v}))} />
                <label style={s.label}>Optional step?
                  <input type="checkbox" checked={stepForm.is_optional} onChange={e => setStepForm(f => ({...f, is_optional: e.target.checked}))} style={{ marginTop: 8, width: 18, height: 18 }} />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={addStep} style={s.btnPrimary}>Add Step</button>
                <button onClick={() => setAddingStep(false)} style={s.btnSec}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 20, border: '1px solid var(--surface)', color: 'var(--border)', textAlign: 'center', alignSelf: 'start' }}>
          Click a route to see its steps
        </div>
      )}
    </div>
  );
}

// ── DOC SERIES ────────────────────────────────────────────────
function DocSeries({ headers }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null); // series_code
  const [editVals, setEditVals] = useState({});

  const load = async () => {
    try { setRows((await axios.get(`${API}/api/erp/doc-series`, { headers })).data); } catch {}
  };
  useEffect(() => { load(); }, []);

  const startEdit = (r) => { setEditing(r.series_code); setEditVals({ prefix: r.prefix, zero_pad: r.zero_pad }); };

  const save = async (code) => {
    try {
      await axios.put(`${API}/api/erp/doc-series/${code}`, editVals, { headers });
      setEditing(null); load();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div>
      <h4 style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>Document Number Series</h4>
      <div style={{ overflowX: 'auto', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--surface-2)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              {['Series','Prefix','Pad','Year','Month','Reset Yearly','Seq','Last Reset','Next Number','Actions'].map(h => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const nextSeq = r.current_seq + 1;
              const yr = new Date().getFullYear().toString().slice(2);
              const preview = (editing === r.series_code ? editVals.prefix : r.prefix)
                + (r.include_year ? yr : '')
                + String(nextSeq).padStart(editing === r.series_code ? parseInt(editVals.zero_pad) : r.zero_pad, '0');
              return (
                <tr key={r.series_code}>
                  <td style={s.td}><Mono>{r.series_code}</Mono></td>
                  <td style={s.td}>
                    {editing === r.series_code
                      ? <input value={editVals.prefix} onChange={e => setEditVals(v => ({...v, prefix: e.target.value}))} style={{ ...s.input, width: 80 }} />
                      : <Mono>{r.prefix}</Mono>}
                  </td>
                  <td style={s.td}>
                    {editing === r.series_code
                      ? <input type="number" value={editVals.zero_pad} onChange={e => setEditVals(v => ({...v, zero_pad: e.target.value}))} style={{ ...s.input, width: 60 }} />
                      : r.zero_pad}
                  </td>
                  <td style={s.td}>{r.include_year ? '✓' : '—'}</td>
                  <td style={s.td}>{r.include_month ? '✓' : '—'}</td>
                  <td style={s.td}>{r.reset_yearly ? '✓' : '—'}</td>
                  <td style={s.td}>{r.current_seq}</td>
                  <td style={s.td}>{r.last_reset ? r.last_reset.slice(0,10) : '—'}</td>
                  <td style={s.td}><span style={{ fontFamily: 'monospace', color: 'var(--green-2)', fontSize: 12 }}>{preview}</span></td>
                  <td style={s.td}>
                    {editing === r.series_code
                      ? <><button onClick={() => save(r.series_code)} style={s.btnPrimary}>Save</button> <button onClick={() => setEditing(null)} style={s.btnSec}>Cancel</button></>
                      : <button onClick={() => startEdit(r)} style={s.btnXs}>Edit</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Shared tiny components ────────────────────────────────────
function SimpleTable({ title, rows, adding, setAdding, cols, renderVal, actions, addForm, onSave, onCancel }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <h4 style={{ margin: 0, color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase' }}>{title}</h4>
        <button onClick={() => setAdding(true)} style={s.btnSm}>+ Add</button>
      </div>
      {adding && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          {addForm}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={onSave} style={s.btnPrimary}>Save</button>
            <button onClick={onCancel} style={s.btnSec}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ overflowX: 'auto', background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--surface-2)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              {cols.map(([h]) => <th key={h} style={s.th}>{h}</th>)}
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={cols.length + 1} style={{ textAlign: 'center', padding: 30, color: 'var(--border)' }}>No records yet</td></tr>
              : rows.map((row, i) => (
                <tr key={i}>
                  {cols.map(([, key]) => <td key={key} style={s.td}>{renderVal(key, row)}</td>)}
                  <td style={s.td}>{actions(row)}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LabelInput({ label, value, onChange, type = 'text', disabled }) {
  return (
    <label style={s.label}>{label}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} style={s.input} />
    </label>
  );
}

function ActiveBadge({ active }) {
  return <span style={{ color: active ? 'var(--green)' : 'var(--crit)', fontSize: 12 }}>{active ? '● Active' : '○ Inactive'}</span>;
}

function Mono({ children }) {
  return <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--link)' }}>{children}</span>;
}

const s = {
  btnPrimary: { background: 'var(--link)', color: 'var(--text)', border: 'none', padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnSec:     { background: 'var(--surface-2)', color: 'var(--text)', border: 'none', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnSm:      { background: 'var(--border)', color: 'var(--link)', border: 'none', padding: '5px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  btnXs:      { background: 'var(--border)', color: 'var(--link)', border: 'none', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 },
  input:      { width: '100%', background: 'var(--surface)', border: '1px solid var(--surface-2)', color: 'var(--text)', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box', marginTop: 4 },
  label:      { display: 'flex', flexDirection: 'column', fontSize: 12, color: 'var(--muted)', fontWeight: 500 },
  grid2:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  th:         { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--surface-2)', whiteSpace: 'nowrap' },
  td:         { padding: '9px 14px', fontSize: 13, borderBottom: '1px solid var(--surface)', verticalAlign: 'middle' },
  addBox:     { background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 8, padding: 14, marginBottom: 8 },
};
