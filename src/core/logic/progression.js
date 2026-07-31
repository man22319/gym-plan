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
 * ## ROM quality tracking (DIAGNOSTIC ONLY)
 *   Per-session ROM pattern is classified from working-set rom values
 *   into one of five categories: consistent-full, consistent-partial,
 *   degrading, improving, mixed.
 *
 *   DEGRADATION REQUIRES DIRECTIONALITY — a single partial-ROM set
 *   surrounded by full-ROM sets is 'mixed', not 'degrading'. Only a
 *   strictly descending tail (partial at the end with no subsequent
 *   full recovery) qualifies. This prevents the classifier from
 *   firing on normal intra-set variation.
 *
 *   Cross-session ROM trend detection uses a bounded window
 *   (recentRomSummaries, size ≤3) persisted in progressionState.
 *   Only 'degrading' and 'consistent-partial' count as evidence
 *   toward the regression threshold — 'mixed' sessions are noise
 *   and do NOT accumulate.
 *
 *   Two-tier warning:
 *     Informational chip — current session is 'degrading' but no
 *       prior degradation in the window (romWarning = null).
 *     Full warning — current session is 'degrading' AND ≥1 prior
 *       session in the window was also 'degrading', OR romTrend
 *       is 'consistent-degradation' (romWarning = string).
 *
 *   ROM diagnostics do NOT feed into the controller.
 *   Persisted: romPattern (display convenience), recentRomSummaries
 *   (bounded memory). NOT persisted: romTrend, romWarning (derived
 *   fresh each call to prevent stale-state bugs).
 *
 * ## RIR trend tracking (DIAGNOSTIC ONLY)
 *   Per-session zeroRirCount counts working sets where RIR = 0.
 *   A bounded window (recentZeroRir, size ≤3) persists the count
 *   per session. When 2+ of the last 3 sessions have ≥1 zero-RIR
 *   set, rirTrend = 'repeated-zero-rir' and a warning is surfaced.
 *
 *   0 RIR is NOT an automatic weight-reduction trigger. It is
 *   diagnostic information to be interpreted alongside ROM quality,
 *   failure patterns, and progression history. The warning copy
 *   acknowledges that repeated 0 RIR is more significant on
 *   technically demanding compounds than on stable isolations.
 *
 *   NOT persisted: rirTrend, rirWarning (derived fresh each call).
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
 *     - romPattern, romValues, zeroRirCount — ROM/RIR diagnostics only
 *   These are deterministic point estimators of latent variables
 *   (rest influence, weight distribution, anchor drift, ROM quality)
 *   without uncertainty modeling — fixed transforms with hard-coded
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

// ROM quality tracking constants (DIAGNOSTIC ONLY)
// Minimum sessions required in the window to fire a cross-session ROM trend warning.
const ROM_TREND_WINDOW     = 3;  // same as regressWindow for symmetry
const ROM_TREND_THRESHOLD  = 2;  // qualifying-degradation sessions needed
const RIR_TREND_WINDOW     = 3;
const RIR_TREND_THRESHOLD  = 2;

// ── F3: DOMS Adaptation Constants ─────────────────────────────────────────────
// During the first 2 exposures to an exercise, large weight drops from anchor
// are treated as expected DOMS variance rather than true regression signals.
const DOMS_MAX_EXPOSURE      = 2;    // sessions in the adaptation window
const DOMS_DROP_THRESHOLD    = 0.30; // fractional drop from anchor to trigger DOMS logic

// ── F4: Adaptive Evidence Constants ───────────────────────────────────────────
// Statistical model for evidence requirement scaling.
// δ = detectable fraction, CV = coefficient of variation.
const EVIDENCE_DELTA         = 0.5;
const CV_DEFAULT             = 0.08;

// ── F5: Unsafe Jump Prevention Constants ──────────────────────────────────────
const SAFETY_FACTOR          = 1.15; // max allowable working weight = recommendedMax × SAFETY_FACTOR

// ── F6: Deconditioning Decay Constants ────────────────────────────────────────
const DECONDITIONING_THRESHOLD_DAYS = 7;    // gap before decay kicks in
const DECAY_LAMBDA                  = 0.01; // exponential decay rate (per day)

// ── ROM / RIR Quality Analysis (DIAGNOSTIC ONLY — not consumed by controller) ──

/**
 * Classify the ROM pattern of a set sequence for a single session.
 *
 * Uses the 'rom' field of each completed working set in temporal order.
 * Missing/null rom values default to 'full' (backward-compatible with
 * sets logged before ROM tracking was added).
 *
 * DEGRADATION REQUIRES DIRECTIONALITY:
 *   The sequence is 'degrading' if and only if:
 *     1. The last rom value is 'partial', AND
 *     2. At least one earlier set was 'full', AND
 *     3. There is no 'full' set AFTER the first 'partial' in the sequence
 *        (i.e. no recovery — partial→full→partial is 'mixed').
 *
 *   A single partial-ROM set surrounded by full-ROM sets ('full','partial','full')
 *   is 'mixed', not 'degrading'. This prevents false positives from isolated
 *   hard sets.
 *
 * @param {Array<{s:string, w:number|null, r:number|null, rom?:string, completedAt?:number}>} workingSets
 *   Completed working-weight sets only, already filtered (s==='done').
 * @returns {{ romPattern: string, romValues: string[] }}
 */
