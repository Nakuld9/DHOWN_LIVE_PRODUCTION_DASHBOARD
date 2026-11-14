// Margin arithmetic (HIGH-12). A wrong margin is worse than no margin: it lets
// a manager approve a below-cost sale believing it is profitable.
const { marginPct, marginBand } = require('../src/lib/wa-margin');

describe('marginPct — margin on selling price', () => {
  test('standard case', () => {
    expect(marginPct(285, 268)).toBe(5.96);   // (285-268)/285
  });

  test('is measured on price, not on cost — the two differ and mixing them hides losses', () => {
    // markup on cost would be (300-200)/200 = 50%; margin on price is 33.33%
    expect(marginPct(300, 200)).toBe(33.33);
  });

  test('selling below cost is negative, never clamped to zero', () => {
    expect(marginPct(260, 268)).toBeCloseTo(-3.08, 2);
  });

  test('selling at cost is exactly zero', () => {
    expect(marginPct(268, 268)).toBe(0);
  });

  test('unknown cost yields null, NOT 100% — the dangerous default', () => {
    expect(marginPct(285, null)).toBeNull();
    expect(marginPct(285, 0)).toBeNull();
    expect(marginPct(285, undefined)).toBeNull();
  });

  test('missing or nonsense rate yields null rather than a number', () => {
    expect(marginPct(0, 268)).toBeNull();
    expect(marginPct(null, 268)).toBeNull();
    expect(marginPct('abc', 268)).toBeNull();
  });
});

describe('marginBand', () => {
  test('below cost is flagged regardless of how small the loss is', () => {
    expect(marginBand(-0.1)).toBe('BELOW_COST');
  });

  test('under the floor is THIN', () => {
    expect(marginBand(5.96, 8)).toBe('THIN');
    expect(marginBand(0, 8)).toBe('THIN');
  });

  test('at or above the floor is OK', () => {
    expect(marginBand(8, 8)).toBe('OK');
    expect(marginBand(25, 8)).toBe('OK');
  });

  test('an unknown margin is UNKNOWN, never OK', () => {
    expect(marginBand(null)).toBe('UNKNOWN');
  });

  test('the floor is configurable', () => {
    expect(marginBand(10, 15)).toBe('THIN');
    expect(marginBand(10, 5)).toBe('OK');
  });
});
