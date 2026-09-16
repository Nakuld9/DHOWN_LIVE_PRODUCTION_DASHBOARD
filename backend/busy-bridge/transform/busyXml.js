/**
 * DHOWN -> BUSY XML transformation.
 *
 * IMPORTANT, and stated here rather than buried in a ticket: the element names
 * below follow BUSY's Data Export/Import structure as described in the audit,
 * but they have NOT yet been validated against a sample export from the
 * factory's actual BUSY installation (docs/BUSY_INTEGRATION.md section 6.3 is
 * still open). BUSY's XML dialect varies by version and edition.
 *
 * This is the ONLY file that needs to change when real samples arrive. Nothing
 * downstream parses these names, so correcting them is a contained edit.
 */

const { MappingError } = require('../errors');

const PAYLOAD_VERSION = 1;

/** XML text escaping. Applied to every interpolated value without exception. */
function esc(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters illegal in XML 1.0, which would make BUSY
    // reject a whole file over one stray byte in a free-text remark.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function tag(name, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<${name}>${esc(value)}</${name}>`;
}

function optionalTags(pairs, indent) {
  return pairs
    .map(([k, v]) => tag(k, v))
    .filter(Boolean)
    .map((t) => `${indent}${t}`)
    .join('\n');
}

/** BUSY's import format is DD-MM-YYYY. */
function busyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return '';
  return `${d}-${m}-${y}`;
}

