// Busy-parity reports: GSTR-9 (annual), Interest Calculation (overdue), and the
// Depreciation Chart (fixed-asset register + WDV/SLM schedule).
import React, { useState, useEffect, useCallback } from 'react';
import { acctApi, fmt, today } from './api';

const fyStart = () => { const d = new Date(); const y = d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; };
const fyEnd = () => { const d = new Date(); const y = d.getMonth() + 1 >= 4 ? d.getFullYear() + 1 : d.getFullYear(); return `${y}-03-31`; };

function useLoad(fn, dep) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { setErr(''); fn().then(setD).catch((e) => setErr(e.message)); }, [dep]); // eslint-disable-line
  return { d, err, setD };
}

export function Gstr9() {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(fyEnd());
  const { d, err } = useLoad(() => acctApi.gstr9({ from, to }), from + to);
  const Row = ({ label, o }) => (<tr><td>{label}</td><td className="r mono">{fmt((o.taxable != null ? o.taxable : 0).toFixed ? o.taxable.toFixed(2) : o.taxable)}</td><td className="r mono">{fmt((o.igst || 0).toFixed(2))}</td><td className="r mono">{fmt((o.cgst || 0).toFixed(2))}</td><td className="r mono">{fmt((o.sgst || 0).toFixed(2))}</td></tr>);
  return (
    <div className="acct-pane">
      <div className="acct-pane-head">GSTR-9 (Annual)<span className="ph-sub">indicative consolidation</span></div>
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }} className="acct-no-print">
          FY From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {d && (<>
          <table className="acct-table" style={{ maxWidth: 680 }}>
            <thead><tr><th>Particulars</th><th className="r">Taxable</th><th className="r">IGST</th><th className="r">CGST</th><th className="r">SGST</th></tr></thead>
            <tbody>
              <tr className="grp"><td colSpan={5}>Table 4/5 — Outward supplies</td></tr>
              <Row label="Outward (net of credit notes)" o={d.outward} />
              <tr><td style={{ paddingLeft: 20, color: '#666' }}>Credit notes</td><td className="r mono">{fmt(d.outward.credit_note_taxable.toFixed(2))}</td><td className="r mono" colSpan={3}>tax {fmt(d.outward.credit_note_tax.toFixed(2))}</td></tr>
              <tr className="grp"><td colSpan={5}>Table 6 — ITC availed</td></tr>
              <Row label="Input tax credit" o={d.itc} />
              <tr className="grp"><td colSpan={5}>Table 9 — Tax payable</td></tr>
              <Row label="Output tax" o={d.tax.output} />
              <tr style={{ fontWeight: 700 }}><td>Payable in cash (after set-off)</td><td /><td className="r mono">{fmt(d.tax.set_off.payable_cash.igst.toFixed(2))}</td><td className="r mono">{fmt(d.tax.set_off.payable_cash.cgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax.set_off.payable_cash.sgst.toFixed(2))}</td></tr>
            </tbody>
          </table>
          <div className="acct-note">{d.note}</div>
          {!d.reconciles && <div className="acct-err-box">Invoice headers do not match their line items — reconcile before filing.</div>}
        </>)}
      </div>
    </div>
  );
}

