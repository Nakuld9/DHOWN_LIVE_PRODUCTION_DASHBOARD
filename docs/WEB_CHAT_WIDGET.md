# Customer Web-Chat Widget ("Chat with us")

A public chat bubble for the **company website**. Visitors who are *not* on WhatsApp
chat with the **same AI** that answers WhatsApp customers, and every conversation
lands in the **same CRM inbox** (`/whatsapp-inbox`) — tagged with a yellow **WEB**
badge — so staff work one inbox for both channels.

## How it works

- The chat UI is served at **`/chat`** (public, no login). It fills its container,
  so it works standalone or inside an iframe.
- The browser keeps an unguessable per-visitor **session id** in `localStorage`.
  That becomes a synthetic phone `web:<session>`, so the existing conversation /
  message / AI plumbing is reused unchanged.
- Backend (public, rate-limited — 20 msgs/min/IP), allow-listed in `auth.js`:
  - `GET  /api/webchat/config`  — company name + greeting (no secrets)
  - `GET  /api/webchat/history?session=…` — the visitor's own thread
  - `POST /api/webchat/message` `{ session, text, name? }` → AI reply
- The AI answers as an **unknown customer** (the synthetic phone matches no partner),
  so its prompt guardrails already prevent leaking other customers' data.
- If the AI is unsure (low confidence), it still replies but flags the thread for a
  human — the inbound message stays **unread** in the CRM inbox. Staff can reply from
  the inbox and the visitor sees it (the widget polls history every 6 s).

## ⚠️ First: open the two public paths in Cloudflare Access

`mes.dhownhosiery.com` is protected by **Cloudflare Access (Zero Trust)** — every
request without a staff login is redirected to a Cloudflare login page. Customers must
NOT hit that. So the widget is a single self-contained page at **`/webchat`** (no SPA
assets), and only two paths need to be made public while the rest of MES stays locked:

- `mes.dhownhosiery.com/webchat`
- `mes.dhownhosiery.com/api/webchat`

**Steps (Cloudflare dashboard → Zero Trust → Access → Applications):**

1. **Add application → Self-hosted.**
2. Application domain: `mes.dhownhosiery.com`, path `webchat`. Add a second domain
   row: `mes.dhownhosiery.com` path `api/webchat`.
3. Add a policy: **Action = Bypass**, Include = **Everyone**. Save.

A path-scoped Bypass app takes precedence over the broad host app, so those two paths
become public and everything else keeps requiring the staff login. No API data is
exposed — every other `/api/*` route still needs a JWT (the web-chat endpoints are the
only public ones, and they only reach the customer AI).

Verify (should return the page / JSON, not a Cloudflare login redirect):

```bash
curl -sI https://mes.dhownhosiery.com/webchat
curl -s  https://mes.dhownhosiery.com/api/webchat/config
```

## Embed on your website

Paste this once, just before `</body>`. It injects a floating "Chat with us" bubble
that opens the widget in an iframe. Replace `MES_URL` with your public MES address
(e.g. the cloudflared URL or `https://mes.dhownhosiery.com`).

```html
<script>
(function () {
  var MES_URL = "https://mes.dhownhosiery.com"; // <-- your public MES URL
  var open = false, frame, btn;
  btn = document.createElement("button");
  btn.textContent = "Chat with us";
  btn.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#ffd400;color:#171200;border:none;border-radius:999px;padding:13px 20px;font:600 15px system-ui;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer";
  frame = document.createElement("iframe");
  frame.src = MES_URL + "/webchat";
  frame.style.cssText = "position:fixed;right:20px;bottom:80px;z-index:2147483647;width:380px;height:min(600px,80vh);max-width:calc(100vw - 40px);border:1px solid #2a2a31;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.4);display:none;background:#09090b";
  btn.onclick = function () {
    open = !open;
    frame.style.display = open ? "block" : "none";
    btn.textContent = open ? "Close chat" : "Chat with us";
  };
  document.body.appendChild(frame);
  document.body.appendChild(btn);
})();
</script>
```

For a mobile site, the iframe already caps to the viewport width/height.

## Where staff see it

`/whatsapp-inbox` — WEB threads appear alongside WhatsApp with a **WEB** badge and
"Website chat" instead of a phone number. Replying works normally; there is no 24-hour
window or template restriction on the web channel.
