// GST computation (tax invoices) — the money math that goes on customer bills.
const { computeTax } = require('../src/services/tax-invoices.service');

const line = (quantity, rate, gst_rate) => ({ item_name: 'X', quantity, rate, gst_rate });

describe('GST computeTax', () => {
  test('intra-state splits GST into equal CGST + SGST (no IGST)', () => {
    const { totals } = computeTax([line(100, 400, 5)], 'INTRA');
    expect(totals.taxable).toBe(40000);
    expect(totals.cgst).toBe(1000);   // 5% / 2
    expect(totals.sgst).toBe(1000);
    expect(totals.igst).toBe(0);
    expect(totals.tax).toBe(2000);
    expect(totals.grand).toBe(42000);
    expect(totals.round_off).toBe(0);
  });

  test('inter-state charges full IGST (no CGST/SGST)', () => {
    const { totals } = computeTax([line(100, 400, 5)], 'INTER');
    expect(totals.igst).toBe(2000);   // full 5%
    expect(totals.cgst).toBe(0);
    expect(totals.sgst).toBe(0);
    expect(totals.grand).toBe(42000);
  });

  test('intra and inter give the same grand total for the same goods', () => {
    const a = computeTax([line(100, 400, 5)], 'INTRA').totals.grand;
    const b = computeTax([line(100, 400, 5)], 'INTER').totals.grand;
    expect(a).toBe(b);
  });

  test('multiple lines with mixed rates sum correctly', () => {
    const { lines, totals } = computeTax(
      [line(10, 100, 5), line(5, 200, 12), line(2, 50, 18)], 'INTRA');
    // taxables: 1000, 1000, 100 -> 2100
    expect(totals.taxable).toBe(2100);
    // tax: 5% of 1000 = 50; 12% of 1000 = 120; 18% of 100 = 18 -> 188
    expect(totals.tax).toBe(188);
    expect(lines).toHaveLength(3);
    expect(lines[0].cgst_amount).toBe(25); // 5%/2 of 1000
    expect(lines[1].cgst_amount).toBe(60); // 12%/2 of 1000
  });

  test('0% GST yields zero tax', () => {
    const { totals } = computeTax([line(10, 100, 0)], 'INTRA');
    expect(totals.tax).toBe(0);
    expect(totals.grand).toBe(1000);
  });

  test('rounds the grand total and reports the round-off', () => {
    // 1 x 100.50 @ 5% intra: taxable 100.50, cgst 2.51, sgst 2.51, raw 105.52
    const { totals } = computeTax([line(1, 100.5, 5)], 'INTRA');
    expect(totals.taxable).toBe(100.5);
    expect(totals.cgst).toBe(2.51);
    expect(totals.grand).toBe(106);          // rounded up from 105.52
    expect(totals.round_off).toBe(0.48);
  });

  test('each line_total = taxable + its taxes', () => {
    const { lines } = computeTax([line(100, 400, 18)], 'INTER');
    expect(lines[0].line_total).toBe(lines[0].taxable_value + lines[0].igst_amount);
    expect(lines[0].igst_amount).toBe(7200); // 18% of 40000
  });

  test('empty / bad inputs do not crash and give zeros', () => {
    expect(computeTax([], 'INTRA').totals.grand).toBe(0);
    const { totals } = computeTax([line(undefined, null, 'x')], 'INTRA');
    expect(totals.taxable).toBe(0);
    expect(totals.tax).toBe(0);
  });
});
