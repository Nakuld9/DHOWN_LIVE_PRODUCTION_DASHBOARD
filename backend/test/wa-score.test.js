// Lead scoring (§18) and the reorder trigger (§20).
const { scoreLead, reorderDue, PIPELINE } = require('../src/lib/wa-score');

describe('scoreLead', () => {
  test('a brand-new unknown contact is COLD, never HOT', () => {
    const s = scoreLead({});
    expect(s.points).toBe(0);
    expect(s.score).toBe('COLD');
  });

  test('big enquiry from a proven, recent, high-value buyer is HOT', () => {
    const s = scoreLead({
      requestedQty: 1200, ordersCount: 12, totalValue: 2500000,
      daysSinceLastOrder: 20, messagesIn: 12, quotesCount: 2,
    });
    expect(s.score).toBe('HOT');
    expect(s.points).toBeGreaterThanOrEqual(65);
  });

  test('a small one-off enquiry lands COLD or WARM, not HOT', () => {
    expect(scoreLead({ requestedQty: 50, messagesIn: 1 }).score).not.toBe('HOT');
  });

  test('overdue payment drags the score down', () => {
    const base = { requestedQty: 500, ordersCount: 5, totalValue: 600000, daysSinceLastOrder: 20, messagesIn: 5 };
    const clean = scoreLead(base);
    const owing = scoreLead({ ...base, overdueAmount: 250000 });
    expect(owing.points).toBe(clean.points - 15);
  });

  test('dormancy scores lower than recency', () => {
    const recent = scoreLead({ ordersCount: 5, daysSinceLastOrder: 15 });
    const stale = scoreLead({ ordersCount: 5, daysSinceLastOrder: 400 });
    expect(recent.points).toBeGreaterThan(stale.points);
  });

  test('points stay within 0..100 and never NaN', () => {
    const s = scoreLead({ requestedQty: 99999, ordersCount: 500, totalValue: 9e9,
      daysSinceLastOrder: 1, messagesIn: 999, quotesCount: 9 });
    expect(s.points).toBeLessThanOrEqual(100);
    expect(scoreLead({ overdueAmount: 1e9 }).points).toBe(0);
    expect(Number.isNaN(scoreLead({}).points)).toBe(false);
  });
});

describe('reorderDue', () => {
  test('needs at least two orders to judge a cycle', () => {
    expect(reorderDue({ avgGapDays: 30, daysSinceLastOrder: 90, ordersCount: 1 }).due).toBe(false);
  });

  test('flags when past 1.5x the customer own average gap', () => {
    const r = reorderDue({ avgGapDays: 30, daysSinceLastOrder: 46, ordersCount: 6 });
    expect(r.due).toBe(true);
    expect(r.threshold).toBe(45);
  });

  test('does not flag a customer still inside their normal cycle', () => {
    expect(reorderDue({ avgGapDays: 30, daysSinceLastOrder: 20, ordersCount: 6 }).due).toBe(false);
  });

  test('a slow buyer is not chased on a fast buyer schedule', () => {
    // 90-day cycle: 100 days is normal, not overdue
    expect(reorderDue({ avgGapDays: 90, daysSinceLastOrder: 100, ordersCount: 4 }).due).toBe(false);
    expect(reorderDue({ avgGapDays: 90, daysSinceLastOrder: 140, ordersCount: 4 }).due).toBe(true);
  });

  test('missing data never throws', () => {
    expect(reorderDue({}).due).toBe(false);
  });
});

test('pipeline has the stages from the spec, in order', () => {
  expect(PIPELINE[0]).toBe('New Lead');
  expect(PIPELINE).toContain('Quotation Sent');
  expect(PIPELINE).toContain('Order Confirmed');
  expect(PIPELINE[PIPELINE.length - 1]).toBe('Lost');
});
