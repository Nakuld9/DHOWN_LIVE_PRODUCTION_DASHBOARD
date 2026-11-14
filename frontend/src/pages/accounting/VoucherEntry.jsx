// Voucher entry — keyboard-first dense grid, Busy-style. Debit/credit columns,
// live totals + difference, and the full lifecycle (save draft -> validate ->
// post, plus approve/reverse/cancel). Every action calls the validated backend.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import AccountLookup from './AccountLookup';
import { BillAllocInline } from './allocation';
import { acctApi, fmt, today, inWords } from './api';

const blankLine = () => ({ ledger_id: '', dr: '', cr: '' });
const n2 = (v) => { const x = parseFloat(String(v).replace(/,/g, '')); return isNaN(x) ? 0 : Math.round(x * 100); };

export default function VoucherEntry({ ledgers, voucherType, voucherTypes, existingId, canApprove, canReverse, onDone, onDirty, company }) {
  const [vid, setVid] = useState(existingId || null);
  const [vtype, setVtype] = useState(voucherType || 'JOURNAL');
  const [date, setDate] = useState(today());
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState([blankLine(), blankLine()]);
  const [status, setStatus] = useState('NEW');
  const [voucherNo, setVoucherNo] = useState('');
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState({});   // `${ledger_id}@${date}` -> {amount, side} | {loading} | null
  const firstRef = useRef(null);

  const readOnly = ['POSTED', 'REVERSED', 'CANCELLED'].includes(status);

  // Busy shows the current balance of each account as you select it. Fetch it
  // as-of the voucher date (cached per account+date).
  const fetchBal = useCallback((lid) => {
    if (!lid) return;
    const k = `${lid}@${date}`;
    if (bal[k]) return;
    setBal((b) => ({ ...b, [k]: { loading: true } }));
    acctApi.ledgerBalance(lid, date)
      .then((r) => setBal((b) => ({ ...b, [k]: r })))
      .catch(() => setBal((b) => ({ ...b, [k]: null })));
  }, [bal, date]);
  useEffect(() => { lines.forEach((l) => l.ledger_id && fetchBal(l.ledger_id)); }, [lines, fetchBal]);

  // Busy shows the next Vch No up front. Preview it until the voucher is posted
  // (posting assigns the real number from the series).
  const [previewNo, setPreviewNo] = useState('');
  useEffect(() => {
    if (voucherNo) { setPreviewNo(''); return undefined; }
    let on = true;
    acctApi.nextVoucherNo(vtype, date).then((r) => { if (on) setPreviewNo(r.voucher_no); }).catch(() => { if (on) setPreviewNo(''); });
    return () => { on = false; };
  }, [vtype, date, voucherNo]);

  const load = useCallback(async (id) => {
    const v = await acctApi.voucher(id);
    setVid(v.voucher_id); setVtype(v.voucher_type); setDate(v.voucher_date);
    setReference(v.reference_no || ''); setNarration(v.narration || ''); setStatus(v.status); setVoucherNo(v.voucher_no || '');
    setMeta(v);
    setLines(v.lines.length ? v.lines.map((l) => ({
      ledger_id: l.ledger_id, dr: l.dr_amount !== '0.00' ? l.dr_amount : '', cr: l.cr_amount !== '0.00' ? l.cr_amount : '', narration: l.narration,
    })) : [blankLine(), blankLine()]);
  }, []);

  useEffect(() => { if (existingId) load(existingId).catch((e) => setErr(e.message)); }, [existingId, load]);
  useEffect(() => { if (firstRef.current && !existingId) firstRef.current.focus(); }, [existingId]);

  const totDr = lines.reduce((s, l) => s + n2(l.dr), 0);
  const totCr = lines.reduce((s, l) => s + n2(l.cr), 0);
  const diff = totDr - totCr;
  const p2 = (p) => (p / 100).toFixed(2);

  const setLine = (i, patch) => {
    onDirty && onDirty(true);
    setLines((ls) => {
      const next = ls.map((l, j) => (j === i ? { ...l, ...patch } : l));
      // auto-add a trailing blank row
      if (i === next.length - 1 && (next[i].ledger_id || next[i].dr || next[i].cr)) next.push(blankLine());
      return next;
    });
  };
  const delLine = (i) => setLines((ls) => (ls.length <= 2 ? ls : ls.filter((_, j) => j !== i)));

  const payload = () => ({
    voucher_type: vtype, voucher_date: date, reference_no: reference || null, narration: narration || null,
    lines: lines.filter((l) => l.ledger_id || l.dr || l.cr).map((l) => ({ ledger_id: l.ledger_id, dr_amount: l.dr || '0', cr_amount: l.cr || '0', narration: l.narration || null })),
  });

  const run = async (fn, okMsg) => {
    setErr(''); setMsg(''); setBusy(true);
    try { await fn(); if (okMsg) setMsg(okMsg); onDirty && onDirty(false); }
    catch (e) { setErr(e.message + (e.details ? ' — ' + (Array.isArray(e.details) ? e.details.join(' ') : '') : '')); }
    finally { setBusy(false); }
  };

  const saveDraft = () => run(async () => {
    if (vid) { await acctApi.updateVoucher(vid, payload()); await load(vid); }
    else { const v = await acctApi.createVoucher(payload()); await load(v.voucher_id); }
  }, 'Saved as draft.');

  const savePost = () => run(async () => {
    let id = vid;
    if (id) await acctApi.updateVoucher(id, payload());
    else { const v = await acctApi.createVoucher(payload()); id = v.voucher_id; setVid(id); }
    const vr = await acctApi.validate(id);
    if (!vr.ok) { await load(id); throw new Error(vr.errors.join(' ')); }
    await acctApi.post(id); await load(id);
    setMsg('Posted.');
  });

  const doValidate = () => run(async () => {
    let id = vid; if (!id) { const v = await acctApi.createVoucher(payload()); id = v.voucher_id; setVid(id); } else await acctApi.updateVoucher(id, payload());
    const vr = await acctApi.validate(id); await load(id);
    if (!vr.ok) throw new Error(vr.errors.join(' '));
  }, 'Validated.');

  const doApprove = () => run(async () => { await acctApi.approve(vid); await load(vid); }, 'Approved.');
  const doCancel = () => run(async () => { await acctApi.cancel(vid); await load(vid); }, 'Cancelled.');
  const doReverse = () => run(async () => {
    const r = await acctApi.reverse(vid, {}); await load(vid);
    setMsg('Reversed by ' + r.reversal.voucher_no + '.');
  });

  // Enter advances through the grid. Ctrl+Enter = save & post.
  const gridKey = (e, i, col) => {
    if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault();
      const order = ['acc', 'dr', 'cr'];
      const ci = order.indexOf(col);
      if (ci < order.length - 1) { focusCell(i, order[ci + 1]); }
      else { focusCell(i + 1, 'acc'); }
    }
  };
  const focusCell = (i, col) => {
    const el = document.querySelector(`[data-cell="${i}-${col}"] input`) || document.querySelector(`[data-cell="${i}-${col}"]`);
    if (el) el.focus();
  };

  useEffect(() => {
    const h = (e) => {
      if (readOnly) return;
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); savePost(); }
      else if (e.ctrlKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveDraft(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }); // eslint-disable-line

  const typeName = (voucherTypes.find((t) => t.code === vtype) || {}).name || vtype;

  const ledName = (id) => (ledgers.find((x) => x.ledger_id === id) || {}).name || '';
  const ddmmyyyy = (d) => (d ? String(d).split('-').reverse().join('-') : '');
  const printLines = lines.filter((l) => l.ledger_id && (l.dr || l.cr));

  // Inline bill-wise allocation: a posted receipt/payment against a party can be
  // allocated to that party's open bills (Busy's bill-wise settlement).
  const partyLine = lines.find((l) => { const led = ledgers.find((x) => x.ledger_id === l.ledger_id); return led && led.ledger_type === 'PARTY'; });
  const partyId = (meta && meta.party_ledger_id) || (partyLine ? partyLine.ledger_id : null);
  const partyName = partyId ? ((ledgers.find((x) => x.ledger_id === partyId) || {}).name || (meta && meta.party_name) || 'Party') : null;
  const showAlloc = status === 'POSTED' && vid && partyId && ['RECEIPT', 'PAYMENT'].includes(vtype);

  return (
    <div className="acct-pane acct-voucher-pane">
      <div className="acct-pane-head">
        {typeName} Voucher {voucherNo
          ? <>— {voucherNo}</>
          : (previewNo && <span style={{ color: 'var(--a-muted, #888)', fontWeight: 400 }}>— No. {previewNo} <small>(on posting)</small></span>)}
        <span className="ph-sub">
          {status !== 'NEW' && <span className={'acct-badge b-' + status}>{status}</span>}
        </span>
      </div>
      <div className="acct-pane-inner">
        {err && <div className="acct-err-box">{err}</div>}
        {msg && <div className="acct-ok-box">{msg}</div>}

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            {!existingId && status === 'NEW' && (
              <div className="acct-field">
                <label>Voucher Type</label>
                <select value={vtype} onChange={(e) => setVtype(e.target.value)}>
                  {voucherTypes.filter((t) => t.code !== 'REVERSAL').map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div className="acct-field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} readOnly={readOnly} ref={firstRef} /></div>
            <div className="acct-field"><label>Reference No</label><input value={reference} onChange={(e) => setReference(e.target.value)} readOnly={readOnly} /></div>
          </div>
          <div style={{ flex: '1 1 320px' }}>
            {meta && meta.party_name && <div className="acct-field"><label>Party</label><input value={meta.party_name} readOnly /></div>}
            {meta && meta.reversal_of_no && <div className="acct-note">Reversal of {meta.reversal_of_no}</div>}
            {meta && meta.reversed_by_voucher_no && <div className="acct-note">Reversed by {meta.reversed_by_voucher_no}</div>}
            {meta && meta.created_by && <div className="acct-note">Entered by {meta.created_by}{meta.posted_by ? ` · posted by ${meta.posted_by}` : ''}</div>}
          </div>
        </div>

        <table className="acct-vgrid" style={{ marginTop: 10 }}>
          <thead>
            <tr><th style={{ width: 30 }}></th><th>Particulars (Account)</th><th className="r" style={{ width: 150 }}>Debit</th><th className="r" style={{ width: 150 }}>Credit</th><th style={{ width: 200 }}>Narration</th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ textAlign: 'center', color: '#888' }}>
                  {!readOnly && lines.length > 2 ? <span style={{ cursor: 'pointer' }} title="Remove line" onClick={() => delLine(i)}>×</span> : i + 1}
                </td>
                <td data-cell={`${i}-acc`} onKeyDown={(e) => gridKey(e, i, 'acc')}>
                  {readOnly
                    ? <input value={(ledgers.find((x) => x.ledger_id === l.ledger_id) || {}).name || ''} readOnly />
                    : <AccountLookup ledgers={ledgers} value={l.ledger_id} onChange={(id) => setLine(i, { ledger_id: id })} onPicked={() => focusCell(i, 'dr')} />}
                  {(() => { const o = l.ledger_id && bal[`${l.ledger_id}@${date}`]; if (!o || o.loading || !o.amount) return null;
                    return <div className="acct-note" style={{ marginTop: 2, fontSize: 11 }}>Cur Bal: {fmt(o.amount)} {o.side}</div>; })()}
                </td>
                <td className="r" data-cell={`${i}-dr`}>
                  <input value={l.dr} readOnly={readOnly} onKeyDown={(e) => gridKey(e, i, 'dr')}
                    onChange={(e) => setLine(i, { dr: e.target.value, cr: e.target.value ? '' : l.cr })} inputMode="decimal" />
                </td>
                <td className="r" data-cell={`${i}-cr`}>
                  <input value={l.cr} readOnly={readOnly} onKeyDown={(e) => gridKey(e, i, 'cr')}
                    onChange={(e) => setLine(i, { cr: e.target.value, dr: e.target.value ? '' : l.dr })} inputMode="decimal" />
                </td>
                <td><input value={l.narration || ''} readOnly={readOnly} onChange={(e) => setLine(i, { narration: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="vtot">
              <td></td><td style={{ textAlign: 'right' }}>Total</td>
              <td className="r">{fmt(p2(totDr))}</td><td className="r">{fmt(p2(totCr))}</td>
              <td style={{ color: diff === 0 ? 'var(--a-ok)' : 'var(--a-err)', fontFamily: 'var(--a-mono)' }}>
                {diff === 0 ? 'Balanced' : `Diff ${fmt(p2(Math.abs(diff)))} ${diff > 0 ? 'Dr' : 'Cr'}`}
              </td>
            </tr>
          </tfoot>
        </table>

        {totDr > 0 && <div className="acct-note" style={{ marginTop: 6 }}>In words: {inWords(p2(totDr))}</div>}

        <div className="acct-field" style={{ marginTop: 8 }}><label>Narration</label><input style={{ flex: 1 }} value={narration} onChange={(e) => setNarration(e.target.value)} readOnly={readOnly} placeholder="Voucher narration" /></div>

        <div className="acct-btnbar">
          {!readOnly && <>
            <button className="acct-btn" disabled={busy} onClick={saveDraft}>Save Draft <span style={{ color: '#888', fontSize: 11 }}>(Ctrl+S)</span></button>
            <button className="acct-btn" disabled={busy} onClick={doValidate}>Validate</button>
            {status === 'VALIDATED' && canApprove && <button className="acct-btn" disabled={busy} onClick={doApprove}>Approve</button>}
            <button className="acct-btn primary" disabled={busy || diff !== 0} onClick={savePost}>Post <span style={{ fontSize: 11 }}>(Ctrl+Enter)</span></button>
            {vid && ['DRAFT', 'VALIDATED', 'APPROVED'].includes(status) && <button className="acct-btn" disabled={busy} onClick={doCancel}>Cancel</button>}
          </>}
          {status === 'POSTED' && canReverse && <button className="acct-btn danger" disabled={busy} onClick={doReverse}>Reverse</button>}
          <div style={{ flex: 1 }} />
          <button className="acct-btn" onClick={() => window.print()}>Print</button>
          <button className="acct-btn" onClick={() => onDone && onDone()}>Close</button>
        </div>

        {showAlloc && <BillAllocInline partyId={partyId} partyName={partyName} settleVoucherId={vid} />}

        {/* Busy-format printable voucher — hidden on screen, shown only when printing. */}
        <div className="acct-print-voucher">
          <div className="pv-head">
            <div className="pv-company">{company ? company.name : ''}</div>
            {company && company.gstin && <div className="pv-sub">GSTIN: {company.gstin}{company.state_code ? ` · State: ${company.state_code}` : ''}</div>}
          </div>
          <div className="pv-title">{typeName} Voucher</div>
          <div className="pv-meta">
            <span>No.: {voucherNo || previewNo || '—'}</span>
            <span>Date: {ddmmyyyy(date)}</span>
          </div>
          <table className="pv-table">
            <thead><tr><th>Particulars</th><th>Debit</th><th>Credit</th></tr></thead>
            <tbody>
              {printLines.map((l, i) => (
                <tr key={i}>
                  <td>{ledName(l.ledger_id)}{l.narration ? ` — ${l.narration}` : ''}</td>
                  <td>{l.dr ? fmt(p2(n2(l.dr))) : ''}</td>
                  <td>{l.cr ? fmt(p2(n2(l.cr))) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>Total</td>
              <td style={{ fontWeight: 700 }}>{fmt(p2(totDr))}</td>
              <td style={{ fontWeight: 700 }}>{fmt(p2(totCr))}</td>
            </tr></tfoot>
          </table>
          <div className="pv-words">Amount (in words): {inWords(p2(totDr))}</div>
          {narration && <div className="pv-narr">Narration: {narration}</div>}
          <div className="pv-sign"><span>Prepared By</span><span>Checked By</span><span>Authorised Signatory</span></div>
        </div>
      </div>
    </div>
  );
}