function analyzeRomPattern(workingSets) {
  if (!workingSets || workingSets.length === 0) {
    return { romPattern: 'mixed', romValues: [] };
  }

  // Sort by completedAt for temporal order; preserve insertion order as fallback.
  const sorted = [...workingSets].sort((a, b) => {
    if (a.completedAt != null && b.completedAt != null) return a.completedAt - b.completedAt;
    return 0;
  });

  // Normalise: missing/null rom → 'full' for backward compatibility.
  const romValues = sorted.map(s => (s.rom && s.rom !== '') ? s.rom : 'full');

  // Single set — pattern is the value itself, no sequence to compare.
  if (romValues.length === 1) {
    const p = romValues[0] === 'full' ? 'consistent-full' : 'consistent-partial';
    return { romPattern: p, romValues };
  }

  const allFull    = romValues.every(v => v === 'full');
  const allPartial = romValues.every(v => v === 'partial');

  if (allFull)    return { romPattern: 'consistent-full',    romValues };
  if (allPartial) return { romPattern: 'consistent-partial', romValues };

  // Degradation check: last value partial, at least one full before it,
  // and no 'full' after the first 'partial' (no recovery).
  const lastVal = romValues[romValues.length - 1];
  if (lastVal === 'partial') {
    const firstPartialIdx = romValues.indexOf('partial');
    const hasPriorFull = romValues.slice(0, firstPartialIdx).some(v => v === 'full');
    const hasRecovery  = romValues.slice(firstPartialIdx + 1).some(v => v === 'full');
    if (hasPriorFull && !hasRecovery) {
      return { romPattern: 'degrading', romValues };
    }
  }

  // Improving: last value full, at least one partial before it.
  if (lastVal === 'full') {
    const hasPriorPartial = romValues.slice(0, romValues.length - 1).some(v => v === 'partial');
    if (hasPriorPartial) {
      return { romPattern: 'improving', romValues };
    }
  }

  return { romPattern: 'mixed', romValues };
}

/**
 * Detect a cross-session ROM regression trend from a sliding window of
 * past session ROM patterns.
 *
 * Only 'degrading' and 'consistent-partial' count as evidence.
 * 'mixed' and 'improving' sessions do NOT accumulate — they are noise.
 *
 * @param {string[]} recentRomSummaries  — persisted window of ≤3 past romPattern values
 * @returns {'consistent-degradation'|'sustained-partial'|'stable'}
 */
function analyzeRomTrend(recentRomSummaries) {
  if (!Array.isArray(recentRomSummaries) || recentRomSummaries.length === 0) return 'stable';

  const window = recentRomSummaries.slice(-ROM_TREND_WINDOW);
  const degradingCount = window.filter(p => p === 'degrading').length;
  const partialCount   = window.filter(p => p === 'consistent-partial').length;

  if (degradingCount >= ROM_TREND_THRESHOLD) return 'consistent-degradation';
  if (partialCount   >= ROM_TREND_THRESHOLD) return 'sustained-partial';
  return 'stable';
}

/**
 * Detect a cross-session repeated-zero-RIR trend.
 *
 * Counts the number of working sets with RIR = 0 in the current session,
 * then checks whether the persisted window shows repeated occurrence.
 *
 * RIR is diagnostic only — repeated 0 RIR is more significant on
 * technically demanding compounds than on stable isolations. The warning
 * copy surfaces this context without hardcoding exercise categories.
 *
 * @param {number[]} recentZeroRir  — persisted window of ≤3 past zeroRirCount values
 * @returns {'repeated-zero-rir'|'normal'}
 */
function analyzeRirTrend(recentZeroRir) {
  if (!Array.isArray(recentZeroRir) || recentZeroRir.length === 0) return 'normal';

  const window = recentZeroRir.slice(-RIR_TREND_WINDOW);
  const zeroCount = window.filter(c => c > 0).length;  // sessions with ≥1 zero-RIR set
  return zeroCount >= RIR_TREND_THRESHOLD ? 'repeated-zero-rir' : 'normal';
}

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

// ── F4: Adaptive Evidence Requirement ─────────────────────────────────────────

/**
 * Compute the number of qualifying sessions required to approve a weight jump.
 *
 * Replaces the jump-only model with multi-factor confidence scoring.
 *
 * @param {object} params
 * @param {number} params.jumpSize — proposed step size (lbs)
 * @param {number} params.currentWeight — current working weight (lbs)
 * @param {number} params.successfulExposureCount — streak of qualifying sessions at this weight
 * @param {number|null} params.averageRIR — average reps in reserve from working sets
 * @param {string} params.exerciseType — 'compound' or 'isolation'
 * @param {string} params.equipmentType — 'machine', 'dumbbell', etc.
 * @returns {{ requiredEvidence: number }}
 */
