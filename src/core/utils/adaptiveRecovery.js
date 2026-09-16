/**
 * ══════════════════════════════════════════════════════
 *  Adaptive Recovery Controller — Design v3
 *  src/core/utils/adaptiveRecovery.js
 * ══════════════════════════════════════════════════════
 *
 * Six-component adaptive recovery controller.
 *
 * ## Components
 *   1. Fatigue Estimator          — reference-capped exponential decay
 *   2. Performance Correction     — dual-signal (immediate + cumulative)
 *   3. Session-Scoped Floor       — prevents premature reversal
 *   4. Evidence Classifier        — per-transition evidence strength
 *   5. Rest Bias Learner          — persistent exercise-specific correction
 *   6. Confidence System          — weighted observation accumulation
 *
 * ## State Schema
 *   Persistent (in progressionState[exId].recovery):
 *     { restBias, errorEMA, observationCount }
 *
 *   Session-scoped runtime (in activeRecoveryState[exId]):
 *     { fatigueDebt, firstSetReps, previousRecommendation, sessionRestFloor }
 *
 * ## Design Principles (§2)
 *   - restInflationFactor remains completely independent
 *   - Historical evidence is stronger than raw timestamps
 *   - Within-session and across-session timescales are separated
 *   - Every additive term is independently bounded
 */

import { REST_DURATION, MAX_REST_DURATION } from '../state/state.js';

// ── §20 Constants ─────────────────────────────────────────────────────────────

const ALPHA              = 0.025;  // fatigue-dose scaling
const CONFIDENCE_K       = 10;     // confidence saturation
const GAMMA_UP           = 0.35;   // upward evidence learning rate
const GAMMA_DOWN         = 0.15;   // downward evidence learning rate
const MAX_BIAS_STEP_UP   = 20;     // per-session upward bias cap (sec)
const MAX_BIAS_STEP_DOWN = 8;      // per-session downward bias cap (sec)
const DECAY_TOWARD_NEUTRAL = 0.08; // weak-evidence neutral decay rate
const BIAS_MIN           = -45;    // minimum persistent bias (sec)
const BIAS_MAX           = +90;    // maximum persistent bias (sec)
const W_IMMEDIATE        = 0.3;    // immediate decline weight
const W_CUMULATIVE       = 0.7;    // cumulative decline weight
const MAX_PERF_CORRECTION = 35;    // maximum single-set correction (sec)
const TOLERANCE          = 10;     // rest matching tolerance (sec)
const MAX_INCREASE_PER_SET = 45;   // output increase clamp (sec)
const MAX_DECREASE_PER_SET = 15;   // output decrease clamp (sec)
const PERF_K             = 120;    // performance correction scale factor (sec)

const TARGET_CAPACITY    = 0.90;   // desired recovery fraction

// Evidence strength weights
const STRENGTH_WEIGHT = {
  strong:   1.0,
  moderate: 0.5,
  weak:     0.15,
  none:     0,
};

// Category time constants (τ in seconds — fatigue decay rate)
const TAU_PRIORS = {
  compoundLower: 120,
  compoundUpper: 90,
  isolation:     60,
  unknown:       90,
};

// Legacy rest reference per category (for fatigue decay cap and confidence blend)
const LEGACY_REST = {
  compoundLower: 120,
  compoundUpper: 90,
  isolation:     60,
  unknown:       90,
};

// ── Category Resolution ───────────────────────────────────────────────────────

/**
 * Map exerciseType string to a TAU_PRIORS key.
 * The exercise library uses 'isolation' and 'compound' (no lower/upper split).
 * Compound maps to 'compoundUpper' as a conservative default.
 *
 * @param {string|undefined} exerciseType
 * @returns {'compoundLower'|'compoundUpper'|'isolation'|'unknown'}
 */
export function resolveCategory(exerciseType) {
  if (exerciseType === 'isolation') return 'isolation';
  if (exerciseType === 'compound')  return 'compoundUpper';
  return 'unknown';
}

