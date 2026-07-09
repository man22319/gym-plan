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
 *   This is a BOUNDED-MEMORY DETERMINISTIC CONTROLLER, not a
 *   state estimator. It does NOT estimate a latent strength
 *   variable, compute confidence intervals, smooth performance
 *   trajectories, or perform parametric trajectory modeling
 *   (slope fitting, curvature estimation, rate-of-change
 *   inference).
 *
 *   The entire decision loop is:
 *
 *     observed reps → classify → state machine → weight recommendation
 *
 *   Think thermostat, not forecaster. The system reacts to
 *   categorical observations using fixed thresholds to prevent
 *   chatter under noisy self-report data.
 *
 *   Formally: the controller is a finite-state automaton with
 *   bounded memory (Markov order ≤ 3). It maintains:
 *     - consecutiveQualifying (order-sensitive streak)
 *     - recentOutcomes (order-insensitive sliding window, size 3)
 *     - controllerDistance (derived from both, not independent)
 *   These encode path dependence — the system is NOT memoryless.
 *   It does not, however, aggregate history into latent structure,
 *   build running estimates, or adapt its own thresholds based
 *   on past decisions. Responsiveness to progress signals, fatigue
 *   trajectory, or adaptation rate would require a separate
 *   estimation layer feeding into the decision layer — that is a
 *   different architecture, not a patch on this one.
 *
 * ## Accepted Design Tradeoffs
 *   The categorical controller deliberately sacrifices sensitivity
 *   for noise robustness. The following limitations are structural,
 *   not bugs. They are the cost of operating on noisy, self-reported
 *   gym data with only fixed-rule transforms (no learned weighting
 *   of signals, no parametric models, no uncertainty quantification):
 *
 *   SATURATION — 12/12/12 and 20/20/20 both produce 'qualifying'.
 *     All above-threshold performance is treated identically.
 *     No acceleration for surplus capacity. No within-category
 *     gradient. This means strong performers may plateau
 *     artificially early in system terms.
 *
 *   NO PARAMETRIC TRAJECTORY MODELING — the controller cannot
 *     distinguish chronic instability (Q A Q F Q F) from acute
 *     failure collapse (Q Q Q F F). Both are evaluated by the
 *     same density-in-window rule. The streak and window DO
 *     encode crude temporal structure (first-order contiguity
 *     and windowed frequency), but this is not parametric
 *     trajectory inference — no slope, curvature, or rate-of-
 *     change is estimated.
 *
 *   ASYMMETRIC TIMESCALES — progression (streak) and regression
 *     (window density) operate on different timescale structures.
 *     This is intentional but means the system reacts equally to
 *     different risk profiles. See § Decision rules.
 *
 *   CONTROLLER DISTANCE IS NOT PREDICTIVE — distance-to-threshold
 *     reports current state, not future likelihood. Two athletes
 *     both "1 session away" may have completely different outcomes.
 *     The metric is exact but makes no claims about the future.
 *
 *   These tradeoffs are inherent to a bounded-memory categorical
 *   controller. Addressing them requires a two-layer architecture
 *   (estimation layer + decision layer), not modifications to
 *   the decision rules.
 *
 * ## Session classification (per exercise)
 *   Each session is compressed into one of three categories
 *   using only completed working sets and the prescribed rep range.
 *   All within-category variation is intentionally discarded.
 *   The system does NOT reject continuous data — it consumes
 *   exact rep counts, weights, and timing. What it rejects is
 *   inference over continuous data: no learned weighting, no
 *   model-based interpretation of magnitude. Only fixed-rule
 *   transforms of continuous inputs into categorical outputs.
 *
 *   Working-weight identification uses the anchor weight (persisted
 *   currentWeight or prescribedWeight) ONLY when the anchor has at
 *   least as many completed sets as the mode weight. If mode has
 *   strictly more sets, the user did most of their work at a weight
 *   different from the anchor — mode is the real working weight.
 *
 *   This handles the common pattern: user does a check set at the
 *   recommended weight, then bumps up because it felt easy. The one
 *   anchor-weight set no longer hijacks classification.
 *
 *   Fallback chain:
 *     1. anchor (currentWeight or prescribedWeight) — if set count >= mode
 *     2. mode of completed set weights — if mode has more sets
 *     3. mode also serves as absolute fallback when no anchor exists
 *
 *   qualifying — every working set hits repRange.max or higher
 *   adequate   — every working set hits repRange.min, but not
 *                all reach max
 *   failing    — at least one working set has reps < repRange.min
 *
 *   Classification is PURELY performance-based: reps vs prescribed
 *   range, nothing else. Rest duration, e1RM trends, and other
 *   contextual variables do NOT influence the categorical label.
 *   They are computed and returned as diagnostic metadata for
 *   UI display but are not consumed by the classifier or the
 *   controller.
 *
 *   The classifier includes inference scaffolding: mode-derived
 *   working-weight identification and weight-agreement computation
 *   (diagnostic only). These are deterministic heuristics that
 *   support the categorical decision without introducing
 *   statistical modeling.
 *
 * ## Rest-inflation detection (DIAGNOSTIC ONLY)
 *   Rest inflation is computed as a continuous scalar ∈ [0, 1]
 *   using a positionally-weighted log transform of inter-set
 *   rest gaps vs prescribed rest. This metric is RETURNED for
 *   UI display and user awareness but does NOT influence
 *   session classification or controller decisions.
 *
 *   Rationale: rest duration is a confounding variable, but
 *   there is no validated model mapping rest to "true" capacity.
 *   Any adjustment (threshold-based or continuous attenuation)
 *   introduces an unvalidated heuristic into the decision path.
 *   It is better to surface the information for human judgment
 *   than to silently reshape controller behavior.
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
 *   DUAL MEMORY CHANNELS — streak (order-sensitive) and window
 *   (order-insensitive) are independent state representations
 *   encoding different hypotheses about the same process:
 *     - Streak assumes contiguity matters (Markov assumption)
 *     - Window assumes frequency matters (Bernoulli-like model)
 *   These are incommensurate. Disagreement between them is
 *   expected and is not resolved by a reconciliation layer.
 *   They can produce ordering-dependent behavior: the sequence
 *   Q Q F Q Q may progress while F Q Q Q F may not, despite
 *   identical event counts. This is a structural property of
 *   dual-channel control, not a bug.
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
 * ## Input validation
 *   repRange, deltaW, and prescribedRestSec are validated at the
 *   entry point of updateProgressionState. Invalid inputs (min > max,
 *   dw <= 0, negative rest) cause the controller to fail closed:
 *   it returns the previous state unchanged with decision 'hold'.
 *
 * ## State (persisted between sessions)
 *   currentWeight          — the working weight the user should use.
 *                            Updated on progress/regress (by ±dw) AND
 *                            on upward weight acknowledgment: if the user
 *                            lifts above currentWeight and doesn't fail,
 *                            currentWeight jumps to match observed weight.
 *                            This is reality tracking, not progression.
 *   consecutiveQualifying  — qualifying streak length (resets on failing only)
 *   recentOutcomes         — last 3 session classifications (sliding window)
 *   dw                     — progression step size (lbs)
 *
 * ## Controller vs Diagnostics
 *   The controller's decision loop operates on categorical observations:
 *   {qualifying, adequate, failing} → {progress, hold, regress}.
 *
 *   The classifier (classifySession) additionally produces:
 *     - restInflationFactor (continuous, ∈ [0,1]) — diagnostic only
 *     - modeDominanceRatio (distributional summary) — diagnostic only
 *     - weightAgreement (drift detection) — diagnostic only
 *   These are deterministic point estimators of latent variables
 *   (rest influence, weight distribution, anchor drift) without
 *   uncertainty modeling — fixed transforms with hard-coded
 *   assumptions, not fitted or adaptive. The controller does not
 *   consume them — they are surfaced for UI display and user
 *   judgment.
 *
 *   Diagnostic functions are grouped under the `diagnostics` namespace
 *   export: epleyE1RM, workingTarget, computeFatigueIndex. These
 *   expose continuous metrics for UI display. They do NOT feed back
 *   into controller decisions. The architectural boundary is enforced
 *   by namespace grouping — no controller function calls into the
 *   diagnostics namespace.
 */

