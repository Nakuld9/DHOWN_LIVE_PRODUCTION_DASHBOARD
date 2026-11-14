// XML-lite parser + Busy-export parse/control-totals (pure).
const { parseXml, text, findAll, child } = require('../src/lib/accounting/xml-lite');
const migration = require('../src/lib/accounting/migration')(null); // parse/exportTotals need no DB

describe('parseXml', () => {
  test('elements, attributes, nested text', () => {
    const r = parseXml('<a x="1"><b>hi</b><b>yo</b></a>');
    const a = r.children[0];
    expect(a.name).toBe('a'); expect(a.attrs.x).toBe('1');
    expect(findAll(a, 'b').map((n) => n.text)).toEqual(['hi', 'yo']);
  });
  test('self-closing, CDATA, comments, declaration, entities', () => {
    const r = parseXml('<?xml version="1.0"?><!-- c --><root><x/><y><![CDATA[a<b&c]]></y><z>a&amp;b &#65;</z></root>');
    const root = r.children[0];
    expect(child(root, 'x').children).toEqual([]);
    expect(child(root, 'y').text).toBe('a<b&c');
    expect(child(root, 'z').text).toBe('a&b A');
  });
  test('case-insensitive text accessor with aliases', () => {
    const r = parseXml('<L><LedgerName>ABC</LedgerName></L>');
    expect(text(r.children[0], 'Name', 'LedgerName')).toBe('ABC');
  });
  test('throws on mismatched / unclosed tags', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/mismatched|unclosed/i);
    expect(() => parseXml('<a>')).toThrow(/unclosed/i);
  });
});

const SAMPLE = `<?xml version="1.0"?>
<BusyExport Company="DHOWN">
  <Masters>
    <Group><Name>Ludhiana Debtors</Name><Parent>Sundry Debtors</Parent></Group>
    <Ledger><Name>ABC Traders</Name><Group>Ludhiana Debtors</Group><GSTIN>03AAAAA0000A1Z5</GSTIN><OpeningBalance>50000</OpeningBalance><DrCr>Dr</DrCr></Ledger>
    <Ledger><Name>Capital A/c</Name><Group>Capital Account</Group><OpeningBalance>50000</OpeningBalance><DrCr>Cr</DrCr></Ledger>
  </Masters>
  <Transactions>
    <Voucher><Type>Journal</Type><Number>JV1</Number><Date>2026-04-02</Date>
      <Line><Ledger>ABC Traders</Ledger><DrCr>Dr</DrCr><Amount>1180</Amount></Line>
      <Line><Ledger>Sales</Ledger><DrCr>Cr</DrCr><Amount>1000</Amount></Line>
      <Line><Ledger>Output CGST</Ledger><DrCr>Cr</DrCr><Amount>90</Amount></Line>
      <Line><Ledger>Output SGST</Ledger><DrCr>Cr</DrCr><Amount>90</Amount></Line>
    </Voucher>
  </Transactions>
</BusyExport>`;

describe('Busy export parse', () => {
  const norm = migration.parse(SAMPLE);
  test('reads groups, ledgers (with opening), vouchers + lines', () => {
    expect(norm.company).toBe('DHOWN');
    expect(norm.groups).toEqual([{ name: 'Ludhiana Debtors', parent: 'Sundry Debtors', nature: null }]);
    expect(norm.ledgers).toHaveLength(2);
    expect(norm.ledgers[0]).toMatchObject({ name: 'ABC Traders', group: 'Ludhiana Debtors', gstin: '03AAAAA0000A1Z5', opening: '50000', drcr: 'Dr' });
    expect(norm.vouchers).toHaveLength(1);
    expect(norm.vouchers[0]).toMatchObject({ source_id: 'JV1', type: 'Journal', date: '2026-04-02' });
    expect(norm.vouchers[0].lines).toHaveLength(4);
  });
  test('control totals balance', () => {
    const t = migration.exportTotals(norm);
    expect(t.opening_dr).toBe('50000.00'); expect(t.opening_cr).toBe('50000.00'); expect(t.opening_diff).toBe('0.00');
    expect(t.voucher_dr).toBe('1180.00'); expect(t.voucher_cr).toBe('1180.00');
    expect(t.unbalanced_vouchers).toBe(0);
  });
  test('detects an unbalanced voucher', () => {
    const bad = migration.parse(SAMPLE.replace('<Amount>1000</Amount>', '<Amount>999</Amount>'));
    expect(migration.exportTotals(bad).unbalanced_vouchers).toBe(1);
  });
});
