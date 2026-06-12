import { EXERCISE_INDEX, state } from '../state/store.js';

export function lowerBound(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if ('value' in obj) return obj.value;
  if ('min'   in obj) return obj.min;
  return null;
}

/**
 * Resolve the effective exercise for a given instanceId.
 *
 * Applies layer 4 (runtimeOverrides) on top of the EXERCISE_INDEX entry
 * which already has layers 1–3 merged (programDefaults + library + instance overrides).
 *
 * All fields use the same naming convention as the library:
 *   load, reps, notes, deltaW, equipmentType, manualDeltaWOverride
 * The old .weight alias is removed — callers use .load.
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
  // All override keys match library field names
  if (override.load  !== undefined) result.load  = override.load;
  if (override.reps  !== undefined) result.reps  = override.reps;
  if (override.notes !== undefined) result.notes = override.notes;
  if (override.deltaW !== undefined) result.deltaW = override.deltaW;
  if (override.equipmentType !== undefined) result.equipmentType = override.equipmentType;
  if (override.manualDeltaWOverride !== undefined) result.manualDeltaWOverride = override.manualDeltaWOverride;
  return result;
}

/**
 * Resolve the working weight for an exercise.
 * Reads runtimeOverrides (keyed by instanceId) then falls back to library load.
 *
 * @param {number|null} userValue — explicitly typed value (wins if present)
 * @param {string} instanceId
 * @returns {number|null}
 */
export function resolveWeight(userValue, instanceId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) return userValue;
  const override = state?.runtimeOverrides?.[instanceId];
  const loadObj  = override?.load ?? EXERCISE_INDEX[instanceId]?.load;
  return loadObj ? lowerBound(loadObj) : null;
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
