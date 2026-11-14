// Trash — everything soft-deleted, and the button that brings it back.
//
// The page exists so that "I deleted the wrong thing" is a thirty-second
// problem instead of a restore-from-backup problem.

import React, { useState, useEffect, useCallback } from "react";

const API = "";
const tok = () => localStorage.getItem("dhown_token");
const auth = () => ({ Authorization: `Bearer ${tok()}` });

const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 };
const th = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: "9px 10px", textAlign: "left", fontSize: 13, borderTop: "1px solid var(--surface)" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 6, padding: "6px 13px", fontWeight: 600, fontSize: 13, cursor: "pointer" });

const when = (d) => {
  if (!d) return "—";
  const t = new Date(d);
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return t.toLocaleDateString('en-GB').split('/').join('-');
};

export default function Trash() {
  const [items, setItems] = useState([]);
  const [tables, setTables] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${API}/api/trash`, { headers: auth() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setItems(j.items || []);
      setTables(j.tables || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const restore = async (it) => {
    setBusy(`${it.table}:${it.id}`); setErr(""); setMsg("");
    try {
      const r = await fetch(`${API}/api/trash/${it.table}/${encodeURIComponent(it.id)}/restore`, {
        method: "POST", headers: auth(),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setMsg(`${it.label} "${it.name}" restored.`);
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div style={{ padding: 20, color: "var(--text)" }}>
      <h2 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", margin: "0 0 4px" }}>Trash</h2>
      <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
        Deleted records are kept here and can be restored. Covers{" "}
        {tables.map(t => t.label.toLowerCase() + "s").join(", ") || "the tables that support it"}.
      </div>

      {err && <div style={{ ...card, marginBottom: 12, borderColor: "var(--crit-dim)", color: "var(--crit)" }}>{err}</div>}
      {msg && <div style={{ ...card, marginBottom: 12, borderColor: "var(--green-dim)", color: "var(--green)" }}>{msg}</div>}

      <div style={card}>
        {loading && <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>}

        {!loading && !items.length && (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Trash is empty. Nothing has been deleted.
          </div>
        )}

        {!loading && items.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>{["Type", "Name", "Deleted", "By", ""].map(h => <th key={h || "act"} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={`${it.table}:${it.id}`}>
                    <td style={{ ...td, color: "var(--muted)" }}>{it.label}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{it.name || `#${it.id}`}</td>
                    <td style={td}>{when(it.deleted_at)}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{it.deleted_by || "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button
                        style={btn("var(--green)", "#000")}
                        disabled={busy === `${it.table}:${it.id}`}
                        onClick={() => restore(it)}
                      >
                        {busy === `${it.table}:${it.id}` ? "Restoring…" : "Restore"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 12, lineHeight: 1.6 }}>
        Not everything is covered, deliberately. Customers, items, operators and machines have no
        delete at all — they are deactivated instead, so they are already recoverable. Invoices,
        orders and payments are cancelled rather than deleted, so they stay visible and numbered.
      </div>
    </div>
  );
}
