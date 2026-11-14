// Invoice OCR — deterministic unit tests. The model is mocked so these never call
// a live provider; they cover JSON salvage, field normalisation, and the guards.

const model = require('../src/ai/model');
const ocr = require('../src/lib/invoice-ocr');
const fs = require('fs');
const path = require('path');

describe('invoice-ocr', () => {
  const realChat = model.chat;
  afterEach(() => { model.chat = realChat; });

  test('firstJson salvages a JSON object from noisy/fenced model output', () => {
    expect(ocr._firstJson('blah ```json\n{"a":1,"b":{"c":2}}\n``` end')).toEqual({ a: 1, b: { c: 2 } });
    expect(ocr._firstJson('no json here')).toBeNull();
  });

  test('structure() normalises fields, coerces numbers, drops empty items', async () => {
    model.chat = async () => JSON.stringify({
      doc_type: 'INVOICE', supplier_name: '  ACME Yarns  ', supplier_gstin: '03AAA',
      invoice_no: 'INV-1', invoice_date: '12-08-2026', currency: 'INR',
      items: [
        { description: '30s Cotton', hsn: '5205', quantity: '500', unit: 'kg', rate: '248', amount: '124000' },
        { description: '', quantity: 5 },                 // dropped (no description)
        { description: 'Freight', quantity: null, rate: 'NA', amount: '500' }, // rate → null
      ],
      subtotal: '162000', tax_amount: 8100, total_amount: '170100',
    });
    const out = await ocr.structure('irrelevant text');
    expect(out.ok).toBe(true);
    expect(out.extracted.supplier_name).toBe('ACME Yarns');   // trimmed
    expect(out.extracted.items).toHaveLength(2);              // empty-description item dropped
    expect(out.extracted.items[0].quantity).toBe(500);        // string → number
    expect(out.extracted.items[1].rate).toBeNull();           // "NA" → null
    expect(out.extracted.total_amount).toBe(170100);
    expect(out.extracted.doc_type).toBe('INVOICE');
  });

  test('structure() reports a clean error when the model returns non-JSON', async () => {
    model.chat = async () => 'sorry, I could not read that';
    const out = await ocr.structure('x');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/could not parse/i);
  });

  test('parseInvoice rejects a non-PDF by magic bytes', async () => {
    const out = await ocr.parseInvoice(Buffer.from('hello world').toString('base64'));
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not look like a PDF/i);
  });

  test('parseInvoice rejects an empty file', async () => {
    const out = await ocr.parseInvoice('');
    expect(out.ok).toBe(false);
  });

  test('extractText pulls the text layer from a standard PDF', async () => {
    const sample = path.join(__dirname, '..', 'node_modules', 'pdf-parse', 'test', 'data', '04-valid.pdf');
    const { text, scanned, pages } = await ocr.extractText(fs.readFileSync(sample));
    expect(scanned).toBe(false);
    expect(pages).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(100);
  });
});