export function Interest() {
  const [kind, setKind] = useState('RECEIVABLE');
  const [asOf, setAsOf] = useState(today());
  const [rate, setRate] = useState('18');
  const { d, err } = useLoad(() => acctApi.interest({ kind, as_of: asOf, rate }), kind + asOf + rate);
  return (
    <div className="acct-pane">
      <div className="acct-pane-head">Interest Calculation<span className="ph-sub">on overdue outstanding</span></div>
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }} className="acct-no-print">
          <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="RECEIVABLE">Receivables</option><option value="PAYABLE">Payables</option></select>
          As on <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          Rate % <input value={rate} onChange={(e) => setRate(e.target.value)} style={{ width: 60 }} inputMode="decimal" />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {d && (<table className="acct-table">
          <thead><tr><th>Party</th><th>Bill</th><th>Date</th><th className="r">Outstanding</th><th className="r">Overdue (d)</th><th className="r">Interest @ {d.rate_pct}%</th></tr></thead>
          <tbody>
            {d.rows.map((r, i) => (<tr key={i}><td>{r.party}</td><td className="mono">{r.bill_no}</td><td className="mono">{r.bill_date}</td><td className="r mono">{fmt(r.outstanding)}</td><td className="r mono">{r.overdue_days}</td><td className="r mono">{fmt(r.interest)}</td></tr>))}
            {!d.rows.length && <tr><td colSpan={6} style={{ color: '#777', padding: 14 }}>Nothing overdue.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={3}>Total</td><td className="r mono">{fmt(d.total_outstanding)}</td><td /><td className="r mono">{fmt(d.total_interest)}</td></tr></tfoot>
        </table>)}
      </div>
    </div>
  );
}

