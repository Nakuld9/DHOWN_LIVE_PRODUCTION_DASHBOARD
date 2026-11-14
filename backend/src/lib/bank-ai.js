// Bank reconciliation AI (spec §7) — Phase 0, manual statement upload.
//
// Takes bank transactions (parsed from an uploaded CSV/statement) and, for each
// CREDIT (money in), tries to identify the customer and the open invoice(s) it
// settles — from MES data. It SUGGESTS a reconciliation; it never posts, never
// allocates money, never touches Busy. A human confirms.
//
// Classification per transaction: matched | partial | unmatched | duplicate |
// suspicious. Below the confidence threshold → flagged for human confirmation.
//
// True bank-vs-ledger matching against Busy's cash/bank ledger arrives with the
// Busy read bridge (Phase 1); this matches against MES receivables in the meantime.

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d) => { const n = parseFloat(process.env[v]); return Number.isFinite(n) ? n : d; };
const CONFIDENCE_MIN = num('BANK_MATCH_CONFIDENCE_MIN', 0.6);
const AMOUNT_TOL = num('BANK_MATCH_AMOUNT_TOL', 1.0);   // ₹ tolerance for "equal"

const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Parse a bank-statement CSV. Tolerant of common layouts: it finds the date,
// description, and amount columns by header name, and treats a single signed
// "amount" column or separate debit/credit columns.
function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  // Proper CSV field split: honours quotes and keeps empty (incl. trailing) fields.
  const split = (l) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  const header = split(lines[0]).map(h => h.toLowerCase());
  // Exact header match first; then substring — but only for tokens ≥4 chars, so a
  // short abbreviation like "cr" can't accidentally match inside "description".
  const col = (...names) => {
    let i = header.findIndex(h => names.includes(h));
    if (i >= 0) return i;
    return header.findIndex(h => names.some(n => n.length >= 4 && h.includes(n)));
  };
  const iDate = col('date', 'txn date', 'value date');
  const iDesc = col('description', 'narration', 'particulars', 'details', 'remarks');
  const iAmt = col('amount');
  const iCr = col('credit', 'deposit', 'cr');
  const iDr = col('debit', 'withdrawal', 'dr');
  const iRef = col('ref', 'cheque', 'utr', 'transaction id');
  const n = (v) => Number(String(v || '').replace(/[₹,\s]/g, '')) || 0;

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = split(lines[i]);
    if (!c.length) continue;
    let amount = 0, direction = 'credit';
    if (iCr >= 0 || iDr >= 0) {
      const cr = n(c[iCr]), dr = n(c[iDr]);
      if (cr > 0) { amount = cr; direction = 'credit'; }
      else if (dr > 0) { amount = dr; direction = 'debit'; }
    } else if (iAmt >= 0) {
      const a = n(c[iAmt]); amount = Math.abs(a); direction = a < 0 ? 'debit' : 'credit';
    }
    if (!amount) continue;
    out.push({
      row: i, date: iDate >= 0 ? c[iDate] : null,
      description: iDesc >= 0 ? c[iDesc] : (c[1] || ''),
      ref: iRef >= 0 ? c[iRef] : null, amount: r2(amount), direction,
    });
  }
  return out;
}

// Bank-statement extraction prompt for the model gateway (PDF text / photo).
const BANK_SYS = [
  'You extract transactions from a bank statement. Return ONLY a JSON object, no prose, no code fences.',
  'Shape: { "transactions": [ { "date": string|null, "description": string, "amount": number, "direction": "credit"|"debit", "ref": string|null } ] }',
  'Rules: amount is a plain positive number (no symbols/commas). direction is "credit" for money IN (deposit) and "debit" for money OUT (withdrawal). Keep the narration verbatim in description. Never invent a row that is not in the statement.',
].join('\n');

