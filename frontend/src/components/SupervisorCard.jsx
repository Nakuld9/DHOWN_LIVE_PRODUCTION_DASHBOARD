import React, { useState } from "react";

const SESSION_KEY = "dhown_current_user";

const ROLE_COLORS = {
  SUPER_ADMIN: "#f4ae1f",
  ADMIN: "#60a5fa",
  SUPERVISOR: "#34d399",
  OPERATOR: "#a78bfa",
  VIEWER: "#6b7280",
};

function getSession() {
  try {
    const s = localStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

const fieldStyle = {
  width: "100%",
  padding: "8px 10px",
  marginBottom: "8px",
  background: "#0a1628",
  color: "white",
  border: "1px solid #16345d",
  borderRadius: "5px",
  boxSizing: "border-box",
  fontSize: "14px",
};

const SupervisorCard = () => {
  const [user, setUser] = useState(getSession);
  const [showLogin, setShowLogin] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [logging, setLogging] = useState(false);

  const doLogin = async () => {
    if (!loginForm.username || !loginForm.password) {
      setLoginError("Enter username and password.");
      return;
    }
    setLogging(true);
    setLoginError("");
    try {
      const res = await fetch("http://localhost:4000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || "Login failed.");
      } else {
        localStorage.setItem('dhown_token', data.token);
        localStorage.setItem(SESSION_KEY, JSON.stringify(data));
        setUser(data);
        setShowLogin(false);
        setLoginForm({ username: "", password: "" });
      }
    } catch {
      setLoginError("Unable to connect. Check server.");
    }
    setLogging(false);
  };

  const doLogout = () => {
    localStorage.removeItem('dhown_token');
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
    window.location.href = '/login';
  };

  const roleColor = user ? (ROLE_COLORS[user.role] || "#7da2d6") : "#7da2d6";

  return (
    <div
      style={{
        background: "#0d1b2f",
        borderRadius: "12px",
        padding: "20px",
        color: "white",
        border: "1px solid #16345d",
      }}
    >
      <h3
        style={{
          marginBottom: "16px",
          fontSize: "13px",
          color: "#7da2d6",
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          margin: "0 0 16px",
        }}
      >
        Supervisor On Duty
      </h3>

      {/* No user, not showing login */}
      {!user && !showLogin && (
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "68px",
              height: "68px",
              borderRadius: "50%",
              background: "#16345d",
              margin: "0 auto 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "26px",
              color: "#7da2d6",
            }}
          >
            ?
          </div>
          <p
            style={{
              color: "#7da2d6",
              fontSize: "15px",
              margin: "0 0 12px",
            }}
          >
            No Supervisor Logged In
          </p>
          <button
            onClick={() => setShowLogin(true)}
            style={{
              background: "#f4ae1f",
              color: "black",
              border: "none",
              padding: "7px 20px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: "bold",
              fontSize: "14px",
            }}
          >
            Log In
          </button>
        </div>
      )}

      {/* Login form */}
      {showLogin && !user && (
        <div>
          <input
            style={fieldStyle}
            placeholder="Username"
            value={loginForm.username}
            autoFocus
            onChange={(e) =>
              setLoginForm({ ...loginForm, username: e.target.value })
            }
            onKeyDown={(e) => e.key === "Enter" && doLogin()}
          />
          <input
            style={fieldStyle}
            type="password"
            placeholder="Password"
            value={loginForm.password}
            onChange={(e) =>
              setLoginForm({ ...loginForm, password: e.target.value })
            }
            onKeyDown={(e) => e.key === "Enter" && doLogin()}
          />
          {loginError && (
            <p style={{ color: "#ef4444", fontSize: "13px", margin: "0 0 8px" }}>
              {loginError}
            </p>
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={doLogin}
              disabled={logging}
              style={{
                flex: 1,
                background: logging ? "#374151" : "#f4ae1f",
                color: logging ? "white" : "black",
                border: "none",
                padding: "8px",
                borderRadius: "5px",
                cursor: logging ? "not-allowed" : "pointer",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              {logging ? "Logging in..." : "Login"}
            </button>
            <button
              onClick={() => {
                setShowLogin(false);
                setLoginError("");
                setLoginForm({ username: "", password: "" });
              }}
              style={{
                background: "#374151",
                color: "#9ca3af",
                border: "none",
                padding: "8px 12px",
                borderRadius: "5px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Logged-in user */}
      {user && (
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "68px",
              height: "68px",
              borderRadius: "50%",
              background: roleColor,
              margin: "0 auto 12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "30px",
              color: "black",
              fontWeight: "bold",
            }}
          >
            {user.full_name.charAt(0).toUpperCase()}
          </div>

          <h4 style={{ margin: "0 0 4px", fontSize: "17px" }}>{user.full_name}</h4>

          <span
            style={{
              display: "inline-block",
              background: roleColor + "22",
              color: roleColor,
              border: `1px solid ${roleColor}44`,
              padding: "2px 10px",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: "bold",
              marginBottom: "6px",
            }}
          >
            {user.role}
          </span>

          {user.mobile && (
            <p style={{ color: "#7da2d6", fontSize: "14px", margin: "4px 0 0" }}>
              {user.mobile}
            </p>
          )}

          <button
            onClick={doLogout}
            style={{
              marginTop: "12px",
              background: "transparent",
              color: "#6b7280",
              border: "1px solid #16345d",
              padding: "4px 14px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Log Out
          </button>
        </div>
      )}
    </div>
  );
};

export default SupervisorCard;
