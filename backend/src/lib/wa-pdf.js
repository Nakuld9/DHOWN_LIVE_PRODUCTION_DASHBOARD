// Quotation PDF (§8) — renders an approved quote to a real PDF that can be sent
// on WhatsApp as a document. Figures are passed in from the quote row, which was
// computed by the shared computeTax; nothing is recalculated here.

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { MEDIA_DIR } = require('./wa-media');

const money = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPANY = require('../../config/tenant').name;
const ADDRESS = process.env.COMPANY_ADDRESS || '';
const GSTIN   = process.env.COMPANY_GSTIN || '';

// Writes <MEDIA_DIR>/quote_<no>.pdf and resolves with the file name.
function buildQuotePdf(q) {
  return new Promise((resolve, reject) => {
    const fileName = `quote_${String(q.quote_no || q.quote_id).replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`;
    const filePath = path.join(MEDIA_DIR, fileName);

    const doc = new PDFDocument({ margin: 44, size: 'A4' });
    const out = fs.createWriteStream(filePath);
    doc.pipe(out);

    // Header
    doc.fontSize(20).fillColor('#111').text(COMPANY, { align: 'center' });
    if (ADDRESS) doc.fontSize(9).fillColor('#555').text(ADDRESS, { align: 'center' });
    if (GSTIN)   doc.fontSize(9).fillColor('#555').text(`GSTIN: ${GSTIN}`, { align: 'center' });
    doc.moveDown(0.6);
    doc.fontSize(15).fillColor('#111').text('QUOTATION', { align: 'center' });
    doc.moveDown(0.8);

    // Meta
    const top = doc.y;
    doc.fontSize(10).fillColor('#111');
    doc.text(`Quotation No: ${q.quote_no || '-'}`, 44, top);
    doc.text(`Date: ${new Date(q.created_at || Date.now()).toLocaleDateString('en-GB').split('/').join('-')}`, 44, doc.y);
    doc.text(`To: ${q.customer_name || '-'}`, 320, top);
    if (q.payment_terms) doc.text(`Payment terms: ${q.payment_terms}`, 320, doc.y);
    doc.moveDown(1.2);

    // Line table
    const y = doc.y + 6;
    const cols = [44, 250, 320, 400, 480];
    doc.fontSize(9).fillColor('#555');
    ['DESCRIPTION', 'QTY (KG)', 'RATE', 'TAXABLE', 'GST %'].forEach((h, i) =>
      doc.text(h, cols[i], y, { width: (cols[i + 1] || 555) - cols[i] - 6 }));
    doc.moveTo(44, y + 14).lineTo(551, y + 14).strokeColor('#bbb').stroke();

    const desc = [q.product, q.shade, q.gsm ? `${q.gsm} GSM` : null].filter(Boolean).join(' / ') || '-';
    const ry = y + 22;
    doc.fontSize(10).fillColor('#111');
    doc.text(desc, cols[0], ry, { width: cols[1] - cols[0] - 6 });
    doc.text(String(Number(q.quantity_kg || 0)), cols[1], ry, { width: cols[2] - cols[1] - 6 });
    doc.text(money(q.rate), cols[2], ry, { width: cols[3] - cols[2] - 6 });
    doc.text(money(q.taxable_value), cols[3], ry, { width: cols[4] - cols[3] - 6 });
    doc.text(`${Number(q.gst_rate || 0)}%`, cols[4], ry);

    // Totals
    let ty = ry + 34;
    doc.moveTo(300, ty - 8).lineTo(551, ty - 8).strokeColor('#bbb').stroke();
    const line = (label, val, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10);
      doc.text(label, 320, ty, { width: 120 });
      doc.text(val, 440, ty, { width: 111, align: 'right' });
      ty += bold ? 20 : 16;
    };
    line('Taxable value', money(q.taxable_value));
    if (Number(q.igst_amount) > 0) {
      line(`IGST ${Number(q.gst_rate)}%`, money(q.igst_amount));
    } else {
      line(`CGST ${Number(q.gst_rate) / 2}%`, money(q.cgst_amount));
      line(`SGST ${Number(q.gst_rate) / 2}%`, money(q.sgst_amount));
    }
    if (Number(q.round_off)) line('Round off', money(q.round_off));
    line('TOTAL', money(q.grand_total), true);

    // Footer
    doc.font('Helvetica').fontSize(8).fillColor('#666');
    doc.text('This quotation is valid for 7 days and subject to stock availability at the time of order confirmation.',
      44, ty + 24, { width: 507 });
    if (q.notes) doc.text(`Note: ${q.notes}`, 44, doc.y + 4, { width: 507 });

    doc.end();
    out.on('finish', () => resolve(fileName));
    out.on('error', reject);
  });
}

module.exports = { buildQuotePdf };
