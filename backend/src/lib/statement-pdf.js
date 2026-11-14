// Statement of account (PDF).
//
// The ledger already existed on screen. What was missing was the thing you can
// actually send a customer who says "we don't agree that we owe you that" — a
// dated document listing every invoice, receipt and credit note with a running
// balance, and the ageing that explains how much of it is overdue.
//
// Two decisions are worth stating because getting them wrong is how a statement
// starts an argument instead of settling one:
//
//   - The opening balance is real. A statement for a date range begins with
//     everything that happened before it, not at zero. A month statement that
//     opens at zero says the customer owes only this month's invoices.
//   - The closing balance is checked against v_partner_outstanding, the same
//     view the credit gate reads. If the two disagree the document says so on
//     its face rather than being sent out quietly wrong.
//
// Rendered with pdfkit in the same house style as the quotation PDF.

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { MEDIA_DIR } = require('./wa-media');

const COMPANY = require('../../config/tenant').name;
const ADDRESS = process.env.COMPANY_ADDRESS || '';
const GSTIN = process.env.COMPANY_GSTIN || '';

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : '');

const KIND_LABEL = { INVOICE: 'Invoice', PAYMENT: 'Receipt', CREDIT_NOTE: 'Credit note' };

// Writes <MEDIA_DIR>/statement_<partner>_<stamp>.pdf and resolves the file name.
// `st` is the object returned by payments.statement().
function buildStatementPdf(st) {
  return new Promise((resolve, reject) => {
    const safe = String(st.partner.company_name || st.partner.partner_id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
    const fileName = `statement_${safe}_${Date.now()}.pdf`;
    const filePath = path.join(MEDIA_DIR, fileName);

    const doc = new PDFDocument({ margin: 44, size: 'A4' });
    const out = fs.createWriteStream(filePath);
    doc.pipe(out);

    const L = 44, R = 551;

    // ── Header ──────────────────────────────────────────────────────────
    doc.fontSize(20).fillColor('#111').text(COMPANY, { align: 'center' });
    if (ADDRESS) doc.fontSize(9).fillColor('#555').text(ADDRESS, { align: 'center' });
    if (GSTIN) doc.fontSize(9).fillColor('#555').text(`GSTIN: ${GSTIN}`, { align: 'center' });
    doc.moveDown(0.6);
    doc.fontSize(15).fillColor('#111').text('STATEMENT OF ACCOUNT', { align: 'center' });
    doc.moveDown(0.8);

    // ── Customer and period ─────────────────────────────────────────────
    const top = doc.y;
    const p = st.partner;
    // Two columns side by side. Each has to be measured separately and the
    // table started below BOTH — doc.y after writing the right column knows
    // nothing about how far the left one ran. A customer with a two-line
    // address and a GSTIN overflowed straight through the table header.
    doc.fontSize(10).fillColor('#111').font('Helvetica-Bold').text(p.company_name || '-', L, top, { width: 250 });
    doc.font('Helvetica').fontSize(9).fillColor('#444');
    const addr = [p.line1, p.line2, [p.city, p.state].filter(Boolean).join(', '), p.pincode].filter(Boolean);
    addr.forEach(l => doc.text(l, L, doc.y, { width: 250 }));
    if (p.gstin) doc.text(`GSTIN: ${p.gstin}`, L, doc.y, { width: 250 });
    const leftBottom = doc.y;

    doc.fontSize(9).fillColor('#444');
    // An open-ended statement is the common case: "everything, as it stands".
    const period = st.from || st.to
      ? `${st.from ? day(st.from) : 'Beginning'} to ${st.to ? day(st.to) : day(new Date())}`
      : `All transactions to ${day(new Date())}`;
    doc.text(`Period: ${period}`, 320, top, { width: R - 320 });
    doc.text(`Printed: ${day(new Date())}`, 320, doc.y, { width: R - 320 });
    if (p.credit_days != null) doc.text(`Credit terms: ${p.credit_days} days`, 320, doc.y, { width: R - 320 });
    const rightBottom = doc.y;

    doc.y = Math.max(leftBottom, rightBottom) + 14;

    // ── Ledger table ────────────────────────────────────────────────────
    const cols = [L, 104, 210, 320, 400, 470];       // date, particulars, ref, debit, credit, balance
    const head = (y) => {
      doc.fontSize(8).fillColor('#555').font('Helvetica-Bold');
      ['DATE', 'PARTICULARS', 'REFERENCE', 'DEBIT', 'CREDIT', 'BALANCE'].forEach((h, i) => {
        const right = i >= 3;
        doc.text(h, cols[i], y, { width: (cols[i + 1] || R) - cols[i] - 6, align: right ? 'right' : 'left' });
      });
      doc.moveTo(L, y + 12).lineTo(R, y + 12).strokeColor('#bbb').stroke();
      doc.font('Helvetica');
      return y + 19;
    };

    let y = head(doc.y + 4);

    const row = (date, particulars, ref, debit, credit, balance, opts = {}) => {
      // Start a new page before running off the bottom, and repeat the header
      // so page two is readable on its own.
      if (y > 742) { doc.addPage(); y = head(54); }
      doc.fontSize(9).fillColor(opts.muted ? '#555' : '#111');
      if (opts.bold) doc.font('Helvetica-Bold');
      doc.text(date, cols[0], y, { width: cols[1] - cols[0] - 6 });
      doc.text(particulars, cols[1], y, { width: cols[2] - cols[1] - 6 });
      doc.text(ref, cols[2], y, { width: cols[3] - cols[2] - 6 });
      doc.text(debit, cols[3], y, { width: cols[4] - cols[3] - 6, align: 'right' });
      doc.text(credit, cols[4], y, { width: cols[5] - cols[4] - 6, align: 'right' });
      doc.text(balance, cols[5], y, { width: R - cols[5], align: 'right' });
      if (opts.bold) doc.font('Helvetica');
      y += opts.gap || 15;
    };

    row('', 'Opening balance', '', '', '', money(st.opening), { muted: true });

    for (const l of st.lines) {
      row(day(l.date), KIND_LABEL[l.kind] || l.kind, l.ref || '',
        l.debit ? money(l.debit) : '', l.credit ? money(l.credit) : '', money(l.balance));
    }

    if (!st.lines.length) {
      doc.fontSize(9).fillColor('#777').text('No transactions in this period.', L, y);
      y += 18;
    }

    doc.moveTo(L, y + 2).lineTo(R, y + 2).strokeColor('#bbb').stroke();
    y += 8;
    // A negative closing balance means we hold the customer's money, usually an
    // advance. Printing "-60,000.00" against "Closing balance" reads as a debt
    // with a typo, so say plainly which way it points.
    const inCredit = st.closing < -0.009;
    row('', inCredit ? 'Balance in your favour' : 'Closing balance', '', '', '',
      money(Math.abs(st.closing)), { bold: true, gap: 22 });

    // ── Ageing ──────────────────────────────────────────────────────────
    // Only meaningful for a statement that runs to today; a historical range
    // has no bearing on how overdue the balance is now.
    if (st.ageing && st.reconciles !== false) {
      doc.fontSize(10).fillColor('#111').font('Helvetica-Bold').text('Ageing of outstanding', L, y);
      doc.font('Helvetica');
      y += 16;
      const ac = [L, 145, 245, 345, 445];
      const labels = ['Not yet due', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];
      const vals = [st.ageing.current, st.ageing.d1_30, st.ageing.d31_60, st.ageing.d61_90, st.ageing.d90_plus];
      doc.fontSize(8).fillColor('#555');
      labels.forEach((l, i) => doc.text(l, ac[i], y, { width: 96 }));
      y += 12;
      doc.fontSize(10).fillColor('#111');
      vals.forEach((v, i) => doc.text(money(v), ac[i], y, { width: 96 }));
      y += 24;
    }

    // ── Reconciliation notice ───────────────────────────────────────────
    // If the running balance and the outstanding view disagree, say so on the
    // document. Sending a statement that quietly contradicts our own books is
    // worse than sending one that admits the discrepancy.
    if (st.reconciles === false) {
      // Deliberately does not quote `outstanding` as "the account balance" —
      // the two differ legitimately whenever a customer holds advance credit,
      // so naming a second figure here would invite an argument about the wrong
      // number. What is actually wrong is that the books do not tie out.
      doc.fontSize(9).fillColor('#b45309').font('Helvetica-Bold');
      doc.text('Note: this statement could not be reconciled against our accounts ledger. Please contact us before acting on it.',
        L, y, { width: R - L });
      doc.font('Helvetica');
      y = doc.y + 10;
    }

    // ── Footer ──────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor('#666');
    doc.text('All amounts in INR. Please quote the invoice number when making payment. Errors and omissions excepted.',
      L, Math.max(y + 6, 760), { width: R - L });
    doc.text('If you believe any entry above is incorrect, contact us within 7 days of the date of this statement.',
      L, doc.y + 2, { width: R - L });

    doc.end();
    out.on('finish', () => resolve(fileName));
    out.on('error', reject);
  });
}

module.exports = { buildStatementPdf };
