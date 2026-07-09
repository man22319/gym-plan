import { EXERCISE_INDEX, state } from '../state/store.js';

export function lowerBound(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if ('value' in obj) return obj.value;
  if ('min'   in obj) return obj.min;
  return null;
}

/**
 * Single source of truth for working weight.
 *
 * Resolution (most specific wins):
 *   runtimeOverrides.workingWeight > progressionState.currentWeight > baseWeight
 *
 * Used by: display (header weight tag), set logging defaults, feedback.
 * One value. No branching.
 *
 * @param {object} appState
 * @param {string} instanceId
 * @returns {number|null}
 */
export function getWorkingWeight(appState, instanceId) {
  // Layer 1: explicit user override (opt-out from controller)
  const ww = appState?.runtimeOverrides?.[instanceId]?.workingWeight;
  if (ww != null) return ww;
  // Layer 2: controller state (authoritative after first session)
  const cw = appState?.progressionState?.[instanceId]?.currentWeight;
  if (cw != null) return cw;
  // Layer 3: exercise definition anchor (bootstrap only)
  return EXERCISE_INDEX[instanceId]?.baseWeight ?? null;
}

/**
 * Resolve the effective exercise for a given instanceId.
 *
 * Applies layer 4 (runtimeOverrides) on top of the EXERCISE_INDEX entry
 * which already has layers 1–3 merged (programDefaults + library + instance overrides).
 *
 * Working weight is NOT merged here — it's resolved via getWorkingWeight().
 * This function handles reps, notes, deltaW, equipmentType overrides only.
 *
 * @param {object} appState
 * @param {string} instanceId
 * @returns {object|null}
 */
export function getEffectiveExercise(appState, instanceId) {
  const base = EXERCISE_INDEX[instanceId];
  if (!base) return null;
  const override = appState?.runtimeOverrides?.[instanceId];
  if (!override) return base;

  const result = { ...base };
  // Working weight resolved via getWorkingWeight() — not spread onto exercise object
  if (override.reps  !== undefined) result.reps  = override.reps;
  if (override.notes !== undefined) result.notes = override.notes;
  if (override.deltaW !== undefined) result.deltaW = override.deltaW;
  if (override.equipmentType !== undefined) result.equipmentType = override.equipmentType;
  return result;
}

/**
 * Resolve the working weight for an exercise.
 * Used when user taps a set dot without entering a weight — defaults to
 * the controller's current weight via getWorkingWeight().
 *
 * @param {number|null} userValue — explicitly typed value (wins if present)
 * @param {string} instanceId
 * @returns {number|null}
 */
export function resolveWeight(userValue, instanceId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) return userValue;
  return getWorkingWeight(state, instanceId);
}

/**
 * Resolve the target reps for an exercise.
 * Reads runtimeOverrides (keyed by instanceId) then falls back to library reps.
 *
 * @param {number|null} userValue — explicitly typed value (wins if present)
 * @param {string} instanceId
 * @returns {number|null}
 */
export function resolveReps(userValue, instanceId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) return userValue;
  const override = state?.runtimeOverrides?.[instanceId];
  const repsObj  = override?.reps ?? EXERCISE_INDEX[instanceId]?.reps;
  return repsObj ? lowerBound(repsObj) : null;
}

/**
 * Resolves the progression increment step size (deltaW) for a given weight configuration.
 * Respects recorded values and returns undefined if unspecified (no guessing).
 *
 * @param {number|object[]} deltaWConfig
 * @param {number|null} currentWeight
 * @returns {number|undefined}
 */
export function getDeltaW(deltaWConfig, currentWeight) {
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
