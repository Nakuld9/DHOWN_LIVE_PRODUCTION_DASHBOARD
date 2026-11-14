// Accounting workspace — the Busy-style desktop shell: title bar, menu bar
// (Masters / Transactions / Display / Periods), a status footer, and keyboard
// navigation. Loads masters once and hands them to the views. Not the MES
// white/green/gold web look — a deliberate traditional accounting UI, scoped to
// `.acct`. All actions call the validated /api/acct backend.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './accounting.css';
import { acctApi, side } from './api';
import VoucherEntry from './VoucherEntry';
import DocumentEntry from './DocumentEntry';
import { VoucherRegister, TrialBalance, LedgerReport, DayBook, SalesPurchaseRegister } from './reports';
import { ProfitAndLoss, BalanceSheet } from './statements';
import { CashBankBook, Ageing, OutstandingStatement } from './books';
import { AutoPost } from './autopost';
import { Migration } from './migration';
import { BillAllocation } from './allocation';
import { StockStatus, GstSummary } from './stock';
import { Gstr9, Interest, Depreciation, AuditTrail } from './busyreports';
import { ChartOfAccounts, LedgerForm, GroupForm, ItemMaster } from './masters';

const MENUS = [
  { label: 'Masters', key: 'M', items: [
    { v: 'coa', label: 'Chart of Accounts' },
    { v: 'ledger-new', label: 'New Ledger', sc: 'Alt+L' },
    { v: 'group-new', label: 'New Group' },
    { sep: true },
    { v: 'items', label: 'Stock Items' },
  ] },
  { label: 'Transactions', key: 'T', items: [
    { v: 'd:SALES', label: 'Sales Invoice', sc: 'F8' },
    { v: 'd:PURCHASE', label: 'Purchase Invoice', sc: 'F9' },
    { v: 'd:SALES_RETURN', label: 'Sales Return' },
    { v: 'd:PURCHASE_RETURN', label: 'Purchase Return' },
    { v: 'd:CREDIT_NOTE', label: 'Credit Note' },
    { v: 'd:DEBIT_NOTE', label: 'Debit Note' },
    { sep: true },
    { v: 'v:RECEIPT', label: 'Receipt', sc: 'F6' },
    { v: 'v:PAYMENT', label: 'Payment', sc: 'F5' },
    { v: 'v:CONTRA', label: 'Contra', sc: 'F4' },
    { v: 'v:JOURNAL', label: 'Journal', sc: 'F7' },
    { sep: true },
    { v: 'register', label: 'Voucher Register' },
  ] },
  { label: 'Display', key: 'D', items: [
    { v: 'tb', label: 'Trial Balance' },
    { v: 'pnl', label: 'Profit & Loss A/c' },
    { v: 'bs', label: 'Balance Sheet' },
    { v: 'ledger', label: 'Account Ledger' },
    { v: 'daybook', label: 'Day Book' },
    { v: 'sales-reg', label: 'Sales Register' },
    { v: 'purchase-reg', label: 'Purchase Register' },
    { sep: true },
    { v: 'cashbank', label: 'Cash & Bank Book' },
    { v: 'ageing-r', label: 'Receivables Ageing' },
    { v: 'ageing-p', label: 'Payables Ageing' },
    { v: 'outstanding', label: 'Outstanding (bill-wise)' },
    { sep: true },
    { v: 'stock', label: 'Stock Status (valued)' },
    { v: 'gstsummary', label: 'GST Summary' },
    { v: 'gstr9', label: 'GSTR-9 (Annual)' },
    { v: 'interest', label: 'Interest Calculation' },
    { v: 'depreciation', label: 'Depreciation Chart' },
    { v: 'allocation', label: 'Bill-wise Allocation' },
    { v: 'autopost', label: 'MES Auto-Post' },
    { v: 'audit', label: 'Audit Trail' },
  ] },
  { label: 'Periods', key: 'P', items: [
    { v: 'periods', label: 'Financial Year / Periods' },
  ] },
  { label: 'Tools', key: 'O', items: [
    { v: 'migration', label: 'Busy XML Migration' },
  ] },
];

