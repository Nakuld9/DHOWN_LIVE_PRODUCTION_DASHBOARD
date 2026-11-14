// The firm this instance belongs to.
//
// One build serves every firm, so branding is fetched at runtime rather than
// compiled in. A build-time variable would mean a separate bundle per firm,
// which is the fork problem again in a different place.
//
// Cached in sessionStorage so the name is present on first paint after the first
// load — the login screen showing another firm's name for a moment is exactly
// the thing this is meant to prevent.

import { useEffect, useState } from "react";

const KEY = "dhown_tenant";
const FALLBACK = { name: "MES", address: "", website: "" };

let inflight = null;

export function readCachedTenant() {
  try { return JSON.parse(sessionStorage.getItem(KEY)) || null; } catch { return null; }
}

export function useTenant() {
  const [tenant, setTenant] = useState(() => readCachedTenant() || FALLBACK);

  useEffect(() => {
    let alive = true;
    inflight = inflight || fetch("/api/public/tenant").then(r => r.ok ? r.json() : null);
    inflight
      .then(t => {
        if (!t || !alive) return;
        sessionStorage.setItem(KEY, JSON.stringify(t));
        setTenant(t);
        if (t.name) document.title = `${t.name} MES`;
      })
      .catch(() => {})
      .finally(() => { inflight = null; });
    return () => { alive = false; };
  }, []);

  return tenant;
}
