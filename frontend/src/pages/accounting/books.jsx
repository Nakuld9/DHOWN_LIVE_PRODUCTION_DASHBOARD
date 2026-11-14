// Phase 3 views: Cash & Bank Book and Receivables / Payables Ageing.
// Dense Busy-style read-only tables. Ageing is reconciled to its control account.
import React, { useState, useEffect, useCallback } from 'react';
import { acctApi, fmt, side, today } from './api';

function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const run = useCallback(() => {
    setLoading(true); setErr('');
    fn().then(setData).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, deps); // eslint-disable-line
  useEffect(() => { run(); }, [run]);
  return { data, err, loading };
}

const Head = ({ title, sub }) => (<div className="acct-pane-head">{title}{sub && <span className="ph-sub">{sub}</span>}</div>);

// ── Cash & Bank Book ──────────────────────────────────────────────────────────
export function CashBankBook({ onLedger }) {
  const [asOf, setAsOf] = useState(today());
  const { data, err, loading } = useLoad(() => acctApi.cashBank({ as_of: asOf }), [asOf]);
  const cash = (data?.ledgers || []).filter((l) => l.kind === 'CASH');
  const bank = (data?.ledgers || []).filter((l) => l.kind === 'BANK');
  const Section = ({ title, rows, total }) => (
    <>
      <tr className="grp"><td>{title}</td><td className="r mono">{side(total)}</td></tr>
      {rows.map((l) => (
        <tr key={l.ledger_id} onClick={() => onLedger && onLedger(l.ledger_id)} style={{ cursor: onLedger ? 'pointer' : 'default' }}>
          <td style={{ paddingLeft: 20 }}><span className={onLedger ? 'acct-link' : ''}>{l.name}</span> <small style={{ color: '#999' }}>({l.group_name})</small></td>
          <td className="r mono">{side(l.balance)}</td>
        </tr>
      ))}
      {!rows.length && <tr><td style={{ paddingLeft: 20, color: '#999' }}>No {title.toLowerCase()} accounts.</td><td /></tr>}
    </>
  );
  return (
    <div className="acct-pane">
      <Head title="Cash &amp; Bank Book" sub={data ? `as on ${data.as_of}` : ''} />
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }} className="acct-no-print">
          As on <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {data && (
          <table className="acct-table" style={{ maxWidth: 560 }}>
            <thead><tr><th>Account</th><th className="r">Balance</th></tr></thead>
            <tbody>
              <Section title="Cash" rows={cash} total={data.total_cash} />
              <Section title="Bank" rows={bank} total={data.total_bank} />
            </tbody>
            <tfoot><tr><td>Total Cash &amp; Bank</td><td className="r mono">{side(data.total)}</td></tr></tfoot>
          </table>
        )}
        {data && <div className="acct-note">Click an account to open its ledger (receipts Dr, payments Cr, running balance).</div>}
        {loading && <div className="acct-note">Loading…</div>}
      </div>
    </div>
  );
}