export function AuditTrail() {
  const [f, setF] = useState({ entity: '', action: '', limit: 200 });
  const { d, err } = useLoad(() => acctApi.audit(f), JSON.stringify(f));
  return (
    <div className="acct-pane">
      <div className="acct-pane-head">Audit Trail<span className="ph-sub">every accounting action</span></div>
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }} className="acct-no-print">
          <select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}>
            {['', 'voucher', 'ledger', 'group', 'period', 'allocation'].map((x) => <option key={x} value={x}>{x || 'All entities'}</option>)}
          </select>
          <input placeholder="Action (e.g. POST)" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} style={{ width: 150 }} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {d && (
          <div style={{ maxHeight: '64vh', overflow: 'auto' }}>
            <table className="acct-table">
              <thead><tr><th>When</th><th>Entity</th><th>Ref</th><th>Action</th><th>By</th><th>Detail</th></tr></thead>
              <tbody>
                {(d || []).map((a) => (
                  <tr key={a.audit_id}>
                    <td className="mono">{a.at ? new Date(a.at).toLocaleString('en-GB') : ''}</td>
                    <td>{a.entity}</td><td className="mono">{a.entity_id || ''}</td>
                    <td><span className="acct-badge b-APPROVED">{a.action}</span></td><td>{a.actor || ''}</td>
                    <td style={{ whiteSpace: 'normal', color: '#666', fontSize: 11 }}>{a.detail ? (typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail)) : ''}</td>
                  </tr>
                ))}
                {d && !d.length && <tr><td colSpan={6} style={{ color: '#777', padding: 14 }}>No audit entries.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function Depreciation() {
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(fyEnd());
  const [assets, setAssets] = useState([]);
  const { d, err, setD } = useLoad(() => acctApi.depreciation({ from, to }), from + to);
  const [f, setF] = useState({ name: '', block: 'Plant & Machinery', purchase_date: today(), cost: '', rate_pct: '15', method: 'WDV', opening_wdv: '' });
  const [msg, setMsg] = useState(''); const [e2, setE2] = useState('');
  const loadA = useCallback(() => acctApi.assets().then(setAssets).catch(() => {}), []);
  useEffect(() => { loadA(); }, [loadA]);
  const refresh = () => { loadA(); acctApi.depreciation({ from, to }).then(setD).catch(() => {}); };
  const add = async () => {
    setMsg(''); setE2('');
    try { await acctApi.saveAsset({ ...f, cost: Number(f.cost), rate_pct: Number(f.rate_pct), opening_wdv: f.opening_wdv === '' ? null : Number(f.opening_wdv) }); setMsg('Asset added.'); setF({ ...f, name: '', cost: '', opening_wdv: '' }); refresh(); }
    catch (e) { setE2(e.message); }
  };
  const del = async (a) => {
    if (!window.confirm(`Remove asset "${a.name}" from the register?`)) return;
    setMsg(''); setE2('');
    try { await acctApi.deleteAsset(a.asset_id); setMsg('Asset removed.'); refresh(); } catch (e) { setE2(e.message); }
  };
  return (
    <div className="acct-pane">
      <div className="acct-pane-head">Depreciation Chart<span className="ph-sub">fixed-asset register · WDV / SLM</span></div>
      <div className="acct-pane-inner">
        {err && <div className="acct-err-box">{err}</div>}
        {e2 && <div className="acct-err-box">{e2}</div>}
        {msg && <div className="acct-ok-box">{msg}</div>}
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }} className="acct-no-print">
          FY From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {d && (<table className="acct-table">
          <thead><tr><th>Asset</th><th>Block</th><th>Method</th><th className="r">Rate%</th><th className="r">Opening WDV</th><th className="r">Additions</th><th className="r">Deductions</th><th className="r">Depreciation</th><th className="r">Closing WDV</th></tr></thead>
          <tbody>
            {d.rows.map((r, i) => (<tr key={i}><td>{r.asset}</td><td>{r.block}</td><td>{r.method}</td><td className="r mono">{r.rate_pct}</td><td className="r mono">{fmt(r.opening_wdv)}</td><td className="r mono">{fmt(r.additions)}</td><td className="r mono">{fmt(r.deductions)}</td><td className="r mono">{fmt(r.depreciation)}</td><td className="r mono">{fmt(r.closing_wdv)}</td></tr>))}
            {!d.rows.length && <tr><td colSpan={9} style={{ color: '#777', padding: 14 }}>No assets. Add one below.</td></tr>}
          </tbody>
          {d.rows.length > 0 && <tfoot><tr><td colSpan={4}>Total</td><td className="r mono">{fmt(d.totals.opening_wdv)}</td><td className="r mono">{fmt(d.totals.additions)}</td><td className="r mono">{fmt(d.totals.deductions)}</td><td className="r mono">{fmt(d.totals.depreciation)}</td><td className="r mono">{fmt(d.totals.closing_wdv)}</td></tr></tfoot>}
        </table>)}
        {d && <div className="acct-note">{d.note}</div>}
        <div className="acct-pane-head" style={{ marginTop: 14 }}>Add asset</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }} className="acct-no-print">
          <input placeholder="Asset name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={{ width: 180 }} />
          <input placeholder="Block" value={f.block} onChange={(e) => setF({ ...f, block: e.target.value })} style={{ width: 150 }} />
          <input type="date" value={f.purchase_date} onChange={(e) => setF({ ...f, purchase_date: e.target.value })} />
          <input placeholder="Cost" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} style={{ width: 100 }} inputMode="decimal" />
          <input placeholder="Rate%" value={f.rate_pct} onChange={(e) => setF({ ...f, rate_pct: e.target.value })} style={{ width: 60 }} inputMode="decimal" />
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option>WDV</option><option>SLM</option></select>
          <input placeholder="Opening WDV (optional)" value={f.opening_wdv} onChange={(e) => setF({ ...f, opening_wdv: e.target.value })} style={{ width: 150 }} inputMode="decimal" />
          <button className="acct-btn primary" disabled={!f.name || !f.cost} onClick={add}>Add</button>
        </div>
        {assets.length > 0 && (
          <table className="acct-table acct-no-print" style={{ marginTop: 10, maxWidth: 680 }}>
            <thead><tr><th>Registered asset</th><th>Block</th><th className="r">Cost</th><th className="r">Rate%</th><th className="r"></th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.asset_id}>
                  <td>{a.name}</td><td>{a.block || '—'}</td><td className="r mono">{fmt(Number(a.cost).toFixed(2))}</td><td className="r mono">{a.rate_pct}</td>
                  <td className="r"><span style={{ cursor: 'pointer', color: 'var(--a-err)' }} onClick={() => del(a)}>Remove</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
