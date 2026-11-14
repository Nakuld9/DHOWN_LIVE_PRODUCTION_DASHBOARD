// Authenticated file downloads.
//
// window.open() and a plain <a href> cannot carry an Authorization header, so
// any endpoint they hit has to be open to the world. That is how /api/reports
// ended up serving production data, machine data and operator records to
// anyone who could reach the port: the router could not be guarded without
// breaking the download buttons, so it was never guarded.
//
// Fetching the file and handing the browser a blob keeps the header and gets
// the same result. utils/authFetch.js already injects the JWT into every /api
// request, so nothing here has to know about tokens.

// Download a URL to a file, or open it in a tab. Returns nothing; throws with a
// useful message so the caller can show it rather than leaving a dead button.
export async function downloadFile(url, { filename, open = false } = {}) {
  const res = await fetch(url);
  if (!res.ok) {
    // These endpoints answer JSON on failure. Surfacing "Authentication
    // required" beats a browser tab that silently shows nothing.
    let msg = `Download failed (${res.status})`;
    try {
      const j = await res.clone().json();
      if (j && j.error) msg = j.error;
    } catch { /* not JSON — keep the status message */ }
    throw new Error(msg);
  }

  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  try {
    if (open) {
      const w = window.open(href, '_blank');
      if (!w) throw new Error('Allow pop-ups to view this file.');
    } else {
      const a = document.createElement('a');
      a.href = href;
      a.download = filename || nameFromUrl(url, res);
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } finally {
    // Long enough for a new tab to load the blob before it is revoked.
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }
}

// Prefer the name the server asked for; fall back to the last path segment.
function nameFromUrl(url, res) {
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename="?([^";]+)"?/i.exec(cd);
  if (m) return m[1];
  const path = String(url).split('?')[0].replace(/\/+$/, '');
  return path.slice(path.lastIndexOf('/') + 1) || 'download';
}
