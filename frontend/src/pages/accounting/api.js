// Thin client for /api/acct. The global authFetch interceptor adds the JWT.
const BASE = '/api/acct';

async function req(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const e = new Error((data && data.error) || `Request failed (${res.status})`);
    e.code = data && data.code; e.details = data && data.details; e.status = res.status;
    throw e;
  }
  return data;
}

const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
};

export const acctApi = {
  company: () => req('GET', '/company'),
  voucherTypes: () => req('GET', '/voucher-types'),
  groups: () => req('GET', '/groups'),
  createGroup: (b) => req('POST', '/groups', b),
  ledgers: (f) => req('GET', '/ledgers' + qs(f)),
  saveLedger: (id, b) => (id ? req('PUT', `/ledgers/${id}`, b) : req('POST', '/ledgers', b)),
  ledgerBalance: (id, as_of) => req('GET', `/ledgers/${id}/balance` + qs({ as_of })),
  nextVoucherNo: (voucher_type, as_of) => req('GET', '/next-voucher-no' + qs({ voucher_type, as_of })),
  vouchers: (f) => req('GET', '/vouchers' + qs(f)),
  voucher: (id) => req('GET', `/vouchers/${id}`),
  createVoucher: (b, key) => req('POST', '/vouchers', b, key ? { 'Idempotency-Key': key } : {}),
  updateVoucher: (id, b) => req('PUT', `/vouchers/${id}`, b),
  validate: (id) => req('POST', `/vouchers/${id}/validate`),
  approve: (id) => req('POST', `/vouchers/${id}/approve`),
  post: (id) => req('POST', `/vouchers/${id}/post`),
  reverse: (id, b) => req('POST', `/vouchers/${id}/reverse`, b || {}),
  cancel: (id) => req('POST', `/vouchers/${id}/cancel`),
  createDoc: (b) => req('POST', '/documents', b),
  trialBalance: (f) => req('GET', '/reports/trial-balance' + qs(f)),
  pnl: (f) => req('GET', '/reports/pnl' + qs(f)),
  balanceSheet: (f) => req('GET', '/reports/balance-sheet' + qs(f)),
  ledgerReport: (f) => req('GET', '/reports/ledger' + qs(f)),
  dayBook: (f) => req('GET', '/reports/day-book' + qs(f)),
  register: (f) => req('GET', '/reports/register' + qs(f)),
  cashBank: (f) => req('GET', '/reports/cash-bank' + qs(f)),
  ageing: (f) => req('GET', '/reports/ageing' + qs(f)),
  mesPolicies: () => req('GET', '/link/mes/policies'),
  mesOutbox: (f) => req('GET', '/link/mes/outbox' + qs(f)),
  mesDrain: (b) => req('POST', '/link/mes/drain', b || {}),
  migBatches: () => req('GET', '/migration/batches'),
  migDryRun: (xml) => req('POST', '/migration/dry-run', { xml }),
  migImport: (b) => req('POST', '/migration/import', b),
  migReconcile: (bid) => req('GET', `/migration/${bid}/reconcile`),
  migRollback: (bid) => req('POST', `/migration/${bid}/rollback`),
  mesSyncAll: (b) => req('POST', '/link/mes/sync/all', b || {}),
  mesSync: (src, b) => req('POST', `/link/mes/sync/${src}`, b || {}),
  stockValuation: (f) => req('GET', '/reports/stock-valuation' + qs(f)),
  // Stock items — reuse the MES ERP item master (one source of truth).
  erpItems: async (f) => { const r = await fetch('/api/erp/items' + qs(f)); const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.error) || `Request failed (${r.status})`); return d; },
  gstSummary: async (f) => { const r = await fetch('/api/reports/gst-summary' + qs(f)); const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.error) || `Request failed (${r.status})`); return d; },
  gstr9: async (f) => { const r = await fetch('/api/reports/gstr9' + qs(f)); const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.error) || `Request failed (${r.status})`); return d; },
  gstr1Json: async (f) => { const r = await fetch('/api/reports/gstr1-json' + qs(f)); const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.error) || `Request failed (${r.status})`); return d; },
  gstr3bJson: async (f) => { const r = await fetch('/api/reports/gstr3b-json' + qs(f)); const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.error) || `Request failed (${r.status})`); return d; },
  ewayJson: async (f) => { const r = await fetch('/api/reports/eway-json' + qs(f)); const d = await r.json().catch(() => null); if (!r.ok) throw new Error((d && d.error) || `Request failed (${r.status})`); return d; },
  interest: (f) => req('GET', '/reports/interest' + qs(f)),
  assets: () => req('GET', '/assets'),
  saveAsset: (b) => req('POST', '/assets', b),
  deleteAsset: (id) => req('DELETE', `/assets/${id}`),
  depreciation: (f) => req('GET', '/reports/depreciation' + qs(f)),
  openBills: (ledger_id) => req('GET', '/allocations/open-bills' + qs({ ledger_id })),
  outstandingBills: (f) => req('GET', '/allocations/outstanding' + qs(f)),
  settlementAvail: (ledger_id, settle_voucher_id) => req('GET', '/allocations/settlement' + qs({ ledger_id, settle_voucher_id })),
  allocsForVoucher: (id) => req('GET', `/allocations/voucher/${id}`),
  allocate: (b) => req('POST', '/allocations', b),
  unallocate: (aid) => req('DELETE', `/allocations/${aid}`),
  periods: (fy) => req('GET', '/periods' + qs({ fy_id: fy })),
  setPeriod: (pid, b) => req('PUT', `/periods/${pid}`, b),
  audit: (f) => req('GET', '/audit' + qs(f)),
};

export const fmt = (s) => {
  // "1234.50" -> "1,234.50" (Indian grouping), '' stays blank
  if (s === '' || s === null || s === undefined) return '';
  const neg = String(s).startsWith('-');
  const [i, d] = String(neg ? s.slice(1) : s).split('.');
  const last3 = i.slice(-3), rest = i.slice(0, -3);
  const grp = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
  return (neg ? '-' : '') + grp + (d !== undefined ? '.' + d : '');
};
export const side = (o) => (o && o.amount && o.amount !== '0.00' ? `${fmt(o.amount)} ${o.side}` : '');
export const today = () => new Date().toISOString().slice(0, 10);

// Amount in words, Indian system (Busy prints this on every voucher).
// "1234.50" -> "Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only".
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (x) => (x < 20 ? ONES[x] : (TENS[Math.floor(x / 10)] + (x % 10 ? ' ' + ONES[x % 10] : '')));
const three = (x) => { const h = Math.floor(x / 100), r = x % 100; return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : ''); };
export const inWords = (amt) => {
  const n = Math.round(Number(String(amt == null ? 0 : amt).replace(/,/g, '')) * 100);
  if (!Number.isFinite(n) || n === 0) return '';
  const rupees = Math.floor(n / 100), paise = n % 100;
  const parts = [];
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thou = Math.floor((rupees % 100000) / 1000);
  const hund = rupees % 1000;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thou) parts.push(two(thou) + ' Thousand');
  if (hund) parts.push(three(hund));
  const w = parts.join(' ').trim();
  let s = 'Rupees ' + (w || 'Zero');
  if (paise) s += ' and ' + two(paise) + ' Paise';
  return s + ' Only';
};
