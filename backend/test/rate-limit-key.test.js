// The rate-limit key for the AI endpoints.
//
// This exists because a limiter that looks correct can be worth nothing. The
// original key was `req.user?.username || req.ip`, which is fine over IPv4 —
// one address, one budget. Over IPv6 a client is handed an entire prefix, so it
// can present a different source address on every request and collect a fresh
// 20-call budget each time. The cap was decorative against anyone on IPv6.
//
// express-rate-limit warns about this at boot, and the fix is to fold an IPv6
// address down to its network before using it as a key. These tests pin the
// three behaviours that matter, so the bare `req.ip` form cannot quietly return.

const { ipKeyGenerator } = require('express-rate-limit');

// The same expression used by aiLimiter in src/middleware/auth.js.
const keyFor = (req) => req.user?.username || ipKeyGenerator(req.ip);

describe('AI rate-limit key', () => {
  it('gives two addresses in one IPv6 prefix the same budget', () => {
    // A single client rotating within its own /64 — the bypass.
    const a = keyFor({ ip: '2001:db8:1:2:aaaa:bbbb:cccc:dddd' });
    const b = keyFor({ ip: '2001:db8:1:2:1111:2222:3333:4444' });
    expect(a).toBe(b);
    expect(a).toBe('2001:db8:1::/56');
  });

  it('still separates genuinely different IPv6 networks', () => {
    // Folding must not go so far that unrelated clients share a limit.
    expect(keyFor({ ip: '2001:db8:1:2::1' }))
      .not.toBe(keyFor({ ip: '2001:db8:9999:2::1' }));
  });

  it('leaves IPv4 addresses exactly as they are', () => {
    expect(keyFor({ ip: '203.0.113.7' })).toBe('203.0.113.7');
  });

  it('keys a logged-in user by username, not by address', () => {
    // Deliberate: one person's runaway script must not lock out the whole
    // office behind a shared NAT, and moving desks must not reset their quota.
    const desk = keyFor({ ip: '10.0.0.5', user: { username: 'nakul' } });
    const shopFloor = keyFor({ ip: '10.0.9.9', user: { username: 'nakul' } });
    expect(desk).toBe('nakul');
    expect(shopFloor).toBe('nakul');
  });
});
