/**
 * Validation runs BEFORE anything is queued.
 *
 * Rejecting bad data at the API boundary is much cheaper than discovering it
 * four retries later on a PC across the factory, and it keeps the queue free
 * of jobs that can never succeed. Validation failures are NOT retryable.
 *
 * Note what is deliberately absent: nothing here validates machine ids, roll
 * numbers, shifts or production state. Those never leave the dashboard.
 */

const { ValidationError } = require('./errors');

// GSTIN: 2-digit state code, 10-char PAN, entity digit, 'Z', checksum char.
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class Issues {
  constructor() {
    this.list = [];
  }
  add(message) {
    this.list.push(message);
  }
  required(value, field) {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      this.add(`${field} is required`);
    }
  }
  throwIfAny(subject, what) {
    if (this.list.length > 0) {
      throw new ValidationError(`${what} failed validation: ${this.list.join('; ')}`, this.list, subject);
    }
  }
}

function checkGstin(issues, gstin, field = 'gstin') {
  if (gstin && !GSTIN_PATTERN.test(String(gstin).toUpperCase())) {
    issues.add(`${field} "${gstin}" is not a valid 15-character GSTIN`);
  }
}

function checkPan(issues, pan) {
  if (pan && !PAN_PATTERN.test(String(pan).toUpperCase())) issues.add(`pan "${pan}" is not a valid PAN`);
}

function checkDate(issues, value, field, required = false) {
  if (!value) {
    if (required) issues.add(`${field} is required`);
    return;
  }
  if (!DATE_PATTERN.test(value)) {
    issues.add(`${field} must be an ISO date (YYYY-MM-DD), got "${value}"`);
    return;
  }
  if (Number.isNaN(Date.parse(value))) issues.add(`${field} "${value}" is not a real date`);
}

function checkLines(issues, lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    issues.add('lines must contain at least one item');
    return;
  }
  lines.forEach((line, i) => {
    const at = `lines[${i}]`;
    issues.required(line && line.itemDhownId, `${at}.itemDhownId`);
    issues.required(line && line.unit, `${at}.unit`);
    if (typeof line.quantity !== 'number' || !Number.isFinite(line.quantity)) {
      issues.add(`${at}.quantity must be a number`);
    } else if (line.quantity <= 0) {
      // A zero or negative dispatch line is either a data-entry slip or an
      // attempted credit note. Neither should be posted as a dispatch.
      issues.add(`${at}.quantity must be greater than zero (got ${line.quantity})`);
    }
    if (line.rate !== undefined && (typeof line.rate !== 'number' || line.rate < 0)) {
      issues.add(`${at}.rate must be a non-negative number`);
    }
    if (line.gstRate !== undefined && (typeof line.gstRate !== 'number' || line.gstRate < 0 || line.gstRate > 100)) {
      issues.add(`${at}.gstRate must be between 0 and 100`);
    }
  });
}

function validateCustomer(c) {
  const issues = new Issues();
  issues.required(c.dhownId, 'dhownId');
  issues.required(c.name, 'name');
  checkGstin(issues, c.gstin);
  checkPan(issues, c.pan);
  if (c.email && !EMAIL_PATTERN.test(c.email)) issues.add(`email "${c.email}" is not valid`);
  if (c.creditDays !== undefined && (!Number.isInteger(c.creditDays) || c.creditDays < 0)) {
    issues.add('creditDays must be a non-negative integer');
  }
  issues.throwIfAny(c.dhownId || c.name || 'customer', 'Customer');
}

function validateVendor(v) {
  const issues = new Issues();
  issues.required(v.dhownId, 'dhownId');
  issues.required(v.name, 'name');
  checkGstin(issues, v.gstin);
  checkPan(issues, v.pan);
  issues.throwIfAny(v.dhownId || v.name || 'vendor', 'Vendor');
}

