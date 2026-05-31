// ==========================================
// ─── CONSTANTS ───
// ==========================================

const STORAGE_KEY      = 'pf_tracker_v6';
const REST_DURATION    = 90; // seconds
const STATE_VERSION    = 6;
const DEV_MODE         = ['localhost','127.0.0.1',''].includes(window.location.hostname);

// ==========================================
// ─── FACTORY ───
// ==========================================

function makeSet(s = '', w = null, r = null) {
  return { s, w, r };
}

function makeDefaultExercises() {
  const result = {};
  workouts.forEach(session =>
    session.blocks.forEach(block =>
      block.exercises.forEach(ex => {
        result[ex.id] = Array.from({ length: ex.sets }, () => makeSet());
      })
    )
  );
  return result;
}

function createDefaultState() {
  return {
    version: STATE_VERSION,
    activeSessionId: workouts[0].id,
    exercises: makeDefaultExercises(),
    history: []
  };
}