function computeAdaptiveEvidence({ jumpSize, currentWeight, successfulExposureCount, averageRIR, exerciseType, equipmentType }) {
  // 1. Base Evidence Requirement
  let baseEvidence = 2;
  if (equipmentType === 'machine') {
    baseEvidence = 2;
  } else if (equipmentType === 'dumbbell' && exerciseType === 'compound') {
    baseEvidence = 3;
  } else if (exerciseType === 'isolation') {
    baseEvidence = 2;
  } else {
    // Default fallback
    baseEvidence = 2;
  }

  // 2. Jump Size Adjustment
  let jumpAdjustment = 0;
  if (currentWeight > 0) {
    const jumpRatio = jumpSize / currentWeight;
    if (jumpRatio >= 0.15) {
      jumpAdjustment = 2;
    } else if (jumpRatio >= 0.10) {
      jumpAdjustment = 1;
    }
  }

  // 3. Successful Exposure Scaling
  let exposureAdjustment = 0;
  let forceMinimum = false;
  if (successfulExposureCount === 2) {
    exposureAdjustment = 1;
  } else if (successfulExposureCount >= 3) {
    forceMinimum = true;
  }

  // 4. RIR Confidence Adjustment
  let rirAdjustment = 0;
  if (averageRIR !== null && averageRIR !== undefined) {
    if (averageRIR >= 2) {
      rirAdjustment = -1;
    } else if (averageRIR < 1) {
      rirAdjustment = 1;
    }
  }

  // Final Requirement
  const minimumEvidence = 1;
  const maximumEvidence = 3;

  if (forceMinimum) {
    return { requiredEvidence: minimumEvidence };
  }

  const calculated = baseEvidence + jumpAdjustment - exposureAdjustment + rirAdjustment;
  const requiredEvidence = Math.max(minimumEvidence, Math.min(maximumEvidence, calculated));

  return { requiredEvidence };
}

// ── F5: Unsafe Jump Prevention ────────────────────────────────────────────────

/**
 * Validate that a proposed weight increase is safe given recent performance.
 *
 * Estimates 1RM from recent working sets using Epley, then computes the
 * maximum allowable working weight at the target rep ceiling. Any proposed
 * weight exceeding this by SAFETY_FACTOR is clamped.
 *
 * @param {number} proposedWeight   — the weight the controller wants to suggest
 * @param {{min:number, max:number}} repRange — prescribed rep range
 * @param {Array<{s:string, w:number|null, r:number|null}>} sets — recent session sets
 * @returns {{ safe: boolean, clampedWeight: number, estimatedE1RM: number|null }}
 */