export default function AccountingWorkspace() {
  const nav = useNavigate();
  const [co, setCo] = useState(null);
  const [groups, setGroups] = useState([]);
  const [ledgers, setLedgers] = useState([]);
  const [vtypes, setVtypes] = useState([]);
  const [view, setView] = useState({ v: 'tb' });
  const [openMenu, setOpenMenu] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [bootErr, setBootErr] = useState('');
  const barRef = useRef(null);

  let role = '';
  try { role = (JSON.parse(localStorage.getItem('dhown_current_user') || localStorage.getItem('dhown_user') || '{}').role || '').toUpperCase(); } catch { /* noop */ }
  const RANK = { VIEWER: 1, AUDITOR: 1, OPERATOR: 2, SALES: 2, ACCOUNTS: 2, QC: 2, SUPERVISOR: 3, ADMIN: 4, SUPER_ADMIN: 5 };
  const canApprove = (RANK[role] || 0) >= 3;
  const canReverse = (RANK[role] || 0) >= 3;

  const loadMasters = useCallback(async () => {
    const [g, l] = await Promise.all([acctApi.groups(), acctApi.ledgers()]);
    setGroups(g); setLedgers(l);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [c, t] = await Promise.all([acctApi.company(), acctApi.voucherTypes()]);
        setCo(c); setVtypes(t); await loadMasters();
      } catch (e) {
        setBootErr(e.status === 403 ? 'You do not have access to Accounting (needs ACCOUNTS or SUPERVISOR).' : e.message);
      }
    })();
  }, [loadMasters]);

  const go = (v, extra = {}) => {
    if (dirty && !window.confirm('Discard unsaved voucher?')) return;
    setDirty(false); setOpenMenu(null);
    if (v === 'ledger-new') return setView({ v: 'ledger-form', ledger: null });
    if (v === 'group-new') return setView({ v: 'group-form' });
    if (v.startsWith('v:')) return setView({ v: 'voucher', type: v.slice(2), id: null, key: Date.now() });
    if (v.startsWith('d:')) return setView({ v: 'document', type: v.slice(2), key: Date.now() });
    setView({ v, ...extra });
  };
  const openVoucher = (id) => setView({ v: 'voucher', id, key: id });
  const openLedger = (ledger_id) => setView({ v: 'ledger', ledgerId: ledger_id });

  // Global shortcuts: F4 Contra, F5 Payment, F6 Receipt, F7 Journal, Esc back to TB.
  useEffect(() => {
    const h = (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.key !== 'Escape' && !e.key.startsWith('F')) return;
      const map = { F4: 'v:CONTRA', F5: 'v:PAYMENT', F6: 'v:RECEIPT', F7: 'v:JOURNAL', F8: 'd:SALES', F9: 'd:PURCHASE' };
      if (map[e.key]) { e.preventDefault(); go(map[e.key]); }
      else if (e.key === 'Escape' && view.v !== 'tb' && !dirty) go('tb');
      else if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); go('ledger-new'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }); // eslint-disable-line

  const exit = () => { if (dirty && !window.confirm('Discard unsaved voucher?')) return; nav('/'); };

  if (bootErr) {
    return <div className="acct"><div className="acct-titlebar"><b>Accounting</b><div className="spacer" /><button className="t-exit" onClick={() => nav('/')}>Exit</button></div>
      <div className="acct-body"><div className="acct-pane" style={{ maxWidth: 520 }}><div className="acct-pane-inner"><div className="acct-err-box">{bootErr}</div></div></div></div></div>;
  }

  const activeFy = co && co.financial_years.find((f) => f.is_active);

  return (
    <div className="acct" onClick={() => openMenu !== null && setOpenMenu(null)}>
      <div className="acct-titlebar">
        <b>DHOWN MES — Accounting</b>
        <span className="t-sub">{co ? co.name : ''}</span>
        <div className="spacer" />
        <button className="t-exit" onClick={exit}>Exit ✕</button>
      </div>

      <div className="acct-menubar" ref={barRef}>
        {MENUS.map((m, mi) => (
          <div key={m.label} className={'acct-menu' + (openMenu === mi ? ' open' : '')}>
            <button onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === mi ? null : mi); }}
              onMouseEnter={() => openMenu !== null && setOpenMenu(mi)}>
              <u>{m.label[0]}</u>{m.label.slice(1)}
            </button>
            {openMenu === mi && (
              <div className="acct-dropdown" onClick={(e) => e.stopPropagation()}>
                {m.items.map((it, ii) => it.sep
                  ? <div key={ii} className="sep" />
                  : <button key={ii} onClick={() => go(it.v)}>{it.label}{it.sc && <span className="sc">{it.sc}</span>}</button>)}
              </div>
            )}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div className="acct-menu"><button onClick={() => go('register')}>Vouchers</button></div>
        <div className="acct-menu"><button onClick={() => go('tb')}>Trial Balance</button></div>
      </div>

      <div className="acct-body">
        {!co ? <div className="acct-note">Loading accounting…</div> : (
          <>
            {view.v === 'coa' && <ChartOfAccounts groups={groups} ledgers={ledgers} reload={loadMasters}
              onEditLedger={(l) => setView({ v: 'ledger-form', ledger: l })} onNewLedger={() => go('ledger-new')} onNewGroup={() => go('group-new')} />}
            {view.v === 'ledger-form' && <LedgerForm groups={groups} ledger={view.ledger} onDone={(saved) => { if (saved) loadMasters(); setView({ v: 'coa' }); }} />}
            {view.v === 'group-form' && <GroupForm groups={groups} onDone={(saved) => { if (saved) loadMasters(); setView({ v: 'coa' }); }} />}
            {view.v === 'items' && <ItemMaster />}
            {view.v === 'voucher' && <VoucherEntry key={view.key} ledgers={ledgers} voucherType={view.type} voucherTypes={vtypes}
              existingId={view.id} canApprove={canApprove} canReverse={canReverse} onDirty={setDirty} company={co}
              onDone={() => { setDirty(false); go('register'); }} />}
            {view.v === 'document' && <DocumentEntry key={view.key} ledgers={ledgers} voucherType={view.type} onDone={() => go('register')} />}
            {view.v === 'register' && <VoucherRegister voucherTypes={vtypes} onOpen={openVoucher} />}
            {view.v === 'tb' && <TrialBalance onLedger={openLedger} />}
            {view.v === 'pnl' && <ProfitAndLoss onLedger={openLedger} />}
            {view.v === 'bs' && <BalanceSheet onLedger={openLedger} />}
            {view.v === 'ledger' && <LedgerReport ledgers={ledgers} ledgerId={view.ledgerId} onOpen={openVoucher} />}
            {view.v === 'daybook' && <DayBook onOpen={openVoucher} />}
            {view.v === 'sales-reg' && <SalesPurchaseRegister kind="SALES" />}
            {view.v === 'purchase-reg' && <SalesPurchaseRegister kind="PURCHASE" />}
            {view.v === 'cashbank' && <CashBankBook onLedger={openLedger} />}
            {view.v === 'ageing-r' && <Ageing key="r" initialKind="RECEIVABLE" onLedger={openLedger} />}
            {view.v === 'ageing-p' && <Ageing key="p" initialKind="PAYABLE" onLedger={openLedger} />}
            {view.v === 'outstanding' && <OutstandingStatement />}
            {view.v === 'stock' && <StockStatus />}
            {view.v === 'gstsummary' && <GstSummary />}
            {view.v === 'gstr9' && <Gstr9 />}
            {view.v === 'interest' && <Interest />}
            {view.v === 'depreciation' && <Depreciation />}
            {view.v === 'allocation' && <BillAllocation ledgers={ledgers} />}
            {view.v === 'autopost' && <AutoPost onOpen={openVoucher} />}
            {view.v === 'audit' && <AuditTrail />}
            {view.v === 'periods' && <Periods co={co} />}
            {view.v === 'migration' && <Migration />}
          </>
        )}
      </div>

      <div className="acct-statusbar">
        <span className="st">Company: <b>{co ? co.name : '—'}</b></span>
        <span className="st">F.Y.: <b>{activeFy ? activeFy.label : '—'}</b></span>
        <span className="st">User: <b>{role || '—'}</b></span>
        <span className="spacer st" style={{ borderRight: 'none' }} />
        <span className="st">F4 Contra · F5 Payment · F6 Receipt · F7 Journal · F8 Sales · F9 Purchase · Esc Back</span>
        <span className="st">{new Date().toLocaleDateString('en-GB')}</span>
      </div>
    </div>
  );
}

