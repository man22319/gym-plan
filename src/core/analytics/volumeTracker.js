/**
 * ══════════════════════════════════════════════════════
 *  Weekly Muscle Volume Tracker
 *  src/core/analytics/volumeTracker.js
 * ══════════════════════════════════════════════════════
 *
 * Pure function — zero side-effects.
 * Input:  history[] + a target date
 * Output: effective sets per muscle group over the 7 days preceding targetDate
 *
 * ## Effective Set Definition
 * A set contributes a weighted scalar per muscle group based on STIMULUS_COEFFICIENTS.
 * Example: 1 completed set of thu_row contributes:
 *   BACK: 1.0 effective set, BICEPS: 0.3 effective sets
 *
 * ## Rules (per TODO §2)
 * - Only completed sets (s === 'done') are counted
 * - Planned or incomplete sets are ignored
 * - Raw set counts are NOT used — only stimulus-weighted effective sets
 * - Output schema is { [MuscleGroup]: { effectiveSets: number, status: string } }
 *
 * ## Status thresholds (per TODO §2)
 * - < 6       → "undertrained"
 * - 6 – 9     → "maintenance"
 * - 10 – 20   → "optimal"
 * - > 20      → "optimal" (no upper label defined; capped at optimal)
 */

import { MUSCLE_GROUPS, getExerciseWeights } from '../constants/stimulusWeights.js';

// ── Status Classification ─────────────────────────────────────────────────────

/**
 * Classify weekly effective set count into a volume status label.
 * @param {number} effectiveSets
 * @returns {'undertrained'|'maintenance'|'optimal'}
 */
function classifyVolume(effectiveSets) {
  if (effectiveSets < 6)  return 'undertrained';
  if (effectiveSets <= 9) return 'maintenance';
  return 'optimal';
}

// ── Core Function ─────────────────────────────────────────────────────────────

/**
 * Compute weekly effective training volume per muscle group.
 *
 * Scans the 7 days strictly preceding `targetDate` (i.e. [targetDate − 7d, targetDate)).
 * Only history entries with `s === 'done'` sets are counted.
 * Each exercise's sets are weighted by its stimulus coefficients.
 *
 * History entry shape expected:
 * {
 *   timestamp: number,          // ms epoch
 *   exercises: {
 *     [exId: string]: Array<{ s: string, w: number|null, r: number|null, n: string }>
 *   }
 * }
 *
 * @param {object[]} history     - Full history array (any order)
 * @param {Date|number} targetDate - Reference point; computes volume for the 7 days before this
 * @returns {Record<string, { effectiveSets: number, status: string }>}
 */
export function calculateWeeklyVolume(history, targetDate) {
  const refMs    = targetDate instanceof Date ? targetDate.getTime() : targetDate;
  const weekMs   = 7 * 24 * 60 * 60 * 1000;
  const windowStart = refMs - weekMs;

  // Accumulate effective sets per muscle group
  const totals = Object.fromEntries(MUSCLE_GROUPS.map(mg => [mg, 0]));

  for (const entry of (history || [])) {
    // Only entries within the 7-day window preceding targetDate
    if (entry.timestamp < windowStart || entry.timestamp >= refMs) continue;

    for (const [exId, sets] of Object.entries(entry.exercises || {})) {
      const weights = getExerciseWeights(exId);

      // Count completed sets only
      const completedCount = (sets || []).filter(s => s.s === 'done').length;
      if (completedCount === 0) continue;

      // Apply stimulus weights to each muscle group this exercise touches
      for (const [muscleGroup, coefficient] of Object.entries(weights)) {
        if (MUSCLE_GROUPS.includes(muscleGroup)) {
          totals[muscleGroup] += completedCount * coefficient;
        }
      }
    }
  }

  // Build output schema: { MUSCLE: { effectiveSets, status } }
  const result = {};
  for (const mg of MUSCLE_GROUPS) {
    const effectiveSets = +totals[mg].toFixed(2);
    result[mg] = {
      effectiveSets,
      status: classifyVolume(effectiveSets)
    };
  }

  return result;
}
