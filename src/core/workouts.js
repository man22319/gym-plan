export let workouts = [];

export let EXERCISE_INDEX = {};

export let EX_SESSION_INDEX = {};

export let state = null;
export function setState(val) { state = val; }

export function initWorkouts(data) {
  workouts = data;
  EXERCISE_INDEX = Object.fromEntries(
    data.flatMap(s => s.blocks.flatMap(b => b.exercises)).map(ex => [ex.id, ex])
  );
  EX_SESSION_INDEX = Object.fromEntries(
    data.flatMap(s => s.blocks.flatMap(b => b.exercises.map(ex => [ex.id, s.id])))
  );
}