/**
 * Return the reference rest interval for a category (seconds).
 * Used for fatigue decay capping and legacy-blend in recommendations.
 *
 * @param {string} category
 * @returns {number}
 */
export function getLegacyRest(category) {
  return LEGACY_REST[category] ?? LEGACY_REST.unknown;
}

// ── RIR Effort Multiplier ─────────────────────────────────────────────────────

const K_EFFORT     = 0.15;
const RIR_REFERENCE = 2;

/**
 * Effort multiplier based on RIR.
 * Returns a value in [1.0, 1.5]: higher near failure.
 *
 * @param {number|null} rir
 * @returns {number}
 */
export function computeEffortMultiplier(rir) {
  if (rir == null || typeof rir !== 'number') return 1.0;
  const mult = 1 + K_EFFORT * Math.max(0, RIR_REFERENCE - rir);
  return Math.max(1.0, Math.min(1.5, mult));
}

/**
 * RIR-gating: normalized signal in [0, 1].
 * 0 = high RIR (little recovery signal), 1 = near failure (strong recovery signal).
 *
 * §7: failureProximity = (computeEffortMultiplier(rir) - 1.0) / 0.5
 *
 * @param {number|null} rir
 * @returns {number}
 */
function failureProximity(rir) {
  return (computeEffortMultiplier(rir) - 1.0) / 0.5;
}

// ── Component 1: Fatigue Estimator ───────────────────────────────────────────

/**
 * Compute relative intensity from weight and estimated 1RM.
 *
 * @param {number} weight
 * @param {number|null} estimated1RM
 * @param {string} category
 * @returns {number}  ∈ (0, 1]
 */
function computeRelativeIntensity(weight, estimated1RM, category) {
  const CATEGORY_PRIORS = {
    compoundLower: 0.75,
    compoundUpper: 0.70,
    isolation:     0.60,
    unknown:       0.70,
  };
  if (weight > 0 && estimated1RM && estimated1RM > 0) {
    return Math.min(1.0, weight / estimated1RM);
  }
  return CATEGORY_PRIORS[category] ?? CATEGORY_PRIORS.unknown;
}

/**
 * Update fatigueDebt for one completed set.
 *
 * §10 — Reference-capped fatigue decay:
 *   credited decay = min(actual elapsed rest, legacyRest)
 *
 * This prevents the controller from rewarding itself for rest it previously
 * recommended (feedback-loop prevention).
 *
 * @param {number} fatigueDebt  current fatigue debt
 * @param {number} tau          time constant (seconds)
 * @param {number} legacyRest   reference rest cap (seconds)
 * @param {object|null} previousSet
 * @param {object} currentSet
 * @param {string} category
 * @param {number|null} estimated1RM
 * @returns {number}  updated fatigueDebt
 */
export function updateFatigue(fatigueDebt, tau, legacyRest, previousSet, currentSet, category, estimated1RM) {
  let F = fatigueDebt;

  // Decay existing fatigue — credit at most legacyRest (§10)
  if (previousSet && previousSet.completedAt != null && currentSet.completedAt != null) {
    const actualInterval = Math.max(0, (currentSet.completedAt - previousSet.completedAt) / 1000);
    const creditedInterval = Math.min(actualInterval, legacyRest);
    F = F * Math.exp(-creditedInterval / tau);
  }

  // Accumulate new fatigue dose
  const relInt = computeRelativeIntensity(currentSet.w ?? 0, estimated1RM, category);
  const effort = computeEffortMultiplier(currentSet.rir);
  const dose   = ALPHA * relInt * (currentSet.r ?? 0) * effort;
  F = F + dose;

  return F;
}

// ── Component 2: Performance Correction ──────────────────────────────────────

/**
 * Compute temporary, session-scoped rest adjustment from two signals:
 *   - immediate: current reps vs previous-set reps  (W_IMMEDIATE = 0.3)
 *   - cumulative: current reps vs first-set reps    (W_CUMULATIVE = 0.7)
 *
 * Gated by RIR via failureProximity so that a lower-rep set with substantial
 * reserve is not automatically treated as insufficient recovery.
 *
 * §6
 *
 * @param {number|null} firstSetReps
 * @param {object|null} previousSet
 * @param {object} currentSet
 * @returns {number}  seconds of correction ∈ [0, MAX_PERF_CORRECTION]
 */
