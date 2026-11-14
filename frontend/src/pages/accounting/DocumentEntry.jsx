// Sales / Purchase document voucher — item-line entry with a live GST computation
// (the server recomputes authoritatively on save). Busy-style dense grid.
import React, { useState, useMemo, useEffect } from 'react';
import AccountLookup from './AccountLookup';
import { acctApi, fmt, today, inWords } from './api';

const blank = () => ({ item_name: '', hsn_code: '', quantity: '', uom: 'KG', rate: '', gst_rate: '5' });
const r2 = (p) => (p / 100).toFixed(2);
const P = (v) => { const x = parseFloat(String(v).replace(/,/g, '')); return isNaN(x) ? 0 : Math.round(x * 100); };

export default function DocumentEntry({ ledgers, voucherType, onDone }) {
  const isSale = ['SALES', 'SALES_RETURN', 'CREDIT_NOTE'].includes(voucherType);
  const isNote = voucherType === 'CREDIT_NOTE' || voucherType === 'DEBIT_NOTE';
  const [date, setDate] = useState(today());
  const [party, setParty] = useState('');
  const [ref, setRef] = useState('');
  const [intra, setIntra] = useState(true);
  const [narration, setNarration] = useState('');
  const [rows, setRows] = useState([blank()]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [partyBal, setPartyBal] = useState(null);   // {amount, side} — Busy shows the party's outstanding

  const partyLedgers = useMemo(() => ledgers.filter((l) => l.ledger_type === 'PARTY'), [ledgers]);

  useEffect(() => {
    if (!party) { setPartyBal(null); return undefined; }
    let on = true;
    acctApi.ledgerBalance(party, date).then((r) => { if (on) setPartyBal(r); }).catch(() => { if (on) setPartyBal(null); });
    return () => { on = false; };
  }, [party, date]);

  // Busy shows the next document number up front (assigned for real on posting).
  const [previewNo, setPreviewNo] = useState('');
  useEffect(() => {
    let on = true;
    acctApi.nextVoucherNo(voucherType, date).then((r) => { if (on) setPreviewNo(r.voucher_no); }).catch(() => { if (on) setPreviewNo(''); });
    return () => { on = false; };
  }, [voucherType, date]);

  const setRow = (i, patch) => setRows((rs) => {
    const next = rs.map((r, j) => (j === i ? { ...r, ...patch } : r));
    if (i === next.length - 1 && (next[i].item_name || next[i].rate)) next.push(blank());
    return next;
  });
  const delRow = (i) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, j) => j !== i)));

  // Live totals (mirror of the server engine; server is authoritative on save).
  const calc = useMemo(() => {
    let taxable = 0, tax = 0;
    const lines = rows.filter((r) => r.item_name || r.rate).map((r) => {
      const gross = Math.round((parseFloat(r.quantity) || 0) * P(r.rate));
      const t = gross; // no discount field here (kept simple)
      const gt = Math.round(t * (parseFloat(r.gst_rate) || 0) / 100);
      taxable += t; tax += gt;
      return { ...r, taxable: t, tax: gt, total: t + gt };
    });
    const grandPre = taxable + tax;
    const grand = Math.round(grandPre / 100) * 100;
    return { lines, taxable, tax, grand, round_off: grand - grandPre };
  }, [rows]);

  const save = async (post) => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const items = rows.filter((r) => r.item_name && r.rate).map((r) => ({
        item_name: r.item_name, hsn_code: r.hsn_code || null, quantity: Number(r.quantity) || 0, uom: r.uom || null,
        rate: r.rate, gst_rate: Number(r.gst_rate) || 0,
      }));
      if (!party) throw new Error('Select the party account');
      if (!items.length) throw new Error('Add at least one item line');
      const v = await acctApi.createDoc({ voucher_type: voucherType, voucher_date: date, party_ledger_id: party, reference_no: ref || null, narration: narration || null, intra, items });
      if (post) await acctApi.post(v.voucher_id);
      setMsg(post ? `Posted ${v.voucher_no || ''}.` : 'Saved as draft.');
      setTimeout(() => onDone && onDone(), 700);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const typeName = { SALES: 'Sales', PURCHASE: 'Purchase', SALES_RETURN: 'Sales Return', PURCHASE_RETURN: 'Purchase Return', CREDIT_NOTE: 'Credit Note', DEBIT_NOTE: 'Debit Note' }[voucherType] || voucherType;
  const effectHint = {
    SALES: 'Dr Customer / Cr Sales + Output GST.', SALES_RETURN: 'Dr Sales + Output GST / Cr Customer.',
    CREDIT_NOTE: 'Dr Sales + Output GST / Cr Customer (reduces the receivable).',
    PURCHASE: 'Dr Purchase + Input GST / Cr Supplier.', PURCHASE_RETURN: 'Dr Supplier / Cr Purchase + Input GST.',
    DEBIT_NOTE: 'Dr Supplier / Cr Purchase + Input GST (reduces the payable).',
  }[voucherType];

  return (
    <div className="acct-pane">
      <div className="acct-pane-head">{typeName}{isNote ? '' : ' Invoice'}
        {previewNo && <span style={{ color: 'var(--a-muted, #888)', fontWeight: 400 }}> — No. {previewNo} <small>(on posting)</small></span>}</div>
      <div className="acct-pane-inner">
        {err && <div className="acct-err-box">{err}</div>}
        {msg && <div className="acct-ok-box">{msg}</div>}
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 340px' }}>
            <div className="acct-field"><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="acct-field"><label>{isSale ? 'Customer' : 'Supplier'} *</label><div style={{ flex: 1 }}><AccountLookup ledgers={partyLedgers} value={party} onChange={setParty} placeholder={`Select ${isSale ? 'customer' : 'supplier'}…`} /></div></div>
            {party && partyBal && partyBal.amount && partyBal.amount !== '0.00'
              && <div className="acct-note" style={{ fontSize: 11 }}>Outstanding: {fmt(partyBal.amount)} {partyBal.side}</div>}
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <div className="acct-field"><label>Invoice / Ref No</label><input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
            <div className="acct-field"><label>Supply</label>
              <select value={intra ? 'intra' : 'inter'} onChange={(e) => setIntra(e.target.value === 'intra')}>
                <option value="intra">Intra-state (CGST + SGST)</option><option value="inter">Inter-state (IGST)</option>
              </select>
            </div>
          </div>
        </div>

        <table className="acct-vgrid" style={{ marginTop: 10 }}>
          <thead><tr>
            <th style={{ width: 26 }}></th><th>Item</th><th style={{ width: 80 }}>HSN</th><th className="r" style={{ width: 80 }}>Qty</th>
            <th style={{ width: 60 }}>UoM</th><th className="r" style={{ width: 90 }}>Rate</th><th className="r" style={{ width: 70 }}>GST%</th>
            <th className="r" style={{ width: 110 }}>Taxable</th><th className="r" style={{ width: 110 }}>Total</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const c = calc.lines[calc.lines.findIndex((x) => x === r)] || {};
              const cl = calc.lines.find((x) => x.item_name === r.item_name && x.rate === r.rate && x === calc.lines[i]);
              const line = calc.lines[i] || {};
              return (
                <tr key={i}>
                  <td style={{ textAlign: 'center', color: '#888' }}>{rows.length > 1 ? <span style={{ cursor: 'pointer' }} onClick={() => delRow(i)}>×</span> : i + 1}</td>
                  <td><input value={r.item_name} onChange={(e) => setRow(i, { item_name: e.target.value })} placeholder="Item / description" /></td>
                  <td><input value={r.hsn_code} onChange={(e) => setRow(i, { hsn_code: e.target.value })} /></td>
                  <td className="r"><input value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} inputMode="decimal" /></td>
                  <td><input value={r.uom} onChange={(e) => setRow(i, { uom: e.target.value })} /></td>
                  <td className="r"><input value={r.rate} onChange={(e) => setRow(i, { rate: e.target.value })} inputMode="decimal" /></td>
                  <td className="r"><input value={r.gst_rate} onChange={(e) => setRow(i, { gst_rate: e.target.value })} inputMode="decimal" /></td>
                  <td className="r" style={{ padding: '4px 6px', fontFamily: 'var(--a-mono)' }}>{line.taxable ? fmt(r2(line.taxable)) : ''}</td>
                  <td className="r" style={{ padding: '4px 6px', fontFamily: 'var(--a-mono)' }}>{line.total ? fmt(r2(line.total)) : ''}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="vtot"><td colSpan={7} style={{ textAlign: 'right' }}>Taxable</td><td className="r">{fmt(r2(calc.taxable))}</td><td></td></tr>
            <tr className="vtot"><td colSpan={7} style={{ textAlign: 'right' }}>{intra ? 'CGST + SGST' : 'IGST'}</td><td className="r">{fmt(r2(calc.tax))}</td><td></td></tr>
            {calc.round_off !== 0 && <tr className="vtot"><td colSpan={7} style={{ textAlign: 'right' }}>Round off</td><td className="r">{fmt(r2(calc.round_off))}</td><td></td></tr>}
            <tr className="vtot"><td colSpan={7} style={{ textAlign: 'right' }}>Grand Total</td><td className="r" style={{ fontSize: 14 }}>{fmt(r2(calc.grand))}</td><td></td></tr>
          </tfoot>
        </table>

        {calc.grand > 0 && <div className="acct-note" style={{ marginTop: 6 }}>In words: {inWords(r2(calc.grand))}</div>}

        <div className="acct-field" style={{ marginTop: 8 }}><label>Narration</label><input style={{ flex: 1 }} value={narration} onChange={(e) => setNarration(e.target.value)} /></div>
        <div className="acct-note">GST is computed per line and re-checked on the server when you save. {effectHint}</div>

        <div className="acct-btnbar">
          <button className="acct-btn" disabled={busy} onClick={() => save(false)}>Save Draft</button>
          <button className="acct-btn primary" disabled={busy || !calc.grand} onClick={() => save(true)}>Save &amp; Post</button>
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => onDone && onDone()}>Close</button>
        </div>
      </div>
    </div>
  );
}
