/**
 * ══════════════════════════════════════════════════════
 *  Progression Engine — Overload Model
 *  src/core/logic/progression.js
 * ══════════════════════════════════════════════════════
 *
 * Pure functions — zero side-effects, no DOM, no imports.
 * All inputs are passed in; all outputs are plain values.
 *
 * ## What this system does
 *   Rep-range-driven overload progression. The user trains at a given
 *   working weight until they consistently reach the upper end of the
 *   target rep range with safe execution under consistent rest conditions.
 *   When that happens, increase the weight. If performance degrades,
 *   hold or regress.
 *
 *   This is NOT a physiological model. It is a feedback policy that
 *   stabilises observed performance trajectories under noisy self-report
 *   signals. "Strength" here means "smoothed achievable performance under
 *   this protocol," not a latent biological variable.
 *
 * ## Session classification (per exercise)
 *   For each exercise session, classify performance using only completed
 *   working sets and the prescribed rep range:
 *
 *   qualifying — every completed working set reaches repRange.max or
 *                higher, AND the session is not rest-influenced
 *   adequate   — every completed working set reaches repRange.min, but
 *                not all reach repRange.max (or session is rest-influenced
 *                despite hitting max)
 *   failing    — at least one completed working set has reps < repRange.min
 *
 * ## Decision rules
 *   Progress after 2 consecutive qualifying sessions.
 *   Regress  after 2 failing sessions within the last 3.
 *   Otherwise hold current weight.
 *   Regression step: 1 × deltaW.
 *
 * ## Rest-duration modeling
 *   Rest is a hidden control variable with effect size comparable to load
 *   changes. If the user rests significantly longer than prescribed between
 *   sets, the session is flagged as rest-influenced. A rest-influenced
 *   session that would otherwise be qualifying is downgraded to adequate
 *   for progression purposes.
 *
 * ## State (persisted between sessions)
 *   currentWeight          — the working weight the user should be using
 *   consecutiveQualifying  — count of consecutive qualifying sessions
 *   recentOutcomes         — last 3 session classifications
 *   dw                     — progression step size (lbs)
 */

// ── Default Hyperparameters ───────────────────────────────────────────────────

const DEFAULTS = {
  qualifyThreshold:   2,      // consecutive qualifying sessions before progressing
  regressThreshold:   2,      // failing sessions within regressWindow before regressing
  regressWindow:      3,      // window size for counting failing sessions
  defaultDw:          2.5,    // default progression step (lbs) if not set

  // Rest-influence detection
  // If actual inter-set rest exceeds prescribed rest × this multiplier,
  // the session is flagged as rest-influenced.
  restCapMultiplier:  1.5,    // 150% of prescribed rest = soft cap
};

// ── Utility Exports (unchanged) ───────────────────────────────────────────────

/**
 * Compute per-set Epley e1RM.
 * Valid for ~1-12 reps. Degrades above ~15 reps.
 * Kept as a utility — not used in progression decisions.
 *
 * @param {number} w  weight (lbs, > 0)
 * @param {number} r  reps (> 0)
 * @returns {number|null}  estimated 1RM in lbs, or null if inputs invalid
 */
export function epleyE1RM(w, r) {
  if (!w || !r || w <= 0 || r <= 0) return null;
  return w * (1 + r / 30);
}

/**
 * Epley inverse: the weight at which you'd perform `reps` repetitions
 * given a 1RM estimate of `T`.
 * Kept as a utility — not used in progression decisions.
 *
 * @param {number} T           strength estimate / e1RM (lbs)
 * @param {number} targetReps  prescribed rep count
 * @returns {number}           working weight (lbs)
 */
export function workingTarget(T, targetReps) {
  if (!targetReps || targetReps <= 0) return T;
  return T / (1 + targetReps / 30);
}

// ── Rest-Influence Detection ──────────────────────────────────────────────────

/**
 * Determine if a session's rest durations were significantly longer than
 * prescribed, which would inflate rep performance beyond what the user
 * could sustain under normal rest conditions.
 *
 * Uses `completedAt` timestamps on consecutive completed sets to compute
 * actual inter-set rest. If ANY rest gap exceeds `prescribedRest × restCapMultiplier`,
 * the session is flagged as rest-influenced.
 *
 * @param {Array<{s:string, completedAt:number|null}>} sets
 * @param {number} prescribedRestSec  — expected rest between sets (seconds)
 * @returns {boolean}  true if the session is rest-influenced
 */
