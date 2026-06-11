import { EXERCISE_INDEX, state } from './workouts.js';

export function lowerBound(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if ('fixed' in obj) return obj.fixed;
  if ('value' in obj) return obj.value;
  if ('min'   in obj) return obj.min;
  return null;
}

export function getDisplayName(appState, exId) {
  const sub = appState?.exerciseSubstitutions?.[exId];
  if (sub) return sub.name;
  return EXERCISE_INDEX[exId]?.name ?? exId;
}

export function getEffectiveExercise(appState, exId) {
  const base = EXERCISE_INDEX[exId];
  if (!base) return null;
  const overrides = appState?.exerciseOverrides?.[exId];
  if (!overrides) return base;

  const result = { ...base };
  // Overrides store weight prescription as 'weight'; exercise schema uses 'load'.
  // Apply to load so the rest of the render path sees it correctly.
  if (overrides.weight) result.load = overrides.weight;
  if (overrides.reps)   result.reps = overrides.reps;
  if (overrides.notes)  result.notes = overrides.notes;
  // Expose weight alias for any code that still reads effEx.weight
  result.weight = result.load;
  return result;
}

export function resolveWeight(userValue, exId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) return userValue;
  const overrides = state?.exerciseOverrides?.[exId];
  // overrides.weight is the user-set weight object; exercise schema stores it as 'load'
  const weightObj = overrides?.weight ?? EXERCISE_INDEX[exId]?.load ?? EXERCISE_INDEX[exId]?.weight;
  return weightObj ? lowerBound(weightObj) : null;
}

export function resolveReps(userValue, exId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) return userValue;
  const overrides = state?.exerciseOverrides?.[exId];
  const repsObj = overrides?.reps ?? EXERCISE_INDEX[exId]?.reps;
  return repsObj ? lowerBound(repsObj) : null;
}
