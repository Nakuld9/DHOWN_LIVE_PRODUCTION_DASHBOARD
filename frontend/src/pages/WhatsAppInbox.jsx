// WhatsApp AI CRM inbox — 3 panes: conversations | chat | Customer 360 + AI copilot.
// Realtime via the existing Socket.IO connection. See docs/WHATSAPP_CRM_DESIGN.md.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const API = process.env.REACT_APP_API_URL || '';
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function WhatsAppInbox() {
  const headers = { Authorization: `Bearer ${localStorage.getItem('dhown_token')}` };
  const [convs, setConvs]       = useState([]);
  const [active, setActive]     = useState(null);
  const [msgs, setMsgs]         = useState([]);
  const [cust, setCust]         = useState(null);
  const [text, setText]         = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [aiInfo, setAiInfo]     = useState(null);
  const [search, setSearch]     = useState('');
  const [tab, setTab]           = useState('OVERVIEW');
  const [cards, setCards]       = useState([]);
  const [showCards, setShowCards] = useState(false);
  const [quotes, setQuotes]     = useState([]);
  const [drafts, setDrafts]     = useState([]);
  const [rateEdit, setRateEdit] = useState({});
  const [prod, setProd]         = useState(null);
  const [copilot, setCopilot]   = useState(null);
  const [inv, setInv]           = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [win, setWin]           = useState(null);
  const [defMode, setDefMode]   = useState('SUGGEST');
  const endRef = useRef(null);

  useEffect(() => {
    const h = { Authorization: `Bearer ${localStorage.getItem('dhown_token')}` };
    axios.get(`${API}/api/wa/settings/default-mode`, { headers: h }).then(r => setDefMode(r.data.mode)).catch(() => {});
  }, []);
  const saveDefMode = async (mode) => {
    setDefMode(mode);
    try { await axios.put(`${API}/api/wa/settings/default-mode`, { mode }, { headers }); } catch {}
  };

  const loadConvs = useCallback(async () => {
    try { setConvs((await axios.get(`${API}/api/wa/conversations`, { headers })).data); } catch {}
  }, []);

  // Quotations & draft orders (§8, §9). Every commercial action is a human click.
  const loadCommercial = useCallback(async (convId) => {
    if (!convId) return;
    try {
      const [q, d] = await Promise.all([
        axios.get(`${API}/api/wa/quotes?conversation_id=${convId}`, { headers }),
        axios.get(`${API}/api/wa/draft-orders`, { headers }),
      ]);
      setQuotes(q.data);
      axios.get(`${API}/api/wa/conversations/${convId}/production`, { headers }).then(r => setProd(r.data)).catch(() => setProd(null));
      axios.get(`${API}/api/wa/conversations/${convId}/copilot`, { headers }).then(r => setCopilot(r.data)).catch(() => setCopilot(null));
      axios.get(`${API}/api/wa/inventory`, { headers }).then(r => setInv(r.data)).catch(() => setInv(null));
      axios.get(`${API}/api/wa/conversations/${convId}/window`, { headers }).then(r => setWin(r.data)).catch(() => setWin(null));
      setDrafts(d.data.filter(x => String(x.conversation_id) === String(convId)));
    } catch {}
  }, []);

  const openConv = useCallback(async (c) => {
    setActive(c); setAiInfo(null); setTab('OVERVIEW');
    try {
      const [m, cu] = await Promise.all([
        axios.get(`${API}/api/wa/conversations/${c.conversation_id}/messages`, { headers }),
        axios.get(`${API}/api/wa/conversations/${c.conversation_id}/customer`, { headers }),
      ]);
      setMsgs(m.data); setCust(cu.data);
      loadCommercial(c.conversation_id);
      await axios.post(`${API}/api/wa/conversations/${c.conversation_id}/read`, {}, { headers });
      loadConvs();
    } catch {}
  }, [loadConvs, loadCommercial]);

  useEffect(() => { loadConvs(); }, [loadConvs]);

  useEffect(() => {
    axios.get(`${API}/api/wa/shade-cards`, { headers }).then(r => setCards(r.data)).catch(() => {});
    axios.get(`${API}/api/wa/assignees`, { headers }).then(r => setAssignees(r.data)).catch(() => {});
  }, []);

  // Realtime inbound messages
  useEffect(() => {
    const socket = io(window.location.origin, { transports: ['websocket'] });
    socket.on('wa_message', (p) => {
      loadConvs();
      setActive(a => {
        if (a && String(a.conversation_id) === String(p.conversation_id)) {
          setMsgs(m => (m.some(x => x.message_id === p.message.message_id) ? m : [...m, p.message]));
        }
        return a;
      });
    });
    socket.on('wa_status', (p) => {
      setMsgs(m => m.map(x => (x.message_id === p.message_id
        ? { ...x, status: p.status, error_code: p.error_code, error_title: p.error_title } : x)));
    });
    return () => socket.disconnect();
  }, [loadConvs]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const send = async () => {
    if (!text.trim() || !active) return;
    const body = text; setText('');
    try {
      const r = await axios.post(`${API}/api/wa/conversations/${active.conversation_id}/send`,
        { text: body, ai_generated: !!aiInfo }, { headers });
      setMsgs(m => [...m, r.data]); setAiInfo(null); loadConvs();
    } catch (e) {
      if (e.response?.data?.window_closed) setWin({ open: false });
      alert(e.response?.data?.error || 'Send failed'); setText(body);
    }
  };

  const suggest = async () => {
    if (!active) return;
    setSuggesting(true);
    try {
      const r = await axios.post(`${API}/api/wa/conversations/${active.conversation_id}/suggest`, {}, { headers });
      setText(r.data.reply || ''); setAiInfo(r.data);
    } catch (e) { alert(e.response?.data?.error || 'AI unavailable'); }
    finally { setSuggesting(false); }
  };

  const sendCard = async (card) => {
    if (!active) return;
    setShowCards(false);
    try {
      const r = await axios.post(`${API}/api/wa/conversations/${active.conversation_id}/send-card`,
        { card_id: card.card_id }, { headers });
      setMsgs(m => [...m, r.data]); loadConvs();
    } catch (e) { alert(e.response?.data?.error || 'Could not send shade card'); }
  };

  const actQuote = async (q, action) => {
    try {
      await axios.post(`${API}/api/wa/quotes/${q.quote_id}/act`,
        { action, rate: rateEdit[q.quote_id] || undefined }, { headers });
      setRateEdit(s => ({ ...s, [q.quote_id]: '' }));
      loadCommercial(active.conversation_id);
    } catch (e) { alert(e.response?.data?.error || 'Action failed'); }
  };

  const sendQuote = async (q) => {
    if (!window.confirm(`Send quotation ${q.quote_no} to the customer on WhatsApp?`)) return;
    try {
      const r = await axios.post(`${API}/api/wa/quotes/${q.quote_id}/send`, {}, { headers });
      if (r.data.message) setMsgs(m => [...m, r.data.message]);
      loadCommercial(active.conversation_id); loadConvs();
    } catch (e) { alert(e.response?.data?.error || 'Send failed'); }
  };

  const makeDraftOrder = async (q) => {
    try {
      await axios.post(`${API}/api/wa/draft-orders`,
        { quote_id: q.quote_id, conversation_id: active.conversation_id }, { headers });
      loadCommercial(active.conversation_id);
    } catch (e) { alert(e.response?.data?.error || 'Could not create draft order'); }
  };

  const confirmDraft = async (d) => {
    if (!window.confirm('Confirm this draft as a real Sales Order? The customer will be sent the order number.')) return;
    try {
      const r = await axios.post(`${API}/api/wa/draft-orders/${d.draft_id}/confirm`, {}, { headers });
      alert(`Sales Order created: ${r.data.so_number}`);
      loadCommercial(active.conversation_id);
      openConv(active);
    } catch (e) { alert(e.response?.data?.error || 'Confirm failed'); }
  };

  const rejectDraft = async (d) => {
    try {
      await axios.post(`${API}/api/wa/draft-orders/${d.draft_id}/reject`, {}, { headers });
      loadCommercial(active.conversation_id);
    } catch (e) { alert(e.response?.data?.error || 'Reject failed'); }
  };

  // §15 recommended actions — each maps to an existing, audited endpoint.
  const runAction = async (key) => {
    if (!active) return;
    const id = active.conversation_id;
    try {
      if (key === 'CHECK_STOCK' || key === 'CHECK_OUTSTANDING' || key === 'CHECK_PRODUCTION') {
        setTab(key === 'CHECK_PRODUCTION' ? 'PRODUCTION' : key === 'CHECK_OUTSTANDING' ? 'PAYMENTS' : 'INVENTORY');
      } else if (key === 'SEND_SHADE_CARD') {
        setShowCards(true);
      } else if (key === 'PREPARE_QUOTE') {
        const product = window.prompt('Product for the quote?', copilot?.stock?.[0]?.fabric_type || '');
        if (!product) return;
        const qty = window.prompt('Quantity in kg?', copilot?.asked_qty_kg || '');
        if (!qty) return;
        await axios.post(`${API}/api/wa/quotes`, {
          conversation_id: id, product, shade: copilot?.stock?.[0]?.color_name || null, quantity_kg: Number(qty),
        }, { headers });
        setTab('QUOTES'); loadCommercial(id);
      } else if (key === 'CREATE_DRAFT_ORDER') {
        const q = quotes.find(x => x.status === 'APPROVED');
        if (!q) return alert('No approved quote to convert.');
        await axios.post(`${API}/api/wa/draft-orders`, { quote_id: q.quote_id, conversation_id: id }, { headers });
        setTab('QUOTES'); loadCommercial(id);
      } else if (key === 'CREATE_FOLLOWUP') {
        const note = window.prompt('Follow-up note?', 'Follow up on this enquiry');
        if (!note) return;
        await axios.post(`${API}/api/wa/followups`, { conversation_id: id, note }, { headers });
        alert('Follow-up created.');
      }
    } catch (e) { alert(e.response?.data?.error || 'Action failed'); }
  };

  // §1/§5 — route a conversation to a salesperson (admins/supervisors until
  // dedicated sales users exist; the endpoint picks those up automatically).
  const assignTo = async (username) => {
    if (!active) return;
    try {
      await axios.put(`${API}/api/wa/conversations/${active.conversation_id}/assign`,
        { assigned_to: username || null }, { headers });
      setActive(a => ({ ...a, assigned_to: username || null }));
      setCust(c => (c ? { ...c, salesperson: username || null } : c));
      loadConvs();
    } catch (e) { alert(e.response?.data?.error || 'Could not assign'); }
  };

  const setMode = async (mode) => {
    if (!active) return;
    try {
      await axios.put(`${API}/api/wa/conversations/${active.conversation_id}/mode`, { mode }, { headers });
      setActive(a => ({ ...a, ai_mode: mode })); loadConvs();
    } catch (e) { alert(e.response?.data?.error || 'Only supervisors can change AI mode'); }
  };

  const inviteOffers = async () => {
    if (!active) return;
    if (!window.confirm('Send a WhatsApp opt-in invite asking this customer to reply and subscribe to offers?')) return;
    try {
      const r = await axios.post(`${API}/api/wa/conversations/${active.conversation_id}/invite-offers`, {}, { headers });
      if (r.data.message) setMsgs(m => [...m, r.data.message]);
      const mm = await axios.get(`${API}/api/wa/conversations/${active.conversation_id}/messages`, { headers });
      setMsgs(mm.data);
      alert(`Invite sent. When they reply "${r.data.keyword}", they are opted in to marketing.`);
    } catch (e) { alert(e.response?.data?.error || 'Could not send invite'); }
  };

  const shown = convs.filter(c => {
    const q = search.toLowerCase();
    return !q || (c.display_name || '').toLowerCase().includes(q)
      || (c.company_name || '').toLowerCase().includes(q)
      || (c.phone || '').includes(q) || (c.last_message || '').toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 340px', gap: 12, height: 'calc(100vh - 130px)' }}>

      {/* ── LEFT: conversations ── */}
      <div style={S.pane}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 8px', fontSize: 11, color: 'var(--muted)' }}>
          <span title="AI mode applied to NEW conversations. Existing chats keep their own mode. Risky/low-confidence replies still wait for a person.">🤖 New chats:</span>
          <select value={defMode} onChange={e => saveDefMode(e.target.value)} style={{ background: 'var(--surface)', color: defMode === 'AUTO' ? 'var(--green)' : 'var(--text)', border: '1px solid var(--surface-2)', borderRadius: 6, padding: '3px 6px', fontSize: 11, fontWeight: 700 }}>
            <option value="AUTO">AUTO (bot replies)</option>
            <option value="SUGGEST">SUGGEST (draft only)</option>
            <option value="OFF">OFF</option>
          </select>
        </div>
        <input placeholder="Search chats…" value={search} onChange={e => setSearch(e.target.value)} style={S.search} />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {shown.length === 0 && <div style={S.empty}>No conversations yet. They appear when a customer messages the business number.</div>}
          {shown.map(c => (
            <div key={c.conversation_id} onClick={() => openConv(c)} style={{
              ...S.convRow,
              background: active?.conversation_id === c.conversation_id ? 'var(--surface)' : 'transparent',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ color: 'var(--text)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {c.channel === 'WEB' && <span style={{ background: 'var(--gold)', color: 'var(--on-gold)', fontSize: 9, fontWeight: 800, borderRadius: 4, padding: '1px 4px', letterSpacing: '.05em' }}>WEB</span>}
                  {c.company_name || c.display_name || (c.channel === 'WEB' ? 'Web visitor' : c.phone)}
                </strong>
                {Number(c.unread_count) > 0 && <span style={S.badge}>{c.unread_count}</span>}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>{c.channel === 'WEB' ? 'Website chat' : c.phone}</div>
              <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.last_message}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                {!c.partner_id && <span style={S.tagLead}>LEAD</span>}
                {Number(c.open_orders) > 0 && <span style={S.tag}>{c.open_orders} open</span>}
                {Number(c.outstanding) > 0 && <span style={S.tagWarn}>{money(c.outstanding)} due</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CENTER: chat ── */}
      <div style={S.pane}>
        {!active ? <div style={S.empty}>Select a conversation</div> : (
          <>
            <div style={S.chatHead}>
              <div>
                <strong style={{ color: 'var(--text)' }}>{active.company_name || active.display_name || active.phone}</strong>
                <div style={{ color: 'var(--muted)', fontSize: 11 }}>{active.phone}</div>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <select value={active.assigned_to || ''} onChange={e => assignTo(e.target.value)}
                  title="Assigned salesperson" style={S.assign}>
                  <option value="">Unassigned</option>
                  {assignees.map(u => (
                    <option key={u.username} value={u.username}>{u.full_name || u.username}</option>
                  ))}
                </select>
                {['OFF', 'SUGGEST', 'AUTO'].map(m => (
                  <button key={m} onClick={() => setMode(m)} style={{
                    ...S.modeBtn,
                    background: active.ai_mode === m ? 'var(--link)' : 'var(--surface)',
                    color: active.ai_mode === m ? '#fff' : 'var(--muted)',
                  }}>AI {m}</button>
                ))}
                <button onClick={inviteOffers} title="Send an opt-in invite so this customer can subscribe to marketing offers" style={{ ...S.modeBtn, background: 'var(--crit-dim)', color: 'var(--gold-2)' }}>📣 Invite offers</button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {msgs.map(m => (
                <div key={m.message_id} style={{
                  alignSelf: m.direction === 'IN' ? 'flex-start' : 'flex-end',
                  background: m.direction === 'IN' ? 'var(--surface)' : (m.ai_generated ? 'var(--border)' : 'var(--green-dim)'),
                  color: 'var(--text)', padding: '7px 11px', borderRadius: 10, maxWidth: '72%', fontSize: 13,
                }}>
                  {m.local_file ? <Attachment msg={m} /> :
                    m.msg_type === 'unsupported' ? <div style={{ fontSize: 11, color: 'var(--gold-2)' }}>⚠ Unsupported message — WhatsApp couldn't deliver its content (e.g. a poll, view-once photo or forwarded status). Ask the customer to resend as text or a photo.</div> :
                    m.msg_type !== 'text' ? <div style={{ fontSize: 10, color: 'var(--link)' }}>[{m.msg_type}]</div> : null}
                  {m.msg_type !== 'unsupported' && (m.body || m.caption)}
                  {m.direction === 'OUT' && <DeliveryState m={m} />}
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3, textAlign: 'right' }}>
                    {m.ai_generated ? 'AI · ' : (m.sent_by ? `${m.sent_by} · ` : '')}
                    {new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            {aiInfo && (
              <div style={S.aiNote}>
                AI draft · intent <strong>{aiInfo.intent}</strong> · sources: {(aiInfo.tools || []).map(t => t.tool).join(', ')} — review before sending.
              </div>
            )}
            {copilot && (
              <div style={S.copilot}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 10, color: 'var(--link)', letterSpacing: 1 }}>AI SUMMARY</strong>
                  <button onClick={() => setCopilot(null)} style={S.x}>✕</button>
                </div>
                {copilot.summary.map((l, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>• {l}</div>
                ))}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                  {copilot.actions.map(a => (
                    <button key={a.key} onClick={() => runAction(a.key)} style={S.actBtn}>{a.label}</button>
                  ))}
                </div>
              </div>
            )}
            {showCards && (
              <div style={S.cardTray}>
                {cards.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 11 }}>No shade cards yet — add them in the library.</span>}
                {cards.map(c => (
                  <button key={c.card_id} onClick={() => sendCard(c)} style={S.cardChip} title={c.shades || ''}>
                    🎨 {c.product}{c.gsm ? ` · ${c.gsm}` : ''}
                  </button>
                ))}
              </div>
            )}
            {win && !win.open && (
              <div style={S.winClosed}>
                ⏳ The 24-hour reply window is closed. WhatsApp only allows an approved template now —
                free-form replies will not reach the customer.
              </div>
            )}
            {win && win.open && win.minutesLeft < 180 && (
              <div style={S.winWarn}>⏳ Reply window closes in {Math.floor(win.minutesLeft / 60)}h {win.minutesLeft % 60}m</div>
            )}
            <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--surface)' }}>
              <button onClick={suggest} disabled={suggesting} style={S.aiBtn}>
                {suggesting ? '…' : '✨ AI'}
              </button>
              <button onClick={() => setShowCards(s => !s)} style={S.cardBtn} title="Send shade card">🎨</button>
              <input value={text} disabled={!!(win && !win.open)} onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()}
                placeholder="Type a message…" style={S.input} />
              <button onClick={send} style={S.sendBtn}>Send</button>
            </div>
          </>
        )}
      </div>

      {/* ── RIGHT: Customer 360 ── */}
      <div style={S.pane}>
        {!cust ? <div style={S.empty}>Customer details</div> : (
          <div style={{ overflowY: 'auto', padding: 12 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
              {['OVERVIEW', 'ORDERS', 'QUOTES', 'INVENTORY', 'PRODUCTION', 'PAYMENTS', 'DOCUMENTS', 'AI'].map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  ...S.tabBtn, background: tab === t ? 'var(--link)' : 'var(--surface)', color: tab === t ? '#fff' : 'var(--muted)',
                }}>{t}</button>
              ))}
            </div>

            {!cust.known ? (
              <>
                <div style={S.leadBox}>NEW LEAD — not in customer master</div>
                <Row k="Phone" v={cust.phone} />
                <Row k="Name" v={cust.lead?.name} />
                <Row k="Company" v={cust.lead?.company} />
                <Row k="Score" v={cust.lead?.score} />
                <Row k="Status" v={cust.lead?.status} />
              </>
            ) : tab === 'OVERVIEW' ? (
              <>
                <Row k="Company" v={cust.partner?.company_name} />
                <Row k="Code" v={cust.partner?.partner_code} />
                <Row k="City" v={cust.location?.city} />
                <Row k="Salesperson" v={cust.salesperson || 'unassigned'} />
                <Row k="Category" v={cust.customer_category || '—'} />
                <Row k="Payment terms" v={cust.partner?.payment_terms ? `${cust.partner.payment_terms} days` : '—'} />
                <div style={S.sub}>FINANCE</div>
                <Row k="Credit limit" v={money(cust.partner?.credit_limit)} />
                <Row k="Outstanding" v={money(cust.finance?.outstanding)} warn={Number(cust.finance?.outstanding) > 0} />
                <Row k="Overdue" v={money(cust.finance?.overdue)} warn={Number(cust.finance?.overdue) > 0} />
                <Row k="Total sales" v={money(cust.finance?.total_sales)} />
                <Row k="Avg monthly" v={money(cust.finance?.avg_monthly_sales)} />
                <Row k="Last payment" v={cust.finance?.last_payment
                  ? new Date(cust.finance.last_payment).toLocaleDateString('en-GB').split('/').join('-') : '—'} />
                <div style={S.sub}>FREQUENTLY BOUGHT</div>
                {(cust.frequently_bought || []).length === 0
                  ? <div style={{ fontSize: 11, color: 'var(--border)' }}>No purchase history</div>
                  : cust.frequently_bought.map((f, i) => (
                    <Row key={i} k={f.item} v={`${Math.round(f.qty)} kg`} />
                  ))}
                {(cust.preferred_shades || []).length > 0 && (
                  <>
                    <div style={S.sub}>PREFERRED SHADES</div>
                    {cust.preferred_shades.map((s2, i) => (
                      <Row key={i} k={s2.shade} v={`${Math.round(s2.kg)} kg`} />
                    ))}
                  </>
                )}
                {Number(cust.complaints?.count) > 0 && (
                  <>
                    <div style={S.sub}>COMPLAINTS</div>
                    <Row k="Raised on WhatsApp" v={cust.complaints.count} warn />
                  </>
                )}
              </>
            ) : tab === 'PRODUCTION' ? (
              !prod?.production?.found ? <div style={S.empty}>{prod?.production?.note || 'No order to track'}</div> : (
                <>
                  <Row k="Order" v={prod.production.order_no} />
                  <Row k="Current stage" v={prod.production.current_stage} />
                  {/* Stage rail — where the job physically is */}
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', margin: '8px 0' }}>
                    {prod.production.stages.map(st => (
                      <span key={st} style={{
                        fontSize: 9, padding: '2px 6px', borderRadius: 4,
                        background: st === prod.production.current_stage ? 'var(--link)' : 'var(--surface)',
                        color: st === prod.production.current_stage ? '#fff' : 'var(--muted)',
                      }}>{st}</span>
                    ))}
                  </div>
                  <Row k="Target" v={prod.production.target_kg ? `${prod.production.target_kg} kg` : '—'} />
                  <Row k="Completed" v={prod.production.completed_kg ? `${prod.production.completed_kg} kg` : '—'} />
                  <Row k="Pending" v={prod.production.pending_kg != null ? `${prod.production.pending_kg} kg` : '—'} />
                  <Row k="Est. completion" v={prod.production.estimated_completion || 'not committed'}
                    warn={!prod.production.estimated_completion} />
                  {prod.production.eta_source && (
                    <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>source: {prod.production.eta_source}</div>
                  )}
                  {prod.production.at_vendor?.length > 0 && (
                    <>
                      <div style={S.sub}>AT VENDOR</div>
                      {prod.production.at_vendor.map((v, i) => (
                        <div key={i} style={S.card}>
                          <div style={{ fontSize: 11, color: 'var(--text)' }}>{v.job} — {v.vendor}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                            {v.weight_kg} kg · sent {v.sent} · back {v.expected_back || '—'}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  <div style={S.sub}>DISPATCHES</div>
                  {(prod.dispatch?.dispatches || []).length === 0 ? <div style={S.empty}>None yet</div> :
                    prod.dispatch.dispatches.map(d => (
                      <div key={d.dispatch_no} style={S.card}>
                        <strong style={{ color: 'var(--link)', fontSize: 11 }}>{d.dispatch_no}</strong>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                          {d.date} · {d.status} · {d.weight_kg} kg{d.vehicle ? ` · ${d.vehicle}` : ''}
                        </div>
                      </div>
                    ))}
                </>
              )
            ) : tab === 'INVENTORY' ? (
              !inv ? <div style={S.empty}>Loading stock…</div> : (
                <>
                  <div style={S.sub}>FINISHED GOODS</div>
                  <Row k="Physical"  v={`${inv.finished_goods.physical_kg} kg`} />
                  <Row k="Reserved"  v={`${inv.finished_goods.reserved_kg} kg`} />
                  <Row k="Available" v={`${inv.finished_goods.available_kg} kg`} />
                  <div style={S.sub}>NOT SELLABLE TODAY</div>
                  <Row k="Greige" v={`${inv.greige_kg} kg (${inv.greige_rolls} rolls)`} />
                  <Row k="WIP at vendor" v={`${inv.wip_at_vendor_kg} kg (${inv.wip_challans} challans)`} />
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 6 }}>{inv.note}</div>
                </>
              )
            ) : tab === 'DOCUMENTS' ? (
              <>
                {msgs.filter(m => m.local_file).length === 0
                  ? <div style={S.empty}>No documents exchanged yet</div>
                  : msgs.filter(m => m.local_file).slice().reverse().map(m => (
                    <div key={m.message_id} style={S.card}>
                      <div style={{ fontSize: 11, color: 'var(--text)' }}>
                        {m.direction === 'IN' ? '⬇ received' : '⬆ sent'} · {m.caption || m.msg_type}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')}
                      </div>
                      <div style={{ marginTop: 4 }}><Attachment msg={m} /></div>
                    </div>
                  ))}
              </>
            ) : tab === 'AI' ? (
              !copilot ? <div style={S.empty}>No AI insight yet</div> : (
                <>
                  <div style={S.sub}>WHAT THE AI SEES</div>
                  {copilot.summary.map((l, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>• {l}</div>
                  ))}
                  {copilot.last_price && (
                    <>
                      <div style={S.sub}>LAST BILLED</div>
                      <Row k={copilot.last_price.item_desc} v={`₹${copilot.last_price.rate}/kg`} />
                    </>
                  )}
                  <div style={S.sub}>SUGGESTED ACTIONS</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {copilot.actions.map(a => (
                      <button key={a.key} onClick={() => runAction(a.key)} style={S.actBtn}>{a.label}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 8 }}>
                    Every line above comes from MES data, not from the AI's own words.
                  </div>
                </>
              )
            ) : tab === 'QUOTES' ? (
              <>
                {quotes.length === 0 && <div style={S.empty}>No quotations on this chat</div>}
                {quotes.map(q => (
                  <div key={q.quote_id} style={S.card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong style={{ color: 'var(--link)' }}>{q.quote_no}</strong>
                      <span style={{ fontSize: 10, color: q.status === 'APPROVED' ? 'var(--green)' : q.status === 'SENT' ? 'var(--link)' : q.status === 'REJECTED' ? 'var(--crit)' : 'var(--gold-2)' }}>
                        {q.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {q.product}{q.shade ? ` · ${q.shade}` : ''} · {Number(q.quantity_kg)} kg
                      {q.rate ? ` @ ₹${Number(q.rate)}` : ' · rate pending'}
                    </div>
                    {Number(q.grand_total) > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text)' }}>Total {money(q.grand_total)}</div>
                    )}
                    {q.credit_flag === 'CREDIT_APPROVAL_REQUIRED' && (
                      <div style={S.warnBox}>⚠ {q.credit_note}</div>
                    )}
                    <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                      {q.status === 'PENDING_PRICE_APPROVAL' && (
                        <>
                          <input placeholder="rate ₹/kg" value={rateEdit[q.quote_id] || ''}
                            onChange={e => setRateEdit(s => ({ ...s, [q.quote_id]: e.target.value }))}
                            style={{ ...S.input, padding: '3px 6px', fontSize: 11, width: 80, flex: 'none' }} />
                          <button onClick={() => actQuote(q, 'APPROVE')} style={S.okBtn}>Approve</button>
                          <button onClick={() => actQuote(q, 'REJECT')} style={S.noBtn}>Reject</button>
                        </>
                      )}
                      {q.status === 'APPROVED' && (
                        <>
                          <button onClick={() => sendQuote(q)} style={S.okBtn}>Send to customer</button>
                          <button onClick={() => makeDraftOrder(q)} style={S.cardChip}>Draft order</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <div style={S.sub}>DRAFT ORDERS</div>
                {drafts.length === 0 && <div style={S.empty}>None pending</div>}
                {drafts.map(d => (
                  <div key={d.draft_id} style={S.card}>
                    <div style={{ fontSize: 11, color: 'var(--text)' }}>
                      {d.product}{d.shade ? ` · ${d.shade}` : ''} · {Number(d.quantity_kg)} kg
                      {d.rate ? ` @ ₹${Number(d.rate)}` : ''}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {d.status}{d.so_number ? ` → ${d.so_number}` : ''}
                    </div>
                    {d.status === 'PENDING' && (
                      <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                        <button onClick={() => confirmDraft(d)} style={S.okBtn}>Confirm → Sales Order</button>
                        <button onClick={() => rejectDraft(d)} style={S.noBtn}>Reject</button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : tab === 'ORDERS' ? (
              (cust.orders || []).length === 0 ? <div style={S.empty}>No orders</div> :
              (cust.orders || []).map(o => (
                <div key={o.so_number} style={S.card}>
                  <strong style={{ color: 'var(--link)' }}>{o.so_number}</strong>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {new Date(o.order_date).toLocaleDateString('en-GB').split('/').join('-')} · {o.status} · {money(o.total_amount)}
                  </div>
                </div>
              ))
            ) : (
              <>
                <Row k="Outstanding" v={money(cust.finance?.outstanding)} warn={Number(cust.finance?.outstanding) > 0} />
                <Row k="Total paid" v={money(cust.finance?.total_sales)} />
                <Row k="Last payment" v={cust.finance?.last_payment ? new Date(cust.finance.last_payment).toLocaleDateString('en-GB').split('/').join('-') : '—'} />
                <div style={S.warnBox}>Internal only — never quote balances to the customer without approval.</div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Delivery state from Meta's status callbacks. "sent" only means Meta accepted
// it — delivered/read are the real signals, and failed must be impossible to miss.
function DeliveryState({ m }) {
  const st = m.status || 'sent';
  if (st === 'failed') {
    return (
      <div style={{ fontSize: 10, color: 'var(--crit-edge)', marginTop: 3 }}>
        ✕ Not delivered{m.error_title ? ` — ${m.error_title}` : ''}
      </div>
    );
  }
  const tick = st === 'read' ? '✓✓' : st === 'delivered' ? '✓✓' : '✓';
  const col  = st === 'read' ? 'var(--link)' : 'var(--muted)';
  return <div style={{ fontSize: 10, color: col, marginTop: 3, textAlign: 'right' }}>{tick}</div>;
}

// Attachments are JWT-gated, so fetch them as a blob with the auth header
// rather than putting the token in an <img src> URL.
function Attachment({ msg }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let revoked = null;
    axios.get(`${API}/api/wa/media/${msg.message_id}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('dhown_token')}` },
      responseType: 'blob',
    }).then(r => { revoked = URL.createObjectURL(r.data); setUrl(revoked); }).catch(() => {});
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [msg.message_id]);

  if (!url) return <div style={{ fontSize: 10, color: 'var(--muted)' }}>loading attachment…</div>;
  return (msg.media_mime || '').startsWith('image/')
    ? <img src={url} alt={msg.caption || 'attachment'} style={{ maxWidth: 240, borderRadius: 6, display: 'block', marginBottom: 4 }} />
    : <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--link)', fontSize: 12 }}>📎 Open attachment</a>;
}

const Row = ({ k, v, warn }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--surface)', fontSize: 12 }}>
    <span style={{ color: 'var(--muted)' }}>{k}</span>
    <span style={{ color: warn ? 'var(--crit)' : 'var(--text)', fontWeight: 600 }}>{v || '—'}</span>
  </div>
);

const S = {
  pane:     { background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  search:   { margin: 10, padding: '7px 10px', background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 6, color: 'var(--text)', fontSize: 12 },
  convRow:  { padding: '9px 12px', borderBottom: '1px solid var(--surface)', cursor: 'pointer' },
  badge:    { background: 'var(--green)', color: 'var(--green-dim)', borderRadius: 9, padding: '0 6px', fontSize: 10, fontWeight: 700 },
  tag:      { background: 'var(--border)', color: 'var(--link)', fontSize: 9, padding: '1px 5px', borderRadius: 3 },
  tagWarn:  { background: 'var(--crit-dim)', color: 'var(--crit-edge)', fontSize: 9, padding: '1px 5px', borderRadius: 3 },
  tagLead:  { background: 'var(--crit-dim)', color: 'var(--gold-2)', fontSize: 9, padding: '1px 5px', borderRadius: 3 },
  chatHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--surface)' },
  modeBtn:  { border: 'none', borderRadius: 5, padding: '4px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 600 },
  input:    { flex: 1, padding: '8px 11px', background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 6, color: 'var(--text)', fontSize: 13 },
  sendBtn:  { background: 'var(--green)', color: 'var(--green-dim)', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 700, cursor: 'pointer' },
  aiBtn:    { background: 'var(--link)', color: 'var(--text)', border: 'none', borderRadius: 6, padding: '8px 12px', fontWeight: 700, cursor: 'pointer' },
  okBtn:    { background: 'var(--green)', color: 'var(--green-dim)', border: 'none', borderRadius: 5, padding: '4px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
  noBtn:    { background: 'var(--crit-dim)', color: 'var(--crit-edge)', border: 'none', borderRadius: 5, padding: '4px 9px', fontSize: 11, cursor: 'pointer' },
  assign:   { background: 'var(--surface)', color: 'var(--link)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 6px', fontSize: 11, maxWidth: 130 },
  winClosed:{ background: 'var(--crit-dim)', color: 'var(--crit-edge)', fontSize: 11, padding: '8px 12px', borderTop: '1px solid var(--crit-dim)' },
  winWarn:  { background: 'var(--gold-dim)', color: 'var(--gold-2)', fontSize: 11, padding: '6px 12px', borderTop: '1px solid var(--crit-dim)' },
  copilot:  { background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '10px 12px', maxHeight: 190, overflowY: 'auto' },
  actBtn:   { background: 'var(--border)', color: 'var(--link)', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer' },
  x:        { background: 'none', border: 'none', color: 'var(--border)', cursor: 'pointer', fontSize: 11 },
  cardBtn:  { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--surface-2)', borderRadius: 6, padding: '8px 11px', cursor: 'pointer' },
  cardTray: { display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 10px', borderTop: '1px solid var(--surface)', background: 'var(--surface)' },
  cardChip: { background: 'var(--border)', color: 'var(--link)', border: 'none', borderRadius: 5, padding: '4px 9px', fontSize: 11, cursor: 'pointer' },
  aiNote:   { background: 'var(--surface)', color: 'var(--link)', fontSize: 11, padding: '6px 12px', borderTop: '1px solid var(--border)' },
  empty:    { color: 'var(--border)', fontSize: 12, padding: 20, textAlign: 'center' },
  sub:      { color: 'var(--muted)', fontSize: 10, letterSpacing: 1, margin: '12px 0 4px' },
  card:     { background: 'var(--surface)', border: '1px solid var(--surface)', borderRadius: 6, padding: 8, marginBottom: 6 },
  tabBtn:   { border: 'none', borderRadius: 5, padding: '4px 9px', fontSize: 10, cursor: 'pointer', fontWeight: 600 },
  leadBox:  { background: 'var(--crit-dim)', color: 'var(--gold-2)', fontSize: 11, padding: 7, borderRadius: 6, marginBottom: 8, textAlign: 'center' },
  warnBox:  { background: 'var(--crit-dim)', color: 'var(--crit-edge)', fontSize: 10, padding: 7, borderRadius: 6, marginTop: 10 },
};
