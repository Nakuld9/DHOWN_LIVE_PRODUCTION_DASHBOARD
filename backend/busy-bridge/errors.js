/**
 * Error classification for the BUSY bridge.
 *
 * Every failure that crosses the adapter boundary is classified into one of
 * the codes below. The class decides two things the rest of the system needs:
 *
 *   1. Is it worth retrying? (transport hiccups yes, bad data no)
 *   2. What does a human have to do about it?
 *
 * Nothing is ever silently discarded. A failure we cannot classify becomes
 * UNKNOWN_ERROR and is surfaced, not swallowed.
 */

/** Whether a class of failure can be fixed by simply trying again. */
const RETRYABLE = {
  CONNECTION_ERROR: true,      // BUSY PC offline / share unreachable
  TIMEOUT: true,               // BUSY busy or slow
  UNKNOWN_ERROR: true,         // unclassified: retry a bounded number of times
  AUTHENTICATION_ERROR: false, // bad credentials — retrying cannot help
  VALIDATION_ERROR: false,     // bad payload — needs a data fix
  MASTER_MAPPING_ERROR: false, // needs a human to map the master
  DUPLICATE_ERROR: false,      // already in BUSY — reconcile, do not resend
  BUSY_TRANSACTION_ERROR: false, // BUSY rejected it on business grounds
  UNSUPPORTED_OPERATION: false,  // this BUSY install cannot do it at all
};

class BridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.retryable = RETRYABLE[code] === true;
    this.details = details;
  }

  /**
   * Operator-facing explanation, written for the supervisor who has to fix it:
   *
   *   FAILED   Dispatch DH-DSP-00091
   *   Reason:  DHOWN item "FC-00125" is not mapped to a BUSY item.
   *   Action:  Map DHOWN item "FC-00125" to the matching BUSY item, then retry.
   */
  explain() {
    const subject = this.details.subject;
    switch (this.code) {
      case 'CONNECTION_ERROR':
        return {
          reason: `The BUSY machine could not be reached. ${this.message}`,
          action:
            'No action needed yet — the transaction stays queued and is retried automatically. ' +
            'If this persists, check that the BUSY PC is switched on and its shared folder is reachable from this PC.',
        };
      case 'AUTHENTICATION_ERROR':
        return {
          reason: `BUSY rejected the bridge's credentials. ${this.message}`,
          action:
            'Check the BUSY credentials in the backend .env file. Retrying will not help until they are corrected.',
        };
      case 'VALIDATION_ERROR':
        return {
          reason: `The transaction failed validation before it was sent to BUSY. ${this.message}`,
          action: subject ? `Correct "${subject}" in the record, then retry.` : 'Correct the record, then retry.',
        };
      case 'MASTER_MAPPING_ERROR': {
        // Name the kind of record too, so the operator knows which mapping to open.
        const kind = typeof this.details.entityType === 'string' ? this.details.entityType.toLowerCase() : 'record';
        return {
          reason: subject
            ? `DHOWN ${kind} "${subject}" is not mapped to a BUSY ${kind}.`
            : `A master record is not mapped to BUSY. ${this.message}`,
          action: subject
            ? `Map DHOWN ${kind} "${subject}" to the matching BUSY ${kind}, then retry.`
            : 'Create the missing master mapping, then retry.',
        };
      }
      case 'DUPLICATE_ERROR':
        return {
          reason: `BUSY already holds this transaction. ${this.message}`,
          action: 'No resend is needed. Reconcile to attach the existing BUSY reference to the DHOWN record.',
        };
      case 'BUSY_TRANSACTION_ERROR':
        return {
          reason: `BUSY rejected the transaction. ${this.message}`,
          action: 'Review the BUSY response, correct the transaction here or in BUSY, then retry.',
        };
      case 'TIMEOUT':
        return {
          reason: `BUSY did not respond in time. ${this.message}`,
          action:
            'The transaction stays queued and is retried automatically. ' +
            'Confirm in BUSY that it was not partially posted before forcing a manual retry.',
        };
      case 'UNSUPPORTED_OPERATION':
        return {
          reason: `This BUSY installation does not support that operation. ${this.message}`,
          action:
            'This is a capability limit of the configured BUSY edition or transport, not a transient fault. ' +
            'See docs/BUSY_INTEGRATION.md for the capability matrix.',
        };
      default:
        return {
          reason: `An unexpected error occurred. ${this.message}`,
          action: 'Review the payload and the BUSY response in the audit log, then decide whether to retry.',
        };
    }
  }

  toJSON() {
    const { reason, action } = this.explain();
    return { code: this.code, message: this.message, retryable: this.retryable, reason, action, details: this.details };
  }
}

class UnsupportedOperationError extends BridgeError {
  constructor(operation, adapter) {
    super('UNSUPPORTED_OPERATION', `Operation "${operation}" is not supported by the "${adapter}" BUSY adapter.`, {
      action: 'CONTACT_SUPPORT',
      subject: operation,
    });
    this.name = 'UnsupportedOperationError';
  }
}

class ValidationError extends BridgeError {
  constructor(message, issues = [], subject) {
    super('VALIDATION_ERROR', message, { action: 'FIX_DATA', subject, issues });
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

class MappingError extends BridgeError {
  constructor(entityType, dhownId) {
    super('MASTER_MAPPING_ERROR', `No BUSY mapping exists for ${entityType} "${dhownId}".`, {
      action: 'FIX_MAPPING',
      subject: dhownId,
      entityType,
    });
    this.name = 'MappingError';
  }
}

/**
 * Normalise anything thrown anywhere into a classified BridgeError.
 *
 * Windows network shares fail in specific ways, and those codes decide retry
 * behaviour — a disconnected share must read as CONNECTION_ERROR (retry when
 * it comes back), not as an unknown fault.
 */
function classifyError(err) {
  if (err instanceof BridgeError) return err;

  const code = err && err.code;
  const name = err && err.name;
  const message = (err && err.message) || String(err);

  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || name === 'AbortError' || name === 'TimeoutError') {
    return new BridgeError('TIMEOUT', message, { action: 'CHECK_CONNECTION' });
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EPIPE' ||
    code === 'ENOENT' ||    // share path missing => BUSY PC not mounted
    code === 'ENOTDIR' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'EBUSY' ||
    code === 'ENETDOWN' ||  // Windows: network is down
    code === 'EREMOTEIO' ||
    code === 'EIO'          // Windows: stale/disconnected SMB handle
  ) {
    return new BridgeError('CONNECTION_ERROR', message, { action: 'CHECK_CONNECTION' });
  }
  return new BridgeError('UNKNOWN_ERROR', message, { action: 'CONTACT_SUPPORT' });
}

module.exports = {
  BridgeError,
  UnsupportedOperationError,
  ValidationError,
  MappingError,
  classifyError,
  RETRYABLE,
};
