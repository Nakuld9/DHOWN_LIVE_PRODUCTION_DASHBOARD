// Read-only accounting views: Voucher Register, Trial Balance, Ledger statement,
// Day Book. Dense Busy-style tables with drill-down to the voucher.
import React, { useState, useEffect, useCallback } from 'react';
import AccountLookup from './AccountLookup';
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
  return { data, err, loading, reload: run };
}

const Head = ({ title, sub, children }) => (
  <div className="acct-pane-head">{title}{sub && <span className="ph-sub">{sub}</span>}{children}</div>
);

// ── Voucher Register ────────────────────────────────────────────────────────
export function VoucherRegister({ voucherTypes, onOpen }) {
  const [f, setF] = useState({ type: '', status: '', from: '', to: '', q: '' });
  const { data, err, loading, reload } = useLoad(() => acctApi.vouchers(f), [JSON.stringify(f)]);
  return (
    <div className="acct-pane">
      <Head title="Voucher Register" sub={data ? `${data.length} shown` : ''} />
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">All types</option>{voucherTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['', 'DRAFT', 'VALIDATED', 'APPROVED', 'POSTED', 'REVERSED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s || 'All status'}</option>)}</select>
          From <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          To <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          <input placeholder="Search no / party / narration" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ width: 220 }} />
          <button className="acct-btn" onClick={reload}>Refresh</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
          <table className="acct-table">
            <thead><tr><th>Date</th><th>Type</th><th>Vch No</th><th>Party / Narration</th><th>Reference</th><th className="r">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {(data || []).map((v) => (
                <tr key={v.voucher_id} onClick={() => onOpen(v.voucher_id)} style={{ cursor: 'pointer' }}>
                  <td className="mono">{v.voucher_date}</td><td>{v.voucher_type_name}</td>
                  <td className="mono"><span className="acct-link">{v.voucher_no || '(draft)'}</span></td>
                  <td>{v.party_name || v.narration || '—'}</td><td>{v.reference_no || ''}</td>
                  <td className="r mono">{fmt(v.amount)}</td>
                  <td><span className={'acct-badge b-' + v.status}>{v.status}</span></td>
                </tr>
              ))}
              {!loading && data && !data.length && <tr><td colSpan={7} style={{ color: '#777', padding: 14 }}>No vouchers.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Trial Balance ───────────────────────────────────────────────────────────
export function TrialBalance({ onLedger }) {
  const [asOf, setAsOf] = useState(today());
  const [grouped, setGrouped] = useState(false);
  const { data, err, loading } = useLoad(() => acctApi.trialBalance({ as_of: asOf }), [asOf]);
  return (
    <div className="acct-pane">
      <Head title="Trial Balance" sub={data ? `${data.fy.label} · up to ${data.fy.to}` : ''} />
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }} className="acct-no-print">
          As on <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          <label style={{ marginLeft: 8 }}><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group summary</label>
          <div style={{ flex: 1 }} />
          <button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {data && !data.balanced && <div className="acct-err-box">Trial balance does not tie — check opening balances.</div>}
        {data && (
          <table className="acct-table">
            <thead><tr><th>Particulars</th><th className="r">Opening</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Closing</th></tr></thead>
            <tbody>
              {grouped
                ? data.groups.filter((g) => !g.parent_id).map((g) => <GroupRows key={g.group_id} g={g} all={data.groups} ledgers={data.ledgers} onLedger={onLedger} />)
                : data.ledgers.map((l) => (
                  <tr key={l.ledger_id} onClick={() => onLedger(l.ledger_id)} style={{ cursor: 'pointer' }}>
                    <td><span className="acct-link">{l.name}</span> <small style={{ color: '#999' }}>({l.group_name})</small></td>
                    <td className="r mono">{side(l.opening)}</td>
                    <td className="r mono">{fmt(l.debit)}</td><td className="r mono">{fmt(l.credit)}</td>
                    <td className="r mono">{side(l.closing)}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr><td>Total</td>
                <td className="r mono">{fmt(data.totals.opening_dr)} Dr / {fmt(data.totals.opening_cr)} Cr</td>
                <td className="r mono">{fmt(data.totals.debit)}</td><td className="r mono">{fmt(data.totals.credit)}</td>
                <td className="r mono">{fmt(data.totals.closing_dr)} Dr / {fmt(data.totals.closing_cr)} Cr</td></tr>
              {data.opening_difference.amount !== '0.00' && <tr><td colSpan={5} style={{ color: 'var(--a-err)' }}>Difference in opening balances: {side(data.opening_difference)}</td></tr>}
            </tfoot>
          </table>
        )}
        {loading && <div className="acct-note">Loading…</div>}
      </div>
    </div>
  );
}
// Busy-style group-wise Trial Balance: each group is a header with its subtotal,
// its ledgers nested beneath, then child groups (recursively).
function GroupRows({ g, all, ledgers, onLedger, depth = 0 }) {
  const children = all.filter((x) => x.parent_id === g.group_id);
  const myLedgers = (ledgers || []).filter((l) => l.group_id === g.group_id);
  return (<>
    <tr className="grp"><td style={{ paddingLeft: 8 + depth * 16 }}>{g.name}</td><td></td><td></td><td></td><td className="r mono">{side(g.closing)}</td></tr>
    {myLedgers.map((l) => (
      <tr key={l.ledger_id} onClick={() => onLedger && onLedger(l.ledger_id)} style={{ cursor: onLedger ? 'pointer' : 'default' }}>
        <td style={{ paddingLeft: 8 + (depth + 1) * 16 }}><span className={onLedger ? 'acct-link' : ''}>{l.name}</span></td>
        <td className="r mono">{side(l.opening)}</td><td className="r mono">{fmt(l.debit)}</td><td className="r mono">{fmt(l.credit)}</td><td className="r mono">{side(l.closing)}</td>
      </tr>
    ))}
    {children.map((c) => <GroupRows key={c.group_id} g={c} all={all} ledgers={ledgers} onLedger={onLedger} depth={depth + 1} />)}
  </>);
}

// ── Ledger statement ────────────────────────────────────────────────────────
export function LedgerReport({ ledgers, ledgerId, onOpen }) {
  const [lid, setLid] = useState(ledgerId || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today());
  useEffect(() => { if (ledgerId) setLid(ledgerId); }, [ledgerId]);
  const { data, err, loading } = useLoad(() => (lid ? acctApi.ledgerReport({ ledger_id: lid, from, to }) : Promise.resolve(null)), [lid, from, to]);
  return (
    <div className="acct-pane">
      <Head title="Account Ledger" sub={data ? `${data.ledger.name}` : ''} />
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }} className="acct-no-print">
          <div style={{ width: 260 }}><AccountLookup ledgers={ledgers} value={lid} onChange={setLid} placeholder="Select account…" /></div>
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()} disabled={!data}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {data && (
          <table className="acct-table">
            <thead><tr><th>Date</th><th>Particulars</th><th>Vch Type</th><th>Vch No</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th></tr></thead>
            <tbody>
              <tr><td className="mono">{data.from}</td><td colSpan={5}><i>Opening Balance b/f</i></td><td className="r mono">{side(data.opening)}</td></tr>
              {data.lines.map((l, i) => {
                // Busy convention: "To <account>" on a debit row, "By <account>" on a credit row.
                const isDr = l.debit && l.debit !== '0.00';
                const prefix = isDr ? 'To ' : 'By ';
                return (
                  <tr key={i} onClick={() => onOpen(l.voucher_id)} style={{ cursor: 'pointer' }}>
                    <td className="mono">{l.date}</td>
                    <td><span style={{ color: 'var(--a-muted, #888)' }}>{prefix}</span>{l.particulars || l.narration || ''}</td>
                    <td>{l.voucher_type}</td>
                    <td className="mono"><span className="acct-link">{l.voucher_no}</span></td>
                    <td className="r mono">{fmt(l.debit)}</td><td className="r mono">{fmt(l.credit)}</td><td className="r mono">{side(l.balance)}</td>
                  </tr>
                );
              })}
              <tr><td className="mono">{data.to}</td><td colSpan={5}><i>Closing Balance c/f</i></td><td className="r mono">{side(data.closing)}</td></tr>
            </tbody>
            <tfoot><tr><td colSpan={4}>Total</td><td className="r mono">{fmt(data.total_debit)}</td><td className="r mono">{fmt(data.total_credit)}</td><td className="r mono">{side(data.closing)}</td></tr></tfoot>
          </table>
        )}
        {loading && <div className="acct-note">Loading…</div>}
        {!lid && <div className="acct-note">Choose an account to view its ledger.</div>}
      </div>
    </div>
  );
}

