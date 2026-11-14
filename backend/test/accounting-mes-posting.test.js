// MES event posting rules (Phase 4) — pure, balanced-line builders.
const { buildEventLines, taxOf } = require('../src/lib/accounting/mes-posting');
const { toPaise } = require('../src/lib/accounting/rules');

const SYS = {
  INVENTORY: 'inv', WIP: 'wip', FINISHED_GOODS: 'fg', COGS: 'cogs', WASTAGE: 'waste', JOBWORK_CHARGES: 'jw',
  CONVERSION_APPLIED: 'conv', GRN_CLEARING: 'grn',
  PURCHASE: 'pur', INPUT_CGST: 'icg', INPUT_SGST: 'isg', INPUT_IGST: 'iig', ROUND_OFF: 'ro',
};
const RULES = {
  GRN_RECEIPT: { debit: 'INVENTORY', tax_side: 'INPUT', credit: 'GRN_CLEARING', party_credit: true },
  JOBWORK_CHARGES: { debit: 'JOBWORK_CHARGES', tax_side: 'INPUT', credit: 'GRN_CLEARING', party_credit: true },
  DISPATCH_COGS: { debit: 'COGS', credit: 'FINISHED_GOODS' },
  WASTAGE: { debit: 'WASTAGE', credit: 'INVENTORY' },
  ISSUE_TO_WIP: { debit: 'WIP', credit: 'INVENTORY' },
  CONVERSION_APPLIED: { debit: 'WIP', credit: 'CONVERSION_APPLIED' },
  PRODUCTION_OUTPUT: { debit: 'FINISHED_GOODS', credit: 'WIP' },
};
const sum = (l, k) => l.reduce((a, x) => a + (toPaise(x[k]) || 0), 0);
const bal = (l) => expect(sum(l, 'dr_amount')).toBe(sum(l, 'cr_amount'));

describe('taxOf', () => {
  test('explicit amounts win over rate', () => {
    expect(taxOf({ cgst: '10', sgst: '10', igst: '0' }, 100000)).toEqual({ cgst: 1000, sgst: 1000, igst: 0 });
  });
  test('rate + intra computes CGST/SGST', () => {
    expect(taxOf({ gst_rate: 5, intra: true }, 100000)).toEqual({ cgst: 2500, sgst: 2500, igst: 0 });
  });
  test('no tax info = zero', () => { expect(taxOf({}, 100000)).toEqual({ cgst: 0, sgst: 0, igst: 0 }); });
});

describe('GRN_RECEIPT', () => {
  test('Dr Inventory + Input GST / Cr supplier, balanced to grand', () => {
    const l = buildEventLines('GRN_RECEIPT', { value: '10000', gst_rate: 5, intra: true, party_ledger_id: 'sup' }, RULES.GRN_RECEIPT, SYS, 'sup');
    bal(l);
    const dr = Object.fromEntries(l.filter((x) => x.dr_amount !== '0').map((x) => [x.ledger_id, x.dr_amount]));
    expect(dr).toMatchObject({ inv: '10000.00', icg: '250.00', isg: '250.00' });
    const cr = l.filter((x) => x.cr_amount !== '0');
    expect(cr).toHaveLength(1);
    expect(cr[0]).toMatchObject({ ledger_id: 'sup', cr_amount: '10500.00' });
  });
  test('no party falls back to GRN clearing', () => {
    const l = buildEventLines('GRN_RECEIPT', { value: '10000' }, RULES.GRN_RECEIPT, SYS, null);
    bal(l);
    expect(l.find((x) => x.cr_amount !== '0')).toMatchObject({ ledger_id: 'grn', cr_amount: '10000.00' });
  });
  test('inter-state books Input IGST', () => {
    const l = buildEventLines('GRN_RECEIPT', { value: '10000', gst_rate: 5, intra: false, party_ledger_id: 'sup' }, RULES.GRN_RECEIPT, SYS, 'sup');
    bal(l);
    expect(l.find((x) => x.ledger_id === 'iig')).toMatchObject({ dr_amount: '500.00' });
  });
  test('zero value rejected', () => {
    expect(() => buildEventLines('GRN_RECEIPT', { value: '0' }, RULES.GRN_RECEIPT, SYS, null)).toThrow(/greater than 0/);
  });
});

