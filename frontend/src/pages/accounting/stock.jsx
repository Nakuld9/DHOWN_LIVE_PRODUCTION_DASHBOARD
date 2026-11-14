// Path C views — Valued Stock Status (ties to GL Inventory) and the Busy-style
// consolidated GST Summary. Both read real MES data; honest when a side is empty.
import React, { useState, useEffect } from 'react';
import { acctApi, fmt, today } from './api';

function useLoad(fn, dep) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { setErr(''); fn().then(setD).catch((e) => setErr(e.message)); }, [dep]); // eslint-disable-line
  return { d, err };
}

export function StockStatus() {
  const [asOf, setAsOf] = useState(today());
  const { d, err } = useLoad(() => acctApi.stockValuation({ as_of: asOf }), asOf);
  const Section = ({ title, data, qtyLabel }) => (
    <table className="acct-table" style={{ flex: '1 1 360px' }}>
      <thead><tr><th>{title}</th><th className="r">{qtyLabel}</th><th className="r">Value</th></tr></thead>
      <tbody>
        {data.items.map((x, i) => (<tr key={i}><td>{x.item}</td><td className="r mono">{fmt((x.kg || 0).toFixed(3))}</td><td className="r mono">{fmt((x.value || 0).toFixed(2))}</td></tr>))}
        {!data.items.length && <tr><td colSpan={3} style={{ color: '#777', padding: 12 }}>No stock.</td></tr>}
      </tbody>
      <tfoot><tr><td>Total</td><td className="r mono">{fmt((data.total_kg || 0).toFixed(3))}</td><td className="r mono">{fmt((data.total_value || 0).toFixed(2))}</td></tr></tfoot>
    </table>
  );
  return (
    <div className="acct-pane">
      <div className="acct-pane-head">Stock Status (valued)<span className="ph-sub">FIFO lot cost · ties to GL Inventory</span></div>
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }} className="acct-no-print">
          As on <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {d && (<>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Section title="Yarn (raw material)" data={d.yarn} qtyLabel="Kg" />
            <Section title="Finished goods" data={d.finished} qtyLabel="Kg" />
          </div>
          <div className="acct-note" style={{ marginTop: 8, fontWeight: 600 }}>
            Total stock value: {fmt((d.total_stock_value || 0).toFixed(2))}
            {d.gl_stock && <> · GL ledgers — Raw {fmt(((d.gl_stock.raw && d.gl_stock.raw.value) || 0).toFixed(2))} · WIP {fmt(((d.gl_stock.wip && d.gl_stock.wip.value) || 0).toFixed(2))} · FG {fmt(((d.gl_stock.finished && d.gl_stock.finished.value) || 0).toFixed(2))} = {fmt((d.gl_stock.total || 0).toFixed(2))}
              {d.reconciled ? <span style={{ color: 'var(--a-ok)' }}> · reconciled ✓</span> : <span style={{ color: 'var(--a-err)' }}> · diff {fmt((d.difference || 0).toFixed(2))}</span>}</>}
          </div>
          {d.notes && d.notes.map((n, i) => <div key={i} className="acct-note">{n}</div>)}
        </>)}
      </div>
    </div>
  );
}