// ── Day Book ────────────────────────────────────────────────────────────────
export function DayBook({ onOpen }) {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const { data, err } = useLoad(() => acctApi.dayBook({ from, to }), [from, to]);
  return (
    <div className="acct-pane">
      <Head title="Day Book" sub={data ? `${data.vouchers.length} vouchers` : ''} />
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }} className="acct-no-print">
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {data && (
          <table className="acct-table">
            <thead><tr><th>Date</th><th>Particulars</th><th>Vch Type</th><th>Vch No</th><th className="r">Debit</th><th className="r">Credit</th></tr></thead>
            <tbody>
              {(() => {
                const groups = {};
                for (const v of data.vouchers) { (groups[v.voucher_date] = groups[v.voucher_date] || []).push(v); }
                return Object.keys(groups).sort().map((d) => {
                  const dayTotal = fmt(groups[d].reduce((s, v) => s + (parseFloat(String(v.amount).replace(/,/g, '')) || 0), 0).toFixed(2));
                  return (
                    <React.Fragment key={d}>
                      <tr className="grp"><td className="mono" colSpan={4}>{d}</td><td className="r mono">{dayTotal}</td><td className="r mono">{dayTotal}</td></tr>
                      {groups[d].map((v) => {
                        // Busy day book: debit legs first, then the credited accounts as "To <account>".
                        const legs = [...(v.legs || [])].sort((a, b) => (a.dr !== '0.00' ? 0 : 1) - (b.dr !== '0.00' ? 0 : 1));
                        if (!legs.length) {
                          return (
                            <tr key={v.voucher_id} onClick={() => onOpen(v.voucher_id)} style={{ cursor: 'pointer' }}>
                              <td /><td style={{ whiteSpace: 'normal' }}>{v.accounts}</td><td>{v.voucher_type_name}</td>
                              <td className="mono"><span className="acct-link">{v.voucher_no}</span></td><td className="r mono">{fmt(v.amount)}</td><td />
                            </tr>
                          );
                        }
                        return legs.map((leg, li) => {
                          const isDr = leg.dr !== '0.00';
                          return (
                            <tr key={v.voucher_id + '-' + li} onClick={() => onOpen(v.voucher_id)} style={{ cursor: 'pointer' }}>
                              <td />
                              <td style={{ paddingLeft: isDr ? 8 : 26 }}>{isDr ? leg.ledger : <><span style={{ color: 'var(--a-muted, #888)' }}>To </span>{leg.ledger}</>}</td>
                              <td>{li === 0 ? v.voucher_type_name : ''}</td>
                              <td className="mono">{li === 0 ? <span className="acct-link">{v.voucher_no}</span> : ''}</td>
                              <td className="r mono">{isDr ? fmt(leg.dr) : ''}</td>
                              <td className="r mono">{isDr ? '' : fmt(leg.cr)}</td>
                            </tr>
                          );
                        });
                      })}
                    </React.Fragment>
                  );
                });
              })()}
              {data && !data.vouchers.length && <tr><td colSpan={6} style={{ color: '#777', padding: 14 }}>No postings in this range.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Sales / Purchase Register (GST) ───────────────────────────────────────────
export function SalesPurchaseRegister({ kind = 'SALES' }) {
  const [from, setFrom] = useState(today().slice(0, 4) + '-04-01');
  const [to, setTo] = useState(today());
  const { data, err, loading } = useLoad(() => acctApi.register({ kind, from, to }), [kind, from, to]);
  const title = kind === 'PURCHASE' ? 'Purchase Register' : 'Sales Register';
  const t = data && data.totals;
  return (
    <div className="acct-pane">
      <Head title={title} sub={data ? `${data.rows.length} document(s)` : ''} />
      <div className="acct-pane-inner">
        <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }} className="acct-no-print">
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <div style={{ flex: 1 }} /><button className="acct-btn" onClick={() => window.print()}>Print</button>
        </div>
        {err && <div className="acct-err-box">{err}</div>}
        {data && (
          <table className="acct-table">
            <thead><tr><th>Date</th><th>Vch No</th><th>Type</th><th>{kind === 'PURCHASE' ? 'Supplier' : 'Customer'}</th><th>GSTIN</th>
              <th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th><th className="r">Total</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.voucher_id}>
                  <td className="mono">{r.voucher_date}</td><td className="mono">{r.voucher_no}</td><td>{r.voucher_type_name}</td>
                  <td>{r.party_name || ''}</td><td className="mono">{r.party_gstin || ''}</td>
                  <td className="r mono">{fmt(r.taxable)}</td><td className="r mono">{fmt(r.cgst)}</td><td className="r mono">{fmt(r.sgst)}</td>
                  <td className="r mono">{fmt(r.igst)}</td><td className="r mono" style={{ fontWeight: 600 }}>{fmt(r.total)}</td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={10} style={{ color: '#777', padding: 14 }}>No documents in this range.</td></tr>}
            </tbody>
            {t && <tfoot><tr><td colSpan={5}>Total</td>
              <td className="r mono">{fmt(t.taxable)}</td><td className="r mono">{fmt(t.cgst)}</td><td className="r mono">{fmt(t.sgst)}</td>
              <td className="r mono">{fmt(t.igst)}</td><td className="r mono">{fmt(t.total)}</td></tr></tfoot>}
          </table>
        )}
        {loading && <div className="acct-note">Loading…</div>}
      </div>
    </div>
  );
}
