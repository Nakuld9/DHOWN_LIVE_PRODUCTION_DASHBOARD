// TDS deduction math — pure calc(), seeded against the FY 2026-27 defaults.
const tds = require('../src/lib/tds-sections');
const byCode = Object.fromEntries(tds.SEED.map((s) => [s.code, s]));

describe('calc — rate selection & thresholds', () => {
  test('194C std (individual) 1% over single threshold', () => {
    const r = tds.calc(byCode['194C'], { amount: 50000, variant: 'std' });
    expect(r.applicable).toBe(true);
    expect(r.rate_pct).toBe(1);
    expect(r.tds_amount).toBe(500);
    expect(r.net_payable).toBe(49500);
  });

  test('194C alt (company) 2%', () => {
    const r = tds.calc(byCode['194C'], { amount: 50000, variant: 'alt' });
    expect(r.rate_pct).toBe(2);
    expect(r.tds_amount).toBe(1000);
  });

  test('194C below single threshold → not applicable, zero TDS', () => {
    const r = tds.calc(byCode['194C'], { amount: 20000, variant: 'std' });
    expect(r.applicable).toBe(false);
    expect(r.tds_amount).toBe(0);
    expect(r.net_payable).toBe(20000);
  });

  test('194C FY aggregate trips it even when single payment is small', () => {
    const r = tds.calc(byCode['194C'], { amount: 20000, fy_prior: 90000, variant: 'std' });
    expect(r.over_aggregate).toBe(true);
    expect(r.applicable).toBe(true);
    expect(r.tds_amount).toBe(200); // 1% of the 20,000 paid now
  });
});

describe('calc — no-PAN (206AA)', () => {
  test('194C no-PAN → 20%', () => {
    const r = tds.calc(byCode['194C'], { amount: 50000, has_pan: false });
    expect(r.rate_pct).toBe(20);
    expect(r.tds_amount).toBe(10000);
    expect(r.variant).toMatch(/no-PAN/);
  });
  test('194Q no-PAN → 5%', () => {
    const r = tds.calc(byCode['194Q'], { amount: 6000000, has_pan: false });
    expect(r.rate_pct).toBe(5);
  });
});

describe('calc — 194Q deducts only on value exceeding ₹50L', () => {
  test('₹60L purchase → TDS on ₹10L at 0.1% = ₹1,000', () => {
    const r = tds.calc(byCode['194Q'], { amount: 6000000, variant: 'std' });
    expect(r.applicable).toBe(true);
    expect(r.dutiable_base).toBe(1000000);
    expect(r.tds_amount).toBe(1000);
  });
  test('below ₹50L → not applicable', () => {
    const r = tds.calc(byCode['194Q'], { amount: 4000000 });
    expect(r.applicable).toBe(false);
    expect(r.tds_amount).toBe(0);
  });
});

describe('calc — 194T (new, partner payments) 10% over ₹20,000', () => {
  test('₹1,00,000 remuneration → ₹10,000', () => {
    const r = tds.calc(byCode['194T'], { amount: 100000 });
    expect(r.rate_pct).toBe(10);
    expect(r.tds_amount).toBe(10000);
  });
});

describe('calc — rounding to the nearest rupee', () => {
  test('194H 2% of 20,001 = 400.02 → ₹400', () => {
    const r = tds.calc(byCode['194H'], { amount: 20001 });
    expect(r.tds_amount).toBe(400);
  });
});
