// ==========================================
// ─── ETA ESTIMATOR ───
// ==========================================
// Estimates gym departure time from current session state.
//
// Architecture: deterministic workload model (blocks × sets) with
// stochastic execution cost (wall-clock intervals between completions).
// Sets are fixed tasks; time is the uncertain cost.
//
// Pipeline:
//   1. Inter-completion intervals → EWMA (recency-weighted, outlier-clipped)
//   2. Per-block remaining = remaining_sets × interval_estimate
//   3. Cascade: block-local EWMA → session EWMA → prescription prior
//   4. Historical blend (pace-relative, early-session only)
//   5. Cardio overhead (additive, post-blend)
//   6. Confidence from forecast interval width
//
// Known limitations:
//   - EWMA assumes local stationarity; regime shifts (block transitions,
//     exercise type changes) cause transient estimation error.
//   - Per-set interval homogeneity within a block.  Heavy sets late in a
//     5×5 take longer than early sets.  The model uses one average.
//   - Historical blend uses a session-level pace scalar, not per-block
//     pace factors, because per-block historical data isn't available.
// ==========================================

import { EXERCISE_INDEX } from '../state/store.js';

// ── Constants ────────────────────────────────────────────────────────────────

const EWMA_ALPHA          = 0.3;    // learning rate — biased toward recent intervals
const OUTLIER_MULTIPLIER  = 3.0;    // clip intervals > 3× the current EWMA
const MIN_INTERVAL_MS     = 10_000; // 10s — below this is probably a misfire/double-tap
const MAX_INTERVAL_MS     = 600_000;// 10 min — hard ceiling for any single interval
const DEFAULT_WORKING_MS  = 30_000; // 30s default working time per set
const DEFAULT_REST_MS     = 90_000; // 90s fallback rest
const CARDIO_DURATION_MS  = 8 * 60_000; // 8 min warmup/finisher default

// ── EWMA Engine ──────────────────────────────────────────────────────────────

/**
 * Compute EWMA over a sequence of intervals with outlier clipping.
 *
 * @param {number[]} intervals — wall-clock intervals in ms (chronological)
 * @returns {{ ewma: number, variance: number, count: number }}
 */
function computeEWMA(intervals) {
  if (!intervals.length) return { ewma: 0, variance: 0, count: 0 };

  let ewma = intervals[0];
  let ewmaVar = 0;
  let count = 1;

  for (let i = 1; i < intervals.length; i++) {
    let x = intervals[i];

    // Outlier clipping: bound by whichever is tighter — the adaptive
    // multiplier (3× current EWMA) or the hard ceiling (10 min).
    // Math.min ensures the adaptive threshold actually fires in the
    // normal operating range (EWMA 30s–3min → clip at 90s–9min).
    const upperBound = Math.min(ewma * OUTLIER_MULTIPLIER, MAX_INTERVAL_MS);
    if (x > upperBound) x = ewma; // replace with current estimate
    if (x < MIN_INTERVAL_MS) x = ewma; // too fast — likely misfire

    const diff = x - ewma;
    ewma = ewma + EWMA_ALPHA * diff;
    ewmaVar = (1 - EWMA_ALPHA) * (ewmaVar + EWMA_ALPHA * diff * diff);
    count++;
  }

  return { ewma, variance: ewmaVar, count };
}

// ── Timestamp extraction ─────────────────────────────────────────────────────

/**
 * Collect all completedAt timestamps from a block's exercises, in chronological order.
 *
 * @param {object} block       — session block definition
 * @param {object} exercises   — state.exercises keyed by instanceId
 * @returns {number[]}         — sorted timestamps (ms)
 */
function getBlockTimestamps(block, exercises) {
  const timestamps = [];
  for (const inst of block.exercises) {
    const sets = exercises[inst.instanceId] || [];
    for (const s of sets) {
      if (s.completedAt && (s.s === 'done' || s.s === 'failed')) {
        timestamps.push(s.completedAt);
      }
    }
  }
  return timestamps.sort((a, b) => a - b);
}

/**
 * Collect all completedAt timestamps from the entire session, chronologically.
 *
 * @param {object} sessionDef  — session definition with .blocks
 * @param {object} exercises   — state.exercises
 * @returns {number[]}
 */
function getSessionTimestamps(sessionDef, exercises) {
  const timestamps = [];
  for (const block of sessionDef.blocks) {
    timestamps.push(...getBlockTimestamps(block, exercises));
  }
  return timestamps.sort((a, b) => a - b);
}

/**
 * Convert sorted timestamps to intervals (deltas between consecutive completions).
 *
 * @param {number[]} timestamps
 * @returns {number[]}
 */
function timestampsToIntervals(timestamps) {
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  return intervals;
}

// ── Block-level estimation ───────────────────────────────────────────────────

/**
 * Count total and completed sets in a block.
 */
function blockSetCounts(block, exercises) {
  let total = 0, completed = 0;
  for (const inst of block.exercises) {
    const exSets = inst.sets ?? EXERCISE_INDEX[inst.instanceId]?.sets ?? 3;
    total += exSets;
    const sets = exercises[inst.instanceId] || [];
    completed += sets.filter(s => s.s === 'done' || s.s === 'failed').length;
  }
  return { total, completed, remaining: total - completed };
}

