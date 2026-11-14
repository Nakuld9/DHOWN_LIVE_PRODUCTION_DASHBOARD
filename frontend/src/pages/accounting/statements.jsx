// Profit & Loss and Balance Sheet — traditional two-sided statement layout.
import React, { useState, useEffect } from 'react';
import { acctApi, fmt, today } from './api';

function useReport(fn, dep) {
  const [d, setD] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { setErr(''); fn().then(setD).catch((e) => setErr(e.message)); }, [dep]); // eslint-disable-line
  return { d, err };
}

const GroupBlock = ({ title, groups, total, onLedger, boldTotalLabel }) => (
  <>
    <tr className="grp"><td colSpan={2}>{title}</td></tr>
    {groups.map((g) => (<React.Fragment key={g.group_id}>
      <tr><td style={{ paddingLeft: 16, fontWeight: 600 }}>{g.name}</td><td className="r mono">{fmt((g.amount / 100).toFixed(2))}</td></tr>
      {g.ledgers.map((l) => (
        <tr key={l.ledger_id} onClick={() => onLedger && onLedger(l.ledger_id)} style={{ cursor: onLedger ? 'pointer' : 'default' }}>
          <td style={{ paddingLeft: 34, color: '#333' }}><span className={onLedger ? 'acct-link' : ''}>{l.name}</span></td>
          <td className="r mono" style={{ color: '#333' }}>{fmt((l.amount / 100).toFixed(2))}</td>
        </tr>
      ))}
    </React.Fragment>))}
  </>
);

export function ProfitAndLoss({ onLedger }) {
  const [asOf, setAsOf] = useState(today());
  const { d, err } = useReport(() => acctApi.pnl({ as_of: asOf }), asOf);
  return (
    <div className="acct-pane">
      <div className="acct-pane-head">Profit &amp; Loss Account{d && <span className="ph-sub">{d.fy.label} · up to {d.fy.to}</span>}</div>
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }} className="acct-no-print">
          As on <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {d && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <table className="acct-table" style={{ flex: '1 1 340px' }}>
              <thead><tr><th>Expenses (Dr)</th><th className="r">Amount</th></tr></thead>
              <tbody>
                <GroupBlock title="Expenses" groups={d.expense} onLedger={onLedger} />
                {d.is_profit && <tr className="grp"><td style={{ color: 'var(--a-ok)' }}>Net Profit c/d</td><td className="r mono" style={{ color: 'var(--a-ok)' }}>{fmt(d.net_profit)}</td></tr>}
              </tbody>
              <tfoot><tr><td>Total</td><td className="r mono">{fmt(d.is_profit ? d.total_income : d.total_expense)}</td></tr></tfoot>
            </table>
            <table className="acct-table" style={{ flex: '1 1 340px' }}>
              <thead><tr><th>Income (Cr)</th><th className="r">Amount</th></tr></thead>
              <tbody>
                <GroupBlock title="Income" groups={d.income} onLedger={onLedger} />
                {!d.is_profit && <tr className="grp"><td style={{ color: 'var(--a-err)' }}>Net Loss c/d</td><td className="r mono" style={{ color: 'var(--a-err)' }}>{fmt(d.net_profit)}</td></tr>}
              </tbody>
              <tfoot><tr><td>Total</td><td className="r mono">{fmt(d.is_profit ? d.total_income : d.total_expense)}</td></tr></tfoot>
            </table>
          </div>
        )}
        {d && <div className="acct-note" style={{ marginTop: 8, fontWeight: 700, color: d.is_profit ? 'var(--a-ok)' : 'var(--a-err)' }}>
          Net {d.is_profit ? 'Profit' : 'Loss'} for the period: {fmt(d.net_profit)}
        </div>}
      </div>
    </div>
  );
}

export function BalanceSheet({ onLedger }) {
  const [asOf, setAsOf] = useState(today());
  const { d, err } = useReport(() => acctApi.balanceSheet({ as_of: asOf }), asOf);
  return (
    <div className="acct-pane">
      <div className="acct-pane-head">Balance Sheet{d && <span className="ph-sub">as at {d.fy.to}</span>}</div>
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }} className="acct-no-print">
          As at <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {d && !d.balanced && <div className="acct-err-box">Balance sheet does not tie — review opening balances.</div>}
        {d && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <table className="acct-table" style={{ flex: '1 1 340px' }}>
              <thead><tr><th>Liabilities</th><th className="r">Amount</th></tr></thead>
              <tbody>
                <GroupBlock title="Capital & Liabilities" groups={d.liabilities} onLedger={onLedger} />
                <tr className="grp"><td style={{ color: d.is_profit ? 'var(--a-ok)' : 'var(--a-err)' }}>{d.is_profit ? 'Net Profit' : 'Net Loss'} (current period)</td>
                  <td className="r mono" style={{ color: d.is_profit ? 'var(--a-ok)' : 'var(--a-err)' }}>{d.is_profit ? '' : '-'}{fmt(d.net_profit)}</td></tr>
              </tbody>
              <tfoot><tr><td>Total</td><td className="r mono">{fmt(d.total_liabilities)}</td></tr></tfoot>
            </table>
            <table className="acct-table" style={{ flex: '1 1 340px' }}>
              <thead><tr><th>Assets</th><th className="r">Amount</th></tr></thead>
              <tbody><GroupBlock title="Assets" groups={d.assets} onLedger={onLedger} /></tbody>
              <tfoot><tr><td>Total</td><td className="r mono">{fmt(d.total_assets)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