describe('DISPATCH_COGS / WASTAGE', () => {
  test('COGS: Dr COGS / Cr Finished Goods at cost', () => {
    const l = buildEventLines('DISPATCH_COGS', { cost: '7500' }, RULES.DISPATCH_COGS, SYS);
    bal(l);
    expect(l[0]).toMatchObject({ ledger_id: 'cogs', dr_amount: '7500.00' });
    expect(l[1]).toMatchObject({ ledger_id: 'fg', cr_amount: '7500.00' });
  });
  test('WASTAGE: Dr Wastage / Cr Inventory (value fallback when no cost)', () => {
    const l = buildEventLines('WASTAGE', { value: '300' }, RULES.WASTAGE, SYS);
    bal(l);
    expect(l[0]).toMatchObject({ ledger_id: 'waste', dr_amount: '300.00' });
    expect(l[1]).toMatchObject({ ledger_id: 'inv', cr_amount: '300.00' });
  });
});

describe('WIP cost absorption (Raw → WIP → Finished Goods)', () => {
  test('ISSUE_TO_WIP: Dr WIP / Cr Inventory', () => {
    const l = buildEventLines('ISSUE_TO_WIP', { cost: '5000' }, RULES.ISSUE_TO_WIP, SYS);
    bal(l);
    expect(l[0]).toMatchObject({ ledger_id: 'wip', dr_amount: '5000.00' });
    expect(l[1]).toMatchObject({ ledger_id: 'inv', cr_amount: '5000.00' });
  });
  test('CONVERSION_APPLIED: Dr WIP / Cr Conversion Absorbed', () => {
    const l = buildEventLines('CONVERSION_APPLIED', { cost: '1200' }, RULES.CONVERSION_APPLIED, SYS);
    bal(l);
    expect(l[0]).toMatchObject({ ledger_id: 'wip', dr_amount: '1200.00' });
    expect(l[1]).toMatchObject({ ledger_id: 'conv', cr_amount: '1200.00' });
  });
  test('PRODUCTION_OUTPUT: Dr Finished Goods / Cr WIP', () => {
    const l = buildEventLines('PRODUCTION_OUTPUT', { cost: '6200' }, RULES.PRODUCTION_OUTPUT, SYS);
    bal(l);
    expect(l[0]).toMatchObject({ ledger_id: 'fg', dr_amount: '6200.00' });
    expect(l[1]).toMatchObject({ ledger_id: 'wip', cr_amount: '6200.00' });
  });
});

describe('JOBWORK_CHARGES', () => {
  test('Dr charges + Input GST / Cr job-worker', () => {
    const l = buildEventLines('JOBWORK_CHARGES', { value: '2000', gst_rate: 18, intra: true, party_ledger_id: 'jwparty' }, RULES.JOBWORK_CHARGES, SYS, 'jwparty');
    bal(l);
    expect(l.find((x) => x.ledger_id === 'jw')).toMatchObject({ dr_amount: '2000.00' });
    expect(l.find((x) => x.cr_amount !== '0')).toMatchObject({ ledger_id: 'jwparty', cr_amount: '2360.00' });
  });
});

describe('guards', () => {
  test('unknown event rejected', () => { expect(() => buildEventLines('NOPE', {}, {}, SYS)).toThrow(/Unknown MES event/); });
  test('missing policy rejected', () => { expect(() => buildEventLines('WASTAGE', { cost: '1' }, null, SYS)).toThrow(/No approved posting policy/); });
  test('missing system ledger rejected', () => { expect(() => buildEventLines('WASTAGE', { cost: '1' }, RULES.WASTAGE, {})).toThrow(/System ledger/); });
});
