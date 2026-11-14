// Phase 4 view — MES Auto-Post monitor. Shows the approved posting policies and
// the transactional outbox (MES operational events → vouchers). Read-mostly:
// the only action is draining PENDING/FAILED rows, in shadow (DRAFT) mode by
// default so Busy stays the book of record.
import React, { useState, useEffect, useCallback } from 'react';
import { acctApi } from './api';

export function AutoPost({ onOpen }) {
  const [policies, setPolicies] = useState([]);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [syncSrc, setSyncSrc] = useState('all');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);

  const SRC = [
    { v: 'all', label: 'All sources' }, { v: 'grn', label: 'GRN (yarn receipt)' }, { v: 'issues', label: 'Yarn issues → WIP' },
    { v: 'cost-entries', label: 'Cost entries (wastage/jobwork/conversion)' }, { v: 'production', label: 'Production output → FG' }, { v: 'dispatch', label: 'Dispatch → COGS' },
  ];

  const load = useCallback(() => {
    setErr('');
    Promise.all([acctApi.mesPolicies(), acctApi.mesOutbox({ status })])
      .then(([p, o]) => { setPolicies(p); setRows(o); })
      .catch((e) => setErr(e.message));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const drain = async (mode) => {
    setBusy(true); setErr(''); setMsg('');
    try { const r = await acctApi.mesDrain({ mode }); setMsg(`Processed ${r.processed}, failed ${r.failed} of ${r.total}.`); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const badge = (s) => ({ PROCESSED: 'APPROVED', PENDING: 'DRAFT', FAILED: 'REVERSED', SKIPPED: 'CANCELLED' }[s] || 'DRAFT');

  return (
    <div className="acct-pane">
      <div className="acct-pane-head">MES Auto-Post<span className="ph-sub">operational events → ledger (shadow by default)</span></div>
      <div className="acct-pane-inner">
        {err && <div className="acct-err-box">{err}</div>}
        {msg && <div className="acct-ok-box">{msg}</div>}

        <div className="acct-note" style={{ marginBottom: 8 }}>
          Approved, versioned posting policies. Physical stock stays in the MES; these carry the GL valuation.
        </div>
        <table className="acct-table" style={{ maxWidth: 760, marginBottom: 16 }}>
          <thead><tr><th>Event</th><th className="r">Ver</th><th>Voucher</th><th>Rule</th><th>Status</th></tr></thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.policy_id}>
                <td className="mono">{p.event_type}</td><td className="r mono">v{p.version}</td><td>{p.voucher_type}</td>
                <td style={{ whiteSpace: 'normal', color: '#555' }}>{p.rule && p.rule.desc}</td>
                <td>{p.is_active ? <span className="acct-badge b-APPROVED">ACTIVE</span> : <span className="acct-badge b-CANCELLED">inactive</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>Event Outbox</b>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {['', 'PENDING', 'PROCESSED', 'FAILED', 'SKIPPED'].map((s) => <option key={s} value={s}>{s || 'All status'}</option>)}
          </select>
          <button className="acct-btn" onClick={load}>Refresh</button>
          <div style={{ flex: 1 }} />
          <select value={syncSrc} onChange={(e) => setSyncSrc(e.target.value)} title="Which MES source to read">
            {SRC.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
          <button className="acct-btn" disabled={busy} title="Read the chosen MES source(s) and enqueue them as shadow drafts"
            onClick={() => run(async () => {
              if (syncSrc === 'all') { const r = await acctApi.mesSyncAll({ mode: 'DRAFT' }); setMsg(`Synced MES: ${r.grns.emitted} GRN, ${r.issues.emitted} issue, ${r.cost_entries.emitted} cost, ${r.production.emitted} production, ${r.dispatch.emitted} dispatch.`); }
              else { const r = await acctApi.mesSync(syncSrc, { mode: 'DRAFT' }); setMsg(`Synced ${r.source}: ${r.emitted} emitted${r.skipped ? `, ${r.skipped} skipped` : ''}${r.failed ? `, ${r.failed} failed` : ''}.`); }
              load();
            })}>Sync</button>
          <button className="acct-btn" disabled={busy} onClick={() => drain('DRAFT')}>Process pending (shadow)</button>
        </div>
        <div style={{ maxHeight: '48vh', overflow: 'auto' }}>
          <table className="acct-table">
            <thead><tr><th>#</th><th>Event</th><th>Source Ref</th><th>Date</th><th>Status</th><th>Voucher</th><th className="r">Tries</th><th>Error</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.outbox_id} onClick={() => r.voucher_id && onOpen && onOpen(r.voucher_id)} style={{ cursor: r.voucher_id ? 'pointer' : 'default' }}>
                  <td className="mono">{r.outbox_id}</td><td className="mono">{r.event_type}</td><td className="mono">{r.source_ref}</td>
                  <td className="mono">{r.event_date || ''}</td>
                  <td><span className={'acct-badge b-' + badge(r.status)}>{r.status}</span></td>
                  <td className="mono">{r.voucher_id ? <span className="acct-link">open</span> : '—'}</td>
                  <td className="r mono">{r.attempts}</td>
                  <td style={{ whiteSpace: 'normal', color: 'var(--a-err)' }}>{r.last_error || ''}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} style={{ color: '#777', padding: 14 }}>No outbox events.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="acct-note">Shadow (DRAFT) keeps Busy the book of record. Live POST is enabled only after cutover (ACCT_OPS_LINK_MODE=POST).</div>
      </div>
    </div>
  );
}
