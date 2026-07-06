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
      const res = await fetch(`http://localhost:4000/api/rfid-events?page=${p}&limit=${PAGE_SIZE}`);
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
    <div style={{ padding: "30px", color: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "20px" }}>
        <h1 style={{ color: "#FFD700", fontSize: "42px", margin: 0 }}>RFID EVENTS</h1>
        <span style={{ color: "#7da2d6", fontSize: "13px" }}>{total.toLocaleString()} total records</span>
      </div>

      <div style={{ background: "#081830", border: "1px solid #23395d", borderRadius: "12px", padding: "20px" }}>
        <table width="100%" cellPadding="12" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "#FFD700" }}>
              <th align="left">#</th>
              <th align="left">RFID</th>
              <th align="left">Operator</th>
              <th align="left">Machine</th>
              <th align="left">Time</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan="5" style={{ padding: "24px", color: "#7da2d6", textAlign: "center" }}>Loading events...</td></tr>
            )}
            {error && !loading && (
              <tr><td colSpan="5" style={{ padding: "24px", color: "#ef4444", textAlign: "center" }}>{error}</td></tr>
            )}
            {!loading && !error && events.length === 0 && (
              <tr><td colSpan="5" style={{ padding: "24px", color: "#7da2d6", fontStyle: "italic", textAlign: "center" }}>No RFID events recorded yet.</td></tr>
            )}
            {events.map((event, i) => (
              <tr key={event.event_id} style={{ borderBottom: "1px solid #23395d" }}>
                <td style={{ color: "#455a7c", fontSize: "12px" }}>{(page - 1) * PAGE_SIZE + i + 1}</td>
                <td style={{ fontFamily: "monospace", color: "#60a5fa" }}>{event.rfid_tag}</td>
                <td>{event.operator_name}</td>
                <td>{event.machine_id || "—"}</td>
                <td style={{ color: "#9ca3af", fontSize: "13px" }}>{new Date(event.event_time).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {pages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "10px", marginTop: "20px" }}>
            <PgBtn label="« First"  onClick={() => goTo(1)}         disabled={page === 1} />
            <PgBtn label="‹ Prev"   onClick={() => goTo(page - 1)}  disabled={page === 1} />
            <span style={{ color: "#FFD700", fontWeight: "bold", fontSize: "14px" }}>
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
        background: disabled ? "#0d1b2f" : "#FFD700",
        color: disabled ? "#455a7c" : "#000",
        border: "1px solid #23395d",
        padding: "6px 14px", borderRadius: "5px",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: "bold", fontSize: "12px",
      }}
    >
      {label}
    </button>
  );
}
