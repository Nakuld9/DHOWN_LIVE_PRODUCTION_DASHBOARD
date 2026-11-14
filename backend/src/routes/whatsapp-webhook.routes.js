// WhatsApp Cloud API webhook — inbound events. Public (no app JWT): Meta
// authenticates the setup via the verify token below.
//
// This handler does exactly two things: persist the raw envelope, then ack.
// All processing happens in the queue worker (src/lib/wa-queue.js) via
// wa-processor. Meta treats a 200 as "delivered, never send again", so any work
// done after the ack is work a crash or deploy can lose permanently — which is
// precisely what used to happen here.
//
// Cloudflare note: this path must be BYPASSED on the Access app (like /m/roll)
// so Meta can reach it without the PIN gate.
const express = require('express');
const obs = require('../lib/observability');

module.exports = ({ queue }) => {
  const router = express.Router();
  const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN || '';

  // Verification handshake — Meta calls this once when you save the webhook.
  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && VERIFY && token === VERIFY) return res.status(200).send(challenge);
    return res.sendStatus(403);
  });

  router.post('/', async (req, res) => {
    try {
      // Persist BEFORE acking. If this throws we deliberately do NOT return 200,
      // so Meta redelivers instead of the message being lost.
      await queue.enqueue(req.body);
      res.sendStatus(200);
    } catch (e) {
      obs.log('error', 'wa.webhook.enqueue_failed', { error: e.message });
      return res.sendStatus(500);   // ask Meta to retry
    }

    // Nudge the worker so a quiet system still feels instant instead of waiting
    // for the next poll. Failures are irrelevant: the event is already durable.
    queue.drain().catch(() => {});
  });

  return router;
};