function isRestInfluenced(sets, prescribedRestSec) {
  if (!prescribedRestSec || prescribedRestSec <= 0) return false;

  const completedSets = (sets || []).filter(
    s => s.s === 'done' && s.completedAt !== null && s.completedAt > 0
  );

  if (completedSets.length < 2) return false;

  // Sort by completedAt to handle any ordering issues
  const sorted = [...completedSets].sort((a, b) => a.completedAt - b.completedAt);

  const capMs = prescribedRestSec * 1000 * DEFAULTS.restCapMultiplier;

  for (let i = 1; i < sorted.length; i++) {
    const restMs = sorted[i].completedAt - sorted[i - 1].completedAt;
    if (restMs > capMs) return true;
  }

  return false;
}

// ── Session Classification ────────────────────────────────────────────────────

/**
 * Classify a session's performance for a single exercise.
 *
 * Uses only completed working sets (status 'done', non-null weight and reps).
 * Ignores failed sets and incomplete sets.
 *
 * For fixed-rep exercises (min === max), qualifying means every working set
 * hits exactly that rep count or higher.
 *
 * @param {Array<{s:string, w:number|null, r:number|null}>} sets
 * @param {{min:number, max:number}} repRange — prescribed rep range
 * @param {number|null} currentWeight — the working weight for classification context
 * @param {{prescribedRestSec:number}} restData — rest configuration for rest-influence detection
 * @returns {{
 *   classification: 'qualifying'|'adequate'|'failing'|null,
 *   restInfluenced: boolean,
 *   workingWeight:  number|null,
 *   topWeight:      number|null,
 * }}
 */
export function classifySession(sets, repRange, currentWeight = null, restData = {}) {
  const done = (sets || []).filter(
    s => s.s === 'done' && s.w !== null && s.r !== null
  );

  if (!done.length) {
    return { classification: null, restInfluenced: false, workingWeight: null, topWeight: null };
  }

  // Working weight: the most common weight across completed sets.
  // For straight sets this is the single working weight.
  // For pyramid/ramp schemes this is the mode of completed set weights.
  const weightCounts = {};
  let maxCount = 0;
  let workingWeight = null;
  let topWeight = 0;

  for (const s of done) {
    const wKey = String(s.w);
    weightCounts[wKey] = (weightCounts[wKey] || 0) + 1;
    if (weightCounts[wKey] > maxCount) {
      maxCount = weightCounts[wKey];
      workingWeight = s.w;
    }
    if (s.w > topWeight) topWeight = s.w;
  }

  // Filter to only working sets (sets at the working weight).
  // This excludes warm-up sets, ramp sets, and back-off sets.
  const workingSets = done.filter(s => s.w === workingWeight);

  if (!workingSets.length) {
    return { classification: null, restInfluenced: false, workingWeight, topWeight };
  }

  const min = repRange?.min ?? 1;
  const max = repRange?.max ?? min;

  // Check rest influence
  const restInfluenced = isRestInfluenced(sets, restData.prescribedRestSec ?? 0);

  // Classify based on working set reps vs rep range
  const allHitMax = workingSets.every(s => s.r >= max);
  const allHitMin = workingSets.every(s => s.r >= min);

  let classification;

  if (!allHitMin) {
    classification = 'failing';
  } else if (allHitMax && !restInfluenced) {
    classification = 'qualifying';
  } else {
    // Either not all sets hit max, or rest-influenced despite hitting max
    classification = 'adequate';
  }

  return { classification, restInfluenced, workingWeight, topWeight };
}

// ── Full Session Update ───────────────────────────────────────────────────────

/**
 * Process one completed session for an exercise and return the next
 * progression state and recommendation.
 *
 * @param {object} prev   Previous progression state:
 *   { currentWeight, consecutiveQualifying, recentOutcomes, dw }
 * @param {object[]} sets Completed sets for this exercise this session
 * @param {object} opts   Options:
 *   - repRange         {{min:number, max:number}}  prescribed rep range
 *   - deltaW           {number}                    exercise-specific step (lbs)
 *   - prescribedRestSec {number}                   expected rest between sets (seconds)
 * @returns {{
 *   currentWeight:         number|null,
 *   consecutiveQualifying: number,
 *   recentOutcomes:        string[],
 *   dw:                    number,
 *   suggestedWeight:       number|null,
 *   decision:              'progress'|'hold'|'regress'|'init',
 *   sessionClassification: 'qualifying'|'adequate'|'failing'|null,
 *   topWeight:             number|null,
 *   restInfluenced:        boolean,
 * }}
 */
