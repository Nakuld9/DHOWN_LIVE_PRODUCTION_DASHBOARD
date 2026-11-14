import React, { useEffect, useState } from 'react';
import PrintChallan from '../components/PrintChallan';

const API = '';
const token = () => localStorage.getItem('dhown_token');
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : '—';

const ROLL_JOB_TYPES    = ['DYEING', 'FINISHING', 'DYEING_FINISHING'];
const YARN_JOB_TYPES    = ['KNITTING'];
const ALL_JOB_TYPES     = [...ROLL_JOB_TYPES, ...YARN_JOB_TYPES, 'JOB_WORK'];
const STATUS_COLOR = { SENT: 'var(--gold)', PARTIALLY_RECEIVED: 'var(--link)', RECEIVED: 'var(--green)', CANCELLED: 'var(--muted)' };
const TYPE_BADGE = { ROLL_BASED: { label: 'Dyeing/Finishing', color: 'var(--link)' }, YARN_BASED: { label: 'Knitting', color: 'var(--purple)' } };

const inp  = { background: 'var(--bg)', border: '1px solid var(--surface)', color: 'var(--text)', padding: '8px 10px', borderRadius: '6px', fontSize: '13px', width: '100%', boxSizing: 'border-box' };
const lbl  = { display: 'block', color: 'var(--muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: '4px' };

const emptyForm    = () => ({ batch_id: '', vendor_name: '', vendor_contact: '', job_type: 'DYEING', sent_date: today(), expected_return_date: '', rate_per_kg: '', notes: '', is_job_work: false, customer_name: '' });
const emptyReceive = () => ({ received_date: today(), received_weight_kg: '', rolls_received_count: '', balance_yarn_kg: '0', quality_status: 'PASS', rejected_weight_kg: '0', notes: '', vendor_invoice_no: '', vendor_bill_amount: '' });
const emptyYarnRow = () => ({ lot_id: '', lot_number: '', yarn_type: '', color: '', sent_kg: '' });
const emptyFabricRow = () => ({ fabric_type: '', batch_id: '', color: '', roll_count: 0, weight_kg: 0 });

export default function Subcontracting() {
  const [tab,           setTab]           = useState('DYEING'); // KNITTING | DYEING | FINISHING | DYEING_FINISHING | RETURNS
  const [challans,      setChallans]      = useState([]);
  const [detail,        setDetail]        = useState(null);
  const [sealedBatches, setSealedBatches] = useState([]);
  const [yarnLots,      setYarnLots]      = useState([]);
  const [showCreate,    setShowCreate]    = useState(false);
  const [showReceive,   setShowReceive]   = useState(false);
  const [filter,        setFilter]        = useState('');
  const [dateFrom,      setDateFrom]      = useState('');
  const [dateTo,        setDateTo]        = useState('');
  const [msg,           setMsg]           = useState('');
  const [msgErr,        setMsgErr]        = useState(false);
  const [printing,      setPrinting]      = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [yarnRows,      setYarnRows]      = useState([emptyYarnRow()]);
  const [fabricRows,    setFabricRows]    = useState([emptyFabricRow()]);
  const [invoices,      setInvoices]      = useState([]);
  const [invLoading,    setInvLoading]    = useState(false);
  const [invFilter,     setInvFilter]     = useState('pending'); // 'pending' | 'paid' | 'all'
  const [partyData,     setPartyData]     = useState([]);
  const [partyLoading,  setPartyLoading]  = useState(false);
  const [expandedVendor, setExpandedVendor] = useState(null);
  const [partyJobFilter, setPartyJobFilter] = useState(''); // '' | 'DYEING' | 'FINISHING' | 'KNITTING'
  const [analytics,     setAnalytics]     = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [showForward,   setShowForward]   = useState(false);
  const [forwardForm,   setForwardForm]   = useState({ vendor_name: '', vendor_contact: '', rate_per_kg: '', expected_return_date: '', notes: '' });
  const [partners,      setPartners]      = useState([]);

  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({});

  const startEditChallan = () => {
    setEditForm({ vendor_name: detail.vendor_name||'', vendor_contact: detail.vendor_contact||'', rate_per_kg: detail.rate_per_kg||'', expected_return_date: detail.expected_return_date?.slice(0,10)||'', notes: detail.notes||'' });
    setShowEdit(true);
  };
  const saveEditChallan = async () => {
    const r = await fetch(`${API}/api/subcontract/challans/${detail.challan_id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(editForm) });
    if (!r.ok) { const e = await r.json(); alert(e.error); return; }
    setShowEdit(false);
    loadDetail(detail.challan_id); load();
  };

  const isYarnBased = (jt) => jt === 'KNITTING' || jt === 'JOB_WORK';

  const [form,        setForm]        = useState(emptyForm());
  const [receiveForm, setReceiveForm] = useState(emptyReceive());

  // Standalone Receive Back form (header button)
  const [showReceiveNew, setShowReceiveNew] = useState(false);
  const [rcChallanId,    setRcChallanId]    = useState('');
  const [rcDetail,       setRcDetail]       = useState(null);
  const [rcRows,         setRcRows]         = useState([]);
  const [rcForm,         setRcForm]         = useState(emptyReceive());

  const load = async () => {
    const params = new URLSearchParams();
    if (filter)   params.set('status', filter);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo)   params.set('to', dateTo);
    const qs = params.toString() ? `?${params}` : '';
    const [c, b, y, pt] = await Promise.all([
      fetch(`${API}/api/subcontract/challans${qs}`).then(r => r.json()),
      Promise.all([
        fetch(`${API}/api/batches?status=SEALED`).then(r => r.json()),
        fetch(`${API}/api/batches?status=DYED`).then(r => r.json()),
      ]).then(([sealed, dyed]) => [...(sealed||[]), ...(dyed||[]).map(b => ({ ...b, _isDyed: true }))]),
      fetch(`${API}/api/yarn-store?status=IN_STORE`, { headers: { Authorization: `Bearer ${token()}` } }).then(r => r.json()),
      fetch(`${API}/api/erp/partners?limit=500`, { headers: { Authorization: `Bearer ${token()}` } }).then(r => r.json()),
    ]);
    setChallans(Array.isArray(c) ? c : []);
    setSealedBatches(Array.isArray(b) ? b : []);
    setYarnLots(Array.isArray(y) ? y : []);
    setPartners(Array.isArray(pt) ? pt : pt?.data || []);
    setLoading(false);
  };

  const loadDetail = async (id) => {
    const r = await fetch(`${API}/api/subcontract/challans/${id}`).then(r => r.json());
    setDetail(r);
  };

  useEffect(() => { load(); }, [filter, dateFrom, dateTo]);

  // Document view: auto-open the latest challan when none is selected
  useEffect(() => {
    if (tab !== 'RETURNS' && !detail) { const v = challans.filter(c => tab === 'KNITTING' ? c.challan_type === 'YARN_BASED' : c.job_type === tab); if (v.length > 0) loadDetail(v[0].challan_id); }
  }, [challans, tab]); // eslint-disable-line

  const flash = (m, err = false) => { setMsg(m); setMsgErr(err); setTimeout(() => setMsg(''), 3500); };

  const loadInvoices = async (status = invFilter) => {
    setInvLoading(true);
    try {
      const r = await fetch(`${API}/api/subcontract/invoices-pending?status=${status}`, { headers: { Authorization: `Bearer ${token()}` } });
      setInvoices(await r.json());
    } catch { setInvoices([]); }
    setInvLoading(false);
  };

  const loadPartyReport = async () => {
    setPartyLoading(true);
    try {
      const r = await fetch(`${API}/api/subcontract/party-report`, { headers: { Authorization: `Bearer ${token()}` } });
      setPartyData(await r.json());
    } catch { setPartyData([]); }
    setPartyLoading(false);
  };

  const autoFillRate = async (vendorName, jobType) => {
    if (!vendorName) return;
    try {
      const r = await fetch(`${API}/api/subcontract/last-rate?vendor_name=${encodeURIComponent(vendorName)}&job_type=${encodeURIComponent(jobType || '')}`);
      const d = await r.json();
      if (d.rate_per_kg) setForm(f => ({ ...f, rate_per_kg: String(d.rate_per_kg) }));
    } catch {}
  };

  const loadAnalytics = async () => {
    setAnalyticsLoading(true);
    try {
      const r = await fetch(`${API}/api/subcontract/analytics`, { headers: { Authorization: `Bearer ${token()}` } });
      setAnalytics(await r.json());
    } catch { setAnalytics(null); }
    setAnalyticsLoading(false);
  };

  const forwardToFinishing = async () => {
    if (!forwardForm.vendor_name) { flash('Vendor name required', true); return; }
    setSaving(true);
    const r = await fetch(`${API}/api/subcontract/challans/${detail.challan_id}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(forwardForm),
    });
    const d = await r.json();
    setSaving(false);
    if (!r.ok) { flash(d.error, true); return; }
    flash(`Forwarded → ${d.challan_number} created for finishing at ${forwardForm.vendor_name}`);
    setShowForward(false);
    setForwardForm({ vendor_name: '', vendor_contact: '', rate_per_kg: '', expected_return_date: '', notes: '' });
    load();
    loadDetail(d.challan_id);
  };

  const markPaid = async (receiptId) => {
    const r = await fetch(`${API}/api/subcontract/receipts/${receiptId}/invoice`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ payment_status: 'PAID' }),
    });
    if (r.ok) { flash('Marked as PAID'); loadInvoices(); }
    else { const d = await r.json(); flash(d.error || 'Failed', true); }
  };

  useEffect(() => { if (tab === 'invoices') loadInvoices(invFilter); }, [tab, invFilter]);

  const updateYarnRow = (idx, field, value) => {
    setYarnRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: value };
      if (field === 'lot_id') {
        const lot = yarnLots.find(l => String(l.lot_id) === String(value));
        if (lot) { updated.lot_number = lot.lot_number; updated.yarn_type = lot.yarn_type; updated.color = lot.color; }
      }
      return updated;
    }));
  };

  const createChallan = async (e) => {
    e.preventDefault();
    setSaving(true);
    if (isYarnBased(form.job_type)) {
      const filledRows = yarnRows.filter(r => r.lot_id && r.sent_kg);
      if (!filledRows.length) { flash('Add at least one yarn lot', true); setSaving(false); return; }
      const r = await fetch(`${API}/api/subcontract/knitting-challans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ ...form, yarn_items: filledRows }),
      });
      const d = await r.json();
      setSaving(false);
      if (!r.ok) { flash(d.error, true); return; }
      flash(`Challan ${d.challan_number} created — yarn sent to ${d.vendor_name}`);
    } else {
      if (!validFabricRows.length) { flash('Add at least one fabric / lot line', true); setSaving(false); return; }
      const r = await fetch(`${API}/api/subcontract/challans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          ...form,
          rate_per_kg: form.rate_per_kg || null,
          items: validFabricRows.map(r => ({ batch_id: parseInt(r.batch_id), fabric_type: r.fabric_type, color: r.color || null })),
        }),
      });
      const d = await r.json();
      setSaving(false);
      if (!r.ok) { flash(d.error, true); return; }
      flash(`Challan ${d.challan_number} created — sent to ${d.vendor_name}`);
    }
    setShowCreate(false);
    setForm(emptyForm());
    setYarnRows([emptyYarnRow()]);
    setFabricRows([emptyFabricRow()]);
    await load();
  };

  const receiveBack = async (e) => {
    e.preventDefault();
    if (!receiveForm.received_weight_kg) { flash('Enter received weight', true); return; }
    setSaving(true);
    const isKnitting = detail.challan_type === 'YARN_BASED';
    const endpoint = isKnitting
      ? `${API}/api/subcontract/knitting-challans/${detail.challan_id}/receive`
      : `${API}/api/subcontract/challans/${detail.challan_id}/receive`;
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(receiveForm),
    });
    const d = await r.json();
    setSaving(false);
    if (!r.ok) { flash(d.error, true); return; }
    const isDyeOnly = detail.job_type === 'DYEING';
    flash(isKnitting ? 'Rolls received — balance yarn returned to store' : isDyeOnly ? 'Dyed material received — batch ready for finishing' : 'Material received — finished goods entry created');
    setShowReceive(false);
    setReceiveForm(emptyReceive());
    load();
    loadDetail(detail.challan_id);
  };

  // ── Standalone receive-back helpers ──
  const outstandingChallans = challans.filter(c => c.status === 'SENT' || c.status === 'PARTIALLY_RECEIVED');

  // Sent-line reference (what went out, per fabric) — for dropdowns + shortage calc.
  // Received rows are entered MANUALLY: roll identity is lost in the wet process,
  // weights change, and NEW roll IDs are generated for the fabric coming back.
  const [rcSentLines, setRcSentLines] = useState([]);

  const selectRcChallan = async (id) => {
    setRcChallanId(id);
    setRcDetail(null); setRcRows([]); setRcSentLines([]);
    if (!id) return;
    const d = await fetch(`${API}/api/subcontract/challans/${id}`).then(r => r.json());
    setRcDetail(d);
    let sent;
    if ((d.fabric_items || []).length) {
      sent = d.fabric_items.map(it => ({
        fabric: it.fabric_type, batch_id: it.batch_id, lot: it.batch_number || d.batch_number,
        sent_kg: parseFloat(it.weight_kg) || 0,
      }));
    } else if ((d.rolls || []).length) {
      const g = {};
      d.rolls.forEach(r => {
        const f = r.fabric_type || 'Unknown';
        if (!g[f]) g[f] = { fabric: f, batch_id: d.batch_id, lot: d.batch_number, sent_kg: 0 };
        g[f].sent_kg += parseFloat(r.actual_weight_kg || 0);
      });
      sent = Object.values(g);
    } else {
      sent = [{ fabric: d.fabric_type || 'Material', batch_id: d.batch_id, lot: d.batch_number, sent_kg: parseFloat(d.sent_weight_kg) || 0 }];
    }
    setRcSentLines(sent);
    // Dyeing-only: fabric goes back out for finishing — just fabric-wise total weights.
    // Finishing: one row per physical roll, weighed & labeled with a NEW roll ID.
    if (d.job_type === 'DYEING') {
      setRcRows(sent.map(l => ({ fabric: l.fabric, color: '', weight: '' })));
    } else {
      setRcRows([{ fabric: '', color: '', weight: '' }]);
    }
  };

  const rcTotalReceived = rcRows.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);
  const rcTotalSent = rcSentLines.reduce((s, l) => s + l.sent_kg, 0);

  const submitReceiveNew = async (e) => {
    e.preventDefault();
    if (!rcDetail) { flash('Select a challan', true); return; }
    if (!rcTotalReceived) { flash('Enter received weight', true); return; }
    setSaving(true);
    const isKnitting = rcDetail.challan_type === 'YARN_BASED';
    const endpoint = isKnitting
      ? `${API}/api/subcontract/knitting-challans/${rcDetail.challan_id}/receive`
      : `${API}/api/subcontract/challans/${rcDetail.challan_id}/receive`;
    const validRows = rcRows.filter(r => r.fabric && parseFloat(r.weight) > 0);
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        ...rcForm,
        received_weight_kg: rcTotalReceived.toFixed(3),
        received_items: validRows.map(row => {
          const sl = rcSentLines.find(l => l.fabric === row.fabric);
          return { fabric_type: row.fabric, batch_id: sl?.batch_id || null, color: row.color || null, weight_kg: parseFloat(row.weight) };
        }),
      }),
    });
    const d = await r.json();
    setSaving(false);
    if (!r.ok) { flash(d.error, true); return; }
    const rollMsg = (d.new_rolls || []).length ? ` — ${d.new_rolls.length} new roll ID(s) generated` : '';
    flash(`Received against ${rcDetail.challan_number} — ${rcTotalReceived.toFixed(3)} kg${rollMsg}`);
    setShowReceiveNew(false); setRcChallanId(''); setRcDetail(null); setRcRows([]); setRcSentLines([]); setRcForm(emptyReceive());
    load();
  };

  const selectedBatch = sealedBatches.find(b => String(b.batch_id) === String(form.batch_id));

  // ── Fabric rows (roll-based challans): Fabric → Lot → Colour → rolls/weight auto ──
  const allFabricTypes = [...new Set(
    sealedBatches.flatMap(b => (b.fabric_breakdown || []).map(f => f.fabric_type))
  )].sort();

  const lotsForFabric = (fabric) => sealedBatches.filter(b =>
    (b.fabric_breakdown || []).some(f => f.fabric_type === fabric)
  );

  const updateFabricRow = (idx, field, value) => {
    setFabricRows(rows => rows.map((row, i) => {
      if (i !== idx) return row;
      const updated = { ...row, [field]: value };
      if (field === 'fabric_type') { updated.batch_id = ''; updated.roll_count = 0; updated.weight_kg = 0; }
      if (field === 'batch_id') {
        const lot = sealedBatches.find(b => String(b.batch_id) === String(value));
        const fb = (lot?.fabric_breakdown || []).find(f => f.fabric_type === updated.fabric_type);
        updated.roll_count = fb ? parseInt(fb.rolls) : 0;
        updated.weight_kg  = fb ? parseFloat(fb.kg) : 0;
      }
      return updated;
    }));
  };

  const addFabricRow    = () => setFabricRows(rows => [...rows, emptyFabricRow()]);
  const removeFabricRow = (idx) => setFabricRows(rows => rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows);
  const fabricRowsTotal = fabricRows.reduce((s, r) => s + parseFloat(r.weight_kg || 0), 0);
  const validFabricRows = fabricRows.filter(r => r.fabric_type && r.batch_id);

  // ── Process tabs: filter challans by process type ──
  const PROC_TABS = [
    { key: 'KNITTING',         label: 'Knitting' },
    { key: 'DYEING',           label: 'Dyeing' },
    { key: 'FINISHING',        label: 'Finishing' },
    { key: 'DYEING_FINISHING', label: 'Dyeing + Finishing' },
    { key: 'RETURNS',          label: 'Returns' },
  ];
  const matchTab = (c) => {
    if (tab === 'KNITTING') return c.challan_type === 'YARN_BASED';
    return c.job_type === tab;
  };
  const viewChallans = tab === 'RETURNS' ? [] : challans.filter(matchTab);
  const startNewChallan = () => {
    setForm({ ...emptyForm(), job_type: tab === 'KNITTING' ? 'KNITTING' : tab });
    setYarnRows([emptyYarnRow()]);
    setFabricRows([emptyFabricRow()]);
    setShowCreate(true); setDetail(null);
  };
  // Returns split per process
  const [retProc, setRetProc] = React.useState('DYEING');
  const retMatch = (c) => retProc === 'KNITTING' ? c.challan_type === 'YARN_BASED' : c.job_type === retProc;
  const retOutstanding = challans.filter(c => (c.status === 'SENT' || c.status === 'PARTIALLY_RECEIVED') && retMatch(c));
  const retDone = challans.filter(c => c.status === 'RECEIVED' && retMatch(c));

  return (
    <>
    <div style={{ padding: '24px', color: 'var(--text)', minHeight: showCreate ? 'auto' : '100vh', fontFamily: 'Inter, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h2 style={{ color: 'var(--gold)', fontSize: 24, margin: 0 }}>Subcontracting</h2>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0', fontSize: 13 }}>Send batches for dyeing/finishing → receive back → auto-creates finished goods</p>
        </div>
        {tab !== 'RETURNS' && (
          <button onClick={startNewChallan}
            style={{ background: 'var(--gold)', color: '#000', border: 'none', padding: '9px 18px', borderRadius: 7, fontWeight: 'bold', cursor: 'pointer', fontSize: 13 }}>
            + New {PROC_TABS.find(t => t.key === tab)?.label} Challan
          </button>
        )}
      </div>

      {/* Process tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--surface)' }}>
        {PROC_TABS.map(({ key, label }) => (
          <button key={key} onClick={() => { setTab(key); setDetail(null); }} style={{
            background: 'transparent', border: 'none', borderBottom: tab === key ? '2px solid var(--gold)' : '2px solid transparent',
            color: tab === key ? 'var(--gold)' : 'var(--muted)', padding: '8px 18px', cursor: 'pointer', fontWeight: tab === key ? 700 : 400, fontSize: 13, marginBottom: -1,
          }}>{label}</button>
        ))}
      </div>

      {msg && <div style={{ background: msgErr ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${msgErr ? 'var(--crit)' : 'var(--green)'}`, color: msgErr ? 'var(--crit)' : 'var(--green)', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontWeight: 'bold' }}>{msg}</div>}

      {/* ── RETURNS TAB (split per process) ── */}
      {tab === 'RETURNS' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[['DYEING', 'Dyeing Receipts'], ['FINISHING', 'Finishing Receipts'], ['DYEING_FINISHING', 'Dye+Finish Receipts'], ['KNITTING', 'Knitting Receipts']].map(([key, label]) => (
              <button key={key} onClick={() => setRetProc(key)}
                style={{ background: retProc === key ? 'var(--green)' : 'var(--surface)', color: retProc === key ? 'var(--bg)' : 'var(--muted)', border: '1px solid var(--surface-2)', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>{label}</button>
            ))}
          </div>

          {/* Outstanding — to receive */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ color: 'var(--gold-2)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Outstanding — awaiting receipt ({retOutstanding.length})</div>
            {retOutstanding.length === 0 ? <div style={{ color: 'var(--border)', fontSize: 13, padding: '8px 0' }}>Nothing outstanding for this process.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--surface)' }}>
                  {['Challan', 'Vendor', 'Sent Date', 'Expected', 'Sent (kg)', ''].map(hh => <th key={hh} style={{ padding: '7px 10px', textAlign: hh === 'Sent (kg)' ? 'right' : 'left', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', border: '1px solid var(--surface)' }}>{hh}</th>)}
                </tr></thead>
                <tbody>
                  {retOutstanding.map(c => (
                    <tr key={c.challan_id}>
                      <td style={{ padding: '7px 10px', color: 'var(--gold)', fontFamily: 'monospace', fontWeight: 700, border: '1px solid var(--surface)' }}>{c.challan_number}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text)', border: '1px solid var(--surface)' }}>{c.vendor_name}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--muted)', border: '1px solid var(--surface)' }}>{fmtDate(c.sent_date)}</td>
                      <td style={{ padding: '7px 10px', color: c.is_overdue ? 'var(--crit)' : 'var(--muted)', border: '1px solid var(--surface)' }}>{fmtDate(c.expected_return_date)}{c.is_overdue ? ' ⚠' : ''}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text)', textAlign: 'right', border: '1px solid var(--surface)' }}>{parseFloat(c.sent_weight_kg || 0).toFixed(3)}</td>
                      <td style={{ padding: '5px 10px', border: '1px solid var(--surface)', textAlign: 'center' }}>
                        <button onClick={() => { setShowReceiveNew(true); setDetail(null); selectRcChallan(String(c.challan_id)); }}
                          style={{ background: 'var(--green)', color: 'var(--bg)', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>⬇ Receive</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Received — done */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ color: 'var(--green)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Received ({retDone.length})</div>
            {retDone.length === 0 ? <div style={{ color: 'var(--border)', fontSize: 13, padding: '8px 0' }}>No receipts yet for this process.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--surface)' }}>
                  {['Challan', 'Vendor', 'Sent (kg)', ''].map(hh => <th key={hh} style={{ padding: '7px 10px', textAlign: hh === 'Sent (kg)' ? 'right' : 'left', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', border: '1px solid var(--surface)' }}>{hh}</th>)}
                </tr></thead>
                <tbody>
                  {retDone.map(c => (
                    <tr key={c.challan_id}>
                      <td style={{ padding: '7px 10px', color: 'var(--gold)', fontFamily: 'monospace', fontWeight: 700, border: '1px solid var(--surface)' }}>{c.challan_number}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text)', border: '1px solid var(--surface)' }}>{c.vendor_name}</td>
                      <td style={{ padding: '7px 10px', color: 'var(--text)', textAlign: 'right', border: '1px solid var(--surface)' }}>{parseFloat(c.sent_weight_kg || 0).toFixed(3)}</td>
                      <td style={{ padding: '5px 10px', border: '1px solid var(--surface)', textAlign: 'center' }}>
                        <button onClick={() => { setTab(c.challan_type === 'YARN_BASED' ? 'KNITTING' : c.job_type); setTimeout(() => loadDetail(c.challan_id), 30); }}
                          style={{ background: 'var(--border)', color: 'var(--link)', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>View challan</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── INVOICES TAB ── */}
      {tab === 'invoices' && (
        <div>
          {/* Pending / Paid / All filter */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[['pending', 'Pending'], ['paid', 'Paid'], ['all', 'All']].map(([key, label]) => (
              <button key={key} onClick={() => setInvFilter(key)}
                style={{ background: invFilter === key ? 'var(--gold)' : 'var(--surface)', color: invFilter === key ? '#000' : 'var(--muted)', border: '1px solid var(--surface-2)', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 12 }}>
                {label}
              </button>
            ))}
          </div>
          {invLoading ? (
            <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Loading...</div>
          ) : invoices.length === 0 ? (
            <div style={{ color: 'var(--green)', textAlign: 'center', padding: 60, fontSize: 15 }}>
              {invFilter === 'paid' ? 'No paid invoices yet.' : invFilter === 'all' ? 'No vendor invoices yet.' : '✓ No pending vendor invoices — all bills settled!'}
            </div>
          ) : (
            <>
              {/* Summary bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
                {[
                  [invFilter === 'paid' ? 'PAID BILLS' : invFilter === 'all' ? 'TOTAL BILLS' : 'PENDING BILLS', invoices.length, 'var(--gold)'],
                  ['TOTAL EXPECTED', `₹${invoices.reduce((s,i) => s + parseFloat(i.expected_amount||0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'var(--link)'],
                  ['TOTAL BILLED', `₹${invoices.reduce((s,i) => s + parseFloat(i.vendor_bill_amount||0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'var(--pink)'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 10, padding: '14px 18px' }}>
                    <div style={{ fontSize: 10, color: 'var(--border)', letterSpacing: 1, marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Invoice table */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      {['Challan', 'Vendor', 'Received Date', 'Wt (kg)', 'Rate/kg', 'Expected ₹', 'Invoice No.', 'Billed ₹', 'Variance', 'Status', 'Action'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', borderBottom: '1px solid var(--surface)', textAlign: 'left', color: 'var(--border)', fontSize: 11, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map(inv => {
                      const expected = parseFloat(inv.expected_amount || 0);
                      const billed   = parseFloat(inv.vendor_bill_amount || 0);
                      const variance = billed - expected;
                      const varColor = Math.abs(variance) < 0.01 ? 'var(--green)' : variance > 0 ? 'var(--crit)' : 'var(--gold)';
                      return (
                        <tr key={inv.receipt_id} style={{ borderBottom: '1px solid var(--surface)' }}>
                          <td style={{ padding: '10px 12px', color: 'var(--gold)', fontFamily: 'monospace', fontWeight: 700 }}>{inv.challan_number}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{inv.vendor_name}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{fmtDate(inv.received_date)}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{parseFloat(inv.received_weight_kg).toFixed(3)}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{inv.rate_per_kg ? `₹${inv.rate_per_kg}` : '—'}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--link)', fontWeight: 700 }}>{expected > 0 ? `₹${expected.toFixed(2)}` : '—'}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--muted)', fontFamily: 'monospace', fontSize: 12 }}>{inv.vendor_invoice_no || <span style={{ color: 'var(--border)' }}>not entered</span>}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--pink)', fontWeight: 700 }}>{billed > 0 ? `₹${billed.toFixed(2)}` : <span style={{ color: 'var(--border)' }}>—</span>}</td>
                          <td style={{ padding: '10px 12px', color: varColor, fontWeight: 700 }}>
                            {billed > 0 && expected > 0 ? (variance >= 0 ? '+' : '') + `₹${variance.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ background: inv.payment_status === 'PAID' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)', color: inv.payment_status === 'PAID' ? 'var(--green)' : 'var(--gold)', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                              {inv.payment_status || 'PENDING'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {inv.payment_status !== 'PAID' && (
                              <button onClick={() => markPaid(inv.receipt_id)}
                                style={{ background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid #22c55e44', padding: '4px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                                Mark PAID
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── PARTY REPORT TAB ── */}
      {tab === 'party' && (() => {
        const filtered = partyJobFilter ? partyData.filter(c => c.job_type === partyJobFilter || c.job_type === 'DYEING_FINISHING') : partyData;
        const vendors = {};
        filtered.forEach(c => {
          const v = c.vendor_name || 'Unknown';
          if (!vendors[v]) vendors[v] = { challans: [], contact: c.vendor_contact, totalSent: 0, totalReceived: 0, pending: 0, overdue: 0, pendingKg: 0 };
          vendors[v].challans.push(c);
          const sentKg = parseFloat(c.sent_weight_kg || 0);
          const recvKg = parseFloat(c.total_received_kg || 0);
          vendors[v].totalSent += sentKg;
          vendors[v].totalReceived += recvKg;
          if (c.status === 'SENT' || c.status === 'PARTIALLY_RECEIVED') { vendors[v].pending++; vendors[v].pendingKg += sentKg - recvKg; }
          if (c.is_overdue) vendors[v].overdue++;
        });
        const vendorList = Object.entries(vendors).sort((a, b) => b[1].overdue - a[1].overdue || b[1].pending - a[1].pending);
        const totalPending = vendorList.reduce((s, [, v]) => s + v.pending, 0);
        const totalOverdue = vendorList.reduce((s, [, v]) => s + v.overdue, 0);
        const totalPendingKg = vendorList.reduce((s, [, v]) => s + v.pendingKg, 0);

        return <div>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            {[
              ['VENDORS', vendorList.length, 'var(--link)'],
              ['PENDING LOTS', totalPending, 'var(--gold)'],
              ['OVERDUE', totalOverdue, totalOverdue > 0 ? 'var(--crit)' : 'var(--green)'],
              ['PENDING WEIGHT', `${totalPendingKg.toFixed(1)} kg`, 'var(--purple)'],
            ].map(([label, val, color]) => (
              <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 10, padding: '14px 18px' }}>
                <div style={{ fontSize: 10, color: 'var(--border)', letterSpacing: 1, marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Job type filter */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[['', 'All'], ['DYEING', 'Dyeing'], ['FINISHING', 'Finishing'], ['KNITTING', 'Knitting']].map(([key, label]) => (
              <button key={key} onClick={() => setPartyJobFilter(key)}
                style={{ background: partyJobFilter === key ? 'var(--gold)' : 'var(--surface)', color: partyJobFilter === key ? '#000' : 'var(--muted)', border: '1px solid var(--surface-2)', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 12 }}>
                {label}
              </button>
            ))}
          </div>

          {partyLoading ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Loading...</div>
          : vendorList.length === 0 ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>No challans found.</div>
          : vendorList.map(([vName, vData]) => (
            <div key={vName} style={{ marginBottom: 12, background: 'var(--surface)', border: `1px solid ${vData.overdue > 0 ? 'var(--crit)' : 'var(--surface-2)'}`, borderRadius: 10, overflow: 'hidden' }}>
              {/* Vendor header — clickable */}
              <div onClick={() => setExpandedVendor(expandedVendor === vName ? null : vName)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', cursor: 'pointer', background: vData.overdue > 0 ? 'rgba(239,68,68,0.08)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold)' }}>{vName}</span>
                  {vData.contact && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{vData.contact}</span>}
                  {vData.overdue > 0 && <span style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--crit)', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{vData.overdue} OVERDUE</span>}
                </div>
                <div style={{ display: 'flex', gap: 20, alignItems: 'center', fontSize: 12 }}>
                  <StatCell label="Total Challans" value={vData.challans.length} />
                  <StatCell label="Pending" value={vData.pending} color={vData.pending > 0 ? 'var(--gold)' : 'var(--green)'} />
                  <StatCell label="Sent (kg)" value={vData.totalSent.toFixed(1)} />
                  <StatCell label="Received (kg)" value={vData.totalReceived.toFixed(1)} color="var(--green)" />
                  <StatCell label="Pending (kg)" value={vData.pendingKg.toFixed(1)} color={vData.pendingKg > 0 ? 'var(--gold)' : 'var(--green)'} />
                  <span style={{ color: 'var(--border)', fontSize: 16 }}>{expandedVendor === vName ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded challan list */}
              {expandedVendor === vName && (
                <div style={{ borderTop: '1px solid var(--surface)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface)' }}>
                        {['Challan', 'Job Type', 'Batch', 'Sent Date', 'Expected', 'Days Out', 'Sent (kg)', 'Received (kg)', 'Pending (kg)', 'Status'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', borderBottom: '1px solid var(--surface)', textAlign: 'left', color: 'var(--border)', fontSize: 10, letterSpacing: 0.5 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vData.challans.map(c => {
                        const sentKg = parseFloat(c.sent_weight_kg || 0);
                        const recvKg = parseFloat(c.total_received_kg || 0);
                        const pendKg = c.status === 'RECEIVED' ? 0 : sentKg - recvKg;
                        const isPending = c.status === 'SENT' || c.status === 'PARTIALLY_RECEIVED';
                        return (
                          <tr key={c.challan_id} style={{
                            background: c.is_overdue ? 'rgba(239,68,68,0.1)' : isPending ? 'rgba(245,158,11,0.05)' : 'transparent',
                            borderLeft: c.is_overdue ? '3px solid var(--crit)' : isPending ? '3px solid var(--gold)' : '3px solid transparent',
                          }}>
                            <td style={{ padding: '8px 10px', color: 'var(--gold)', fontFamily: 'monospace', fontWeight: 'bold' }}>{c.challan_number}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text)' }}>{c.job_type?.replace('_', ' + ')}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{c.batch_number || '—'}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text)' }}>{fmtDate(c.sent_date)}</td>
                            <td style={{ padding: '8px 10px', color: c.is_overdue ? 'var(--crit)' : 'var(--text)', fontWeight: c.is_overdue ? 700 : 400 }}>{fmtDate(c.expected_return_date)}</td>
                            <td style={{ padding: '8px 10px', color: c.days_out > 10 ? 'var(--crit)' : c.days_out > 5 ? 'var(--gold)' : 'var(--text)', fontWeight: 'bold' }}>{c.days_out}d</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text)' }}>{sentKg.toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--green)' }}>{recvKg.toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', color: pendKg > 0 ? 'var(--gold)' : 'var(--green)', fontWeight: 'bold' }}>{pendKg.toFixed(2)}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{ background: `${STATUS_COLOR[c.status] || 'var(--surface-2)'}22`, color: STATUS_COLOR[c.status] || 'var(--muted)', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700 }}>
                                {c.status}{c.is_overdue ? ' ⚠' : ''}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {/* ── PENDING LOTS — DYEING & FINISHING ── */}
          {(() => {
            const pendingLots = partyData.filter(c =>
              (c.status === 'SENT' || c.status === 'PARTIALLY_RECEIVED') &&
              (c.job_type === 'DYEING' || c.job_type === 'FINISHING' || c.job_type === 'DYEING_FINISHING')
            ).sort((a, b) => (b.is_overdue ? 1 : 0) - (a.is_overdue ? 1 : 0) || a.days_out - b.days_out);

            if (pendingLots.length === 0) return null;
            return (
              <div style={{ marginTop: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--gold)' }}>Pending Lots — Dyeing & Finishing</div>
                  <span style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--crit)', padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                    {pendingLots.filter(c => c.is_overdue).length} Overdue
                  </span>
                  <span style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--gold)', padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
                    {pendingLots.length} Pending
                  </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface)' }}>
                        {['#', 'Challan', 'Vendor', 'Job Type', 'Batch / Fabric', 'Colour', 'Sent Date', 'Expected', 'Days Out', 'Sent (kg)', 'Received (kg)', 'Pending (kg)', 'Status'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', borderBottom: '2px solid var(--gold)', textAlign: 'left', color: 'var(--gold)', fontSize: 10, letterSpacing: 0.5 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pendingLots.map((c, i) => {
                        const sentKg = parseFloat(c.sent_weight_kg || 0);
                        const recvKg = parseFloat(c.total_received_kg || 0);
                        const pendKg = sentKg - recvKg;
                        return (
                          <tr key={c.challan_id} style={{
                            background: c.is_overdue ? 'rgba(239,68,68,0.12)' : i % 2 === 0 ? 'var(--surface)' : 'var(--surface)',
                            borderLeft: c.is_overdue ? '4px solid var(--crit)' : '4px solid var(--gold)',
                            animation: c.is_overdue ? 'none' : 'none',
                          }}>
                            <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{i + 1}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--gold)', fontFamily: 'monospace', fontWeight: 'bold' }}>{c.challan_number}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text)', fontWeight: 600 }}>{c.vendor_name}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--link)' }}>{c.job_type?.replace('_', ' + ')}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text)' }}>{c.batch_number || '—'}{c.fabric_type ? ` · ${c.fabric_type}` : ''}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{c.color_name || '—'}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--text)' }}>{fmtDate(c.sent_date)}</td>
                            <td style={{ padding: '8px 10px', color: c.is_overdue ? 'var(--crit)' : 'var(--text)', fontWeight: c.is_overdue ? 700 : 400 }}>
                              {fmtDate(c.expected_return_date)}{c.is_overdue ? ' ⚠' : ''}
                            </td>
                            <td style={{ padding: '8px 10px', color: c.is_overdue ? 'var(--crit)' : c.days_out > 5 ? 'var(--gold)' : 'var(--green)', fontWeight: 700, fontSize: 13 }}>
                              {c.days_out}d
                            </td>
                            <td style={{ padding: '8px 10px', color: 'var(--text)' }}>{sentKg.toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--green)' }}>{recvKg.toFixed(2)}</td>
                            <td style={{ padding: '8px 10px', color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>{pendKg.toFixed(2)}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{ background: c.is_overdue ? 'rgba(239,68,68,0.2)' : `${STATUS_COLOR[c.status]}22`, color: c.is_overdue ? 'var(--crit)' : STATUS_COLOR[c.status], padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 700 }}>
                                {c.is_overdue ? 'OVERDUE' : c.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>;
      })()}

      {/* ── CHALLANS TAB ── */}
      {tab !== 'RETURNS' && tab !== 'invoices' && tab !== 'party' && tab !== 'analytics' && !showCreate && <div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {['', 'SENT', 'RECEIVED', 'CANCELLED'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ background: filter === s ? 'var(--gold)' : 'var(--surface)', color: filter === s ? '#000' : 'var(--muted)', border: '1px solid var(--surface-2)', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 12 }}>
            {s || 'All'}
          </button>
        ))}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', color: 'var(--text)', borderRadius: 5, padding: '5px 8px', fontSize: 12 }} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', color: 'var(--text)', borderRadius: 5, padding: '5px 8px', fontSize: 12 }} />
          {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>}
        </div>
        <button onClick={() => {
          const rows = [['Challan No', 'Vendor', 'Job Type', 'Batch', 'Sent Date', 'Weight (kg)', 'Status', 'Rate/kg'].join(',')];
          challans.forEach(c => rows.push([c.challan_number, c.vendor_name, c.job_type, c.batch_number||'', c.sent_date?.slice(0,10)||'', parseFloat(c.sent_weight_kg||0).toFixed(3), c.status, c.rate_per_kg||''].join(',')));
          const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `SC_${Date.now()}.csv`; a.click();
        }} style={{ marginLeft: 'auto', background: 'var(--border)', color: 'var(--link)', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }}>
          ⬇ CSV
        </button>
      </div>

      {/* ── Document navigator (one challan at a time, like legacy Dyeing Recd) ── */}
      {(() => {
        const docIdx = viewChallans.findIndex(c => c.challan_id === detail?.challan_id);
        const navTo = (i) => { if (i >= 0 && i < viewChallans.length) { loadDetail(viewChallans[i].challan_id); setShowReceive(false); } };
        const cur = docIdx >= 0 ? viewChallans[docIdx] : null;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
            <button onClick={startNewChallan} style={{ background: 'var(--green)', color: 'var(--bg)', border: 'none', padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+ Add</button>
            <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Challan</span>
            <select value={detail?.challan_id || ''} onChange={e => e.target.value && loadDetail(e.target.value)}
              style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', color: 'var(--gold)', borderRadius: 6, padding: '7px 10px', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, minWidth: 280 }}>
              <option value="">— List View ({viewChallans.length}) —</option>
              {viewChallans.map(c => (
                <option key={c.challan_id} value={c.challan_id}>
                  {c.challan_number} · {c.vendor_name} · {c.job_type} · {c.status}
                </option>
              ))}
            </select>
            {cur && (
              <>
                <span style={{ background: `${STATUS_COLOR[cur.status]}22`, color: STATUS_COLOR[cur.status], padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 'bold' }}>{cur.status}</span>
                {cur.is_overdue && <span style={{ color: 'var(--crit)', fontSize: 11, fontWeight: 'bold' }}>OVERDUE</span>}
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{viewChallans.length - docIdx} / {viewChallans.length}</span>
              </>
            )}
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              <button onClick={() => navTo(docIdx + 1)} disabled={docIdx < 0 || docIdx >= viewChallans.length - 1}
                style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', color: docIdx >= viewChallans.length - 1 ? 'var(--surface-2)' : 'var(--link)', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>◀ Previous</button>
              <button onClick={() => navTo(docIdx - 1)} disabled={docIdx <= 0}
                style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', color: docIdx <= 0 ? 'var(--surface-2)' : 'var(--link)', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Next ▶</button>
              <button onClick={() => navTo(0)} disabled={!viewChallans.length}
                style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', color: 'var(--gold-2)', padding: '7px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>⏭ Move Last</button>
            </div>
          </div>
        );
      })()}

      {loading ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Loading...</div>
        : viewChallans.length === 0 ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>No {PROC_TABS.find(t => t.key === tab)?.label} challans yet — click + Add to create the first one.</div>
        : !detail ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Select a challan from List View, or use ⏭ Move Last for the latest.</div>
        : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>

        {/* Detail panel */}
        {detail && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 12, overflow: 'hidden', minHeight: 560, display: 'flex', flexDirection: 'column' }}>

            {/* ── Standard header field grid ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderBottom: '1px solid var(--surface-2)' }}>
              {[
                ['Challan No.', detail.challan_number, 'var(--gold)'],
                ['Date', fmtDate(detail.sent_date)],
                ['Party / Vendor', detail.vendor_name],
                ['Job Type', detail.job_type?.replace('_', ' + ')],
                ['Lot No.', detail.batch_number || '—'],
                ['Expected Return', fmtDate(detail.expected_return_date)],
                ['Rate / kg', detail.rate_per_kg ? `₹${parseFloat(detail.rate_per_kg).toFixed(2)}` : '—'],
                ['Sent Weight', `${parseFloat(detail.sent_weight_kg || 0).toFixed(3)} kg`],
              ].map(([label, val, color], i) => (
                <div key={label} style={{ padding: '10px 14px', borderRight: (i + 1) % 4 !== 0 ? '1px solid var(--surface)' : 'none', borderTop: i >= 4 ? '1px solid var(--surface)' : 'none' }}>
                  <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3, fontWeight: 700 }}>{label}</div>
                  <div style={{ color: color || 'var(--text)', fontSize: 14, fontWeight: 700, fontFamily: label === 'Challan No.' ? 'monospace' : 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{val || '—'}</div>
                </div>
              ))}
            </div>

            {/* ── Standard items table ── */}
            <div style={{ flex: 1, padding: '14px 16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ background: 'var(--surface)' }}>
                    {[['Sr', 40], ['Item Name', null], ['Colour / Shade', 130], ['Lot No', 110], ['Rolls', 60], ['Qty (kg)', 100]].map(([h, w]) => (
                      <th key={h} style={{ width: w || 'auto', padding: '8px 10px', textAlign: h === 'Qty (kg)' || h === 'Rolls' ? 'right' : 'left', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, border: '1px solid var(--surface)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let lines;
                    if (detail.challan_type === 'YARN_BASED') {
                      lines = (detail.yarn_items || []).map(y => ({
                        item: y.item_name || y.yarn_type, color: y.color, lot: y.lot_number, rolls: '—', kg: parseFloat(y.sent_kg || 0),
                      }));
                    } else if ((detail.fabric_items || []).length) {
                      lines = detail.fabric_items.map(it => ({
                        item: it.fabric_type, color: it.color, lot: it.batch_number || detail.batch_number,
                        rolls: parseInt(it.roll_count) || 0, kg: parseFloat(it.weight_kg) || 0,
                      }));
                    } else {
                      const g = {};
                      (detail.rolls || []).forEach(r => {
                        const f = r.fabric_type || 'Unknown';
                        if (!g[f]) g[f] = { item: f, color: detail.color_name, lot: detail.batch_number, rolls: 0, kg: 0 };
                        g[f].rolls += 1; g[f].kg += parseFloat(r.actual_weight_kg || 0);
                      });
                      lines = Object.values(g);
                    }
                    const totalKg = lines.reduce((s, l) => s + (parseFloat(l.kg) || 0), 0);
                    const totalRolls = lines.reduce((s, l) => s + (parseInt(l.rolls) || 0), 0);
                    const MIN_ROWS = 6;
                    const blanks = Math.max(0, MIN_ROWS - lines.length);
                    return <>
                      {lines.map((l, i) => (
                        <tr key={i} style={{ background: i % 2 === 1 ? 'var(--surface)' : 'transparent' }}>
                          <td style={{ padding: '7px 10px', color: 'var(--muted)', fontSize: 12, border: '1px solid var(--surface)' }}>{i + 1}</td>
                          <td style={{ padding: '7px 10px', color: 'var(--gold)', fontSize: 13, fontWeight: 700, border: '1px solid var(--surface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.item}</td>
                          <td style={{ padding: '7px 10px', color: 'var(--pink)', fontSize: 12, border: '1px solid var(--surface)' }}>{l.color || '—'}</td>
                          <td style={{ padding: '7px 10px', color: 'var(--muted)', fontSize: 12, fontFamily: 'monospace', border: '1px solid var(--surface)' }}>{l.lot || '—'}</td>
                          <td style={{ padding: '7px 10px', color: 'var(--text)', fontSize: 13, textAlign: 'right', border: '1px solid var(--surface)' }}>{l.rolls}</td>
                          <td style={{ padding: '7px 10px', color: 'var(--text)', fontSize: 13, fontWeight: 700, textAlign: 'right', border: '1px solid var(--surface)' }}>{(parseFloat(l.kg) || 0).toFixed(3)}</td>
                        </tr>
                      ))}
                      {Array.from({ length: blanks }).map((_, i) => (
                        <tr key={`b${i}`} style={{ background: (lines.length + i) % 2 === 1 ? 'var(--surface)' : 'transparent' }}>
                          {Array.from({ length: 6 }).map((__, j) => <td key={j} style={{ padding: '7px 10px', border: '1px solid var(--surface)', fontSize: 13 }}>&nbsp;</td>)}
                        </tr>
                      ))}
                      <tr style={{ background: 'var(--surface)' }}>
                        <td colSpan={4} style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 12, fontWeight: 700, textAlign: 'right', border: '1px solid var(--surface)' }}>TOTAL</td>
                        <td style={{ padding: '8px 10px', color: 'var(--gold)', fontSize: 13, fontWeight: 700, textAlign: 'right', border: '1px solid var(--surface)' }}>{totalRolls || '—'}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--gold)', fontSize: 13, fontWeight: 700, textAlign: 'right', border: '1px solid var(--surface)' }}>{totalKg.toFixed(3)}</td>
                      </tr>
                    </>;
                  })()}
                </tbody>
              </table>

              {/* ── Receipts (standard table) ── */}
              {(detail.receipts || []).length > 0 && (() => {
                const sentKg = parseFloat(detail.sent_weight_kg || 0);
                const totalRecvKg = detail.receipts.reduce((s, r) => s + parseFloat(r.received_weight_kg || 0), 0);
                const wastagePct = sentKg > 0 ? ((sentKg - totalRecvKg) / sentKg * 100) : 0;
                const overTolerance = wastagePct > 2 && detail.status === 'RECEIVED';
                return (
                  <div style={{ marginTop: 14 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                      <thead>
                        <tr style={{ background: 'var(--green-dim)' }}>
                          {[['Received Date', 120], ['Received (kg)', null], ['Quality', 90], ['Rejected (kg)', 110], ['Invoice', 120], ['Bill ₹', 100]].map(([h, w]) => (
                            <th key={h} style={{ width: w || 'auto', padding: '7px 10px', textAlign: 'left', color: 'var(--green-edge)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, border: '1px solid #14532d55' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.receipts.map(r => (
                          <tr key={r.receipt_id}>
                            <td style={{ padding: '6px 10px', color: 'var(--green)', fontSize: 12, fontWeight: 700, border: '1px solid #14532d55' }}>{fmtDate(r.received_date)}</td>
                            <td style={{ padding: '6px 10px', color: 'var(--text)', fontSize: 12, fontWeight: 700, border: '1px solid #14532d55' }}>{parseFloat(r.received_weight_kg).toFixed(3)}</td>
                            <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12, border: '1px solid #14532d55' }}>{r.quality_status}</td>
                            <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12, border: '1px solid #14532d55' }}>{r.rejected_weight_kg}</td>
                            <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12, border: '1px solid #14532d55' }}>{r.vendor_invoice_no || '—'}</td>
                            <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12, border: '1px solid #14532d55' }}>{r.vendor_bill_amount ? parseFloat(r.vendor_bill_amount).toFixed(2) : '—'}</td>
                          </tr>
                        ))}
                        {detail.status === 'RECEIVED' && (
                          <tr style={{ background: overTolerance ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)' }}>
                            <td colSpan={6} style={{ padding: '7px 10px', fontSize: 12, border: '1px solid #14532d55', color: overTolerance ? 'var(--crit)' : 'var(--green)', fontWeight: 700 }}>
                              Shortage: {wastagePct.toFixed(2)}% ({(sentKg - totalRecvKg).toFixed(3)} kg) {overTolerance ? '⚠ exceeds 2% tolerance' : '✓ within tolerance'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* ── Standard bottom button strip (legacy style) ── */}
            <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--surface-2)', background: 'var(--surface)', flexWrap: 'wrap' }}>
              {(detail.status === 'SENT' || detail.status === 'PARTIALLY_RECEIVED') && (
                <button onClick={() => { setShowReceiveNew(true); selectRcChallan(String(detail.challan_id)); }}
                  style={{ background: 'var(--green)', color: 'var(--bg)', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>⬇ Receive Back</button>
              )}
              {detail.status === 'RECEIVED' && detail.job_type === 'DYEING' && (
                <button onClick={() => setShowForward(true)} style={{ background: 'var(--surface)', color: 'var(--text)', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>→ Forward to Finishing</button>
              )}
              <button onClick={() => setPrinting('SC_CHALLAN')} style={{ background: 'var(--border)', color: 'var(--link)', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>🖨 Challan</button>
              {detail.challan_type !== 'YARN_BASED' && (detail.rolls || []).length > 0 && (
                <button onClick={() => setPrinting('PACKING_LIST')} style={{ background: 'var(--border)', color: 'var(--gold-2)', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>🖨 Packing List</button>
              )}
              {detail.receipts?.length > 0 && (
                <button onClick={() => setPrinting('SC_RECEIPT')} style={{ background: 'var(--green-dim)', color: 'var(--green-edge)', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>🖨 Receipt</button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                {(detail.status === 'SENT' || detail.status === 'PARTIALLY_RECEIVED') && (<>
                  <button onClick={startEditChallan} style={{ background: 'var(--link)', color: 'var(--text)', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>✎ Edit</button>
                  <button onClick={async () => { if (!window.confirm("CANCEL this challan? Number stays, stock reverted.")) return; const r = await fetch(`${API}/api/subcontract/challans/${detail.challan_id}/cancel`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` } }); if (!r.ok) { const e = await r.json(); alert(e.error); return; } setDetail(null); load(); }}
                    style={{ background: 'var(--crit)', color: 'var(--text)', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>✕ Cancel</button>
                  <button onClick={async () => { if (!window.confirm("DELETE this challan completely? Number will be freed.")) return; const r = await fetch(`${API}/api/subcontract/challans/${detail.challan_id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token()}` } }); if (!r.ok) { const e = await r.json(); alert(e.error); return; } setDetail(null); load(); }}
                    style={{ background: 'var(--crit)', color: 'var(--text)', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>🗑 Delete</button>
                </>)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div> }

    </div>

    {/* ── New SC Challan — inline (in place of navigator) ── */}
    {showCreate && (
      <div style={{ padding: '0 24px 24px' }}>
        <form onSubmit={createChallan} style={{ background: 'var(--bg)', border: '1px solid var(--gold)', borderRadius: 10, width: '100%', margin: '0 auto', padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div>
              <h3 style={{ color: 'var(--gold)', margin: 0, fontSize: 18 }}>New {PROC_TABS.find(t => t.key === (form.job_type === 'JOB_WORK' ? 'KNITTING' : form.job_type))?.label || ''} Challan</h3>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>Fill lot + vendor details — create in one step</div>
            </div>
            <button type="button" onClick={() => { setShowCreate(false); setForm(emptyForm()); }}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>✕ Cancel</button>
          </div>

          {/* Knitting tab: choose Outsource vs Job Work (other tabs are fixed by the tab) */}
          {(tab === 'KNITTING') && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, fontWeight: 700 }}>Knitting Type</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { jt: 'KNITTING', label: 'Outsource Knitting', desc: 'Send yarn → greige rolls + balance yarn back' },
                  { jt: 'JOB_WORK', label: 'Job Work (Inward)', desc: 'Customer sends yarn → we knit → return rolls' },
                ].map(({ jt, label, desc }) => (
                  <div key={jt} onClick={() => setForm(f => ({ ...f, job_type: jt }))}
                    style={{ flex: '1 1 200px', background: form.job_type === jt ? 'rgba(201,162,39,0.1)' : 'var(--surface)', border: `1.5px solid ${form.job_type === jt ? 'var(--gold)' : 'var(--surface)'}`, borderRadius: 8, padding: '10px 12px', cursor: 'pointer' }}>
                    <div style={{ color: form.job_type === jt ? 'var(--gold)' : 'var(--text)', fontWeight: 600, fontSize: 13 }}>{label}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 3 }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KNITTING: yarn lot rows */}
          {isYarnBased(form.job_type) && (
            <div style={{ background: 'var(--surface)', border: '1px solid #a78bfa44', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ color: 'var(--purple)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
                  {form.job_type === 'JOB_WORK' ? 'Customer Yarn to Receive & Process' : 'Yarn Lots to Send for Knitting'}
                </div>
                <button type="button" onClick={() => setYarnRows(p => [...p, emptyYarnRow()])}
                  style={{ background: 'var(--border)', color: 'var(--purple)', border: '1px solid var(--purple)', borderRadius: 5, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>+ Add Row</button>
              </div>
              {form.job_type === 'JOB_WORK' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={lbl}>Customer Name (yarn source) *</label>
                  <input style={inp} placeholder="Who is sending the yarn?" value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} />
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--surface)' }}>
                    {['#', form.job_type === 'JOB_WORK' ? 'Yarn Description' : 'Yarn Lot (Yarn Store)', 'Yarn Type', 'Colour', 'Qty to Send (kg)', ''].map(c => (
                      <th key={c} style={{ padding: '7px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {yarnRows.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--surface)' }}>
                      <td style={{ padding: '5px 8px', color: 'var(--muted)', width: 24 }}>{idx + 1}</td>
                      <td style={{ padding: '4px 6px', minWidth: 180 }}>
                        {form.job_type === 'JOB_WORK' ? (
                          <input value={row.lot_number} onChange={e => updateYarnRow(idx, 'lot_number', e.target.value)} style={{ ...inp, padding: '5px 6px', fontSize: 12 }} placeholder="Lot / KOT no." />
                        ) : (
                          <select value={row.lot_id} onChange={e => updateYarnRow(idx, 'lot_id', e.target.value)} style={{ ...inp, padding: '5px 6px', fontSize: 12 }}>
                            <option value="">— Select lot —</option>
                            {yarnLots.map(l => <option key={l.lot_id} value={l.lot_id}>{l.lot_number} — {l.yarn_type} ({parseFloat(l.current_stock_kg).toFixed(1)} kg)</option>)}
                          </select>
                        )}
                      </td>
                      <td style={{ padding: '4px 6px', width: 100 }}>
                        <input value={row.yarn_type} onChange={e => updateYarnRow(idx, 'yarn_type', e.target.value)} style={{ ...inp, padding: '5px 6px', fontSize: 12 }} placeholder="30s cotton" />
                      </td>
                      <td style={{ padding: '4px 6px', width: 80 }}>
                        <input value={row.color} onChange={e => updateYarnRow(idx, 'color', e.target.value)} style={{ ...inp, padding: '5px 6px', fontSize: 12 }} placeholder="Grey" />
                      </td>
                      <td style={{ padding: '4px 6px', width: 100 }}>
                        <input type="number" step="0.001" value={row.sent_kg} onChange={e => updateYarnRow(idx, 'sent_kg', e.target.value)} style={{ ...inp, padding: '5px 6px', fontSize: 12 }} placeholder="0.000" />
                      </td>
                      <td style={{ padding: '4px 6px', width: 28 }}>
                        <button type="button" onClick={() => setYarnRows(p => p.length === 1 ? p : p.filter((_, i) => i !== idx))}
                          style={{ background: 'transparent', border: 'none', color: 'var(--crit)', cursor: 'pointer', fontSize: 16 }}>×</button>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--surface)', fontWeight: 700 }}>
                    <td colSpan={4} style={{ padding: '7px 8px', color: 'var(--muted)', fontSize: 11 }}>TOTAL</td>
                    <td style={{ padding: '7px 8px', color: 'var(--purple)' }}>
                      {yarnRows.reduce((s, r) => s + parseFloat(r.sent_kg || 0), 0).toFixed(3)} kg
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* ROLL-BASED: batch selection */}
          {!isYarnBased(form.job_type) && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, fontWeight: 700 }}>Fabric / Lot Lines *</div>
            {sealedBatches.length === 0 ? (
              <div style={{ color: 'var(--gold)', padding: '16px', background: 'var(--crit-dim)', borderRadius: 6, fontSize: 13 }}>
                ⚠ No sealed or dyed lots available. Go to Greige & Lots and seal a lot first.
              </div>
            ) : (<>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['#', 'Fabric / Item', 'Lot No.', 'Colour / Shade', 'Rolls', 'Weight (kg)', ''].map(h => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fabricRows.map((row, idx) => {
                    const lotOptions = row.fabric_type ? lotsForFabric(row.fabric_type) : [];
                    return (
                      <tr key={idx}>
                        <td style={{ padding: '5px 8px', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                        <td style={{ padding: '5px 4px' }}>
                          <select style={{ ...inp, padding: '6px 8px', fontSize: 12 }} value={row.fabric_type}
                            onChange={e => updateFabricRow(idx, 'fabric_type', e.target.value)}>
                            <option value="">— Fabric —</option>
                            {allFabricTypes.map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '5px 4px' }}>
                          <select style={{ ...inp, padding: '6px 8px', fontSize: 12 }} value={row.batch_id}
                            onChange={e => updateFabricRow(idx, 'batch_id', e.target.value)} disabled={!row.fabric_type}>
                            <option value="">— Lot —</option>
                            {lotOptions.map(b => {
                              const fb = (b.fabric_breakdown || []).find(f => f.fabric_type === row.fabric_type);
                              return <option key={b.batch_id} value={b.batch_id}>{b.batch_number} ({fb ? parseFloat(fb.kg).toFixed(1) : '0'} kg{b._isDyed ? ' · DYED' : ''})</option>;
                            })}
                          </select>
                        </td>
                        <td style={{ padding: '5px 4px' }}>
                          <input style={{ ...inp, padding: '6px 8px', fontSize: 12 }} placeholder="Navy Blue"
                            value={row.color} onChange={e => updateFabricRow(idx, 'color', e.target.value)} />
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--text)', fontSize: 13, textAlign: 'center' }}>{row.roll_count || '—'}</td>
                        <td style={{ padding: '5px 8px', color: 'var(--gold)', fontSize: 13, fontWeight: 700, textAlign: 'right' }}>{row.weight_kg ? parseFloat(row.weight_kg).toFixed(3) : '—'}</td>
                        <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                          {fabricRows.length > 1 && (
                            <button type="button" onClick={() => removeFabricRow(idx)}
                              style={{ background: 'transparent', border: 'none', color: 'var(--crit)', cursor: 'pointer', fontSize: 15 }}>✕</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <button type="button" onClick={addFabricRow}
                  style={{ background: 'transparent', border: '1px dashed var(--gold)', color: 'var(--gold)', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  + Add Fabric Line
                </button>
                {fabricRowsTotal > 0 && (
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    Total: <strong style={{ color: 'var(--gold)' }}>{validFabricRows.reduce((s, r) => s + (parseInt(r.roll_count) || 0), 0)} rolls · {fabricRowsTotal.toFixed(3)} kg</strong>
                  </div>
                )}
              </div>
            </>)}
          </div>
          )}

          {/* Vendor & job details */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, fontWeight: 700 }}>Vendor & Job Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>Vendor Name *</label>
                <select required style={inp} value={form.vendor_name}
                  onChange={e => { setForm(f => ({ ...f, vendor_name: e.target.value })); autoFillRate(e.target.value, form.job_type); }}>
                  <option value="">— Select Vendor —</option>
                  {partners.map(p => <option key={p.partner_id} value={p.company_name}>{p.company_name}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Vendor Contact</label>
                <input style={inp} placeholder="9876543210" value={form.vendor_contact} onChange={e => setForm(f => ({ ...f, vendor_contact: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Rate per KG (₹)</label>
                <input style={inp} type="number" step="0.01" placeholder="25.00" value={form.rate_per_kg} onChange={e => setForm(f => ({ ...f, rate_per_kg: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Sent Date *</label>
                <input required style={inp} type="date" value={form.sent_date} onChange={e => setForm(f => ({ ...f, sent_date: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Expected Return Date</label>
                <input style={inp} type="date" value={form.expected_return_date} onChange={e => setForm(f => ({ ...f, expected_return_date: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Notes / Instructions</label>
                <input style={inp} placeholder="Color code, shade, special instructions..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            {form.rate_per_kg && fabricRowsTotal > 0 && !isYarnBased(form.job_type) && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--surface)', borderRadius: 6, fontSize: 13, color: 'var(--muted)' }}>
                Estimated job cost: <strong style={{ color: 'var(--pink)' }}>₹{(fabricRowsTotal * parseFloat(form.rate_per_kg || 0)).toFixed(2)}</strong>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="submit" disabled={saving || (!isYarnBased(form.job_type) && !validFabricRows.length)}
              style={{ background: saving || (!isYarnBased(form.job_type) && !validFabricRows.length) ? '#7a6010' : 'var(--gold)', color: '#000', border: 'none', borderRadius: 7, padding: '10px 32px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
              {saving ? 'Creating...' : '✓ Create & Send Challan'}
            </button>
          </div>
        </form>
      </div>
    )}

    {/* ── Receive Back — standalone form (header button) ── */}
    {showReceiveNew && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, overflowY: 'auto', padding: '20px 0' }}>
        <form onSubmit={submitReceiveNew} style={{ background: 'var(--bg)', border: '1px solid var(--green)', borderRadius: 10, width: 'min(98vw, 860px)', margin: '0 auto', padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div>
              <h3 style={{ color: 'var(--green)', margin: 0, fontSize: 18 }}>Receive Material Back</h3>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>Select challan → fabric lines populate → enter received weights</div>
            </div>
            <button type="button" onClick={() => { setShowReceiveNew(false); setRcChallanId(''); setRcDetail(null); setRcRows([]); setRcForm(emptyReceive()); }}
              style={{ background: 'transparent', border: '1px solid var(--muted)', color: 'var(--muted)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12 }}>✕ Cancel</button>
          </div>

          {/* Challan selection */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, fontWeight: 700 }}>Outstanding Challan *</div>
            {outstandingChallans.length === 0 ? (
              <div style={{ color: 'var(--gold)', padding: '14px', background: 'var(--crit-dim)', borderRadius: 6, fontSize: 13 }}>⚠ No outstanding challans — everything has been received.</div>
            ) : (
              <select required style={inp} value={rcChallanId} onChange={e => selectRcChallan(e.target.value)}>
                <option value="">— Select Challan —</option>
                {outstandingChallans.map(c => (
                  <option key={c.challan_id} value={c.challan_id}>
                    {c.challan_number} · {c.vendor_name} · {c.job_type} · {parseFloat(c.sent_weight_kg || 0).toFixed(1)} kg · sent {c.sent_date?.slice(0, 10)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Sent reference */}
          {rcDetail && rcSentLines.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
              <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>Sent Out — {rcDetail.challan_number} ({rcDetail.vendor_name})</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {rcSentLines.map((l, i) => (
                  <span key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 5, padding: '4px 10px', fontSize: 12 }}>
                    {l.fabric} · {l.lot} · <strong style={{ color: 'var(--text)' }}>{l.sent_kg.toFixed(3)} kg</strong>
                  </span>
                ))}
                <span style={{ background: 'var(--crit-dim)', border: '1px solid #f59e0b55', color: 'var(--gold-2)', borderRadius: 5, padding: '4px 10px', fontSize: 12, fontWeight: 700 }}>
                  Total sent: {rcTotalSent.toFixed(3)} kg
                </span>
              </div>
            </div>
          )}

          {/* Received rows — dyeing-only: fabric-wise totals; finishing: per-roll manual entry with new IDs */}
          {rcDetail && (() => {
            const isDyeOnly = rcDetail.job_type === 'DYEING';
            return (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, fontWeight: 700 }}>
                {isDyeOnly ? 'Received Weights — Fabric-wise *' : 'Received Rolls — Weigh & Enter Manually *'}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 11, marginBottom: 10 }}>
                {isDyeOnly
                  ? 'Dyed fabric goes back out for finishing — enter total received weight per fabric, no roll IDs needed.'
                  : 'One row per received roll — a new roll ID and label will be generated for each.'}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {(isDyeOnly
                      ? ['#', 'Fabric / Item', 'Lot No.', 'Sent (kg)', 'Received (kg)']
                      : ['#', 'Fabric / Item', 'Lot No.', 'Colour / Shade', 'Weight (kg)', '']
                    ).map(h => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rcRows.map((row, idx) => {
                    const sl = rcSentLines.find(l => l.fabric === row.fabric);
                    return (
                      <tr key={idx}>
                        <td style={{ padding: '6px 8px', color: 'var(--muted)', fontSize: 12 }}>{idx + 1}</td>
                        <td style={{ padding: '5px 4px' }}>
                          {isDyeOnly ? (
                            <span style={{ color: 'var(--gold)', fontSize: 13, fontWeight: 700 }}>{row.fabric}</span>
                          ) : (
                            <select style={{ ...inp, padding: '6px 8px', fontSize: 12 }} value={row.fabric}
                              onChange={e => setRcRows(rows => rows.map((r, i) => i === idx ? { ...r, fabric: e.target.value } : r))}>
                              <option value="">— Fabric —</option>
                              {rcSentLines.map(l => <option key={l.fabric} value={l.fabric}>{l.fabric}</option>)}
                            </select>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--muted)', fontSize: 12 }}>{sl?.lot || '—'}</td>
                        {isDyeOnly ? (
                          <td style={{ padding: '6px 8px', color: 'var(--muted)', fontSize: 13, textAlign: 'right' }}>{sl ? sl.sent_kg.toFixed(3) : '—'}</td>
                        ) : (
                          <td style={{ padding: '5px 4px' }}>
                            <input style={{ ...inp, padding: '6px 8px', fontSize: 12 }} placeholder="Navy Blue" value={row.color}
                              onChange={e => setRcRows(rows => rows.map((r, i) => i === idx ? { ...r, color: e.target.value } : r))} />
                          </td>
                        )}
                        <td style={{ padding: '5px 4px', width: 130 }}>
                          <input style={{ ...inp, padding: '6px 8px', fontSize: 13, fontWeight: 700, textAlign: 'right' }} type="number" step="0.001" min="0" placeholder="0.000"
                            value={row.weight}
                            onChange={e => setRcRows(rows => rows.map((r, i) => i === idx ? { ...r, weight: e.target.value } : r))} />
                        </td>
                        {!isDyeOnly && (
                          <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                            {rcRows.length > 1 && (
                              <button type="button" onClick={() => setRcRows(rows => rows.filter((_, i) => i !== idx))}
                                style={{ background: 'transparent', border: 'none', color: 'var(--crit)', cursor: 'pointer', fontSize: 15 }}>✕</button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                {!isDyeOnly ? (
                  <button type="button" onClick={() => setRcRows(rows => [...rows, { fabric: '', color: '', weight: '' }])}
                    style={{ background: 'transparent', border: '1px dashed var(--green)', color: 'var(--green)', padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    + Add Roll
                  </button>
                ) : <span />}
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Received: <strong style={{ color: 'var(--green)' }}>{rcTotalReceived.toFixed(3)} kg</strong>
                  {rcTotalSent > 0 && rcTotalReceived > 0 && (() => {
                    const loss = ((rcTotalSent - rcTotalReceived) / rcTotalSent * 100);
                    return <span style={{ marginLeft: 12, color: loss > 2 ? 'var(--crit)' : 'var(--green)' }}>
                      Shortage: {(rcTotalSent - rcTotalReceived).toFixed(3)} kg ({loss.toFixed(2)}%) {loss > 2 ? '⚠' : '✓'}
                    </span>;
                  })()}
                </div>
              </div>
            </div>
            );
          })()}

          {/* Receipt details */}
          {rcDetail && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, fontWeight: 700 }}>Receipt Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Received Date *</label>
                  <input required style={inp} type="date" value={rcForm.received_date} onChange={e => setRcForm(f => ({ ...f, received_date: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl}>Quality</label>
                  <select style={inp} value={rcForm.quality_status} onChange={e => setRcForm(f => ({ ...f, quality_status: e.target.value }))}>
                    <option value="PASS">PASS</option>
                    <option value="PARTIAL">PARTIAL</option>
                    <option value="FAIL">FAIL</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Rejected (kg)</label>
                  <input style={inp} type="number" step="0.001" min="0" value={rcForm.rejected_weight_kg} onChange={e => setRcForm(f => ({ ...f, rejected_weight_kg: e.target.value }))} />
                </div>
                <div style={{ gridColumn: 'span 3' }}>
                  <label style={lbl}>Notes</label>
                  <input style={inp} placeholder="Shade result, remarks..." value={rcForm.notes} onChange={e => setRcForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <div style={{ gridColumn: 'span 3', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="rc-partial" checked={!!rcForm.is_partial}
                    onChange={e => setRcForm(f => ({ ...f, is_partial: e.target.checked }))} style={{ cursor: 'pointer' }} />
                  <label htmlFor="rc-partial" style={{ color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>
                    Partial receipt — more material still to come (challan stays open)
                  </label>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" disabled={saving || !rcDetail || !rcTotalReceived}
              style={{ background: saving || !rcDetail || !rcTotalReceived ? 'var(--green-dim)' : 'var(--green)', color: 'var(--bg)', border: 'none', borderRadius: 7, padding: '10px 32px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
              {saving ? 'Receiving...' : '✓ Receive Material'}
            </button>
          </div>
        </form>
      </div>
    )}

    {/* ── Receive Back — full-screen ── */}
    {showReceive && detail && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, overflowY: 'auto', padding: '20px 0' }}>
        <form onSubmit={receiveBack} style={{ background: 'var(--bg)', border: '1px solid var(--green)', borderRadius: 10, width: 'min(98vw, 720px)', margin: '0 auto', padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div>
              <h3 style={{ color: 'var(--green)', margin: 0, fontSize: 18 }}>Receive Material Back</h3>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                Challan: <strong style={{ color: 'var(--gold)', fontFamily: 'monospace' }}>{detail.challan_number}</strong> · {detail.vendor_name} · Sent: {parseFloat(detail.sent_weight_kg || 0).toFixed(3)} kg
              </div>
            </div>
            <button type="button" onClick={() => { setShowReceive(false); setReceiveForm(emptyReceive()); }}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>✕ Cancel</button>
          </div>

          {/* Previous receipts banner */}
          {(() => {
            const prevReceipts = detail.receipts || [];
            const prevTotalKg = prevReceipts.reduce((s, r) => s + parseFloat(r.received_weight_kg || 0), 0);
            const prevTotalRolls = prevReceipts.reduce((s, r) => s + parseInt(r.rolls_received_count || 0), 0);
            const prevBalYarn = prevReceipts.reduce((s, r) => s + parseFloat(r.balance_yarn_kg || 0), 0);
            const sentKg = parseFloat(detail.sent_weight_kg || 0);
            const remainingKg = sentKg - prevTotalKg;
            if (prevReceipts.length === 0) return null;
            return (
              <div style={{ background: 'var(--surface)', border: '1px solid #60a5fa44', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ color: 'var(--link)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  Previous Receipts ({prevReceipts.length})
                </div>
                {prevReceipts.map((r, i) => (
                  <div key={r.receipt_id || i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: i < prevReceipts.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ color: 'var(--muted)' }}>{fmtDate(r.received_date)} — {r.quality_status || 'PASS'}</span>
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                      {parseFloat(r.received_weight_kg).toFixed(3)} kg
                      {detail.challan_type === 'YARN_BASED' && r.rolls_received_count ? ` · ${r.rolls_received_count} rolls` : ''}
                      {parseFloat(r.balance_yarn_kg || 0) > 0 ? ` · Bal: ${parseFloat(r.balance_yarn_kg).toFixed(3)} kg` : ''}
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 20, marginTop: 10, padding: '8px 0 0', borderTop: '1px solid var(--border)' }}>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase' }}>Total sent</div>
                    <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: 13 }}>{sentKg.toFixed(3)} kg</div>
                  </div>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase' }}>Already received</div>
                    <div style={{ color: 'var(--green)', fontWeight: 700, fontSize: 13 }}>{prevTotalKg.toFixed(3)} kg</div>
                  </div>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase' }}>Remaining</div>
                    <div style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>{remainingKg.toFixed(3)} kg</div>
                  </div>
                  {detail.challan_type === 'YARN_BASED' && (
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase' }}>Rolls so far</div>
                      <div style={{ color: 'var(--purple)', fontWeight: 700, fontSize: 13 }}>{prevTotalRolls}</div>
                    </div>
                  )}
                  {detail.challan_type === 'YARN_BASED' && prevBalYarn > 0 && (
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase' }}>Yarn returned</div>
                      <div style={{ color: 'var(--purple)', fontWeight: 700, fontSize: 13 }}>{prevBalYarn.toFixed(3)} kg</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, fontWeight: 700 }}>Receipt Details {(detail.receipts || []).length > 0 ? `(Receipt #${(detail.receipts || []).length + 1})` : ''}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>Received Date *</label>
                <input required style={inp} type="date" value={receiveForm.received_date} onChange={e => setReceiveForm(f => ({ ...f, received_date: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>{detail.challan_type === 'YARN_BASED' ? 'Greige Roll Weight (kg) *' : 'Received Weight (kg) *'}</label>
                <input required style={inp} type="number" step="0.001" placeholder="0.000"
                  value={receiveForm.received_weight_kg} onChange={e => setReceiveForm(f => ({ ...f, received_weight_kg: e.target.value }))} />
              </div>
              {detail.challan_type === 'YARN_BASED' && (<>
                <div>
                  <label style={lbl}>Rolls Received (count) *</label>
                  <input required style={inp} type="number" min="0" placeholder="0"
                    value={receiveForm.rolls_received_count} onChange={e => setReceiveForm(f => ({ ...f, rolls_received_count: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl}>Balance Yarn Returned (kg)</label>
                  <input style={inp} type="number" step="0.001" placeholder="0.000"
                    value={receiveForm.balance_yarn_kg} onChange={e => setReceiveForm(f => ({ ...f, balance_yarn_kg: e.target.value }))} />
                </div>
              </>)}
              <div>
                <label style={lbl}>Quality Status</label>
                <select style={inp} value={receiveForm.quality_status} onChange={e => setReceiveForm(f => ({ ...f, quality_status: e.target.value }))}>
                  <option value="PASS">PASS — all good</option>
                  <option value="PARTIAL">PARTIAL — some issues</option>
                  <option value="FAIL">FAIL — rejected</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Rejected Weight (kg)</label>
                <input style={inp} type="number" step="0.001" value={receiveForm.rejected_weight_kg} onChange={e => setReceiveForm(f => ({ ...f, rejected_weight_kg: e.target.value }))} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={lbl}>Notes / Observations</label>
                <input style={inp} placeholder="Any quality issues, shade variation, short delivery..." value={receiveForm.notes} onChange={e => setReceiveForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Vendor Invoice No.</label>
                <input style={inp} placeholder="e.g. INV/2526/0042" value={receiveForm.vendor_invoice_no} onChange={e => setReceiveForm(f => ({ ...f, vendor_invoice_no: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Vendor Bill Amount (₹)</label>
                <input style={inp} type="number" step="0.01" placeholder="Total billed amount" value={receiveForm.vendor_bill_amount} onChange={e => setReceiveForm(f => ({ ...f, vendor_bill_amount: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* Summary preview */}
          {receiveForm.received_weight_kg && (() => {
            const prevReceipts = detail.receipts || [];
            const prevTotalKg = prevReceipts.reduce((s, r) => s + parseFloat(r.received_weight_kg || 0), 0);
            const prevTotalRolls = prevReceipts.reduce((s, r) => s + parseInt(r.rolls_received_count || 0), 0);
            const prevBalYarn = prevReceipts.reduce((s, r) => s + parseFloat(r.balance_yarn_kg || 0), 0);
            const sentKg = parseFloat(detail.sent_weight_kg || 0);
            const thisRecvKg = parseFloat(receiveForm.received_weight_kg || 0);
            const thisRolls = parseInt(receiveForm.rolls_received_count || 0);
            const thisBalYarn = parseFloat(receiveForm.balance_yarn_kg || 0);
            const cumulativeRecvKg = prevTotalKg + thisRecvKg;
            const cumulativeRolls = prevTotalRolls + thisRolls;
            const cumulativeBalYarn = prevBalYarn + thisBalYarn;
            const isKnitting = detail.challan_type === 'YARN_BASED';
            const isFinal = cumulativeRecvKg >= sentKg;

            const items = isKnitting ? [
              ['Yarn Sent', `${sentKg.toFixed(3)} kg`, '#fff'],
              ['This Receipt', `${thisRecvKg.toFixed(3)} kg · ${thisRolls} rolls`, 'var(--green)'],
              ['Cumulative', `${cumulativeRecvKg.toFixed(3)} kg · ${cumulativeRolls} rolls`, 'var(--link)'],
              ['Balance Yarn (this)', `${thisBalYarn.toFixed(3)} kg`, 'var(--purple)'],
              ['Remaining', isFinal ? 'FULLY RECEIVED' : `${(sentKg - cumulativeRecvKg).toFixed(3)} kg`, isFinal ? 'var(--green)' : 'var(--gold)'],
            ] : [
              ['Sent', `${sentKg.toFixed(3)} kg`, '#fff'],
              ['This Receipt', `${thisRecvKg.toFixed(3)} kg`, 'var(--green)'],
              ['Cumulative', `${cumulativeRecvKg.toFixed(3)} kg`, 'var(--link)'],
              ['Rejected', `${parseFloat(receiveForm.rejected_weight_kg || 0).toFixed(3)} kg`, 'var(--crit)'],
              ['Remaining', isFinal ? 'FULLY RECEIVED' : `${(sentKg - cumulativeRecvKg).toFixed(3)} kg`, isFinal ? 'var(--green)' : 'var(--gold)'],
            ];

            return (
              <div style={{ background: 'var(--surface)', border: `1px solid ${isFinal ? '#22c55e44' : 'var(--border)'}`, borderRadius: 8, padding: '14px 16px', marginBottom: 16, display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 12 }}>
                {items.map(([label, value, color]) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
                    <div style={{ color, fontWeight: 700, fontSize: 13 }}>{value}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="submit" disabled={saving}
              style={{ background: saving ? 'var(--green-dim)' : 'var(--green)', color: '#000', border: 'none', borderRadius: 7, padding: '10px 32px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 }}>
              {saving ? 'Saving...' : (() => {
                const prevKg = (detail.receipts || []).reduce((s, r) => s + parseFloat(r.received_weight_kg || 0), 0);
                const thisKg = parseFloat(receiveForm.received_weight_kg || 0);
                const isFinal = (prevKg + thisKg) >= parseFloat(detail.sent_weight_kg || 0);
                const partialLabel = isFinal ? '' : ' (Partial)';
                return detail.challan_type === 'YARN_BASED'
                  ? `✓ Confirm Receipt${partialLabel} — Log Greige Rolls + Return Balance Yarn`
                  : `✓ Confirm Receipt${partialLabel}`;
              })()}
            </button>
          </div>
        </form>
      </div>
    )}

    {/* ── ANALYTICS TAB ── */}
    {tab === 'analytics' && (
      <div style={{ padding: '0 0 24px' }}>
        {analyticsLoading ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Loading analytics...</div>
        : !analytics ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>No data</div>
        : <>
          {/* Vendor Performance */}
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold)', marginBottom: 12 }}>Vendor Performance</div>
          <div style={{ overflowX: 'auto', marginBottom: 28 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'var(--bg)' }}>
                {['Vendor', 'Process', 'Challans', 'Completed', 'Pending', 'Avg Turnaround', 'Sent (kg)', 'Received (kg)', 'Total Cost'].map(h =>
                  <th key={h} style={{ padding: '10px 12px', borderBottom: '1px solid var(--surface)', textAlign: 'left', color: 'var(--border)', fontSize: 10, letterSpacing: 0.5 }}>{h}</th>
                )}
              </tr></thead>
              <tbody>
                {analytics.vendor_stats.map((v, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--surface)' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--gold)', fontWeight: 600 }}>{v.vendor_name}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--link)' }}>{v.job_type?.replace('_', ' + ')}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{v.total_challans}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--green)' }}>{v.completed}</td>
                    <td style={{ padding: '10px 12px', color: v.pending > 0 ? 'var(--gold)' : 'var(--green)' }}>{v.pending}</td>
                    <td style={{ padding: '10px 12px', color: parseFloat(v.avg_turnaround_days || 0) > 10 ? 'var(--crit)' : 'var(--text)', fontWeight: 700 }}>{v.avg_turnaround_days ? `${v.avg_turnaround_days}d` : '—'}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{parseFloat(v.total_sent_kg).toFixed(1)}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--green)' }}>{parseFloat(v.total_received_kg).toFixed(1)}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--pink)', fontWeight: 700 }}>₹{parseFloat(v.total_cost).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Wastage by Vendor */}
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--crit)', marginBottom: 12 }}>Wastage by Vendor</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 28 }}>
            {analytics.wastage_by_vendor.map((w, i) => {
              const pct = parseFloat(w.wastage_pct || 0);
              const over = pct > 2;
              return (
                <div key={i} style={{ background: 'var(--surface)', border: `1px solid ${over ? 'var(--crit)' : 'var(--surface)'}`, borderRadius: 10, padding: '14px 18px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', marginBottom: 6 }}>{w.vendor_name}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: 'var(--muted)' }}>Sent</span><span style={{ color: 'var(--text)' }}>{parseFloat(w.total_sent).toFixed(1)} kg</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: 'var(--muted)' }}>Received</span><span style={{ color: 'var(--green)' }}>{parseFloat(w.total_received).toFixed(1)} kg</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--muted)' }}>Wastage</span>
                    <span style={{ color: over ? 'var(--crit)' : 'var(--green)', fontWeight: 700 }}>{pct}%{over ? ' ⚠' : ' ✓'}</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(pct * 10, 100)}%`, height: '100%', background: over ? 'var(--crit)' : 'var(--green)', borderRadius: 2 }} />
                  </div>
                </div>
              );
            })}
            {analytics.wastage_by_vendor.length === 0 && <div style={{ color: 'var(--muted)', padding: 20 }}>No completed challans with wastage data yet.</div>}
          </div>

          {/* Monthly Trend */}
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--link)', marginBottom: 12 }}>Monthly Trend</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr style={{ background: 'var(--bg)' }}>
                {['Month', 'Challans', 'Sent (kg)', 'Received (kg)', 'Cost (₹)'].map(h =>
                  <th key={h} style={{ padding: '10px 12px', borderBottom: '1px solid var(--surface)', textAlign: 'left', color: 'var(--border)', fontSize: 10, letterSpacing: 0.5 }}>{h}</th>
                )}
              </tr></thead>
              <tbody>
                {analytics.monthly_trend.map((m, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--surface)' }}>
                    <td style={{ padding: '10px 12px', color: 'var(--gold)', fontWeight: 600, fontFamily: 'monospace' }}>{m.month}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{m.challans}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{parseFloat(m.sent_kg).toFixed(1)}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--green)' }}>{parseFloat(m.received_kg).toFixed(1)}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--pink)', fontWeight: 700 }}>₹{parseFloat(m.cost).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
      </div>
    )}

    {/* ── Forward to Finishing Modal ── */}
    {showForward && detail && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 12, padding: 24, width: 480 }}>
          <h3 style={{ color: 'var(--purple)', marginTop: 0 }}>Forward to Finishing</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 16 }}>
            Dyed batch from <strong style={{ color: 'var(--gold)' }}>{detail.vendor_name}</strong> ({detail.challan_number}) → Send for finishing
          </p>
          {[
            ['Finishing Vendor *', 'vendor_name', 'text', 'Who will do finishing?'],
            ['Vendor Contact', 'vendor_contact', 'text', '9876543210'],
            ['Rate per KG (₹)', 'rate_per_kg', 'number', '15.00'],
            ['Expected Return', 'expected_return_date', 'date', ''],
            ['Notes', 'notes', 'text', 'Stenter, mangle, etc.']
          ].map(([label, key, type, ph]) => (
            <div key={key} style={{ marginBottom: 10 }}>
              <label style={lbl}>{label}</label>
              {key === 'vendor_name' ? (
                <select style={inp} value={forwardForm[key]||''} onChange={e => {
                  setForwardForm(f => ({ ...f, vendor_name: e.target.value }));
                  if (!e.target.value) return;
                  fetch(`${API}/api/subcontract/last-rate?vendor_name=${encodeURIComponent(e.target.value)}&job_type=FINISHING`)
                    .then(r=>r.json()).then(d => { if (d.rate_per_kg) setForwardForm(f => ({ ...f, rate_per_kg: d.rate_per_kg })); });
                }}>
                  <option value="">— Select Vendor —</option>
                  {partners.map(p => <option key={p.partner_id} value={p.company_name}>{p.company_name}</option>)}
                </select>
              ) : (
              <input type={type} placeholder={ph} value={forwardForm[key]||''} onChange={e => setForwardForm(f => ({ ...f, [key]: e.target.value }))}
                onBlur={false ? (e => {
                  if (!e.target.value) return;
                  fetch(`${API}/api/subcontract/last-rate?vendor_name=${encodeURIComponent(e.target.value)}&job_type=FINISHING`)
                    .then(r => r.json()).then(d => { if (d.rate_per_kg) setForwardForm(f => ({ ...f, rate_per_kg: String(d.rate_per_kg) })); }).catch(() => {});
                }) : undefined}
                style={inp} />
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={forwardToFinishing} disabled={saving} style={{ background: 'var(--surface)', color: 'var(--text)', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>
              {saving ? 'Creating...' : '→ Create Finishing Challan'}
            </button>
            <button onClick={() => setShowForward(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 20px', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      </div>
    )}

    {printing && detail && (
      <PrintChallan type={printing} data={detail} onClose={() => setPrinting(null)} />
    )}

    {/* Edit Challan Modal */}
    {showEdit && detail && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 999 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--surface-2)', borderRadius: 12, padding: 24, width: 420 }}>
          <h3 style={{ color: 'var(--gold)', marginTop: 0 }}>Edit Challan — {detail.challan_number}</h3>
          {[
            ['Vendor Name', 'vendor_name', 'text'], ['Vendor Contact', 'vendor_contact', 'text'],
            ['Rate per Kg', 'rate_per_kg', 'number'], ['Expected Return', 'expected_return_date', 'date'],
            ['Notes', 'notes', 'text']
          ].map(([label, key, type]) => (
            <div key={key} style={{ marginBottom: 10 }}>
              <label style={lbl}>{label}</label>
              {key === 'vendor_name' ? (
                <select style={inp} value={editForm[key]||''} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))}>
                  <option value="">— Select Vendor —</option>
                  {partners.map(p => <option key={p.partner_id} value={p.company_name}>{p.company_name}</option>)}
                </select>
              ) : (
                <input type={type} value={editForm[key]||''} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} style={inp} />
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={saveEditChallan} style={{ background: 'var(--green)', color: 'var(--text)', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>Save</button>
            <button onClick={() => setShowEdit(false)} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', padding: '8px 20px', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

const StatCell = ({ label, value, color }) => (
  <div>
    <div style={{ color: 'var(--border)', fontSize: 10, letterSpacing: 1, marginBottom: 2 }}>{label}</div>
    <div style={{ color: color || '#fff', fontSize: 13, fontWeight: 'bold' }}>{value}</div>
  </div>
);
