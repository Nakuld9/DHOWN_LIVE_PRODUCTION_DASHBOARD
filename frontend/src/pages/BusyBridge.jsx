import React, { useState, useEffect, useCallback } from "react";

/**
 * BUSY Bridge — integration status between this dashboard and BUSY accounting.
 *
 * BUSY runs on a separate PC. Nothing on this page talks to BUSY directly:
 * every call goes to this backend, which holds the BUSY credentials. Manual
 * actions need SUPERVISOR or above and the backend enforces that — the UI only
 * hides buttons the user cannot use.
 */

const BASE = "http://localhost:4000";

const ROLE_RANK = { VIEWER: 1, OPERATOR: 2, SUPERVISOR: 3, ADMIN: 4, SUPER_ADMIN: 5 };

const card = {
  background: "#071120",
  border: "1px solid #16345d",
  borderRadius: "12px",
  padding: "20px",
  marginBottom: "20px",
};

const inputStyle = {
  padding: "9px 12px",
  background: "#0d1b2f",
  color: "white",
  border: "1px solid #16345d",
  borderRadius: "6px",
  fontSize: "15px",
};

const TAB_STYLE = (active) => ({
  padding: "8px 20px",
  borderRadius: "6px",
  border: active ? "1px solid #f4ae1f" : "1px solid #16345d",
  background: active ? "#f4ae1f" : "#0d1b2f",
  color: active ? "black" : "#7da2d6",
  cursor: "pointer",
  fontWeight: active ? "bold" : "normal",
  fontSize: "15px",
});

const BTN = {
  padding: "5px 11px",
  background: "#0d1b2f",
  color: "#7da2d6",
  border: "1px solid #16345d",
  borderRadius: "5px",
  cursor: "pointer",
  fontSize: "12px",
  marginRight: "5px",
};

const STATUS_COLOR = {
  SUCCESS: "#22c55e",
  MATCH: "#22c55e",
  SYNCED: "#22c55e",
  FAILED: "#ef4444",
  MISSING_IN_BUSY: "#ef4444",
  DUPLICATE: "#ef4444",
  MANUAL_REVIEW: "#f4ae1f",
  MISMATCH: "#f4ae1f",
  RETRY: "#f4ae1f",
  MISSING_IN_MES: "#f4ae1f",
  PENDING: "#7da2d6",
  PROCESSING: "#60a5fa",
  AWAITING_BUSY: "#60a5fa",
};

function Pill({ value }) {
  if (!value) return <span style={{ color: "#4a6485" }}>—</span>;
  const color = STATUS_COLOR[value] || "#7da2d6";
  return (
    <span
      style={{
        color,
        border: `1px solid ${color}`,
        borderRadius: "999px",
        padding: "2px 9px",
        fontSize: "11px",
        fontWeight: "bold",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  );
}

function Tile({ label, value, color, sub }) {
  return (
    <div style={{ ...card, marginBottom: 0, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontSize: "11px", color: "#7da2d6", textTransform: "uppercase", letterSpacing: ".04em" }}>
        {label}
      </div>
      <div style={{ fontSize: "24px", fontWeight: 700, color: color || "white", marginTop: "4px", overflowWrap: "anywhere" }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: "12px", color: "#4a6485", marginTop: "3px", overflowWrap: "anywhere" }}>{sub}</div> : null}
    </div>
  );
}

