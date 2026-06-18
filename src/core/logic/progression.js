/**
 * ══════════════════════════════════════════════════════
 *  Progression Engine — Categorical Controller
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
 *   categorical observations using fixed thresholds to prevent
 *   chatter under noisy self-report data.
 *
 * ## Session classification (per exercise)
 *   Each session is compressed into one of three categories
 *   using only completed working sets and the prescribed rep range.
 *   All within-category variation is intentionally discarded —
 *   the signal is too noisy to extract a meaningful gradient.
 *
 *   Working-weight identification follows a deterministic fallback:
 *     1. currentWeight (persisted controller state, authoritative)
 *     2. prescribedWeight (program seed, bootstrap only)
 *     3. mode of completed set weights (absolute fallback)
 *   This ensures warmups and back-offs do not contaminate the
 *   working-set filter. Mode inference is only used when no
 *   prescribed context is available.
 *
 *   qualifying — every working set hits repRange.max or higher,
 *                AND the session is not rest-inflated beyond threshold
 *   adequate   — every working set hits repRange.min, but not
 *                all reach max (or rest-inflated despite max)
 *   failing    — at least one working set has reps < repRange.min
 *
 *   Note: qualifying is environment-adjusted (performance + rest constraint);
 *   failing is purely performance-based. The classifier is categorical
 *   but includes inference scaffolding: mode-derived working-weight
 *   identification (fallback only) and weight-agreement computation
 *   (diagnostic only). These are not pure categorical observations —
 *   they are deterministic heuristics that support the categorical
 *   decision without introducing statistical modeling.
 *
 *   Saturation: once reps exceed repRange.max, additional reps
 *   provide zero additional evidence for progression. 12/12/12
 *   and 20/20/20 both produce 'qualifying'. This is deliberate —
 *   the controller treats all above-threshold performance
 *   identically rather than attempting to extract a gradient.
 *
 * ## Decision rules (asymmetric dual-threshold)
 *   Progression and regression are intentionally asymmetric. They are
 *   two different stochastic processes at different timescales:
 *
 *   Progression (evidence accumulation, low-frequency):
 *     2 consecutive qualifying sessions. Order-sensitive streak.
 *     Detects sustained readiness. False progress is expensive
 *     (failure at new load, injury risk, confidence loss).
 *
 *   Regression (risk detection, high-frequency):
 *     2 failing sessions within the last 3. Order-insensitive density.
 *     Detects acute inability. False regression delay is cheap
 *     (one extra session at current load).
 *
 *   Precedence: if both thresholds are satisfied simultaneously,
 *   progression wins. Rationale: the qualifying streak requires
 *   consecutive evidence (stronger signal), whereas the failing
 *   window tolerates non-adjacent observations. Meeting both
 *   conditions simultaneously implies recent qualifying performance
 *   superimposed on older failures — the streak is the more
 *   temporally local signal.
 *
 *   This is NOT a symmetric hysteresis band. It is a dual-threshold
 *   system with timescale-separated rules. Do not attempt to
 *   symmetrize — the asymmetry is structural, not incidental.
 *
 *   Adequate sessions do NOT reset the qualifying streak.
 *   Only failing sessions reset it. This means Q → A → Q
 *   still satisfies the progression threshold, reflecting
 *   that an in-range session is not counter-evidence.
 *
 * ## Rest-inflation detection
 *   Rest duration is a confounding variable: longer rest inflates
 *   rep counts. Rest inflation is computed as a continuous scalar
 *   ∈ [0, 1] using a positionally-weighted log transform of
 *   inter-set rest gaps vs prescribed rest. Later gaps are weighted
 *   more heavily (fatigue-relevant structure). A qualifying result
 *   is downgraded to adequate when restInflationFactor > 0.5.
 *
 * ## Input validation
 *   repRange, deltaW, and prescribedRestSec are validated at the
 *   entry point of updateProgressionState. Invalid inputs (min > max,
 *   dw <= 0, negative rest) cause the controller to fail closed:
 *   it returns the previous state unchanged with decision 'hold'.
 *
 * ## State (persisted between sessions)
 *   currentWeight          — the working weight the user should use
 *   consecutiveQualifying  — qualifying streak length (resets on failing only)
 *   recentOutcomes         — last 3 session classifications (sliding window)
 *   dw                     — progression step size (lbs)
 *
 * ## Controller vs Diagnostics
 *   The controller's decision loop operates on categorical observations:
 *   {qualifying, adequate, failing} → {progress, hold, regress}.
 *
 *   The classifier (classifySession) additionally produces distributional
 *   metadata (modeDominanceRatio, weightAgreement) via mode inference and
 *   weight-drift computation. These are deterministic heuristics, not
 *   statistical estimates, but they are not purely categorical either.
 *   The controller does not consume them — they are infrastructure for
 *   a future belief-state layer, carried forward but not acted upon.
 *
 *   Diagnostic functions are grouped under the `diagnostics` namespace
 *   export: epleyE1RM, workingTarget, computeFatigueIndex. These
 *   expose continuous metrics for UI display and potential future
 *   estimator migration. They do NOT feed back into controller
 *   decisions. The architectural boundary is enforced by namespace
 *   grouping — no controller function calls into the diagnostics
 *   namespace.
 */