export function computePerformanceCorrection(firstSetReps, previousSet, currentSet) {
  if (currentSet.r == null) return 0;

  const immediate =
    previousSet && previousSet.r
      ? Math.max(0, (previousSet.r - currentSet.r) / previousSet.r)
      : 0;

  const cumulative =
    firstSetReps
      ? Math.max(0, (firstSetReps - currentSet.r) / firstSetReps)
      : 0;

  const combined = W_IMMEDIATE * immediate + W_CUMULATIVE * cumulative;
  const raw = PERF_K * combined * failureProximity(currentSet.rir);

  return Math.min(raw, MAX_PERF_CORRECTION);
}

// ── Component 3: Rest Recommendation with Session Floor ───────────────────────

/**
 * Compute the recommended rest given fatigue, learned bias, performance
 * correction, and the session-scoped floor.
 *
 * §8 + §3
 *
 * @param {object} params
 * @param {number} params.fatigueDebt
 * @param {number} params.tau
 * @param {object} params.exerciseState  — { restBias, observationCount }
 * @param {number} params.performanceCorrectionSec
 * @param {number|null} params.previousRecommendation
 * @param {number|null} params.sessionFloor
 * @param {number} params.legacyRest
 * @param {number} params.minRest
 * @param {number} params.maxRest
 * @returns {{ final: number, newFloor: number|null }}
 */
export function recommendRest({
  fatigueDebt,
  tau,
  exerciseState,
  performanceCorrectionSec,
  previousRecommendation,
  sessionFloor,
  legacyRest,
  minRest,
  maxRest,
}) {
  // ── Physiological component (Component 1 output) ───────────────────────
  const targetF = -Math.log(TARGET_CAPACITY);

  let physio =
    fatigueDebt > targetF
      ? tau * Math.log(fatigueDebt / targetF)
      : minRest;

  physio = Math.max(minRest, Math.min(maxRest, physio));

  // ── Confidence and bias (Component 5+6) ────────────────────────────────
  const obsCount = exerciseState?.observationCount ?? 0;
  const confidence = obsCount / (obsCount + CONFIDENCE_K);

  const restBias = Math.max(
    BIAS_MIN,
    Math.min(BIAS_MAX, exerciseState?.restBias ?? 0)
  );

  // Confidence-weighted blend: learned vs legacy reference
  const blended =
    confidence * (physio + restBias) +
    (1 - confidence) * legacyRest;

  const naturalRaw = blended + performanceCorrectionSec;

  // ── Session floor (Component 3) ────────────────────────────────────────
  let effectiveRaw = naturalRaw;
  let newFloor;

  if (performanceCorrectionSec > 0) {
    // Active shortfall: enforce the floor
    effectiveRaw = Math.max(
      naturalRaw,
      sessionFloor == null ? -Infinity : sessionFloor
    );
    newFloor = effectiveRaw;
  } else {
    // No shortfall: release the floor immediately
    newFloor = null;
  }

  // ── Output movement clamp (set-to-set) ────────────────────────────────
  let final = effectiveRaw;

  if (previousRecommendation != null) {
    const delta = effectiveRaw - previousRecommendation;
    const clampedDelta =
      delta > 0
        ? Math.min(delta, MAX_INCREASE_PER_SET)
        : Math.max(delta, -MAX_DECREASE_PER_SET);
    final = previousRecommendation + clampedDelta;
  }

  return {
    final: Math.round(Math.max(minRest, Math.min(maxRest, final))),
    newFloor,
  };
}

// ── Set Completion Pipeline ───────────────────────────────────────────────────

/**
 * Top-level pipeline: run on every completed working set.
 *
 * §5
 *
 * @param {object} currentSet
 * @param {object|null} previousSet
 * @param {object} runtimeState   — { fatigueDebt, firstSetReps, previousRecommendation, sessionRestFloor }
 * @param {object} exerciseState  — progressionState[exId].recovery
 * @param {string} category       — resolved category key
 * @param {number|null} estimated1RM
 * @returns {{ runtimeState: object, recommendedRestSec: number }}
 */
