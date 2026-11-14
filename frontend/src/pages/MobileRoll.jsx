import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';

// Mobile roll-details page — target of the QR on roll labels (/m/roll/:rollId).
// PUBLIC: reads a no-auth endpoint returning only safe display fields, so a
// floor worker scanning a label sees roll info instantly (no login).
const API = ``;

const WH_COLORS = { GREIGE: 'var(--gold)', IN_BATCH: 'var(--link)', DYED: 'var(--purple)', FINISHED: 'var(--green)', DISPATCHED: 'var(--muted)' };
const row = { display: 'flex', justifyContent: 'space-between', padding: '10px 2px', borderBottom: '1px solid var(--surface)', fontSize: 15 };
const k = { color: 'var(--muted)' };
const v = { color: 'var(--text)', fontWeight: 600, textAlign: 'right' };

export default function MobileRoll() {
  const { rollId } = useParams();
  const [roll, setRoll] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await fetch(`${API}/api/public/roll/${encodeURIComponent(rollId)}`);
      const j = await r.json();
      if (!r.ok) { setErr(j.error || 'Failed to load roll'); return; }
      setRoll(j);
    } catch { setErr('Network error — is the server reachable?'); }
  }, [rollId]);

  useEffect(() => { load(); }, [load]);

  const page = (children) => (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'Inter, sans-serif', padding: 18, zoom: 1.25 }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ color: 'var(--gold)', fontWeight: 800, letterSpacing: 1.5, fontSize: 17 }}>DHOWN HOSIERY MILLS</div>
        <div style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginTop: 2 }}>Roll Details</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
          <a href="tel:+918360180643" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--surface)', color: 'var(--link)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>📞 +91 83601 80643</a>
          <a href="https://wa.me/918360180643" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid var(--green-dim)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>💬 WhatsApp</a>
        </div>
      </div>
      {children}
    </div>
  );

  if (err) return page(<div style={{ textAlign: 'center', color: 'var(--crit)', marginTop: 40 }}>{err}<br /><button onClick={load} style={{ marginTop: 14, background: 'var(--border)', color: 'var(--text)', border: 'none', borderRadius: 8, padding: '10px 22px', cursor: 'pointer' }}>Retry</button></div>);
  if (!roll) return page(<div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 40 }}>Loading…</div>);

  const whColor = WH_COLORS[roll.warehouse_status] || 'var(--muted)';
  return page(
    <div style={{ maxWidth: 430, margin: '0 auto' }}>
      <div style={{ background: 'var(--bg)', border: `1px solid ${whColor}`, borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 800, color: 'var(--link)', wordBreak: 'break-all' }}>{roll.roll_id}</div>
        <div style={{ marginTop: 8 }}>
          <span style={{ background: whColor + '22', color: whColor, border: `1px solid ${whColor}`, borderRadius: 12, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>{roll.warehouse_status || roll.status}</span>
          {roll.quality_grade && <span style={{ marginLeft: 8, background: '#22c55e22', color: 'var(--green)', border: '1px solid var(--green)', borderRadius: 12, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>Grade {roll.quality_grade}</span>}
        </div>
      </div>

      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '6px 16px', marginBottom: 14 }}>
        <div style={row}><span style={k}>Fabric</span><span style={v}>{roll.fabric_type || '—'}</span></div>
        <div style={row}><span style={k}>Weight</span><span style={{ ...v, color: 'var(--gold)' }}>{roll.actual_weight_kg || roll.weight_kg || '—'} kg</span></div>
        <div style={row}><span style={k}>Machine</span><span style={v}>{roll.machine_name || roll.machine_id || '—'}{roll.shift ? ` · Shift ${roll.shift}` : ''}</span></div>
        <div style={row}><span style={k}>Yarn Lot</span><span style={v}>{roll.yarn_lot_number || '—'}{roll.yarn_type ? ` · ${roll.yarn_type}` : ''}</span></div>
        <div style={row}><span style={k}>Lot / Batch</span><span style={v}>{roll.batch_number || '—'}{roll.batch_status ? ` (${roll.batch_status})` : ''}</span></div>
        <div style={row}><span style={k}>Source</span><span style={v}>{roll.source || 'REGULAR'}</span></div>
        <div style={row}><span style={k}>Created</span><span style={v}>{roll.created_at ? new Date(roll.created_at).toLocaleDateString('en-GB').split('/').join('-') : '—'}</span></div>
        <div style={{ ...row, borderBottom: 'none' }}><span style={k}>Approved</span><span style={v}>{roll.approved_at ? new Date(roll.approved_at).toLocaleDateString('en-GB').split('/').join('-') : '—'}</span></div>
      </div>

      {roll.inspection_grade && (
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '6px 16px', marginBottom: 14 }}>
          <div style={row}><span style={k}>Last Inspection</span><span style={v}>Grade {roll.inspection_grade} · {roll.inspection_date ? new Date(roll.inspection_date).toLocaleDateString('en-GB').split('/').join('-') : ''}</span></div>
        </div>
      )}

      <button onClick={load} style={{ width: '100%', background: 'var(--surface)', color: 'var(--link)', border: '1px solid var(--border)', borderRadius: 10, padding: 13, fontWeight: 700, cursor: 'pointer' }}>↻ Refresh</button>
    </div>
  );
}