function validateItem(i) {
  const issues = new Issues();
  issues.required(i.dhownId, 'dhownId');
  issues.required(i.name, 'name');
  issues.required(i.unit, 'unit');
  if (i.hsnCode && !/^\d{4,8}$/.test(String(i.hsnCode))) issues.add(`hsnCode "${i.hsnCode}" must be 4-8 digits`);
  if (i.gstRate !== undefined && (typeof i.gstRate !== 'number' || i.gstRate < 0 || i.gstRate > 100)) {
    issues.add('gstRate must be between 0 and 100');
  }
  issues.throwIfAny(i.dhownId || i.name || 'item', 'Item');
}

function validateWarehouse(w) {
  const issues = new Issues();
  issues.required(w.dhownId, 'dhownId');
  issues.required(w.name, 'name');
  issues.throwIfAny(w.dhownId || w.name || 'warehouse', 'Warehouse');
}

function validateSalesReference(d) {
  const issues = new Issues();
  issues.required(d.dhownId, 'dhownId');
  issues.required(d.documentNumber, 'documentNumber');
  issues.required(d.customerDhownId, 'customerDhownId');
  checkDate(issues, d.documentDate, 'documentDate', true);
  checkDate(issues, d.buyerOrderDate, 'buyerOrderDate');
  checkLines(issues, d.lines);
  issues.throwIfAny(d.documentNumber || d.dhownId || 'sales reference', 'Sales reference');
}

function validatePurchaseReference(d) {
  const issues = new Issues();
  issues.required(d.dhownId, 'dhownId');
  issues.required(d.documentNumber, 'documentNumber');
  issues.required(d.vendorDhownId, 'vendorDhownId');
  checkDate(issues, d.documentDate, 'documentDate', true);
  checkLines(issues, d.lines);
  issues.throwIfAny(d.documentNumber || d.dhownId || 'purchase reference', 'Purchase reference');
}

function validateDispatch(d) {
  const issues = new Issues();
  issues.required(d.dhownId, 'dhownId');
  issues.required(d.documentNumber, 'documentNumber');
  issues.required(d.customerDhownId, 'customerDhownId');
  checkDate(issues, d.documentDate, 'documentDate', true);
  checkLines(issues, d.lines);
  if (d.eWayBillNumber && !/^\d{12}$/.test(String(d.eWayBillNumber))) {
    issues.add(`eWayBillNumber "${d.eWayBillNumber}" must be 12 digits`);
  }
  issues.throwIfAny(d.documentNumber || d.dhownId || 'dispatch', 'Dispatch');
}

function validateInvoice(d) {
  const issues = new Issues();
  issues.required(d.dhownId, 'dhownId');
  issues.required(d.documentNumber, 'documentNumber');
  issues.required(d.customerDhownId, 'customerDhownId');
  checkDate(issues, d.documentDate, 'documentDate', true);
  checkLines(issues, d.lines);

  // If the totals are stated they must agree with the lines. BUSY recomputes
  // tax itself, so a disagreement here means the two systems would end up with
  // different books — better to reject than to reconcile a mismatch later.
  if (d.taxableAmount !== undefined && Array.isArray(d.lines) && d.lines.length > 0) {
    const computed = d.lines.reduce((sum, l) => sum + (l.amount !== undefined ? l.amount : (l.rate || 0) * (l.quantity || 0)), 0);
    if (Math.abs(computed - d.taxableAmount) > 1) {
      issues.add(`taxableAmount ${d.taxableAmount} does not match the sum of line amounts ${computed.toFixed(2)}`);
    }
  }
  issues.throwIfAny(d.documentNumber || d.dhownId || 'invoice', 'Invoice');
}

const VALIDATORS = {
  CUSTOMER: validateCustomer,
  VENDOR: validateVendor,
  ITEM: validateItem,
  WAREHOUSE: validateWarehouse,
  SALES_REFERENCE: validateSalesReference,
  PURCHASE_REFERENCE: validatePurchaseReference,
  DISPATCH: validateDispatch,
  INVOICE: validateInvoice,
};

function validatePayload(entityType, payload) {
  const validator = VALIDATORS[entityType];
  if (!validator) {
    throw new ValidationError(`No validator registered for entity type "${entityType}".`, ['entityType'], entityType);
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Payload must be an object.', ['payload'], entityType);
  }
  validator(payload);
}

module.exports = { validatePayload, VALIDATORS };
