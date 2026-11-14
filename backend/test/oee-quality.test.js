// OEE quality source selection — prefers real QC data over the configured target.
const { pickQuality } = require('../src/lib/machine');

const base = { totalInsp: 0, passedInsp: 0, totalRolls: 0, goodRolls: 0, qualityTarget: 95 };

describe('pickQuality', () => {
  test('tier 1: QC inspections win when present (good rolls / inspected rolls)', () => {
    expect(pickQuality({ ...base, totalInsp: 10, passedInsp: 9 })).toBe(90);
  });

  test('tier 1 takes precedence even when roll data also exists', () => {
    // inspections say 50%, rolls say 100% -> inspections used
    expect(pickQuality({ ...base, totalInsp: 4, passedInsp: 2, totalRolls: 5, goodRolls: 5 })).toBe(50);
  });

  test('tier 2: roll approve/reject used when no inspections', () => {
    expect(pickQuality({ ...base, totalRolls: 8, goodRolls: 6 })).toBe(75);
  });

  test('tier 3: configured target when no real data at all', () => {
    expect(pickQuality({ ...base, qualityTarget: 92 })).toBe(92);
  });

  test('all inspections passed -> 100%', () => {
    expect(pickQuality({ ...base, totalInsp: 7, passedInsp: 7 })).toBe(100);
  });

  test('all inspections failed -> 0%', () => {
    expect(pickQuality({ ...base, totalInsp: 3, passedInsp: 0 })).toBe(0);
  });

  test('rounds to 2 decimals', () => {
    expect(pickQuality({ ...base, totalInsp: 3, passedInsp: 1 })).toBe(33.33);
  });

  test('missing/zero target falls back to 0, never NaN', () => {
    const q = pickQuality({ totalInsp: 0, passedInsp: 0, totalRolls: 0, goodRolls: 0 });
    expect(q).toBe(0);
    expect(Number.isNaN(q)).toBe(false);
  });
});