// ── Default Hyperparameters ───────────────────────────────────────────────────

const DEFAULTS = {
  qualifyThreshold:   2,      // consecutive qualifying sessions before progressing
  regressThreshold:   2,      // failing sessions within regressWindow before regressing
  regressWindow:      3,      // window size for counting failing sessions
  defaultDw:          2.5,    // default progression step (lbs) if not set
};

// Rest-inflation detection constants (DIAGNOSTIC ONLY — not consumed by classifier)
// Rest gap ≥ REST_SATURATION_RATIO × prescribed = fully inflated (inflation = 1.0)
const REST_SATURATION_RATIO = 5;

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

/**
 * Classify the structural pattern of a set sequence.
 *
 * Uses execution order (sorted by completedAt, falling back to array index).
 * Detects the four training patterns that affect working-weight inference:
 *   straight       — all sets at one weight (mode = unambiguous working weight)
 *   ramp           — strictly non-decreasing (mode = top of ramp, may be a test set)
 *   topset_backoff — heavy opener followed by lighter work (mode = backoff weight)
 *   mixed          — doesn't fit a clean pattern
 *
 * This is structural detection, not intent inference. It produces a signal
 * for the confidence calculation — it does not make policy decisions.
 *
 * @param {Array<{w:number, completedAt?:number}>} done — completed sets (non-null w)
 * @returns {'straight'|'ramp'|'topset_backoff'|'mixed'}
 */
