// Opt-out keyword matching. A false positive silently unsubscribes a paying
// customer and a false negative ignores a legal withdrawal — both are serious,
// so the matcher is pinned by tests.
const makeConsent = require('../src/lib/wa-consent');

// Only the pure matchers are exercised here; the DB paths are integration-tested.
const c = makeConsent({ query: async () => ({ rows: [] }) });

describe('opt-out keywords', () => {
  test.each([
    'STOP', 'stop', 'Stop', 'STOP.', ' stop ',
    'unsubscribe', 'UNSUBSCRIBE', 'opt out', 'optout',
    'band karo', 'bandh karo', 'mat bhejo', 'hatao', 'remove me',
  ])('"%s" is an opt-out', (t) => expect(c.isStopKeyword(t)).toBe(true));

  test.each([
    'dont stop production',
    'stop the machine please',
    'non stop chal raha hai',
    'please stop sending black, send navy instead',
    'stopper needed',
    'START',
    '',
  ])('"%s" is NOT an opt-out', (t) => expect(c.isStopKeyword(t)).toBe(false));
});

describe('opt-in keywords', () => {
  test.each(['START', 'start', 'subscribe', 'resume', 'chalu karo', 'shuru karo'])(
    '"%s" resubscribes', (t) => expect(c.isStartKeyword(t)).toBe(true));

  test.each(['start production', 'when can you start?', 'STOP'])(
    '"%s" does not', (t) => expect(c.isStartKeyword(t)).toBe(false));
});

describe('canSend with no record on file', () => {
  test('service and transactional are allowed — the customer wrote to us', async () => {
    expect((await c.canSend('919812345678', 'SERVICE')).allowed).toBe(true);
    expect((await c.canSend('919812345678', 'TRANSACTIONAL')).allowed).toBe(true);
  });

  test('marketing is not — that needs explicit opt-in', async () => {
    const v = await c.canSend('919812345678', 'MARKETING');
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/opt-in/i);
  });

  test('an unknown purpose is treated as SERVICE, never as marketing', async () => {
    expect((await c.canSend('919812345678', 'NONSENSE')).allowed).toBe(true);
  });
});
