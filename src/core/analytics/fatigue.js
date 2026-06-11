/**
 * ══════════════════════════════════════════════════════
 *  Fatigue Trend Analysis
 *  src/core/analytics/fatigue.js
 * ══════════════════════════════════════════════════════
 *
 * Pure function — zero side-effects, no imports.
 * All history and session data is passed in.
 *
 * Metrics computed per rolling window:
 *   • Rolling Systemic Volume  — Σ(weight × reps) for ALL done sets across
 *                                ALL exercises in the window.
 *   • Average E1RM             — mean of per-exercise best E1RM across all
 *                                primary compounds (exercises with weight data).
 *
 * A fatigue WARNING is raised when:
 *   1. Current week avg is >5% below the previous week's avg on EITHER metric.
 *   2. That drop is NOT explained by a planned deload (intensity flag on entry).
 *
 * E1RM formula (Epley): weight * (1 + reps / 30)
 */

// ── Helpers ───────────────────────────────────────────

/**
 * Compute Epley E1RM for a single set.
 * @param {number|null} w
 * @param {number|null} r
 * @returns {number|null}
 */
function _e1rm(w, r) {
  if (w === null || r === null || w <= 0 || r <= 0) return null;
  return w * (1 + r / 30);
}

/**
 * Returns the best E1RM across all 'done' sets with both weight & reps.
 * Falls back to max(w*r) volume if E1RM can't be computed.
 * @param {Array<{s:string, w:number|null, r:number|null}>} sets
 * @returns {number|null}
 */
function _bestE1rm(sets) {
  if (!sets || !sets.length) return null;
  const done = sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
  if (!done.length) return null;

  let best = null;
  for (const s of done) {
    const e = _e1rm(s.w, s.r);
    if (e !== null && (best === null || e > best)) best = e;
  }
  // Fallback
  if (best === null) {
    for (const s of done) {
      const vol = (s.w ?? 0) * (s.r ?? 0);
      if (best === null || vol > best) best = vol;
    }
  }
  return best;
}

/**
 * Compute total volume (Σ w*r) for all done sets across an entire history entry.
 * @param {{ exercises: Record<string, Array<{s:string, w:number|null, r:number|null}>> }} entry
 * @param {object} exerciseIndex
 * @returns {number}
 */
function _entryVolume(entry, exerciseIndex = {}) {
  let vol = 0;
  for (const [exId, sets] of Object.entries(entry.exercises || {})) {
    if (exerciseIndex[exId]?.invariant) continue;
    for (const s of sets) {
      if (s.s === 'done' && s.w !== null && s.r !== null) {
        vol += s.w * s.r;
      }
    }
  }
  return vol;
}

/**
 * For a set of entries, compute the average best-E1RM across all exercises
 * that appear in those entries and have usable weight data.
 *
 * Returns null if no usable data exists.
 * @param {object[]} entries
 * @param {object} exerciseIndex
 * @returns {number|null}
 */
