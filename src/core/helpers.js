import { EXERCISE_INDEX, state } from './workouts.js';

export function lowerBound(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if ('value' in obj) return obj.value;
  if ('min'   in obj) return obj.min;
  return null;
}

export function getEffectiveExercise(appState, exId) {
  const base = EXERCISE_INDEX[exId];
  if (!base) return null;
  const overrides = appState?.exerciseOverrides?.[exId];
  if (!overrides) return base;

  const result = { ...base };
  if (overrides.weight) result.load = overrides.weight;
  if (overrides.reps)   result.reps = overrides.reps;
  if (overrides.notes)  result.notes = overrides.notes;
  result.weight = result.load;
  return result;
}

export function resolveWeight(userValue, exId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) return userValue;
  const overrides = state?.exerciseOverrides?.[exId];
  const weightObj = overrides?.weight ?? EXERCISE_INDEX[exId]?.load ?? EXERCISE_INDEX[exId]?.weight;
  return weightObj ? lowerBound(weightObj) : null;
}

export function resolveReps(userValue, exId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) return userValue;
  const overrides = state?.exerciseOverrides?.[exId];
  const repsObj = overrides?.reps ?? EXERCISE_INDEX[exId]?.reps;
  return repsObj ? lowerBound(repsObj) : null;
}
