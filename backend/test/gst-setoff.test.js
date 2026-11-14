// Statutory ITC set-off (Rule 88A) — pure.
const { computeSetOff } = require('../src/lib/gst-summary');

describe('computeSetOff', () => {
  test('IGST credit clears IGST then CGST then SGST', () => {
    const r = computeSetOff({ igst: 100, cgst: 100, sgst: 100 }, { igst: 250, cgst: 0, sgst: 0 });
    expect(r.payable_cash).toEqual({ igst: 0, cgst: 0, sgst: 50, total: 50 });
    expect(r.credit_carried_forward).toEqual({ igst: 0, cgst: 0, sgst: 0 });
  });
  test('CGST and SGST credit cannot offset each other', () => {
    const r = computeSetOff({ igst: 0, cgst: 0, sgst: 100 }, { igst: 0, cgst: 200, sgst: 0 });
    // CGST credit clears its own CGST (0) then IGST (0); SGST liability stays in cash.
    expect(r.payable_cash.sgst).toBe(100);
    expect(r.credit_carried_forward.cgst).toBe(200);
  });
  test('own-head credit first, remainder carried forward', () => {
    const r = computeSetOff({ igst: 0, cgst: 50, sgst: 50 }, { igst: 0, cgst: 80, sgst: 80 });
    expect(r.payable_cash.total).toBe(0);
    expect(r.credit_carried_forward).toEqual({ igst: 0, cgst: 30, sgst: 30 });
  });
  test('no credit → full liability in cash', () => {
    const r = computeSetOff({ igst: 10, cgst: 20, sgst: 20 }, { igst: 0, cgst: 0, sgst: 0 });
    expect(r.payable_cash.total).toBe(50);
  });
});
