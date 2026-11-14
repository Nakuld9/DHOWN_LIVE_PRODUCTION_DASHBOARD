// Phase 3/4 view — Bill-wise allocation (open items). Pick a party, pick the
// settlement voucher (a receipt/payment), and allocate it across open bills.
import React, { useState, useEffect, useCallback } from 'react';
import AccountLookup from './AccountLookup';
import { acctApi, fmt } from './api';

// Inline bill-wise allocation for a posted receipt/payment: the voucher is the
// settlement; tick the open bills it clears. Reuses the same /allocations APIs as
// the standalone screen. Shown right inside the voucher after posting (Busy pops
// the open bills during entry; here it follows the post, since the settle voucher
// must exist to allocate against).
export function BillAllocInline({ partyId, partyName, settleVoucherId }) {
  const [data, setData] = useState(null);
  const [avail, setAvail] = useState(null);
  const [amounts, setAmounts] = useState({});
  const [existing, setExisting] = useState([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    if (!partyId || !settleVoucherId) return;
    acctApi.openBills(partyId).then(setData).catch((e) => setErr(e.message));
    acctApi.settlementAvail(partyId, settleVoucherId).then(setAvail).catch(() => setAvail(null));
    acctApi.allocsForVoucher(settleVoucherId).then((rows) => setExisting(rows.filter((r) => r.settle_voucher_id === settleVoucherId))).catch(() => setExisting([]));
  }, [partyId, settleVoucherId]);
  useEffect(() => { reload(); }, [reload]);

  const doAllocate = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const lines = Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([bill_voucher_id, amount]) => ({ bill_voucher_id, amount }));
      if (!lines.length) throw new Error('Enter an amount against at least one bill');
      const r = await acctApi.allocate({ party_ledger_id: partyId, settle_voucher_id: settleVoucherId, lines });
      setMsg(`Allocated ${fmt(r.allocated)}.`); setAmounts({}); reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const undo = async (id) => { setErr(''); setMsg(''); try { await acctApi.unallocate(id); reload(); } catch (e) { setErr(e.message); } };

  if (!data) return null;
  const open = data.open || [];
  return (
    <div className="acct-no-print" style={{ marginTop: 12, borderTop: '1px dashed var(--a-border, #bbb)', paddingTop: 10 }}>
      <div className="acct-pane-head" style={{ marginBottom: 6 }}>Allocate to bills — {partyName}
        {avail && <span className="ph-sub">available {fmt(avail.available)} of {fmt(avail.settle)}</span>}</div>
      {err && <div className="acct-err-box">{err}</div>}
      {msg && <div className="acct-ok-box">{msg}</div>}
      <table className="acct-table">
        <thead><tr><th>Bill</th><th>Date</th><th>Ref</th><th className="r">Amount</th><th className="r">Outstanding</th><th className="r">Allocate</th></tr></thead>
        <tbody>
          {open.map((b) => (
            <tr key={b.voucher_id}>
              <td className="mono">{b.voucher_no}</td><td className="mono">{b.voucher_date}</td><td>{b.reference_no || ''}</td>
              <td className="r mono">{fmt(b.bill_amount)}</td>
              <td className="r mono" style={{ fontWeight: 600 }}>{fmt(b.outstanding)}</td>
              <td className="r">
                <input value={amounts[b.voucher_id] || ''} onChange={(e) => setAmounts({ ...amounts, [b.voucher_id]: e.target.value })}
                  inputMode="decimal" disabled={b.voucher_id === settleVoucherId} style={{ width: 90, textAlign: 'right' }} placeholder="0.00" />
              </td>
            </tr>
          ))}
          {!open.length && <tr><td colSpan={6} style={{ color: '#777', padding: 10 }}>No open bills for this party — nothing to allocate.</td></tr>}
        </tbody>
      </table>
      {open.length > 0 && <div className="acct-btnbar"><button className="acct-btn primary" disabled={busy} onClick={doAllocate}>Allocate</button></div>}
      {existing.length > 0 && (
        <table className="acct-table" style={{ maxWidth: 520, marginTop: 6 }}>
          <thead><tr><th>Allocated against</th><th className="r">Amount</th><th className="r"></th></tr></thead>
          <tbody>
            {existing.map((a) => (
              <tr key={a.alloc_id}>
                <td className="mono">{a.bill_no}</td><td className="r mono">{fmt(Number(a.amount).toFixed(2))}</td>
                <td className="r"><span style={{ cursor: 'pointer', color: 'var(--a-err)' }} onClick={() => undo(a.alloc_id)}>Remove</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function BillAllocation({ ledgers }) {
  const [party, setParty] = useState('');
  const [data, setData] = useState(null);
  const [settle, setSettle] = useState('');
  const [avail, setAvail] = useState(null);
  const [amounts, setAmounts] = useState({});
  const [existing, setExisting] = useState([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);

  const partyLedgers = ledgers.filter((l) => l.ledger_type === 'PARTY');
  const load = (pid) => { if (!pid) return; acctApi.openBills(pid).then(setData).catch((e) => setErr(e.message)); };
  useEffect(() => { setData(null); setAvail(null); setAmounts({}); setExisting([]); if (party) load(party); }, [party]);
  useEffect(() => {
    setAvail(null); setExisting([]);
    if (party && settle) {
      acctApi.settlementAvail(party, settle).then(setAvail).catch(() => setAvail(null));
      acctApi.allocsForVoucher(settle).then((rows) => setExisting(rows.filter((r) => r.settle_voucher_id === settle))).catch(() => setExisting([]));
    }
  }, [party, settle]);

  const undo = async (allocId) => {
    setErr(''); setMsg('');
    try { await acctApi.unallocate(allocId); setMsg('Allocation removed.'); load(party); acctApi.settlementAvail(party, settle).then(setAvail); acctApi.allocsForVoucher(settle).then((rows) => setExisting(rows.filter((r) => r.settle_voucher_id === settle))); }
    catch (e) { setErr(e.message); }
  };

  const settlements = (data ? data.bills : []); // any voucher can be a settlement; typically a receipt/payment
  const doAllocate = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try {
      const lines = Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([bill_voucher_id, amount]) => ({ bill_voucher_id, amount }));
      if (!settle) throw new Error('Pick the settlement voucher (the receipt/payment)');
      if (!lines.length) throw new Error('Enter an amount against at least one bill');
      const r = await acctApi.allocate({ party_ledger_id: party, settle_voucher_id: settle, lines });
      setMsg(`Allocated ${fmt(r.allocated)}.`); setAmounts({}); setData(r); acctApi.settlementAvail(party, settle).then(setAvail);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="acct-pane">
      <div className="acct-pane-head">Bill-wise Allocation<span className="ph-sub">open-item receivables / payables</span></div>
      <div className="acct-pane-inner">
        {err && <div className="acct-err-box">{err}</div>}
        {msg && <div className="acct-ok-box">{msg}</div>}
        <div className="acct-field"><label>Party</label><div style={{ width: 280 }}><AccountLookup ledgers={partyLedgers} value={party} onChange={setParty} placeholder="Select customer / supplier…" /></div></div>
        {data && (
          <>
            <div className="acct-field"><label>Settlement voucher</label>
              <select value={settle} onChange={(e) => setSettle(e.target.value)}>
                <option value="">— pick the receipt / payment —</option>
                {settlements.map((b) => <option key={b.voucher_id} value={b.voucher_id}>{b.voucher_no} · {b.voucher_date}</option>)}
              </select>
              {avail && <span className="acct-note" style={{ marginLeft: 10 }}>Available: <b>{fmt(avail.available)}</b> of {fmt(avail.settle)}</span>}
            </div>
            <table className="acct-table">
              <thead><tr><th>Bill</th><th>Date</th><th>Ref</th><th className="r">Amount</th><th className="r">Allocated</th><th className="r">Outstanding</th><th className="r acct-no-print">Allocate</th></tr></thead>
              <tbody>
                {data.open.map((b) => (
                  <tr key={b.voucher_id}>
                    <td className="mono">{b.voucher_no}</td><td className="mono">{b.voucher_date}</td><td>{b.reference_no || ''}</td>
                    <td className="r mono">{fmt(b.bill_amount)}</td><td className="r mono">{fmt(b.allocated)}</td>
                    <td className="r mono" style={{ fontWeight: 600 }}>{fmt(b.outstanding)}</td>
                    <td className="r acct-no-print">
                      <input value={amounts[b.voucher_id] || ''} onChange={(e) => setAmounts({ ...amounts, [b.voucher_id]: e.target.value })}
                        inputMode="decimal" disabled={!settle || b.voucher_id === settle} style={{ width: 90, textAlign: 'right' }} placeholder="0.00" />
                    </td>
                  </tr>
                ))}
                {!data.open.length && <tr><td colSpan={7} style={{ color: '#777', padding: 14 }}>No open bills — fully settled.</td></tr>}
              </tbody>
            </table>
            <div className="acct-btnbar">
              <button className="acct-btn primary" disabled={busy || !settle} onClick={doAllocate}>Allocate</button>
            </div>
            {settle && existing.length > 0 && (
              <>
                <div className="acct-pane-head" style={{ marginTop: 10 }}>Allocations on this settlement</div>
                <table className="acct-table" style={{ maxWidth: 560 }}>
                  <thead><tr><th>Against bill</th><th className="r">Amount</th><th className="r acct-no-print"></th></tr></thead>
                  <tbody>
                    {existing.map((a) => (
                      <tr key={a.alloc_id}>
                        <td className="mono">{a.bill_no}</td><td className="r mono">{fmt(Number(a.amount).toFixed(2))}</td>
                        <td className="r acct-no-print"><span style={{ cursor: 'pointer', color: 'var(--a-err)' }} onClick={() => undo(a.alloc_id)}>Remove</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
        {!party && <div className="acct-note">Choose a party to see its open bills. Allocation links a receipt/payment to the specific invoices it clears, giving true open-item ageing.</div>}
      </div>
    </div>
  );
}