function envelope(company, kind, externalReference, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<BUSYDATA>
  <HEADER>
    <COMPANY>${esc(company)}</COMPANY>
    <DATATYPE>${kind}</DATATYPE>
    <SOURCE>DHOWN-LIVE-PRODUCTION-DASHBOARD</SOURCE>
    <EXTERNALREFERENCE>${esc(externalReference)}</EXTERNALREFERENCE>
    <PAYLOADVERSION>${PAYLOAD_VERSION}</PAYLOADVERSION>
    <GENERATEDAT>${esc(new Date().toISOString())}</GENERATEDAT>
  </HEADER>
  <BODY>
${body}
  </BODY>
</BUSYDATA>
`;
}

/**
 * Resolve a document line's item to its BUSY identity.
 * Throws MASTER_MAPPING_ERROR naming the offending DHOWN item, which is what
 * produces the operator's "Map DHOWN item FC-00125 ..." message.
 */
function resolveLineItem(line, ctx) {
  const resolved = ctx.itemBusyIds[line.itemDhownId];
  if (!resolved) throw new MappingError('ITEM', line.itemDhownId);
  return resolved;
}

function renderLines(lines, ctx) {
  return lines
    .map((line, index) => {
      const item = resolveLineItem(line, ctx);
      const amount =
        line.amount !== undefined ? line.amount : line.rate !== undefined ? +(line.rate * line.quantity).toFixed(2) : undefined;
      return `      <ITEM>
        <SRNO>${index + 1}</SRNO>
        <ITEMCODE>${esc(item.busyCode || item.busyId)}</ITEMCODE>
        <ITEMID>${esc(item.busyId)}</ITEMID>
        <QTY>${esc(line.quantity)}</QTY>
        <UNIT>${esc(line.unit)}</UNIT>
${optionalTags(
  [
    ['RATE', line.rate],
    ['DISCOUNTPERCENT', line.discountPercent],
    ['AMOUNT', amount],
    ['HSNCODE', line.hsnCode],
    ['GSTRATE', line.gstRate],
    // Roll numbers may ride along here so they print on the challan. The
    // bridge attaches no meaning to them and BUSY receives them as text.
    ['REMARK', line.remark],
  ],
  '        ',
)}
      </ITEM>`;
    })
    .join('\n');
}

function requireParty(ctx, entityType, dhownId) {
  if (!ctx.partyBusyId) throw new MappingError(entityType, dhownId);
  return ctx.partyBusyId;
}

// ── Masters ─────────────────────────────────────────────────────

function customerToXml(c, ctx, company) {
  const addr = c.billingAddress || {};
  const body = `    <ACCOUNT>
      <ACTION>UPSERT</ACTION>
      <EXTERNALID>${esc(c.dhownId)}</EXTERNALID>
      <NAME>${esc(c.name)}</NAME>
      <GROUP>Sundry Debtors</GROUP>
${optionalTags(
  [
    ['CODE', ctx.partyBusyCode || c.code],
    ['BUSYID', ctx.partyBusyId],
    ['GSTIN', c.gstin && String(c.gstin).toUpperCase()],
    ['PAN', c.pan && String(c.pan).toUpperCase()],
    ['EMAIL', c.email],
    ['PHONE', c.phone],
    ['ADDRESS1', addr.line1],
    ['ADDRESS2', addr.line2],
    ['CITY', addr.city],
    ['STATE', addr.state],
    ['STATECODE', addr.stateCode],
    ['PINCODE', addr.pincode],
    ['COUNTRY', addr.country || 'India'],
    ['CREDITDAYS', c.creditDays],
    ['CREDITLIMIT', c.creditLimit],
    ['ACTIVE', c.active === false ? 'N' : 'Y'],
  ],
  '      ',
)}
    </ACCOUNT>`;
  return envelope(company, 'MASTERS', ctx.externalReference, body);
}

function vendorToXml(v, ctx, company) {
  const addr = v.address || {};
  const body = `    <ACCOUNT>
      <ACTION>UPSERT</ACTION>
      <EXTERNALID>${esc(v.dhownId)}</EXTERNALID>
      <NAME>${esc(v.name)}</NAME>
      <GROUP>Sundry Creditors</GROUP>
${optionalTags(
  [
    ['CODE', ctx.partyBusyCode || v.code],
    ['BUSYID', ctx.partyBusyId],
    ['GSTIN', v.gstin && String(v.gstin).toUpperCase()],
    ['PAN', v.pan && String(v.pan).toUpperCase()],
    ['EMAIL', v.email],
    ['PHONE', v.phone],
    ['ADDRESS1', addr.line1],
    ['CITY', addr.city],
    ['STATE', addr.state],
    ['STATECODE', addr.stateCode],
    ['PINCODE', addr.pincode],
    ['COUNTRY', addr.country || 'India'],
    ['ACTIVE', v.active === false ? 'N' : 'Y'],
  ],
  '      ',
)}
    </ACCOUNT>`;
  return envelope(company, 'MASTERS', ctx.externalReference, body);
}

function itemToXml(i, ctx, company) {
  const existing = ctx.itemBusyIds[i.dhownId];
  const body = `    <STOCKITEM>
      <ACTION>UPSERT</ACTION>
      <EXTERNALID>${esc(i.dhownId)}</EXTERNALID>
      <NAME>${esc(i.name)}</NAME>
      <UNIT>${esc(i.unit)}</UNIT>
${optionalTags(
  [
    ['CODE', i.code],
    ['BUSYID', existing && existing.busyId],
    ['GROUP', i.group],
    ['HSNCODE', i.hsnCode],
    ['GSTRATE', i.gstRate],
    ['ACTIVE', i.active === false ? 'N' : 'Y'],
  ],
  '      ',
)}
    </STOCKITEM>`;
  return envelope(company, 'MASTERS', ctx.externalReference, body);
}

// ── Vouchers ────────────────────────────────────────────────────

function voucher(voucherType, doc, partyBusyId, ctx, extra, company) {
  const body = `    <VOUCHER>
      <VOUCHERTYPE>${esc(voucherType)}</VOUCHERTYPE>
      <ACTION>CREATE</ACTION>
      <EXTERNALREFERENCE>${esc(ctx.externalReference)}</EXTERNALREFERENCE>
      <VOUCHERNO>${esc(doc.documentNumber)}</VOUCHERNO>
      <DATE>${esc(busyDate(doc.documentDate))}</DATE>
      <PARTYID>${esc(partyBusyId)}</PARTYID>
${optionalTags(
  [
    ['PARTYCODE', ctx.partyBusyCode],
    ['WAREHOUSEID', ctx.warehouseBusyId],
    ['CURRENCY', doc.currency || 'INR'],
    ...extra,
    ['NARRATION', doc.notes],
  ],
  '      ',
)}
      <ITEMS>
${renderLines(doc.lines, ctx)}
      </ITEMS>
    </VOUCHER>`;
  return envelope(company, 'VOUCHERS', ctx.externalReference, body);
}

function salesReferenceToXml(d, ctx, company) {
  return voucher(
    'Sales Order',
    d,
    requireParty(ctx, 'CUSTOMER', d.customerDhownId),
    ctx,
    [
      ['BUYERORDERNO', d.buyerOrderNumber],
      ['BUYERORDERDATE', busyDate(d.buyerOrderDate)],
    ],
    company,
  );
}

function purchaseReferenceToXml(d, ctx, company) {
  return voucher(
    'Purchase Order',
    d,
    requireParty(ctx, 'VENDOR', d.vendorDhownId),
    ctx,
    [['VENDORINVOICENO', d.vendorInvoiceNumber]],
    company,
  );
}

function dispatchToXml(d, ctx, company) {
  // Delivery Challan: stock leaves the factory, the invoice follows.
  return voucher(
    'Delivery Challan',
    d,
    requireParty(ctx, 'CUSTOMER', d.customerDhownId),
    ctx,
    [
      ['VEHICLENO', d.vehicleNumber],
      ['TRANSPORTER', d.transporterName],
      ['LRNO', d.lrNumber],
      ['EWAYBILLNO', d.eWayBillNumber],
      ['DISPATCHEDAT', d.dispatchedAt],
      ['AGAINSTORDER', d.salesReferenceDhownId],
    ],
    company,
  );
}

function invoiceToXml(d, ctx, company) {
  return voucher(
    'Sales',
    d,
    requireParty(ctx, 'CUSTOMER', d.customerDhownId),
    ctx,
    [
      ['AGAINSTCHALLAN', d.dispatchDhownId],
      ['PLACEOFSUPPLY', d.placeOfSupply],
      ['TAXABLEAMOUNT', d.taxableAmount],
      ['TAXAMOUNT', d.taxAmount],
      ['TOTALAMOUNT', d.totalAmount],
    ],
    company,
  );
}

module.exports = {
  PAYLOAD_VERSION,
  esc,
  busyDate,
  customerToXml,
  vendorToXml,
  itemToXml,
  salesReferenceToXml,
  purchaseReferenceToXml,
  dispatchToXml,
  invoiceToXml,
};
