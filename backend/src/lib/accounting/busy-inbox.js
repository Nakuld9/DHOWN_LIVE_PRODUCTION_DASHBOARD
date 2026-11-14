// Busy read-bridge drop-folder poller — Phase 1, READ-ONLY (mirrors the Bank H2H
// drop-folder pattern in src/lib/bank-statement-inbox.js).
//
// The Windows extractor (tools/busy-bridge/extract-busy.ps1) drops a
// `busy-extract_*.json` into BUSY_INBOX_DIR. This polls that folder, ingests each
// new extract into the acct Busy mirror (reconciling to Busy's TB), and moves the
// file into processed/ or error/ so it is never read twice and there is a trail.
//
// It only reads JSON a trusted local extractor produced; it never writes to Busy.
const fs = require('fs');
const path = require('path');

module.exports = (pool, { log } = {}) => {
  const info = (...a) => (log ? log.info?.(...a) : console.log('[busy-inbox]', ...a));
  const warn = (...a) => (log ? log.warn?.(...a) : console.warn('[busy-inbox]', ...a));
  const mirror = require('./busy-mirror')(pool);

  function inboxDir() {
    return (process.env.BUSY_INBOX_DIR || '').trim();
  }

  async function pollOnce() {
    const dir = inboxDir();
    if (!dir) return;                       // off until an inbox is configured
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { warn(`inbox unreadable (${dir}):`, e.message); return; }

    const doneDir = path.join(dir, 'processed');
    const errDir = path.join(dir, 'error');
    for (const ent of entries) {
      if (!ent.isFile() || !/\.json$/i.test(ent.name)) continue;
      const full = path.join(dir, ent.name);
      let ok = false;
      try {
        // Windows PowerShell writes UTF-8 with a BOM; strip it before parsing.
        const extract = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, ''));
        const out = await mirror.importExtract(extract, { filename: ent.name }, { username: 'busy-inbox' });
        ok = true;
        if (out.duplicate) info(`${ent.name}: already ingested — archiving`);
        else info(`${ent.name}: import ${out.import_id} — ${out.masters} masters, ${out.trial_balance} TB rows, reconciled_ok=${out.reconciliation.ok}`);
      } catch (e) { warn(`${ent.name} failed:`, e.message); }

      const target = ok ? doneDir : errDir;
      try {
        fs.mkdirSync(target, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.renameSync(full, path.join(target, `${stamp}__${ent.name}`));
      } catch (e) { warn(`cannot move ${ent.name} to ${target}:`, e.message); }
    }
  }

  function start({ intervalMs = 5 * 60 * 1000 } = {}) {
    if (!inboxDir()) { info('no BUSY_INBOX_DIR set — poller idle'); return null; }
    const tick = () => { pollOnce().catch((e) => warn('poll error:', e.message)); };
    setTimeout(tick, 25 * 1000);
    const h = setInterval(tick, intervalMs);
    if (h.unref) h.unref();
    info(`Busy drop-folder poller started on ${inboxDir()} (every ${Math.round(intervalMs / 1000)}s)`);
    return h;
  }

  return { start, pollOnce };
};
