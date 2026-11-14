import React, { useEffect, useState } from 'react';
import { printBatchLabels } from '../utils/printLabel';
import QRScanner from '../components/QRScanner';

const API = '';
const token = () => localStorage.getItem('dhown_token');

const STATUS_COLOR = { OPEN: 'var(--green)', SEALED: 'var(--gold-2)', SENT: 'var(--gold)', RECEIVED: 'var(--link)', CLOSED: 'var(--muted)' };

export default function GreigeWarehouse() {
  const [tab, setTab] = useState('rolls'); // 'rolls' | 'lots'

  // --- Rolls state ---
  const [rolls,    setRolls]    = useState([]);
  const [summary,  setSummary]  = useState({ by_fabric: [], totals: {} });
  const [selected, setSelected] = useState(new Set());
  const [filter,   setFilter]   = useState({ fabric_type: '' });
  const [msg,      setMsg]      = useState('');
  const [msgErr,   setMsgErr]   = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [lotForm,  setLotForm]  = useState({ notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // --- Lots state ---
  const [lots,       setLots]       = useState([]);
  const [lotsLoading,setLotsLoading]= useState(true);
  const [detail,     setDetail]     = useState(null);
  const [lotFilter,  setLotFilter]  = useState('');

  const loadRolls = async () => {
    const p = new URLSearchParams();
    if (filter.fabric_type) p.set('fabric_type', filter.fabric_type);
    const [r, s] = await Promise.all([
      fetch(`${API}/api/greige?${p}`).then(r => r.json()),
      fetch(`${API}/api/greige/summary`).then(r => r.json()),
    ]);
    setRolls(Array.isArray(r) ? r : []);
    setSummary(s);
    setLoading(false);
  };

  const loadLots = async () => {
    const r = await fetch(`${API}/api/batches`).then(r => r.json());
    setLots(Array.isArray(r) ? r : []);
    setLotsLoading(false);
  };

  const loadDetail = async (id) => {
    const r = await fetch(`${API}/api/batches/${id}`).then(r => r.json());
    setDetail(r);
  };

  useEffect(() => { loadRolls(); loadLots(); }, []);
  useEffect(() => { if (tab === 'rolls') loadRolls(); }, [filter]);

  const flash = (m, err = false) => { setMsg(m); setMsgErr(err); setTimeout(() => setMsg(''), 4000); };

  // --- Rolls logic ---
  const toggleSelect = (id) => {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const selectAll = () => {
    setSelected(selected.size === rolls.length ? new Set() : new Set(rolls.map(r => r.roll_id)));
  };
  const selectedRolls = rolls.filter(r => selected.has(r.roll_id));
  // Multi-fabric lots supported: body + rib + collar/cuffs from same yarn dyed together so shades match
  const fabricBreakdown = Object.entries(
    selectedRolls.reduce((acc, r) => {
      const f = r.fabric_type || 'Unknown';
      if (!acc[f]) acc[f] = { rolls: 0, kg: 0 };
      acc[f].rolls += 1;
      acc[f].kg += parseFloat(r.actual_weight_kg || 0);
      return acc;
    }, {})
  ).sort((a, b) => b[1].kg - a[1].kg);
  const totalSelectedKg = selectedRolls.reduce((s, r) => s + parseFloat(r.actual_weight_kg || 0), 0);
  const fabricTypes = [...new Set(rolls.map(r => r.fabric_type).filter(Boolean))];

  // Scan a roll label → select it for the lot. Validates against loaded greige stock.
  const scanSelectRoll = async (rollId) => {
    const roll = rolls.find(r => r.roll_id === rollId);
    if (!roll) return { ok: false, note: 'not in greige stock' };
    let note = 'selected';
    setSelected(s => {
      if (s.has(rollId)) { note = 'already selected'; return s; }
      const n = new Set(s); n.add(rollId); return n;
    });
    return { ok: true, note: `${note} · ${parseFloat(roll.actual_weight_kg || 0).toFixed(2)} kg` };
  };

  const createLot = async () => {
    if (!selected.size) { flash('Select at least one roll', true); return; }
    setSaving(true);
    const r = await fetch(`${API}/api/batches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ notes: lotForm.notes || null, roll_ids: [...selected] }),
    });
    const d = await r.json();
    setSaving(false);
    if (!r.ok) { flash(d.error, true); return; }
    flash(`Lot ${d.batch_number} created with ${d.rolls_added} roll(s) — ${totalSelectedKg.toFixed(2)} kg`);
    setSelected(new Set()); setLotForm({ notes: '' }); setShowForm(false);
    loadRolls(); loadLots();
  };

  // --- Lots logic ---
  const sealLot = async (id) => {
    if (!window.confirm('Seal this lot? No more rolls can be added after sealing.')) return;
    const r = await fetch(`${API}/api/batches/${id}/seal`, { method: 'PUT', headers: { Authorization: `Bearer ${token()}` } });
    const d = await r.json();
    if (!r.ok) { flash(d.error, true); return; }
    flash('Lot sealed — ready to send for subcontracting');
    loadLots();
    if (detail?.batch_id === id) loadDetail(id);
  };

  const deleteLot = async (id, batchNumber) => {
    if (!window.confirm(`Delete lot ${batchNumber}? Rolls will return to greige stock.`)) return;
    const r = await fetch(`${API}/api/batches/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
    const d = await r.json();
    if (!r.ok) { flash(d.error, true); return; }
    flash(d.message || 'Lot deleted');
    if (detail?.batch_id === id) setDetail(null);
    loadLots(); loadRolls();
  };

  const removeRoll = async (lotId, rollId) => {
    const r = await fetch(`${API}/api/batches/${lotId}/rolls/${rollId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
    if (!r.ok) { flash('Failed to remove roll', true); return; }
    flash('Roll removed from lot');
    loadDetail(lotId); loadLots(); loadRolls();
  };

  const filteredLots = lotFilter ? lots.filter(b => b.status === lotFilter) : lots;

  return (
    <div style={{ padding: '28px', color: 'var(--text)', minHeight: '100vh' }}>
      <h1 style={{ color: 'var(--gold)', fontSize: '36px', margin: '0 0 6px', letterSpacing: 2 }}>GREIGE WAREHOUSE</h1>
      <p style={{ color: 'var(--muted)', margin: '0 0 20px', fontSize: '13px' }}>
        Select rolls → create a lot → seal → send for dyeing / finishing
      </p>

      {msg && (
        <div style={{ background: msgErr ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${msgErr ? 'var(--crit)' : 'var(--green)'}`, color: msgErr ? 'var(--crit)' : 'var(--green)', padding: '10px 16px', borderRadius: '8px', marginBottom: '16px', fontWeight: 'bold' }}>
          {msg}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        {[['rolls', 'Greige Rolls'], ['lots', `Lots (${lots.length})`]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '10px 24px', border: 'none', borderBottom: tab === key ? '2px solid var(--gold)' : '2px solid transparent', background: 'transparent', color: tab === key ? 'var(--gold)' : 'var(--muted)', cursor: 'pointer', fontWeight: tab === key ? 'bold' : 400, fontSize: 14 }}>
            {label}
          </button>
        ))}
      </div>

      {/* ============ GREIGE ROLLS TAB ============ */}
      {tab === 'rolls' && (<>
        {/* Summary KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          <KPI label="TOTAL ROLLS" value={summary.totals?.roll_count ?? 0} color="var(--link)" />
          <KPI label="TOTAL KG" value={`${parseFloat(summary.totals?.total_kg ?? 0).toFixed(2)} kg`} color="var(--green)" />
          {summary.by_fabric?.map(f => (
            <KPI key={f.fabric_type} label={f.fabric_type}
              value={`${f.roll_count} rolls / ${parseFloat(f.total_kg).toFixed(2)} kg`} color="var(--yellow)" small />
          ))}
        </div>

        {/* Filter + selection bar */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div>
            <label style={labelSt}>Fabric Type</label>
            <select style={inputSt} value={filter.fabric_type} onChange={e => setFilter(f => ({ ...f, fabric_type: e.target.value }))}>
              <option value="">All</option>
              {fabricTypes.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <button onClick={() => setShowScanner(true)}
            style={{ background: 'var(--surface)', color: 'var(--link)', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            📷 Scan Rolls
          </button>
          {selected.size > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ color: 'var(--gold)', fontWeight: 'bold', fontSize: '13px' }}>
                {selected.size} roll{selected.size !== 1 ? 's' : ''} selected · {totalSelectedKg.toFixed(2)} kg
              </span>
              <button onClick={() => setShowForm(v => !v)} style={goldBtn}>
                {showForm ? 'Hide Form' : `Create Lot (${selected.size} Rolls)`}
              </button>
              <button onClick={() => { setSelected(new Set()); setShowForm(false); }} style={secBtn}>Clear</button>
            </div>
          )}
        </div>

        {/* Create Lot form */}
        {showForm && selected.size > 0 && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div>
                <h3 style={{ color: 'var(--gold)', margin: '0 0 4px', fontSize: '16px' }}>Create New Lot</h3>
                <div style={{ color: 'var(--muted)', fontSize: '12px' }}>
                  Lot number will be auto-assigned · {selected.size} roll{selected.size !== 1 ? 's' : ''} · {totalSelectedKg.toFixed(3)} kg
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {fabricBreakdown.map(([fabric, v]) => (
                    <span key={fabric} style={{ background: 'var(--green-dim)', border: '1px solid var(--green)', color: 'var(--green-edge)', borderRadius: 5, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
                      {fabric}: {v.kg.toFixed(2)} kg ({v.rolls} roll{v.rolls !== 1 ? 's' : ''})
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ marginBottom: '16px', maxWidth: 400 }}>
              <label style={labelSt}>Notes (optional)</label>
              <input style={inputSt} placeholder="e.g. For Navy Blue dyeing order" value={lotForm.notes}
                onChange={e => setLotForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div style={{ background: 'var(--bg)', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', maxHeight: '180px', overflowY: 'auto' }}>
              <div style={{ fontSize: '11px', color: 'var(--border)', letterSpacing: 1, marginBottom: '8px', fontWeight: 'bold' }}>ROLLS TO BE ADDED</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {selectedRolls.map(r => (
                  <span key={r.roll_id} style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '5px', padding: '3px 9px', fontSize: '12px' }}>
                    <span style={{ color: 'var(--gold)', fontWeight: 'bold' }}>#{r.roll_id}</span>
                    <span style={{ color: 'var(--muted)', marginLeft: 4 }}>{parseFloat(r.actual_weight_kg).toFixed(2)} kg</span>
                  </span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={createLot} disabled={saving} style={{ ...goldBtn, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Creating...' : `Create Lot with ${selected.size} Roll${selected.size !== 1 ? 's' : ''}`}
              </button>
              <button onClick={() => setShowForm(false)} style={secBtn}>Cancel</button>
            </div>
          </div>
        )}

        {/* Rolls table */}
        <div style={{ overflowX: 'auto', background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '10px' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>Loading rolls...</div>
          ) : rolls.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
              No greige stock. Approve rolls in Roll Management or add via Opening Balances.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>
                    <input type="checkbox" checked={selected.size === rolls.length && rolls.length > 0} onChange={selectAll} style={{ cursor: 'pointer' }} />
                  </th>
                  {['Roll ID', 'Machine', 'Fabric', 'Weight (kg)', 'Shift', 'Date'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rolls.map(r => (
                  <tr key={r.roll_id} onClick={() => toggleSelect(r.roll_id)}
                    style={{ cursor: 'pointer', background: selected.has(r.roll_id) ? 'rgba(201,162,39,0.07)' : 'transparent', borderBottom: '1px solid var(--surface)' }}>
                    <td style={td}>
                      <input type="checkbox" checked={selected.has(r.roll_id)} onChange={() => toggleSelect(r.roll_id)} onClick={e => e.stopPropagation()} />
                    </td>
                    <td style={td}>
                      <span style={{ color: 'var(--gold)', fontWeight: 'bold' }}>{r.roll_id}</span>
                      {r.qr_image && (
                        <img src={r.qr_image} alt="QR" style={{ width: 24, height: 24, marginLeft: 6, verticalAlign: 'middle', cursor: 'pointer' }}
                          onClick={e => { e.stopPropagation(); const w = window.open(); w.document.write(`<img src="${r.qr_image}" style="width:260px"/><p style="font-family:monospace;font-size:16px">${r.roll_id}</p>`); }} />
                      )}
                    </td>
                    <td style={td}>{r.machine_id ? `${r.machine_id} ${r.machine_name ? '— ' + r.machine_name : ''}` : '—'}</td>
                    <td style={td}>{r.fabric_type || '—'}</td>
                    <td style={td}><strong style={{ color: 'var(--green)' }}>{r.actual_weight_kg} kg</strong></td>
                    <td style={td}>{r.shift === 'D' ? 'Day' : r.shift === 'N' ? 'Night' : r.shift || '—'}</td>
                    <td style={td}>{r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB').split('/').join('-') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Floating selection bar */}
        {selected.size > 0 && !showForm && (
          <div style={{ position: 'fixed', bottom: 24, right: 24, background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: '10px', padding: '14px 20px', display: 'flex', gap: '14px', alignItems: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}>
            <div>
              <div style={{ color: 'var(--gold)', fontWeight: 'bold', fontSize: '15px' }}>{selected.size} rolls selected</div>
              <div style={{ color: 'var(--muted)', fontSize: '12px' }}>{totalSelectedKg.toFixed(2)} kg total</div>
            </div>
            <button onClick={() => setShowForm(true)} style={goldBtn}>Create Lot</button>
            <button onClick={() => setSelected(new Set())} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '18px' }}>✕</button>
          </div>
        )}
      </>)}

      {/* ============ LOTS TAB ============ */}
      {tab === 'lots' && (<>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
          {['', 'OPEN', 'SEALED', 'SENT', 'RECEIVED'].map(s => (
            <button key={s} onClick={() => setLotFilter(s)}
              style={{ background: lotFilter === s ? 'var(--gold)' : 'var(--surface)', color: lotFilter === s ? '#000' : 'var(--muted)', border: '1px solid var(--surface-2)', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
              {s || 'All'}
            </button>
          ))}
          <span style={{ color: 'var(--muted)', fontSize: '13px', alignSelf: 'center', marginLeft: 'auto' }}>
            {filteredLots.length} lot{filteredLots.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: detail ? '1fr 1fr' : '1fr', gap: '20px' }}>
          {/* Lot list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {lotsLoading ? (
              <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px' }}>Loading...</div>
            ) : filteredLots.length === 0 ? (
              <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px' }}>
                No lots. Select rolls in the Greige Rolls tab and create a lot.
              </div>
            ) : filteredLots.map(b => (
              <div key={b.batch_id}
                onClick={() => loadDetail(b.batch_id)}
                style={{
                  background: detail?.batch_id === b.batch_id ? 'var(--surface)' : 'var(--surface)',
                  border: `1px solid ${detail?.batch_id === b.batch_id ? 'var(--gold)' : 'var(--surface-2)'}`,
                  borderRadius: '10px', padding: '16px', cursor: 'pointer',
                }}
                onMouseEnter={e => { if (detail?.batch_id !== b.batch_id) e.currentTarget.style.borderColor = 'var(--border)'; }}
                onMouseLeave={e => { if (detail?.batch_id !== b.batch_id) e.currentTarget.style.borderColor = 'var(--surface-2)'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ color: 'var(--gold)', fontWeight: 'bold', fontSize: '15px' }}>{b.batch_number}</div>
                    {Array.isArray(b.fabric_breakdown) && b.fabric_breakdown.length > 0 ? (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                        {b.fabric_breakdown.map(f => (
                          <span key={f.fabric_type} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>
                            {f.fabric_type} · {parseFloat(f.kg).toFixed(1)} kg
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '3px' }}>{b.fabric_type}</div>
                    )}
                  </div>
                  <span style={{ background: `${STATUS_COLOR[b.status]}22`, color: STATUS_COLOR[b.status], padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
                    {b.status}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '20px', marginTop: '12px' }}>
                  <Stat label="Rolls" value={b.roll_count || 0} />
                  <Stat label="Weight" value={`${parseFloat(b.total_weight_kg || 0).toFixed(2)} kg`} />
                  <Stat label="Created" value={new Date(b.created_at).toLocaleDateString('en-GB').split('/').join('-')} />
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  {b.status === 'OPEN' && (
                    <button onClick={e => { e.stopPropagation(); sealLot(b.batch_id); }}
                      style={{ background: 'var(--gold-2)', color: '#000', border: 'none', padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                      Seal Lot
                    </button>
                  )}
                  {(b.status === 'OPEN' || b.status === 'SEALED') && (
                    <button onClick={e => { e.stopPropagation(); deleteLot(b.batch_id, b.batch_number); }}
                      style={{ background: 'var(--crit)', color: 'var(--text)', border: 'none', padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          {detail && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: '12px', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <div style={{ color: 'var(--gold)', fontWeight: 'bold', fontSize: '16px' }}>{detail.batch_number}</div>
                  <div style={{ color: 'var(--muted)', fontSize: '12px' }}>{detail.fabric_type}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={() => printBatchLabels({ ...detail, roll_count: detail.rolls?.length || 0, total_weight_kg: (detail.rolls || []).reduce((s, r) => s + parseFloat(r.actual_weight_kg || 0), 0) })}
                    style={{ background: 'var(--link)', border: 'none', padding: '6px 12px', color: 'white', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }}>🏷 Batch Labels</button>
                  <button onClick={() => setDetail(null)} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '18px' }}>✕</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                <Stat label="Rolls" value={detail.rolls?.length || 0} />
                <Stat label="Total KG" value={`${(detail.rolls || []).reduce((s, r) => s + parseFloat(r.actual_weight_kg || 0), 0).toFixed(3)} kg`} />
              </div>

              {Array.isArray(detail.fabric_breakdown) && detail.fabric_breakdown.length > 0 && (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--border)', letterSpacing: 1, marginBottom: '6px', fontWeight: 'bold' }}>FABRIC BREAKDOWN</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {detail.fabric_breakdown.map(f => (
                      <span key={f.fabric_type} style={{ background: 'var(--green-dim)', border: '1px solid #22c55e55', color: 'var(--green-edge)', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
                        {f.fabric_type}: {parseFloat(f.kg).toFixed(2)} kg · {f.rolls} roll{parseInt(f.rolls) !== 1 ? 's' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.notes && (
                <div style={{ background: 'var(--surface)', borderRadius: 6, padding: '8px 12px', marginBottom: 14, fontSize: 12, color: 'var(--muted)' }}>
                  <strong style={{ color: 'var(--muted)' }}>Notes:</strong> {detail.notes}
                </div>
              )}

              <div style={{ fontSize: '12px', color: 'var(--muted)', letterSpacing: 1, marginBottom: '8px', fontWeight: 'bold' }}>ROLLS IN LOT</div>
              <div style={{ maxHeight: '380px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(detail.rolls || []).length === 0 ? (
                  <div style={{ color: 'var(--border)', padding: '20px', textAlign: 'center' }}>No rolls in this lot.</div>
                ) : (detail.rolls || []).map(r => (
                  <div key={r.roll_id} style={{ background: 'var(--surface)', borderRadius: '6px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ color: 'var(--gold)', fontWeight: 'bold', fontSize: '13px' }}>#{r.roll_id}</span>
                      <span style={{ color: 'var(--muted)', fontSize: '12px', marginLeft: '10px' }}>{r.machine_id || 'Opening'} · {r.fabric_type || '—'} · {parseFloat(r.actual_weight_kg).toFixed(3)} kg</span>
                    </div>
                    {detail.status === 'OPEN' && (
                      <button onClick={() => removeRoll(detail.batch_id, r.roll_id)}
                        style={{ background: 'transparent', border: '1px solid var(--crit)', color: 'var(--crit)', padding: '3px 10px', borderRadius: '5px', cursor: 'pointer', fontSize: '11px' }}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </>)}
      {showScanner && (
        <QRScanner
          title="Scan Rolls into Lot"
          hint="Scan each roll's label — it gets selected for the lot. Press Done, then Create Lot."
          onScan={scanSelectRoll}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}

const Stat = ({ label, value }) => (
  <div>
    <div style={{ color: 'var(--border)', fontSize: '10px', letterSpacing: 1, marginBottom: '2px' }}>{label}</div>
    <div style={{ color: 'var(--text)', fontSize: '14px', fontWeight: 'bold' }}>{value}</div>
  </div>
);

const KPI = ({ label, value, color, small }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: '10px', padding: small ? '12px 14px' : '16px 18px' }}>
    <div style={{ fontSize: '11px', color: 'var(--muted)', letterSpacing: 1, marginBottom: '4px' }}>{label}</div>
    <div style={{ fontSize: small ? '14px' : '26px', fontWeight: 'bold', color }}>{value}</div>
  </div>
);

const goldBtn = { background: 'var(--gold)', color: '#000', border: 'none', padding: '9px 18px', borderRadius: '7px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' };
const secBtn  = { background: 'transparent', color: 'var(--gold)', border: '1px solid var(--gold)', padding: '9px 18px', borderRadius: '7px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' };
const labelSt = { display: 'block', color: 'var(--muted)', fontSize: '11px', fontWeight: 'bold', letterSpacing: 1, marginBottom: '4px' };
const inputSt = { background: 'var(--bg)', border: '1px solid var(--surface)', color: 'var(--text)', padding: '8px 10px', borderRadius: '6px', fontSize: '13px', width: '100%', boxSizing: 'border-box' };
const th = { padding: '12px 14px', borderBottom: '1px solid var(--surface)', textAlign: 'left', color: 'var(--muted)', fontSize: '11px', letterSpacing: 1 };
const td = { padding: '11px 14px' };
