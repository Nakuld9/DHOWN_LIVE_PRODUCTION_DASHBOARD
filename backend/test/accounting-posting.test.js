// Posting rules — GST split + sales-invoice -> balanced journal lines (pure).
const { gstSplit, salesInvoiceLines, computeDocument, documentVoucherLines } = require('../src/lib/accounting/posting-rules');
const { toPaise } = require('../src/lib/accounting/rules');

const SYS = { SALES: 's', OUTPUT_CGST: 'cc', OUTPUT_SGST: 'sc', OUTPUT_IGST: 'ic', ROUND_OFF: 'ro' };
const sum = (lines, k) => lines.reduce((a, l) => a + (toPaise(l[k]) || 0), 0);

describe('gstSplit', () => {
  test('intra splits equally, inter is all IGST', () => {
    expect(gstSplit(100000, 18, true)).toEqual({ cgst: 9000, sgst: 9000, igst: 0 });
    expect(gstSplit(100000, 18, false)).toEqual({ cgst: 0, sgst: 0, igst: 18000 });
  });
  test('odd paise remainder goes to SGST so cgst+sgst = total tax', () => {
    const r = gstSplit(50, 18, true); // 9 paise total
    expect(r.cgst + r.sgst).toBe(9);
    expect(r.cgst).toBe(4); expect(r.sgst).toBe(5);
  });
  test('zero rate', () => { expect(gstSplit(100000, 0, true)).toEqual({ cgst: 0, sgst: 0, igst: 0 }); });
});

describe('salesInvoiceLines', () => {
  const inv = (o) => ({ invoice_number: 'INV/1', taxable_value: '10000', cgst_amount: '0', sgst_amount: '0', igst_amount: '0', grand_total: '10000', round_off: '0', ...o });

  test('intra-state: Dr customer / Cr sales + CGST + SGST, balanced', () => {
    const l = salesInvoiceLines(inv({ cgst_amount: '900', sgst_amount: '900', grand_total: '11800' }), SYS, 'cust');
    expect(sum(l, 'dr_amount')).toBe(sum(l, 'cr_amount'));
    expect(l[0]).toMatchObject({ ledger_id: 'cust', dr_amount: '11800.00' });
    const cr = Object.fromEntries(l.filter((x) => x.cr_amount !== '0').map((x) => [x.ledger_id, x.cr_amount]));
    expect(cr).toEqual({ s: '10000.00', cc: '900.00', sc: '900.00' });
  });

  test('inter-state: only IGST', () => {
    const l = salesInvoiceLines(inv({ igst_amount: '1800', grand_total: '11800' }), SYS, 'cust');
    expect(sum(l, 'dr_amount')).toBe(sum(l, 'cr_amount'));
    expect(l.find((x) => x.ledger_id === 'ic').cr_amount).toBe('1800.00');
    expect(l.some((x) => x.ledger_id === 'cc')).toBe(false);
  });

  test('round-off up adds a credit to Round Off and still balances', () => {
    const l = salesInvoiceLines(inv({ igst_amount: '1800', grand_total: '11800.01', round_off: '0.01' }), SYS, 'cust');
    expect(sum(l, 'dr_amount')).toBe(sum(l, 'cr_amount'));
    expect(l.find((x) => x.ledger_id === 'ro')).toMatchObject({ cr_amount: '0.01', dr_amount: '0' });
  });

  test('round-off down adds a debit to Round Off and still balances', () => {
    const l = salesInvoiceLines(inv({ igst_amount: '1800', grand_total: '11799.99', round_off: '-0.01' }), SYS, 'cust');
    expect(sum(l, 'dr_amount')).toBe(sum(l, 'cr_amount'));
    expect(l.find((x) => x.ledger_id === 'ro')).toMatchObject({ dr_amount: '0.01', cr_amount: '0' });
  });

  test('no customer ledger throws; zero-value invoice throws', () => {
    expect(() => salesInvoiceLines(inv({ grand_total: '11800' }), SYS, null)).toThrow();
    expect(() => salesInvoiceLines(inv({ grand_total: '0', taxable_value: '0' }), SYS, 'cust')).toThrow();
  });
});

