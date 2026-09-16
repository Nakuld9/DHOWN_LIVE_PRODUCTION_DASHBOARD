/**
 * Exponential backoff with bounded attempts.
 *
 * Attempt 1 -> Attempt 2 -> Attempt 3 -> Attempt 4 -> MANUAL_REVIEW
 *
 * Two deliberate properties:
 *
 *  - It STOPS. After maxAttempts the job is parked in MANUAL_REVIEW for a
 *    supervisor. Retrying forever turns one bad record into permanent load and
 *    hides the failure instead of surfacing it.
 *
 *  - Jitter. Without it, a BUSY outage that fails 200 queued jobs makes all
 *    200 retry in the same millisecond when the BUSY PC comes back, and knocks
 *    it over again. The delay is uniform in [base/2, base].
 */
class RetryPolicy {
  constructor(opts, random = Math.random) {
    this.opts = opts;
    this.random = random;
  }

  get maxAttempts() {
    return this.opts.maxAttempts;
  }

  /** Should a job that has now made `attemptCount` attempts be retried? */
  shouldRetry(attemptCount, retryable) {
    if (!retryable) return false;
    return attemptCount < this.opts.maxAttempts;
  }

  /** Delay before the attempt that follows `attemptCount` completed attempts. */
  delayMs(attemptCount) {
    const exponent = Math.max(0, attemptCount - 1);
    const uncapped = this.opts.baseDelayMs * Math.pow(2, exponent);
    const capped = Math.min(uncapped, this.opts.maxDelayMs);
    return Math.round(capped / 2 + this.random() * (capped / 2));
  }

  nextRetryAt(attemptCount, from = new Date()) {
    return new Date(from.getTime() + this.delayMs(attemptCount));
  }
}

module.exports = { RetryPolicy };