// ── Default Hyperparameters ───────────────────────────────────────────────────

const DEFAULTS = {
  qualifyThreshold:   2,      // consecutive qualifying sessions before progressing
  regressThreshold:   2,      // failing sessions within regressWindow before regressing
  regressWindow:      3,      // window size for counting failing sessions
  defaultDw:          2.5,    // default progression step (lbs) if not set
};

// Rest-inflation detection constants
// Rest gap ≥ REST_SATURATION_RATIO × prescribed = fully inflated (inflation = 1.0)
const REST_SATURATION_RATIO = 5;
// Qualifying → adequate downgrade threshold for restInflationFactor
const REST_INFLATION_THRESHOLD = 0.5;

// ── Diagnostic Utilities (not consumed by controller) ─────────────────────────
// Grouped under the `diagnostics` namespace export at end of file.
// These expose continuous metrics for UI display. They do NOT feed
// back into controller decisions.

/**
 * Compute per-set Epley e1RM.
 * Valid for ~1-12 reps. Degrades above ~15 reps.
 *
 * @param {number} w  weight (lbs, > 0)
 * @param {number} r  reps (> 0)
 * @returns {number|null}  estimated 1RM in lbs, or null if inputs invalid
 */
function epleyE1RM(w, r) {
  if (!w || !r || w <= 0 || r <= 0) return null;
  return w * (1 + r / 30);
}

/**
 * Epley inverse: the weight at which you'd perform `reps` repetitions
 * given a 1RM estimate of `T`.
 *
 * @param {number} T           strength estimate / e1RM (lbs)
 * @param {number} targetReps  prescribed rep count
 * @returns {number}           working weight (lbs)
 */
function workingTarget(T, targetReps) {
  if (!targetReps || targetReps <= 0) return T;
  return T / (1 + targetReps / 30);
}

// ── Rest-Inflation Detection ──────────────────────────────────────────────────

/**
 * Compute a continuous rest-inflation factor for a session.
 *
 * Returns a scalar ∈ [0, 1] representing how much inter-set rest exceeded
 * the prescribed duration. Uses a clipped log transform per gap with
 * positional weighting (later gaps weighted more heavily, reflecting
 * fatigue-relevant structure where inflation has larger effect on rep
 * capacity).
 *
 * Per-gap inflation:
 *   inflation_i = clamp(ln(actualRest / prescribedRest) / ln(SAT_RATIO), 0, 1)
 *
 * Positional weighting:
 *   weight_i = i  (1-indexed linear ramp: later gaps ≈ 2× early gaps)
 *
 * Factor = Σ(weight_i × inflation_i) / Σ(weight_i)
 *
 * @param {Array<{s:string, completedAt:number|null}>} sets
 * @param {number} prescribedRestSec  — expected rest between sets (seconds)
 * @returns {number}  ∈ [0, 1], 0 = no inflation, 1 = all gaps at saturation
 */