describe('computeDocument (GST engine)', () => {
  test('intra-state: qty*rate, 18% split, grand totals', () => {
    const d = computeDocument({ lines: [{ item_name: 'Fabric', quantity: 10, rate: '100', gst_rate: 18 }], intra: true });
    expect(d.totals.taxable).toBe('1000.00');
    expect(d.totals.cgst).toBe('90.00'); expect(d.totals.sgst).toBe('90.00'); expect(d.totals.igst).toBe('0.00');
    expect(d.totals.grand).toBe('1180.00');
    expect(d.items[0].line_total).toBe('1180.00');
  });
  test('inter-state puts all tax in IGST', () => {
    const d = computeDocument({ lines: [{ item_name: 'X', quantity: 2, rate: '500', gst_rate: 12 }], intra: false });
    expect(d.totals.igst).toBe('120.00'); expect(d.totals.cgst).toBe('0.00');
  });
  test('discount reduces the taxable value', () => {
    const d = computeDocument({ lines: [{ item_name: 'X', quantity: 1, rate: '1000', gst_rate: 5, discount_pct: 10 }], intra: true });
    expect(d.totals.taxable).toBe('900.00'); expect(d.totals.grand).toBe('945.00');
  });
  test('round-off to nearest rupee is recorded and balances the grand', () => {
    const d = computeDocument({ lines: [{ item_name: 'X', quantity: 3, rate: '33.33', gst_rate: 18 }], intra: true });
    // taxable 99.99, tax 18.00 (round(17.9982)), grand pre 117.99 -> 118.00, round_off 0.01
    expect(d.totals.round_off).toBe('0.01'); expect(d.totals.grand).toBe('118.00');
  });
  test('empty / zero-qty lines throw', () => {
    expect(() => computeDocument({ lines: [] })).toThrow();
    expect(() => computeDocument({ lines: [{ item_name: 'X', quantity: 0, rate: '1', gst_rate: 0 }] })).toThrow();
  });
});

describe('documentVoucherLines', () => {
  const totals = (over) => computeDocument({ lines: [{ item_name: 'X', quantity: 10, rate: '100', gst_rate: 18 }], intra: true, ...over }).totals;
  test('SALES: Dr party grand, Cr Sales + Output GST, balanced', () => {
    const L = documentVoucherLines('SALES', totals(), SYS, 'cust');
    expect(sum(L, 'dr_amount')).toBe(sum(L, 'cr_amount'));
    expect(L[0]).toMatchObject({ ledger_id: 'cust', dr_amount: '1180.00' });
    expect(L.find((x) => x.ledger_id === 's')).toMatchObject({ cr_amount: '1000.00' });
  });
  test('PURCHASE: Dr Purchase + Input GST, Cr party, balanced', () => {
    const L = documentVoucherLines('PURCHASE', totals(), { ...SYS, PURCHASE: 'pu', INPUT_CGST: 'ic2', INPUT_SGST: 'is2', INPUT_IGST: 'ig2' }, 'supp');
    expect(sum(L, 'dr_amount')).toBe(sum(L, 'cr_amount'));
    expect(L.find((x) => x.ledger_id === 'pu')).toMatchObject({ dr_amount: '1000.00' });
    expect(L.find((x) => x.ledger_id === 'supp')).toMatchObject({ cr_amount: '1180.00' });
  });
  test('SALES_RETURN flips the sale (party Cr)', () => {
    const L = documentVoucherLines('SALES_RETURN', totals(), SYS, 'cust');
    expect(sum(L, 'dr_amount')).toBe(sum(L, 'cr_amount'));
    expect(L[0]).toMatchObject({ ledger_id: 'cust', cr_amount: '1180.00' });
  });
  test('CREDIT_NOTE posts sale-side like a return: Dr Sales + Output GST, Cr Customer', () => {
    const L = documentVoucherLines('CREDIT_NOTE', totals(), SYS, 'cust');
    expect(sum(L, 'dr_amount')).toBe(sum(L, 'cr_amount'));
    expect(L.find((x) => x.ledger_id === 'cust')).toMatchObject({ cr_amount: '1180.00' });
    expect(L.find((x) => x.ledger_id === 's')).toMatchObject({ dr_amount: '1000.00' });
  });
  test('DEBIT_NOTE posts purchase-side like a return: Dr Supplier, Cr Purchase + Input GST', () => {
    const L = documentVoucherLines('DEBIT_NOTE', totals(), { ...SYS, PURCHASE: 'pu', INPUT_CGST: 'ic2', INPUT_SGST: 'is2', INPUT_IGST: 'ig2' }, 'supp');
    expect(sum(L, 'dr_amount')).toBe(sum(L, 'cr_amount'));
    expect(L.find((x) => x.ledger_id === 'supp')).toMatchObject({ dr_amount: '1180.00' });
    expect(L.find((x) => x.ledger_id === 'pu')).toMatchObject({ cr_amount: '1000.00' });
  });
});
