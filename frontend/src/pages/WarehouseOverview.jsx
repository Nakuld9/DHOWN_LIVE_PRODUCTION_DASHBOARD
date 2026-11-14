import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API = '';

// The fabric flow, stage by stage. Rail colour encodes position in the flow:
// in-store (slate) → at vendor (amber = watch) → finished (green) → out (yellow).
const CARD_LINKS = [
  { key: 'yarn_store',     label: 'Yarn Store',     icon: '🧵', path: '/yarn-store',     rail: 'var(--mnt)',  subKey: 'lots',     subLabel: 'lots',     kgKey: 'kg' },
  { key: 'greige',         label: 'Greige Stock',   icon: '🧶', path: '/greige',         rail: 'var(--mnt)',  subKey: 'rolls',    subLabel: 'rolls',    kgKey: 'kg' },
  { key: 'sent_out',       label: 'At Vendor',      icon: '🚚', path: '/vendor-stock',   rail: 'var(--gold)',     subKey: 'challans', subLabel: 'challans', kgKey: 'kg' },
  { key: 'finished_stock', label: 'Finished Goods', icon: '✅', path: '/finished-goods', rail: 'var(--green)',     subKey: 'lots',     subLabel: 'lots',     kgKey: 'kg' },
  { key: 'dispatched',     label: 'Dispatched',     icon: '📤', path: '/dispatch',       rail: 'var(--yellow)', subKey: 'orders', subLabel: 'orders',   kgKey: 'kg' },
];

const QUICK = [
  { label: 'Yarn Stock', path: '/yarn-store', icon: '🧵', desc: 'Yarn lots currently in store' },
  { label: 'Greige Stock', path: '/greige', icon: '🧶', desc: 'Approved rolls awaiting batching' },
  { label: 'Vendor Stock', path: '/vendor-stock', icon: '🚚', desc: 'Material currently at vendors' },
  { label: 'Finished Goods', path: '/finished-goods', icon: '✅', desc: 'Dyed fabric ready for dispatch' },
  { label: 'Customer Dispatch', path: '/dispatch', icon: '📤', desc: 'Create dispatch challans' },
];

export default function WarehouseOverview() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/warehouse/overview`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 20, color: 'var(--text)', minHeight: '100vh' }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--faint)', letterSpacing: '.16em', textTransform: 'uppercase', marginBottom: 7 }}>Inventory · Fabric Flow</div>
        <h1 style={{ margin: 0, fontFamily: 'var(--mono)', fontWeight: 800, fontSize: 24, letterSpacing: '.02em', textTransform: 'uppercase' }}>Inventory</h1>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 60 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 24 }}>
          {CARD_LINKS.map((c, i) => {
            const d = data?.[c.key] || {};
            return (
              <div key={c.key} onClick={() => navigate(c.path)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '15px 16px', cursor: 'pointer', position: 'relative', overflow: 'hidden', transition: 'border-color .15s, transform .1s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--surface-2)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: c.rail }} />
                {i < CARD_LINKS.length - 1 && (
                  <div style={{ position: 'absolute', right: -13, top: '50%', transform: 'translateY(-50%)', color: 'var(--border)', fontSize: 18, zIndex: 1 }}>▶</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>{c.label}</div>
                  <span style={{ fontSize: 16 }}>{c.icon}</span>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em', marginTop: 8, lineHeight: 1 }}>
                  {d[c.subKey] ?? 0}<span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}> {c.subLabel}</span>
                </div>
                {c.kgKey && <div style={{ color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: 12, marginTop: 5 }}>{parseFloat(d[c.kgKey] || 0).toFixed(1)} kg</div>}
              </div>
            );
          })}
        </div>
      )}

      {data?.overdue_challans > 0 && (
        <div style={{ background: 'var(--crit-dim)', border: '1px solid var(--crit-dim)', borderLeft: '3px solid var(--crit)', borderRadius: 9, padding: '13px 18px', marginBottom: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <span style={{ color: 'var(--crit)', fontWeight: 700, fontSize: 13 }}>
            {data.overdue_challans} subcontract challan{data.overdue_challans > 1 ? 's' : ''} overdue — vendor has not returned material on time.
          </span>
          <button onClick={() => navigate('/subcontracting')}
            style={{ marginLeft: 'auto', background: 'var(--yellow)', color: 'var(--on-gold)', border: 'none', padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>View</button>
        </div>
      )}

      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10 }}>Quick actions</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {QUICK.map(a => (
          <div key={a.path} onClick={() => navigate(a.path)}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: 16, cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--yellow-edge, var(--gold-edge))'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
            <span style={{ fontSize: 22 }}>{a.icon}</span>
            <div>
              <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 13 }}>{a.label}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>{a.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