/**
 * Estimate remaining time for a single block using schedule simulation.
 *
 * If the block has enough observed intervals (≥3 completions → ≥2 EWMA
 * updates from seed), we use the block-local EWMA.  This threshold trades
 * responsiveness for stability — at ≥2 (one update from seed), the block
 * estimate is still dominated by the seed value.
 *
 * If not, we fall back to session-wide EWMA or prescribed rest.
 *
 * @param {object} block        — block definition
 * @param {object} exercises    — state.exercises
 * @param {object} sessionEWMA  — fallback EWMA from session-wide intervals
 * @returns {{ remainingMs: number, ewma: object }}
 */
function estimateBlockRemaining(block, exercises, sessionEWMA) {
  const { total, completed, remaining } = blockSetCounts(block, exercises);

  if (remaining <= 0) return { remainingMs: 0, ewma: { ewma: 0, variance: 0, count: 0 } };

  // Try block-local intervals first
  const blockTs = getBlockTimestamps(block, exercises);
  const blockIntervals = timestampsToIntervals(blockTs);
  const blockEWMA = computeEWMA(blockIntervals);

  // Choose the best available interval estimate
  let intervalEstimate;

  if (blockEWMA.count >= 3) {
    // Block has enough signal — use its own pace
    intervalEstimate = blockEWMA.ewma;
  } else if (sessionEWMA.count >= 2) {
    // Fall back to session-wide pace
    intervalEstimate = sessionEWMA.ewma;
  } else {
    // No observed data — use prescribed rest + working time prior
    intervalEstimate = estimateBlockIntervalFromPrescription(block);
  }

  return {
    remainingMs: remaining * intervalEstimate,
    ewma: blockEWMA.count >= 3 ? blockEWMA : sessionEWMA
  };
}

/**
 * Estimate a single set interval from prescribed rest durations.
 * This is the "no signal" fallback — used before any sets are completed.
 *
 * In a superset block, the effective interval per set is:
 *   (total rest across one round / exercises in block) + working time
 *
 * For a 2-exercise superset with 120s rest between sets:
 *   round rest = 120s (rest happens once per round, not per exercise)
 *   per-set interval ≈ (120s / 2) + 30s working = 90s
 *
 * @param {object} block
 * @returns {number} estimated ms per set
 */
function estimateBlockIntervalFromPrescription(block) {
  const exCount = block.exercises.length || 1;

  // Use the max rest in the block (superset rest happens once per round)
  let maxRest = 0;
  for (const inst of block.exercises) {
    const ex = EXERCISE_INDEX[inst.instanceId];
    const rest = (ex?.restBetweenSets ?? DEFAULT_REST_MS / 1000) * 1000;
    if (rest > maxRest) maxRest = rest;
  }

  // One round = working time for each exercise + one rest period
  // Per-set interval = round duration / exercises in block
  const roundDuration = (exCount * DEFAULT_WORKING_MS) + maxRest;
  return roundDuration / exCount;
}

// ── Historical session pace ──────────────────────────────────────────────────

/**
 * Compute average session duration from history for a given session ID.
 *
 * @param {object} appState
 * @param {string} sessionId
 * @returns {number|null} — average duration in ms, or null if no history
 */
function historicalSessionDuration(appState, sessionId) {
  const durations = (appState.history || [])
    .filter(e => e.sessionId === sessionId && e.startTimestamp && e.timestamp)
    .map(e => e.timestamp - e.startTimestamp)
    .filter(d => d > 0);

  return durations.length > 0
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length
    : null;
}

// ── Confidence scoring ───────────────────────────────────────────────────────

/**
 * Compute confidence in the ETA estimate from forecast interval width.
 *
 * Confidence reflects how wide the prediction interval is relative to the
 * point estimate.  "High" means ±15% or less.  This mechanically connects
 * confidence to the estimator — unlike additive feature scoring, the
 * confidence output is derived from the same variance that drives the
 * point estimate.
 *
 * Limitation: EWMA variance is locally meaningful but not stationary.
 * Confidence can be artificially high right before a regime shift (block
 * transition, exercise type change, weight jump).  This is inherent to
 * any EWMA-based uncertainty on a non-stationary process.
 *
 * @param {object} sessionEWMA      — { ewma, variance, count }
 * @param {number} totalRemainingMs — point estimate of remaining time
 * @param {number} completedSets    — total completed across session
 * @param {number} totalSets        — total sets in session
 * @returns {{ level: 'low'|'med'|'high', reason: string }}
 */
