import React, { useEffect, useState } from 'react';

const API = '';
const token = () => localStorage.getItem('dhown_token');

const STATUS_COLOR = { IN_STOCK: 'var(--green)', PARTIALLY_DISPATCHED: 'var(--gold-2)', DISPATCHED: 'var(--muted)' };

export default function FinishedGoods() {
  const [goods, setGoods]     = useState([]);
  const [summary, setSummary] = useState({ by_type: [], in_stock_totals: {} });
  const [filter, setFilter]   = useState('IN_STOCK');
  const [editLocation, setEditLocation] = useState(null);
  const [locVal, setLocVal]   = useState('');
  const [msg, setMsg]         = useState('');
  const [loading, setLoading] = useState(true);
  const [editFg, setEditFg]   = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ fabric_type: '', color_name: '', lot_no: '', date: new Date().toISOString().slice(0, 10) });
  const [addWeights, setAddWeights] = useState(['']);
  const [addBusy, setAddBusy] = useState(false);

  const load = async () => {
    const p = filter ? `?status=${filter}` : '';
    const [g, s] = await Promise.all([
      fetch(`${API}/api/finished-goods${p}`).then(r => r.json()),
      fetch(`${API}/api/finished-goods/summary`).then(r => r.json()),
    ]);
    setGoods(Array.isArray(g) ? g : []);
    setSummary(s);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3000); };

  const startEditFg = (g) => {
    setEditForm({ weight_kg: g.weight_kg||'', fabric_type: g.fabric_type||'', color_name: g.color_name||'', location: g.location||'', notes: g.notes||'' });
    setEditFg(g.fg_id);
  };
  const saveEditFg = async () => {
    const r = await fetch(`${API}/api/finished-goods/${editFg}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(editForm) });
    if (!r.ok) { const e = await r.json(); alert(e.error); return; }
    setEditFg(null); load(); flash('Updated');
  };

  const addFinished = async () => {
    const valid = addWeights.map(Number).filter(n => n > 0);
    if (!addForm.fabric_type.trim() || !valid.length) return;
    setAddBusy(true);
    const r = await fetch(`${API}/api/finished-entry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ ...addForm, rolls: valid.map(w => ({ weight_kg: w })) }),
    });
    setAddBusy(false);
    if (!r.ok) { const e = await r.json(); alert(e.error); return; }
    const j = await r.json();
    flash(`Added ${j.rolls} finished rolls · ${j.total_kg} kg`);
    setAddWeights(['']); setShowAdd(false); load();
  };

  const saveLocation = async (fgId) => {
    const r = await fetch(`${API}/api/finished-goods/${fgId}/location`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ location: locVal }),
    });
    if (!r.ok) { flash('Failed to save location'); return; }
    flash('Location saved');
    setEditLocation(null);
    load();
  };

  return (
    <div style={{ padding: '28px', color: 'var(--text)', minHeight: '100vh' }}>
      <h1 style={{ color: 'var(--gold)', fontSize: '36px', margin: '0 0 6px', letterSpacing: 2 }}>FINISHED GOODS</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 24px', fontSize: '13px' }}>Dyed and finished fabric ready for dispatch</p>

      {msg && <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid var(--green)', color: 'var(--green)', padding: '10px 16px', borderRadius: '8px', marginBottom: '16px', fontWeight: 'bold' }}>{msg}</div>}

      {/* Add finished goods (manual — e.g. job-work returns not captured elsewhere) */}
      <div style={{ marginBottom: '18px' }}>
        <button onClick={() => setShowAdd(s => !s)}
          style={{ background: showAdd ? 'var(--border)' : 'var(--green)', color: showAdd ? 'var(--text)' : '#000', border: 'none', padding: '9px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
          {showAdd ? '✕ Cancel' : '+ Add finished goods'}
        </button>
        {showAdd && (() => {
          const inp = { padding: '8px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--surface-2)', borderRadius: '6px' };
          const valid = addWeights.map(Number).filter(n => n > 0);
          const total = Math.round(valid.reduce((s, n) => s + n, 0) * 100) / 100;
          return (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '10px', padding: '16px', marginTop: '10px' }}>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 10 }}>Record dyed/finished fabric received back — each roll becomes finished stock and awaits 4-point inspection.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
                <input style={inp} placeholder="Fabric / quality *" value={addForm.fabric_type} onChange={e => setAddForm(f => ({ ...f, fabric_type: e.target.value }))} />
                <input style={inp} placeholder="Colour / shade" value={addForm.color_name} onChange={e => setAddForm(f => ({ ...f, color_name: e.target.value }))} />
                <input style={inp} placeholder="Dye lot" value={addForm.lot_no} onChange={e => setAddForm(f => ({ ...f, lot_no: e.target.value }))} />
                <input style={inp} type="date" value={addForm.date} onChange={e => setAddForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ color: 'var(--gold)', fontWeight: 'bold', fontSize: 13 }}>Roll weights (kg)</span>
                <button onClick={() => setAddWeights(w => [...w, ''])} style={{ background: 'var(--surface-2)', color: 'var(--text)', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>+ Add roll</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {addWeights.map((w, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input style={{ ...inp, width: 90 }} type="number" step="0.1" placeholder={`#${i + 1}`} value={w} onChange={e => setAddWeights(a => a.map((x, j) => j === i ? e.target.value : x))} />
                    {addWeights.length > 1 && <button onClick={() => setAddWeights(a => a.filter((_, j) => j !== i))} style={{ background: 'var(--crit-dim)', color: 'var(--crit)', border: 'none', padding: '6px 9px', borderRadius: 6, cursor: 'pointer' }}>✕</button>}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                <span style={{ color: 'var(--text)', fontSize: 14 }}><b>{valid.length}</b> rolls · <b>{total}</b> kg</span>
                <button onClick={addFinished} disabled={addBusy || !addForm.fabric_type.trim() || !valid.length}
                  style={{ background: 'var(--gold)', color: '#000', border: 'none', padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', fontSize: 13, opacity: (addBusy || !addForm.fabric_type.trim() || !valid.length) ? 0.5 : 1 }}>
                  {addBusy ? 'Saving…' : 'Record finished goods'}
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <KPI label="IN STOCK LOTS"  value={summary.in_stock_totals?.lot_count ?? 0} color="var(--green)" />
        <KPI label="IN STOCK KG"    value={`${parseFloat(summary.in_stock_totals?.total_kg ?? 0).toFixed(2)} kg`} color="var(--link)" />
        {summary.in_stock_totals?.total_cost_rs > 0 && (
          <KPI label="TOTAL STOCK VALUE" value={`₹${parseFloat(summary.in_stock_totals.total_cost_rs).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`} color="var(--pink)" />
        )}
        {summary.in_stock_totals?.avg_cost_per_kg > 0 && (
          <KPI label="AVG COST / KG" value={`₹${parseFloat(summary.in_stock_totals.avg_cost_per_kg).toFixed(2)}`} color="var(--purple)" />
        )}
        {summary.by_type?.filter(t => t.status === 'IN_STOCK').map(t => (
          <KPI key={`${t.fabric_type}-${t.color_name}`}
            label={`${t.fabric_type} / ${t.color_name}`}
            value={`${t.lot_count} lots • ${parseFloat(t.total_kg).toFixed(2)} kg`}
            color="var(--yellow)" small />
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {['IN_STOCK', 'DISPATCHED', ''].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ background: filter === s ? 'var(--gold)' : 'var(--surface)', color: filter === s ? '#000' : 'var(--muted)', border: '1px solid var(--surface-2)', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            {s === 'IN_STOCK' ? 'In Stock' : s === 'DISPATCHED' ? 'Dispatched' : 'All'}
          </button>
        ))}
        <span style={{ color: 'var(--muted)', fontSize: '13px', alignSelf: 'center', marginLeft: 'auto' }}>
          {goods.length} lot{goods.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '10px' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>
        ) : goods.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
            No finished goods yet. Receive material back in Subcontracting to create entries.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['FG #', 'Batch', 'Fabric', 'Color', 'Weight (kg)', 'Total Cost', '₹/kg', 'Vendor', 'Location', 'Status', ''].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {goods.map(g => (
                <tr key={g.fg_id} style={{ borderBottom: '1px solid var(--surface)' }}>
                  <td style={td}><span style={{ color: 'var(--gold)', fontWeight: 'bold' }}>FG-{g.fg_id}</span></td>
                  <td style={td}>{g.batch_number || '—'}</td>
                  <td style={td}>{g.fabric_type || '—'}</td>
                  <td style={td}>{g.color_name || <span style={{ color: 'var(--border)' }}>Undyed</span>}</td>
                  <td style={td}><strong style={{ color: 'var(--green)' }}>{parseFloat(g.weight_kg || 0).toFixed(3)} kg</strong></td>
                  <td style={td}>
                    {parseFloat(g.total_cost_rs || 0) > 0
                      ? <span style={{ color: 'var(--pink)', fontWeight: 700 }}>₹{parseFloat(g.total_cost_rs).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      : <span style={{ color: 'var(--border)', fontSize: 11 }}>no data</span>}
                  </td>
                  <td style={td}>
                    {parseFloat(g.cost_per_kg || 0) > 0
                      ? <span style={{ color: 'var(--purple)', fontWeight: 700 }}>₹{parseFloat(g.cost_per_kg).toFixed(2)}</span>
                      : <span style={{ color: 'var(--border)', fontSize: 11 }}>—</span>}
                  </td>
                  <td style={td}>{g.vendor_name || '—'}</td>
                  <td style={td}>
                    {editLocation === g.fg_id ? (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input value={locVal} onChange={e => setLocVal(e.target.value)}
                          placeholder="Rack A-1" autoFocus
                          style={{ background: 'var(--bg)', border: '1px solid var(--surface)', color: 'var(--text)', padding: '4px 8px', borderRadius: '5px', fontSize: '12px', width: '90px' }} />
                        <button onClick={() => saveLocation(g.fg_id)} style={{ background: 'var(--green)', color: '#000', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>✓</button>
                        <button onClick={() => setEditLocation(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>✕</button>
                      </div>
                    ) : (
                      <span onClick={() => { setEditLocation(g.fg_id); setLocVal(g.location || ''); }}
                        style={{ cursor: 'pointer', color: g.location ? '#fff' : 'var(--border)', borderBottom: '1px dashed var(--border)' }}>
                        {g.location || 'Set location'}
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    <span style={{ background: `${STATUS_COLOR[g.status]}22`, color: STATUS_COLOR[g.status], padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
                      {g.status?.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {g.status !== 'DISPATCHED' && (<>
                        <button onClick={() => startEditFg(g)}
                          style={{ background: 'var(--link)', color: 'var(--text)', border: 'none', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 'bold' }}>✎</button>
                        <button onClick={async () => { if (!window.confirm(`Delete FG-${g.fg_id}? Number freed.`)) return; const r = await fetch(`${API}/api/finished-goods/${g.fg_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } }); if (r.ok) load(); else { const e = await r.json(); alert(e.error); } }}
                          style={{ background: 'var(--crit)', color: 'var(--text)', border: 'none', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 'bold' }}>🗑</button>
                      </>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit FG Modal */}
      {editFg && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 12, padding: 24, width: 400 }}>
            <h3 style={{ color: 'var(--gold)', marginTop: 0 }}>Edit FG-{editFg}</h3>
            {[
              ['Weight (kg)', 'weight_kg', 'number'], ['Fabric Type', 'fabric_type', 'text'],
              ['Color', 'color_name', 'text'], ['Location', 'location', 'text'], ['Notes', 'notes', 'text']
            ].map(([label, key, type]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label style={{ color: 'var(--muted)', fontSize: 11, display: 'block', marginBottom: 3 }}>{label}</label>
                <input type={type} value={editForm[key]||''} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                  style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '7px 10px', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={saveEditFg} style={{ background: 'var(--green)', color: 'var(--text)', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>Save</button>
              <button onClick={() => setEditFg(null)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 20px', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const KPI = ({ label, value, color, small }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: '10px', padding: small ? '12px 14px' : '16px 18px' }}>
    <div style={{ fontSize: '11px', color: 'var(--muted)', letterSpacing: 1, marginBottom: '4px' }}>{label}</div>
    <div style={{ fontSize: small ? '13px' : '26px', fontWeight: 'bold', color }}>{value}</div>
  </div>
);

const th = { padding: '12px 14px', borderBottom: '1px solid var(--surface)', textAlign: 'left', color: 'var(--muted)', fontSize: '11px', letterSpacing: 1 };
const td = { padding: '11px 14px' };
