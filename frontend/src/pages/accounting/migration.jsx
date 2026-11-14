// Phase 5 view — Busy XML migration. Paste/load an authorised Busy export, run a
// dry-run reconciliation, import in shadow (DRAFT) or POST mode, then reconcile
// or roll a batch back. Busy stays the book of record until a reviewed cutover.
import React, { useState, useEffect, useCallback } from 'react';
import { acctApi } from './api';

export function Migration() {
  const [xml, setXml] = useState('');
  const [dry, setDry] = useState(null);
  const [batches, setBatches] = useState([]);
  const [recon, setRecon] = useState(null);
  const [mode, setMode] = useState('DRAFT');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);

  const loadBatches = useCallback(() => { acctApi.migBatches().then(setBatches).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { setXml(String(r.result || '')); setDry(null); }; r.readAsText(f);
  };
  const run = async (fn, okMsg) => {
    setErr(''); setMsg(''); setBusy(true);
    try { const r = await fn(); if (okMsg) setMsg(typeof okMsg === 'function' ? okMsg(r) : okMsg); loadBatches(); return r; }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const T = dry && dry.export_totals;
  return (
    <div className="acct-pane">
      <div className="acct-pane-head">Busy XML Migration<span className="ph-sub">Data Export/Import → DHOWN ledger</span></div>
      <div className="acct-pane-inner">
        {err && <div className="acct-err-box">{err}</div>}
        {msg && <div className="acct-ok-box">{msg}</div>}

        <div className="acct-field"><label>Busy export</label>
          <input type="file" accept=".xml,text/xml" onChange={onFile} />
        </div>
        <textarea value={xml} onChange={(e) => { setXml(e.target.value); setDry(null); }} spellCheck={false}
          placeholder="…or paste the Busy XML export here" style={{ width: '100%', minHeight: 120, fontFamily: 'var(--a-mono)', fontSize: 12 }} />

        <div className="acct-btnbar">
          <button className="acct-btn" disabled={busy || !xml.trim()} onClick={() => run(() => acctApi.migDryRun(xml), 'Dry-run complete.').then((r) => r && setDry(r))}>Dry-run</button>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="DRAFT">Shadow (DRAFT)</option>
            <option value="POST">Post (after cutover)</option>
          </select>
          <input placeholder="Batch label" value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 180 }} />
          <button className="acct-btn primary" disabled={busy || !xml.trim() || (dry && !dry.ok_to_import)}
            onClick={() => run(() => acctApi.migImport({ xml, mode, label }), (r) => `Imported batch #${r.batch_id}: ${r.stats.vouchers_created} vouchers, ${r.stats.ledgers_created} ledgers.`)}>Import</button>
        </div>

        {dry && (
          <div className="acct-note" style={{ marginTop: 6 }}>
            <b>Dry-run:</b> {dry.counts.groups_new}/{dry.counts.groups} new groups · {dry.counts.ledgers_new}/{dry.counts.ledgers} new ledgers · {dry.counts.vouchers} vouchers ({dry.counts.vouchers_duplicate} already imported).
            {T && <> Opening Dr {T.opening_dr} / Cr {T.opening_cr} (diff {T.opening_diff}). Voucher Dr {T.voucher_dr} / Cr {T.voucher_cr}. Unbalanced: {T.unbalanced_vouchers}.</>}
            {!dry.ok_to_import && <span style={{ color: 'var(--a-err)' }}> Not safe to import — fix the export.</span>}
            {dry.warnings && dry.warnings.length > 0 && (
              <ul style={{ margin: '6px 0 0 16px', color: 'var(--a-err)' }}>{dry.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}</ul>
            )}
          </div>
        )}

        <h4 style={{ margin: '16px 0 6px' }}>Migration batches</h4>
        <table className="acct-table">
          <thead><tr><th>#</th><th>Label</th><th>Mode</th><th>Vouchers</th><th>Status</th><th className="r acct-no-print">Actions</th></tr></thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.batch_id}>
                <td className="mono">{b.batch_id}</td><td>{b.label}</td><td>{b.mode}</td>
                <td className="mono">{b.stats ? `${b.stats.vouchers_created || 0}` : '—'}</td>
                <td><span className={'acct-badge b-' + (b.status === 'ROLLED_BACK' ? 'REVERSED' : 'APPROVED')}>{b.status}</span></td>
                <td className="r acct-no-print">
                  <button className="acct-btn" disabled={busy} onClick={() => run(() => acctApi.migReconcile(b.batch_id)).then((r) => r && setRecon({ id: b.batch_id, ...r }))}>Reconcile</button>
                  {b.status !== 'ROLLED_BACK' && <button className="acct-btn" disabled={busy} style={{ marginLeft: 6 }}
                    onClick={() => window.confirm(`Roll back batch #${b.batch_id}? Its vouchers will be reversed/cancelled.`) && run(() => acctApi.migRollback(b.batch_id), 'Batch rolled back.')}>Rollback</button>}
                </td>
              </tr>
            ))}
            {!batches.length && <tr><td colSpan={6} style={{ color: '#777', padding: 14 }}>No migration batches yet.</td></tr>}
          </tbody>
        </table>
        {recon && (
          <div className="acct-note" style={{ marginTop: 6 }}>
            <b>Batch #{recon.id}:</b> {recon.mode} · trial balance {recon.trial_balance_ties ? 'ties ✓' : 'does NOT tie ✗'} · posted effect Dr {recon.posted_effect.dr} / Cr {recon.posted_effect.cr}. {recon.note}
          </div>
        )}
        <div className="acct-note">Shadow import leaves Busy as the record: migrated vouchers are DRAFT until reconciled and posted at cutover. Rollback reverses posted vouchers / cancels drafts (imported masters are kept).</div>
      </div>
    </div>
  );
}
