// Payroll math — wages paid to workers.
const { computePay } = require('../src/lib/payroll-calc');

describe('payroll computePay', () => {
  test('DAILY: gross = days × rate', () => {
    expect(computePay({ wage_type: 'DAILY', wage_rate: 500, days_present: 26 }).gross).toBe(13000);
  });

  test('MONTHLY: gross = flat rate (days ignored)', () => {
    const r = computePay({ wage_type: 'MONTHLY', wage_rate: 15000, days_present: 20 });
    expect(r.gross).toBe(15000);
    expect(r.net).toBe(15000);
  });

  test('net = gross + overtime + bonus − deductions − advance', () => {
    const r = computePay({ wage_type: 'DAILY', wage_rate: 500, days_present: 26,
      overtime: 200, bonus: 500, deductions: 100, advance: 1000 });
    expect(r.gross).toBe(13000);
    expect(r.net).toBe(12600); // 13000 + 200 + 500 - 100 - 1000
  });

  test('advance larger than gross yields a negative net (dues carried)', () => {
    const r = computePay({ wage_type: 'DAILY', wage_rate: 500, days_present: 2, advance: 5000 });
    expect(r.gross).toBe(1000);
    expect(r.net).toBe(-4000);
  });

  test('zero rate → zero gross; bonus still applies', () => {
    expect(computePay({ wage_type: 'DAILY', wage_rate: 0, days_present: 26 }).gross).toBe(0);
    expect(computePay({ wage_type: 'DAILY', wage_rate: 0, days_present: 26, bonus: 500 }).net).toBe(500);
  });

  test('rounds to 2 decimals', () => {
    const r = computePay({ wage_type: 'DAILY', wage_rate: 480.755, days_present: 3 });
    expect(r.gross).toBe(1442.27); // 1442.265 -> 1442.27
  });

  test('missing fields default to 0 (no NaN)', () => {
    const r = computePay({ wage_type: 'DAILY', wage_rate: 500, days_present: 10 });
    expect(r.net).toBe(5000);
    expect(Number.isNaN(r.net)).toBe(false);
    expect(computePay({}).net).toBe(0);
  });
});
