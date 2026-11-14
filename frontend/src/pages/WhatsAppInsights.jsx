// WhatsApp Sales Intelligence — dashboard (§17), pipeline (§13),
// opportunities (§20) and conversation search (§16).
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = process.env.REACT_APP_API_URL || '';
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function WhatsAppInsights() {
  const headers = { Authorization: `Bearer ${localStorage.getItem('dhown_token')}` };
  const [tab, setTab]   = useState('DASHBOARD');
  const [kpi, setKpi]   = useState(null);
  const [board, setBoard] = useState(null);
  const [opps, setOpps] = useState([]);
  const [follows, setFollows] = useState([]);
  const [q, setQ]       = useState('');
  const [minQty, setMinQty] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const load = useCallback(async () => {
    try {
      const [d, b, o, fu] = await Promise.all([
        axios.get(`${API}/api/wa/dashboard`, { headers }),
        axios.get(`${API}/api/wa/pipeline`, { headers }),
        axios.get(`${API}/api/wa/opportunities`, { headers }),
        axios.get(`${API}/api/wa/followups`, { headers }),
      ]);
      setKpi(d.data); setBoard(b.data); setOpps(o.data); setFollows(fu.data);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/api/wa/opportunities/scan`, {}, { headers });
      alert(`${r.data.created.length} new opportunity(ies) found.`);
      load();
    } catch (e) { alert(e.response?.data?.error || 'Scan failed'); }
    finally { setBusy(false); }
  };

  const rescore = async () => {
    setBusy(true);
    try { await axios.post(`${API}/api/wa/rescore`, {}, { headers }); load(); }
    catch (e) { alert(e.response?.data?.error || 'Rescore failed'); }
    finally { setBusy(false); }
  };

  const runSearch = async () => {
    try {
      const r = await axios.get(`${API}/api/wa/search`, {
        headers, params: { q, min_qty: minQty || undefined },
      });
      setResults(r.data);
    } catch (e) { alert(e.response?.data?.error || 'Search failed'); }
  };

  // §13 drag-and-drop. The card moves immediately and is rolled back if the
  // server rejects the stage, so the board never shows a move that didn't stick.
  const moveStage = async (stage) => {
    const c = dragging;
    setDragging(null);
    if (!c || c.pipeline_stage === stage) return;
    const prev = board;
    setBoard(b => {
      const next = { ...b, board: { ...b.board } };
      next.board[c.pipeline_stage] = (next.board[c.pipeline_stage] || [])
        .filter(x => x.conversation_id !== c.conversation_id);
      next.board[stage] = [{ ...c, pipeline_stage: stage }, ...(next.board[stage] || [])];
      return next;
    });
    try {
      await axios.put(`${API}/api/wa/conversations/${c.conversation_id}/stage`, { stage }, { headers });
    } catch (e) {
      setBoard(prev);
      alert(e.response?.data?.error || 'Could not move card');
    }
  };

  // §12 — the scanner also runs hourly on the server; this is the manual nudge.
  const scanFollowups = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/api/wa/followups/scan`, {}, { headers });
      alert(`${r.data.total} follow-up(s) raised.`);
      load();
    } catch (e) { alert(e.response?.data?.error || 'Scan failed'); }
    finally { setBusy(false); }
  };

  const doneFollow = async (fu) => {
    try { await axios.post(`${API}/api/wa/followups/${fu.followup_id}/done`, {}, { headers }); load(); }
    catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const act = async (o, action) => {
    try { await axios.post(`${API}/api/wa/opportunities/${o.opportunity_id}/${action}`, {}, { headers }); load(); }
    catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['DASHBOARD', 'PIPELINE', 'FOLLOW-UPS', 'OPPORTUNITIES', 'SEARCH'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            ...S.tab, background: tab === t ? 'var(--link)' : 'var(--surface)', color: tab === t ? '#fff' : 'var(--muted)',
          }}>{t}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={rescore} disabled={busy} style={S.btn}>Re-score leads</button>
        <button onClick={scanFollowups} disabled={busy} style={S.btn}>Scan follow-ups</button>
        <button onClick={scan} disabled={busy} style={S.btn}>Scan opportunities</button>
      </div>

      {tab === 'DASHBOARD' && (!kpi ? <div style={S.empty}>Loading…</div> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Kpi label="Enquiries today"  v={kpi.enquiries_today} />
            <Kpi label="New leads today"  v={kpi.leads_today} />
            <Kpi label="Quotes sent"      v={kpi.quotes_sent} />
            <Kpi label="Orders converted" v={kpi.orders_converted} c="var(--green)" />
            <Kpi label="Conversion %"     v={`${kpi.conversion_pct}%`} c="var(--green)" />
            <Kpi label="WhatsApp sales"   v={money(kpi.whatsapp_sales_value)} c="var(--yellow)" />
            <Kpi label="Unanswered chats" v={kpi.unanswered_chats} c={kpi.unanswered_chats > 0 ? 'var(--crit)' : 'var(--muted)'} />
            <Kpi label="Pending follow-ups" v={kpi.pending_followups} c={kpi.pending_followups > 0 ? 'var(--gold-2)' : 'var(--muted)'} />
            <Kpi label="Avg response" v={kpi.avg_response_mins != null ? `${kpi.avg_response_mins} min` : '—'} />
            <Kpi label="Lost enquiries" v={kpi.lost_enquiries} c={kpi.lost_enquiries > 0 ? 'var(--crit)' : 'var(--muted)'} />
            <Kpi label="Potential repeat" v={kpi.potential_repeat_orders} c='var(--gold-2)' />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
            <Panel title="TOP CUSTOMERS BY ACTIVITY" rows={kpi.top_customers}
              render={r => <><span>{r.company_name}</span><span>{r.msgs} msgs</span></>} />
            <Panel title="MOST REQUESTED PRODUCTS" rows={kpi.top_products}
              render={r => <><span>{r.product}</span><span>{r.n}</span></>} />
            <Panel title="MOST REQUESTED SHADES" rows={kpi.top_shades}
              render={r => <><span>{r.shade}</span><span>{r.n}</span></>} />
          </div>
        </>
      ))}

      {tab === 'PIPELINE' && (!board ? <div style={S.empty}>Loading…</div> : (
        <>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
            Drag a card to move it between stages.
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 10 }}>
            {board.stages.map(st => (
              <div key={st}
                onDragOver={e => { e.preventDefault(); setDropTarget(st); }}
                onDragLeave={() => setDropTarget(t => (t === st ? null : t))}
                onDrop={e => { e.preventDefault(); setDropTarget(null); moveStage(st); }}
                style={{
                  minWidth: 190, background: dropTarget === st ? 'var(--surface)' : 'var(--surface)',
                  border: `1px solid ${dropTarget === st ? 'var(--link)' : 'var(--surface)'}`,
                  borderRadius: 8, padding: 8, transition: 'background .12s',
                }}>
                <div style={{ fontSize: 11, color: 'var(--link)', fontWeight: 700, marginBottom: 6 }}>
                  {st} <span style={{ color: 'var(--border)' }}>({board.board[st]?.length || 0})</span>
                </div>
                {(board.board[st] || []).map(c => (
                  <div key={c.conversation_id}
                    draggable
                    onDragStart={() => setDragging(c)}
                    onDragEnd={() => { setDragging(null); setDropTarget(null); }}
                    style={{
                      ...S.pcard, cursor: 'grab',
                      opacity: dragging?.conversation_id === c.conversation_id ? 0.4 : 1,
                    }}>
                    <div style={{ fontSize: 11, color: 'var(--text)' }}>{c.company_name || c.display_name || c.phone}</div>
                    {c.score && <span style={{
                      fontSize: 9, padding: '1px 5px', borderRadius: 3,
                      background: c.score === 'HOT' ? 'var(--crit-dim)' : c.score === 'WARM' ? 'var(--crit-dim)' : 'var(--surface)',
                      color: c.score === 'HOT' ? 'var(--crit-edge)' : c.score === 'WARM' ? 'var(--gold-2)' : 'var(--muted)',
                    }}>{c.score}{c.score_points != null ? ` ${c.score_points}` : ''}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      ))}

      {tab === 'FOLLOW-UPS' && (
        follows.length === 0 ? <div style={S.empty}>Nothing pending. Auto-scan runs hourly.</div> :
        follows.map(f => (
          <div key={f.followup_id} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong style={{ color: 'var(--link)', fontSize: 13 }}>{f.company_name || f.phone || 'Lead'}</strong>
              <span style={{ fontSize: 10, color: f.kind === 'MANUAL' ? 'var(--muted)' : 'var(--gold-2)' }}>
                {f.kind.replace(/_/g, ' ')}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{f.note}</div>
            <div style={{ fontSize: 10, color: 'var(--border)', marginTop: 3 }}>
              {f.assigned_to ? `Assigned: ${f.assigned_to}` : 'Unassigned'}
              {f.due_date ? ` · due ${new Date(f.due_date).toLocaleDateString('en-GB').split('/').join('-')}` : ''}
              {f.created_by === 'AUTO' ? ' · raised automatically' : ''}
            </div>
            <div style={{ marginTop: 6 }}>
              <button onClick={() => doneFollow(f)} style={S.ok}>Mark done</button>
            </div>
          </div>
        ))
      )}

      {tab === 'OPPORTUNITIES' && (
        opps.length === 0 ? <div style={S.empty}>No open opportunities. Run a scan.</div> :
        opps.map(o => (
          <div key={o.opportunity_id} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong style={{ color: 'var(--link)', fontSize: 13 }}>{o.title}</strong>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{o.kind.replace(/_/g, ' ')}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{o.detail}</div>
            {o.value_hint && <div style={{ fontSize: 11, color: 'var(--gold)' }}>{money(o.value_hint)}</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button onClick={() => act(o, 'action')} style={S.ok}>Mark actioned</button>
              <button onClick={() => act(o, 'dismiss')} style={S.no}>Dismiss</button>
            </div>
            <div style={{ fontSize: 9, color: 'var(--border)', marginTop: 4 }}>
              Internal suggestion — nothing has been sent to the customer.
            </div>
          </div>
        ))
      )}

      {tab === 'SEARCH' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && runSearch()}
              placeholder="e.g. russian fleece, black lycra…" style={{ ...S.input, flex: 1, minWidth: 220 }} />
            <input value={minQty} onChange={e => setMinQty(e.target.value)}
              placeholder="min kg" style={{ ...S.input, width: 90 }} />
            <button onClick={runSearch} style={S.btn}>Search</button>
          </div>
          {!results ? <div style={S.empty}>Search past conversations.</div> :
            results.count === 0 ? <div style={S.empty}>No matches.</div> :
            results.results.map(r => (
              <div key={r.message_id} style={S.card}>
                <div style={{ fontSize: 11, color: 'var(--link)' }}>
                  {r.company_name || r.display_name || r.phone}
                  <span style={{ color: 'var(--border)', marginLeft: 8 }}>
                    {new Date(r.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 2 }}>{r.body}</div>
              </div>
            ))}
        </>
      )}
    </div>
  );
}

const Kpi = ({ label, v, c }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
    <div style={{ fontSize: 20, fontWeight: 700, color: c || 'var(--text)' }}>{v}</div>
    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3, textTransform: 'uppercase' }}>{label}</div>
  </div>
);

const Panel = ({ title, rows, render }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 8, padding: 12 }}>
    <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: 1, marginBottom: 8 }}>{title}</div>
    {(rows || []).length === 0 ? <div style={{ color: 'var(--border)', fontSize: 12 }}>No data yet</div> :
      rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text)', padding: '4px 0', borderBottom: '1px solid var(--surface)' }}>
          {render(r)}
        </div>
      ))}
  </div>
);

const S = {
  tab:   { border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  btn:   { background: 'var(--border)', color: 'var(--link)', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  card:  { background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 8, padding: 12, marginBottom: 8 },
  pcard: { background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 5, padding: 6, marginBottom: 5 },
  input: { padding: '7px 10px', background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 6, color: 'var(--text)', fontSize: 12 },
  ok:    { background: 'var(--green)', color: 'var(--green-dim)', border: 'none', borderRadius: 5, padding: '4px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  no:    { background: 'var(--crit-dim)', color: 'var(--crit-edge)', border: 'none', borderRadius: 5, padding: '4px 9px', fontSize: 11, cursor: 'pointer' },
  empty: { color: 'var(--border)', fontSize: 13, padding: 24, textAlign: 'center' },
};
