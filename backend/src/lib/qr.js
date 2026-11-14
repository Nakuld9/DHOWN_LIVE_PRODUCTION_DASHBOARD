// QR helpers — data-URL generation + the URL a roll QR encodes.
// QR_BASE_URL must be the PUBLIC base (Cloudflare-tunnel domain) or scans break.

const QRCode = require("qrcode");

async function generateQR(text) {
  try { return await QRCode.toDataURL(text, { width: 200, margin: 1 }); }
  catch (_) { return null; }
}

// Roll QRs encode a URL so scanning with any phone camera opens the mobile
// roll-details page (/m/roll/:id, login-protected). QR_BASE_URL in .env should
// be the server's LAN address as phones reach it.
function rollQRContent(rollId) {
  return `${require('../../config/tenant').qrBaseUrl}/m/roll/${rollId}`;
}

module.exports = { generateQR, rollQRContent };
