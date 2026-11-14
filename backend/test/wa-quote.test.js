// Quotation guardrails — the AI must never set a price, and credit must be checked.
const { decideRate, checkCredit, quoteStatus } = require('../src/lib/wa-quote');

describe('decideRate — price authorisation', () => {
  test('customer history authorises the quote (no approval needed)', () => {
    const d = decideRate({ lastRate: 285 });
    expect(d).toMatchObject({ rate: 285, rate_source: 'HISTORICAL', needs_approval: false });
  });

  test('authorised price list outranks history', () => {
    const d = decideRate({ authorisedRate: 300, lastRate: 285 });
    expect(d).toMatchObject({ rate: 300, rate_source: 'AUTHORISED', needs_approval: false });
    expect(d.differs_from_history).toBe(true);
  });

  test('manager rate still outranks the authorised list', () => {
    expect(decideRate({ managerRate: 310, authorisedRate: 300, lastRate: 285 }).rate_source).toBe('MANAGER');
  });

  test('authorised price alone (no history) is enough to price a quote', () => {
    expect(decideRate({ authorisedRate: 295 })).toMatchObject({ rate: 295, rate_source: 'AUTHORISED', needs_approval: false });
  });

  test('no history and no manager rate -> approval required, no rate invented', () => {
    const d = decideRate({});
    expect(d.rate).toBeNull();
    expect(d.rate_source).toBe('NONE');
    expect(d.needs_approval).toBe(true);
  });

  test('manager rate wins over history and is recorded as MANAGER', () => {
    const d = decideRate({ managerRate: 300, lastRate: 285 });
    expect(d).toMatchObject({ rate: 300, rate_source: 'MANAGER', needs_approval: false });
    expect(d.differs_from_history).toBe(true);
  });

  test('manager rate equal to history is not flagged as a change', () => {
    expect(decideRate({ managerRate: 285, lastRate: 285 }).differs_from_history).toBe(false);
  });

  test('zero / negative / junk rates are never treated as authorised', () => {
    expect(decideRate({ managerRate: 0 }).rate_source).toBe('NONE');
    expect(decideRate({ managerRate: -50 }).rate_source).toBe('NONE');
    expect(decideRate({ managerRate: 'free' }).rate_source).toBe('NONE');
  });

  test('rounds to 2 decimals', () => {
    expect(decideRate({ lastRate: 284.567 }).rate).toBe(284.57);
  });
});

describe('checkCredit — §19 safety', () => {
  test('within limit is OK', () => {
    expect(checkCredit({ creditLimit: 1000000, outstanding: 200000, orderValue: 300000 }).flag).toBe('OK');
  });

  test('outstanding + order over the limit requires approval', () => {
    const c = checkCredit({ creditLimit: 1000000, outstanding: 940000, orderValue: 420000 });
    expect(c.flag).toBe('CREDIT_APPROVAL_REQUIRED');
    expect(c.exposure).toBe(1360000);
  });

  test('exactly at the limit is allowed', () => {
    expect(checkCredit({ creditLimit: 500000, outstanding: 200000, orderValue: 300000 }).flag).toBe('OK');
  });

  test('no configured limit does not block but says so', () => {
    const c = checkCredit({ creditLimit: 0, outstanding: 50000, orderValue: 10000 });
    expect(c.flag).toBe('OK');
    expect(c.note).toMatch(/No credit limit/i);
  });

  test('missing inputs do not produce NaN', () => {
    const c = checkCredit({});
    expect(c.exposure).toBe(0);
    expect(Number.isNaN(c.exposure)).toBe(false);
  });
});

describe('quoteStatus — combined gates', () => {
  test('authorised rate + credit OK -> APPROVED', () => {
    expect(quoteStatus({ rateSource: 'HISTORICAL', creditFlag: 'OK' })).toBe('APPROVED');
  });
  test('no rate -> price approval', () => {
    expect(quoteStatus({ rateSource: 'NONE', creditFlag: 'OK' })).toBe('PENDING_PRICE_APPROVAL');
  });
  test('credit breach holds the quote even with an authorised rate', () => {
    expect(quoteStatus({ rateSource: 'HISTORICAL', creditFlag: 'CREDIT_APPROVAL_REQUIRED' }))
      .toBe('PENDING_PRICE_APPROVAL');
  });
});
