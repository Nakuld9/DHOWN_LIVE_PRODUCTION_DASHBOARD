/* DHOWN MES service worker.
 *
 * Deliberately conservative: this is a live factory dashboard, so API responses
 * are NEVER cached â€” showing stale machine/production data would be worse than
 * showing nothing. We only cache the app shell (index.html + content-hashed
 * /static assets + icons) so the app opens instantly and survives a flaky
 * factory network. Data always comes from the network.
 */
const CACHE = 'dhown-mes-v74';
const SHELL = ['/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Per-item so one failure (e.g. an auth redirect) doesn't abort the install.
      .then((cache) => Promise.all(SHELL.map((u) => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only cache same-origin, successful, non-redirected responses.
function cacheable(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;                    // never touch writes
  if (url.origin !== self.location.origin) return;     // leave cross-origin alone
  if (url.pathname.startsWith('/api/')) return;        // LIVE DATA â€” never cache
  if (url.pathname.startsWith('/socket.io/')) return;  // realtime transport

  // Navigations: network-first so a fresh shell wins; cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (cacheable(res)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets are content-hashed by CRA, so cache-first is safe.
  event.respondWith(
    caches.match(req).then((hit) => (
      hit || fetch(req).then((res) => {
        if (cacheable(res)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
    ))
  );
});