function fmt(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

export default function BusyBridge() {
  const [tab, setTab] = useState("queue");
  const [overview, setOverview] = useState(null);
  const [queue, setQueue] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [recon, setRecon] = useState({ summary: {}, items: [] });
  const [audit, setAudit] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  const token = localStorage.getItem("dhown_token");
  let role = "VIEWER";
  try {
    role = (JSON.parse(localStorage.getItem("dhown_user") || "{}").role) || "VIEWER";
  } catch (_) {}
  const canAct = (ROLE_RANK[role] || 0) >= ROLE_RANK.SUPERVISOR;

  const api = useCallback(
    async (path, options = {}) => {
      const res = await fetch(`${BASE}/api/busy${path}`, {
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.reason || body.error || `HTTP ${res.status}`);
      return body;
    },
    [token],
  );

  const flash = (message, bad) => {
    setToast({ message, bad });
    setTimeout(() => setToast(null), 4500);
  };

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api("/overview"));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [api]);

  const loadTab = useCallback(async () => {
    try {
      if (tab === "queue") {
        const params = [];
        if (statusFilter) params.push(`status=${encodeURIComponent(statusFilter)}`);
        if (search.trim()) params.push(`search=${encodeURIComponent(search.trim())}`);
        setQueue((await api(`/queue${params.length ? `?${params.join("&")}` : ""}`)).items);
      } else if (tab === "mappings") {
        setMappings((await api(unmappedOnly ? "/mappings/unmapped" : "/mappings")).items);
      } else if (tab === "reconciliation") {
        setRecon(await api("/reconciliation?resolved=false"));
      } else if (tab === "audit") {
        setAudit((await api("/audit?limit=200")).entries);
      }
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [api, tab, statusFilter, search, unmappedOnly]);

  useEffect(() => {
    loadOverview();
    const timer = setInterval(loadOverview, 15000);
    return () => clearInterval(timer);
  }, [loadOverview]);

  useEffect(() => {
    loadTab();
  }, [loadTab]);

  const refresh = () => {
    loadOverview();
    loadTab();
  };

  const act = async (label, path, options) => {
    try {
      const result = await api(path, options);
      flash(label);
      refresh();
      return result;
    } catch (e) {
      flash(e.message, true);
      return null;
    }
  };

  const conn = (overview && overview.connection) || {};
  const q = (overview && overview.queue) || {};

  return (
    <div style={{ padding: "24px", color: "white", minHeight: "100vh", background: "#050d18" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "22px" }}>BUSY Bridge</h1>
          <div style={{ color: "#7da2d6", fontSize: "13px", marginTop: "4px" }}>
            Accounting sync with BUSY{conn.adapter ? ` — transport: ${conn.adapter}` : ""}
            {conn.capabilities && conn.capabilities.synchronousSend === false ? " (asynchronous hand-off)" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {canAct && (
            <>
              <button style={BTN} onClick={() => act("Connection tested", "/connection/test", { method: "POST" })}>
                Test connection
              </button>
              <button style={BTN} onClick={() => act("Queue processed", "/worker/tick", { method: "POST" })}>
                Process queue now
              </button>
              <button style={BTN} onClick={() => act("Reconciliation complete", "/reconciliation/run", { method: "POST" })}>
                Run reconciliation
              </button>
            </>
          )}
          <button style={BTN} onClick={refresh}>Refresh</button>
        </div>
      </div>

      {error && (
        <div style={{ ...card, borderColor: "#ef4444", color: "#ef4444", marginBottom: "16px" }}>{error}</div>
      )}

      {!canAct && (
        <div style={{ ...card, borderColor: "#16345d", color: "#7da2d6", fontSize: "13px", padding: "12px 16px" }}>
          You are signed in as {role}. Retry, Fix Mapping and Reconcile need SUPERVISOR or above.
        </div>
      )}

      <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: "22px" }}>
        <Tile
          label="BUSY connection"
          value={conn.online ? "Online" : "Offline"}
          color={conn.online ? "#22c55e" : "#ef4444"}
          sub={conn.online ? `Checked ${fmt(conn.lastCheckedAt)}` : conn.lastErrorMessage || "Transactions are being queued."}
        />
        <Tile label="Last successful sync" value={overview && overview.lastSuccessfulSync ? fmt(overview.lastSuccessfulSync) : "Never"} />
        <Tile label="Pending" value={q.PENDING || 0} />
        <Tile label="Processing" value={q.PROCESSING || 0} />
        <Tile label="Awaiting BUSY" value={q.AWAITING_BUSY || 0} color="#60a5fa" />
        <Tile label="Successful" value={q.SUCCESS || 0} color="#22c55e" />
        <Tile label="Failed" value={q.FAILED || 0} color="#ef4444" />
        <Tile label="Manual review" value={q.MANUAL_REVIEW || 0} color="#f4ae1f" />
        <Tile label="Today's transactions" value={(overview && overview.todaysTransactions) || 0} />
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "18px", flexWrap: "wrap" }}>
        {["queue", "mappings", "reconciliation", "audit", "capabilities"].map((t) => (
          <button key={t} style={TAB_STYLE(tab === t)} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── QUEUE ─────────────────────────────────────────── */}
      {tab === "queue" && (
        <div style={card}>
          <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
            <select style={inputStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {["PENDING", "PROCESSING", "AWAITING_BUSY", "RETRY", "SUCCESS", "FAILED", "MANUAL_REVIEW"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              style={{ ...inputStyle, flex: 1, minWidth: "220px" }}
              placeholder="Search reference, DHOWN id or BUSY reference"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ color: "#7da2d6", textAlign: "left" }}>
                  <th style={{ padding: "8px" }}>External reference</th>
                  <th style={{ padding: "8px" }}>Type</th>
                  <th style={{ padding: "8px" }}>DHOWN id</th>
                  <th style={{ padding: "8px" }}>Status</th>
                  <th style={{ padding: "8px", textAlign: "right" }}>Attempts</th>
                  <th style={{ padding: "8px" }}>BUSY reference</th>
                  <th style={{ padding: "8px" }}>Updated</th>
                  <th style={{ padding: "8px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((i) => (
                  <tr key={i.id} style={{ borderTop: "1px solid #16345d" }}>
                    <td style={{ padding: "8px", fontFamily: "monospace" }}>{i.externalReference}</td>
                    <td style={{ padding: "8px" }}>{i.entityType}</td>
                    <td style={{ padding: "8px", fontFamily: "monospace" }}>{i.dhownEntityId}</td>
                    <td style={{ padding: "8px" }}><Pill value={i.status} /></td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{i.attemptCount}</td>
                    <td style={{ padding: "8px", fontFamily: "monospace" }}>{i.busyReference || "—"}</td>
                    <td style={{ padding: "8px", color: "#7da2d6" }}>{fmt(i.updatedAt)}</td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                      <button
                        style={BTN}
                        onClick={async () => {
                          const d = await api(`/queue/${i.id}`).catch((e) => { flash(e.message, true); return null; });
                          if (d) setModal({ title: i.externalReference, explanation: d.explanation, payload: d.item.payload, audit: d.audit });
                        }}
                      >
                        Payload
                      </button>
                      {i.explanation && (
                        <button style={BTN} onClick={() => setModal({ title: `Failed: ${i.externalReference}`, explanation: i.explanation, raw: `${i.errorCode}\n\n${i.errorMessage}` })}>
                          Error
                        </button>
                      )}
                      {canAct && i.status !== "SUCCESS" && i.status !== "PROCESSING" && (
                        <button style={BTN} onClick={() => act("Retry finished", `/queue/${i.id}/retry`, { method: "POST" })}>
                          Retry
                        </button>
                      )}
                      {canAct && i.errorCode === "MASTER_MAPPING_ERROR" && (
                        <button
                          style={BTN}
                          onClick={() =>
                            setModal({
                              title: "Map DHOWN record to BUSY",
                              mapForm: {
                                entityType: (i.errorDetails && i.errorDetails.entityType) || "ITEM",
                                dhownId: (i.errorDetails && i.errorDetails.subject) || i.dhownEntityId,
                              },
                            })
                          }
                        >
                          Fix mapping
                        </button>
                      )}
                      {canAct && (i.status === "SUCCESS" || i.status === "AWAITING_BUSY") && (
                        <>
                          <button style={BTN} onClick={() => act("Reconciled", `/queue/${i.id}/reconcile`, { method: "POST" })}>
                            Reconcile
                          </button>
                          <button
                            style={BTN}
                            onClick={async () => {
                              const d = await api(`/queue/${i.id}/busy-reference`).catch((e) => { flash(e.message, true); return null; });
                              if (d) setModal({ title: "BUSY reference", raw: JSON.stringify(d, null, 2) });
                            }}
                          >
                            BUSY ref
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {queue.length === 0 && <div style={{ padding: "20px", color: "#4a6485", textAlign: "center" }}>Nothing queued.</div>}
          </div>
        </div>
      )}

      {/* ── MAPPINGS ──────────────────────────────────────── */}
      {tab === "mappings" && (
        <div style={card}>
          <div style={{ display: "flex", gap: "14px", marginBottom: "14px", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ color: "#7da2d6", fontSize: "13px", display: "flex", gap: "6px", alignItems: "center" }}>
              <input type="checkbox" checked={unmappedOnly} onChange={(e) => setUnmappedOnly(e.target.checked)} />
              Unmapped only
            </label>
            {canAct && (
              <button style={BTN} onClick={() => setModal({ title: "Map DHOWN record to BUSY", mapForm: { entityType: "ITEM", dhownId: "" } })}>
                + New mapping
              </button>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ color: "#7da2d6", textAlign: "left" }}>
                  {["Type", "DHOWN id", "Name", "BUSY id", "BUSY code", "Status", "Last synced", ""].map((th) => (
                    <th key={th} style={{ padding: "8px" }}>{th}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} style={{ borderTop: "1px solid #16345d" }}>
                    <td style={{ padding: "8px" }}>{m.entityType}</td>
                    <td style={{ padding: "8px", fontFamily: "monospace" }}>{m.dhownId}</td>
                    <td style={{ padding: "8px" }}>{m.dhownName || "—"}</td>
                    <td style={{ padding: "8px", fontFamily: "monospace" }}>{m.busyId || "—"}</td>
                    <td style={{ padding: "8px", fontFamily: "monospace" }}>{m.busyCode || "—"}</td>
                    <td style={{ padding: "8px" }}><Pill value={m.syncStatus} /></td>
                    <td style={{ padding: "8px", color: "#7da2d6" }}>{fmt(m.lastSyncedAt)}</td>
                    <td style={{ padding: "8px" }}>
                      {canAct && (
                        <button style={BTN} onClick={() => setModal({ title: "Map DHOWN record to BUSY", mapForm: { entityType: m.entityType, dhownId: m.dhownId } })}>
                          {m.busyId ? "Change" : "Map"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mappings.length === 0 && <div style={{ padding: "20px", color: "#4a6485", textAlign: "center" }}>No mappings yet.</div>}
          </div>
        </div>
      )}

      {/* ── RECONCILIATION ────────────────────────────────── */}
      {tab === "reconciliation" && (
        <div style={card}>
          <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" }}>
            {Object.entries(recon.summary || {}).map(([k, v]) => (
              <span key={k} style={{ padding: "5px 11px", border: "1px solid #16345d", borderRadius: "6px", fontSize: "12px", color: STATUS_COLOR[k] || "#7da2d6" }}>
                {k}: {v}
              </span>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ color: "#7da2d6", textAlign: "left" }}>
                  {["Result", "Type", "External reference", "BUSY reference", "Differences", "When", ""].map((th) => (
                    <th key={th} style={{ padding: "8px" }}>{th}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(recon.items || []).map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid #16345d" }}>
                    <td style={{ padding: "8px" }}><Pill value={r.result} /></td>
                    <td style={{ padding: "8px" }}>{r.entityType}</td>
                    <td style={{ padding: "8px", fontFamily: "monospace" }}>{r.externalReference || "—"}</td>
                    <td style={{ padding: "8px", fontFamily: "monospace" }}>{r.busyReference || "—"}</td>
                    <td style={{ padding: "8px" }}>{(r.differences || []).length} field(s)</td>
                    <td style={{ padding: "8px", color: "#7da2d6" }}>{fmt(r.createdAt)}</td>
                    <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                      <button style={BTN} onClick={() => setModal({ title: `${r.result}: ${r.externalReference || r.busyReference}`, raw: JSON.stringify(r.differences, null, 2) })}>
                        Details
                      </button>
                      {canAct && (
                        <button style={BTN} onClick={() => act("Marked resolved", `/reconciliation/${r.id}/resolve`, { method: "POST" })}>
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(recon.items || []).length === 0 && (
              <div style={{ padding: "20px", color: "#4a6485", textAlign: "center" }}>No unresolved findings.</div>
            )}
          </div>
        </div>
      )}

      {/* ── AUDIT ─────────────────────────────────────────── */}
      {tab === "audit" && (
        <div style={{ ...card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ color: "#7da2d6", textAlign: "left" }}>
                {["When", "Type", "External reference", "Operation", "Attempt", "By", "Status", "BUSY reference", "Error"].map((th) => (
                  <th key={th} style={{ padding: "8px" }}>{th}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {audit.map((e) => (
                <tr key={e.id} style={{ borderTop: "1px solid #16345d" }}>
                  <td style={{ padding: "8px", color: "#7da2d6" }}>{fmt(e.createdAt)}</td>
                  <td style={{ padding: "8px" }}>{e.entityType}</td>
                  <td style={{ padding: "8px", fontFamily: "monospace" }}>{e.externalReference || "—"}</td>
                  <td style={{ padding: "8px" }}>{e.operation}</td>
                  <td style={{ padding: "8px", textAlign: "right" }}>{e.attemptCount}</td>
                  <td style={{ padding: "8px" }}>{e.actor}</td>
                  <td style={{ padding: "8px" }}>{e.finalStatus}</td>
                  <td style={{ padding: "8px", fontFamily: "monospace" }}>{e.busyReference || "—"}</td>
                  <td style={{ padding: "8px", color: "#ef4444" }}>{e.errorCode || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 && <div style={{ padding: "20px", color: "#4a6485", textAlign: "center" }}>No audit entries yet.</div>}
        </div>
      )}

      {/* ── CAPABILITIES ──────────────────────────────────── */}
      {tab === "capabilities" && (
        <div style={card}>
          <p style={{ color: "#7da2d6", fontSize: "13px", marginTop: 0 }}>
            What the configured BUSY transport can actually do. Operations marked “no” are refused
            outright rather than faked — see <code>docs/BUSY_INTEGRATION.md</code>.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", marginBottom: "20px" }}>
            <tbody>
              {Object.entries(conn.capabilities || {}).map(([k, v]) => (
                <tr key={k} style={{ borderTop: "1px solid #16345d" }}>
                  <td style={{ padding: "8px", fontFamily: "monospace" }}>{k}</td>
                  <td style={{ padding: "8px", color: v ? "#22c55e" : "#ef4444" }}>{v ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ fontSize: "14px" }}>Configuration</h3>
          <pre style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "6px", padding: "12px", fontSize: "12px", overflowX: "auto" }}>
            {JSON.stringify((overview && overview.config) || {}, null, 2)}
          </pre>
        </div>
      )}

      {/* ── MODAL ─────────────────────────────────────────── */}
      {modal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", zIndex: 50 }}
        >
          <div style={{ ...card, width: "min(820px, 100%)", maxHeight: "85vh", overflowY: "auto", marginBottom: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h2 style={{ margin: 0, fontSize: "16px" }}>{modal.title}</h2>
              <button style={BTN} onClick={() => setModal(null)}>Close</button>
            </div>

            {modal.explanation && (
              <div style={{ borderLeft: "3px solid #f4ae1f", background: "#0d1b2f", padding: "12px 14px", borderRadius: "0 6px 6px 0", marginBottom: "14px" }}>
                <div style={{ fontSize: "11px", color: "#7da2d6", textTransform: "uppercase" }}>Reason</div>
                <div style={{ marginBottom: "10px" }}>{modal.explanation.reason}</div>
                <div style={{ fontSize: "11px", color: "#7da2d6", textTransform: "uppercase" }}>Action</div>
                <div>{modal.explanation.action}</div>
              </div>
            )}

            {modal.mapForm && <MapForm initial={modal.mapForm} api={api} onDone={(msg, bad) => { flash(msg, bad); if (!bad) { setModal(null); refresh(); } }} />}

            {modal.payload !== undefined && (
              <>
                <h3 style={{ fontSize: "13px", color: "#7da2d6" }}>Payload sent to BUSY</h3>
                <pre style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "6px", padding: "12px", fontSize: "12px", overflowX: "auto" }}>
                  {JSON.stringify(modal.payload, null, 2)}
                </pre>
              </>
            )}

            {modal.raw && (
              <pre style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "6px", padding: "12px", fontSize: "12px", overflowX: "auto", whiteSpace: "pre-wrap" }}>
                {modal.raw}
              </pre>
            )}

            {modal.audit && modal.audit.length > 0 && (
              <>
                <h3 style={{ fontSize: "13px", color: "#7da2d6" }}>Audit trail</h3>
                {modal.audit.map((e) => (
                  <pre key={e.id} style={{ background: "#0d1b2f", border: "1px solid #16345d", borderRadius: "6px", padding: "10px", fontSize: "12px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {`${fmt(e.createdAt)}  ${e.finalStatus}  attempt ${e.attemptCount}  by ${e.actor}` +
                      (e.busyReference ? `\nBUSY reference: ${e.busyReference}` : "") +
                      (e.errorCode ? `\n${e.errorCode}: ${e.errorMessage}` : "") +
                      (e.busyResponse ? `\n\nBUSY response:\n${e.busyResponse}` : "")}
                  </pre>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: "20px", left: "50%", transform: "translateX(-50%)", background: "#071120", border: "1px solid #16345d", borderLeft: `3px solid ${toast.bad ? "#ef4444" : "#22c55e"}`, borderRadius: "6px", padding: "11px 18px", fontSize: "13px", zIndex: 60, maxWidth: "90vw" }}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

/** "Fix Mapping" form. The BUSY id is typed in from BUSY itself. */
function MapForm({ initial, api, onDone }) {
  const [entityType, setEntityType] = useState(initial.entityType || "ITEM");
  const [dhownId, setDhownId] = useState(initial.dhownId || "");
  const [busyId, setBusyId] = useState("");
  const [busyCode, setBusyCode] = useState("");
  const [saving, setSaving] = useState(false);

  const field = { marginBottom: "12px" };
  const label = { display: "block", fontSize: "12px", color: "#7da2d6", marginBottom: "4px" };

  const save = async () => {
    setSaving(true);
    try {
      await api("/mappings", {
        method: "POST",
        body: { entityType, dhownId: dhownId.trim(), busyId: busyId.trim(), busyCode: busyCode.trim() || undefined },
      });
      onDone("Mapping saved. Retry the transaction to send it to BUSY.");
    } catch (e) {
      onDone(e.message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={field}>
        <label style={label}>Record type</label>
        <select style={{ ...inputStyle, width: "100%" }} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
          {["CUSTOMER", "VENDOR", "ITEM", "WAREHOUSE"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={field}>
        <label style={label}>DHOWN id</label>
        <input style={{ ...inputStyle, width: "100%" }} value={dhownId} onChange={(e) => setDhownId(e.target.value)} />
      </div>
      <div style={field}>
        <label style={label}>BUSY id</label>
        <input style={{ ...inputStyle, width: "100%" }} placeholder="e.g. BUSY-4587" value={busyId} onChange={(e) => setBusyId(e.target.value)} />
      </div>
      <div style={field}>
        <label style={label}>BUSY code (optional)</label>
        <input style={{ ...inputStyle, width: "100%" }} value={busyCode} onChange={(e) => setBusyCode(e.target.value)} />
      </div>
      <button
        style={{ ...BTN, background: "#f4ae1f", color: "black", fontWeight: "bold", padding: "8px 16px", fontSize: "13px" }}
        disabled={saving || !dhownId.trim() || !busyId.trim()}
        onClick={save}
      >
        {saving ? "Saving…" : "Save mapping"}
      </button>
    </div>
  );
}
