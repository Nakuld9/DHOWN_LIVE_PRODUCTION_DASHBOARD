// Masters: Chart of Accounts (group tree with ledgers) + Ledger master form +
// new Group form. Busy-style dense layout.
import React, { useState, useEffect, useCallback } from 'react';
import { acctApi, side, fmt } from './api';

// ── Chart of Accounts ───────────────────────────────────────────────────────
export function ChartOfAccounts({ groups, ledgers, reload, onEditLedger, onNewLedger, onNewGroup }) {
  const [open, setOpen] = useState(() => new Set(groups.filter((g) => !g.parent_id).map((g) => g.group_id)));
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const childGroups = (pid) => groups.filter((g) => g.parent_id === pid).sort((a, b) => a.sort_order - b.sort_order);
  const groupLedgers = (gid) => ledgers.filter((l) => l.group_id === gid).sort((a, b) => a.name.localeCompare(b.name));

  const Row = ({ g, depth }) => {
    const kids = childGroups(g.group_id);
    const leds = groupLedgers(g.group_id);
    const isOpen = open.has(g.group_id);
    return (
      <>
        <tr className="grp acct-tree-row">
          <td style={{ paddingLeft: 6 + depth * 18 }}>
            <span className="exp" onClick={() => toggle(g.group_id)}>{(kids.length || leds.length) ? (isOpen ? '▾' : '▸') : '·'}</span>
            {g.name} <small style={{ color: '#7a86a8', fontWeight: 400 }}>· {g.nature}/{g.report}</small>
          </td>
          <td className="r" style={{ color: '#7a86a8' }}>{leds.length || ''}</td>
        </tr>
        {isOpen && leds.map((l) => (
          <tr key={l.ledger_id} onClick={() => onEditLedger(l)} style={{ cursor: 'pointer' }}>
            <td style={{ paddingLeft: 26 + depth * 18 }}>
              <span className="acct-link">{l.name}</span>
              {!l.is_active && <small style={{ color: '#999' }}> (inactive)</small>}
              {l.gstin && <small style={{ color: '#999' }}> · {l.gstin}</small>}
            </td>
            <td className="r" style={{ color: '#999', fontSize: 11 }}>{l.ledger_type}</td>
          </tr>
        ))}
        {isOpen && kids.map((c) => <Row key={c.group_id} g={c} depth={depth + 1} />)}
      </>
    );
  };

  return (
    <div className="acct-pane">
      <div className="acct-pane-head">Chart of Accounts<span className="ph-sub">{groups.length} groups · {ledgers.length} ledgers</span></div>
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button className="acct-btn primary" onClick={onNewLedger}>+ New Ledger</button>
          <button className="acct-btn" onClick={onNewGroup}>+ New Group</button>
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={reload}>Refresh</button>
        </div>
        <div style={{ maxHeight: '64vh', overflow: 'auto' }}>
          <table className="acct-table">
            <thead><tr><th>Group / Ledger</th><th className="r" style={{ width: 120 }}>Type / Count</th></tr></thead>
            <tbody>{childGroups(null).map((g) => <Row key={g.group_id} g={g} depth={0} />)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Ledger master form ──────────────────────────────────────────────────────
export function LedgerForm({ groups, ledger, onDone }) {
  const [f, setF] = useState(() => ({
    name: ledger?.name || '', group_id: ledger?.group_id || '', gstin: ledger?.gstin || '',
    state_code: ledger?.state_code || '', address: ledger?.address || '', credit_days: ledger?.credit_days ?? '',
    is_active: ledger?.is_active ?? true,
    op_amount: '', op_side: 'Dr',
  }));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });

  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const body = {
        name: f.name, group_id: f.group_id, gstin: f.gstin || null, state_code: f.state_code || null,
        address: f.address || null, credit_days: f.credit_days === '' ? null : Number(f.credit_days), is_active: f.is_active,
      };
      if (!ledger && f.op_amount) body.opening = { amount: f.op_amount, side: f.op_side };
      await acctApi.saveLedger(ledger?.ledger_id, body);
      onDone(true);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="acct-pane" style={{ maxWidth: 640 }}>
      <div className="acct-pane-head">{ledger ? 'Edit Ledger' : 'New Ledger'}{ledger?.is_system && <span className="ph-sub">system account</span>}</div>
      <div className="acct-pane-inner">
        {err && <div className="acct-err-box">{err}</div>}
        <div className="acct-field"><label>Name *</label><input autoFocus style={{ flex: 1 }} value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="acct-field"><label>Under (Group) *</label>
          <select style={{ flex: 1 }} value={f.group_id} onChange={(e) => set('group_id', e.target.value)}>
            <option value="">— select —</option>
            {groups.slice().sort((a, b) => a.sort_order - b.sort_order).map((g) => <option key={g.group_id} value={g.group_id}>{g.name} ({g.nature})</option>)}
          </select>
        </div>
        <div className="acct-field"><label>GSTIN</label><input value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} maxLength={15} style={{ width: 200 }} /><span className="acct-note" style={{ margin: 0 }}>state auto-fills from GSTIN</span></div>
        <div className="acct-field"><label>Address</label><textarea rows={2} style={{ flex: 1 }} value={f.address} onChange={(e) => set('address', e.target.value)} /></div>
        <div className="acct-field"><label>Credit Days</label><input className="num" style={{ width: 80 }} value={f.credit_days} onChange={(e) => set('credit_days', e.target.value.replace(/\D/g, ''))} /></div>
        {ledger && <div className="acct-field"><label>Active</label><input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} disabled={ledger.is_system} /></div>}
        {!ledger && (
          <div className="acct-field"><label>Opening Balance</label>
            <input className="num" style={{ width: 130 }} value={f.op_amount} onChange={(e) => set('op_amount', e.target.value)} placeholder="0.00" inputMode="decimal" />
            <select value={f.op_side} onChange={(e) => set('op_side', e.target.value)}><option>Dr</option><option>Cr</option></select>
          </div>
        )}
        {ledger && <div className="acct-note">Opening balance: {ledger.opening ? side(ledger.opening) : '—'} (edit via the ledger's opening page)</div>}
        <div className="acct-btnbar">
          <button className="acct-btn primary" disabled={busy || !f.name || !f.group_id} onClick={save}>Save</button>
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => onDone(false)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── New group form ──────────────────────────────────────────────────────────
export function GroupForm({ groups, onDone }) {
  const [name, setName] = useState(''); const [parent, setParent] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr(''); setBusy(true);
    try { await acctApi.createGroup({ name, parent_id: parent }); onDone(true); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="acct-pane" style={{ maxWidth: 560 }}>
      <div className="acct-pane-head">New Account Group</div>
      <div className="acct-pane-inner">
        {err && <div className="acct-err-box">{err}</div>}
        <div className="acct-field"><label>Name *</label><input autoFocus style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="acct-field"><label>Under *</label>
          <select style={{ flex: 1 }} value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— select parent —</option>
            {groups.slice().sort((a, b) => a.sort_order - b.sort_order).map((g) => <option key={g.group_id} value={g.group_id}>{g.name} ({g.nature})</option>)}
          </select>
        </div>
        <div className="acct-note">The new group inherits its parent's nature (Asset/Liability/Income/Expense) and statement.</div>
        <div className="acct-btnbar">
          <button className="acct-btn primary" disabled={busy || !name || !parent} onClick={save}>Create</button>
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => onDone(false)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Stock Items (Item Master) ───────────────────────────────────────────────
// Busy keeps item/stock masters in the same window as accounts. This surfaces the
// MES ERP item master (one source of truth — shared with inventory, BOM, invoicing)
// inside the accounting shell. Read-only here; create/edit stays on the Item Master
// page, and stock on hand is in Display → Stock Status.
export function ItemMaster() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setErr('');
    acctApi.erpItems({ q, limit: 200 })
      .then((d) => { setRows(d.data || []); setTotal(d.total != null ? d.total : (d.data || []).length); })
      .catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const hsn = (i) => i.hsn_code || i.hsn || '';
  const rate = (i) => (i.sale_rate != null ? i.sale_rate : (i.selling_rate != null ? i.selling_rate : (i.rate != null ? i.rate : i.standard_rate)));
  return (
    <div className="acct-pane">
      <div className="acct-pane-head">Stock Items<span className="ph-sub">{total} item(s) · MES item master</span></div>
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }} className="acct-no-print">
          <input placeholder="Search code / name" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        <table className="acct-table">
          <thead><tr><th>Code</th><th>Item Name</th><th>Group</th><th>HSN</th><th>Unit</th><th className="r">Rate</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.item_id || i.item_code}>
                <td className="mono">{i.item_code}</td><td>{i.item_name}</td><td>{i.category_name || ''}</td>
                <td className="mono">{hsn(i)}</td><td>{i.uom_code || i.unit || ''}</td>
                <td className="r mono">{rate(i) != null ? fmt(Number(rate(i)).toFixed(2)) : ''}</td>
                <td>{i.status || ''}</td>
              </tr>
            ))}
            {!loading && !rows.length && <tr><td colSpan={7} style={{ color: '#777', padding: 14 }}>No items.</td></tr>}
          </tbody>
        </table>
        <div className="acct-note" style={{ marginTop: 6 }}>Items are the shared MES item master (inventory, BOM, invoicing). Create/edit on the Item Master page; stock on hand is in Display → Stock Status (valued).</div>
        {loading && <div className="acct-note">Loading…</div>}
      </div>
    </div>
  );
}
