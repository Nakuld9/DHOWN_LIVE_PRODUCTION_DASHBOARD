// Credit note (PDF).
//
// The list existed; the document did not. A credit note is what the customer
// files against the invoice it reverses, and their accounts department will ask
// for it by number. Without one, "we've credited you" is an assertion.
//
// Same house style as the quotation and statement PDFs.

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { MEDIA_DIR } = require('./wa-media');

const COMPANY = require('../../config/tenant').name;
const ADDRESS = process.env.COMPANY_ADDRESS || '';
const GSTIN = process.env.COMPANY_GSTIN || '';

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB').split('/').join('-') : '');

function buildCreditNotePdf(n) {
  return new Promise((resolve, reject) => {
    const safe = String(n.note_number || n.note_id).replace(/[^A-Za-z0-9_-]/g, '_');
    const fileName = `credit_note_${safe}.pdf`;
    const filePath = path.join(MEDIA_DIR, fileName);

    const doc = new PDFDocument({ margin: 44, size: 'A4' });
    const out = fs.createWriteStream(filePath);
    doc.pipe(out);

    const L = 44, R = 551;

    doc.fontSize(20).fillColor('#111').text(COMPANY, { align: 'center' });
    if (ADDRESS) doc.fontSize(9).fillColor('#555').text(ADDRESS, { align: 'center' });
    if (GSTIN) doc.fontSize(9).fillColor('#555').text(`GSTIN: ${GSTIN}`, { align: 'center' });
    doc.moveDown(0.6);
    doc.fontSize(15).fillColor('#111').text('CREDIT NOTE', { align: 'center' });
    doc.moveDown(0.8);

    // Two columns, measured separately so a long address cannot run through the
    // table below — the same bug the statement PDF had.
    const top = doc.y;
    doc.fontSize(10).fillColor('#111').font('Helvetica-Bold').text(n.company_name || '-', L, top, { width: 250 });
    doc.font('Helvetica').fontSize(9).fillColor('#444');
    if (n.gstin) doc.text(`GSTIN: ${n.gstin}`, L, doc.y, { width: 250 });
    const leftBottom = doc.y;

    doc.fontSize(9).fillColor('#444');
    doc.text(`Credit note: ${n.note_number || '-'}`, 320, top, { width: R - 320 });
    doc.text(`Date: ${day(n.note_date)}`, 320, doc.y, { width: R - 320 });
    if (n.invoice_number) doc.text(`Against invoice: ${n.invoice_number}`, 320, doc.y, { width: R - 320 });
    if (n.return_number) doc.text(`Sales return: ${n.return_number}`, 320, doc.y, { width: R - 320 });
    const rightBottom = doc.y;

    doc.y = Math.max(leftBottom, rightBottom) + 16;

    if (n.reason) {
      doc.fontSize(10).fillColor('#111').text(`Reason: ${String(n.reason).replace(/_/g, ' ').toLowerCase()}`, L);
      doc.moveDown(0.6);
    }

    // Figures. Taxable and tax are carried from the note itself — nothing is
    // recomputed here, so the document cannot disagree with the ledger.
    let y = doc.y + 8;
    doc.moveTo(300, y - 8).lineTo(R, y - 8).strokeColor('#bbb').stroke();
    const line = (labelText, val, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10).fillColor('#111');
      doc.text(labelText, 320, y, { width: 120 });
      doc.text(val, 440, y, { width: 111, align: 'right' });
      y += bold ? 20 : 16;
    };
    line('Taxable value', money(n.taxable_value));
    line('Tax', money(n.tax_amount));
    line('TOTAL CREDIT', money(n.amount), true);

    doc.font('Helvetica').fontSize(8).fillColor('#666');
    doc.text('This credit note reduces the amount payable on the invoice named above. Please adjust it against that invoice.',
      L, Math.max(y + 24, 740), { width: R - L });
    if (n.status && String(n.status).toUpperCase() === 'CANCELLED') {
      doc.fontSize(13).fillColor('#b91c1c').font('Helvetica-Bold')
        .text('CANCELLED', L, doc.y + 10, { width: R - L, align: 'center' });
    }

    doc.end();
    out.on('finish', () => resolve(fileName));
    out.on('error', reject);
  });
}

module.exports = { buildCreditNotePdf };
