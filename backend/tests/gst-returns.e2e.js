// GST returns — GSTR-2B parser + GSTR-3B composition.
//
// The 2B parser feeds section 4 (ITC) of GSTR-3B, so a wrong tax total here means a
// wrong ITC claim. These assert the portal JSON is read correctly: item-level and
// invoice-level tax, eligibility (itcavl='N' excluded), credit notes netting
// negative, period decoding, and per-supplier rollup. Pure functions, no DB.
//
//   node tests/gst-returns.e2e.js

const { parsers } = require('../src/lib/gst-returns');
const { parseGstr2b, rtnprdToPeriod } = parsers;

let fails = 0;
const ok = (c, m, extra = '') => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };

ok(rtnprdToPeriod('092026') === '2026-09', 'return period 092026 -> 2026-09', rtnprdToPeriod('092026'));

const twob = {
  data: {
    gstin: '03ABCDE1234F1Z5', rtnprd: '092026',
    docdata: {
      b2b: [
        { ctin: '03SUPP11111A1Z1', trdnm: 'YARN SUPPLIER A', inv: [
          { inum: 'A/101', dt: '05-09-2026', val: 118000, itcavl: 'Y', items: [{ rt: 18, txval: 100000, igst: 0, cgst: 9000, sgst: 9000 }] },
          { inum: 'A/102', dt: '06-09-2026', val: 59000, itcavl: 'N', items: [{ rt: 18, txval: 50000, igst: 0, cgst: 4500, sgst: 4500 }] },
        ] },
        { ctin: '27SUPP22222B2Z2', trdnm: 'CHEM SUPPLIER B', inv: [
          { inum: 'B/55', dt: '10-09-2026', val: 23600, itcavl: 'Y', igst: 3600, txval: 20000 },
        ] },
      ],
      cdnr: [
        { ctin: '03SUPP11111A1Z1', trdnm: 'YARN SUPPLIER A', nt: [
          { ntnum: 'CN/1', dt: '12-09-2026', typ: 'C', itcavl: 'Y', items: [{ rt: 18, txval: 10000, igst: 0, cgst: 900, sgst: 900 }] },
        ] },
      ],
    },
  },
};
const p = parseGstr2b(twob);
ok(p.period === '2026-09', '2B period parsed');
ok(p.gstin === '03ABCDE1234F1Z5', '2B own GSTIN parsed');
ok(p.invoice_count === 4, '2B counts all rows incl. credit note', `got ${p.invoice_count}`);
ok(p.supplier_count === 2, '2B rolls up to 2 suppliers', `got ${p.supplier_count}`);
// Eligible ITC: A/101 (9000+9000) + B/55 (3600) − CN/1 (900+900) = 18000 + 3600 − 1800 = 19800
// A/102 excluded (itcavl='N').
ok(p.eligible_itc.total === 19800, 'eligible ITC nets CN and excludes itcavl=N', String(p.eligible_itc.total));
ok(p.eligible_itc.igst === 3600, 'eligible IGST from invoice-level fields', String(p.eligible_itc.igst));
ok(p.eligible_itc.cgst === 8100, 'eligible CGST (9000 − 900)', String(p.eligible_itc.cgst));
ok(p.eligible_itc.sgst === 8100, 'eligible SGST (9000 − 900)', String(p.eligible_itc.sgst));
const supA = p.suppliers.find(s => s.gstin === '03SUPP11111A1Z1');
ok(supA && supA.invoices === 3, 'supplier A has 3 docs (2 inv + 1 CN)');
ok(supA && supA.eligible_itc === 16200, 'supplier A eligible ITC = 18000 − 1800', supA && String(supA.eligible_itc));

console.log(fails ? `\nFAILED (${fails})` : '\nAll GST-returns parser tests passed.');
process.exit(fails ? 1 : 0);