function computeRestInflation(sets, prescribedRestSec) {
  if (!prescribedRestSec || prescribedRestSec <= 0) return 0;

  const completedSets = (sets || []).filter(
    s => s.s === 'done' && s.completedAt !== null && s.completedAt > 0
  );

  if (completedSets.length < 2) return 0;

  // Sort by completedAt to handle any ordering issues
  const sorted = [...completedSets].sort((a, b) => a.completedAt - b.completedAt);

  const prescribedMs = prescribedRestSec * 1000;
  const lnMax = Math.log(REST_SATURATION_RATIO);
  const totalGaps = sorted.length - 1;

  let weightedSum = 0;
  let weightTotal = 0;

  for (let i = 1; i < sorted.length; i++) {
    const restMs = sorted[i].completedAt - sorted[i - 1].completedAt;
    const ratio = restMs / prescribedMs;
    // Clipped log transform: sub-prescribed rest → 0, ≥ SAT_RATIO → 1
    const inflation = Math.max(0, Math.min(1, Math.log(ratio) / lnMax));

    // Positional weight: later gaps weighted more (fatigue-relevant)
    const posWeight = i;  // 1, 2, 3, ...
    weightedSum += posWeight * inflation;
    weightTotal += posWeight;
  }

  return +(weightedSum / weightTotal).toFixed(4);
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
 * Returns distributional metadata (modeDominanceRatio, weightAgreement) that
 * the controller does not consume. These are infrastructure for a future
 * belief-state layer — carried forward, not acted upon.
 *
 * @param {Array<{s:string, w:number|null, r:number|null}>} sets
 * @param {{min:number, max:number}} repRange — prescribed rep range
 * @param {number|null} currentWeight — the working weight for classification context
 * @param {{prescribedRestSec:number, dw:number}} restData — rest and step config
 * @returns {{
 *   classification:      'qualifying'|'adequate'|'failing'|null,
 *   restInflationFactor: number,
 *   workingWeight:       number|null,
 *   topWeight:           number|null,
 *   modeDominanceRatio:  number,
 *   weightAgreement:     number|null,
 * }}
 */
export function classifySession(sets, repRange, currentWeight = null, restData = {}) {
  const done = (sets || []).filter(
    s => s.s === 'done' && s.w !== null && s.r !== null
  );

  if (!done.length) {
    return {
      classification: null, restInflationFactor: 0,
      workingWeight: null, topWeight: null,
      modeDominanceRatio: 0, weightAgreement: null,
    };
  }

  // ── Working-weight identification ─────────────────────────────────────
  // Deterministic fallback chain:
  //   1. currentWeight  — persisted controller state (authoritative)
  //   2. prescribedWeight from restData — program seed (bootstrap only)
  //   3. mode of completed set weights — absolute fallback
  //
  // Anchoring to a known weight prevents warmups and back-offs from
  // hijacking the working-set filter. Mode inference is only used
  // when no prescribed context is available.
  const anchorWeight = currentWeight ?? restData.prescribedWeight ?? null;

  // Always compute mode for distributional metadata, regardless of anchor.
  const weightCounts = {};
  let maxCount = 0;
  let modeWeight = null;
  let topWeight = 0;

  for (const s of done) {
    const wKey = String(s.w);
    weightCounts[wKey] = (weightCounts[wKey] || 0) + 1;
    if (weightCounts[wKey] > maxCount) {
      maxCount = weightCounts[wKey];
      modeWeight = s.w;
    }
    if (s.w > topWeight) topWeight = s.w;
  }

  // workingWeight: anchor if available, mode otherwise.
  // When anchored, we verify at least one set exists at that weight;
  // if not, fall back to mode (user may have deviated from plan).
  let workingWeight;
  if (anchorWeight != null && done.some(s => s.w === anchorWeight)) {
    workingWeight = anchorWeight;
  } else {
    workingWeight = modeWeight;
  }

  // modeDominanceRatio: fraction of ALL completed sets at the mode weight.
  // Full-session distribution metric — includes warmups, back-offs, etc.
  // Not consumed by controller. Carried as distributional summary for
  // future belief-state layer.
  const modeDominanceRatio = done.length > 0 ? +(maxCount / done.length).toFixed(4) : 0;

  // weightAgreement: agreement between inferred working weight and prescribed weight.
  // null when no prescribed weight exists — absence of a comparison target
  // is not agreement, it is unknown.
  // Not consumed by controller — propagated for diagnostics.
  let weightAgreement = null;
  if (currentWeight != null && workingWeight != null) {
    if (currentWeight === workingWeight) {
      weightAgreement = 1.0;
    } else {
      const drift = Math.abs(currentWeight - workingWeight);
      const tolerance = restData.dw ?? DEFAULTS.defaultDw;
      weightAgreement = +Math.max(0, 1 - drift / (tolerance * 3)).toFixed(4);
    }
  }

  // Filter to only working sets (sets at the working weight).
  // This excludes warm-up sets, ramp sets, and back-off sets.
  const workingSets = done.filter(s => s.w === workingWeight);

  if (!workingSets.length) {
    return {
      classification: null, restInflationFactor: 0,
      workingWeight, topWeight,
      modeDominanceRatio, weightAgreement,
    };
  }

  const min = repRange?.min ?? 1;
  const max = repRange?.max ?? min;

  // Compute rest inflation (continuous scalar)
  const restInflationFactor = computeRestInflation(sets, restData.prescribedRestSec ?? 0);

  // Classify based on working set reps vs rep range.
  // Saturation: s.r >= max treats 12 reps and 20 reps identically.
  // All above-threshold performance is equivalent to the controller.
  const allHitMax = workingSets.every(s => s.r >= max);
  const allHitMin = workingSets.every(s => s.r >= min);

  let classification;

  if (!allHitMin) {
    classification = 'failing';
  } else if (allHitMax && restInflationFactor <= REST_INFLATION_THRESHOLD) {
    classification = 'qualifying';
  } else {
    // Either not all sets hit max, or rest-inflated beyond threshold
    classification = 'adequate';
  }

  return {
    classification, restInflationFactor, workingWeight, topWeight,
    modeDominanceRatio, weightAgreement,
  };
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
 *   - repRange          {{min:number, max:number}}  prescribed rep range
 *   - deltaW            {number}                    exercise-specific step (lbs)
 *   - prescribedRestSec {number}                    expected rest between sets (seconds)
 *   - prescribedWeight  {number|null}               program-defined working weight (bootstrap seed)
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
 *   restInflationFactor:   number,
 *   controllerDistance:    { qualifyingNeeded: number, failingCapacity: number },
 *   modeDominanceRatio:    number,
 *   weightAgreement:       number|null,
 * }}
 */