function validateProposedLoad(proposedWeight, repRange, sets) {
  const done = (sets || []).filter(
    s => s.s === 'done' && s.w !== null && s.r !== null && s.w > 0 && s.r > 0
  );

  if (done.length === 0) {
    // No data to estimate from — allow the jump (fail open on insufficient data)
    return { safe: true, clampedWeight: proposedWeight, estimatedE1RM: null };
  }

  // Compute e1RM from each working set and take the maximum
  let maxE1RM = 0;
  for (const s of done) {
    const e1rm = epleyE1RM(s.w, s.r);
    if (e1rm !== null && e1rm > maxE1RM) maxE1RM = e1rm;
  }

  if (maxE1RM <= 0) {
    return { safe: true, clampedWeight: proposedWeight, estimatedE1RM: null };
  }

  // Epley inverse at rep ceiling: the weight you'd need to do repRange.max reps
  const targetRepMax = repRange.max ?? repRange.min ?? 8;
  const recommendedMaxWorkingWeight = workingTarget(maxE1RM, targetRepMax);
  const absoluteMax = recommendedMaxWorkingWeight * SAFETY_FACTOR;

  if (proposedWeight > absoluteMax) {
    return {
      safe: false,
      clampedWeight: Math.round(absoluteMax * 2) / 2, // round to nearest 0.5
      estimatedE1RM: maxE1RM,
    };
  }

  return { safe: true, clampedWeight: proposedWeight, estimatedE1RM: maxE1RM };
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
 * @param {Array<{s:string, w:number|null, r:number|null, rom?:string, rir?:number|null}>} sets
 * @param {{min:number, max:number}} repRange — prescribed rep range
 * @param {number|null} currentWeight — the working weight for classification context
 * @param {{prescribedRestSec:number, dw:number}} restData — rest and step config
 * @returns {{
 *   classification:      'qualifying'|'adequate'|'failing'|null,
 *   workingWeight:       number|null,
 *   topWeight:           number|null,
 *   modeDominanceRatio:  number,
 *   weightAgreement:     number|null,
 *   sessionType:         'straight'|'ramp'|'topset_backoff'|'mixed',
 *   classifierConfidence: number,
 *   romPattern:          'consistent-full'|'consistent-partial'|'degrading'|'improving'|'mixed',
 *   romValues:           string[],
 *   zeroRirCount:        number,
 * }}
 */
export function classifySession(sets, repRange, currentWeight = null, restData = {}) {
  const done = (sets || []).filter(
    s => s.s === 'done' && s.w !== null && s.r !== null && !s.deload
  );

  if (!done.length) {
    return {
      classification: null,
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
  
  // Only use prescribedWeight as anchor if it actually appears in the logged sets
  let validPrescribedWeight = null;
  if (restData.prescribedWeight != null) {
    const hasPrescribed = done.some(s => s.w === restData.prescribedWeight);
    if (hasPrescribed) {
      validPrescribedWeight = restData.prescribedWeight;
    }
  }
  
  const anchorWeight = currentWeight ?? validPrescribedWeight ?? null;

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
      const tolerance = restData.dw;
      if (tolerance !== undefined && tolerance !== null && tolerance > 0) {
        weightAgreement = +Math.max(0, 1 - drift / (tolerance * 3)).toFixed(4);
      } else {
        weightAgreement = 0.0;
      }
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

  // ── ROM pattern analysis ──────────────────────────────────────────────
  // Uses completed working sets only (already filtered above).
  // Backward-compatible: missing rom field defaults to 'full' inside analyzeRomPattern.
  const { romPattern, romValues } = analyzeRomPattern(workingSets);

  // ── RIR zero-count and averageRIR ─────────────────────────────────────
  // Count working sets where RIR was explicitly logged as 0.
  // Calculate average RIR across all working sets that have an RIR logged.
  const rirSets = workingSets.filter(s => s.rir !== null && s.rir !== undefined);
  const zeroRirCount = rirSets.filter(s => s.rir === 0).length;
  const averageRIR = rirSets.length > 0
    ? rirSets.reduce((sum, s) => sum + s.rir, 0) / rirSets.length
    : null;

  const isDeload = (sets || []).some(s => s.deload === true);

  return {
    classification, workingWeight, topWeight,
    modeDominanceRatio, weightAgreement,
    sessionType, classifierConfidence,
    romPattern, romValues, zeroRirCount, averageRIR,
    isDeload,
  };
}


/**
 * Process one completed session for an exercise and return the next
 * progression state and recommendation.
 *
 * @param {object} prev   Previous progression state:
 *   { currentWeight, consecutiveQualifying, recentOutcomes, dw,
 *     recentRomSummaries, recentZeroRir }  — ROM/RIR windows carried from last session
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
 *   sessionType:           'straight'|'ramp'|'topset_backoff'|'mixed',
 *   classifierConfidence:  number,
 *   romPattern:            string,
 *   romValues:             string[],
 *   zeroRirCount:          number,
 *   recentRomSummaries:    string[],
 *   recentZeroRir:         number[],
 *   romTrend:              'consistent-degradation'|'sustained-partial'|'stable',
 *   rirTrend:              'repeated-zero-rir'|'normal',
 *   romWarning:            string|null,
 *   rirWarning:            string|null,
 *   deloadStreak:          number,
 * }}
 */
/**
 * Resolves the progression increment step size (deltaW) for a given weight configuration.
 * Respects recorded values and returns undefined if unspecified (no guessing).
 *
 * @private
 * @param {number|object[]} deltaWConfig
 * @param {number|null} currentWeight
 * @returns {number|undefined}
 */
function _getDeltaW(deltaWConfig, currentWeight) {
  if (deltaWConfig === undefined || deltaWConfig === null) return undefined;
  if (typeof deltaWConfig === 'number') return deltaWConfig;
  if (Array.isArray(deltaWConfig)) {
    const weight = currentWeight ?? 0;
    for (const rule of deltaWConfig) {
      if (rule.until === undefined || rule.until === null) {
        return rule.step;
      }
      if (weight < rule.until) {
        return rule.step;
      }
    }
    if (deltaWConfig.length > 0) {
      return deltaWConfig[deltaWConfig.length - 1].step;
    }
  }
  return undefined;
}

export function updateProgressionState(prev = {}, sets = [], opts = {}) {
  const dwConfig = opts.deltaW ?? prev.dw;
  const prevWeight = prev.currentWeight ?? null;
  const prevPerformedWeight = prev.lastPerformedWeight ?? null;
  const initialWeight = prevWeight ?? opts.prescribedWeight ?? 0;
  const dw = dwConfig !== undefined && dwConfig !== null ? _getDeltaW(dwConfig, initialWeight) : undefined;

  const maxW = opts.maxW ?? null;
  const repRange = opts.repRange ?? { min: 8, max: 12 };
  const prevConsecutive = prev.consecutiveQualifying ?? 0;
  const prevSuccessfulExposure = prev.successfulExposureCount ?? 0;
  const prevOutcomes = Array.isArray(prev.recentOutcomes) ? [...prev.recentOutcomes] : [];

  // Pull ROM/RIR rolling windows from persisted prev state.
  const prevRomSummaries = Array.isArray(prev.recentRomSummaries) ? [...prev.recentRomSummaries] : [];
  const prevZeroRir      = Array.isArray(prev.recentZeroRir)      ? [...prev.recentZeroRir]      : [];

  // ── F3: DOMS adaptation state ───────────────────────────────────────────
  const prevExposureCount = prev.exposureCount ?? 0;
  const exposureCount = prevExposureCount + 1;

  // ── F6: Deconditioning decay ────────────────────────────────────────────
  // Compute gap since last session. If > 7 days, decay latent capability.
  const prevTimestamp = prev.lastSessionTimestamp ?? null;
  const nowTimestamp = opts.sessionTimestamp ?? Date.now();
  let latentCapability = null;
  let deconditioningApplied = false;
  let deconditioningDays = 0;

  if (prevWeight != null && prevTimestamp != null) {
    const gapMs = nowTimestamp - prevTimestamp;
    const gapDays = gapMs / (1000 * 60 * 60 * 24);
    if (gapDays > DECONDITIONING_THRESHOLD_DAYS) {
      // Exponential decay: latentCapability = currentWeight × e^(-λ·Δt)
      // Does NOT mutate historical currentWeight — only affects suggestion.
      latentCapability = prevWeight * Math.exp(-DECAY_LAMBDA * gapDays);
      deconditioningApplied = true;
      deconditioningDays = gapDays;
    }
  }

  // ── F7: Evidence invalidation on weight change ──────────────────────────
  const prevValidatedWeight = prev.validatedWorkingWeight ?? prevWeight;
  let effectiveConsecutive = prevConsecutive;
  let effectiveSuccessfulExposure = prevSuccessfulExposure;
  let evidenceInvalidated = false;
  let effectiveOutcomes = prevOutcomes; // Option C: Weight-scoped history

  if (prevWeight != null && prevValidatedWeight != null && prevWeight !== prevValidatedWeight) {
    // Weight changed since evidence was last validated — reset streak
    effectiveConsecutive = 0;
    effectiveSuccessfulExposure = 0;
    effectiveOutcomes = []; // Option C: Clear outcomes on weight change
    evidenceInvalidated = true;
  }

  // F6: deconditioning also invalidates evidence
  if (deconditioningApplied) {
    effectiveConsecutive = 0;
    effectiveSuccessfulExposure = 0;
    effectiveOutcomes = []; // Option C: Clear outcomes on deconditioning
  }

  // ── Input validation (fail closed) ──────────────────────────────────────
  // Invalid inputs → return previous state unchanged with decision 'hold'.
  // This prevents the controller from producing garbage-shaped certainty
  // on malformed configuration.
  if (repRange.min != null && repRange.max != null && repRange.min > repRange.max) {
    return _failClosed(prevWeight, effectiveConsecutive, prevOutcomes, dw, maxW, prevRomSummaries, prevZeroRir, prev.deloadStreak, prevPerformedWeight, effectiveSuccessfulExposure, prev.averageRIR);
  }
  if (dw === undefined || dw === null || isNaN(dw) || dw <= 0) {
    return _failClosed(prevWeight, effectiveConsecutive, prevOutcomes, dw, maxW, prevRomSummaries, prevZeroRir, prev.deloadStreak, prevPerformedWeight, effectiveSuccessfulExposure, prev.averageRIR);
  }
  if (opts.prescribedRestSec != null && opts.prescribedRestSec < 0) {
    return _failClosed(prevWeight, effectiveConsecutive, prevOutcomes, dw, maxW, prevRomSummaries, prevZeroRir, prev.deloadStreak, prevPerformedWeight, effectiveSuccessfulExposure, prev.averageRIR);
  }

  const completedSets = (sets || []).filter(s => s.s === 'done');
  let currentDeloadStreak = prev.deloadStreak || 0;
  if (completedSets.length > 0) {
    if (completedSets.every(s => s.deload)) {
      currentDeloadStreak++;
    } else {
      currentDeloadStreak = 0;
    }
  }

  // Classify this session
  const {
    classification,
    workingWeight: sessionWorkingWeight,
    topWeight,
    modeDominanceRatio,
    weightAgreement,
    sessionType,
    classifierConfidence,
    romPattern,
    romValues,
    zeroRirCount,
    averageRIR,
    isDeload,
  } = classifySession(sets, repRange, prevWeight, {
    prescribedRestSec: opts.prescribedRestSec ?? 0,
    prescribedWeight: opts.prescribedWeight ?? null,
    dw,
  });

  // No completed working sets — return state unchanged with no suggestion
  if (classification === null) {
    return {
      currentWeight: prevWeight,
      consecutiveQualifying: effectiveConsecutive,
      recentOutcomes: prevOutcomes,
      dw,
      suggestedWeight: prevWeight,
      decision: 'hold',
      isFirstSession: prevWeight === null,
      sessionClassification: null,
      topWeight: topWeight ?? null,
      controllerDistance: computeControllerDistance({ consecutiveQualifying: effectiveConsecutive, recentOutcomes: prevOutcomes }),
      modeDominanceRatio,
      weightAgreement,
      sessionType: sessionType ?? 'mixed',
      classifierConfidence: classifierConfidence ?? 0,
      // ROM/RIR: carry windows unchanged; no sets = no new data
      romPattern: 'mixed', romValues: [], zeroRirCount: 0,
      recentRomSummaries: prevRomSummaries, recentZeroRir: prevZeroRir,
      romTrend: analyzeRomTrend(prevRomSummaries),
      rirTrend: analyzeRirTrend(prevZeroRir),
      romWarning: null, rirWarning: null,
      deloadStreak: currentDeloadStreak,
      // F3/F6/F7 state — carry forward unchanged
      exposureCount,
      domsAdjustmentWindow: false,
      validatedWorkingWeight: evidenceInvalidated ? prevWeight : prevValidatedWeight,
      lastPerformedWeight: prevPerformedWeight,
      plannedJump: prev.plannedJump ?? null,
      requiredEvidence: prev.requiredEvidence ?? DEFAULTS.qualifyThreshold,
      successfulExposureCount: effectiveSuccessfulExposure,
      averageRIR: prev.averageRIR ?? null,
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
    const hasPerformedPrescribed = (sets || []).some(s => s.s === 'done' && s.w === opts.prescribedWeight);
    const safePrescribed = hasPerformedPrescribed ? opts.prescribedWeight : null;

    if (classifierConfidence >= BOOTSTRAP_CONFIDENCE_THRESHOLD) {
      // Classifier is confident: adopt inferred working weight.
      currentWeight = sessionWorkingWeight ?? safePrescribed ?? null;
    } else {
      // Classifier is uncertain (ramp, mixed pattern): anchor to prescribed
      // seed so the controller doesn't commit an ambiguous top-set as baseline.
      // Only use prescribed weight if it was actually performed.
      currentWeight = safePrescribed ?? sessionWorkingWeight ?? null;
    }
  } else {
    currentWeight = prevWeight;
  }

  // ── F4: Adaptive evidence requirement ───────────────────────────────────
  // Evaluate the evidence requirement dynamically based on the current weight
  // and proposed step size.
  let requiredEvidence = DEFAULTS.qualifyThreshold;
  let plannedJump = null;
  let recommendIntermediate = false;

  let successfulExposureCount = effectiveSuccessfulExposure;
  if (!isBootstrap && classification != null) {
    if (classification === 'qualifying' && sessionWorkingWeight === currentWeight && !isDeload) {
      successfulExposureCount += 1;
    } else if (classification === 'failing' || isDeload) {
      successfulExposureCount = 0;
    }
  }

  if (currentWeight != null && currentWeight > 0) {
    const nextDw = _getDeltaW(dwConfig, currentWeight);
    const proposedJump = nextDw ?? dw;
    if (proposedJump > 0) {
      const evidenceResult = computeAdaptiveEvidence({
        jumpSize: proposedJump,
        currentWeight,
        successfulExposureCount,
        averageRIR,
        exerciseType: opts.exerciseType,
        equipmentType: opts.equipmentType,
      });
      requiredEvidence = evidenceResult.requiredEvidence;
      plannedJump = proposedJump;
    }
  }

  // ── Weight alignment & reality tracking ──────────────────────────────
  // We track the target weight (currentWeight) and the actual performed weight
  // (sessionWorkingWeight). 
  let weightChanged = false;
  let consecutiveQualifying;
  
  if (!isBootstrap && sessionWorkingWeight != null && sessionWorkingWeight !== currentWeight) {
    if (sessionWorkingWeight > currentWeight) {
      // User performed a higher weight than recommended.
      if (sessionWorkingWeight === prevPerformedWeight) {
        // Continuing attempt at higher weight: update streak based on classification.
        if (classification === 'qualifying') {
          consecutiveQualifying = effectiveConsecutive + 1;
        } else if (classification === 'failing') {
          consecutiveQualifying = 0;
        } else {
          consecutiveQualifying = effectiveConsecutive;
        }
        
        // If they have confirmed this weight across requiredEvidence qualifying sessions,
        // promote it to the official baseline.
        if (consecutiveQualifying >= requiredEvidence) {
          currentWeight = sessionWorkingWeight;
          weightChanged = true;
        }
      } else {
        // First attempt at this specific higher weight: require confirmation next session.
        consecutiveQualifying = classification === 'qualifying' ? 1 : 0;
        evidenceInvalidated = true;
      }
    } else {
      // User performed a lower weight than recommended: hold target weight but reset streak.
      consecutiveQualifying = 0;
      evidenceInvalidated = true;
    }
  } else if (!isBootstrap && sessionWorkingWeight != null && sessionWorkingWeight === currentWeight) {
    // User performed target weight: normal streak logic.
    if (classification === 'qualifying') {
      consecutiveQualifying = effectiveConsecutive + 1;
    } else if (classification === 'failing') {
      consecutiveQualifying = 0;
    } else {
      consecutiveQualifying = effectiveConsecutive;
    }
  } else {
    consecutiveQualifying = effectiveConsecutive;
  }

  // ── F3: DOMS adaptation — suppress regression during early exposures ────
  let domsAdjustmentWindow = false;
  if (exposureCount <= DOMS_MAX_EXPOSURE && prevWeight != null && sessionWorkingWeight != null) {
    const dropFraction = (prevWeight - sessionWorkingWeight) / prevWeight;
    if (dropFraction > DOMS_DROP_THRESHOLD) {
      domsAdjustmentWindow = true;
      // During DOMS window: treat the drop as expected variance.
      // Suppress regression by not counting this as a failing session for
      // the purposes of the regress threshold. The classification itself
      // is unchanged (still 'failing' in the record for transparency).
    }
  }

  // Update recent outcomes (capped to regressWindow)
  let recentOutcomes = [...effectiveOutcomes, classification]
    .slice(-DEFAULTS.regressWindow);

  // Count failing sessions in the recent window
  const failingCount = recentOutcomes.filter(o => o === 'failing').length;

  // F3: DOMS adjustment — don't count this session toward regression
  const effectiveFailingCount = domsAdjustmentWindow
    ? Math.max(0, failingCount - 1)  // discount the DOMS-affected session
    : failingCount;

  // ── Controller distance (pre-decision) ─────────────────────────────────
  // Computed BEFORE the decision/reset below so it reflects the distance
  // that triggered the action, not the post-action state.
  const controllerDistance = computeControllerDistance({
    consecutiveQualifying,
    recentOutcomes,
    // F4: use adaptive threshold for distance computation
    qualifyThreshold: requiredEvidence,
    failingCountOverride: effectiveFailingCount,
  });

  // ── Controller output ──────────────────────────────────────────────────
  // Precedence: progression is checked before regression.
  // Rationale: the qualifying streak requires consecutive evidence (stronger,
  // more temporally local signal). If both thresholds are satisfied
  // simultaneously, recent qualifying performance supersedes older failures
  // in the window. See file header § Decision rules for full rationale.
  let decision;
  let suggestedWeight;

  // Progression: evidence accumulation (consecutive streak, low-frequency)
  // Checked FIRST — takes precedence over regression. See § Decision rules.
  // F4: use adaptive requiredEvidence instead of fixed qualifyThreshold
  if (consecutiveQualifying >= requiredEvidence) {
    decision = 'progress';
    const progressDw = _getDeltaW(dwConfig, currentWeight);
    if (progressDw === undefined || progressDw === null || isNaN(progressDw) || progressDw <= 0) {
      decision = 'hold';
      suggestedWeight = currentWeight;
    } else {
      suggestedWeight = currentWeight + progressDw;

      // F5: Unsafe jump prevention — clamp if exceeding safety threshold
      const validation = validateProposedLoad(suggestedWeight, repRange, sets);
      if (!validation.safe) {
        suggestedWeight = validation.clampedWeight;
      }

      consecutiveQualifying = 0;  // Reset after progression
      recentOutcomes = [];        // Option C: Weight-scoped history
    }
  // Regression: risk detection (window density, high-frequency)
  // Additional precondition: the most recent session must be failing.
  // A qualifying or adequate session should never trigger regression —
  // the user just proved they can handle the weight. Stale failing
  // sessions in the window should not override the most recent evidence.
  // This prevents the "double regression on recovery" bug where a user
  // recovers from illness (Q after F,F) and gets regressed anyway.
  //
  // F3: DOMS adjustment — use effectiveFailingCount which discounts
  // the DOMS-affected session during the adaptation window.
  } else if (
    effectiveFailingCount >= DEFAULTS.regressThreshold &&
    classification === 'failing' &&
    !domsAdjustmentWindow  // F3: never regress during DOMS window
  ) {
    decision = 'regress';
    // For regression, resolve dw at currentWeight - 0.1 to handle boundary step size transitions
    const regressDw = _getDeltaW(dwConfig, currentWeight - 0.1);
    if (regressDw === undefined || regressDw === null || isNaN(regressDw) || regressDw <= 0) {
      decision = 'hold';
      suggestedWeight = currentWeight;
    } else {
      suggestedWeight = Math.max(0, currentWeight - regressDw);
      consecutiveQualifying = 0;  // Reset after regression
      recentOutcomes = [];        // Option C: Weight-scoped history
    }
  } else {
    // Hold: keep working at current weight, or candidate weight if confirming
    decision = 'hold';
    if (sessionWorkingWeight != null && sessionWorkingWeight > currentWeight && classification !== 'failing') {
      suggestedWeight = sessionWorkingWeight;
    } else {
      suggestedWeight = currentWeight;
    }
  }

  // F6: Deconditioning — if a long gap was detected, derive suggestedWeight
  // from the decayed latent capability instead of the historical record.
  // The historical currentWeight is NOT mutated.
  if (deconditioningApplied && latentCapability != null && decision === 'hold') {
    suggestedWeight = latentCapability;
    // Evidence from pre-break is already invalidated above (effectiveConsecutive = 0)
  }

  // Discretize suggested weight to nearest dw step
  const finalDw = _getDeltaW(dwConfig, suggestedWeight) ?? dw;
  if (finalDw !== undefined && finalDw !== null && !isNaN(finalDw) && finalDw > 0) {
    const step = Math.max(finalDw, 0.5);
    suggestedWeight = Math.max(0, step * Math.round(suggestedWeight / step));
  }

  let committedWeight = decision === 'progress' ? suggestedWeight
                      : decision === 'regress'  ? suggestedWeight
                      : currentWeight;

  // ── GLOBAL INVARIANT: PRESERVE HISTORICAL PERFORMANCE ──────────
  // A user should never be assigned a starting weight below a previously 
  // completed successful working weight. This prevents stale defaults from
  // trapping the user at a lower weight due to confirmation logic.
  const minRequired = repRange?.min ?? 1;
  let highestValidWorkingWeight = null;
  for (const s of (sets || [])) {
    if (s.s === 'done' && s.w != null && s.r != null && s.r >= minRequired) {
      if (highestValidWorkingWeight === null || s.w > highestValidWorkingWeight) {
        highestValidWorkingWeight = s.w;
      }
    }
  }

  if (highestValidWorkingWeight !== null) {
    if (committedWeight !== null && committedWeight < highestValidWorkingWeight) {
      console.warn(
        "Invariant violation: committedWeight below historical performance. Forcing up.",
        { committedWeight, highestValidWorkingWeight }
      );
      committedWeight = highestValidWorkingWeight;
      if (suggestedWeight !== null && suggestedWeight < highestValidWorkingWeight) {
        suggestedWeight = highestValidWorkingWeight;
      }
      decision = 'progress';
      consecutiveQualifying = 0;
      recentOutcomes = [];
    } else if (committedWeight == null) {
      committedWeight = highestValidWorkingWeight;
      if (suggestedWeight == null || suggestedWeight < highestValidWorkingWeight) {
        suggestedWeight = highestValidWorkingWeight;
      }
    }
  }

  // ── maxW clamp (SINGLE location) ──────────────────────────────────
  // Equipment ceiling supersedes the deltaW grid.
  // Applied once, after all computation is final.
  if (maxW != null && committedWeight > maxW) {
    committedWeight = maxW;
  }
  if (maxW != null && suggestedWeight > maxW) {
    suggestedWeight = maxW;
  }

  // F7: Update validatedWorkingWeight on progression/regression decisions
  const validatedWorkingWeight = (decision === 'progress' || decision === 'regress' || weightChanged)
    ? committedWeight
    : (evidenceInvalidated ? committedWeight : prevValidatedWeight);

  // isFirstSession is a UI-layer concern, not a controller state.
  // The controller always returns its true decision (progress/hold/regress).
  const isFirstSession = prevWeight === null;

  // ── ROM / RIR quality diagnostics ─────────────────────────────────────
  // Update the bounded-memory windows with this session's data, then
  // derive trend and warning strings. Only 'degrading' and
  // 'consistent-partial' accumulate in the ROM window — 'mixed' is noise.
  //
  // Neither romTrend, rirTrend, nor the warning strings are persisted.
  // They are computed fresh from the windows on every call to prevent
  // stale-state bugs where persisted diagnostics disagree with history.

  const recentRomSummaries = [...prevRomSummaries, romPattern].slice(-ROM_TREND_WINDOW);
  const recentZeroRir      = [...prevZeroRir, zeroRirCount].slice(-RIR_TREND_WINDOW);

  const romTrend = analyzeRomTrend(recentRomSummaries);
  const rirTrend = analyzeRirTrend(recentZeroRir);

  // ROM warning fires when cross-session trend is consistent-degradation OR
  // current session is degrading and the previous window already had at least
  // one degrading session. A single degrading session with no prior history
  // produces romWarning = null (informational chip only, not a full warning).
  let romWarning = null;
  if (romTrend === 'consistent-degradation') {
    romWarning = 'ROM is consistently decreasing across sets or sessions. Review your technique, maintain controlled ROM throughout each set, and consider reducing load if the weight is causing repeated ROM loss.';
  } else if (romPattern === 'degrading' && prevRomSummaries.some(p => p === 'degrading')) {
    romWarning = 'ROM is consistently decreasing across sets or sessions. Review your technique, maintain controlled ROM throughout each set, and consider reducing load if the weight is causing repeated ROM loss.';
  }

  const rirWarning = rirTrend === 'repeated-zero-rir'
    ? 'Repeatedly reaching 0 RIR may indicate the current weight is near your limit for this rep range, insufficient recovery, or that this exercise has a higher difficulty profile. Interpret alongside ROM quality, failure patterns, and progression history.'
    : null;

  return {
    currentWeight: committedWeight,
    consecutiveQualifying,
    recentOutcomes,
    dw: _getDeltaW(dwConfig, committedWeight),
    suggestedWeight,
    decision,
    isFirstSession,
    isAtMax: maxW != null && committedWeight >= maxW,
    sessionClassification: classification,
    topWeight: topWeight ?? null,
    controllerDistance,
    modeDominanceRatio,
    weightAgreement,
    sessionType,
    classifierConfidence,
    // ROM/RIR diagnostics (not consumed by controller)
    romPattern, romValues, zeroRirCount,
    recentRomSummaries, recentZeroRir,
    romTrend, rirTrend, romWarning, rirWarning,
    // F3: DOMS adaptation state
    exposureCount,
    domsAdjustmentWindow,
    // F4: Adaptive evidence
    requiredEvidence,
    plannedJump,
    recommendIntermediate,
    // F6: Deconditioning
    deconditioningApplied,
    // F7: Evidence invalidation
    validatedWorkingWeight,
    lastPerformedWeight: sessionWorkingWeight,
    deloadStreak: currentDeloadStreak,
    successfulExposureCount,
    averageRIR,
  };
}

/**
 * Re-evaluate progression state from a full history of sessions.
 * 
 * @param {Array<{ timestamp: number, sets: object[] }>} historyEntries - chronologically ordered sessions
 * @param {object} currentOpts - the current exercise progression options
 * @returns {object} the progression state evaluated from scratch using current options
 */
export function calculateProgressionFromHistory(historyEntries, currentOpts = {}) {
  let state = {};
  for (const entry of historyEntries) {
    state = updateProgressionState(state, entry.sets, {
      ...currentOpts,
      sessionTimestamp: entry.timestamp
    });
  }
  return state;
}

/**
 * Return a fail-closed result: previous state unchanged, decision 'hold'.
 * Used when input validation fails.
 * @private
 */
function _failClosed(prevWeight, prevConsecutive, prevOutcomes, dw, maxW = null, prevRomSummaries = [], prevZeroRir = [], prevDeloadStreak = 0, prevLastPerformedWeight = null, prevSuccessfulExposure = 0, prevAverageRIR = null) {
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
    controllerDistance: computeControllerDistance({ consecutiveQualifying: prevConsecutive, recentOutcomes: prevOutcomes }),
    modeDominanceRatio: 0,
    weightAgreement: null,
    sessionType: 'mixed',
    classifierConfidence: 0,
    // ROM/RIR: carry windows unchanged
    romPattern: 'mixed', romValues: [], zeroRirCount: 0,
    recentRomSummaries: prevRomSummaries, recentZeroRir: prevZeroRir,
    romTrend: analyzeRomTrend(prevRomSummaries),
    rirTrend: analyzeRirTrend(prevZeroRir),
    romWarning: null, rirWarning: null,
    deloadStreak: prevDeloadStreak,
    lastPerformedWeight: prevLastPerformedWeight,
    successfulExposureCount: prevSuccessfulExposure,
    averageRIR: prevAverageRIR,
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

  // F4: use adaptive threshold when provided, fall back to default
  const qualifyThreshold = state.qualifyThreshold ?? DEFAULTS.qualifyThreshold;

  // Distance to progression: how many more consecutive qualifying sessions needed
  const qualifyingNeeded = Math.max(0, qualifyThreshold - consecutiveQualifying);

  // Distance to regression: how many more failing sessions the window can absorb
  const failingInWindow = state.failingCountOverride ?? recentOutcomes.filter(o => o === 'failing').length;
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
};
