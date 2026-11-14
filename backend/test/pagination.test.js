// Shared list pagination helper.
const { parsePage, pageEnvelope } = require('../src/lib/pagination');

describe('parsePage', () => {
  test('returns null when ?page is absent (legacy full-array signal)', () => {
    expect(parsePage({})).toBeNull();
    expect(parsePage({ limit: '20' })).toBeNull();
    expect(parsePage({ page: '' })).toBeNull();
  });

  test('page 1 -> offset 0', () => {
    expect(parsePage({ page: '1' })).toEqual({ page: 1, limit: 50, offset: 0 });
  });

  test('offset = (page - 1) * limit', () => {
    expect(parsePage({ page: '3', limit: '25' })).toEqual({ page: 3, limit: 25, offset: 50 });
  });

  test('limit is clamped to maxLimit', () => {
    expect(parsePage({ page: '1', limit: '9999' }, { maxLimit: 200 }).limit).toBe(200);
  });

  test('invalid limit (0 / non-numeric) falls back to the default', () => {
    expect(parsePage({ page: '1', limit: '0' }).limit).toBe(50);
    expect(parsePage({ page: '1', limit: 'abc' }).limit).toBe(50);
  });

  test('negative limit floors to 1', () => {
    expect(parsePage({ page: '1', limit: '-10' }).limit).toBe(1);
  });

  test('bad page defaults to 1; negative floors to 1', () => {
    expect(parsePage({ page: 'abc' }).page).toBe(1);
    expect(parsePage({ page: '-5' }).page).toBe(1);
  });

  test('custom defaultLimit is used when ?limit omitted', () => {
    expect(parsePage({ page: '1' }, { defaultLimit: 100 }).limit).toBe(100);
  });
});

describe('pageEnvelope', () => {
  const pg = { page: 2, limit: 10, offset: 10 };
  test('wraps rows with total and computed page count', () => {
    expect(pageEnvelope([{ id: 1 }], 42, pg)).toEqual({ data: [{ id: 1 }], total: 42, page: 2, pages: 5 });
  });
  test('string count from pg COUNT(*) is coerced', () => {
    expect(pageEnvelope([], '0', pg)).toEqual({ data: [], total: 0, page: 2, pages: 0 });
  });
  test('exact multiple of limit -> no extra page', () => {
    expect(pageEnvelope([], 30, { page: 1, limit: 10, offset: 0 }).pages).toBe(3);
  });
});
