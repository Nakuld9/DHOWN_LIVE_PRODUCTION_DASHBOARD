import { useEffect, useState } from "react";

const PAGE_SIZE = 50;

export default function RFIDEvents() {
  const [events, setEvents] = useState([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [pages, setPages]   = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const loadEvents = async (p = page) => {
    try {
      const res = await fetch(`/api/rfid-events?page=${p}&limit=${PAGE_SIZE}`);
      if (!res.ok) throw new Error("Server error " + res.status);
      const json = await res.json();
      setEvents(json.data || json);
      setTotal(json.total ?? (json.data ?? json).length);
      setPages(json.pages ?? 1);
      setError(null);
    } catch (err) {
      setError("Unable to load RFID events. Check backend is running.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents(page);
    const interval = page === 1 ? setInterval(() => loadEvents(1), 5000) : null;
    return () => { if (interval) clearInterval(interval); };
  }, [page]);

  const goTo = (p) => { setPage(p); setLoading(true); };

  return (
    <div style={{ padding: "30px", color: "var(--text)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "20px" }}>
        <h1 style={{ color: "var(--text)", fontFamily: "var(--mono)", fontWeight: 800, letterSpacing: ".02em", textTransform: "uppercase", fontSize: "42px", margin: 0 }}>RFID EVENTS</h1>
        <span style={{ color: "var(--muted)", fontSize: "13px" }}>{total.toLocaleString()} total records</span>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px" }}>
        <table width="100%" cellPadding="12" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--yellow)" }}>
              <th align="left">#</th>
              <th align="left">RFID</th>
              <th align="left">Operator</th>
              <th align="left">Machine</th>
              <th align="left">Time</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan="5" style={{ padding: "24px", color: "var(--muted)", textAlign: "center" }}>Loading events...</td></tr>
            )}
            {error && !loading && (
              <tr><td colSpan="5" style={{ padding: "24px", color: "var(--crit)", textAlign: "center" }}>{error}</td></tr>
            )}
            {!loading && !error && events.length === 0 && (
              <tr><td colSpan="5" style={{ padding: "24px", color: "var(--muted)", fontStyle: "italic", textAlign: "center" }}>No RFID events recorded yet.</td></tr>
            )}
            {events.map((event, i) => (
              <tr key={event.event_id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ color: "var(--border)", fontSize: "12px" }}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                <td style={{ fontFamily: "monospace", color: "var(--link)" }}>{event.rfid_tag}</td>
                <td>{event.operator_name}</td>
                <td>{event.machine_id || "—"}</td>
                <td style={{ color: "var(--muted)", fontSize: "13px" }}>{new Date(event.event_time).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '').split('/').join('-')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {pages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", marginTop: "20px" }}>
            <PgBtn label="« First"  onClick={() => goTo(1)}         disabled={page === 1} />
            <PgBtn label="‹ Prev"   onClick={() => goTo(page - 1)}  disabled={page === 1} />
            <span style={{ color: "var(--yellow)", fontWeight: "bold", fontSize: "14px" }}>
              Page {page} of {pages}
            </span>
            <PgBtn label="Next ›"   onClick={() => goTo(page + 1)}  disabled={page === pages} />
            <PgBtn label="Last »"   onClick={() => goTo(pages)}     disabled={page === pages} />
          </div>
        )}
      </div>
    </div>
  );
}

function PgBtn({ label, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "var(--surface)" : "var(--yellow)",
        color: disabled ? "var(--border)" : "#000",
        border: "1px solid var(--border)",
        padding: "6px 14px", borderRadius: "5px",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: "bold", fontSize: "12px",
      }}
    >
      {label}
    </button>
  );
}
