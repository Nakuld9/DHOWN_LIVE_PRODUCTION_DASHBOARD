import React, { useEffect, useState } from 'react';

const API = 'http://localhost:4000';
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function VendorStock() {
  const [challans, setChallans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/subcontract/challans?status=SENT`)
      .then(r => r.json())
      .then(d => setChallans(Array.isArray(d) ? d : []))
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
    <div style={{ padding: 24, color: '#fff', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ color: '#FFD700', fontSize: 24, margin: 0 }}>Vendor Stock</h2>
      <p style={{ color: '#7da2d6', margin: '4px 0 20px', fontSize: 13 }}>Material currently at vendors (sent, not yet received back)</p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ background: '#081830', border: '1px solid #23395d', borderRadius: 10, padding: '14px 20px' }}>
          <div style={{ color: '#7da2d6', fontSize: 11 }}>TOTAL AT VENDOR</div>
          <div style={{ color: '#f59e0b', fontSize: 22, fontWeight: 700 }}>{totalKg.toFixed(1)} kg</div>
        </div>
        <div style={{ background: '#081830', border: '1px solid #23395d', borderRadius: 10, padding: '14px 20px' }}>
          <div style={{ color: '#7da2d6', fontSize: 11 }}>CHALLANS OUTSTANDING</div>
          <div style={{ color: '#93c5fd', fontSize: 22, fontWeight: 700 }}>{challans.length}</div>
        </div>
        <div style={{ background: '#081830', border: '1px solid #23395d', borderRadius: 10, padding: '14px 20px' }}>
          <div style={{ color: '#7da2d6', fontSize: 11 }}>OVERDUE</div>
          <div style={{ color: overdueCount > 0 ? '#ef4444' : '#22c55e', fontSize: 22, fontWeight: 700 }}>{overdueCount}</div>
        </div>
      </div>

      {Object.keys(byVendor).length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {Object.entries(byVendor).map(([vendor, v]) => (
            <span key={vendor} style={{ background: '#0d1b2f', border: '1px solid #344a6c', borderRadius: 6, padding: '6px 12px', fontSize: 12, color: '#e2e8f0' }}>
              <strong style={{ color: '#FFD700' }}>{vendor}</strong> — {v.kg.toFixed(1)} kg ({v.count} challan{v.count !== 1 ? 's' : ''})
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#7da2d6', textAlign: 'center', padding: 40 }}>Loading...</div>
      ) : challans.length === 0 ? (
        <div style={{ color: '#7da2d6', textAlign: 'center', padding: 40 }}>Nothing currently at any vendor.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#0a2040' }}>
              {['Challan', 'Vendor', 'Job Type', 'Fabric', 'Colour', 'Sent Date', 'Expected', 'Weight (kg)'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#7da2d6', fontSize: 10, textTransform: 'uppercase', border: '1px solid #16294a' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {challans.map(c => (
              <tr key={c.challan_id} style={{ background: c.is_overdue ? '#2a0d0d' : 'transparent' }}>
                <td style={{ padding: '8px 10px', color: '#FFD700', fontFamily: 'monospace', fontWeight: 700, border: '1px solid #16294a' }}>{c.challan_number}</td>
                <td style={{ padding: '8px 10px', color: '#e2e8f0', border: '1px solid #16294a' }}>{c.vendor_name}</td>
                <td style={{ padding: '8px 10px', color: '#93c5fd', border: '1px solid #16294a' }}>{c.job_type}</td>
                <td style={{ padding: '8px 10px', color: '#cbd5e1', border: '1px solid #16294a' }}>{c.fabric_type || '—'}</td>
                <td style={{ padding: '8px 10px', color: '#f472b6', border: '1px solid #16294a' }}>{c.color_name || '—'}</td>
                <td style={{ padding: '8px 10px', color: '#9ca3af', border: '1px solid #16294a' }}>{fmtDate(c.sent_date)}</td>
                <td style={{ padding: '8px 10px', color: c.is_overdue ? '#ef4444' : '#9ca3af', fontWeight: c.is_overdue ? 700 : 400, border: '1px solid #16294a' }}>
                  {fmtDate(c.expected_return_date)}{c.is_overdue ? ' ⚠ OVERDUE' : ''}
                </td>
                <td style={{ padding: '8px 10px', color: '#f59e0b', fontWeight: 700, border: '1px solid #16294a' }}>{parseFloat(c.sent_weight_kg || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