export function updateProgressionState(prev = {}, sets = [], opts = {}) {
  const dw = opts.deltaW ?? prev.dw ?? DEFAULTS.defaultDw;
  const repRange = opts.repRange ?? { min: 8, max: 12 };
  const prevWeight = prev.currentWeight ?? null;
  const prevConsecutive = prev.consecutiveQualifying ?? 0;
  const prevOutcomes = Array.isArray(prev.recentOutcomes) ? [...prev.recentOutcomes] : [];

  // ── Input validation (fail closed) ──────────────────────────────────────
  // Invalid inputs → return previous state unchanged with decision 'hold'.
  // This prevents the controller from producing garbage-shaped certainty
  // on malformed configuration.
  if (repRange.min != null && repRange.max != null && repRange.min > repRange.max) {
    return _failClosed(prevWeight, prevConsecutive, prevOutcomes, dw);
  }
  if (dw <= 0) {
    return _failClosed(prevWeight, prevConsecutive, prevOutcomes, dw);
  }
  if (opts.prescribedRestSec != null && opts.prescribedRestSec < 0) {
    return _failClosed(prevWeight, prevConsecutive, prevOutcomes, dw);
  }

  // Classify this session
  const {
    classification,
    restInflationFactor,
    workingWeight: sessionWorkingWeight,
    topWeight,
    modeDominanceRatio,
    weightAgreement,
  } = classifySession(sets, repRange, prevWeight, {
    prescribedRestSec: opts.prescribedRestSec ?? 0,
    prescribedWeight: opts.prescribedWeight ?? null,
    dw,
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
      restInflationFactor: 0,
      controllerDistance: computeControllerDistance({ consecutiveQualifying: prevConsecutive, recentOutcomes: prevOutcomes }),
      modeDominanceRatio,
      weightAgreement,
    };
  }

  // Initialize currentWeight:
  //   persisted state > program seed > observed working weight (absolute fallback)
  // prescribedWeight is bootstrap-only — once state exists, it is authoritative.
  // Controller does not re-validate prior state against session observations.
  const currentWeight = prevWeight ?? opts.prescribedWeight ?? sessionWorkingWeight;

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

  // ── Controller distance (pre-decision) ─────────────────────────────────
  // Computed BEFORE the decision/reset below so it reflects the distance
  // that triggered the action, not the post-action state.
  const controllerDistance = computeControllerDistance({
    consecutiveQualifying,
    recentOutcomes,
  });

  // ── Controller output ──────────────────────────────────────────────────
  // Precedence: progression is checked before regression.
  // Rationale: the qualifying streak requires consecutive evidence (stronger,
  // more temporally local signal). If both thresholds are satisfied
  // simultaneously, recent qualifying performance supersedes older failures
  // in the window. See file header § Decision rules for full rationale.
  let decision;
  let suggestedWeight;

  // Count failing sessions in the recent window
  const failingCount = recentOutcomes.filter(o => o === 'failing').length;

  // Progression: evidence accumulation (consecutive streak, low-frequency)
  // Checked FIRST — takes precedence over regression. See § Decision rules.
  if (consecutiveQualifying >= DEFAULTS.qualifyThreshold) {
    decision = 'progress';
    suggestedWeight = currentWeight + dw;
    consecutiveQualifying = 0;  // Reset after progression
  // Regression: risk detection (window density, high-frequency)
  } else if (failingCount >= DEFAULTS.regressThreshold) {
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
    restInflationFactor,
    controllerDistance,
    modeDominanceRatio,
    weightAgreement,
  };
}