function detectSessionType(done) {
  if (!done.length) return 'mixed';

  // Sort by completedAt for temporal ordering; fall back to array index.
  const sorted = [...done].sort((a, b) => {
    if (a.completedAt != null && b.completedAt != null) return a.completedAt - b.completedAt;
    return 0;  // preserve insertion order if no timestamps
  });

  const weights = sorted.map(s => s.w);
  const unique = new Set(weights);

  // Straight: all sets at the same weight.
  if (unique.size === 1) return 'straight';

  // Ramp: each set weight is >= the previous (ascending, possibly with plateau at top).
  let isRamp = true;
  for (let i = 1; i < weights.length; i++) {
    if (weights[i] < weights[i - 1]) { isRamp = false; break; }
  }
  if (isRamp) return 'ramp';

  // Top-set + backoff: the heaviest weight appears early (index 0 or 1)
  // and the majority of the remaining sets are lighter.
  const maxW = Math.max(...weights);
  const firstPeakIdx = weights.indexOf(maxW);
  const lighterCount = weights.filter(w => w < maxW).length;
  if (firstPeakIdx <= 1 && lighterCount >= 2) return 'topset_backoff';

  return 'mixed';
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
 * Returns distributional metadata (modeDominanceRatio, weightAgreement, sessionType, classifierConfidence)
 * that the controller does not consume. These are infrastructure for a future
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
 *   sessionType:         'straight'|'ramp'|'topset_backoff'|'mixed',
 *   classifierConfidence: number,
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
      sessionType: 'mixed', classifierConfidence: 0,
    };
  }

  const sessionType = detectSessionType(done);

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
    // Mode = weight with most sets. On tie, prefer higher weight.
    // This handles ramp sessions (each set at a different weight):
    // the heaviest weight becomes mode when counts are equal.
    if (
      weightCounts[wKey] > maxCount ||
      (weightCounts[wKey] === maxCount && s.w > (modeWeight ?? 0))
    ) {
      maxCount = weightCounts[wKey];
      modeWeight = s.w;
    }
    if (s.w > topWeight) topWeight = s.w;
  }

  // workingWeight: anchor if it has at least as many sets as mode, mode
  // otherwise (mode has STRICTLY more sets than anchor).
  //
  // The anchor prevents warmups from hijacking the working-set filter.
  // But when the user does a check set at the anchor then works at a
  // higher weight, or ramps through multiple weights, the anchor has
  // fewer sets vs mode. In those cases mode wins — the user's
  // real work was at the higher weight.
  //
  // Combined with the mode tie-break (prefer higher weight on equal
  // count), this means:
  //   [50×12, 60×12, 60×12] → mode=60 (2 sets) > anchor=50 (1) → 60
  //   [60×12, 70×12, 75×12] → mode=75 (tie, highest) = anchor=60 (1) → 75
  //   [60×12, 60×12, 60×12] → mode=60 = anchor=60 → 60 (either branch)
  let workingWeight;
  if (anchorWeight != null) {
    const anchorCount = done.filter(s => s.w === anchorWeight).length;
    if (anchorCount >= maxCount) {
      // Anchor has equal or more sets than any other weight → use anchor
      workingWeight = anchorWeight;
    } else {
      // Mode has strictly more sets → user mostly worked at mode weight
      workingWeight = modeWeight;
    }
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

  // ── Classifier confidence ─────────────────────────────────────────────
  // Measures how reliably modeWeight = the user's intended training weight.
  //
  // Base = modeDominanceRatio: fraction of all sets at the mode weight.
  //   1.0 (straight sets)   → mode is unambiguous
  //   0.5 (ramp, 2/4 sets)  → mode is the top of a ramp, may be a test set
  //
  // Ramp penalty: ramp sessions systematically produce a high mode weight
  // even when only 1–2 sets were performed there. Penalize by RAMP_PENALTY.
  //
  // Agreement blend: if we have a prior anchor, weightAgreement already
  // captures disagreement between the anchor and the inferred weight.
  // Blend it in as a 40% weight to avoid double-counting modeDominanceRatio.
  //
  // This is a diagnostic scalar, not a probability. It feeds into bootstrap
  // policy only — it does not influence the classifier or controller outputs.
  const RAMP_PENALTY = 0.5;
  let classifierConfidence = modeDominanceRatio;
  if (sessionType === 'ramp') classifierConfidence *= RAMP_PENALTY;
  if (weightAgreement !== null) {
    classifierConfidence = 0.6 * classifierConfidence + 0.4 * weightAgreement;
  }
  classifierConfidence = +Math.min(1, Math.max(0, classifierConfidence)).toFixed(4);

  // Filter to only working sets (sets at the working weight).
  // This excludes warm-up sets, ramp sets, and back-off sets.
  const workingSets = done.filter(s => s.w === workingWeight);

  if (!workingSets.length) {
    return {
      classification: null, restInflationFactor: 0,
      workingWeight, topWeight,
      modeDominanceRatio, weightAgreement,
      sessionType, classifierConfidence,
    };
  }

  const min = repRange?.min ?? 1;
  const max = repRange?.max ?? min;

  // Compute rest inflation (continuous scalar)
  const restInflationFactor = computeRestInflation(sets, restData.prescribedRestSec ?? 0);

  // Classify based on working set reps vs rep range ONLY.
  // Classification is purely performance-based. Rest inflation, e1RM,
  // and other contextual variables are diagnostic — they do not
  // influence the categorical label. See § Rest-inflation detection.
  //
  // Saturation: s.r >= max treats 12 reps and 20 reps identically.
  // All above-threshold performance is equivalent to the controller.
  // This is an accepted tradeoff — see § Accepted Design Tradeoffs.
  const allHitMax = workingSets.every(s => s.r >= max);
  const allHitMin = workingSets.every(s => s.r >= min);

  let classification;

  if (!allHitMin) {
    classification = 'failing';
  } else if (allHitMax) {
    classification = 'qualifying';
  } else {
    classification = 'adequate';
  }

  return {
    classification, restInflationFactor, workingWeight, topWeight,
    modeDominanceRatio, weightAgreement,
    sessionType, classifierConfidence,
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
 *   - maxW              {number|null}               equipment ceiling — hard clamp (optional)
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
 *   sessionType:           'straight'|'ramp'|'topset_backoff'|'mixed',
 *   classifierConfidence:  number,
 * }}
 */