function _avgE1rmAcrossEntries(entries, exerciseIndex = {}) {
  if (!entries.length) return null;

  // Collect per-exercise best E1RM across all entries in this window
  const perEx = {};
  for (const entry of entries) {
    for (const [exId, sets] of Object.entries(entry.exercises || {})) {
      if (exerciseIndex[exId]?.invariant) continue;
      const e = _bestE1rm(sets);
      if (e === null) continue;
      if (!(exId in perEx) || e > perEx[exId]) {
        perEx[exId] = e;
      }
    }
  }

  const values = Object.values(perEx);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ── Core Analysis ─────────────────────────────────────

/**
 * Analyse a workout history array for systemic fatigue indicators.
 *
 * History entries are expected to have the shape:
 * {
 *   entryId?:      string,
 *   sessionId:     string,
 *   timestamp:     number,          // ms epoch
 *   isDeload?:     boolean,         // optional user-set flag
 *   exercises: {
 *     [exId]: Array<{ s: string, w: number|null, r: number|null, n: string }>
 *   }
 * }
 *
 * @param {object[]} history              All completed workout entries (any order).
 * @param {number}   [rollingWindowDays=14] Total rolling window in days. The window
 *                                          is split into two halves: current week
 *                                          (first half) and baseline week (second half).
 *                                          Default 14 → 7+7 days.
 * @returns {{
 *   level:       'normal'|'warning',
 *   indicators:  string[],
 *   timestamp:   number,
 *   debug: {
 *     currentWeekVolume:   number|null,
 *     baselineWeekVolume:  number|null,
 *     volumeDropPct:       number|null,
 *     currentWeekE1rm:     number|null,
 *     baselineWeekE1rm:    number|null,
 *     e1rmDropPct:         number|null,
 *     currentWeekEntries:  number,
 *     baselineWeekEntries: number,
 *   }
 * }}
 */
export function analyzeFatigueTrends(history, rollingWindowDays = 14, exerciseIndex = {}) {
  const now = Date.now();
  const msPerDay = 86_400_000;

  // Guard
  const sorted = [...(history || [])].sort((a, b) => a.timestamp - b.timestamp);
  if (!sorted.length) {
    return _normal(now, {});
  }

  // Split window into two equal halves
  const halfMs = (rollingWindowDays / 2) * msPerDay;
  const windowStart = now - rollingWindowDays * msPerDay;
  const midpoint    = now - halfMs; // boundary between baseline and current

  const baselineEntries = sorted.filter(
    e => e.timestamp >= windowStart && e.timestamp < midpoint
  );
  const currentEntries = sorted.filter(
    e => e.timestamp >= midpoint
  );

  // ── Compute Rolling Systemic Volume ──────────────────
  const currentVolume  = currentEntries.length  ? currentEntries.reduce((s, e)  => s + _entryVolume(e, exerciseIndex),  0) : null;
  const baselineVolume = baselineEntries.length ? baselineEntries.reduce((s, e) => s + _entryVolume(e, exerciseIndex), 0) : null;

  // Normalise by session count so a week with fewer sessions doesn't look like fatigue
  const currentVolNorm  = currentEntries.length  ? currentVolume  / currentEntries.length  : null;
  const baselineVolNorm = baselineEntries.length ? baselineVolume / baselineEntries.length : null;

  // ── Compute Average E1RM across compounds ─────────────
  const currentE1rm  = _avgE1rmAcrossEntries(currentEntries, exerciseIndex);
  const baselineE1rm = _avgE1rmAcrossEntries(baselineEntries, exerciseIndex);

  // ── Drop calculations ─────────────────────────────────
  let volumeDropPct = null;
  if (baselineVolNorm !== null && baselineVolNorm > 0 && currentVolNorm !== null) {
    volumeDropPct = ((currentVolNorm - baselineVolNorm) / baselineVolNorm) * 100;
  }

  let e1rmDropPct = null;
  if (baselineE1rm !== null && baselineE1rm > 0 && currentE1rm !== null) {
    e1rmDropPct = ((currentE1rm - baselineE1rm) / baselineE1rm) * 100;
  }

  const DROP_THRESHOLD = -5; // percent

  const indicators = [];

  // ── Deload guard ──────────────────────────────────────
  // If ANY entry in the current window is flagged as a planned deload,
  // skip the fatigue warning entirely.
  const hasIntentionalDeload = currentEntries.some(e => e.isDeload === true);

  if (!hasIntentionalDeload) {
    if (volumeDropPct !== null && volumeDropPct < DROP_THRESHOLD) {
      indicators.push(
        `Systemic volume dropped ${Math.abs(volumeDropPct).toFixed(1)}% vs prior week baseline`
      );
    }

    if (e1rmDropPct !== null && e1rmDropPct < DROP_THRESHOLD) {
      indicators.push(
        `Average compound E1RM dropped ${Math.abs(e1rmDropPct).toFixed(1)}% vs prior week baseline`
      );
    }
  }

  const debug = {
    currentWeekVolume:   currentVolNorm  !== null ? +currentVolNorm.toFixed(1)  : null,
    baselineWeekVolume:  baselineVolNorm !== null ? +baselineVolNorm.toFixed(1) : null,
    volumeDropPct:       volumeDropPct   !== null ? +volumeDropPct.toFixed(2)   : null,
    currentWeekE1rm:     currentE1rm     !== null ? +currentE1rm.toFixed(2)     : null,
    baselineWeekE1rm:    baselineE1rm    !== null ? +baselineE1rm.toFixed(2)    : null,
    e1rmDropPct:         e1rmDropPct     !== null ? +e1rmDropPct.toFixed(2)     : null,
    currentWeekEntries:  currentEntries.length,
    baselineWeekEntries: baselineEntries.length,
  };

  if (indicators.length > 0) {
    return {
      level: 'warning',
      indicators,
      timestamp: now,
      debug,
    };
  }

  return _normal(now, debug);
}

function _normal(timestamp, debug) {
  return { level: 'normal', indicators: [], timestamp, debug };
}
