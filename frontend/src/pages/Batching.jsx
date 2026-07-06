import React, { useEffect, useState } from 'react';

const API = 'http://localhost:4000';
const token = () => localStorage.getItem('dhown_token');

const STATUS_COLOR = { OPEN: '#22c55e', SEALED: '#fbbf24', SENT: '#f59e0b', RECEIVED: '#60a5fa', CLOSED: '#9ca3af' };

export default function Batching() {
  const [lots,    setLots]    = useState([]);
  const [detail,  setDetail]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg,     setMsg]     = useState('');
  const [msgErr,  setMsgErr]  = useState(false);
  const [filter,  setFilter]  = useState('');

  const load = async () => {
    const r = await fetch(`${API}/api/batches`).then(r => r.json());
    setLots(Array.isArray(r) ? r : []);
    setLoading(false);
  };

  const loadDetail = async (id) => {
    const r = await fetch(`${API}/api/batches/${id}`).then(r => r.json());
    setDetail(r);
  };

  useEffect(() => { load(); }, []);

  const flash = (m, err = false) => { setMsg(m); setMsgErr(err); setTimeout(() => setMsg(''), 3500); };

  const sealLot = async (id) => {
    if (!window.confirm('Seal this lot? No more rolls can be added after sealing.')) return;
    const r = await fetch(`${API}/api/batches/${id}/seal`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token()}` },
    });
    const d = await r.json();
    if (!r.ok) { flash(d.error, true); return; }
    flash('Lot sealed — ready to send for subcontracting');
    load();
    if (detail?.batch_id === id) loadDetail(id);
  };

  const removeRoll = async (lotId, rollId) => {
    const r = await fetch(`${API}/api/batches/${lotId}/rolls/${rollId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!r.ok) { flash('Failed to remove roll', true); return; }
    flash('Roll removed from lot');
    loadDetail(lotId);
    load();
  };

  const filtered = filter ? lots.filter(b => b.status === filter) : lots;

  return (
    <div style={{ padding: '28px', color: '#fff', minHeight: '100vh' }}>
      <h1 style={{ color: '#FFD700', fontSize: '36px', margin: '0 0 6px', letterSpacing: 2 }}>BATCHING</h1>
      <p style={{ color: '#7da2d6', margin: '0 0 24px', fontSize: '13px' }}>
        Group greige rolls into lots → seal → send for dyeing/finishing
      </p>

      {msg && (
        <div style={{ background: msgErr ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${msgErr ? '#ef4444' : '#22c55e'}`, color: msgErr ? '#ef4444' : '#22c55e', padding: '10px 16px', borderRadius: '8px', marginBottom: '16px', fontWeight: 'bold' }}>
          {msg}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', flexWrap: 'wrap' }}>
        {['', 'OPEN', 'SEALED', 'SENT', 'RECEIVED'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ background: filter === s ? '#FFD700' : '#0d1b2f', color: filter === s ? '#000' : '#7da2d6', border: '1px solid #23395d', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            {s || 'All'}
          </button>
        ))}
        <span style={{ color: '#7da2d6', fontSize: '13px', alignSelf: 'center', marginLeft: 'auto' }}>
          {filtered.length} lot{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: detail ? '1fr 1fr' : '1fr', gap: '20px' }}>
        {/* Lot list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {loading ? (
            <div style={{ color: '#7da2d6', textAlign: 'center', padding: '40px' }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: '#7da2d6', textAlign: 'center', padding: '40px' }}>
              No lots. Create one from Greige Warehouse page.
            </div>
          ) : filtered.map(b => (
            <div key={b.batch_id}
              onClick={() => loadDetail(b.batch_id)}
              style={{
                background: detail?.batch_id === b.batch_id ? '#0a2040' : '#081830',
                border: `1px solid ${detail?.batch_id === b.batch_id ? '#FFD700' : '#23395d'}`,
                borderRadius: '10px', padding: '16px', cursor: 'pointer',
              }}
              onMouseEnter={e => { if (detail?.batch_id !== b.batch_id) e.currentTarget.style.borderColor = '#344a6c'; }}
              onMouseLeave={e => { if (detail?.batch_id !== b.batch_id) e.currentTarget.style.borderColor = '#23395d'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '15px' }}>{b.batch_number}</div>
                  <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '3px' }}>
                    {b.fabric_type} {b.color_name ? `• ${b.color_name}` : ''}
                  </div>
                </div>
                <span style={{ background: `${STATUS_COLOR[b.status]}22`, color: STATUS_COLOR[b.status], padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
                  {b.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '20px', marginTop: '12px' }}>
                <Stat label="Rolls"   value={b.roll_count || 0} />
                <Stat label="Weight"  value={`${parseFloat(b.total_weight_kg || 0).toFixed(2)} kg`} />
                <Stat label="Created" value={new Date(b.created_at).toLocaleDateString('en-IN')} />
              </div>
              {b.status === 'OPEN' && (
                <button
                  onClick={e => { e.stopPropagation(); sealLot(b.batch_id); }}
                  style={{ marginTop: '12px', background: '#fbbf24', color: '#000', border: 'none', padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                  Seal Lot
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Detail panel */}
        {detail && (
          <div style={{ background: '#081830', border: '1px solid #23395d', borderRadius: '12px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '16px' }}>{detail.batch_number}</div>
                <div style={{ color: '#7da2d6', fontSize: '12px' }}>{detail.fabric_type} {detail.color_name ? `• ${detail.color_name}` : ''}</div>
              </div>
              <button onClick={() => setDetail(null)} style={{ background: 'transparent', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              <Stat label="Rolls"    value={detail.rolls?.length || 0} />
              <Stat label="Total KG" value={`${(detail.rolls || []).reduce((s, r) => s + parseFloat(r.actual_weight_kg || 0), 0).toFixed(3)} kg`} />
            </div>

            <div style={{ fontSize: '12px', color: '#7da2d6', letterSpacing: 1, marginBottom: '8px', fontWeight: 'bold' }}>ROLLS IN LOT</div>
            <div style={{ maxHeight: '380px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {(detail.rolls || []).length === 0 ? (
                <div style={{ color: '#455a7c', padding: '20px', textAlign: 'center' }}>No rolls yet. Add from Greige Warehouse.</div>
              ) : (detail.rolls || []).map(r => (
                <div key={r.roll_id} style={{ background: '#0d1b2f', borderRadius: '6px', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '13px' }}>#{r.roll_id}</span>
                    <span style={{ color: '#9ca3af', fontSize: '12px', marginLeft: '10px' }}>{r.machine_id} • {parseFloat(r.actual_weight_kg).toFixed(3)} kg</span>
                  </div>
                  {detail.status === 'OPEN' && (
                    <button onClick={() => removeRoll(detail.batch_id, r.roll_id)}
                      style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '3px 10px', borderRadius: '5px', cursor: 'pointer', fontSize: '11px' }}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const Stat = ({ label, value }) => (
  <div>
    <div style={{ color: '#455a7c', fontSize: '10px', letterSpacing: 1, marginBottom: '2px' }}>{label}</div>
    <div style={{ color: '#fff', fontSize: '14px', fontWeight: 'bold' }}>{value}</div>
  </div>
);