export function updateProgressionState(prev = {}, sets = [], opts = {}) {
  const dw = opts.deltaW ?? prev.dw ?? DEFAULTS.defaultDw;
  const maxW = opts.maxW ?? null;
  const repRange = opts.repRange ?? { min: 8, max: 12 };
  const prevWeight = prev.currentWeight ?? null;
  const prevConsecutive = prev.consecutiveQualifying ?? 0;
  const prevOutcomes = Array.isArray(prev.recentOutcomes) ? [...prev.recentOutcomes] : [];

  // ── Input validation (fail closed) ──────────────────────────────────────
  // Invalid inputs → return previous state unchanged with decision 'hold'.
  // This prevents the controller from producing garbage-shaped certainty
  // on malformed configuration.
  if (repRange.min != null && repRange.max != null && repRange.min > repRange.max) {
    return _failClosed(prevWeight, prevConsecutive, prevOutcomes, dw, maxW);
  }
  if (dw <= 0) {
    return _failClosed(prevWeight, prevConsecutive, prevOutcomes, dw, maxW);
  }
  if (opts.prescribedRestSec != null && opts.prescribedRestSec < 0) {
    return _failClosed(prevWeight, prevConsecutive, prevOutcomes, dw, maxW);
  }

  // Classify this session
  const {
    classification,
    restInflationFactor,
    workingWeight: sessionWorkingWeight,
    topWeight,
    modeDominanceRatio,
    weightAgreement,
    sessionType,
    classifierConfidence,
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
      sessionType: sessionType ?? 'mixed',
      classifierConfidence: classifierConfidence ?? 0,
    };
  }

  // ── Bootstrap policy: commit vs. retain ─────────────────────────────────
  //
  // On the first session (no prior state), the observed working weight is
  // inferred statistically (mode of set weights). That inference is reliable
  // for straight-set sessions but unreliable for ramps, where the mode is
  // the top of the ramp and may represent a test set rather than the
  // programmed working weight.
  //
  // Policy:
  //   High confidence (>= BOOTSTRAP_CONFIDENCE_THRESHOLD):
  //     Commit observed weight — classifier has clear evidence.
  //   Low confidence (< threshold):
  //     Retain prescribed seed — ambiguous session structure; let the user
  //     progress from the seed organically after straight-set confirmation.
  //
  // This separates classification (what weight did the mode computation
  // produce?) from policy (should we trust that inference as a baseline?).
  //
  // The threshold is a named constant — change it here if calibration is
  // needed after observing real data.
  const BOOTSTRAP_CONFIDENCE_THRESHOLD = 0.75;

  const isBootstrap = prevWeight == null;
  let currentWeight;
  if (isBootstrap) {
    if (classifierConfidence >= BOOTSTRAP_CONFIDENCE_THRESHOLD) {
      // Classifier is confident: adopt inferred working weight.
      currentWeight = sessionWorkingWeight ?? opts.prescribedWeight ?? null;
    } else {
      // Classifier is uncertain (ramp, mixed pattern): anchor to prescribed
      // seed so the controller doesn't commit an ambiguous top-set as baseline.
      // Falls back to sessionWorkingWeight only when no seed exists.
      currentWeight = opts.prescribedWeight ?? sessionWorkingWeight ?? null;
    }
  } else {
    currentWeight = prevWeight;
  }

  // ── Reality tracking: upward weight acknowledgment ──────────────────
  // If the user lifted at a weight ABOVE the controller's state AND
  // didn't fail, update currentWeight to match observed reality.
  // This is not progression — it's acknowledging what the user proved.
  // The streak/window logic still controls when the weight advances.
  //
  // Failing at a self-selected higher weight does NOT update — the user
  // overreached, and the controller should not penalize by regressing
  // from the higher weight. Only qualifying/adequate prove capacity.
  //
  // This guard only applies to ESTABLISHED baselines (non-bootstrap).
  // On bootstrap, the observed weight was already set above.
  if (
    !isBootstrap &&
    classification !== 'failing' &&
    sessionWorkingWeight != null &&
    sessionWorkingWeight > currentWeight
  ) {
    currentWeight = sessionWorkingWeight;
  }

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
  // Additional precondition: the most recent session must be failing.
  // A qualifying or adequate session should never trigger regression —
  // the user just proved they can handle the weight. Stale failing
  // sessions in the window should not override the most recent evidence.
  // This prevents the "double regression on recovery" bug where a user
  // recovers from illness (Q after F,F) and gets regressed anyway.
  } else if (
    failingCount >= DEFAULTS.regressThreshold &&
    classification === 'failing'
  ) {
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

  // ── maxW clamp (SINGLE location) ──────────────────────────────────
  // Equipment ceiling supersedes the deltaW grid.
  // Applied once, after all computation is final.
  if (maxW != null && suggestedWeight > maxW) {
    suggestedWeight = maxW;
  }

  const committedWeight = decision === 'progress' ? suggestedWeight
                        : decision === 'regress'  ? suggestedWeight
                        : currentWeight;

  // isFirstSession is a UI-layer concern, not a controller state.
  // The controller always returns its true decision (progress/hold/regress).
  const isFirstSession = prevWeight === null;

  return {
    currentWeight: maxW != null ? Math.min(committedWeight, maxW) : committedWeight,
    consecutiveQualifying,
    recentOutcomes,
    dw,
    suggestedWeight,
    decision,
    isFirstSession,
    isAtMax: maxW != null && committedWeight >= maxW,
    sessionClassification: classification,
    topWeight: topWeight ?? null,
    restInflationFactor,
    controllerDistance,
    modeDominanceRatio,
    weightAgreement,
    sessionType,
    classifierConfidence,
  };
}

/**
 * Return a fail-closed result: previous state unchanged, decision 'hold'.
 * Used when input validation fails.
 * @private
 */
function _failClosed(prevWeight, prevConsecutive, prevOutcomes, dw, maxW = null) {
  const cw = maxW != null && prevWeight != null ? Math.min(prevWeight, maxW) : prevWeight;
  return {
    currentWeight: cw,
    consecutiveQualifying: prevConsecutive,
    recentOutcomes: prevOutcomes,
    dw,
    suggestedWeight: cw,
    decision: 'hold',
    isFirstSession: prevWeight === null,
    isAtMax: maxW != null && cw != null && cw >= maxW,
    sessionClassification: null,
    topWeight: null,
    restInflationFactor: 0,
    controllerDistance: computeControllerDistance({ consecutiveQualifying: prevConsecutive, recentOutcomes: prevOutcomes }),
    modeDominanceRatio: 0,
    weightAgreement: null,
    sessionType: 'mixed',
    classifierConfidence: 0,
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