export function GstSummary() {
  const [from, setFrom] = useState(today().slice(0, 4) + '-04-01');
  const [to, setTo] = useState(today());
  const { d, err } = useLoad(() => acctApi.gstSummary({ from, to }), from + to);
  const Block = ({ title, blk, sign }) => (
    <>
      <tr className="grp"><td>{title}</td><td className="r mono">{fmt(blk.total.taxable.toFixed(2))}</td><td className="r mono">{fmt(blk.total.igst.toFixed(2))}</td><td className="r mono">{fmt(blk.total.cgst.toFixed(2))}</td><td className="r mono">{fmt(blk.total.sgst.toFixed(2))}</td><td className="r mono">{fmt(blk.total.total_tax.toFixed(2))}</td></tr>
      {blk.lines.map((l, i) => (<tr key={i}><td style={{ paddingLeft: 20 }}>{l.label}</td><td className="r mono">{fmt(l.taxable.toFixed(2))}</td><td className="r mono">{fmt(l.igst.toFixed(2))}</td><td className="r mono">{fmt(l.cgst.toFixed(2))}</td><td className="r mono">{fmt(l.sgst.toFixed(2))}</td><td className="r mono">{fmt(l.total_tax.toFixed(2))}</td></tr>))}
    </>
  );
  const [dlErr, setDlErr] = useState('');
  const download = async (fn, name) => {
    setDlErr('');
    try {
      const r = await fn({ from, to });
      const blob = new Blob([JSON.stringify(r.json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = `${name}_${(to || from || '').slice(0, 7)}.json`; a.click(); URL.revokeObjectURL(url);
      if (r.warnings && r.warnings.length) setDlErr(`Downloaded ${name}. Notes: ${r.warnings.slice(0, 3).join(' · ')}`);
    } catch (e) { setDlErr(e.message); }
  };
  return (
    <div className="acct-pane">
      <div className="acct-pane-head">GST Summary<span className="ph-sub">Busy-style · Output + Input → net payable</span></div>
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }} className="acct-no-print">
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div style={{ flex: 1 }} />
          <button className="acct-btn" onClick={() => download(acctApi.gstr1Json, 'GSTR1')}>GSTR-1 JSON</button>
          <button className="acct-btn" onClick={() => download(acctApi.gstr3bJson, 'GSTR3B')}>GSTR-3B JSON</button>
          <button className="acct-btn" onClick={() => download(acctApi.ewayJson, 'EWayBill')}>E-Way JSON</button>
          <button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {dlErr && <div className="acct-note" style={{ color: 'var(--a-ok)' }}>{dlErr}</div>}
        {err && <div className="acct-err-box">{err}</div>}
        {d && (<>
          <table className="acct-table">
            <thead><tr><th>Details</th><th className="r">Taxable Amt.</th><th className="r">IGST</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">Total Tax</th></tr></thead>
            <tbody>
              <Block title="Output GST" blk={d.output} />
              {d.output_notes.lines.length > 0 && <Block title="Dr/Cr Note (Output)" blk={d.output_notes} />}
              <Block title="Input GST" blk={d.input} />
            </tbody>
          </table>
          <table className="acct-table" style={{ marginTop: 12, maxWidth: 560 }}>
            <thead><tr><th>Tax Calculation</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th></tr></thead>
            <tbody>
              <tr><td>Output Tax (net of notes)</td><td className="r mono">{fmt(d.tax_calculation.output_tax.cgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.output_tax.sgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.output_tax.igst.toFixed(2))}</td></tr>
              <tr><td>Less: Input ITC</td><td className="r mono">{fmt(d.tax_calculation.input_itc.cgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.input_itc.sgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.input_itc.igst.toFixed(2))}</td></tr>
              <tr><td>Less: Opening balance</td><td className="r mono">{fmt(d.tax_calculation.opening.cgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.opening.sgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.opening.igst.toFixed(2))}</td></tr>
              {d.tax_calculation.input_itc.import_igst > 0 && <tr><td style={{ color: '#555' }}>(incl. import IGST)</td><td /><td /><td className="r mono">{fmt(d.tax_calculation.input_itc.import_igst.toFixed(2))}</td></tr>}
            </tbody>
            <tfoot>
              <tr><td>Net Payable, gross ({fmt(d.tax_calculation.net_payable.total.toFixed(2))})</td><td className="r mono">{fmt(d.tax_calculation.net_payable.cgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.net_payable.sgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.net_payable.igst.toFixed(2))}</td></tr>
              {d.tax_calculation.set_off && <tr style={{ fontWeight: 700 }}><td>Payable in CASH after set-off ({fmt(d.tax_calculation.set_off.payable_cash.total.toFixed(2))})</td><td className="r mono">{fmt(d.tax_calculation.set_off.payable_cash.cgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.set_off.payable_cash.sgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.set_off.payable_cash.igst.toFixed(2))}</td></tr>}
              {d.tax_calculation.set_off && <tr style={{ color: 'var(--a-ok)' }}><td>ITC carried forward</td><td className="r mono">{fmt(d.tax_calculation.set_off.credit_carried_forward.cgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.set_off.credit_carried_forward.sgst.toFixed(2))}</td><td className="r mono">{fmt(d.tax_calculation.set_off.credit_carried_forward.igst.toFixed(2))}</td></tr>}
            </tfoot>
          </table>
          <div className="acct-note" style={{ marginTop: 8 }}>Output: {d.sources.output}. Input: {d.sources.input}.</div>
          {d.notes && d.notes.map((n, i) => <div key={i} className="acct-note">{n}</div>)}
        </>)}
      </div>
    </div>
  );
}
