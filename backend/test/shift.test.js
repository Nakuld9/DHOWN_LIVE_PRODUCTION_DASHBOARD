// Shift detection — drives which shift production/attendance/payroll is booked to.
const { parseHHMM, detectCurrentShift } = require('../src/lib/shift');

describe('parseHHMM', () => {
  test('parses HH:MM to fractional hours', () => {
    expect(parseHHMM('08:00')).toBe(8);
    expect(parseHHMM('20:30')).toBe(20.5);
    expect(parseHHMM('00:15')).toBe(0.25);
  });
  test('empty / junk defaults to 0', () => {
    expect(parseHHMM('')).toBe(0);
    expect(parseHHMM(undefined)).toBe(0);
  });
});

describe('detectCurrentShift (2-shift, day 08:00–20:00)', () => {
  const cfg = { shift_mode: '2-shift', day_shift: '08:00 - 20:00' };
  const at = (h, m = 0) => { // fix local wall-clock time, then detect
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 31, h, m, 0));
    const s = detectCurrentShift(cfg);
    jest.useRealTimers();
    return s;
  };
  test('10:00 is Day', () => expect(at(10)).toBe('D'));
  test('19:59 is Day', () => expect(at(19, 59)).toBe('D'));
  test('20:00 is Night (boundary)', () => expect(at(20)).toBe('N'));
  test('22:00 is Night', () => expect(at(22)).toBe('N'));
  test('07:00 is Night', () => expect(at(7)).toBe('N'));
});

describe('detectCurrentShift (3-shift)', () => {
  const cfg = { shift_mode: '3-shift',
    shift_a_start: '06:00', shift_a_end: '14:00',
    shift_b_start: '14:00', shift_b_end: '22:00',
    shift_c_start: '22:00', shift_c_end: '06:00' };
  const at = (h) => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 31, h, 0, 0));
    const s = detectCurrentShift(cfg);
    jest.useRealTimers();
    return s;
  };
  test('10:00 → D (shift A)', () => expect(at(10)).toBe('D'));
  test('16:00 → N (shift B)', () => expect(at(16)).toBe('N'));
  test('23:00 → C (shift C)', () => expect(at(23)).toBe('C'));
});
