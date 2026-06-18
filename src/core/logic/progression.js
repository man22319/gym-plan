/**
 * ══════════════════════════════════════════════════════
 *  Progression Engine — Hysteresis Controller
 *  src/core/logic/progression.js
 * ══════════════════════════════════════════════════════
 *
 * Pure functions — zero side-effects, no DOM, no imports.
 * All inputs are passed in; all outputs are plain values.
 *
 * ## Architecture
 *   This is a rule-based controller, not a predictive model.
 *   It does NOT estimate a latent strength variable, compute
 *   confidence intervals, or smooth performance trajectories.
 *
 *   The entire decision loop is:
 *
 *     observed reps → classify → state machine → weight recommendation
 *
 *   Think thermostat, not forecaster. The system reacts to
 *   categorical observations using fixed thresholds with
 *   hysteresis to prevent chatter under noisy self-report data.
 *
 * ## Session classification (per exercise)
 *   Each session is compressed into one of three categories
 *   using only completed working sets and the prescribed rep range.
 *   All within-category variation is intentionally discarded —
 *   the signal is too noisy to extract a meaningful gradient.
 *
 *   qualifying — every working set hits repRange.max or higher,
 *                AND the session is not rest-influenced
 *   adequate   — every working set hits repRange.min, but not
 *                all reach max (or rest-influenced despite max)
 *   failing    — at least one working set has reps < repRange.min
 *
 *   Saturation: once reps exceed repRange.max, additional reps
 *   provide zero additional evidence for progression. 12/12/12
 *   and 20/20/20 both produce 'qualifying'. This is deliberate —
 *   the controller treats all above-threshold performance
 *   identically rather than attempting to extract a gradient.
 *
 * ## Decision rules (hysteresis band)
 *   Progress after 2 consecutive qualifying sessions.
 *   Regress  after 2 failing sessions within the last 3.
 *   Otherwise hold.
 *   The consecutive/window thresholds ARE the noise filter —
 *   they create inertia that prevents single-session flukes
 *   from triggering weight changes.
 *
 *   Adequate sessions do NOT reset the qualifying streak.
 *   Only failing sessions reset it. This means Q → A → Q
 *   still satisfies the progression threshold, reflecting
 *   that an in-range session is not counter-evidence.
 *
 * ## Rest-influence detection
 *   Rest duration is a confounding variable: longer rest inflates
 *   rep counts. If the majority of inter-set rest gaps exceed
 *   prescribedRest × 1.5, the session is flagged as rest-influenced
 *   and a qualifying result is downgraded to adequate.
 *
 * ## State (persisted between sessions)
 *   currentWeight          — the working weight the user should use
 *   consecutiveQualifying  — qualifying streak length (resets on failing only)
 *   recentOutcomes         — last 3 session classifications (sliding window)
 *   dw                     — progression step size (lbs)
 *
 * ## Controller vs Diagnostics
 *   The controller operates on categorical observations only:
 *   {qualifying, adequate, failing} → {progress, hold, regress}.
 *
 *   Diagnostic utilities expose continuous metrics for UI display:
 *   epleyE1RM, workingTarget, computeFatigueIndex, topWeight,
 *   workingWeight. These do NOT feed back into the controller.
 *   They would become relevant only if migrating to an
 *   estimator-based architecture.
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

// ── Epley Utilities (diagnostic only, not consumed by controller) ─────────────

/**
 * Compute per-set Epley e1RM.
 * Valid for ~1-12 reps. Degrades above ~15 reps.
 *
 * Not used in progression decisions. Exported for UI/diagnostic purposes.
 * Would become relevant if migrating to an estimator-based architecture.
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
 *
 * Not used in progression decisions. Exported for UI/diagnostic purposes.
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
 * actual inter-set rest. The session is flagged as rest-influenced if the
 * MAJORITY of rest gaps exceed `prescribedRest × restCapMultiplier`.
 *
 * Majority rule prevents a single long rest gap (e.g. a bathroom break)
 * from vetoing an entire session's progression credit.
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

  let exceeded = 0;
  const totalGaps = sorted.length - 1;

  for (let i = 1; i < sorted.length; i++) {
    const restMs = sorted[i].completedAt - sorted[i - 1].completedAt;
    if (restMs > capMs) exceeded++;
  }

  // Flag only if the majority of rest gaps exceeded the cap
  return exceeded > totalGaps / 2;
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

  // Classify based on working set reps vs rep range.
  // Saturation: s.r >= max treats 12 reps and 20 reps identically.
  // All above-threshold performance is equivalent to the controller.
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
 *   decision:              'progress'|'hold'|'regress',
 *   isFirstSession:        boolean,
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
      decision: 'hold',
      isFirstSession: prevWeight === null,
      sessionClassification: null,
      topWeight: topWeight ?? null,
      restInfluenced: false,
    };
  }

  // Initialize currentWeight from first session's working weight
  const currentWeight = prevWeight ?? sessionWorkingWeight;

  // Update consecutive qualifying counter.
  // Only failing resets the streak — adequate preserves it.
  // This means Q → A → Q still satisfies the progression threshold.
  let consecutiveQualifying;
  if (classification === 'qualifying') {
    consecutiveQualifying = prevConsecutive + 1;
  } else if (classification === 'failing') {
    consecutiveQualifying = 0;
  } else {
    // adequate: preserve current streak
    consecutiveQualifying = prevConsecutive;
  }

  // Update recent outcomes (capped to regressWindow)
  const recentOutcomes = [...prevOutcomes, classification]
    .slice(-DEFAULTS.regressWindow);

  // ── Controller output ──────────────────────────────────────────────────
  let decision;
  let suggestedWeight;

  // Count failing sessions in the recent window
  const failingCount = recentOutcomes.filter(o => o === 'failing').length;

  if (consecutiveQualifying >= DEFAULTS.qualifyThreshold) {
    // Progress: consecutive qualifying sessions exceeded hysteresis threshold
    decision = 'progress';
    suggestedWeight = currentWeight + dw;
    consecutiveQualifying = 0;  // Reset after progression
  } else if (failingCount >= DEFAULTS.regressThreshold) {
    // Regress: failing density in recent window exceeded threshold
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

  // isFirstSession is a UI-layer concern, not a controller state.
  // The controller always returns its true decision (progress/hold/regress).
  const isFirstSession = prevWeight === null;

  // Controller distance: exact arithmetic on state, no statistics
  const controllerDistance = computeControllerDistance({
    consecutiveQualifying,
    recentOutcomes,
  });

  return {
    currentWeight: decision === 'progress' ? suggestedWeight
                 : decision === 'regress'  ? suggestedWeight
                 : currentWeight,
    consecutiveQualifying,
    recentOutcomes,
    dw,
    suggestedWeight,
    decision,
    isFirstSession,
    sessionClassification: classification,
    topWeight: topWeight ?? null,
    restInfluenced,
    controllerDistance,
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

// ── Controller Distance (exact, no statistics) ───────────────────────────────

/**
 * Compute the controller's distance to its progression and regression
 * thresholds.
 *
 * This is pure arithmetic on the controller state — no probability
 * model, no Laplace smoothing, no simulation.  It reads the same
 * variables the controller uses to make decisions and reports how
 * far the current state is from each threshold.
 *
 * Returns:
 *   qualifyingNeeded — consecutive qualifying sessions still needed
 *                      to trigger progression (0 = would progress now)
 *   failingCapacity  — additional failing sessions the recent window
 *                      can absorb before regression triggers
 *                      (0 = would regress now)
 *
 * These are the controller-native quantities.  They are exact,
 * immediately interpretable, and make no claims about the future.
 *
 * @param {object} state — current progression state:
 *   { consecutiveQualifying, recentOutcomes }
 * @returns {{ qualifyingNeeded: number, failingCapacity: number }}
 */
export function computeControllerDistance(state = {}) {
  const consecutiveQualifying = state.consecutiveQualifying ?? 0;
  const recentOutcomes = Array.isArray(state.recentOutcomes)
    ? state.recentOutcomes
    : [];

  // Distance to progression: how many more consecutive qualifying sessions needed
  const qualifyingNeeded = Math.max(0, DEFAULTS.qualifyThreshold - consecutiveQualifying);

  // Distance to regression: how many more failing sessions the window can absorb
  const failingInWindow = recentOutcomes.filter(o => o === 'failing').length;
  const failingCapacity = Math.max(0, DEFAULTS.regressThreshold - failingInWindow);

  return { qualifyingNeeded, failingCapacity };
}
