export let defaultWorkouts = [];
export let workouts = [];

export let EXERCISE_INDEX = {};

export let EX_SESSION_INDEX = {};

export let state = null;

export function rebuildIndexes(data) {
  workouts = data || [];
  EXERCISE_INDEX = Object.fromEntries(
    workouts.flatMap(s => (s.blocks || []).flatMap(b => b.exercises || [])).map(ex => [ex.id, ex])
  );
  EX_SESSION_INDEX = Object.fromEntries(
    workouts.flatMap(s => (s.blocks || []).flatMap(b => (b.exercises || []).map(ex => [ex.id, s.id])))
  );
}

export function setState(val) {
  state = val;
  if (state && state.sessions) {
    rebuildIndexes(state.sessions);
  }
}

export function initWorkouts(data) {
  defaultWorkouts = data || [];
  rebuildIndexes(data);
}
