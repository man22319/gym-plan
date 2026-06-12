// ==========================================
// ─── ETA ESTIMATOR ───
// ==========================================
// Pure function: calculates estimated gym departure time from current state.
//
// Core model: wall-clock interval forecasting at the block level.
//
// completedAt timestamps on each set give us observed intervals — which include
// rest, plate changes, wandering, everything.  That is exactly what ETA wants:
// total wall-clock time, not isolated lifting speed.
//
// Supersets are modeled via block-level schedule simulation, not per-exercise
// extrapolation.  The natural unit is one "round" of a block (one set of each
// exercise + rest), because that is how the user actually moves through the gym.
//
// Smoothing uses EWMA with outlier clipping to handle abnormal gaps (phone
// check, bathroom, re-racking) without corrupting the estimate.
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

    // Outlier clipping: if this interval is absurdly large relative to
    // the current estimate, clip it down.  This handles bathroom breaks,
    // phone calls, and other noise without corrupting the forecast.
    const upperBound = Math.max(ewma * OUTLIER_MULTIPLIER, MAX_INTERVAL_MS);
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
 * If the block has enough observed intervals (≥2 timestamps), we use EWMA
 * of the observed wall-clock intervals between completions within this block.
 *
 * If not, we fall back to prescribed rest + a working-time prior.
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

  if (blockEWMA.count >= 2) {
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
    ewma: blockEWMA.count >= 2 ? blockEWMA : sessionEWMA
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
 * Compute confidence in the ETA estimate.
 *
 * Signals used (not just percent complete):
 *   1. Number of observed intervals (primary — more data = more signal)
 *   2. Variance of recent intervals (high variance = low confidence)
 *   3. Fraction of remaining work with observed pace data
 *   4. Current pace vs historical pace delta
 *
 * @param {object}      sessionEWMA   — { ewma, variance, count }
 * @param {number}      completedSets — total completed across session
 * @param {number}      totalSets     — total sets in session
 * @param {number|null} historicalDuration — avg historical session duration in ms
 * @param {number}      elapsedMs     — time since session start
 * @returns {{ level: 'low'|'med'|'high', reason: string }}
 */
function computeConfidence(sessionEWMA, completedSets, totalSets, historicalDuration, elapsedMs) {
  // Signal 1: observation count (0–1 scale, saturates at ~8 intervals)
  const observationScore = Math.min(1, sessionEWMA.count / 8);

  // Signal 2: coefficient of variation (std / mean) — lower = more consistent
  let cvScore = 1; // assume good if no variance data
  if (sessionEWMA.ewma > 0 && sessionEWMA.count >= 3) {
    const cv = Math.sqrt(sessionEWMA.variance) / sessionEWMA.ewma;
    // cv < 0.2 is very consistent → score 1.0
    // cv > 0.8 is chaotic → score ~0.2
    cvScore = Math.max(0.2, 1 - cv);
  }

  // Signal 3: how much of the session has observed pace data
  const coverageScore = totalSets > 0 ? completedSets / totalSets : 0;

  // Signal 4: current pace vs historical pace (if available)
  let historyScore = 0.5; // neutral if no history
  if (historicalDuration && elapsedMs > 0 && completedSets > 0) {
    const currentPace = elapsedMs / completedSets;
    const historicalPace = historicalDuration / totalSets;
    const ratio = currentPace / historicalPace;
    // ratio near 1.0 = good; > 1.5 or < 0.5 = something is off
    historyScore = Math.max(0, 1 - Math.abs(ratio - 1));
  }

  // Weighted blend
  const score =
    observationScore * 0.40 +
    cvScore          * 0.25 +
    coverageScore    * 0.20 +
    historyScore     * 0.15;

  if (score >= 0.6) return { level: 'high', reason: 'Strong signal from observed intervals' };
  if (score >= 0.35) return { level: 'med', reason: 'Moderate signal — estimate may drift' };
  return { level: 'low', reason: 'Limited data — using prescribed rest as fallback' };
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
  const sessionTs = getSessionTimestamps(sessionDef, appState.exercises);
  // Include session start as the first "timestamp" — the interval from start
  // to first completion is meaningful signal.
  const allTs = [appState.sessionStarted, ...sessionTs];
  const sessionIntervals = timestampsToIntervals(allTs);
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

  // If nothing is completed yet, and we have no historical data,
  // we can still show a rough estimate from prescribed rests.
  // But only if the session has actually started.

  // ── Cardio overhead ────────────────────────────────────────────────────
  const cardio = appState.cardio || {};
  if (!cardio.warmupDone)   totalRemainingMs += CARDIO_DURATION_MS;
  if (!cardio.finisherDone) totalRemainingMs += CARDIO_DURATION_MS;

  // ── Historical blending ────────────────────────────────────────────────
  // Early in the session, blend toward historical average.
  // As more sets complete, trust observed pace more.
  const historicalDuration = historicalSessionDuration(appState, sessionDef.id);

  if (historicalDuration && completedSets < 6) {
    const alpha = Math.min(1, completedSets / 6);
    const historicalRemaining = Math.max(0, historicalDuration - elapsedMs);
    totalRemainingMs = alpha * totalRemainingMs + (1 - alpha) * historicalRemaining;
  }

  // ── Confidence ─────────────────────────────────────────────────────────
  const confidence = computeConfidence(
    sessionEWMA, completedSets, totalSets, historicalDuration, elapsedMs
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
    totalSets
  };
}
