import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';

const ALL_ROLES = ['SUPPLIER','CUSTOMER','KNITTING_SUB','DYE_HOUSE','FINISHING_HOUSE','TRANSPORTER','AGENT'];
const ROLE_COLORS = {
  SUPPLIER:'#a78bfa', CUSTOMER:'#34d399', KNITTING_SUB:'#60a5fa',
  DYE_HOUSE:'#fbbf24', FINISHING_HOUSE:'#f87171', TRANSPORTER:'#fb923c', AGENT:'#94a3b8',
};

const panFromGst = (gst) => (gst && gst.length >= 12) ? gst.substring(2, 12) : '';

const EMPTY = {
  partner_code:'', company_name:'', gstin:'', pan:'',
  roles:[], is_active:true, notes:'',
  address:{ line1:'', city:'', state:'', pincode:'' },
  contact:{ name:'', mobile:'', email:'' },
  bank:{ bank_name:'', account_no:'', ifsc:'', account_type:'CURRENT' },
};

export default function Partners() {
  const [partners, setPartners] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [filters, setFilters] = useState({ role:'', active:'true', q:'' });
  const [showForm, setShowForm] = useState(false);
  const [editPartner, setEditPartner] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const token = localStorage.getItem('dhown_token') || localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/api/erp/partners`, { headers, params: { page, limit: 50, ...filters } });
      setPartners(r.data.data); setTotal(r.data.total); setPages(r.data.pages);
    } catch {}
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditPartner(null); setForm(EMPTY); setMsg(''); setShowForm(true); };

  const openEdit = async (p) => {
    try {
      const r = await axios.get(`${API}/api/erp/partners/${p.partner_id}`, { headers });
      const d = r.data;
      setEditPartner(d);
      setForm({
        partner_code: d.partner_code, company_name: d.company_name,
        gstin: d.gstin||'', pan: d.pan||'',
        roles: d.roles||[], is_active: d.is_active, notes: d.notes||'',
        address: d.addresses?.[0] || EMPTY.address,
        contact: d.contacts?.[0] || EMPTY.contact,
        bank: d.banks?.[0] || EMPTY.bank,
      });
      setMsg(''); setShowForm(true);
    } catch {}
  };

  const fld = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const addrFld = (k, v) => setForm(f => ({ ...f, address: { ...f.address, [k]: v } }));
  const contFld = (k, v) => setForm(f => ({ ...f, contact: { ...f.contact, [k]: v } }));
  const bankFld = (k, v) => setForm(f => ({ ...f, bank: { ...f.bank, [k]: v } }));
  const toggleRole = (r) => setForm(f => ({
    ...f, roles: f.roles.includes(r) ? f.roles.filter(x => x !== r) : [...f.roles, r]
  }));

  const onGstChange = (v) => {
    const gst = v.toUpperCase();
    setForm(f => ({ ...f, gstin: gst, pan: panFromGst(gst) }));
  };

  const save = async () => {
    if (!form.company_name.trim()) { setMsg('Company name required'); return; }
    if (form.roles.length === 0) { setMsg('Select at least one role'); return; }
    setSaving(true); setMsg('');
    try {
      const payload = { ...form, pan: form.pan || panFromGst(form.gstin) };
      if (editPartner) {
        await axios.put(`${API}/api/erp/partners/${editPartner.partner_id}`, payload, { headers });
      } else {
        await axios.post(`${API}/api/erp/partners`, payload, { headers });
      }
      setShowForm(false); load();
    } catch (e) { setMsg(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const deactivate = async (id) => {
    if (!window.confirm('Deactivate this partner?')) return;
    try { await axios.delete(`${API}/api/erp/partners/${id}`, { headers }); load(); }
    catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div style={{ padding: 24, color: '#e2e8f0' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin:0, fontSize:22, color:'#FFD700' }}>BUSINESS PARTNERS</h2>
          <p style={{ margin:'4px 0 0', fontSize:13, color:'#64748b' }}>{total} partners</p>
        </div>
        <button onClick={openNew} style={S.btnP}>+ New Partner</button>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap' }}>
        <input placeholder="Search name / code / GSTIN…" value={filters.q}
          onChange={e => { setFilters(f => ({...f, q:e.target.value})); setPage(1); }}
          style={{...S.inp, width:240}} />
        <select value={filters.role} onChange={e => { setFilters(f => ({...f, role:e.target.value})); setPage(1); }} style={S.sel}>
          <option value="">All Roles</option>
          {ALL_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g,' ')}</option>)}
        </select>
        <select value={filters.active} onChange={e => { setFilters(f => ({...f, active:e.target.value})); setPage(1); }} style={S.sel}>
          <option value="true">Active</option><option value="false">Inactive</option><option value="">All</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ overflowX:'auto', background:'#0d1b2f', borderRadius:10, border:'1px solid #16345d' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr style={{ background:'#081426' }}>
            {['Code','Company','Roles','GSTIN','PAN','Mobile','City','Actions'].map(h =>
              <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {partners.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign:'center', padding:40, color:'#475569' }}>
                No partners yet. Click "+ New Partner" to add.
              </td></tr>
            ) : partners.map(p => (
              <tr key={p.partner_id} style={{ borderBottom:'1px solid #0d1b2f' }}>
                <td style={S.td}><span style={{ fontFamily:'monospace', fontSize:12, color:'#FFD700' }}>{p.partner_code}</span></td>
                <td style={S.td}><span style={{ fontWeight:600 }}>{p.company_name}</span></td>
                <td style={S.td}>
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                    {(p.roles||[]).map(r => (
                      <span key={r} style={{
                        background:(ROLE_COLORS[r]||'#64748b')+'22', color:ROLE_COLORS[r]||'#94a3b8',
                        padding:'2px 7px', borderRadius:10, fontSize:10, fontWeight:700
                      }}>{r.replace(/_/g,' ')}</span>
                    ))}
                  </div>
                </td>
                <td style={S.td}><span style={{ fontFamily:'monospace', fontSize:11 }}>{p.gstin||'—'}</span></td>
                <td style={S.td}><span style={{ fontFamily:'monospace', fontSize:11 }}>{p.pan || (p.gstin ? panFromGst(p.gstin) : '—')}</span></td>
                <td style={S.td}>{p.mobile||'—'}</td>
                <td style={S.td}>{p.city||'—'}</td>
                <td style={S.td}>
                  <button onClick={() => openEdit(p)} style={S.btnSm}>Edit</button>
                  {p.is_active && <button onClick={() => deactivate(p.partner_id)}
                    style={{...S.btnSm, marginLeft:6, background:'#7f1d1d', color:'#fca5a5'}}>Deactivate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'center' }}>
          <button disabled={page===1} onClick={() => setPage(p => p-1)} style={S.btnSm}>Prev</button>
          <span style={{ padding:'4px 12px', color:'#94a3b8', fontSize:13 }}>Page {page}/{pages}</span>
          <button disabled={page===pages} onClick={() => setPage(p => p+1)} style={S.btnSm}>Next</button>
        </div>
      )}

      {/* ---- SINGLE-PAGE CREATE / EDIT DRAWER ---- */}
      {showForm && (
        <div style={S.overlay}>
          <div style={S.drawer}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <h3 style={{ margin:0, fontSize:18, color:'#FFD700' }}>
                {editPartner ? `Edit — ${editPartner.partner_code}` : 'New Partner'}
              </h3>
              <button onClick={() => setShowForm(false)} style={{ background:'none', border:'none', color:'#94a3b8', fontSize:20, cursor:'pointer' }}>✕</button>
            </div>

            {msg && <div style={{ background:'#7f1d1d', color:'#fca5a5', padding:'8px 12px', borderRadius:6, marginBottom:12, fontSize:13 }}>{msg}</div>}

            {/* BASIC INFO */}
            <Section title="Basic Info">
              <div style={S.g3}>
                <Lbl label="Partner Code">
                  <input value={form.partner_code} onChange={e => fld('partner_code', e.target.value)}
                    disabled={!!editPartner} style={S.inp} placeholder="auto if blank" />
                </Lbl>
                <Lbl label="Company Name *">
                  <input value={form.company_name} onChange={e => fld('company_name', e.target.value)} style={S.inp} />
                </Lbl>
                <Lbl label="GSTIN">
                  <input value={form.gstin} onChange={e => onGstChange(e.target.value)} style={S.inp} placeholder="22AAAAA0000A1Z5" maxLength={15} />
                </Lbl>
              </div>
              <div style={{ ...S.g3, marginTop:12 }}>
                <Lbl label="PAN (auto from GST)">
                  <input value={form.pan} readOnly style={{...S.inp, background:'#050d1a', color:'#FFD700'}} />
                </Lbl>
                <Lbl label="Notes">
                  <input value={form.notes} onChange={e => fld('notes', e.target.value)} style={S.inp} />
                </Lbl>
                {editPartner && (
                  <Lbl label="Status">
                    <select value={form.is_active ? 'active':'inactive'}
                      onChange={e => fld('is_active', e.target.value==='active')} style={S.sel}>
                      <option value="active">Active</option><option value="inactive">Inactive</option>
                    </select>
                  </Lbl>
                )}
              </div>
            </Section>

            {/* ROLES */}
            <Section title="Roles *">
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {ALL_ROLES.map(r => (
                  <button key={r} onClick={() => toggleRole(r)} style={{
                    padding:'6px 14px', borderRadius:20, cursor:'pointer', fontSize:12, fontWeight:600,
                    border:`2px solid ${ROLE_COLORS[r]||'#334155'}`,
                    background: form.roles.includes(r) ? (ROLE_COLORS[r]||'#334155')+'33' : 'transparent',
                    color: form.roles.includes(r) ? (ROLE_COLORS[r]||'#94a3b8') : '#64748b',
                  }}>{form.roles.includes(r) ? '✓ ':''}{r.replace(/_/g,' ')}</button>
                ))}
              </div>
            </Section>

            {/* CONTACT */}
            <Section title="Contact Person">
              <div style={S.g3}>
                <Lbl label="Name"><input value={form.contact.name} onChange={e => contFld('name', e.target.value)} style={S.inp} /></Lbl>
                <Lbl label="Mobile"><input value={form.contact.mobile} onChange={e => contFld('mobile', e.target.value)} style={S.inp} /></Lbl>
                <Lbl label="Email"><input value={form.contact.email} onChange={e => contFld('email', e.target.value)} style={S.inp} /></Lbl>
              </div>
            </Section>

            {/* ADDRESS */}
            <Section title="Address">
              <div style={S.g3}>
                <Lbl label="Address Line"><input value={form.address.line1} onChange={e => addrFld('line1', e.target.value)} style={S.inp} /></Lbl>
                <Lbl label="City"><input value={form.address.city} onChange={e => addrFld('city', e.target.value)} style={S.inp} /></Lbl>
                <Lbl label="State"><input value={form.address.state} onChange={e => addrFld('state', e.target.value)} style={S.inp} /></Lbl>
              </div>
              <div style={{ ...S.g3, marginTop:12 }}>
                <Lbl label="Pincode"><input value={form.address.pincode} onChange={e => addrFld('pincode', e.target.value)} style={S.inp} /></Lbl>
              </div>
            </Section>

            {/* BANK */}
            <Section title="Bank Details (optional)">
              <div style={S.g3}>
                <Lbl label="Bank Name"><input value={form.bank.bank_name} onChange={e => bankFld('bank_name', e.target.value)} style={S.inp} /></Lbl>
                <Lbl label="Account No"><input value={form.bank.account_no} onChange={e => bankFld('account_no', e.target.value)} style={S.inp} /></Lbl>
                <Lbl label="IFSC"><input value={form.bank.ifsc} onChange={e => bankFld('ifsc', e.target.value.toUpperCase())} style={S.inp} /></Lbl>
              </div>
            </Section>

            {/* SAVE */}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:16, borderTop:'1px solid #16345d' }}>
              <button onClick={() => setShowForm(false)} style={S.btnSec}>Cancel</button>
              <button onClick={save} disabled={saving} style={S.btnP}>
                {saving ? 'Saving…' : editPartner ? 'Update Partner' : 'Create Partner'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom:18 }}>
      <h4 style={{ margin:'0 0 10px', fontSize:12, color:'#7da2d6', textTransform:'uppercase', letterSpacing:0.5 }}>{title}</h4>
      {children}
    </div>
  );
}

function Lbl({ label, children }) {
  return <label style={{ display:'flex', flexDirection:'column', fontSize:11, color:'#94a3b8', fontWeight:500 }}>{label}{children}</label>;
}

const S = {
  btnP:   { background:'#FFD700', color:'#111', border:'none', padding:'8px 18px', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnSec: { background:'#16345d', color:'#e2e8f0', border:'none', padding:'8px 16px', borderRadius:6, cursor:'pointer', fontSize:13 },
  btnSm:  { background:'#0d1b2f', color:'#FFD700', border:'1px solid #16345d', padding:'4px 10px', borderRadius:5, cursor:'pointer', fontSize:12 },
  inp:    { width:'100%', background:'#0d1b2f', border:'1px solid #16345d', color:'#fff', borderRadius:6, padding:'7px 10px', fontSize:13, boxSizing:'border-box', marginTop:4 },
  sel:    { width:'100%', background:'#0d1b2f', border:'1px solid #16345d', color:'#fff', borderRadius:6, padding:'7px 10px', fontSize:13, boxSizing:'border-box', marginTop:4 },
  th:     { padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#7da2d6', textTransform:'uppercase', letterSpacing:0.5, borderBottom:'1px solid #16345d' },
  td:     { padding:'10px 14px', fontSize:13, borderBottom:'1px solid #0d1b2f' },
  g3:     { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 },
  overlay:{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:200, display:'flex', justifyContent:'flex-end' },
  drawer: { width:700, background:'#0a1628', padding:28, overflowY:'auto', boxShadow:'-4px 0 24px rgba(0,0,0,0.5)', borderLeft:'1px solid #16345d' },
};