export function updateProgressionState(prev = {}, sets = [], opts = {}) {
  const dw = opts.deltaW ?? prev.dw ?? DEFAULTS.defaultDw;
  const repRange = opts.repRange ?? { min: 8, max: 12 };
  const prevWeight = prev.currentWeight ?? null;
  const prevConsecutive = prev.consecutiveQualifying ?? 0;
  const prevOutcomes = Array.isArray(prev.recentOutcomes) ? [...prev.recentOutcomes] : [];

  // Classify this session
  const {
    classification,
    restInfluenced,
    workingWeight: sessionWorkingWeight,
    topWeight
  } = classifySession(sets, repRange, prevWeight, {
    prescribedRestSec: opts.prescribedRestSec ?? 0,
  });

  // No completed working sets — return state unchanged with no suggestion
  if (classification === null) {
    return {
      currentWeight: prevWeight,
      consecutiveQualifying: prevConsecutive,
      recentOutcomes: prevOutcomes,
      dw,
      suggestedWeight: prevWeight,
      decision: prevWeight === null ? 'init' : 'hold',
      sessionClassification: null,
      topWeight: topWeight ?? null,
      restInfluenced: false,
    };
  }

  // Initialize currentWeight from first session's working weight
  const currentWeight = prevWeight ?? sessionWorkingWeight;

  // Update consecutive qualifying counter
  let consecutiveQualifying;
  if (classification === 'qualifying') {
    consecutiveQualifying = prevConsecutive + 1;
  } else {
    consecutiveQualifying = 0;
  }

  // Update recent outcomes (capped to regressWindow)
  const recentOutcomes = [...prevOutcomes, classification]
    .slice(-DEFAULTS.regressWindow);

  // ── Decision logic ─────────────────────────────────────────────────────
  let decision;
  let suggestedWeight;

  // Count failing sessions in the recent window
  const failingCount = recentOutcomes.filter(o => o === 'failing').length;

  if (consecutiveQualifying >= DEFAULTS.qualifyThreshold) {
    // Progress: user has demonstrated stable performance at rep ceiling
    decision = 'progress';
    suggestedWeight = currentWeight + dw;
    consecutiveQualifying = 0;  // Reset after progression
  } else if (failingCount >= DEFAULTS.regressThreshold) {
    // Regress: performance has degraded — drop one increment
    decision = 'regress';
    suggestedWeight = Math.max(0, currentWeight - dw);
    consecutiveQualifying = 0;  // Reset after regression
  } else {
    // Hold: keep working at current weight
    decision = 'hold';
    suggestedWeight = currentWeight;
  }

  // Discretize suggested weight to nearest dw step
  const step = Math.max(dw, 0.5);
  suggestedWeight = Math.max(0, step * Math.round(suggestedWeight / step));

  // If this was the first session (init), label it
  if (prevWeight === null) {
    decision = 'init';
  }

  return {
    currentWeight: decision === 'progress' ? suggestedWeight
                 : decision === 'regress'  ? suggestedWeight
                 : currentWeight,
    consecutiveQualifying,
    recentOutcomes,
    dw,
    suggestedWeight,
    decision,
    sessionClassification: classification,
    topWeight: topWeight ?? null,
    restInfluenced,
  };
}

// ── Fatigue Index (diagnostic only) ───────────────────────────────────────────

/**
 * Compute per-exercise intra-session fatigue index from a set array.
 *
 * Fatigue Index = 1 − (Last Set Performance / First Set Performance)
 * Performance = weight × reps.
 *
 * This is a diagnostic function — it returns a plausible fatigue metric
 * but does NOT feed into the progression state or decisions.
 * It can be displayed in the UI for user awareness.
 *
 * @param {Array<{s:string, w:number|null, r:number|null}>} sets
 * @returns {number|null}  ∈ [-∞, 1], increasing = more fatigue; negative = strength increase within session
 */
export function computeFatigueIndex(sets) {
  const done = (sets || []).filter(s => s.s === 'done' && s.w !== null && s.r !== null);
  if (done.length < 2) return null;

  const getPerf = s => s.w * s.r;

  const firstPerf = getPerf(done[0]);
  const lastPerf  = getPerf(done[done.length - 1]);

  if (firstPerf === 0) return null;
  return +(1 - lastPerf / firstPerf).toFixed(3);
}
