// Bank statement FILE parsers — H2H Phase A (read-only ingestion).
//
// These are pure-function tests (no DB): they prove the MT940, CAMT.053 and CSV
// parsers turn a real-shaped statement file into the normalised row shape the
// reconciliation engine expects, get debit/credit on the right side, read Indian
// and ISO date/amount formats, and that the format sniffer picks the right parser.
// A wrong side or a mis-read amount here would silently corrupt reconciliation, so
// the direction of money is what is asserted hardest.
//
//   node tests/bank-files.e2e.js

const { parsers } = require('../src/lib/bank-statement-files');
const { parseMT940, parseCAMT053, parseCSV, matrixToRows, sniffFormat, isoDate, amount } = parsers;

let fails = 0;
const ok = (c, m, extra = '') => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + m + (extra ? '   ' + extra : ''));
  if (!c) fails++;
};

// ── date + amount primitives ──────────────────────────────────────────────────
ok(isoDate('05-10-2026') === '2026-10-05', 'DD-MM-YYYY read as Indian order');
ok(isoDate('2026-10-05') === '2026-10-05', 'ISO date passes through');
ok(isoDate('05-Oct-2026') === '2026-10-05', 'DD-Mon-YYYY parsed');
ok(amount('1,00,000.00') === 100000, 'Indian lakh grouping', String(amount('1,00,000.00')));
ok(amount('1234,56') === 1234.56, 'MT940 comma-decimal', String(amount('1234,56')));
ok(amount('-500.00') === 500, 'amount is magnitude (sign handled by column)');

// ── MT940 ─────────────────────────────────────────────────────────────────────
const mt940 = [
  ':20:STMT26278',
  ':25:50200012345678',
  ':28C:00123/001',
  ':60F:C260930INR125000,00',
  ':61:2610051005C25000,00NTRFUTR123456789//REF1',
  ':86:NEFT INWARD FROM ACME TEXTILES UTR123456789',
  ':61:2610051005D8000,50NTRFCHGS//REF2',
  ':86:RTGS OUTWARD TO YARN SUPPLIER',
  ':62F:C261005INR142000,00',
].join('\r\n');
const m = parseMT940(mt940);
ok(m.length === 2, 'MT940: two transactions parsed', `got ${m.length}`);
ok(m[0] && m[0].credit === 25000 && m[0].debit === 0, 'MT940: C line is a credit', JSON.stringify(m[0]));
ok(m[1] && m[1].debit === 8000.5 && m[1].credit === 0, 'MT940: D line is a debit', JSON.stringify(m[1]));
ok(m[0] && m[0].txn_date === '2026-10-05', 'MT940: YYMMDD -> ISO date', m[0] && m[0].txn_date);
ok(m[0] && /UTR123456789/.test(m[0].description || ''), 'MT940: narrative captured');

