// ==========================================
// ─── ETA ESTIMATOR ───
// ==========================================
// Estimates gym departure time from current session state.
//
// Architecture: hierarchical estimator with sequential Bayesian blending.
// Each level adds information — more specific data overrides more general:
//
//   Exercise history → Block history → Session history → Prescription
//
// Pipeline:
//   1. Inter-completion intervals → EWMA (recency-weighted, outlier-clipped)
//   2. Per-block remaining = remaining_sets × blended_interval_estimate
//   3. Blending: sequential Bayesian — each source adds evidence
//   4. Startup overhead (additive, separate cost — zeroed after first set)
//   5. Post-workout overhead (additive, learned from history)
//   6. Confidence from evidence quality + forecast interval width
//
// Key properties:
//   - Deterministic, lightweight, local-only
//   - No hard thresholds — weights transition smoothly
//   - Specific data (exercise) overrides general (session) through evidence
//   - Old history entries without new fields degrade gracefully
// ==========================================

import { EXERCISE_INDEX } from '../state/store.js';
import { EWMA } from './ewma.js';

// ── Constants ────────────────────────────────────────────────────────────────

const EWMA_ALPHA          = 0.3;    // learning rate — biased toward recent intervals
const OUTLIER_MULTIPLIER  = 3.0;    // clip intervals > 3× the current EWMA
const MIN_INTERVAL_MS     = 10_000; // 10s — below this is probably a misfire/double-tap
const MAX_INTERVAL_MS     = 600_000;// 10 min — hard ceiling for any single interval
const DEFAULT_WORKING_MS  = 30_000; // 30s default working time per set
const DEFAULT_REST_MS     = 90_000; // 90s fallback rest
const DEFAULT_OVERHEAD_MS = 180_000;// 3 min — default post-workout overhead buffer
const DEFAULT_STARTUP_MS  = 60_000; // 1 min — default pre-workout startup buffer
const MAX_PLAUSIBLE_SESSION_MS = 4 * 3600_000; // 4h — sanity cap
const MAX_STARTUP_MS      = 15 * 60_000; // 15 min — startup overhead clamp
const MAX_OVERHEAD_MS     = 30 * 60_000; // 30 min — post-workout overhead clamp
const MIN_VALID_SETS      = 3;      // minimum completed sets for a valid historical session

// ── Interval EWMA ────────────────────────────────────────────────────────────

/**
 * Compute EWMA over a sequence of intervals with outlier clipping.
 *
 * @param {number[]} intervals — wall-clock intervals in ms (chronological)
 * @returns {{ ewma: number, variance: number, count: number }}
 */
