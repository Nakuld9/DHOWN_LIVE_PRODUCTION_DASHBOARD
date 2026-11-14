import React, { useEffect, useState } from 'react';

const API = '';
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : '—';

export default function VendorStock() {
  const [challans, setChallans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`${API}/api/subcontract/challans?status=SENT`)
      .then(async r => { if (!r.ok) throw new Error(`Failed to load (${r.status})`); return r.json(); })
      .then(d => setChallans(Array.isArray(d) ? d : []))
      .catch(e => setErr(e.message || 'Could not load vendor stock'))
      .finally(() => setLoading(false));
  }, []);

  const totalKg = challans.reduce((s, c) => s + parseFloat(c.sent_weight_kg || 0), 0);
  const overdueCount = challans.filter(c => c.is_overdue).length;

  const byVendor = {};
  challans.forEach(c => {
    const v = c.vendor_name || 'Unknown';
    if (!byVendor[v]) byVendor[v] = { kg: 0, count: 0 };
    byVendor[v].kg += parseFloat(c.sent_weight_kg || 0);
    byVendor[v].count += 1;
  });

  return (
    <div style={{ padding: 24, color: 'var(--text)', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ color: 'var(--gold)', fontSize: 24, margin: 0 }}>Vendor Stock</h2>
      <p style={{ color: 'var(--muted)', margin: '4px 0 20px', fontSize: 13 }}>Material currently at vendors (sent, not yet received back)</p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 10, padding: '14px 20px' }}>
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>TOTAL AT VENDOR</div>
          <div style={{ color: 'var(--gold)', fontSize: 22, fontWeight: 700 }}>{totalKg.toFixed(1)} kg</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 10, padding: '14px 20px' }}>
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>CHALLANS OUTSTANDING</div>
          <div style={{ color: 'var(--link)', fontSize: 22, fontWeight: 700 }}>{challans.length}</div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 10, padding: '14px 20px' }}>
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>OVERDUE</div>
          <div style={{ color: overdueCount > 0 ? 'var(--crit)' : 'var(--green)', fontSize: 22, fontWeight: 700 }}>{overdueCount}</div>
        </div>
      </div>

      {Object.keys(byVendor).length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {Object.entries(byVendor).map(([vendor, v]) => (
            <span key={vendor} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: 'var(--text)' }}>
              <strong style={{ color: 'var(--gold)' }}>{vendor}</strong> — {v.kg.toFixed(1)} kg ({v.count} challan{v.count !== 1 ? 's' : ''})
            </span>
          ))}
        </div>
      )}

      {err ? (
        <div style={{ color: 'var(--crit)', background: 'var(--crit-dim)', border: '1px solid var(--crit-dim)', borderRadius: 10, textAlign: 'center', padding: 20 }}>{err}</div>
      ) : loading ? (
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Loading...</div>
      ) : challans.length === 0 ? (
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Nothing currently at any vendor.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              {['Challan', 'Vendor', 'Job Type', 'Fabric', 'Colour', 'Sent Date', 'Expected', 'Weight (kg)'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', border: '1px solid var(--surface)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {challans.map(c => (
              <tr key={c.challan_id} style={{ background: c.is_overdue ? 'var(--crit-dim)' : 'transparent' }}>
                <td style={{ padding: '8px 10px', color: 'var(--gold)', fontFamily: 'monospace', fontWeight: 700, border: '1px solid var(--surface)' }}>{c.challan_number}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text)', border: '1px solid var(--surface)' }}>{c.vendor_name}</td>
                <td style={{ padding: '8px 10px', color: 'var(--link)', border: '1px solid var(--surface)' }}>{c.job_type}</td>
                <td style={{ padding: '8px 10px', color: 'var(--muted)', border: '1px solid var(--surface)' }}>{c.fabric_type || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--pink)', border: '1px solid var(--surface)' }}>{c.color_name || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--muted)', border: '1px solid var(--surface)' }}>{fmtDate(c.sent_date)}</td>
                <td style={{ padding: '8px 10px', color: c.is_overdue ? 'var(--crit)' : 'var(--muted)', fontWeight: c.is_overdue ? 700 : 400, border: '1px solid var(--surface)' }}>
                  {fmtDate(c.expected_return_date)}{c.is_overdue ? ' ⚠ OVERDUE' : ''}
                </td>
                <td style={{ padding: '8px 10px', color: 'var(--gold)', fontWeight: 700, border: '1px solid var(--surface)' }}>{parseFloat(c.sent_weight_kg || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
