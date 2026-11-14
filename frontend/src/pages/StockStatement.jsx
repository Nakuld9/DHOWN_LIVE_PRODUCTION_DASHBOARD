import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || '';

const MOVEMENT_COLORS = { IN: 'var(--green)', OUT: 'var(--crit)', TRANSFER: 'var(--gold-2)' };

export default function StockStatement() {
  const [tab, setTab] = useState('statement');
  const [statement, setStatement] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(false);

  const [stFilters, setStFilters] = useState({ as_of: '', warehouse_id: '' });
  const [lgFilters, setLgFilters] = useState({ from_date: '', to_date: '', doc_type: '', warehouse_id: '', page: 1 });

  const token = localStorage.getItem('dhown_token');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    axios.get(`${API}/api/erp/warehouses`, { headers })
      .then(r => setWarehouses(r.data.map(w => ({ warehouse_id: w.warehouse_id, name: w.name, code: w.code }))))
      .catch(() => {});
  }, []);

  const loadStatement = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/api/erp/stock-statement`, { headers, params: stFilters });
      setStatement(r.data);
    } catch {}
    setLoading(false);
  }, [stFilters]);

  const loadLedger = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/api/erp/stock-ledger`, { headers, params: { ...lgFilters, limit: 100 } });
      setLedger(r.data.data);
      setLedgerTotal(r.data.total);
    } catch {}
    setLoading(false);
  }, [lgFilters]);

  useEffect(() => { if (tab === 'statement') loadStatement(); }, [tab, loadStatement]);
  useEffect(() => { if (tab === 'ledger') loadLedger(); }, [tab, loadLedger]);

  // KPIs from statement
  const totalIn    = statement.reduce((a, r) => a + parseFloat(r.total_in  || 0), 0);
  const totalOut   = statement.reduce((a, r) => a + parseFloat(r.total_out || 0), 0);
  const totalBal   = statement.reduce((a, r) => a + parseFloat(r.balance   || 0), 0);
  const totalValue = statement.reduce((a, r) => a + parseFloat(r.balance_value || 0), 0);

  // Group statement by warehouse
  const grouped = statement.reduce((acc, row) => {
    const wh = row.warehouse_name || 'Unknown';
    if (!acc[wh]) acc[wh] = [];
    acc[wh].push(row);
    return acc;
  }, {});

  const DOC_TYPES = ['GRN','ROLL','ISSUE','SC_CHALLAN','SC_RECEIPT','DISPATCH'];

  return (
    <div style={{ padding: 24, color: 'var(--text)', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: 22, color: '#f1f5f9' }}>Stock Statement</h2>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--surface-2)', paddingBottom: 10 }}>
        {[['statement','📋 Stock Statement'],['ledger','📒 Transaction Ledger']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ background: tab===k?'var(--border)':'none', color: tab===k?'var(--link)':'var(--muted)',
              border:'none', padding:'7px 16px', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight: tab===k?700:500 }}>
            {l}
          </button>
        ))}
      </div>

      {/* ── STOCK STATEMENT TAB ── */}
      {tab === 'statement' && (
        <div>
          {/* Filters */}
          <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap', alignItems:'flex-end' }}>
            <label style={s.label}>As of Date
              <input type="date" value={stFilters.as_of}
                onChange={e => setStFilters(f => ({...f, as_of: e.target.value}))}
                style={s.input} />
            </label>
            <label style={s.label}>Warehouse
              <select value={stFilters.warehouse_id}
                onChange={e => setStFilters(f => ({...f, warehouse_id: e.target.value}))}
                style={s.select}>
                <option value="">All Warehouses</option>
                {warehouses.map(w => <option key={w.warehouse_id} value={w.warehouse_id}>{w.name}</option>)}
              </select>
            </label>
            <button onClick={loadStatement} disabled={loading} style={s.btnPrimary}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {/* KPI cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
            {[
              ['Total Received',  totalIn.toFixed(1)    + ' kg', 'var(--green)'],
              ['Total Issued Out',totalOut.toFixed(1)   + ' kg', 'var(--crit)'],
              ['Current Balance', totalBal.toFixed(1)   + ' kg', 'var(--link)'],
              ['Stock Value',     '₹' + Math.round(totalValue).toLocaleString(), 'var(--gold-2)'],
            ].map(([label,val,color]) => (
              <div key={label} style={{ background:'var(--surface)', borderRadius:10, padding:'14px 18px', border:`1px solid ${color}33` }}>
                <div style={{ fontSize:11, color:'var(--muted)', textTransform:'uppercase', marginBottom:6 }}>{label}</div>
                <div style={{ fontSize:22, fontWeight:700, color }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Grouped tables */}
          {Object.keys(grouped).length === 0 ? (
            <div style={{ textAlign:'center', padding:40, color:'var(--border)' }}>
              {loading ? 'Loading…' : 'No stock movements recorded yet. Movements will appear here after GRN approvals, yarn issues, dispatches etc.'}
            </div>
          ) : Object.entries(grouped).map(([wh, rows]) => {
            const whIn  = rows.reduce((a,r) => a + parseFloat(r.total_in||0), 0);
            const whOut = rows.reduce((a,r) => a + parseFloat(r.total_out||0), 0);
            const whBal = rows.reduce((a,r) => a + parseFloat(r.balance||0), 0);
            return (
              <div key={wh} style={{ marginBottom:28 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <h4 style={{ margin:0, fontSize:14, color:'var(--muted)', textTransform:'uppercase', letterSpacing:0.5 }}>
                    🏭 {wh}
                  </h4>
                  <span style={{ fontSize:12, color:'var(--muted)' }}>
                    In: <b style={{color:'var(--green)'}}>{whIn.toFixed(1)}kg</b> ·
                    Out: <b style={{color:'var(--crit)'}}>{whOut.toFixed(1)}kg</b> ·
                    Balance: <b style={{color:'var(--link)'}}>{whBal.toFixed(1)}kg</b>
                  </span>
                </div>
                <div style={{ overflowX:'auto', background:'var(--surface)', borderRadius:10, border:'1px solid var(--surface-2)' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr style={{ background:'var(--surface)' }}>
                        {['Item','Category','Total In','Total Out','Balance','UOM','Last Txn','Value (₹)'].map(h => (
                          <th key={h} style={s.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r,i) => {
                        const bal = parseFloat(r.balance || 0);
                        const balColor = bal > 0 ? 'var(--green)' : bal < 0 ? 'var(--crit)' : 'var(--muted)';
                        return (
                          <tr key={i}>
                            <td style={s.td}>
                              {r.item_code && r.item_code !== '—'
                                ? <><span style={{fontFamily:'monospace',fontSize:11,color:'var(--link)'}}>{r.item_code}</span><br/></>
                                : null}
                              <span style={{fontSize:13}}>{r.item_name}</span>
                            </td>
                            <td style={s.td}><span style={{fontSize:11,color:'var(--muted)'}}>{r.category || '—'}</span></td>
                            <td style={{...s.td, color:'var(--green)', fontWeight:600}}>{parseFloat(r.total_in||0).toFixed(2)}</td>
                            <td style={{...s.td, color:'var(--crit)', fontWeight:600}}>{parseFloat(r.total_out||0).toFixed(2)}</td>
                            <td style={{...s.td, color:balColor, fontWeight:700, fontSize:14}}>{bal.toFixed(2)}</td>
                            <td style={s.td}>{r.uom_code}</td>
                            <td style={{...s.td, fontSize:11, color:'var(--muted)'}}>{r.last_txn_date?.slice(0,10) || '—'}</td>
                            <td style={s.td}>{r.balance_value ? '₹' + parseFloat(r.balance_value).toLocaleString(undefined,{maximumFractionDigits:0}) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TRANSACTION LEDGER TAB ── */}
      {tab === 'ledger' && (
        <div>
          {/* Filters */}
          <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap', alignItems:'flex-end' }}>
            <label style={s.label}>From Date
              <input type="date" value={lgFilters.from_date}
                onChange={e => setLgFilters(f => ({...f, from_date: e.target.value, page:1}))}
                style={s.input} />
            </label>
            <label style={s.label}>To Date
              <input type="date" value={lgFilters.to_date}
                onChange={e => setLgFilters(f => ({...f, to_date: e.target.value, page:1}))}
                style={s.input} />
            </label>
            <label style={s.label}>Doc Type
              <select value={lgFilters.doc_type}
                onChange={e => setLgFilters(f => ({...f, doc_type: e.target.value, page:1}))}
                style={s.select}>
                <option value="">All Types</option>
                {DOC_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label style={s.label}>Warehouse
              <select value={lgFilters.warehouse_id}
                onChange={e => setLgFilters(f => ({...f, warehouse_id: e.target.value, page:1}))}
                style={s.select}>
                <option value="">All Warehouses</option>
                {warehouses.map(w => <option key={w.warehouse_id} value={w.warehouse_id}>{w.name}</option>)}
              </select>
            </label>
            <button onClick={loadLedger} disabled={loading} style={s.btnPrimary}>
              {loading ? 'Loading…' : 'Search'}
            </button>
          </div>

          <div style={{ marginBottom:8, fontSize:12, color:'var(--muted)' }}>{ledgerTotal} transactions</div>

          <div style={{ overflowX:'auto', background:'var(--surface)', borderRadius:10, border:'1px solid var(--surface-2)' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'var(--surface)' }}>
                  {['Date','Type','Doc ID','Item','Warehouse','In/Out','Qty','UOM','Cost (₹)','Notes'].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.length === 0 ? (
                  <tr><td colSpan={10} style={{textAlign:'center',padding:40,color:'var(--border)'}}>
                    {loading ? 'Loading…' : 'No transactions found. Click Search to load.'}
                  </td></tr>
                ) : ledger.map(row => (
                  <tr key={row.ledger_id}>
                    <td style={{...s.td, fontSize:11, color:'var(--muted)', whiteSpace:'nowrap'}}>{row.txn_date?.slice(0,10)}</td>
                    <td style={s.td}>
                      <span style={{ fontFamily:'monospace', fontSize:11, background:'var(--surface)', border:'1px solid var(--surface-2)', padding:'1px 6px', borderRadius:4 }}>
                        {row.doc_type}
                      </span>
                    </td>
                    <td style={{...s.td, fontFamily:'monospace', fontSize:11, color:'var(--link)'}}>{row.doc_id}</td>
                    <td style={s.td}>
                      {row.item_code && row.item_code !== '—'
                        ? <span style={{color:'var(--muted)',fontSize:11}}>{row.item_code} · </span>
                        : null}
                      {row.item_name || row.item_desc || '—'}
                    </td>
                    <td style={{...s.td, fontSize:11}}>{row.warehouse_name || '—'}</td>
                    <td style={s.td}>
                      <span style={{
                        color: MOVEMENT_COLORS[row.movement_type] || 'var(--muted)',
                        fontWeight:700, fontSize:12,
                      }}>{row.movement_type === 'IN' ? '▲ IN' : row.movement_type === 'OUT' ? '▼ OUT' : '↔ TRF'}</span>
                    </td>
                    <td style={{...s.td, fontWeight:600, color: row.movement_type==='IN'?'var(--green)':row.movement_type==='OUT'?'var(--crit)':'var(--gold-2)'}}>
                      {parseFloat(row.quantity).toFixed(3)}
                    </td>
                    <td style={{...s.td,fontSize:11}}>{row.uom_code}</td>
                    <td style={s.td}>{row.total_cost ? '₹' + parseFloat(row.total_cost).toLocaleString(undefined,{maximumFractionDigits:0}) : '—'}</td>
                    <td style={{...s.td, fontSize:11, color:'var(--muted)', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {ledgerTotal > 100 && (
            <div style={{ display:'flex', gap:8, marginTop:12, justifyContent:'center' }}>
              <button disabled={lgFilters.page <= 1}
                onClick={() => setLgFilters(f => ({...f, page: f.page - 1}))} style={s.btnSm}>Prev</button>
              <span style={{ padding:'4px 12px', color:'var(--muted)', fontSize:13 }}>
                Page {lgFilters.page} of {Math.ceil(ledgerTotal/100)}
              </span>
              <button disabled={lgFilters.page >= Math.ceil(ledgerTotal/100)}
                onClick={() => setLgFilters(f => ({...f, page: f.page + 1}))} style={s.btnSm}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const s = {
  btnPrimary: { background:'var(--link)', color:'var(--text)', border:'none', padding:'7px 16px', borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnSm:      { background:'var(--border)', color:'var(--link)', border:'none', padding:'4px 10px', borderRadius:5, cursor:'pointer', fontSize:12 },
  input:      { width:'100%', background:'var(--surface)', border:'1px solid var(--surface-2)', color:'var(--text)', borderRadius:6, padding:'7px 10px', fontSize:13, boxSizing:'border-box', marginTop:4 },
  select:     { width:'100%', background:'var(--surface)', border:'1px solid var(--surface-2)', color:'var(--text)', borderRadius:6, padding:'7px 10px', fontSize:13, boxSizing:'border-box', marginTop:4 },
  label:      { display:'flex', flexDirection:'column', fontSize:12, color:'var(--muted)', fontWeight:500 },
  th:         { padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--muted)', textTransform:'uppercase', letterSpacing:0.5, borderBottom:'1px solid var(--surface-2)', whiteSpace:'nowrap' },
  td:         { padding:'9px 14px', fontSize:13, borderBottom:'1px solid var(--surface)', verticalAlign:'middle' },
};
