// ==========================================
// ─── EWMA UTILITY ───
// ==========================================
// Reusable Exponentially Weighted Moving Average with:
//   - configurable learning rate (alpha)
//   - optional upper/lower clipping (winsorization)
//   - online variance tracking (Welford-style, exponentially weighted)
//   - seed initialization from first N observations
//
// Replaces inline EWMA loops in eta.js (computeEWMA, historicalSessionDuration,
// historicalOverhead) with a single tested implementation.
// ==========================================

/**
 * @typedef {object} EWMAOptions
 * @property {number}  [alpha=0.3]       — learning rate (0–1). Higher = more reactive.
 * @property {number}  [clipUpper=Infinity] — winsorize values above this
 * @property {number}  [clipLower=-Infinity] — winsorize values below this
 * @property {number}  [seedCount=2]     — average the first N values as the seed
 * @property {number}  [rejectBelow=0]   — values below this are rejected (replaced with current mean)
 */

export class EWMA {
  /**
   * @param {EWMAOptions} [opts]
   */
  constructor(opts = {}) {
    this.alpha      = opts.alpha      ?? 0.3;
    this.clipUpper  = opts.clipUpper  ?? Infinity;
    this.clipLower  = opts.clipLower  ?? -Infinity;
    this.seedCount  = opts.seedCount  ?? 2;
    this.rejectBelow = opts.rejectBelow ?? 0;

    this._mean      = 0;
    this._variance  = 0;
    this._count     = 0;
    this._seedSum   = 0;
    this._seedN     = 0;
    this._seeded    = false;
  }

  /**
   * Feed a new observation into the EWMA.
   *
   * During the seed phase (first seedCount observations), values are averaged
   * to establish a stable initial estimate.  After seeding, each value updates
   * the exponential moving average and variance.
   *
   * @param {number} value
   * @returns {EWMA} this (for chaining)
   */
  update(value) {
    // Reject sub-threshold values (likely misfires)
    if (value < this.rejectBelow) {
      // If we have an estimate, silently ignore.  If not, can't reject.
      if (this._seeded) return this;
    }

    // Seed phase: accumulate the first seedCount values
    if (!this._seeded) {
      this._seedSum += value;
      this._seedN++;
      this._count++;
      if (this._seedN >= this.seedCount) {
        this._mean = this._seedSum / this._seedN;
        this._seeded = true;
      } else if (this.seedCount <= 1) {
        this._mean = value;
        this._seeded = true;
      }
      return this;
    }

    // Clip (winsorize toward bounds, don't reject)
    let x = value;
    if (this.clipUpper !== Infinity && this.clipUpper > 1 && this.clipUpper <= 10) {
      // Multiplier-style clipping: clipUpper is a multiplier of current mean
      const upperBound = Math.min(this._mean * this.clipUpper, this.clipUpper === Infinity ? Infinity : 600_000);
      if (x > upperBound) x = upperBound;
    } else if (x > this.clipUpper) {
      x = this.clipUpper;
    }
    if (x < this.clipLower) x = this.clipLower;

    // Reject below threshold
    if (x < this.rejectBelow) x = this._mean;

    // EWMA update
    const diff = x - this._mean;
    this._mean += this.alpha * diff;
    this._variance = (1 - this.alpha) * (this._variance + this.alpha * diff * diff);
    this._count++;

    return this;
  }

  /** Current exponentially weighted mean. */
  get mean() { return this._mean; }

  /** Current exponentially weighted variance. */
  get variance() { return this._variance; }

  /** Total observations processed (including seed phase). */
  get count() { return this._count; }

  /** Coefficient of variation (std / mean). Returns 0 if mean is 0. */
  get cv() {
    if (this._mean === 0) return 0;
    return Math.sqrt(this._variance) / this._mean;
  }

  /** Whether the seed phase is complete and estimates are available. */
  get ready() { return this._seeded; }

  /**
   * Create an EWMA from a pre-existing array of values.
   *
   * @param {number[]} values — chronological observations
   * @param {EWMAOptions} [opts]
   * @returns {EWMA}
   */
  static fromArray(values, opts = {}) {
    const ewma = new EWMA(opts);
    for (const v of values) ewma.update(v);
    return ewma;
  }
}