export function onSetCompletion(
  currentSet,
  previousSet,
  runtimeState,
  exerciseState,
  category,
  estimated1RM
) {
  const tau       = TAU_PRIORS[category]  ?? TAU_PRIORS.unknown;
  const legacyRest = getLegacyRest(category);
  const minRest   = REST_DURATION;
  const maxRest   = MAX_REST_DURATION;

  // Component 1: Update fatigue
  const newFatigue = updateFatigue(
    runtimeState.fatigueDebt ?? 0,
    tau,
    legacyRest,
    previousSet,
    currentSet,
    category,
    estimated1RM
  );

  // Capture first-set baseline
  let firstSetReps = runtimeState.firstSetReps ?? null;
  if (firstSetReps == null && (currentSet.r ?? 0) > 0) {
    firstSetReps = currentSet.r;
  }

  // Component 2: Performance correction
  const performanceCorrectionSec = computePerformanceCorrection(
    firstSetReps,
    previousSet,
    currentSet
  );

  // Components 3, 5, 6: Rest recommendation
  const { final: recommendedRestSec, newFloor } = recommendRest({
    fatigueDebt:            newFatigue,
    tau,
    exerciseState:          exerciseState ?? {},
    performanceCorrectionSec,
    previousRecommendation: runtimeState.previousRecommendation ?? null,
    sessionFloor:           runtimeState.sessionRestFloor ?? null,
    legacyRest,
    minRest,
    maxRest,
  });

  const nextRuntime = {
    fatigueDebt:          newFatigue,
    firstSetReps,
    previousRecommendation: recommendedRestSec,
    sessionRestFloor:     newFloor,
  };

  return { runtimeState: nextRuntime, recommendedRestSec };
}

// ── Component 4: Evidence Classifier ─────────────────────────────────────────

/**
 * Classify the evidence from a set-to-set transition.
 *
 * §11
 *
 * @param {number} perfShortfallSec       — performanceCorrectionSec of the next set
 * @param {number|null} recommendedRestSec — recommendation stored on the previous set
 * @param {number|null} actualIntervalSec  — elapsed seconds between set completions
 * @param {number|null} explicitOverrideSec — user-requested extra rest (signed)
 * @returns {{ magnitude: number, strength: 'strong'|'moderate'|'weak'|'none' }}
 */
export function classifyTransitionEvidence(
  perfShortfallSec,
  recommendedRestSec,
  actualIntervalSec,
  explicitOverrideSec
) {
  // Explicit user override: strongest available evidence
  if (explicitOverrideSec != null && explicitOverrideSec !== 0) {
    return { magnitude: explicitOverrideSec, strength: 'strong' };
  }

  // Missing data: no update
  if (recommendedRestSec == null || actualIntervalSec == null) {
    return { magnitude: 0, strength: 'none' };
  }

  const restDelta = actualIntervalSec - recommendedRestSec;

  if (perfShortfallSec > 0) {
    // Performance degradation case
    if (restDelta >= -TOLERANCE) {
      // Degradation despite adequate rest → strong evidence
      return { magnitude: perfShortfallSec, strength: 'strong' };
    }
    // Degradation while under-resting → moderate evidence
    return { magnitude: perfShortfallSec, strength: 'moderate' };
  }

  if (restDelta < -TOLERANCE) {
    // Good performance despite materially less rest → moderate (negative magnitude)
    return { magnitude: restDelta, strength: 'moderate' };
  }

  // Stable performance with matched/exceeded rest → weak, directionless
  return { magnitude: 0, strength: 'weak' };
}

// ── Component 5 + 6: Rest Bias Learner + Confidence ──────────────────────────