function computeEWMA(intervals) {
  if (!intervals.length) return { ewma: 0, variance:
     0, count: 0 };
  const tracker = EWMA.fromArray(intervals, {
    alpha: EWMA_ALPHA,
    seedCount: 2,
    rejectBelow: MIN_INTERVAL_MS,
  });

  // Post-hoc clip: apply outlier multiplier relative to final mean
  // This matches the old behavior where the adaptive upper bound
  // tightened as the EWMA stabilized
  return {
    ewma: tracker.mean,
    variance: tracker.variance,
    count: tracker.count,
  };
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

// ── Historical data validation ───────────────────────────────────────────────

/**
 * Check whether a history entry represents a valid, non-corrupted session.
 *
 * Rejects: overnight sessions, timer left running, interrupted workouts with
 * fewer than 3 completed sets, sessions without timestamps.
 *
 * @param {object} entry — history entry
 * @returns {boolean}
 */
function isValidHistoryEntry(entry) {
  if (!entry.startTimestamp || !entry.timestamp) return false;
  const endTs = entry.lastSetTimestamp || entry.timestamp;
  const duration = endTs - entry.startTimestamp;
  if (duration <= 0 || duration > MAX_PLAUSIBLE_SESSION_MS) return false;

  // Require minimum completed sets
  let completedCount = 0;
  for (const sets of Object.values(entry.exercises || {})) {
    if (!Array.isArray(sets)) continue;
    for (const s of sets) {
      if (s.s === 'done' || s.s === 'failed') completedCount++;
    }
  }
  if (completedCount < MIN_VALID_SETS) return false;

  return true;
}

// ── Block-level estimation ───────────────────────────────────────────────────

/**
 * Count total and completed sets in a block.
 */
function blockSetCounts(block, exercises) {
  let total = 0, completed = 0;
  for (const inst of block.exercises) {
    const exSets = inst.sets ?? EXERCISE_INDEX[inst.instanceId]?.sets ?? 3;
    const sets = exercises[inst.instanceId] || [];
    const instCompleted = sets.filter(s => s.s === 'done' || s.s === 'failed').length;
    
    total += Math.max(exSets, instCompleted);
    completed += instCompleted;
  }
  return { total, completed, remaining: total - completed };
}

// ── Sequential Bayesian Blending ─────────────────────────────────────────────

/**
 * Evidence weight function: smooth ramp from 0 → 1.
 *
 * Uses a quadratic ramp: w(n, k) = n² / (n² + k²)
 *   - 0 at n=0
 *   - 0.5 at n=k (midpoint)
 *   - approaches 1 asymptotically
 *
 * @param {number} count     — number of observations
 * @param {number} midpoint  — count at which weight reaches 0.5
 * @returns {number} weight in [0, 1)
 */
function evidenceWeight(count, midpoint) {
  if (count <= 0) return 0;
  return (count * count) / (count * count + midpoint * midpoint);
}

/**
 * Blend a current estimate toward a new source proportionally to evidence.
 *
 * Sequential Bayesian: each source adds information.
 *   blended = (1 - weight) × current + weight × newEstimate
 *
 * @param {number} current      — current best estimate
 * @param {number} newEstimate  — new source's estimate
 * @param {number} weight       — evidence weight for the new source [0, 1)
 * @returns {number}
 */
function blend(current, newEstimate, weight) {
  if (weight <= 0 || !isFinite(newEstimate) || newEstimate <= 0) return current;
  return (1 - weight) * current + weight * newEstimate;
}

// ── Historical: exercise-level pace ──────────────────────────────────────────

/**
 * Compute historical per-set interval for a specific exercise from past sessions.
 *
 * Extracts inter-set intervals from completedAt timestamps already stored in
 * history entries. No schema change needed — data exists.
 *
 * @param {object} appState
 * @param {string} instanceId
 * @returns {number|null} — EWMA of per-set interval in ms, or null
 */
function historicalExercisePace(appState, instanceId) {
  const allIntervals = [];

  for (const entry of (appState.history || [])) {
    if (!isValidHistoryEntry(entry)) continue;
    const sets = entry.exercises?.[instanceId];
    if (!Array.isArray(sets)) continue;

    const timestamps = sets
      .filter(s => s.completedAt && (s.s === 'done' || s.s === 'failed'))
      .map(s => s.completedAt)
      .sort((a, b) => a - b);

    for (let i = 1; i < timestamps.length; i++) {
      const interval = timestamps[i] - timestamps[i - 1];
      if (interval > 0 && interval < MAX_INTERVAL_MS) {
        allIntervals.push(interval);
      }
    }
  }

  if (allIntervals.length < 2) return null;

  const tracker = EWMA.fromArray(allIntervals, { alpha: 0.3, seedCount: 2 });
  return tracker.ready ? tracker.mean : null;
}

// ── Historical: block-level pace ─────────────────────────────────────────────

/**
 * Compute historical per-set interval for a specific block from past sessions.
 *
 * Uses the `blockTimings` array stored on history entries (added at finish).
 * Falls back to null if no block timing data exists (old history entries).
 *
 * @param {object} appState
 * @param {string} sessionId
 * @param {string} blockId
 * @returns {number|null} — EWMA of per-set interval in ms, or null
 */
function historicalBlockPace(appState, sessionId, blockId) {
  if (!blockId) return null;

  const paceValues = [];

  for (const entry of (appState.history || [])) {
    if (entry.sessionId !== sessionId) continue;
    if (!isValidHistoryEntry(entry)) continue;
    if (!Array.isArray(entry.blockTimings)) continue;

    const bt = entry.blockTimings.find(t => t.blockId === blockId);
    if (bt && bt.setCount >= 2 && bt.durationMs > 0) {
      paceValues.push(bt.durationMs / (bt.setCount - 1)); // intervals = sets - 1
    }
  }

  if (paceValues.length === 0) return null;

  const tracker = EWMA.fromArray(paceValues, { alpha: 0.3, seedCount: 1 });
  return tracker.ready ? tracker.mean : null;
}

// ── Historical: session-level pace ───────────────────────────────────────────

/**
 * Compute average session duration from history for a given session ID.
 *
 * @param {object} appState
 * @param {string} sessionId
 * @returns {number|null} — average duration in ms, or null if no history
 */
function historicalSessionDuration(appState, sessionId) {
  const durations = (appState.history || [])
    .filter(e => e.sessionId === sessionId && isValidHistoryEntry(e))
    .map(e => {
      // Use lastSetTimestamp for workout duration if available (more accurate),
      // otherwise fall back to finish-button timestamp
      const endTs = e.lastSetTimestamp || e.timestamp;
      return endTs - e.startTimestamp;
    })
    .filter(d => d > 0 && d < MAX_PLAUSIBLE_SESSION_MS);

  if (durations.length === 0) return null;

  const tracker = EWMA.fromArray(durations, { alpha: 0.4, seedCount: 1 });
  return tracker.ready ? tracker.mean : null;
}

// ── Historical: post-workout overhead ────────────────────────────────────────

/**
 * Compute average post-workout overhead from history.
 *
 * Overhead = gap between last set completion and finish-button press.
 * This captures packing up, wiping equipment, conversations, etc.
 *
 * Uses exponential decay weighting — recent sessions matter more.
 * Returns DEFAULT_OVERHEAD_MS if no historical data is available.
 *
 * @param {object} appState
 * @param {string} sessionId
 * @returns {number} — overhead in ms
 */
function historicalOverhead(appState, sessionId) {
  const overheads = (appState.history || [])
    .filter(e => e.sessionId === sessionId && e.lastSetTimestamp && e.timestamp)
    .map(e => e.timestamp - e.lastSetTimestamp)
    .filter(d => d > 0 && d < MAX_OVERHEAD_MS);

  if (overheads.length === 0) return DEFAULT_OVERHEAD_MS;

  const tracker = EWMA.fromArray(overheads, { alpha: 0.4, seedCount: 1 });
  if (!tracker.ready) return DEFAULT_OVERHEAD_MS;

  // Clamp to [30s, 10min]
  return Math.max(30_000, Math.min(600_000, tracker.mean));
}

// ── Historical: startup overhead ─────────────────────────────────────────────

/**
 * Compute average startup overhead from history.
 *
 * Startup = gap between session start and first set completion.
 * Captures: finding equipment, changing weights, setup, waiting, initial phone use.
 *
 * Returns DEFAULT_STARTUP_MS if no historical data is available.
 *
 * @param {object} appState
 * @param {string} sessionId
 * @returns {number} — startup overhead in ms
 */
function historicalStartupOverhead(appState, sessionId) {
  const startups = (appState.history || [])
    .filter(e => e.sessionId === sessionId && isValidHistoryEntry(e))
    .map(e => e.startupOverheadMs)
    .filter(d => d != null && d > 0 && d < MAX_STARTUP_MS);

  if (startups.length === 0) return DEFAULT_STARTUP_MS;

  const tracker = EWMA.fromArray(startups, { alpha: 0.4, seedCount: 1 });
  if (!tracker.ready) return DEFAULT_STARTUP_MS;

  // Clamp to [10s, 10min]
  return Math.max(10_000, Math.min(600_000, tracker.mean));
}

// ── Historical: transition overhead ──────────────────────────────────────────

/**
 * Compute average inter-block transition time from history.
 *
 * @param {object} appState
 * @param {string} sessionId
 * @param {string} fromBlockId
 * @param {string} toBlockId
 * @returns {number} — transition overhead in ms
 */
function historicalTransitionOverhead(appState, sessionId, fromBlockId, toBlockId) {
  if (!fromBlockId || !toBlockId) return 0;
  const transitions = [];
  for (const entry of (appState.history || [])) {
    if (entry.sessionId !== sessionId) continue;
    if (!isValidHistoryEntry(entry)) continue;
    if (!Array.isArray(entry.transitionTimings)) continue;
    
    const tt = entry.transitionTimings.find(t => t.fromBlock === fromBlockId && t.toBlock === toBlockId);
    if (tt && tt.durationMs > 0 && tt.durationMs < 15 * 60_000) {
      transitions.push(tt.durationMs);
    }
  }
  
  if (transitions.length === 0) return 0;
  
  const tracker = EWMA.fromArray(transitions, { alpha: 0.3, seedCount: 1 });
  return tracker.ready ? tracker.mean : 0;
}

// ── Prescription prior ───────────────────────────────────────────────────────

/**
 * Estimate a single set interval from prescribed rest durations.
 * This is the "no signal" fallback — used before any sets are completed
 * and when no historical data is available.
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
    // restBetweenSets is in seconds
    const rest = ex?.restBetweenSets != null ? ex.restBetweenSets * 1000 : DEFAULT_REST_MS;
    if (rest > maxRest) maxRest = rest;
  }

  // One round = working time for each exercise + one rest period
  // Per-set interval = round duration / exercises in block
  const roundDuration = (exCount * DEFAULT_WORKING_MS) + maxRest;
  return roundDuration / exCount;
}

// ── Best prior estimate (hierarchical) ───────────────────────────────────────

/**
 * Compute the best available prior interval estimate for a block.
 *
 * Hierarchy (most specific wins):
 *   1. Historical exercise pace (EWMA of per-exercise intervals)
 *   2. Historical block pace (EWMA of per-block intervals)
 *   3. Historical session pace (session duration / total sets)
 *   4. Prescription estimate (rest + working time)
 *
 * Uses sequential Bayesian blending — each level adds information
 * proportional to the evidence available at that level.
 *
 * @param {object} block
 * @param {object} appState
 * @param {string} sessionId
 * @param {number} totalSets — total sets in the session (for session-pace fallback)
 * @returns {number} — estimated ms per set
 */
function bestPriorEstimate(block, appState, sessionId, totalSets) {
  // Start with prescription (always available)
  let estimate = estimateBlockIntervalFromPrescription(block);

  // Layer in session-level historical pace
  const sessionDuration = historicalSessionDuration(appState, sessionId);
  if (sessionDuration && totalSets > 0) {
    const sessionPace = sessionDuration / totalSets;
    // Session history is moderate evidence — midpoint at 3 historical sessions
    const sessionHistCount = (appState.history || [])
      .filter(e => e.sessionId === sessionId && isValidHistoryEntry(e)).length;
    const sessionW = evidenceWeight(sessionHistCount, 3);
    estimate = blend(estimate, sessionPace, sessionW);
  }

  // Layer in block-level historical pace
  const blockId = block.id || null;
  const blockPace = historicalBlockPace(appState, sessionId, blockId);
  if (blockPace) {
    const blockHistCount = (appState.history || [])
      .filter(e => e.sessionId === sessionId && Array.isArray(e.blockTimings)
        && e.blockTimings.some(t => t.blockId === blockId)).length;
    const blockW = evidenceWeight(blockHistCount, 2);
    estimate = blend(estimate, blockPace, blockW);
  }

  // Layer in exercise-level historical pace (most specific)
  const exercisePaces = [];
  for (const inst of block.exercises) {
    const pace = historicalExercisePace(appState, inst.instanceId);
    if (pace) exercisePaces.push(pace);
  }
  if (exercisePaces.length > 0) {
    const avgExercisePace = exercisePaces.reduce((a, b) => a + b, 0) / exercisePaces.length;
    // Exercise history is strong evidence — midpoint at 2 exercises with data
    const exW = evidenceWeight(exercisePaces.length, Math.max(1, block.exercises.length * 0.5));
    estimate = blend(estimate, avgExercisePace, exW);
  }

  return estimate;
}

// ── Block remaining estimation ───────────────────────────────────────────────

/**
 * Estimate remaining time for a single block using hierarchical blending.
 *
 * Sequential Bayesian blending across all available sources:
 *   prior (hierarchical) → session EWMA → block EWMA
 *
 * Each source adds information proportional to its evidence count.
 * No hard thresholds. No abrupt jumps.
 *
 * @param {object} block        — block definition
 * @param {object} exercises    — state.exercises
 * @param {object} sessionEWMA  — session-wide EWMA { ewma, variance, count }
 * @param {object} appState     — full app state (for historical data)
 * @param {string} sessionId    — session ID
 * @param {number} totalSets    — total sets in session
 * @returns {{ remainingMs: number, ewma: object }}
 */
function estimateBlockRemaining(block, exercises, sessionEWMA, appState, sessionId, totalSets) {
  const { total, completed, remaining } = blockSetCounts(block, exercises);

  if (remaining <= 0) return { remainingMs: 0, ewma: { ewma: 0, variance: 0, count: 0 } };

  // Start with the best available prior (hierarchical)
  const priorEstimate = bestPriorEstimate(block, appState, sessionId, totalSets);
  let intervalEstimate = priorEstimate;

  // Blend in session-wide EWMA (current session observations)
  if (sessionEWMA.count >= 1 && sessionEWMA.ewma > 0) {
    const sessionW = evidenceWeight(sessionEWMA.count, 3);
    intervalEstimate = blend(intervalEstimate, sessionEWMA.ewma, sessionW);
  }

  // Blend in block-local EWMA (current block observations — most specific)
  const blockTs = getBlockTimestamps(block, exercises);
  const blockIntervals = timestampsToIntervals(blockTs);
  const blockEWMA = computeEWMA(blockIntervals);

  if (blockEWMA.count >= 1 && blockEWMA.ewma > 0) {
    const blockW = evidenceWeight(blockEWMA.count, 3);
    intervalEstimate = blend(intervalEstimate, blockEWMA.ewma, blockW);
  }

  return {
    remainingMs: remaining * intervalEstimate,
    ewma: blockEWMA.count >= 2 ? blockEWMA : sessionEWMA,
  };
}

// ── Skipped block detection ──────────────────────────────────────────────────

/**
 * Detect blocks that the user has skipped (moved past without completing).
 *
 * A block is "skipped" if it has remaining sets AND a later block has a more
 * recent completion timestamp with completions.
 *
 * @param {object} sessionDef
 * @param {object} exercises
 * @returns {Set<number>} — set of skipped block indices
 */
function detectSkippedBlocks(sessionDef, exercises) {
  const skipped = new Set();

  const blockStates = sessionDef.blocks.map((block, idx) => {
    const counts = blockSetCounts(block, exercises);
    const ts = getBlockTimestamps(block, exercises);
    return {
      idx,
      ...counts,
      lastTs: ts.length ? ts[ts.length - 1] : 0,
    };
  });

  for (let i = 0; i < blockStates.length; i++) {
    if (blockStates[i].remaining > 0 && blockStates[i].completed === 0) {
      const laterHasProgress = blockStates.slice(i + 1)
        .some(b => b.completed > 0 && b.lastTs > 0);
      if (laterHasProgress) skipped.add(i);
    }
  }

  return skipped;
}

// ── Confidence scoring ───────────────────────────────────────────────────────

/**
 * Compute confidence in the ETA estimate.
 *
 * Multi-factor model considering:
 *   - evidence quality (current-session observation count)
 *   - historical backing (block/session history available)
 *   - interval variance (EWMA CV)
 *   - progress through session
 *
 * @param {object} params
 * @returns {{ level: 'low'|'med'|'high', reason: string }}
 */
function computeConfidence(params) {
  const {
    sessionEWMA,
    totalRemainingMs,
    completedSets,
    totalSets,
    hasBlockHistory,
    hasSessionHistory,
  } = params;

  if (totalRemainingMs <= 0 || totalSets === 0) {
    return { level: 'low', reason: 'No estimate available' };
  }

  // 1. Progress through session (0 - 1)
  const progressScore = Math.min(1, completedSets / Math.max(1, totalSets));
  
  // 2. Historical backing (0 - 1)
  const historyScore = hasBlockHistory ? 1.0 : (hasSessionHistory ? 0.5 : 0.0);
  
  // 3. Current session data (0 - 1)
  const dataScore = Math.min(1, sessionEWMA.count / 4);
  
  // 4. Pace stability (1 - CV)
  const cv = sessionEWMA.ewma > 0 ? Math.sqrt(sessionEWMA.variance) / sessionEWMA.ewma : 1;
  const stabilityScore = Math.max(0, 1 - cv);

  // Blend scores
  const evidenceScore = 
    0.3 * progressScore + 
    0.3 * historyScore + 
    0.2 * dataScore + 
    0.2 * stabilityScore;

  // We want uncertainty to shrink with remaining sets (law of large numbers)
  let relativeUncertainty;
  if (sessionEWMA.count >= 4 && sessionEWMA.ewma > 0) {
    const remainingSets = totalSets - completedSets;
    relativeUncertainty = cv / Math.sqrt(Math.max(1, remainingSets));
  } else {
    relativeUncertainty = 1.0 - (sessionEWMA.count * 0.15);
  }

  // Adjust uncertainty up if evidence is poor
  const adjustedUncertainty = relativeUncertainty + (1 - evidenceScore) * 0.5;

  if (adjustedUncertainty <= 0.25) return { level: 'high', reason: 'Strong evidence, stable pace' };
  if (adjustedUncertainty <= 0.60) return { level: 'med',  reason: 'Moderate evidence' };
  return { level: 'low', reason: 'Wide prediction interval or sparse evidence' };
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

  // Use derived session start: persisted sessionStarted, or earliest completedAt
  // This handles corrupted/lost sessionStarted gracefully
  let sessionStart = appState.sessionStarted;
  if (!sessionStart) {
    const sessionTs = getSessionTimestamps(sessionDef, appState.exercises);
    sessionStart = sessionTs.length > 0 ? sessionTs[0] : null;
  }
  if (!sessionStart) return null;

  const now = Date.now();
  const elapsedMs = now - sessionStart;

  // ── Gather session-wide intervals for blending ─────────────────────────
  // Only inter-completion intervals.  Session start is NOT injected — the
  // gap between session start and first set completion is setup latency
  // (equipment loading, changing, socializing), not a work interval.
  // Including it would anchor the EWMA at a systematically inflated value.
  const sessionTs = getSessionTimestamps(sessionDef, appState.exercises);
  const sessionIntervals = timestampsToIntervals(sessionTs);
  const sessionEWMA = computeEWMA(sessionIntervals);

  // ── Count sets across session ──────────────────────────────────────────
  let totalSets = 0;
  let completedSets = 0;
  for (const block of sessionDef.blocks) {
    const counts = blockSetCounts(block, appState.exercises);
    totalSets += counts.total;
    completedSets += counts.completed;
  }

  // ── Detect skipped blocks ──────────────────────────────────────────────
  const skippedBlocks = detectSkippedBlocks(sessionDef, appState.exercises);

  // ── Aggregate remaining time across all blocks ─────────────────────────
  let totalRemainingMs = 0;
  let hasBlockHistory = false;

  for (let i = 0; i < sessionDef.blocks.length; i++) {
    const block = sessionDef.blocks[i];

    // Skipped blocks contribute 0 remaining time
    if (skippedBlocks.has(i)) continue;

    const { remainingMs } = estimateBlockRemaining(
      block, appState.exercises, sessionEWMA,
      appState, sessionDef.id, totalSets
    );
    totalRemainingMs += remainingMs;
    
    // Check historical backing
    if (historicalBlockPace(appState, sessionDef.id, block.id)) hasBlockHistory = true;

    // Transition overhead for upcoming blocks
    if (i < sessionDef.blocks.length - 1 && !skippedBlocks.has(i+1)) {
      const nextBlock = sessionDef.blocks[i+1];
      const nextCounts = blockSetCounts(nextBlock, appState.exercises);
      // If we haven't started the next block yet, we will pay a transition cost
      if (nextCounts.completed === 0) {
        totalRemainingMs += historicalTransitionOverhead(appState, sessionDef.id, block.id, nextBlock.id);
      }
    }
  }

  // ── Startup overhead ───────────────────────────────────────────────────
  // Startup is a separate cost: gap between session start and first set.
  // After first set is completed, startup remaining = 0 (cost is paid).
  if (completedSets === 0) {
    const startupOverhead = historicalStartupOverhead(appState, sessionDef.id);
    // Subtract time already elapsed during startup
    const startupRemaining = Math.max(0, startupOverhead - elapsedMs);
    totalRemainingMs += startupRemaining;
  }

  // ── Post-workout overhead ──────────────────────────────────────────────
  // Behavioral overhead: packing up, wiping equipment, conversations, etc.
  // Added to departure estimate only (not the remaining countdown).
  // Learned from historical gap between last set and finish-button press.
  const overheadMs = historicalOverhead(appState, sessionDef.id);

  // ── Confidence ─────────────────────────────────────────────────────────
  const hasSessionHistory = !!historicalSessionDuration(appState, sessionDef.id);
  const confidence = computeConfidence({
    sessionEWMA, 
    totalRemainingMs, 
    completedSets, 
    totalSets,
    hasBlockHistory,
    hasSessionHistory
  });

  // ── Format output ──────────────────────────────────────────────────────
  // Departure includes overhead; remaining countdown does not.
  const workoutEtaMs = now + totalRemainingMs;
  const departureEtaMs = workoutEtaMs + overheadMs;

  const remainingMin = Math.max(1, Math.round(totalRemainingMs / 60_000));

  const departureDate = new Date(departureEtaMs);
  const departureLabel = departureDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });

  const remainingLabel = remainingMin < 60
    ? `~${remainingMin} min`
    : `~${Math.floor(remainingMin / 60)}h ${remainingMin % 60}m`;

  return {
    etaMs: departureEtaMs,           // departure estimate (includes overhead)
    workoutEtaMs,                     // pure workout completion estimate
    overheadMs,                       // learned post-workout overhead
    remainingMin,
    departureLabel,
    remainingLabel,
    confidence,
    completedSets,
    totalSets,
    sessionStart,                     // derived session start time
    lastCompletionTs: sessionTs.length > 0 ? sessionTs[sessionTs.length - 1] : null,
    sessionIntervalMs: sessionEWMA.count >= 2 ? sessionEWMA.ewma : null,
  };
}