module.exports = (pool, { payments } = {}) => {
  const pay = payments || require('./payments')(pool);
  const audit = require('./audit')(pool);
  const model = require('../ai/model');
  const ocr = require('./invoice-ocr');

  // Pull the first balanced JSON object from a model reply.
  function firstJson(s) {
    const t = String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json/gi, '').replace(/```/g, '');
    const a = t.indexOf('{'); if (a < 0) return null;
    let depth = 0, open = -1;
    for (let i = a; i < t.length; i++) {
      if (t[i] === '{') { if (depth === 0) open = i; depth++; }
      else if (t[i] === '}') { depth--; if (depth === 0) { try { return JSON.parse(t.slice(open, i + 1)); } catch { /* keep scanning */ } } }
    }
    return null;
  }

  const shapeTxns = (j) => {
    const arr = Array.isArray(j?.transactions) ? j.transactions : [];
    return arr.map((t, i) => ({
      row: i + 1, date: t.date ? String(t.date).trim() : null,
      description: String(t.description || '').trim(),
      ref: t.ref ? String(t.ref).trim() : null,
      amount: r2(Math.abs(Number(t.amount) || 0)),
      direction: t.direction === 'debit' ? 'debit' : 'credit',
    })).filter(t => t.amount > 0);
  };

  // Extract transactions from a digital-PDF text layer.
  async function extractFromPdf(base64) {
    const buffer = Buffer.from(String(base64 || ''), 'base64');
    if (buffer.slice(0, 4).toString('latin1') !== '%PDF') return { ok: false, error: 'That does not look like a PDF file.' };
    const { text, scanned } = await ocr.extractText(buffer);
    if (scanned) return { ok: false, scanned: true, error: 'Scanned (image-only) PDF — upload a photo of the statement instead so vision OCR can read it.' };
    const reply = await model.chat(BANK_SYS, text.slice(0, 14000), { task: 'reasoning' });
    return { ok: true, transactions: shapeTxns(firstJson(reply)) };
  }

  // Extract transactions from a photographed statement (vision).
  async function extractFromImage(base64, mime) {
    const m = (mime && String(mime)) || 'image/jpeg';
    if (!/^image\/(jpeg|png|webp)$/.test(m)) return { ok: false, error: 'Upload a JPG, PNG or WEBP photo.' };
    const reply = await model.visionChat(BANK_SYS, 'Extract every transaction from this bank statement image. Return ONLY the JSON object.', `data:${m};base64,${base64}`);
    return { ok: true, transactions: shapeTxns(firstJson(reply)) };
  }

  // Find the best customer for a description by token overlap with party names.
  async function matchParty(description) {
    const toks = clean(description).split(' ').filter(t => t.length > 2);
    if (!toks.length) return null;
    const parts = (await pool.query(
      `SELECT partner_id, company_name, short_name FROM partners WHERE COALESCE(is_active,true) = true`)).rows;
    let best = null, bestScore = 0;
    for (const p of parts) {
      const name = clean(`${p.company_name} ${p.short_name || ''}`);
      const nameToks = new Set(name.split(' ').filter(t => t.length > 2));
      let hit = 0;
      for (const t of toks) if (nameToks.has(t)) hit++;
      const score = hit / Math.max(1, nameToks.size);
      if (hit > 0 && score > bestScore) { bestScore = score; best = { ...p, score: r2(score), hits: hit }; }
    }
    return best;
  }

  async function reconcile({ transactions, csv, by } = {}) {
    const txns = transactions && transactions.length ? transactions : parseCsv(csv);
    const credits = txns.filter(t => t.direction === 'credit');

    // Duplicate credits within the batch (same amount + same date) — flag, don't merge.
    const seen = new Map();
    for (const t of credits) {
      const k = `${t.amount}|${t.date}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }

    const results = [];
    for (const t of credits) {
      const dupInBatch = seen.get(`${t.amount}|${t.date}`) > 1;
      const party = await matchParty(t.description);
      if (!party) {
        results.push({ ...t, status: dupInBatch ? 'suspicious' : 'unmatched', confidence: 0,
          note: 'No customer identified from the description — needs manual mapping.' });
        continue;
      }
      const open = await pay.openInvoices(party.partner_id);
      // Try to settle: an exact single-invoice match, else a subset that sums to the amount.
      const exact = open.find(inv => Math.abs(inv.balance - t.amount) <= AMOUNT_TOL);
      let matchKind = 'unmatched', invoices = [], confidence = party.score * 0.5;
      if (exact) {
        matchKind = 'matched'; invoices = [exact]; confidence = Math.min(1, 0.6 + party.score * 0.4);
      } else if (open.length) {
        // Greedy oldest-first fill up to the amount → partial/collective match.
        let acc = 0; const picked = [];
        for (const inv of open) { if (acc >= t.amount - AMOUNT_TOL) break; picked.push(inv); acc = r2(acc + inv.balance); }
        if (picked.length && Math.abs(acc - t.amount) <= AMOUNT_TOL) {
          matchKind = 'matched'; invoices = picked; confidence = Math.min(1, 0.55 + party.score * 0.35);
        } else if (picked.length) {
          matchKind = 'partial'; invoices = picked; confidence = Math.min(0.6, 0.3 + party.score * 0.3);
        }
      }
      results.push({
        ...t, status: dupInBatch ? 'suspicious' : matchKind,
        confidence: r2(confidence),
        needs_confirmation: confidence < CONFIDENCE_MIN,
        party: { partner_id: party.partner_id, company_name: party.company_name, name_score: party.score },
        suggested_invoices: invoices.map(i => ({ invoice_number: i.invoice_number, balance: i.balance, days_overdue: i.days_overdue })),
        note: dupInBatch ? 'Same amount and date appears more than once in this statement — check for a double credit.'
          : matchKind === 'matched' ? 'Suggested settlement — confirm before allocating.'
          : matchKind === 'partial' ? 'Partial/collective match — review which invoices this settles.'
          : 'Customer identified but no invoice matches the amount — manual review.',
      });
    }

    const by_status = results.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {});
    const summary = {
      transactions: txns.length, credits: credits.length, debits: txns.length - credits.length,
      by_status, total_credit: r2(credits.reduce((s, t) => s + t.amount, 0)),
      note: 'AI suggestions from MES receivables. Nothing has been allocated or posted — a human must confirm each match. Debits and bank/cash-ledger matching need the Busy bridge.',
    };

    await audit.record({
      actor: by || null, agent: 'accountant', action: 'RECONCILE_BANK_STATEMENT',
      entity_type: 'bank_statement', reason: `Reconciled ${credits.length} credit(s): ${JSON.stringify(by_status)}`,
      after: summary, status: 'AI_RECOMMENDED',
    });

    return { summary, results };
  }

  return { parseCsv, reconcile, extractFromPdf, extractFromImage };
};