// ── Receivables / Payables Ageing ─────────────────────────────────────────────
export function Ageing({ onLedger, initialKind = 'RECEIVABLE' }) {
  const [kind, setKind] = useState(initialKind);
  const [asOf, setAsOf] = useState(today());
  const { data, err, loading } = useLoad(() => acctApi.ageing({ kind, as_of: asOf }), [kind, asOf]);
  const title = kind === 'PAYABLE' ? 'Payables Ageing' : 'Receivables Ageing';
  const t = data?.totals;
  return (
    <div className="acct-pane">
      <Head title={title} sub={data ? `as on ${data.as_of} · ${data.control_account.replace('_', ' ')}` : ''} />
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }} className="acct-no-print">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="RECEIVABLE">Receivables (debtors)</option>
            <option value="PAYABLE">Payables (creditors)</option>
          </select>
          As on <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {data && !data.reconciled && (
          <div className="acct-err-box">
            Ageing does not reconcile to the control account ({fmt(data.control_balance)}) — net aged {fmt(((parseFloat(t.outstanding) - parseFloat(t.advance))).toFixed(2))}.
          </div>
        )}
        {data && (
          <table className="acct-table">
            <thead><tr>
              <th>Party</th><th className="r">0-{data.buckets[0].split('-')[1]}</th>
              <th className="r">{data.buckets[1]}</th><th className="r">{data.buckets[2]}</th><th className="r">{data.buckets[3]}</th>
              <th className="r">Outstanding</th><th className="r">Oldest (d)</th>
            </tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.ledger_id} onClick={() => onLedger && onLedger(r.ledger_id)} style={{ cursor: onLedger ? 'pointer' : 'default' }}>
                  <td><span className={onLedger ? 'acct-link' : ''}>{r.name}</span>{parseFloat(r.advance) > 0 && <small style={{ color: 'var(--a-ok)' }}> · adv {fmt(r.advance)}</small>}</td>
                  <td className="r mono">{fmt(r.current)}</td><td className="r mono">{fmt(r.d31_60)}</td>
                  <td className="r mono">{fmt(r.d61_90)}</td>
                  <td className="r mono" style={{ color: parseFloat(r.d90_plus) > 0 ? 'var(--a-err)' : undefined }}>{fmt(r.d90_plus)}</td>
                  <td className="r mono" style={{ fontWeight: 600 }}>{fmt(r.outstanding)}</td>
                  <td className="r mono" style={{ color: r.overdue ? 'var(--a-err)' : '#777' }}>{r.oldest_days}{r.overdue ? ` (+${r.overdue})` : ''}</td>
                </tr>
              ))}
              {data && !data.rows.length && <tr><td colSpan={7} style={{ color: '#777', padding: 14 }}>Nothing outstanding.</td></tr>}
            </tbody>
            {t && <tfoot><tr>
              <td>Total</td><td className="r mono">{fmt(t.current)}</td><td className="r mono">{fmt(t.d31_60)}</td>
              <td className="r mono">{fmt(t.d61_90)}</td><td className="r mono">{fmt(t.d90_plus)}</td>
              <td className="r mono">{fmt(t.outstanding)}</td><td />
            </tr></tfoot>}
          </table>
        )}
        {data && (
          <div className="acct-note" style={{ marginTop: 6 }}>
            Control account <b>{data.control_account.replace('_', ' ')}</b>: {fmt(data.control_balance)}
            {data.reconciled ? <span style={{ color: 'var(--a-ok)' }}> · reconciled ✓</span> : null}
            {parseFloat(t?.advance || 0) > 0 && <> · advances received {fmt(t.advance)}</>}
            . Ageing is FIFO over posted entries (oldest open invoice first); bill-wise allocation lands with Phase 4.
          </div>
        )}
        {loading && <div className="acct-note">Loading…</div>}
      </div>
    </div>
  );
}

// ── Outstanding (bill-wise) ───────────────────────────────────────────────────
// Busy's "Outstanding / Bills Receivable|Payable": every open bill across all
// parties with its age, net of bill-wise allocations.
export function OutstandingStatement({ initialKind = 'RECEIVABLE' }) {
  const [kind, setKind] = useState(initialKind);
  const [asOf, setAsOf] = useState(today());
  const { d, err } = useLoad(() => acctApi.outstandingBills({ kind, as_of: asOf }), kind + asOf);
  const t = d && d.totals;
  const title = kind === 'PAYABLE' ? 'Outstanding Payables (bill-wise)' : 'Outstanding Receivables (bill-wise)';
  return (
    <div className="acct-pane">
      <Head title={title} sub={d ? `${d.rows.length} open bill(s)` : ''} />
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }} className="acct-no-print">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="RECEIVABLE">Receivables (customers)</option>
            <option value="PAYABLE">Payables (suppliers)</option>
          </select>
          As on <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {d && (
          <table className="acct-table">
            <thead><tr><th>Party</th><th>Vch No</th><th>Date</th><th>Ref</th><th className="r">Days</th>
              <th className="r">Bill Amount</th><th className="r">Received/Paid</th><th className="r">Outstanding</th></tr></thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.party_name}</td><td className="mono">{r.voucher_no}</td><td className="mono">{r.voucher_date}</td><td>{r.reference_no || ''}</td>
                  <td className="r mono" style={{ color: r.days > 90 ? 'var(--a-err)' : undefined }}>{r.days}</td>
                  <td className="r mono">{fmt(r.bill_amount)}</td><td className="r mono">{fmt(r.allocated)}</td>
                  <td className="r mono" style={{ fontWeight: 600 }}>{fmt(r.outstanding)}</td>
                </tr>
              ))}
              {!d.rows.length && <tr><td colSpan={8} style={{ color: '#777', padding: 14 }}>Nothing outstanding.</td></tr>}
            </tbody>
            {t && <tfoot><tr><td colSpan={5}>Total</td>
              <td className="r mono">{fmt(t.bill_amount)}</td><td className="r mono">{fmt(t.allocated)}</td><td className="r mono">{fmt(t.outstanding)}</td></tr></tfoot>}
          </table>
        )}
        <div className="acct-note" style={{ marginTop: 6 }}>Open items net of bill-wise allocations. "Received/Paid" is what has been allocated against each bill (allocate on the receipt/payment voucher).</div>
      </div>
    </div>
  );
}
