// Local drop-folder pickup for bank statement files — H2H Phase A, READ-ONLY.
//
// For each bank account that has `inbox_dir` configured, this polls that folder on
// a timer, ingests any new statement file it finds (via bank-statement-files.js),
// and moves the file into a `processed/` or `error/` subfolder so it is never read
// twice and there is a physical trail of what came in.
//
// This is the credential-free half of H2H: you (or your bank's downloader) drop the
// daily file into the folder and it reconciles itself. The SFTP adapter — when the
// bank gives you host/keys — only has to fetch the file INTO this same folder; the
// ingestion below is unchanged. It reads money in; it never sends anything out.

const fs = require('fs');
const path = require('path');

const EXT_OK = /\.(txt|sta|mt940|940|xml|camt|csv|dat|xls|xlsx)$/i;
const EXT_BINARY = /\.(xls|xlsx)$/i;

module.exports = (pool, files, { log } = {}) => {
  const info = (...a) => (log ? log.info?.(...a) : console.log('[bank-inbox]', ...a));
  const warn = (...a) => (log ? log.warn?.(...a) : console.warn('[bank-inbox]', ...a));

  async function pollOnce() {
    let accounts;
    try {
      accounts = (await pool.query(
        `SELECT account_id, inbox_dir, statement_format FROM bank_accounts
          WHERE is_active = true AND inbox_dir IS NOT NULL AND inbox_dir <> ''`)).rows;
    } catch (e) { warn('cannot list inbox accounts:', e.message); return; }

    for (const a of accounts) {
      const dir = a.inbox_dir;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (e) { warn(`inbox unreadable for account ${a.account_id} (${dir}):`, e.message); continue; }

      const doneDir = path.join(dir, 'processed');
      const errDir = path.join(dir, 'error');
      for (const ent of entries) {
        if (!ent.isFile() || !EXT_OK.test(ent.name)) continue;
        const full = path.join(dir, ent.name);
        let content;
        // .xls/.xlsx are binary — read raw bytes; everything else is text.
        try { content = EXT_BINARY.test(ent.name) ? fs.readFileSync(full) : fs.readFileSync(full, 'utf8'); }
        catch (e) { warn(`cannot read ${full}:`, e.message); continue; }

        let out, ok = false;
        try {
          out = await files.ingest(a.account_id, content, {
            filename: ent.name, format: a.statement_format || null,
            source: 'FOLDER', autoMatch: true, by: 'bank-inbox',
          });
          ok = out && !out.error;
          if (out?.duplicate_file) info(`account ${a.account_id}: ${ent.name} already ingested — moving to processed`);
          else if (ok) info(`account ${a.account_id}: ${ent.name} -> ${out.inserted} new, ${out.auto_matched} auto-matched`);
          else warn(`account ${a.account_id}: ${ent.name} failed: ${out?.error}`);
        } catch (e) { warn(`ingest threw for ${ent.name}:`, e.message); }

        // A duplicate file is "done" (already in the book), so it is archived too.
        const target = (ok || out?.duplicate_file) ? doneDir : errDir;
        try {
          fs.mkdirSync(target, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          fs.renameSync(full, path.join(target, `${stamp}__${ent.name}`));
        } catch (e) { warn(`cannot move ${ent.name} to ${target}:`, e.message); }
      }
    }
  }

  // Poll every few minutes. Off entirely if no account ever configures an inbox.
  function start({ intervalMs = 5 * 60 * 1000 } = {}) {
    const tick = () => { pollOnce().catch((e) => warn('poll error:', e.message)); };
    setTimeout(tick, 20 * 1000);          // first sweep shortly after boot
    const h = setInterval(tick, intervalMs);
    if (h.unref) h.unref();               // never keep the process alive for this
    info(`statement drop-folder poller started (every ${Math.round(intervalMs / 1000)}s)`);
    return h;
  }

  return { start, pollOnce };
};
