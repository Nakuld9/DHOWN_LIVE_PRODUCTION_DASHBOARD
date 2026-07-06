import { useEffect, useState } from "react";

export default function RFIDEvents() {

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadEvents = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/rfid-events");
      if (!res.ok) throw new Error("Server error " + res.status);
      const data = await res.json();
      setEvents(data);
      setError(null);
    } catch (err) {
      setError("Unable to load RFID events. Check backend is running.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
    const interval = setInterval(loadEvents, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        padding: "30px",
        color: "#fff"
      }}
    >
      <h1
        style={{
          color: "#FFD700",
          fontSize: "58px"
        }}
      >
        RFID EVENTS
      </h1>

      <div
        style={{
          background: "#081830",
          border: "1px solid #23395d",
          borderRadius: "12px",
          padding: "20px"
        }}
      >
        <table
          width="100%"
          cellPadding="12"
          style={{
            borderCollapse: "collapse"
          }}
        >
          <thead>
            <tr
              style={{
                color: "#FFD700"
              }}
            >
              <th align="left">RFID</th>
              <th align="left">Operator</th>
              <th align="left">Machine</th>
              <th align="left">Time</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr><td colSpan="4" style={{ padding: "24px", color: "#7da2d6", textAlign: "center" }}>Loading events...</td></tr>
            )}
            {error && !loading && (
              <tr><td colSpan="4" style={{ padding: "24px", color: "#ef4444", textAlign: "center" }}>{error}</td></tr>
            )}
            {!loading && !error && events.length === 0 && (
              <tr><td colSpan="4" style={{ padding: "24px", color: "#7da2d6", fontStyle: "italic", textAlign: "center" }}>No RFID events recorded yet.</td></tr>
            )}
            {events.map((event) => (

              <tr
                key={event.event_id}
                style={{
                  borderBottom:
                    "1px solid #23395d"
                }}
              >

                <td>{event.rfid_tag}</td>

                <td>{event.operator_name}</td>

                <td>
                  {event.machine_id || "-"}
                </td>

                <td>
                  {new Date(
                    event.event_time
                  ).toLocaleString()}
                </td>

              </tr>

            ))}

          </tbody>
        </table>
      </div>
    </div>
  );
}