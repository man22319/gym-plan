// Adaptive Recovery Controller (Fatigue Estimator)

import { REST_DURATION, MAX_REST_DURATION } from '../state/state.js';

const TARGET_CAPACITY = 0.90;
const ALPHA = 0.04;
const RIR_REFERENCE = 2;
const K_EFFORT = 0.15;
const MAX_REST_CHANGE_PER_SET = 30;

const GAMMA = 0.15; // base adaptation rate
const LOG_CLIP = 0.4; // max log(performanceRatio) magnitude per update
const CONFIDENCE_K = 10; // rate constant for confidence growth

/**
 * Categorical priors for relative intensity if 1RM is unknown.
 */
const CATEGORY_PRIORS = {
  compoundLower: 0.75,
  compoundUpper: 0.70,
  isolation: 0.60,
  unknown: 0.70
};

/**
 * Computes effort multiplier based on RIR.
 */
export function computeEffortMultiplier(rir) {
  if (rir == null || typeof rir !== 'number') return 1.0;
  const mult = 1 + K_EFFORT * Math.max(0, RIR_REFERENCE - rir);
  return Math.max(1.0, Math.min(1.5, mult));
}

/**
 * Computes relative intensity.
 */
export function computeRelativeIntensity(weight, estimated1RM, category = 'unknown') {
  if (weight > 0 && estimated1RM && estimated1RM > 0) {
    return Math.min(1.0, weight / estimated1RM);
  }
  return CATEGORY_PRIORS[category] || CATEGORY_PRIORS.unknown;
}

/**
 * Calculates new fatigue state after completing a set.
 */
export function updateFatigueAndTau(
  persistentState, 
  runtimeState, 
  currentSet, 
  previousSet, 
  category = 'unknown',
  estimated1RM = null
) {
  let { tau, priorTau, observationCount } = persistentState;
  let { fatigueDebt, firstSetReps, previousRestSec } = runtimeState;

  const actualReps = currentSet.r ?? 0;
  const weight = currentSet.w ?? 0;
  
  // Initialize firstSetReps if not set
  if (firstSetReps === null && actualReps > 0) {
    firstSetReps = actualReps;
  }

  // 1. Decay existing fatigue if there was a previous set
  let F = fatigueDebt;
  if (previousSet && previousSet.completedAt != null && currentSet.completedAt != null) {
    const intervalSec = Math.max(0, (currentSet.completedAt - previousSet.completedAt) / 1000);
    F = F * Math.exp(-intervalSec / tau);
    
    // Evaluate performance and update tau (only if not the first set)
    if (firstSetReps > 0) {
      // capacity right before this set
      const predictedCapacity = Math.exp(-F);
      const predictedReps = firstSetReps * predictedCapacity;
      
      if (predictedReps > 0 && actualReps > 0) {
        const performanceRatio = actualReps / predictedReps;
        let logRatio = Math.log(performanceRatio);
        // clip logRatio
        logRatio = Math.max(-LOG_CLIP, Math.min(LOG_CLIP, logRatio));
        
        // update tau
        // Scale adaptation rate by confidence so early noise doesn't yank the model
        const confidence = 1 - Math.exp(-observationCount / CONFIDENCE_K);
        const effectiveGamma = GAMMA * confidence;
        tau = tau * (1 - effectiveGamma * logRatio);
        
        // Enforce tau bounds
        tau = Math.max(0.4 * priorTau, Math.min(2.5 * priorTau, tau));
        observationCount++;
      }
    }
  }

  // 2. Add new fatigue dose
  const effort = computeEffortMultiplier(currentSet.rir);
  const relInt = computeRelativeIntensity(weight, estimated1RM, category);
  const dose = ALPHA * relInt * actualReps * effort;
  
  F = F + dose;

  return {
    newPersistent: {
      ...persistentState,
      tau,
      observationCount,
      lastUpdated: Date.now()
    },
    newRuntime: {
      ...runtimeState,
      fatigueDebt: F,
      firstSetReps,
      previousRestSec
    }
  };
}

/**
 * Calculates recommended rest for the next set based on current fatigue.
 */
export function calculateRecommendedRest(
  fatigueDebt, 
  tau, 
  observationCount, 
  legacyRest,
  previousRecommendation = null,
  minRest = REST_DURATION,
  maxRest = MAX_REST_DURATION
) {
  // We want C to recover to TARGET_CAPACITY (e.g., 0.90)
  // C = exp(-F_remaining) = TARGET_CAPACITY -> F_remaining = -ln(TARGET_CAPACITY)
  // T = tau * ln(F / -ln(TARGET_CAPACITY))
  const targetF = -Math.log(TARGET_CAPACITY);
  let adaptiveRest = 0;
  
  if (fatigueDebt > targetF) {
    adaptiveRest = tau * Math.log(fatigueDebt / targetF);
  } else {
    adaptiveRest = minRest;
  }

  // Confidence blending - exponential approach to full trust
  const confidence = 1 - Math.exp(-observationCount / CONFIDENCE_K);
  let finalRest = confidence * adaptiveRest + (1 - confidence) * legacyRest;

  // Apply stability constraints
  if (previousRecommendation !== null) {
    finalRest = Math.max(
      previousRecommendation - MAX_REST_CHANGE_PER_SET,
      Math.min(previousRecommendation + MAX_REST_CHANGE_PER_SET, finalRest)
    );
  }

  // Enforce absolute bounds
  return Math.round(Math.max(minRest, Math.min(maxRest, finalRest)));
}
