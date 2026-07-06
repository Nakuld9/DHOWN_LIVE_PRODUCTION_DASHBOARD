import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';

const STATUS_COLORS = {
  ACTIVE: '#22c55e',
  INACTIVE: '#94a3b8',
  DISCONTINUED: '#ef4444',
};

const CATEGORY_COLORS = {
  YARN:     '#a78bfa',
  FABRIC:   '#60a5fa',
  SPARES:   '#f87171',
  PACKING:  '#38bdf8',
  SERVICES: '#94a3b8',
};

const FABRIC_CATS = ['FABRIC'];
const YARN_CATS   = ['YARN'];

// Categories where UOM is always KG and GST is always 5%
const IS_KG_CAT   = (code) => FABRIC_CATS.includes(code) || YARN_CATS.includes(code);

const EMPTY_FORM = {
  item_code: '', item_name: '', category_id: '', description: '',
  hsn_id: '', status: 'ACTIVE',
  knitting_rate_per_kg: '', standard_loss_pct: '1.00',
};

export default function ItemMaster() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [categories, setCategories] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [hsnList, setHsnList] = useState([]);
  const [filters, setFilters] = useState({ category: '', status: '', q: '' });
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [activeTab, setActiveTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [bomLines, setBomLines] = useState([]);
  const [yarnItems, setYarnItems] = useState([]);
  const [bomSaving, setBomSaving] = useState(false);
  const [bomMsg, setBomMsg] = useState('');
  const authHeaders = () => {
    const t = localStorage.getItem('dhown_token') || localStorage.getItem('token');
    return { Authorization: `Bearer ${t}` };
  };

  const loadYarnItems = async () => {
    try {
      const r = await axios.get(`${API}/api/erp/items`, { headers: authHeaders(), params: { category: 'YARN', limit: 500 } });
      setYarnItems(r.data.data || []);
    } catch {}
  };

  const loadItems = useCallback(async () => {
    try {
      const params = { page, limit: 50, ...filters };
      const r = await axios.get(`${API}/api/erp/items`, { headers: authHeaders(), params });
      setItems(r.data.data);
      setTotal(r.data.total);
      setPages(r.data.pages);
    } catch {}
  }, [page, filters]);

  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    axios.get(`${API}/api/erp/item-categories`, { headers: authHeaders() }).then(r => setCategories(r.data)).catch(() => {});
    axios.get(`${API}/api/erp/uom`, { headers: authHeaders() }).then(r => setUoms(r.data)).catch(() => {});
    axios.get(`${API}/api/erp/hsn`, { headers: authHeaders() }).then(r => setHsnList(r.data)).catch(() => {});
    loadYarnItems();
  }, []);

  const openNew = () => {
    setEditItem(null);
    setForm(EMPTY_FORM);
    setActiveTab('general');
    setMsg('');
    setBomMsg('');
    setBomLines([]);
    setShowForm(true);
  };

  const openEdit = async (item) => {
    try {
      loadYarnItems();
      const r = await axios.get(`${API}/api/erp/items/${item.item_id}`, { headers: authHeaders() });
      const d = r.data;
      setEditItem(d);
      setForm({
        item_code: d.item_code, item_name: d.item_name, category_id: d.category_id,
        description: d.description || '',
        uom_id: d.uom_id || '', hsn_id: d.hsn_id || '',
        gst_rate: d.gst_rate || 0, standard_cost: d.standard_cost || 0,
        status: d.status || 'ACTIVE',
        knitting_rate_per_kg: d.knitting_rate_per_kg || '',
        standard_loss_pct: d.standard_loss_pct || '1.00',
        yarn_attrs: d.yarn_attrs || EMPTY_FORM.yarn_attrs,
        fabric_attrs: d.fabric_attrs || EMPTY_FORM.fabric_attrs,
        spare_attrs: d.spare_attrs || EMPTY_FORM.spare_attrs,
      });
      setActiveTab('general');
      setMsg('');
      setBomMsg('');
      setBomLines(d.bom_lines || []);
      setShowForm(true);
    } catch {}
  };

  const save = async () => {
    if (!form.item_name.trim() || !form.category_id) {
      setMsg('Item name and category are required.');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      const catCode = categoryCode(parseInt(form.category_id));
      const kgUom = uoms.find(u => u.code === 'KG');
      const num = (v) => (v === '' || v === null || v === undefined) ? null : parseFloat(v);
      const payload = {
        ...form,
        gst_rate:       IS_KG_CAT(catCode) ? 5 : (num(form.gst_rate) ?? 0),
        uom_id:         IS_KG_CAT(catCode) && kgUom ? kgUom.uom_id : (form.uom_id || null),
        hsn_id:         form.hsn_id && form.hsn_id !== '__new__' ? form.hsn_id : null,
        standard_cost:  null,
        selling_price:  null,
        knitting_rate_per_kg: num(form.knitting_rate_per_kg),
        standard_loss_pct:    num(form.standard_loss_pct) ?? 1.00,
        reorder_level:  num(form.reorder_level),
        min_stock:      num(form.min_stock),
        max_stock:      num(form.max_stock),
      };
      if (editItem) {
        await axios.put(`${API}/api/erp/items/${editItem.item_id}`, payload, { headers: authHeaders() });
      } else {
        await axios.post(`${API}/api/erp/items`, payload, { headers: authHeaders() });
      }
      setShowForm(false);
      loadItems();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const deactivate = async (id) => {
    if (!window.confirm('Deactivate this item?')) return;
    try {
      await axios.delete(`${API}/api/erp/items/${id}`, { headers: authHeaders() });
      loadItems();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const categoryCode = (id) => categories.find(c => c.category_id === id)?.code || '';
  const selectedCatCode = categoryCode(parseInt(form.category_id));
  const isYarn = selectedCatCode === 'YARN';
  const isFabric = selectedCatCode === 'FABRIC';
  const isSpare = selectedCatCode === 'SPARES';

  const bomTotal = bomLines.reduce((s, l) => s + parseFloat(l.percentage || 0), 0);

  const addBomLine = () => setBomLines(bl => [...bl, { yarn_item_id: '', percentage: '' }]);
  const removeBomLine = (i) => setBomLines(bl => bl.filter((_, idx) => idx !== i));
  const updateBomLine = (i, key, val) => setBomLines(bl => bl.map((l, idx) => idx === i ? { ...l, [key]: val } : l));

  const saveBom = async () => {
    if (!editItem) return;
    const valid = bomLines.filter(l => l.yarn_item_id && l.percentage);
    if (valid.length > 0 && Math.abs(bomTotal - 100) > 0.1) {
      setBomMsg(`Percentages must total 100% (currently ${bomTotal.toFixed(1)}%)`);
      return;
    }
    setBomSaving(true);
    setBomMsg('');
    try {
      const r = await axios.put(`${API}/api/erp/items/${editItem.item_id}/bom`,
        { lines: valid.map(l => ({ yarn_item_id: parseInt(l.yarn_item_id), percentage: parseFloat(l.percentage) })) },
        { headers: authHeaders() });
      setBomLines(r.data);
      setBomMsg('BOM saved');
      setTimeout(() => setBomMsg(''), 2000);
    } catch (e) {
      setBomMsg(e.response?.data?.error || 'Save failed');
    } finally { setBomSaving(false); }
  };

  const fld = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const yarnFld = (k, v) => setForm(f => ({ ...f, yarn_attrs: { ...f.yarn_attrs, [k]: v } }));
  const fabricFld = (k, v) => setForm(f => ({ ...f, fabric_attrs: { ...f.fabric_attrs, [k]: v } }));
  const spareFld = (k, v) => setForm(f => ({ ...f, spare_attrs: { ...f.spare_attrs, [k]: v } }));

  const tabs = [
    { key: 'general', label: 'General' },
  ];

  return (
    <div style={{ padding: 24, color: '#e2e8f0', fontFamily: 'Inter, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, color: '#f1f5f9' }}>Item Master</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>{total} items registered</p>
        </div>
        <button onClick={openNew} style={styles.btnPrimary}>+ New Item</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input placeholder="Search code / name..." value={filters.q}
          onChange={e => { setFilters(f => ({ ...f, q: e.target.value })); setPage(1); }}
          style={styles.input} />
        <select value={filters.category}
          onChange={e => { setFilters(f => ({ ...f, category: e.target.value })); setPage(1); }}
          style={styles.select}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select value={filters.status}
          onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPage(1); }}
          style={styles.select}>
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="DISCONTINUED">Discontinued</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', background: '#1e293b', borderRadius: 10, border: '1px solid #334155' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#0f172a' }}>
              {['Item Code','Name','Category','UOM','Knitting ₹/kg','Std Loss %','Status','Actions'].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
                No items found. Click "New Item" to add the first one.
              </td></tr>
            ) : items.map(item => (
              <tr key={item.item_id} style={styles.tr}>
                <td style={styles.td}>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#38bdf8' }}>{item.item_code}</span>
                </td>
                <td style={styles.td}>
                  <div style={{ fontWeight: 500 }}>{item.item_name}</div>
                </td>
                <td style={styles.td}>
                  <span style={{
                    background: (CATEGORY_COLORS[item.category_code] || '#64748b') + '22',
                    color: CATEGORY_COLORS[item.category_code] || '#94a3b8',
                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600
                  }}>{item.category_name}</span>
                </td>
                <td style={styles.td}>{IS_KG_CAT(item.category_code) ? 'KG' : (item.uom_code || '—')}</td>
                <td style={styles.td}>
                  {item.knitting_rate_per_kg
                    ? <span style={{ color: '#f4ae1f', fontWeight: 700 }}>₹{parseFloat(item.knitting_rate_per_kg).toFixed(2)}</span>
                    : <span style={{ color: '#475569' }}>—</span>}
                </td>
                <td style={styles.td}>
                  {item.category_code === 'FABRIC'
                    ? <span style={{ color: '#94a3b8' }}>{parseFloat(item.standard_loss_pct || 1).toFixed(2)}%</span>
                    : <span style={{ color: '#475569' }}>—</span>}
                </td>
                <td style={styles.td}>
                  <span style={{
                    background: (STATUS_COLORS[item.status] || '#64748b') + '22',
                    color: STATUS_COLORS[item.status] || '#94a3b8',
                    padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600
                  }}>{item.status}</span>
                </td>
                <td style={styles.td}>
                  <button onClick={() => openEdit(item)} style={styles.btnSm}>Edit</button>
                  {item.status === 'ACTIVE' &&
                    <button onClick={() => deactivate(item.item_id)} style={{ ...styles.btnSm, marginLeft: 6, background: '#7f1d1d' }}>
                      Deactivate
                    </button>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)} style={styles.btnSm}>Prev</button>
          <span style={{ padding: '4px 12px', color: '#94a3b8', fontSize: 13 }}>Page {page} of {pages}</span>
          <button disabled={page === pages} onClick={() => setPage(p => p + 1)} style={styles.btnSm}>Next</button>
        </div>
      )}

      {/* Modal / Drawer */}
      {showForm && (
        <div style={styles.overlay}>
          <div style={styles.drawer}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>{editItem ? `Edit — ${editItem.item_code}` : 'New Item'}</h3>
              <button onClick={() => setShowForm(false)} style={styles.btnClose}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #334155', paddingBottom: 8 }}>
              {tabs.map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  style={{ ...styles.tab, ...(activeTab === t.key ? styles.tabActive : {}) }}>
                  {t.label}
                </button>
              ))}
            </div>

            {msg && <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{msg}</div>}

            {/* General Tab */}
            {activeTab === 'general' && (
              <div style={styles.grid2}>
                <label style={styles.label}>Item Code <span style={{ color: '#64748b', fontSize: 11 }}>(leave blank to auto-generate)</span>
                  <input value={form.item_code} onChange={e => fld('item_code', e.target.value)}
                    disabled={!!editItem} style={styles.input} placeholder="e.g. YARN-0001" />
                </label>
                <label style={styles.label}>Item Name *
                  <input value={form.item_name} onChange={e => fld('item_name', e.target.value)}
                    style={styles.input} placeholder="e.g. Cotton 40s Raw White" />
                </label>
                <label style={styles.label}>Category *
                  <select value={form.category_id} onChange={e => fld('category_id', e.target.value)} style={styles.select}>
                    <option value="">— select —</option>
                    {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
                  </select>
                </label>
                {/* UOM — fixed KG for yarn/fabric, selectable for others */}
                <label style={styles.label}>UOM
                  {IS_KG_CAT(selectedCatCode)
                    ? <div style={{ ...styles.input, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#f4ae1f', fontWeight: 700 }}>KG</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>(fixed for yarn / fabric)</span>
                      </div>
                    : <select value={form.uom_id} onChange={e => fld('uom_id', e.target.value)} style={styles.select}>
                        <option value="">— select —</option>
                        {uoms.map(u => <option key={u.uom_id} value={u.uom_id}>{u.code} — {u.name}</option>)}
                      </select>
                  }
                </label>

                <label style={styles.label}>HSN Code
                  <select value={form.hsn_id} onChange={e => fld('hsn_id', e.target.value)} style={styles.select}>
                    <option value="">— select —</option>
                    {hsnList.map(h => <option key={h.hsn_id} value={h.hsn_id}>{h.hsn_code} — {h.description}</option>)}
                    <option value="__new__">+ Add new HSN code...</option>
                  </select>
                  {form.hsn_id === '__new__' && <HsnAddInline onSaved={(newHsn) => { setHsnList(l => [...l, newHsn]); fld('hsn_id', newHsn.hsn_id); }} />}
                </label>

                {/* GST — fixed 5% for yarn/fabric */}
                <label style={styles.label}>GST Rate %
                  {IS_KG_CAT(selectedCatCode)
                    ? <div style={{ ...styles.input, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#f4ae1f', fontWeight: 700 }}>5%</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>(fixed for yarn / fabric)</span>
                      </div>
                    : <input type="number" value={form.gst_rate || 0} onChange={e => fld('gst_rate', e.target.value)} style={styles.input} />
                  }
                </label>

                {/* Knitting cost rates — Fabric items only */}
                {selectedCatCode === 'FABRIC' && (<>
                  <label style={styles.label}>
                    Knitting Rate (₹/kg)
                    <input type="number" step="0.01" placeholder="e.g. 12.00"
                      value={form.knitting_rate_per_kg}
                      onChange={e => fld('knitting_rate_per_kg', e.target.value)}
                      style={styles.input} />
                    <span style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>In-house knitting conversion cost per kg of fabric produced</span>
                  </label>
                  <label style={styles.label}>
                    Std. Knitting Loss %
                    <input type="number" step="0.01" placeholder="1.00"
                      value={form.standard_loss_pct}
                      onChange={e => fld('standard_loss_pct', e.target.value)}
                      style={styles.input} />
                    <span style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>Standard wastage % — variance vs actual calculated per shift</span>
                  </label>
                </>)}

                {/* BOM — Yarn Composition for fabric items */}
                {selectedCatCode === 'FABRIC' && (
                  <div style={{ gridColumn: '1 / -1', background: '#0f172a', borderRadius: 8, padding: 16, border: '1px solid #334155' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#f4ae1f' }}>Yarn Composition (BOM)</span>
                        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>
                          {bomLines.length > 0 ? `${bomTotal.toFixed(1)}% / 100%` : 'No yarn types defined'}
                        </span>
                        {bomLines.length > 0 && Math.abs(bomTotal - 100) > 0.1 && (
                          <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 8 }}>Must total 100%</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {editItem && bomLines.length > 0 && (
                          <button type="button" onClick={saveBom} disabled={bomSaving}
                            style={{ background: '#22c55e', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                            {bomSaving ? 'Saving...' : 'Save BOM'}
                          </button>
                        )}
                        <button type="button" onClick={addBomLine}
                          style={{ background: '#1e3a5f', color: '#93c5fd', border: 'none', borderRadius: 5, padding: '5px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                          + Add Yarn
                        </button>
                      </div>
                    </div>
                    {bomMsg && <div style={{ fontSize: 12, color: bomMsg === 'BOM saved' ? '#22c55e' : '#ef4444', marginBottom: 8 }}>{bomMsg}</div>}
                    {bomLines.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: '#64748b', borderBottom: '1px solid #334155' }}>Yarn Item</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: '#64748b', borderBottom: '1px solid #334155', width: 100 }}>%</th>
                            <th style={{ padding: '6px 10px', borderBottom: '1px solid #334155', width: 40 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {bomLines.map((line, i) => (
                            <tr key={i}>
                              <td style={{ padding: '4px 10px', borderBottom: '1px solid #1e293b' }}>
                                <select value={line.yarn_item_id || ''} onChange={e => updateBomLine(i, 'yarn_item_id', e.target.value)}
                                  style={{ ...styles.input, marginTop: 0 }}>
                                  <option value="">— select yarn —</option>
                                  {yarnItems.map(y => <option key={y.item_id} value={y.item_id}>{y.item_code} — {y.item_name}</option>)}
                                </select>
                              </td>
                              <td style={{ padding: '4px 10px', borderBottom: '1px solid #1e293b' }}>
                                <input type="number" step="0.01" min="0" max="100" placeholder="e.g. 60"
                                  value={line.percentage || ''} onChange={e => updateBomLine(i, 'percentage', e.target.value)}
                                  style={{ ...styles.input, marginTop: 0, width: 80 }} />
                              </td>
                              <td style={{ padding: '4px 10px', borderBottom: '1px solid #1e293b' }}>
                                <button type="button" onClick={() => removeBomLine(i)}
                                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {!editItem && bomLines.length > 0 && (
                      <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 8 }}>Save the item first, then save BOM</div>
                    )}
                  </div>
                )}

                <label style={{ ...styles.label, gridColumn: '1 / -1' }}>Description
                  <textarea value={form.description} onChange={e => fld('description', e.target.value)}
                    style={{ ...styles.input, height: 60, resize: 'vertical' }} />
                </label>

                {editItem && (
                  <label style={styles.label}>Status
                    <select value={form.status} onChange={e => fld('status', e.target.value)} style={styles.select}>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                      <option value="DISCONTINUED">Discontinued</option>
                    </select>
                  </label>
                )}
              </div>
            )}

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, paddingTop: 16, borderTop: '1px solid #334155' }}>
              <button onClick={() => setShowForm(false)} style={styles.btnSecondary}>Cancel</button>
              <button onClick={save} disabled={saving} style={styles.btnPrimary}>
                {saving ? 'Saving…' : editItem ? 'Update Item' : 'Create Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HsnAddInline({ onSaved }) {
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const [gst, setGst]   = useState('5');
  const [err, setErr]   = useState('');
  const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';
  const h = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('dhown_token')}` });

  const save = async () => {
    if (!code.trim() || !desc.trim()) { setErr('Code and description required'); return; }
    try {
      const r = await fetch(`${API}/api/erp/hsn`, { method: 'POST', headers: h(), body: JSON.stringify({ hsn_code: code.trim(), description: desc.trim(), gst_rate: parseFloat(gst) || 0 }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || 'Failed'); return; }
      onSaved(j);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div style={{ background: '#0f172a', border: '1px solid #3b82f6', borderRadius: 6, padding: '10px 12px', marginTop: 6 }}>
      <div style={{ fontSize: 11, color: '#60a5fa', fontWeight: 600, marginBottom: 8 }}>New HSN Code</div>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 70px auto', gap: 6, alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>HSN CODE *</div>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. 60069000"
            style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 5, padding: '6px 8px', fontSize: 12, boxSizing: 'border-box' }} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>DESCRIPTION *</div>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Knitted fabrics of cotton"
            style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 5, padding: '6px 8px', fontSize: 12, boxSizing: 'border-box' }} />
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>GST %</div>
          <input type="number" value={gst} onChange={e => setGst(e.target.value)}
            style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 5, padding: '6px 8px', fontSize: 12, boxSizing: 'border-box' }} />
        </div>
        <button onClick={save} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Save &amp; Select</button>
      </div>
      {err && <div style={{ color: '#ef4444', fontSize: 11, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

const styles = {
  btnPrimary: { background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnSecondary: { background: '#334155', color: '#e2e8f0', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnSm: { background: '#1e3a5f', color: '#93c5fd', border: 'none', padding: '4px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  btnClose: { background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' },
  input: { width: '100%', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box', marginTop: 4 },
  select: { width: '100%', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box', marginTop: 4 },
  label: { display: 'flex', flexDirection: 'column', fontSize: 12, color: '#94a3b8', fontWeight: 500 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  th: { padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #334155' },
  td: { padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #1e293b', verticalAlign: 'middle' },
  tr: { transition: 'background 0.15s' },
  tab: { background: 'none', border: 'none', color: '#64748b', padding: '6px 14px', cursor: 'pointer', fontSize: 13, borderRadius: 4, fontWeight: 500 },
  tabActive: { background: '#1e3a5f', color: '#60a5fa', fontWeight: 700 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' },
  drawer: { width: 680, background: '#1e293b', padding: 28, overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.5)' },
};