/**
 * Update persistent exercise recovery state at session completion.
 *
 * Inspects every transition between consecutive completed sets to classify
 * evidence, then applies the appropriate update mechanism:
 *   - strong/moderate evidence → gap/gamma update with per-session limits
 *   - weak/no evidence only   → dedicated neutral decay (§14)
 *
 * §11 – §16
 *
 * @param {object} recovery         — current persistent state: { restBias, errorEMA, observationCount }
 * @param {Array}  sets             — completed sets for this exercise (chronological order)
 * @param {object} [opts]
 * @param {number|null} [opts.explicitOverrideSec] — user-requested rest override for the session
 * @returns {{ restBias: number, errorEMA: number, observationCount: number }}
 */
export function updateRecoveryStateOnSessionEnd(recovery, sets, opts = {}) {
  const prev = {
    restBias:         recovery?.restBias         ?? 0,
    errorEMA:         recovery?.errorEMA         ?? 0,
    observationCount: recovery?.observationCount ?? 0,
  };

  // Only examine completed sets with timestamps
  const done = (sets || []).filter(
    s => s.s === 'done' && s.completedAt != null
  );

  if (done.length < 2) {
    // Single or no sets → no transitions to classify
    return { ...prev };
  }

  // Classify each transition
  const evidenceList = [];

  for (let i = 1; i < done.length; i++) {
    const prevSet = done[i - 1];
    const currSet = done[i];

    const actualIntervalSec =
      (currSet.completedAt - prevSet.completedAt) / 1000;

    // performanceCorrectionSec was stored on the set at log time
    const perfShortfall = currSet.performanceCorrectionSec ?? 0;

    // recommendedRestSec was stored on the previous set at log time
    const recommendedRest = prevSet.recommendedRestSec ?? null;

    // Session-level explicit override (applied to all transitions)
    const explicitOverride = i === 1 ? (opts.explicitOverrideSec ?? null) : null;

    const ev = classifyTransitionEvidence(
      perfShortfall,
      recommendedRest,
      actualIntervalSec,
      explicitOverride
    );

    evidenceList.push(ev);
  }

  // Filter informative evidence (strong or moderate)
  const informative = evidenceList.filter(
    e => e.strength === 'strong' || e.strength === 'moderate'
  );

  // Session evidence weight = sum of strength weights
  const sessionEvidenceWeight = evidenceList.reduce(
    (sum, e) => sum + STRENGTH_WEIGHT[e.strength],
    0
  );

  if (informative.length === 0) {
    // Weak/no evidence only — separate neutral decay (§14)
    const decayed = prev.restBias * (1 - DECAY_TOWARD_NEUTRAL);
    return {
      restBias:         decayed,
      errorEMA:         prev.errorEMA,
      observationCount: prev.observationCount + sessionEvidenceWeight,
    };
  }

  // Weighted session error (§13)
  const informativeWeight = informative.reduce(
    (sum, e) => sum + STRENGTH_WEIGHT[e.strength],
    0
  );

  const sessionError =
    informative.reduce(
      (sum, e) => sum + e.magnitude * STRENGTH_WEIGHT[e.strength],
      0
    ) / informativeWeight;

  // Update restBias directly from session error (not through errorEMA) (§15)
  const gap      = sessionError - prev.restBias;
  const baseGamma = gap >= 0 ? GAMMA_UP : GAMMA_DOWN;
  const rawStep  = gap * baseGamma * sessionEvidenceWeight;

  // Per-session limits (§13)
  const clampedStep =
    rawStep > 0
      ? Math.min(rawStep, MAX_BIAS_STEP_UP)
      : Math.max(rawStep, -MAX_BIAS_STEP_DOWN);

  const newRestBias = Math.max(
    BIAS_MIN,
    Math.min(BIAS_MAX, prev.restBias + clampedStep)
  );

  // errorEMA: diagnostic only — records most recent informative session error (§15)
  const newErrorEMA = sessionError;

  // Observation count increases by weighted evidence fraction (§16)
  const newObsCount = prev.observationCount + sessionEvidenceWeight;

  return {
    restBias:         newRestBias,
    errorEMA:         newErrorEMA,
    observationCount: newObsCount,
  };
}