function computeConfidence(sessionEWMA, totalRemainingMs, completedSets, totalSets) {
  if (totalRemainingMs <= 0 || totalSets === 0) {
    return { level: 'low', reason: 'No estimate available' };
  }

  let relativeUncertainty;

  if (sessionEWMA.count >= 4 && sessionEWMA.ewma > 0) {
    // Variance-based: CV × √(remaining sets) gives interval half-width
    // as a fraction of the point estimate.  More remaining work → wider.
    // Requires count ≥ 4 (three EWMA updates) for variance to begin converging.
    const cv = Math.sqrt(sessionEWMA.variance) / sessionEWMA.ewma;
    const remainingSets = totalSets - completedSets;
    relativeUncertainty = cv * Math.sqrt(remainingSets);
  } else {
    // Sparse data: high base uncertainty, decaying with observations
    relativeUncertainty = 1.0 - (sessionEWMA.count * 0.15);
  }

  relativeUncertainty = Math.max(0.05, Math.min(1.5, relativeUncertainty));

  if (relativeUncertainty <= 0.15) return { level: 'high', reason: 'Narrow prediction interval' };
  if (relativeUncertainty <= 0.40) return { level: 'med',  reason: 'Moderate prediction interval' };
  return { level: 'low', reason: 'Wide prediction interval — estimate may drift' };
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Calculate estimated gym departure time.
 *
 * Pure function — reads state, returns an estimate.  No side effects.
 *
 * @param {object} appState    — full application state
 * @param {object} sessionDef  — the session definition (from workouts[])
 * @returns {object|null}      — { etaMs, remainingMin, departureLabel, remainingLabel, confidence }
 *                                or null if session hasn't started
 */
export function calculateETA(appState, sessionDef) {
  if (!appState || !sessionDef) return null;
  if (!appState.sessionStarted) return null;

  const now = Date.now();
  const elapsedMs = now - appState.sessionStarted;

  // ── Gather session-wide intervals for fallback EWMA ────────────────────
  // Only inter-completion intervals.  Session start is NOT injected — the
  // gap between session start and first set completion is setup latency
  // (equipment loading, changing, socializing), not a work interval.
  // Including it would anchor the EWMA at a systematically inflated value.
  const sessionTs = getSessionTimestamps(sessionDef, appState.exercises);
  const sessionIntervals = timestampsToIntervals(sessionTs);
  const sessionEWMA = computeEWMA(sessionIntervals);

  // ── Aggregate remaining time across all blocks ─────────────────────────
  let totalRemainingMs = 0;
  let totalSets = 0;
  let completedSets = 0;

  for (const block of sessionDef.blocks) {
    const counts = blockSetCounts(block, appState.exercises);
    totalSets += counts.total;
    completedSets += counts.completed;

    const { remainingMs } = estimateBlockRemaining(block, appState.exercises, sessionEWMA);
    totalRemainingMs += remainingMs;
  }

  // ── Historical blending (pace-relative) ────────────────────────────────
  // Early in the session, blend toward historical average — but scaled by
  // the observed pace ratio so fast/slow days adjust toward actual pace
  // instead of pulling unconditionally toward the historical mean.
  //
  // paceRatio is a session-level scalar.  Per-block pace factors would be
  // more accurate but require per-block historical data we don't have.
  // Clamped to [0.5, 2.0] to prevent extreme single-set outliers from
  // dominating.
  const historicalDuration = historicalSessionDuration(appState, sessionDef.id);

  if (historicalDuration && completedSets > 0 && completedSets < 6) {
    const alpha = Math.min(1, completedSets / 6);

    const currentPace = elapsedMs / completedSets;
    const historicalPace = historicalDuration / totalSets;
    const paceRatio = Math.max(0.5, Math.min(2.0, currentPace / historicalPace));

    const rawHistoricalRemaining = Math.max(0, historicalDuration - elapsedMs);
    const historicalRemaining = rawHistoricalRemaining * paceRatio;

    totalRemainingMs = alpha * totalRemainingMs + (1 - alpha) * historicalRemaining;
  } else if (historicalDuration && completedSets === 0) {
    // No sets completed — pure historical prior (no pace data for ratio)
    totalRemainingMs = Math.max(0, historicalDuration - elapsedMs);
  }

  // ── Cardio overhead (post-blend — avoids double-counting with history) ─
  const cardio = appState.cardio || {};
  if (!cardio.warmupDone)   totalRemainingMs += CARDIO_DURATION_MS;
  if (!cardio.finisherDone) totalRemainingMs += CARDIO_DURATION_MS;

  // ── Confidence (from forecast interval width) ──────────────────────────
  const confidence = computeConfidence(
    sessionEWMA, totalRemainingMs, completedSets, totalSets
  );

  // ── Format output ──────────────────────────────────────────────────────
  const etaMs = now + totalRemainingMs;
  const remainingMin = Math.max(1, Math.round(totalRemainingMs / 60_000));

  const etaDate = new Date(etaMs);
  const departureLabel = etaDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });

  const remainingLabel = remainingMin < 60
    ? `~${remainingMin} min`
    : `~${Math.floor(remainingMin / 60)}h ${remainingMin % 60}m`;

  return {
    etaMs,
    remainingMin,
    departureLabel,
    remainingLabel,
    confidence,
    completedSets,
    totalSets,
    lastCompletionTs: sessionTs.length > 0 ? sessionTs[sessionTs.length - 1] : null,
    sessionIntervalMs: sessionEWMA.count >= 2 ? sessionEWMA.ewma : null,
  };
}