/**
 * Return a fail-closed result: previous state unchanged, decision 'hold'.
 * Used when input validation fails.
 * @private
 */
function _failClosed(prevWeight, prevConsecutive, prevOutcomes, dw) {
  return {
    currentWeight: prevWeight,
    consecutiveQualifying: prevConsecutive,
    recentOutcomes: prevOutcomes,
    dw,
    suggestedWeight: prevWeight,
    decision: 'hold',
    isFirstSession: prevWeight === null,
    sessionClassification: null,
    topWeight: null,
    restInflationFactor: 0,
    controllerDistance: computeControllerDistance({ consecutiveQualifying: prevConsecutive, recentOutcomes: prevOutcomes }),
    modeDominanceRatio: 0,
    weightAgreement: null,
  };
}

// ── Fatigue Index (diagnostic only) ───────────────────────────────────────────

/**
 * Compute per-exercise intra-session fatigue index from a set array.
 *
 * Fatigue Index = 1 − (Last Set Performance / First Set Performance)
 * Performance = weight × reps.
 *
 * Diagnostic function — does NOT feed into the progression state or decisions.
 * Displayed in the UI for user awareness.
 *
 * @param {Array<{s:string, w:number|null, r:number|null}>} sets
 * @returns {number|null}  ∈ [-∞, 1], increasing = more fatigue; negative = strength increase within session
 */
function computeFatigueIndex(sets) {
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

// ── Diagnostics Namespace ─────────────────────────────────────────────────────
// Structural boundary: diagnostic functions are grouped here to enforce
// separation from controller logic without premature module splitting.
// These share evolution with the controller (same data structures) but
// are NOT consumed by any controller function.

export const diagnostics = {
  epleyE1RM,
  workingTarget,
  computeFatigueIndex,
};
