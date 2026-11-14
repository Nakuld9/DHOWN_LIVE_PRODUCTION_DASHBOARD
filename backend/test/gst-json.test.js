// Portal-JSON pure helpers — state codes, UQC, date formats.
const { _helpers: h } = require('../src/lib/gst-json');

describe('posCode (place of supply → 2-digit state code)', () => {
  test('state name → code', () => { expect(h.posCode('Punjab')).toBe('03'); expect(h.posCode('Maharashtra')).toBe('27'); expect(h.posCode('Tamil Nadu')).toBe('33'); });
  test('already a 2-digit code', () => { expect(h.posCode('09')).toBe('09'); });
  test('"NN-StateName" form', () => { expect(h.posCode('24-Gujarat')).toBe('24'); });
  test('falls back to GSTIN prefix', () => { expect(h.posCode('', '29ABCDE1234F1Z5')).toBe('29'); });
  test('unknown → empty', () => { expect(h.posCode('Atlantis')).toBe(''); });
});

describe('uqc (unit → GST UQC)', () => {
  test('maps common units', () => { expect(h.uqc('KG')).toBe('KGS'); expect(h.uqc('pcs')).toBe('PCS'); expect(h.uqc('MTR')).toBe('MTR'); expect(h.uqc('ROLL')).toBe('NOS'); });
  test('unknown → OTH', () => { expect(h.uqc('widgets')).toBe('OTH'); });
});

describe('date formats', () => {
  test('dmy = DD-MM-YYYY', () => { expect(h.dmy('2026-10-05')).toBe('05-10-2026'); });
  test('ddmmyyyy = DD/MM/YYYY (EWB)', () => { expect(h.ddmmyyyy('2026-10-05')).toBe('05/10/2026'); });
  test('mmyyyy = MMYYYY (filing period)', () => { expect(h.mmyyyy('2026-10-31')).toBe('102026'); });
});
