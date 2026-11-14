// Turn a Postgres constraint violation into something a person can act on.
//
// Foreign keys on the money tables mean some deletes are now correctly refused —
// you cannot remove a customer who has invoices. Without translation that
// surfaces as a 500 carrying text like:
//
//   update or delete on table "partners" violates foreign key constraint
//   "tax_invoices_partner_id_fk" on table "tax_invoices"
//
// which reads like a crash rather than the deliberate protection it is. A
// refusal that looks like a bug gets "fixed" by removing the protection.

// Constraint name -> what the user should understand. Falls back to a generic
// sentence naming the table, so a constraint added later is still readable.
const EXPLAIN = {
  tax_invoices_partner_id_fk:            'this customer has invoices',
  payments_partner_id_fk:                'this customer has receipts recorded',
  payment_allocations_invoice_id_fk:     'money has been allocated to this invoice',
  sales_returns_partner_id_fk:           'this customer has sales returns',
  sales_returns_invoice_id_fk:           'this invoice has a sales return against it',
  sales_returns_dispatch_id_fk:          'this dispatch has a sales return against it',
  credit_notes_partner_id_fk:            'this customer has credit notes',
  credit_notes_invoice_id_fk:            'this invoice has a credit note against it',
  credit_note_allocations_invoice_id_fk: 'a credit note is applied to this invoice',
  lot_allocations_partner_id_fk:         'this customer has stock allocated',
  lot_allocation_rolls_roll_id_fk:       'this roll is allocated to an order',
  eway_bills_dispatch_id_fk:             'this dispatch has an e-way bill',
  eway_bills_invoice_id_fk:              'this invoice has an e-way bill',
  eway_bills_partner_id_fk:              'this customer has e-way bills',
  delivery_proofs_dispatch_id_fk:        'this dispatch has a proof of delivery',
};

const TABLE_WORD = {
  tax_invoices: 'invoices', payments: 'receipts', sales_returns: 'sales returns',
  credit_notes: 'credit notes', eway_bills: 'e-way bills', delivery_proofs: 'delivery proofs',
  lot_allocations: 'stock allocations', payment_allocations: 'payment allocations',
  credit_note_allocations: 'credit note allocations', lot_allocation_rolls: 'roll allocations',
};

// Returns { status, error } for a known constraint violation, or null if this is
// not one — callers should keep their existing handling in that case.
function friendly(err) {
  if (!err || !err.code) return null;

  // 23503 is raised when a row REFERENCES something missing (a bad insert).
  // 23001 is raised when a delete is refused by ON DELETE RESTRICT — a different
  // code for the same family, and the one every blocked delete here produces.
  // Handling only 23503 would have let every refusal surface as a raw 500.
  if (err.code === '23503' || err.code === '23001') {
    const why = EXPLAIN[err.constraint]
      || (err.table ? `it is referenced by ${TABLE_WORD[err.table] || err.table}` : 'it is still referenced');
    return {
      status: 409,
      error: `Cannot delete: ${why}. Cancel or reassign those records first — financial history is kept deliberately.`,
    };
  }

  if (err.code === '23505') {                       // unique violation
    return { status: 409, error: 'That already exists.' };
  }

  if (err.code === '23502') {                       // not-null violation
    return { status: 400, error: `${err.column || 'A required field'} is required.` };
  }

  if (err.code === '23514') {                       // check constraint
    // The domain constraints added by ensureCheckConstraints() are named
    // ck_<table>__<column>_nonneg / _valid — a DOUBLE underscore separates the
    // table from the column, because single underscores appear inside both and
    // the column could not otherwise be recovered. "That value is not allowed"
    // tells an operator nothing about which of twenty fields to fix.
    const m = /^ck_.+?__([a-z0-9_]+)_(nonneg|valid)$/.exec(err.constraint || '');
    if (m) {
      const field = m[1].replace(/_/g, ' ');
      return {
        status: 400,
        error: m[2] === 'nonneg'
          ? `${field.charAt(0).toUpperCase() + field.slice(1)} cannot be negative.`
          : `That is not a valid ${field}.`,
      };
    }
    return { status: 400, error: 'That value is not allowed.' };
  }

  return null;
}

// Express error middleware, for anything a handler did not catch itself.
function dbErrorHandler(err, req, res, next) {
  const f = friendly(err);
  if (!f) return next(err);
  res.status(f.status).json({ error: f.error });
}

module.exports = { friendly, dbErrorHandler };
