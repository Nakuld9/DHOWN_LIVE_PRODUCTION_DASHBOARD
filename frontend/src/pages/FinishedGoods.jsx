import React, { useEffect, useState } from 'react';

const API = 'http://localhost:4000';
const token = () => localStorage.getItem('dhown_token');

const STATUS_COLOR = { IN_STOCK: '#22c55e', PARTIALLY_DISPATCHED: '#fbbf24', DISPATCHED: '#9ca3af' };

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
    <div style={{ padding: '28px', color: '#fff', minHeight: '100vh' }}>
      <h1 style={{ color: '#FFD700', fontSize: '36px', margin: '0 0 6px', letterSpacing: 2 }}>FINISHED GOODS</h1>
      <p style={{ color: '#7da2d6', margin: '0 0 24px', fontSize: '13px' }}>Dyed and finished fabric ready for dispatch</p>

      {msg && <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#22c55e', padding: '10px 16px', borderRadius: '8px', marginBottom: '16px', fontWeight: 'bold' }}>{msg}</div>}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <KPI label="IN STOCK LOTS"  value={summary.in_stock_totals?.lot_count ?? 0} color="#22c55e" />
        <KPI label="IN STOCK KG"    value={`${parseFloat(summary.in_stock_totals?.total_kg ?? 0).toFixed(2)} kg`} color="#60a5fa" />
        {summary.in_stock_totals?.total_cost_rs > 0 && (
          <KPI label="TOTAL STOCK VALUE" value={`₹${parseFloat(summary.in_stock_totals.total_cost_rs).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`} color="#f472b6" />
        )}
        {summary.in_stock_totals?.avg_cost_per_kg > 0 && (
          <KPI label="AVG COST / KG" value={`₹${parseFloat(summary.in_stock_totals.avg_cost_per_kg).toFixed(2)}`} color="#a78bfa" />
        )}
        {summary.by_type?.filter(t => t.status === 'IN_STOCK').map(t => (
          <KPI key={`${t.fabric_type}-${t.color_name}`}
            label={`${t.fabric_type} / ${t.color_name}`}
            value={`${t.lot_count} lots • ${parseFloat(t.total_kg).toFixed(2)} kg`}
            color="#FFD700" small />
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {['IN_STOCK', 'DISPATCHED', ''].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ background: filter === s ? '#FFD700' : '#0d1b2f', color: filter === s ? '#000' : '#7da2d6', border: '1px solid #23395d', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            {s === 'IN_STOCK' ? 'In Stock' : s === 'DISPATCHED' ? 'Dispatched' : 'All'}
          </button>
        ))}
        <span style={{ color: '#7da2d6', fontSize: '13px', alignSelf: 'center', marginLeft: 'auto' }}>
          {goods.length} lot{goods.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', background: '#081830', border: '1px solid #23395d', borderRadius: '10px' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#7da2d6' }}>Loading...</div>
        ) : goods.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#7da2d6' }}>
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
                <tr key={g.fg_id} style={{ borderBottom: '1px solid #0d1b2f' }}>
                  <td style={td}><span style={{ color: '#FFD700', fontWeight: 'bold' }}>FG-{g.fg_id}</span></td>
                  <td style={td}>{g.batch_number || '—'}</td>
                  <td style={td}>{g.fabric_type || '—'}</td>
                  <td style={td}>{g.color_name || <span style={{ color: '#455a7c' }}>Undyed</span>}</td>
                  <td style={td}><strong style={{ color: '#22c55e' }}>{parseFloat(g.weight_kg || 0).toFixed(3)} kg</strong></td>
                  <td style={td}>
                    {parseFloat(g.total_cost_rs || 0) > 0
                      ? <span style={{ color: '#f472b6', fontWeight: 700 }}>₹{parseFloat(g.total_cost_rs).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      : <span style={{ color: '#455a7c', fontSize: 11 }}>no data</span>}
                  </td>
                  <td style={td}>
                    {parseFloat(g.cost_per_kg || 0) > 0
                      ? <span style={{ color: '#a78bfa', fontWeight: 700 }}>₹{parseFloat(g.cost_per_kg).toFixed(2)}</span>
                      : <span style={{ color: '#455a7c', fontSize: 11 }}>—</span>}
                  </td>
                  <td style={td}>{g.vendor_name || '—'}</td>
                  <td style={td}>
                    {editLocation === g.fg_id ? (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input value={locVal} onChange={e => setLocVal(e.target.value)}
                          placeholder="Rack A-1" autoFocus
                          style={{ background: '#050d1a', border: '1px solid #16345d', color: '#fff', padding: '4px 8px', borderRadius: '5px', fontSize: '12px', width: '90px' }} />
                        <button onClick={() => saveLocation(g.fg_id)} style={{ background: '#22c55e', color: '#000', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>✓</button>
                        <button onClick={() => setEditLocation(null)} style={{ background: 'transparent', border: '1px solid #455a7c', color: '#9ca3af', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>✕</button>
                      </div>
                    ) : (
                      <span onClick={() => { setEditLocation(g.fg_id); setLocVal(g.location || ''); }}
                        style={{ cursor: 'pointer', color: g.location ? '#fff' : '#455a7c', borderBottom: '1px dashed #344a6c' }}>
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
                          style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 'bold' }}>✎</button>
                        <button onClick={async () => { if (!window.confirm(`Delete FG-${g.fg_id}? Number freed.`)) return; const r = await fetch(`${API}/api/finished-goods/${g.fg_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } }); if (r.ok) load(); else { const e = await r.json(); alert(e.error); } }}
                          style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 'bold' }}>🗑</button>
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
          <div style={{ background: '#081830', border: '1px solid #23395d', borderRadius: 12, padding: 24, width: 400 }}>
            <h3 style={{ color: '#f4ae1f', marginTop: 0 }}>Edit FG-{editFg}</h3>
            {[
              ['Weight (kg)', 'weight_kg', 'number'], ['Fabric Type', 'fabric_type', 'text'],
              ['Color', 'color_name', 'text'], ['Location', 'location', 'text'], ['Notes', 'notes', 'text']
            ].map(([label, key, type]) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label style={{ color: '#7da2d6', fontSize: 11, display: 'block', marginBottom: 3 }}>{label}</label>
                <input type={type} value={editForm[key]||''} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}
                  style={{ width: '100%', background: '#0a1828', border: '1px solid #1e3a5f', borderRadius: 5, padding: '7px 10px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={saveEditFg} style={{ background: '#10b981', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>Save</button>
              <button onClick={() => setEditFg(null)} style={{ background: 'transparent', border: '1px solid #455a7c', color: '#9ca3af', padding: '8px 20px', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const KPI = ({ label, value, color, small }) => (
  <div style={{ background: '#0d1b2f', border: '1px solid #16345d', borderRadius: '10px', padding: small ? '12px 14px' : '16px 18px' }}>
    <div style={{ fontSize: '11px', color: '#7da2d6', letterSpacing: 1, marginBottom: '4px' }}>{label}</div>
    <div style={{ fontSize: small ? '13px' : '26px', fontWeight: 'bold', color }}>{value}</div>
  </div>
);

const th = { padding: '12px 14px', borderBottom: '1px solid #16345d', textAlign: 'left', color: '#7da2d6', fontSize: '11px', letterSpacing: 1 };
const td = { padding: '11px 14px' };