function Periods({ co }) {
  const [fy, setFy] = useState(co.financial_years.find((f) => f.is_active)?.fy_id || co.financial_years[0]?.fy_id);
  const [rows, setRows] = useState([]); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const load = useCallback(() => { acctApi.periods(fy).then(setRows).catch((e) => setErr(e.message)); }, [fy]);
  useEffect(() => { load(); }, [load]);
  const change = async (p, status) => {
    setErr(''); setMsg('');
    let reason = null;
    if (status === 'OPEN' && p.status !== 'OPEN') { reason = window.prompt('Reason for re-opening this period (recorded in the audit trail):'); if (!reason) return; }
    try { await acctApi.setPeriod(p.period_id, { status, reason }); setMsg(`Period ${status.toLowerCase()}.`); load(); }
    catch (e) { setErr(e.message); }
  };
  return (
    <div className="acct-pane" style={{ maxWidth: 680 }}>
      <div className="acct-pane-head">Financial Year &amp; Periods</div>
      <div className="acct-pane-inner">
        {err && <div className="acct-err-box">{err}</div>}
        {msg && <div className="acct-ok-box">{msg}</div>}
        <div className="acct-field"><label>Financial Year</label>
          <select value={fy} onChange={(e) => setFy(Number(e.target.value))}>
            {co.financial_years.map((f) => <option key={f.fy_id} value={f.fy_id}>{f.label}{f.is_closed ? ' (closed)' : ''}</option>)}
          </select>
        </div>
        <table className="acct-table">
          <thead><tr><th>Period</th><th>From</th><th>To</th><th>Status</th><th className="r">Action</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.period_id}>
                <td>Month {p.period_no}</td><td className="mono">{p.start_date}</td><td className="mono">{p.end_date}</td>
                <td><span className={'acct-badge b-' + (p.status === 'OPEN' ? 'APPROVED' : 'REVERSED')}>{p.status}</span></td>
                <td className="r">
                  {p.status === 'OPEN'
                    ? <button className="acct-btn" onClick={() => change(p, 'CLOSED')}>Close</button>
                    : <button className="acct-btn" onClick={() => change(p, 'OPEN')}>Re-open</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="acct-note">Closing a period blocks new postings in it. Re-opening is audited and needs a reason.</div>
      </div>
    </div>
  );
}
