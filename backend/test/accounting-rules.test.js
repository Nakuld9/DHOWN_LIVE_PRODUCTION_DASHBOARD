// Accounting engine — pure rules: money parsing, balance validation, state machine, reversal.
const R = require('../src/lib/accounting/rules');

const led = (type = 'GENERAL', is_active = true) => ({ ledger_type: type, is_active, name: type });
const map = (entries) => new Map(entries);

describe('money (integer paise)', () => {
  test('parses strings, numbers and commas exactly', () => {
    expect(R.toPaise('1234.50')).toBe(123450);
    expect(R.toPaise('1,234.5')).toBe(123450);
    expect(R.toPaise(1234.5)).toBe(123450);
    expect(R.toPaise('0.1')).toBe(10);
    expect(R.toPaise('7')).toBe(700);
    expect(R.toPaise('')).toBeNull();
    expect(R.toPaise(null)).toBeNull();
  });
  test('0.1 + 0.2 stays exact in paise', () => {
    expect(R.toPaise('0.1') + R.toPaise('0.2')).toBe(R.toPaise('0.3'));
  });
  test('rejects more than 2 decimals and junk instead of rounding', () => {
    expect(() => R.toPaise('1.005')).toThrow(R.AccountingError);
    expect(() => R.toPaise('12abc')).toThrow(R.AccountingError);
  });
  test('formats paise back to an exact string', () => {
    expect(R.fromPaise(123450)).toBe('1234.50');
    expect(R.fromPaise(5)).toBe('0.05');
    expect(R.fromPaise(-250)).toBe('-2.50');
    expect(R.fromPaise(0)).toBe('0.00');
  });
});

describe('line normalisation', () => {
  test('accepts dr/cr or side+amount and skips blank grid rows', () => {
    const lines = R.normaliseLines([
      { ledger_id: 'a', dr_amount: '100' },
      {},
      { ledger_id: 'b', side: 'CR', amount: '100.00' },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ line_no: 1, dr: 10000, cr: 0 });
    expect(lines[1]).toMatchObject({ line_no: 2, dr: 0, cr: 10000 });
  });
  test('rejects an unknown side', () => {
    expect(() => R.normaliseLines([{ ledger_id: 'a', side: 'X', amount: 1 }])).toThrow(R.AccountingError);
  });
});

describe('validateLines', () => {
  const two = (d, c) => R.normaliseLines([{ ledger_id: 'a', dr_amount: d }, { ledger_id: 'b', cr_amount: c }]);

  test('balanced two-line journal passes', () => {
    const v = R.validateLines('JOURNAL', two('500', '500'), map([['a', led()], ['b', led()]]));
    expect(v.ok).toBe(true);
    expect(v.total_dr).toBe(50000);
  });
  test('unbalanced voucher fails and reports the difference', () => {
    const v = R.validateLines('JOURNAL', two('500', '499.99'));
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/difference 0\.01/);
  });
  test('single line, no credit, both-sided and zero lines fail', () => {
    expect(R.validateLines('JOURNAL', R.normaliseLines([{ ledger_id: 'a', dr_amount: '1' }])).ok).toBe(false);
    const both = R.normaliseLines([{ ledger_id: 'a', dr_amount: '1', cr_amount: '1' }, { ledger_id: 'b', cr_amount: '0' }]);
    expect(R.validateLines('JOURNAL', both).ok).toBe(false);
  });
  test('missing account and inactive account fail', () => {
    const noAcc = R.normaliseLines([{ dr_amount: '5' }, { ledger_id: 'b', cr_amount: '5' }]);
    expect(R.validateLines('JOURNAL', noAcc).ok).toBe(false);
    const v = R.validateLines('JOURNAL', two('5', '5'), map([['a', led('GENERAL', false)], ['b', led()]]));
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toMatch(/inactive/);
  });
  test('contra allows only cash/bank', () => {
    expect(R.validateLines('CONTRA', two('5', '5'), map([['a', led('CASH')], ['b', led('BANK')]])).ok).toBe(true);
    expect(R.validateLines('CONTRA', two('5', '5'), map([['a', led('CASH')], ['b', led('GENERAL')]])).ok).toBe(false);
  });
  test('receipt must debit cash/bank; payment must credit cash/bank', () => {
    expect(R.validateLines('RECEIPT', two('5', '5'), map([['a', led('BANK')], ['b', led('PARTY')]])).ok).toBe(true);
    expect(R.validateLines('RECEIPT', two('5', '5'), map([['a', led('PARTY')], ['b', led('BANK')]])).ok).toBe(false);
    expect(R.validateLines('PAYMENT', two('5', '5'), map([['a', led('PARTY')], ['b', led('CASH')]])).ok).toBe(true);
    expect(R.validateLines('PAYMENT', two('5', '5'), map([['a', led('CASH')], ['b', led('PARTY')]])).ok).toBe(false);
  });
});

describe('state machine', () => {
  test('allowed transitions', () => {
    expect(R.canTransition('DRAFT', 'VALIDATED')).toBe(true);
    expect(R.canTransition('VALIDATED', 'APPROVED')).toBe(true);
    expect(R.canTransition('APPROVED', 'POSTED')).toBe(true);
    expect(R.canTransition('POSTED', 'REVERSED')).toBe(true);
  });
  test('posted/reversed/cancelled are terminal except POSTED->REVERSED', () => {
    expect(R.canTransition('POSTED', 'DRAFT')).toBe(false);
    expect(R.canTransition('POSTED', 'CANCELLED')).toBe(false);
    expect(R.canTransition('REVERSED', 'POSTED')).toBe(false);
    expect(R.canTransition('CANCELLED', 'DRAFT')).toBe(false);
    expect(() => R.assertTransition('POSTED', 'DRAFT')).toThrow(R.AccountingError);
  });
});

describe('reversal', () => {
  test('swaps debit and credit and keeps the voucher balanced', () => {
    const lines = R.normaliseLines([{ ledger_id: 'a', dr_amount: '120' }, { ledger_id: 'b', cr_amount: '100' }, { ledger_id: 'c', cr_amount: '20' }]);
    const rev = R.reverseLines(lines);
    expect(rev.map((l) => [l.dr, l.cr])).toEqual([[0, 12000], [10000, 0], [2000, 0]]);
    expect(R.validateLines('JOURNAL', rev).ok).toBe(true);
  });
});

describe('sideOf', () => {
  test('signed paise -> amount + Dr/Cr', () => {
    expect(R.sideOf(15000)).toEqual({ amount: '150.00', side: 'Dr' });
    expect(R.sideOf(-15000)).toEqual({ amount: '150.00', side: 'Cr' });
    expect(R.sideOf(0)).toEqual({ amount: '0.00', side: '' });
  });
});
