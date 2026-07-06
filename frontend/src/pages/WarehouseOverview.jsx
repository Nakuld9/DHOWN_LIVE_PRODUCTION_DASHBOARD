import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API = 'http://localhost:4000';

const CARD_LINKS = [
  { key: 'yarn_store',     label: 'YARN STORE',        icon: '🧵', path: '/grn',             color: '#e879f9', subKey: 'lots', subLabel: 'lots', kgKey: 'kg' },
  { key: 'greige',         label: 'GREIGE STOCK',      icon: '🧶', path: '/greige',          color: '#60a5fa', subKey: 'rolls', subLabel: 'rolls', kgKey: 'kg' },
  { key: 'sent_out',       label: 'AT VENDOR',         icon: '🚚', path: '/subcontracting',  color: '#f59e0b', subKey: 'challans', subLabel: 'challans', kgKey: 'kg' },
  { key: 'finished_stock', label: 'FINISHED GOODS',    icon: '✅', path: '/finished-goods',  color: '#22c55e', subKey: 'lots', subLabel: 'lots', kgKey: 'kg' },
  { key: 'dispatched',     label: 'DISPATCHED',        icon: '📤', path: '/dispatch',        color: '#a78bfa', subKey: 'orders', subLabel: 'orders', kgKey: 'kg' },
];

export default function WarehouseOverview() {
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/warehouse/overview`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: '28px', color: '#fff', minHeight: '100vh' }}>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ color: '#FFD700', fontSize: '36px', margin: 0, letterSpacing: 2 }}>WAREHOUSE</h1>
        <p style={{ color: '#7da2d6', margin: '4px 0 0', fontSize: '13px' }}>End-to-end fabric flow — Greige → Dyeing → Finished Goods → Dispatch</p>
      </div>

      {/* Flow cards */}
      {loading ? (
        <div style={{ color: '#7da2d6', textAlign: 'center', padding: '60px' }}>Loading...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
          {CARD_LINKS.map((c, i) => {
            const d = data?.[c.key] || {};
            return (
              <div key={c.key}
                onClick={() => navigate(c.path)}
                style={{
                  background: '#081830', border: `1px solid ${c.color}33`,
                  borderRadius: '12px', padding: '22px', cursor: 'pointer',
                  transition: 'border-color 0.2s, transform 0.1s',
                  position: 'relative',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = c.color; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = `${c.color}33`; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                {/* Arrow connector (not on last) */}
                {i < CARD_LINKS.length - 1 && (
                  <div style={{ position: 'absolute', right: '-14px', top: '50%', transform: 'translateY(-50%)', color: '#344a6c', fontSize: '20px', zIndex: 1 }}>▶</div>
                )}
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>{c.icon}</div>
                <div style={{ color: c.color, fontSize: '11px', fontWeight: 'bold', letterSpacing: 1, marginBottom: '6px' }}>{c.label}</div>
                <div style={{ color: '#fff', fontSize: '28px', fontWeight: 'bold' }}>
                  {d[c.subKey] ?? 0}
                  <span style={{ fontSize: '12px', color: '#7da2d6', marginLeft: '4px' }}>{c.subLabel}</span>
                </div>
                {c.kgKey && (
                  <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '4px' }}>
                    {parseFloat(d[c.kgKey] || 0).toFixed(2)} kg
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Overdue alert */}
      {data?.overdue_challans > 0 && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444',
          borderRadius: '10px', padding: '14px 20px', marginBottom: '24px',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <span style={{ fontSize: '20px' }}>⚠️</span>
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
            {data.overdue_challans} subcontract challan{data.overdue_challans > 1 ? 's' : ''} overdue — vendor has not returned material on time.
          </span>
          <button onClick={() => navigate('/subcontracting')}
            style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', border: 'none', padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
            View
          </button>
        </div>
      )}

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
        {[
          { label: 'View Yarn Stock',         path: '/grn',            icon: '🧵', desc: 'Yarn lots currently in store' },
          { label: 'View Greige Stock',      path: '/greige',         icon: '🧶', desc: 'Approved rolls awaiting batching' },
          { label: 'Subcontract Challans',   path: '/subcontracting', icon: '🚚', desc: 'Send out, track, receive back' },
          { label: 'Finished Goods Stock',   path: '/finished-goods', icon: '✅', desc: 'Dyed fabric ready for dispatch' },
          { label: 'Customer Dispatch',      path: '/dispatch',       icon: '📤', desc: 'Create dispatch challans' },
        ].map(a => (
          <div key={a.path}
            onClick={() => navigate(a.path)}
            style={{
              background: '#0a1f3a', border: '1px solid #23395d', borderRadius: '10px',
              padding: '18px', cursor: 'pointer', display: 'flex', gap: '12px', alignItems: 'flex-start',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#FFD700'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#23395d'}
          >
            <span style={{ fontSize: '24px' }}>{a.icon}</span>
            <div>
              <div style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '13px' }}>{a.label}</div>
              <div style={{ color: '#7da2d6', fontSize: '12px', marginTop: '3px' }}>{a.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