// ── CAMT.053 ──────────────────────────────────────────────────────────────────
const camt = `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
 <Ntry><Amt Ccy="INR">25000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
   <BookgDt><Dt>2026-10-05</Dt></BookgDt><ValDt><Dt>2026-10-05</Dt></ValDt>
   <AcctSvcrRef>UTR123456789</AcctSvcrRef>
   <NtryDtls><TxDtls><RmtInf><Ustrd>NEFT FROM ACME TEXTILES</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
 <Ntry><Amt Ccy="INR">8000.50</Amt><CdtDbtInd>DBIT</CdtDbtInd>
   <BookgDt><Dt>2026-10-05</Dt></BookgDt>
   <AddtlNtryInf>RTGS TO YARN SUPPLIER</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
const c = parseCAMT053(camt);
ok(c.length === 2, 'CAMT053: two entries parsed', `got ${c.length}`);
ok(c[0] && c[0].credit === 25000 && c[0].debit === 0, 'CAMT053: CRDT is a credit', JSON.stringify(c[0]));
ok(c[1] && c[1].debit === 8000.5 && c[1].credit === 0, 'CAMT053: DBIT is a debit', JSON.stringify(c[1]));
ok(c[0] && c[0].txn_date === '2026-10-05', 'CAMT053: booking date read');
ok(c[0] && /ACME TEXTILES/.test(c[0].description || ''), 'CAMT053: remittance info captured');

// ── CSV (two-column debit/credit) ─────────────────────────────────────────────
const csv2 = [
  'Txn Date,Value Date,Narration,Chq/Ref No,Withdrawal,Deposit,Balance',
  '05-10-2026,05-10-2026,NEFT ACME TEXTILES,UTR123456789,,"25,000.00","1,42,000.00"',
  '05-10-2026,05-10-2026,RTGS YARN SUPPLIER,REF2,"8,000.50",,"1,34,000.00"',
].join('\n');
const v = parseCSV(csv2, {});
ok(v.length === 2, 'CSV: two rows parsed', `got ${v.length}`);
ok(v[0] && v[0].credit === 25000 && v[0].debit === 0, 'CSV: deposit is a credit', JSON.stringify(v[0]));
ok(v[1] && v[1].debit === 8000.5 && v[1].credit === 0, 'CSV: withdrawal is a debit', JSON.stringify(v[1]));
ok(v[0] && v[0].txn_date === '2026-10-05', 'CSV: Indian date read');

// ── CSV (single signed/typed amount column) ───────────────────────────────────
const csv1 = [
  'Date,Description,Reference,Amount,Dr/Cr,Balance',
  '2026-10-05,NEFT ACME,UTR1,25000.00,CR,142000',
  '2026-10-05,RTGS YARN,REF2,8000.50,DR,134000',
].join('\n');
const v1 = parseCSV(csv1, {});
ok(v1.length === 2, 'CSV(signed): two rows parsed', `got ${v1.length}`);
ok(v1[0] && v1[0].credit === 25000, 'CSV(signed): CR -> credit');
ok(v1[1] && v1[1].debit === 8000.5, 'CSV(signed): DR -> debit');

// ── Union Bank of India .xls layout (via matrixToRows — the shape SheetJS yields) ─
// This is the real export shape: a metadata block (including a "Statement Date" line
// that must NOT be mistaken for the header), a leading empty column, and
// Withdrawals/Deposits split columns with the UTR embedded in the Remarks.
const unionMatrix = [
  ['', 'Statement of Account', '', '', '', '', '', '', '', '', ''],
  ['', 'DHOWN HOSIERY MILLS', '', '', '', '', 'Union Bank of India', '', '', '', ''],
  ['', 'Statement Date ', '05/10/2026 09:58', '', '', '', 'Statement From', '01/10/2026', 'To', '05/10/2026', ''],
  ['', 'Records from 1 to 3.', '', 'No more records available.', '', '', '', '', '', '', ''],
  ['', 'Date', 'Tran Id', 'Remarks', '', 'UTR Number', 'Instr. Id', 'Withdrawals', 'Deposits', 'Balance', ''],
  ['', '01-10-2026 13:16:05', 'X23998364', 'RTGS:NEW ERA WOOLLEN MILLS  UTIBR62026100111784145', '', "'-", '', '', 800000, -72864323.78, ''],
  ['', '01-10-2026 13:21:51', 'X24482417', 'NEFTO-VD KNITS 003006045735', '', "'-", '', 750000, '', -73614323.78, ''],
  ['', '03-10-2026 11:13:52', 'Y68620105', 'NEFT:S S TEX BARBQ26276914874', '', 'Sender No:BARBQ26276914874', '', '', 45763, -73683560.78, ''],
];
const u = matrixToRows(unionMatrix, {});
ok(u.length === 3, 'Union: 3 data rows (metadata + Statement Date header trap skipped)', `got ${u.length}`);
ok(u[0] && u[0].credit === 800000 && u[0].debit === 0, 'Union: Deposits -> credit', JSON.stringify(u[0]));
ok(u[1] && u[1].debit === 750000 && u[1].credit === 0, 'Union: Withdrawals -> debit');
ok(u[0] && u[0].txn_date === '2026-10-01', 'Union: DD-MM-YYYY date with time read');
ok(u[0] && u[0].reference === 'UTIBR62026100111784145', 'Union: UTR lifted from remarks when UTR col is "-"', u[0] && u[0].reference);
ok(u[2] && u[2].reference === 'BARBQ26276914874', 'Union: UTR read from "Sender No:" ref column');
ok(u[0] && u[0].balance === -72864323.78, 'Union: cash-credit balance keeps its negative sign', String(u[0] && u[0].balance));

// ── format sniffing ───────────────────────────────────────────────────────────
ok(sniffFormat(mt940) === 'MT940', 'sniff: MT940');
ok(sniffFormat(camt) === 'CAMT053', 'sniff: CAMT053');
ok(sniffFormat(csv2) === 'CSV', 'sniff: CSV');

// ── safety: every row has exactly one side set ────────────────────────────────
const allRows = [...m, ...c, ...v, ...v1];
ok(allRows.every((r) => (r.debit > 0) !== (r.credit > 0)), 'every parsed row has exactly one of debit/credit');

console.log(fails ? `\nFAILED (${fails})` : '\nAll bank-file parser tests passed.');
process.exit(fails ? 1 : 0);
