// Bank statement FILE ingestion — Host-to-host (H2H) Phase A, READ-ONLY.
//
// This is the layer the existing bank-recon engine (bank-recon.js) deliberately
// left to "the caller": turning a bank's statement FILE into the normalised row
// shape importLines() expects — { txn_date, value_date, description, reference,
// debit, credit, balance } — and then importing + auto-matching it.
//
// It reads money IN. It never sends money, never holds a credential, never writes
// to the bank. The worst a bug here can do is mis-reconcile a receipt, which a
// human reviews. That is the whole reason Phase A is safe to automate.
//
// Three formats cover virtually every Indian H2H feed, parsed with zero external
// dependencies so the offline Windows deployment stays clean:
//   - MT940   : the SWIFT end-of-day statement (tag-based text).
//   - CAMT053 : ISO 20022 bank-to-customer statement (XML). Most banks' current H2H.
//   - CSV     : a plain delimited export, with a per-account column mapping.
//
// Each bank's exact spec differs in the margins; the parsers aim at the common
// core and are easy to extend once a real sample file is in hand.

const crypto = require('crypto');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clean = (s) => String(s == null ? '' : s).trim();

// ── Date helpers ────────────────────────────────────────────────────────────
// MT940 dates are YYMMDD. Everything downstream wants ISO (YYYY-MM-DD) so Postgres
// stores an unambiguous date rather than guessing day/month order.
function yymmdd(s, yearHint) {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(clean(s));
  if (!m) return null;
  let [, yy, mm, dd] = m;
  // A two-digit year is read into the current century; a value far in the future
  // (a Dec statement parsed in Jan) rolls back a year, as MT940 readers do.
  let yr = 2000 + Number(yy);
  if (yearHint && yr - yearHint > 50) yr -= 100;
  return `${yr}-${mm}-${dd}`;
}
function isoDate(s) {
  const t = clean(s);
  if (!t) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);          // YYYY-MM-DD
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(t);            // DD-MM-YYYY (Indian default)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})/.exec(t);        // 05-Oct-2026
  if (m) {
    const mo = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[m[2].toLowerCase()];
    if (mo) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
  }
  return null;
}
// Amounts in statements use ',' as the decimal separator (MT940/ISO) or as a
// thousands separator (Indian CSV: 1,00,000.00). Resolve by position of the dot.
function amount(s) {
  let t = clean(s).replace(/[^\d.,-]/g, '');
  if (!t) return 0;
  if (t.includes('.') && t.includes(',')) t = t.replace(/,/g, '');          // 1,00,000.00
  else if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');    // 1234,56  (MT940)
  const n = Number(t);
  return isFinite(n) ? Math.abs(n) : 0;
}
// A running balance is a POSITION, not a debit/credit, so its sign matters — a
// cash-credit / overdraft account legitimately runs negative. Unlike amount(),
// this keeps the sign.
function signedNum(s) {
  let t = clean(s).replace(/[^\d.,-]/g, '');
  if (!t) return null;
  const neg = t.startsWith('-');
  t = t.replace(/-/g, '');
  if (t.includes('.') && t.includes(',')) t = t.replace(/,/g, '');
  else if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
  const n = Number(t);
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

// ── MT940 (SWIFT end-of-day statement) ───────────────────────────────────────
// Statement lines are :61: (the transaction) optionally followed by :86: (free
// narrative). :61: layout: <valueYYMMDD><[entryMMDD]><D|C|RD|RC><amount><...>.
function parseMT940(text) {
  const rows = [];
  // Normalise line endings and join tags that wrap onto continuation lines.
  const raw = String(text).replace(/\r\n?/g, '\n');
  const blocks = raw.split(/\n(?=:\d{2}[A-Z]?:)/);  // split before each :NN: tag
  const yearHint = new Date().getFullYear();
  let cur = null;
  const push = () => { if (cur) { rows.push(cur); cur = null; } };

  for (const b of blocks) {
    const tagM = /^:(\d{2}[A-Z]?):([\s\S]*)$/.exec(b.trim());
    if (!tagM) continue;
    const tag = tagM[1];
    const val = tagM[2].replace(/\n/g, ' ').trim();
    if (tag === '61') {
      push();
      // 2601031 03 D 1234,56 N TRF ...   (value date, [entry date], mark, amount)
      const m = /^(\d{6})(\d{4})?(R?[DC])([\d.,]+)/.exec(val.replace(/\s+/g, ''));
      if (!m) continue;
      const valueDate = yymmdd(m[1], yearHint);
      const entryDate = m[2] ? yymmdd((m[1].slice(0, 2)) + m[2], yearHint) : valueDate;
      const isDebit = /D/.test(m[3]);
      const amt = amount(m[4]);
      // A reference often rides at the tail of :61: after the amount/type code.
      const refTail = clean(val.split(/\/\//)[1] || val.split(/N[A-Z]{3}/)[1] || '');
      cur = {
        txn_date: entryDate || valueDate, value_date: valueDate,
        description: '', reference: refTail.slice(0, 120),
        debit: isDebit ? amt : 0, credit: isDebit ? 0 : amt, balance: null,
      };
    } else if (tag === '86' && cur) {
      cur.description = clean(val).slice(0, 2000);
      // Pull a UTR / cheque / reference out of the narrative if :61: had none.
      if (!cur.reference) {
        const r = /\b([A-Z]{2,6}\d{6,})\b/.exec(val) || /\b(\d{10,})\b/.exec(val);
        if (r) cur.reference = r[1].slice(0, 120);
      }
    }
  }
  push();
  return rows;
}

// ── CAMT.053 (ISO 20022, XML) ────────────────────────────────────────────────
// A deliberately small, dependency-free reader: it walks <Ntry> entries and pulls
// the handful of fields reconciliation needs. It is not a general XML parser — it
// targets the well-defined camt.053 entry shape and ignores everything else.
function tagText(xml, name) {
  const m = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(xml);
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}
function parseCAMT053(text) {
  const xml = String(text);
  const rows = [];
  const entryRe = /<(?:\w+:)?Ntry\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Ntry>/gi;
  let e;
  while ((e = entryRe.exec(xml))) {
    const ntry = e[1];
    const amt = amount(tagText(ntry, 'Amt'));
    const cd = tagText(ntry, 'CdtDbtInd').toUpperCase();     // CRDT | DBIT
    const isDebit = cd === 'DBIT';
    const booking = isoDate(tagText(tagText(ntry, 'BookgDt'), 'Dt') || tagText(ntry, 'BookgDt'));
    const value = isoDate(tagText(tagText(ntry, 'ValDt'), 'Dt') || tagText(ntry, 'ValDt'));
    // Narrative: prefer structured remittance info, fall back to AddtlNtryInf.
    const info = tagText(ntry, 'Ustrd') || tagText(ntry, 'AddtlNtryInf') || tagText(ntry, 'RmtInf');
    const ref = tagText(ntry, 'AcctSvcrRef') || tagText(ntry, 'EndToEndId') || tagText(ntry, 'TxId') || tagText(ntry, 'Ref');
    if (!booking && !value) continue;
    rows.push({
      txn_date: booking || value, value_date: value || booking,
      description: clean(info).slice(0, 2000), reference: clean(ref).slice(0, 120),
      debit: isDebit ? amt : 0, credit: isDebit ? 0 : amt, balance: null,
    });
  }
  return rows;
}

// ── CSV (generic, per-account column mapping) ─────────────────────────────────
// A mapping names which header each field lives under, e.g.
//   { date:'Txn Date', value_date:'Value Date', description:'Narration',
//     reference:'Chq/Ref No', debit:'Withdrawal', credit:'Deposit',
//     balance:'Balance', amount:'Amount', dr_cr:'DR/CR' }
// Banks split debit/credit into two columns OR give one signed/typed amount; both
// are handled. Matching is case-insensitive and ignores spaces/punctuation.
function splitCSV(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// An Excel cell often carries a leading apostrophe (text marker) and banks use a
// bare "-" to mean "no reference". Neither is a real reference.
function cleanRef(s) {
  let t = clean(s).replace(/^'+/, '');
  if (t === '-' || t === '--' || t === 'NA' || t === 'N/A') t = '';
  return t;
}

// Shared core: a statement as a matrix of cells (rows of columns) -> normalised
// rows. Both the CSV text parser and the XLS/XLSX reader funnel through this, so a
// bank that gives a CSV one month and an .xls the next reconciles identically.
//
// The header row is found by SCORING, not by "first row that mentions a date" —
// Union Bank (and others) put a "Statement Date" line in the metadata block, which
// that naive rule would wrongly pick. The real header is the row that carries a
// date column AND an amount column (and usually a narration column) at once.
function matrixToRows(matrix, mapping) {
  mapping = mapping || {};
  if (!Array.isArray(matrix) || matrix.length < 2) return [];
  const DATEISH = ['date', 'txndate', 'transactiondate', 'bookingdate', 'valuedate'];
  const AMTISH = ['withdrawal', 'withdrawals', 'deposit', 'deposits', 'debit', 'credit', 'amount', 'dr', 'cr', 'withdrawalamt', 'depositamt'];
  const DESCISH = ['remarks', 'narration', 'description', 'particulars', 'details'];
  const score = (cells) => {
    const n = cells.map(norm);
    return (n.some((c) => DATEISH.includes(c)) ? 1 : 0)
         + (n.some((c) => AMTISH.includes(c)) ? 1 : 0)
         + (n.some((c) => DESCISH.includes(c)) ? 1 : 0);
  };
  let h = 0, best = -1;
  for (let i = 0; i < Math.min(matrix.length, 60); i++) {
    const s = score(matrix[i] || []);
    if (s > best) { best = s; h = i; }
    if (s >= 3) break;
  }
  if (best < 2) h = 0;                       // not a recognisable header → assume row 0
  const header = (matrix[h] || []).map(norm);
  const col = (key, fallbacks = []) => {
    const names = [mapping[key], ...fallbacks].filter(Boolean).map(norm);
    for (const n of names) { const idx = header.indexOf(n); if (idx >= 0) return idx; }
    return -1;
  };
  const ci = {
    date: col('date', ['date', 'txndate', 'transactiondate', 'bookingdate']),
    value_date: col('value_date', ['valuedate', 'valdate']),
    description: col('description', ['remarks', 'narration', 'description', 'particulars', 'details']),
    reference: col('reference', ['utrnumber', 'utr', 'chqrefno', 'refno', 'reference', 'chequeno', 'transactionid', 'tranid', 'instrid']),
    debit: col('debit', ['withdrawals', 'withdrawal', 'withdrawalamt', 'debit', 'debitamount', 'dr']),
    credit: col('credit', ['deposits', 'deposit', 'depositamt', 'credit', 'creditamount', 'cr']),
    balance: col('balance', ['balance', 'closingbalance', 'runningbalance']),
    amount: col('amount', ['amount', 'amt', 'transactionamount']),
    dr_cr: col('dr_cr', ['drcr', 'type', 'crdr', 'indicator']),
  };
  const rows = [];
  for (let i = h + 1; i < matrix.length; i++) {
    const c = matrix[i] || [];
    const at = (idx) => (idx >= 0 && idx < c.length ? c[idx] : '');
    const txn = isoDate(at(ci.date));
    if (!txn) continue;
    let debit = 0, credit = 0;
    if (ci.debit >= 0 || ci.credit >= 0) { debit = amount(at(ci.debit)); credit = amount(at(ci.credit)); }
    else if (ci.amount >= 0) {
      const a = amount(at(ci.amount));
      const sign = clean(at(ci.dr_cr)).toUpperCase();
      const isDebit = /^D|DR|DEBIT|WITHDRAW/.test(sign) || clean(at(ci.amount)).startsWith('-');
      if (isDebit) debit = a; else credit = a;
    }
    if (debit <= 0 && credit <= 0) continue;
    const description = clean(at(ci.description)).slice(0, 2000);
    let reference = cleanRef(at(ci.reference)).slice(0, 120);
    // The ref cell sometimes carries a label ("Sender No:BARBQ…") rather than a bare
    // UTR — pull the clean token out so it matches a receipt's stored reference.
    if (reference && /[:\s]/.test(reference)) {
      const rr = /\b([A-Z]{2,6}[A-Z0-9]{8,})\b/.exec(reference) || /\b(\d{12,})\b/.exec(reference);
      if (rr) reference = rr[1];
    }
    // No usable reference column value — lift a UTR/txn token out of the narrative,
    // which is where banks like Union actually print it (UTIBR…, SBINR…, IN42…).
    if (!reference && description) {
      const r = /\b([A-Z]{2,6}[A-Z0-9]{8,})\b/.exec(description) || /\b(\d{12,})\b/.exec(description);
      if (r) reference = r[1].slice(0, 120);
    }
    rows.push({
      txn_date: txn, value_date: isoDate(at(ci.value_date)) || txn,
      description, reference, debit, credit,
      balance: ci.balance >= 0 ? signedNum(at(ci.balance)) : null,
    });
  }
  return rows;
}

function parseCSV(text, mapping) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  return matrixToRows(lines.map(splitCSV), mapping || {});
}

// XLS (legacy BIFF) and XLSX, via SheetJS. exceljs (already a dependency) cannot
// read legacy .xls, which is exactly what Union Bank / ICICI / most Indian net
// banking exports as, so SheetJS carries this one. Lazy-required so the rest of the
// module still loads if the package is ever absent.
function parseXLS(buf, mapping) {
  let XLSX;
  try { XLSX = require('xlsx'); }
  catch { throw new Error('Cannot read .xls/.xlsx statements: the xlsx reader is not installed (npm install xlsx).'); }
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  return matrixToRows(matrix, mapping || {});
}

// ── Format dispatch + sniffing ────────────────────────────────────────────────
// Binary magic numbers: OLE2 (legacy .xls) and ZIP (.xlsx are zipped XML).
function sniffBinaryFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  const h = buf.slice(0, 4).toString('hex').toLowerCase();
  if (h.startsWith('d0cf11e0')) return 'XLS';
  if (h.startsWith('504b0304')) return 'XLSX';
  return null;
}
function sniffFormat(text) {
  const s = String(text).slice(0, 4000);
  if (/<(?:\w+:)?Document\b/i.test(s) && /camt\.053|<(?:\w+:)?Ntry\b/i.test(s)) return 'CAMT053';
  if (/^:20:/m.test(s) || /\n:61:/.test(s) || /\n:86:/.test(s)) return 'MT940';
  return 'CSV';
}
// Text-format dispatch only; binary .xls/.xlsx is handled in ingest() where the raw
// Buffer is still intact (utf8-decoding a BIFF file would destroy it).
function parseStatement(text, { format, csv_mapping } = {}) {
  const fmt = (format || sniffFormat(text) || 'CSV').toUpperCase();
  if (fmt === 'MT940') return { format: 'MT940', rows: parseMT940(text) };
  if (fmt === 'CAMT053' || fmt === 'CAMT.053' || fmt === 'XML') return { format: 'CAMT053', rows: parseCAMT053(text) };
  return { format: 'CSV', rows: parseCSV(text, csv_mapping || {}) };
}

// ── Orchestrator: file -> parse -> import -> (optional) auto-match -------------
module.exports = (pool, recon) => {
  // recon is the bank-recon.js module instance (importLines, autoMatch).

  async function account(accountId) {
    return (await pool.query(`SELECT * FROM bank_accounts WHERE account_id=$1`, [accountId])).rows[0] || null;
  }

  // Ingest one statement file (already in memory as text). Idempotent on content
  // hash per account, so re-dropping or re-uploading the same file does nothing.
  async function ingest(accountId, content, { filename = null, format = null, source = 'UPLOAD', autoMatch = true, days = 5, by = null } = {}) {
    const acct = await account(accountId);
    if (!acct) return { error: 'Bank account not found', code: 404 };

    // Resolve the format first, because it decides whether we keep raw bytes (an
    // .xls/.xlsx must NOT be utf8-decoded) or work with text.
    let fmt = (format || acct.statement_format || '').toUpperCase() || null;
    if (!fmt && filename) { const l = filename.toLowerCase(); if (l.endsWith('.xlsx')) fmt = 'XLSX'; else if (l.endsWith('.xls')) fmt = 'XLS'; }
    const isBuf = Buffer.isBuffer(content);
    if (!fmt && isBuf) fmt = sniffBinaryFormat(content);
    const binary = fmt === 'XLS' || fmt === 'XLSX';

    if (binary && !isBuf) return { error: 'An .xls/.xlsx statement must be sent as binary (base64), not text.', code: 400 };
    const text = binary ? null : (isBuf ? content.toString('utf8') : String(content || ''));
    if (!binary && !clean(text)) return { error: 'The statement file is empty', code: 400 };
    if (binary && (!content || !content.length)) return { error: 'The statement file is empty', code: 400 };

    const hashInput = binary ? content : Buffer.from(text, 'utf8');
    const content_hash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 64);

    // Already ingested this exact file?
    const prior = (await pool.query(
      `SELECT file_id, rows_new, duplicates, status FROM bank_statement_files WHERE account_id=$1 AND content_hash=$2`,
      [accountId, content_hash])).rows[0];
    if (prior) return { duplicate_file: true, file_id: Number(prior.file_id), ...prior, note: 'This exact file was already ingested.' };

    let parsed, imp, am = { matched: 0 }, status = 'OK', errMsg = null;
    try {
      parsed = binary
        ? { format: fmt, rows: parseXLS(content, acct.csv_mapping) }
        : parseStatement(text, { format: fmt, csv_mapping: acct.csv_mapping });
      if (!parsed.rows.length) { status = 'ERROR'; errMsg = `No statement lines could be read (format ${parsed.format}). Check the format / column mapping.`; }
      else {
        imp = await recon.importLines(accountId, parsed.rows, { by });
        if (imp.error) { status = 'ERROR'; errMsg = imp.error; }
        else if (autoMatch) am = await recon.autoMatch(accountId, { days, by });
      }
    } catch (e) { status = 'ERROR'; errMsg = e.message; }

    const rec = (await pool.query(
      `INSERT INTO bank_statement_files
         (account_id, filename, format, content_hash, source, rows_parsed, rows_new, duplicates, rejected, auto_matched, status, error, ingested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING file_id, ingested_at`,
      [accountId, filename, parsed?.format || fmt || null, content_hash, source,
       parsed?.rows.length || 0, imp?.inserted || 0, imp?.duplicates || 0,
       Array.isArray(imp?.rejected) ? imp.rejected.length : 0, am?.matched || 0,
       status, errMsg, by])).rows[0];

    if (status === 'ERROR') return { error: errMsg, code: 400, file_id: Number(rec.file_id), format: parsed?.format || fmt };
    return {
      ok: true, file_id: Number(rec.file_id), format: parsed.format,
      rows_parsed: parsed.rows.length, inserted: imp.inserted, duplicates: imp.duplicates,
      rejected: imp.rejected, auto_matched: am.matched, ambiguous: am.ambiguous,
      ingested_at: rec.ingested_at,
    };
  }

  async function recentFiles(accountId, { limit = 50 } = {}) {
    const r = await pool.query(
      `SELECT * FROM bank_statement_files WHERE account_id=$1 ORDER BY ingested_at DESC LIMIT $2`,
      [accountId, Math.min(limit, 200)]);
    return r.rows;
  }

  return { ingest, recentFiles, parseStatement, sniffFormat };
};

// Exposed for unit tests (pure parsers, no DB).
module.exports.parsers = { parseMT940, parseCAMT053, parseCSV, parseXLS, matrixToRows, parseStatement, sniffFormat, sniffBinaryFormat, isoDate, amount, cleanRef };
