/**
 * External references are the bridge's idempotency keys.
 *
 * Format:  DHOWN-<ENTITY>-<YEAR>-<SEQUENCE>
 * Example: DHOWN-DISPATCH-2026-000091
 *
 * Two properties matter and both are load-bearing:
 *
 *  1. DETERMINISTIC. The same DHOWN record always produces the same reference,
 *     so a duplicate submission (retry, double-click, replayed request)
 *     collapses onto the same key instead of creating a second BUSY voucher.
 *  2. UNIQUE. Enforced by a UNIQUE index in PostgreSQL, not just by this
 *     function, so a race between two requests cannot produce a duplicate.
 */

const { ValidationError } = require('./errors');

const PREFIX = 'DHOWN';
const SEQUENCE_WIDTH = 6;

const EXTERNAL_REF_PATTERN = /^DHOWN-[A-Z_]+-\d{4}-\d{6,}$/;

/**
 * Derive the numeric sequence from the document number.
 *
 * Document numbers carry a sequence already (DH-DSP-00091 -> 91). Reusing it
 * keeps the BUSY reference legible to whoever is comparing the two systems
 * side by side, which is what reconciliation looks like in practice.
 *
 * A document number with no digits gives us no stable sequence, and inventing
 * one would break determinism — so we refuse rather than guess.
 */
function deriveSequence(documentNumber) {
  const digits = String(documentNumber).match(/\d+/g);
  if (!digits || digits.length === 0) {
    throw new ValidationError(
      `Cannot derive an idempotency sequence from document number "${documentNumber}": it contains no digits.`,
      ['documentNumber must contain at least one digit'],
      documentNumber,
    );
  }
  // Last numeric group is the document sequence in every numbering scheme in
  // use (DH-DSP-00091, DH/INV/2026/0042).
  const last = digits[digits.length - 1];
  const normalised = last.replace(/^0+/, '') || '0';
  return normalised.padStart(SEQUENCE_WIDTH, '0');
}

function buildExternalReference(entityType, documentNumber, fiscalYear) {
  const year = String(fiscalYear || new Date().getUTCFullYear()).trim();
  if (!/^\d{4}$/.test(year)) {
    throw new ValidationError(`Fiscal year must be a 4-digit year, got "${year}".`, ['fiscalYear'], documentNumber);
  }
  return `${PREFIX}-${entityType}-${year}-${deriveSequence(documentNumber)}`;
}

/**
 * Master records have no document number. Their identity is the DHOWN id,
 * which is already stable, so the reference is built from that directly.
 */
function buildMasterExternalReference(entityType, dhownId) {
  const safe = String(dhownId).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
  if (!safe) {
    throw new ValidationError(`Cannot build an external reference from DHOWN id "${dhownId}".`, ['dhownId'], dhownId);
  }
  const year = new Date().getUTCFullYear();
  const digits = safe.match(/\d+/g);
  if (digits) {
    return `${PREFIX}-${entityType}-${year}-${digits.join('').slice(-12).padStart(SEQUENCE_WIDTH, '0')}`;
  }
  // Purely alphabetic ids: a stable hash keeps the reference deterministic.
  let hash = 0;
  for (const ch of safe) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${PREFIX}-${entityType}-${year}-${String(hash % 1000000).padStart(SEQUENCE_WIDTH, '0')}`;
}

function parseExternalReference(ref) {
  if (!EXTERNAL_REF_PATTERN.test(ref)) return null;
  const parts = ref.split('-');
  const sequence = parts[parts.length - 1];
  const year = parts[parts.length - 2];
  const entityType = parts.slice(1, parts.length - 2).join('-');
  return { entityType, year, sequence };
}

/**
 * Filenames are derived from the reference and land on a shared folder on the
 * BUSY PC. Anything not matching the pattern is refused so a crafted value
 * cannot escape the exchange directory.
 */
function assertSafeReference(ref) {
  if (!EXTERNAL_REF_PATTERN.test(ref)) {
    throw new ValidationError(
      `Refusing to use "${ref}" as a filename: not a valid external reference.`,
      ['externalReference'],
      ref,
    );
  }
}

module.exports = {
  buildExternalReference,
  buildMasterExternalReference,
  parseExternalReference,
  deriveSequence,
  assertSafeReference,
  EXTERNAL_REF_PATTERN,
};
