import React, { useEffect, useState } from 'react';
import PrintChallan from '../components/PrintChallan';

const API = 'http://localhost:4000';
const token = () => localStorage.getItem('dhown_token');
const h = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const cell = { padding: '6px 8px', border: '1px solid #16294a', fontSize: 12 };
const fieldInp = { width: '100%', background: '#0a1828', border: '1px solid #1e3a5f', borderRadius: 4, padding: '5px 8px', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' };

const emptyForm = () => ({ customer_name: '', customer_contact: '', vehicle_number: '', dispatch_date: today(), notes: '' });

const TYPE_CONFIG = {
  FG:     { label: 'Finished Goods', color: '#22c55e', desc: 'Dispatch finished goods lots to customer' },
  GREIGE: { label: 'Greige Rolls',   color: '#f59e0b', desc: 'Direct sale of greige / grey fabric rolls' },
  YARN:   { label: 'Yarn Lots',      color: '#a78bfa', desc: 'Direct sale of yarn lots from yarn store' },
};
const TYPE_BADGE = { FG: '#22c55e', GREIGE: '#f59e0b', YARN: '#a78bfa' };

export default function Dispatch() {
  const [dispatches,    setDispatches]    = useState([]);
  const [stock,         setStock]         = useState([]);
  const [detail,        setDetail]        = useState(null);
  const [mode,          setMode]          = useState('view'); // 'view' | 'new'
  const [dispatchType,  setDispatchType]  = useState('FG');
  const [form,          setForm]          = useState(emptyForm());
  const [selectedItems, setSelectedItems] = useState([]);
  const [msg,           setMsg]           = useState('');
  const [msgErr,        setMsgErr]        = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [printing,      setPrinting]      = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [filterType,    setFilterType]    = useState('ALL');

  const load = async () => {
    setLoading(true);
    try { const d = await fetch(`${API}/api/dispatch`).then(r => r.json()); setDispatches(Array.isArray(d) ? d : []); } catch {}
    setLoading(false);
  };
  const loadStock = async (type) => {
    setStock([]);
    try {
      if (type === 'FG') { const r = await fetch(`${API}/api/finished-goods?status=IN_STOCK`).then(r => r.json()); setStock(Array.isArray(r) ? r : []); }
      else if (type === 'GREIGE') { const r = await fetch(`${API}/api/greige`).then(r => r.json()); setStock(Array.isArray(r) ? r : []); }
      else if (type === 'YARN') { const r = await fetch(`${API}/api/yarn-store?status=IN_STORE`).then(r => r.json()); setStock(Array.isArray(r) ? r : []); }
    } catch {}
  };
  const loadDetail = async (id) => { const r = await fetch(`${API}/api/dispatch/${id}`).then(r => r.json()); setDetail(r); setMode('view'); };

  useEffect(() => { load(); }, []);

  const filteredDispatches = filterType === 'ALL' ? dispatches : dispatches.filter(d => (d.dispatch_type || 'FG') === filterType);

  useEffect(() => {
    if (mode === 'view' && !detail && filteredDispatches.length > 0) loadDetail(filteredDispatches[0].dispatch_id);
  }, [dispatches, filterType]); // eslint-disable-line

  const docIdx = filteredDispatches.findIndex(d => d.dispatch_id === detail?.dispatch_id);
  const navTo = (i) => { if (i >= 0 && i < filteredDispatches.length) loadDetail(filteredDispatches[i].dispatch_id); };

  const flash = (m, err = false) => { setMsg(m); setMsgErr(err); setTimeout(() => setMsg(''), 3500); };

  const startNew = () => { setMode('new'); setDetail(null); setDispatchType('FG'); setForm(emptyForm()); setSelectedItems([]); loadStock('FG'); };
  const cancelEntry = () => { setMode('view'); setSelectedItems([]); setForm(emptyForm()); if (filteredDispatches.length) loadDetail(filteredDispatches[0].dispatch_id); };
  const switchType = (t) => { setDispatchType(t); setSelectedItems([]); loadStock(t); };

  const itemId = (item) => item.fg_id || item.roll_id || item.lot_id;
  const toggleItem = (item) => {
    const id = itemId(item);
    setSelectedItems(prev => {
      const exists = prev.find(i => itemId(i) === id);
      if (exists) return prev.filter(i => itemId(i) !== id);
      if (dispatchType === 'FG') return [...prev, { fg_id: item.fg_id, weight_kg: parseFloat(item.weight_kg || 0).toFixed(3), fabric_type: item.fabric_type, color_name: item.color_name, batch_number: item.batch_number }];
      if (dispatchType === 'GREIGE') return [...prev, { roll_id: item.roll_id, weight_kg: parseFloat(item.actual_weight_kg || 0).toFixed(3), fabric_type: item.fabric_type, color: item.color }];
      if (dispatchType === 'YARN') return [...prev, { lot_id: item.lot_id, weight_kg: parseFloat(item.current_stock_kg || 0).toFixed(3), lot_number: item.lot_number, yarn_type: item.yarn_type, color: item.color }];
    });
  };
  const updateWeight = (id, w) => setSelectedItems(prev => prev.map(i => itemId(i) === id ? { ...i, weight_kg: w } : i));
  const updateItemField = (id, field, val) => setSelectedItems(prev => prev.map(i => itemId(i) === id ? { ...i, [field]: val } : i));

  const totalSelected = selectedItems.reduce((s, i) => s + parseFloat(i.weight_kg || 0), 0);
  const lineTaxable = (i) => { const rate = parseFloat(i.rate_per_kg || 0); return rate > 0 ? parseFloat(i.weight_kg || 0) * rate : 0; };
  const lineGst = (i) => { const rate = parseFloat(i.rate_per_kg || 0); if (rate <= 0) return 0; const gst = i.gst_rate === '' || i.gst_rate === undefined ? 5 : parseFloat(i.gst_rate || 0); return lineTaxable(i) * gst / 100; };
  const totalTaxable = selectedItems.reduce((s, i) => s + lineTaxable(i), 0);
  const totalGst = selectedItems.reduce((s, i) => s + lineGst(i), 0);
  const hasPricing = selectedItems.some(i => parseFloat(i.rate_per_kg || 0) > 0);

  const createDispatch = async () => {
    if (!form.customer_name) { flash('Enter customer name', true); return; }
    if (!selectedItems.length) { flash('Select at least one item', true); return; }
    setSaving(true);
    const r = await fetch(`${API}/api/dispatch`, { method: 'POST', headers: h(), body: JSON.stringify({ ...form, dispatch_type: dispatchType, items: selectedItems }) });
    const d = await r.json();
    setSaving(false);
    if (!r.ok) { flash(d.error, true); return; }
    flash(`Dispatch ${d.dispatch_number} created for ${d.customer_name}`);
    setForm(emptyForm()); setSelectedItems([]);
    await load(); loadDetail(d.dispatch_id || d.id); setMode('view');
  };
  const deleteDispatch = async (id) => {
    if (!window.confirm('Delete this dispatch challan? Stock will be restored.')) return;
    setDeleting(true);
    try { const r = await fetch(`${API}/api/dispatch/${id}`, { method: 'DELETE', headers: h() }); if (!r.ok) { const j = await r.json(); alert(j.error || 'Delete failed'); setDeleting(false); return; } setDetail(null); load(); } catch { alert('Network error'); }
    setDeleting(false);
  };

  const editing = mode === 'new';
  const viewItems = detail?.items || [];
  const show = editing || detail;

  return (
    <>
    <div style={{ padding: '20px', color: '#fff', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>

      <div style={{ marginBottom: 12 }}>
        <h2 style={{ color: '#FFD700', fontSize: 24, margin: 0 }}>Dispatch</h2>
        <p style={{ color: '#7da2d6', margin: '4px 0 0', fontSize: 13 }}>Delivery challans for Finished Goods, Greige Rolls, or Yarn</p>
      </div>

      {msg && <div style={{ background: msgErr ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${msgErr ? '#ef4444' : '#22c55e'}`, color: msgErr ? '#ef4444' : '#22c55e', padding: '10px 16px', borderRadius: 8, marginBottom: 14, fontWeight: 'bold' }}>{msg}</div>}

      {/* Type filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid #16345d', opacity: editing ? 0.5 : 1, pointerEvents: editing ? 'none' : 'auto' }}>
        {['ALL', 'FG', 'GREIGE', 'YARN'].map(t => (
          <button key={t} onClick={() => { setFilterType(t); setDetail(null); }}
            style={{ background: 'transparent', border: 'none', borderBottom: filterType === t ? `2px solid ${TYPE_BADGE[t] || '#FFD700'}` : '2px solid transparent', color: filterType === t ? (TYPE_BADGE[t] || '#FFD700') : '#7da2d6', padding: '8px 18px', cursor: 'pointer', fontWeight: filterType === t ? 700 : 400, fontSize: 13, marginBottom: -1 }}>
            {t === 'ALL' ? 'All' : TYPE_CONFIG[t]?.label}
          </button>
        ))}
      </div>

      {/* Navigator bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, background: '#081830', border: '1px solid #23395d', borderRadius: 10, padding: '10px 14px', flexWrap: 'wrap', opacity: editing ? 0.5 : 1, pointerEvents: editing ? 'none' : 'auto' }}>
        <button onClick={startNew} style={{ background: '#22c55e', color: '#04120a', border: 'none', padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+ Add</button>
        <span style={{ color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Dispatch</span>
        <select value={detail?.dispatch_id || ''} onChange={e => e.target.value && loadDetail(e.target.value)}
          style={{ background: '#0d1b2f', border: '1px solid #23395d', color: '#FFD700', borderRadius: 6, padding: '7px 10px', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, minWidth: 300 }}>
          <option value="">— List View ({filteredDispatches.length}) —</option>
          {filteredDispatches.map(d => <option key={d.dispatch_id} value={d.dispatch_id}>{d.dispatch_number} · {d.customer_name} · {d.dispatch_date?.slice(0, 10)} · {TYPE_CONFIG[d.dispatch_type || 'FG']?.label}</option>)}
        </select>
        {detail && docIdx >= 0 && <span style={{ color: '#64748b', fontSize: 12 }}>{filteredDispatches.length - docIdx} / {filteredDispatches.length}</span>}
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          <button onClick={() => navTo(filteredDispatches.length - 1)} disabled={docIdx < 0 || docIdx >= filteredDispatches.length - 1} style={{ background: '#0d1b2f', border: '1px solid #23395d', color: docIdx >= filteredDispatches.length - 1 ? '#334155' : '#93c5fd', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>⏮ First</button>
          <button onClick={() => navTo(docIdx + 1)} disabled={docIdx < 0 || docIdx >= filteredDispatches.length - 1} style={{ background: '#0d1b2f', border: '1px solid #23395d', color: docIdx >= filteredDispatches.length - 1 ? '#334155' : '#93c5fd', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>◀ Previous</button>
          <button onClick={() => navTo(docIdx - 1)} disabled={docIdx <= 0} style={{ background: '#0d1b2f', border: '1px solid #23395d', color: docIdx <= 0 ? '#334155' : '#93c5fd', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Next ▶</button>
          <button onClick={() => navTo(0)} disabled={!filteredDispatches.length} style={{ background: '#0d1b2f', border: '1px solid #23395d', color: '#fbbf24', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Last ⏭</button>
        </div>
      </div>

      {loading && !show ? <div style={{ color: '#7da2d6', textAlign: 'center', padding: 40 }}>Loading...</div>
        : !show && filteredDispatches.length === 0 ? <div style={{ color: '#7da2d6', textAlign: 'center', padding: 40 }}>No dispatches yet — click + Add to create the first one.</div>
        : !show ? <div style={{ color: '#7da2d6', textAlign: 'center', padding: 40 }}>Select a dispatch from List View, or use ⏭ Last for the latest.</div>
        : null}

      {/* ── Document card ── */}
      {show && (
        <div style={{ background: '#081830', border: `1px solid ${editing ? '#FFD700' : '#23395d'}`, borderRadius: 12, overflow: 'hidden', minHeight: 440, display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: '#122a4a', color: '#FFD700', textAlign: 'center', fontWeight: 500, fontSize: 15, padding: 8, letterSpacing: 1 }}>{editing ? 'New Dispatch Challan' : 'Delivery Challan'}</div>

          {editing ? (<>
            {/* Type picker inline */}
            <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderBottom: '1px solid #23395d' }}>
              {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                <div key={key} onClick={() => switchType(key)} style={{ flex: 1, background: dispatchType === key ? cfg.color + '18' : '#0d1b2f', border: `2px solid ${dispatchType === key ? cfg.color : '#16345d'}`, borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }}>
                  <div style={{ color: dispatchType === key ? cfg.color : '#e2e8f0', fontWeight: 700, fontSize: 14 }}>{cfg.label}</div>
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{cfg.desc}</div>
                </div>
              ))}
            </div>
            {/* Customer fields inline */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid #23395d' }}>
              {[['Customer / Buyer *', 'customer_name'], ['Contact', 'customer_contact'], ['Dispatch Date *', 'dispatch_date'], ['Vehicle No.', 'vehicle_number'], ['Notes', 'notes']].map(([label, key], i) => (
                <div key={key} style={{ padding: '9px 14px', gridColumn: key === 'notes' ? 'span 4' : 'span 1', borderRight: key !== 'notes' && (i + 1) % 4 !== 0 ? '1px solid #16294a' : 'none', borderTop: i >= 4 ? '1px solid #16294a' : 'none' }}>
                  <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3, fontWeight: 700 }}>{label}</div>
                  <input type={key === 'dispatch_date' ? 'date' : 'text'} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} style={fieldInp} placeholder={label} />
                </div>
              ))}
            </div>
            {/* Stock selection */}
            <div style={{ flex: 1, padding: '14px 16px' }}>
              <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>Select {TYPE_CONFIG[dispatchType]?.label} ({stock.length} available)</div>
              {stock.length === 0 ? (
                <div style={{ color: '#455a7c', padding: '20px', textAlign: 'center', background: '#0d1b2f', borderRadius: 8 }}>No {TYPE_CONFIG[dispatchType]?.label?.toLowerCase()} available in stock.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {stock.map(item => {
                    const id = itemId(item);
                    const sel = selectedItems.find(i => itemId(i) === id);
                    const weightField = dispatchType === 'FG' ? item.weight_kg : dispatchType === 'GREIGE' ? item.actual_weight_kg : item.current_stock_kg;
                    let label;
                    if (dispatchType === 'FG') label = <><span style={{ color: '#22c55e', fontWeight: 'bold' }}>FG-{item.fg_id}</span><span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 8 }}>{item.fabric_type} · {item.color_name || 'Undyed'} · Batch: {item.batch_number || '—'}</span></>;
                    else if (dispatchType === 'GREIGE') label = <><span style={{ color: '#f59e0b', fontWeight: 'bold' }}>Roll #{item.roll_id}</span><span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 8 }}>{item.fabric_type} · {item.machine_name || ''}</span></>;
                    else label = <><span style={{ color: '#a78bfa', fontWeight: 'bold' }}>{item.lot_number}</span><span style={{ color: '#9ca3af', fontSize: 12, marginLeft: 8 }}>{item.yarn_type} · {item.color || 'Natural'}</span></>;
                    return (
                      <div key={id} style={{ background: sel ? (TYPE_BADGE[dispatchType] || '#FFD700') + '12' : '#0d1b2f', border: `1px solid ${sel ? (TYPE_BADGE[dispatchType] || '#FFD700') : '#16345d'}`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => toggleItem(item)}>
                        <input type="checkbox" checked={!!sel} onChange={() => toggleItem(item)} onClick={e => e.stopPropagation()} style={{ cursor: 'pointer', width: 16, height: 16 }} />
                        <div style={{ flex: 1 }}>{label}</div>
                        {sel ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                            <input type="number" step="0.001" value={sel.weight_kg} onChange={e => updateWeight(id, e.target.value)} style={{ background: '#050d1a', border: `1px solid ${TYPE_BADGE[dispatchType] || '#FFD700'}`, color: '#fff', padding: '5px 8px', borderRadius: 5, width: 90, fontSize: 13 }} />
                            <span style={{ color: '#7da2d6', fontSize: 12 }}>kg</span>
                            <input type="number" step="0.01" placeholder="₹/kg" title="Rate per kg (optional)" value={sel.rate_per_kg || ''} onChange={e => updateItemField(id, 'rate_per_kg', e.target.value)} style={{ background: '#050d1a', border: '1px solid #16345d', color: '#f472b6', padding: '5px 8px', borderRadius: 5, width: 74, fontSize: 13 }} />
                            <input type="number" step="0.01" placeholder="GST%" title="GST % (default 5)" value={sel.gst_rate ?? ''} onChange={e => updateItemField(id, 'gst_rate', e.target.value)} style={{ background: '#050d1a', border: '1px solid #16345d', color: '#7da2d6', padding: '5px 8px', borderRadius: 5, width: 60, fontSize: 13 }} />
                            {parseFloat(sel.rate_per_kg || 0) > 0 && <span style={{ color: '#f472b6', fontSize: 12, fontWeight: 700 }}>₹{(lineTaxable(sel) + lineGst(sel)).toFixed(2)}</span>}
                          </div>
                        ) : <span style={{ color: TYPE_BADGE[dispatchType] || '#22c55e', fontWeight: 'bold', fontSize: 13 }}>{parseFloat(weightField || 0).toFixed(3)} kg</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              {selectedItems.length > 0 && (
                <div style={{ marginTop: 12, background: '#0a1f3a', border: '1px solid #344a6c', borderRadius: 8, padding: '10px 16px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  <div><span style={{ color: '#7da2d6', fontSize: 12 }}>SELECTED </span><span style={{ color: '#FFD700', fontWeight: 'bold' }}>{selectedItems.length}</span></div>
                  <div><span style={{ color: '#7da2d6', fontSize: 12 }}>TOTAL WEIGHT </span><span style={{ color: TYPE_BADGE[dispatchType] || '#22c55e', fontWeight: 'bold' }}>{totalSelected.toFixed(3)} kg</span></div>
                  {hasPricing && <>
                    <div><span style={{ color: '#7da2d6', fontSize: 12 }}>TAXABLE </span><span style={{ color: '#f472b6', fontWeight: 'bold' }}>₹{totalTaxable.toFixed(2)}</span></div>
                    <div><span style={{ color: '#7da2d6', fontSize: 12 }}>GST </span><span style={{ color: '#a78bfa', fontWeight: 'bold' }}>₹{totalGst.toFixed(2)}</span></div>
                    <div><span style={{ color: '#7da2d6', fontSize: 12 }}>GRAND TOTAL </span><span style={{ color: '#22c55e', fontWeight: 'bold', fontSize: 15 }}>₹{(totalTaxable + totalGst).toFixed(2)}</span></div>
                  </>}
                </div>
              )}
              <div style={{ marginTop: 8, color: '#455a7c', fontSize: 11 }}>Rate &amp; GST are optional — fill only for sale / job-work. GST defaults to 5% when a rate is entered.</div>
            </div>
          </>) : (<>
            {/* View header grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid #23395d' }}>
              {[
                ['Dispatch No.', detail.dispatch_number, '#FFD700'],
                ['Date', fmtDate(detail.dispatch_date)],
                ['Customer', detail.customer_name],
                ['Type', TYPE_CONFIG[detail.dispatch_type || 'FG']?.label, TYPE_BADGE[detail.dispatch_type || 'FG']],
                ['Contact', detail.customer_contact || '—'],
                ['Vehicle', detail.vehicle_number || '—'],
                ['Total Weight', `${parseFloat(detail.total_weight_kg || 0).toFixed(3)} kg`],
                ['Grand Total', detail.grand_total ? `₹${parseFloat(detail.grand_total).toFixed(2)}` : '—', detail.grand_total ? '#22c55e' : null],
              ].map(([label, val, color], i) => (
                <div key={label} style={{ padding: '9px 14px', borderRight: (i + 1) % 4 !== 0 ? '1px solid #16294a' : 'none', borderTop: i >= 4 ? '1px solid #16294a' : 'none' }}>
                  <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3, fontWeight: 700 }}>{label}</div>
                  <div style={{ color: color || '#e2e8f0', fontSize: 14, fontWeight: 700, fontFamily: label === 'Dispatch No.' ? 'monospace' : 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{val || '—'}</div>
                </div>
              ))}
            </div>
            {/* View items */}
            <div style={{ flex: 1, padding: '14px 16px' }}>
              <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Items Dispatched ({viewItems.length})</span>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginTop: 8 }}>
                <thead>
                  <tr style={{ background: '#0a2040' }}>
                    {[['Sr', 34], ['Item', 110], ['Description', null], ['Weight (kg)', 100], ['Rate', 80], ['Amount', 100]].map(([hh, w]) => (
                      <th key={hh} style={{ width: w || 'auto', padding: '8px 10px', textAlign: (['Weight (kg)', 'Rate', 'Amount'].includes(hh)) ? 'right' : 'left', color: '#7da2d6', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, border: '1px solid #16294a' }}>{hh}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viewItems.map((i, idx) => {
                    const itemLabel = i.item_type === 'YARN' ? (i.lot_number || `LOT-${i.lot_id}`) : i.item_type === 'GREIGE' ? `Roll #${i.roll_id}` : `FG-${i.fg_id}`;
                    const desc = i.item_type === 'YARN' ? `${i.yarn_type || i.yl_yarn_type} · ${i.color || i.yl_color || 'Natural'}` : i.item_type === 'GREIGE' ? `${i.fabric_type || i.roll_fabric} · ${i.machine_name || ''}` : `${i.fabric_type || i.fg_fabric} · ${i.color_name || i.fg_color || 'Undyed'} · Batch ${i.batch_number || '—'}`;
                    return (
                      <tr key={idx} style={{ background: idx % 2 === 1 ? '#0a1830' : 'transparent' }}>
                        <td style={{ ...cell, color: '#64748b' }}>{idx + 1}</td>
                        <td style={{ ...cell, color: '#FFD700', fontWeight: 700 }}>{itemLabel}</td>
                        <td style={{ ...cell, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{desc}</td>
                        <td style={{ ...cell, color: '#e2e8f0', textAlign: 'right', fontWeight: 700 }}>{parseFloat(i.weight_kg || 0).toFixed(3)}</td>
                        <td style={{ ...cell, color: '#94a3b8', textAlign: 'right' }}>{i.rate_per_kg ? parseFloat(i.rate_per_kg).toFixed(2) : '—'}</td>
                        <td style={{ ...cell, color: '#f472b6', textAlign: 'right' }}>{i.line_total ? parseFloat(i.line_total).toFixed(2) : '—'}</td>
                      </tr>
                    );
                  })}
                  {Array.from({ length: Math.max(0, 6 - viewItems.length) }).map((_, i) => (
                    <tr key={`b${i}`} style={{ background: (viewItems.length + i) % 2 === 1 ? '#0a1830' : 'transparent' }}>{Array.from({ length: 6 }).map((__, j) => <td key={j} style={{ ...cell }}>&nbsp;</td>)}</tr>
                  ))}
                  <tr style={{ background: '#0d2040' }}>
                    <td colSpan={3} style={{ ...cell, color: '#7da2d6', fontWeight: 700, textAlign: 'right' }}>TOTAL — {viewItems.length} item(s)</td>
                    <td style={{ ...cell, color: '#FFD700', fontWeight: 700, textAlign: 'right' }}>{parseFloat(detail.total_weight_kg || 0).toFixed(3)}</td>
                    <td style={{ ...cell }}></td>
                    <td style={{ ...cell, color: '#22c55e', fontWeight: 700, textAlign: 'right' }}>{detail.grand_total ? parseFloat(detail.grand_total).toFixed(2) : '—'}</td>
                  </tr>
                </tbody>
              </table>
              {detail.notes && <div style={{ marginTop: 12, color: '#7da2d6', fontSize: 12, background: '#0d1b2a', borderRadius: 6, padding: '8px 12px' }}><span style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase' }}>Notes: </span>{detail.notes}</div>}
            </div>
          </>)}

          {/* Bottom button strip */}
          <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid #23395d', background: '#060f22', flexWrap: 'wrap' }}>
            {editing ? (<>
              <button onClick={createDispatch} disabled={saving || !selectedItems.length} style={{ background: saving || !selectedItems.length ? '#14532d' : '#22c55e', color: '#04120a', border: 'none', padding: '8px 22px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>{saving ? 'Saving...' : `💾 Save Dispatch (${selectedItems.length} · ${totalSelected.toFixed(2)} kg)`}</button>
              <button onClick={cancelEntry} style={{ background: '#0d1b2f', color: '#9ca3af', border: '1px solid #23395d', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>✕ Cancel</button>
            </>) : (<>
              <button onClick={startNew} style={{ background: '#22c55e', color: '#04120a', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>+ Add</button>
              <button onClick={() => deleteDispatch(detail.dispatch_id)} disabled={deleting} style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>{deleting ? '...' : '🗑 Delete'}</button>
              <button onClick={() => setPrinting(true)} style={{ background: '#1e3a5f', color: '#93c5fd', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>🖨 Print</button>
            </>)}
          </div>
        </div>
      )}
    </div>

    {printing && detail && <PrintChallan type="DISPATCH" data={detail} onClose={() => setPrinting(false)} />}
    </>
  );
}
