// Approval authority (HIGH-05). These decide who may commit the business to
// money, so the rank logic is pinned rather than trusted.
const makeApprovals = require('../src/lib/wa-approvals');

const a = makeApprovals({ query: async () => ({ rows: [] }) });

describe('canApprove — role ranking', () => {
  test('a role satisfies its own requirement', () => {
    expect(a.canApprove('ADMIN', 'ADMIN')).toBe(true);
  });

  test('a senior role satisfies a junior requirement', () => {
    expect(a.canApprove('SUPER_ADMIN', 'ADMIN')).toBe(true);
    expect(a.canApprove('ADMIN', 'SUPERVISOR')).toBe(true);
  });

  test('a junior role never satisfies a senior requirement', () => {
    expect(a.canApprove('SUPERVISOR', 'ADMIN')).toBe(false);
    expect(a.canApprove('OPERATOR', 'SUPERVISOR')).toBe(false);
  });

  test('unknown or missing roles are refused, never allowed by default', () => {
    expect(a.canApprove(undefined, 'SUPERVISOR')).toBe(false);
    expect(a.canApprove('', 'SUPERVISOR')).toBe(false);
    expect(a.canApprove('MADE_UP_ROLE', 'SUPERVISOR')).toBe(false);
  });

  test('case is not a way around the check', () => {
    expect(a.canApprove('admin', 'SUPERVISOR')).toBe(true);
  });
});

describe('requiredRole — value bands (falls back when nothing configured)', () => {
  test('small orders need a supervisor', async () => {
    expect(await a.requiredRole('ORDER', 50000)).toBe('SUPERVISOR');
  });

  test('mid-value orders escalate to admin', async () => {
    expect(await a.requiredRole('ORDER', 500000)).toBe('ADMIN');
  });

  test('large orders escalate to the top', async () => {
    expect(await a.requiredRole('ORDER', 5000000)).toBe('SUPER_ADMIN');
  });

  test('band boundaries land in the higher band, not the lower one', async () => {
    expect(await a.requiredRole('ORDER', 100000)).toBe('ADMIN');
    expect(await a.requiredRole('ORDER', 1000000)).toBe('SUPER_ADMIN');
  });

  test('credit decisions need ADMIN regardless of how small the order is', async () => {
    expect(await a.requiredRole('CREDIT', 1)).toBe('ADMIN');
    expect(await a.requiredRole('CREDIT', 10000000)).toBe('ADMIN');
  });

  test('an unknown document type defaults to ADMIN rather than to anyone', async () => {
    expect(await a.requiredRole('SOMETHING_NEW', 100)).toBe('ADMIN');
  });
});
