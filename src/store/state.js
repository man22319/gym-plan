// ==========================================
// ─── CONSTANTS ───
// ==========================================

export const STORAGE_KEY   = 'pf_tracker_v7';
export const REST_DURATION = 90; // seconds
export const MAX_REST_DURATION = 300; // 5 minutes — hard cap
export const STATE_VERSION = 8;
export const DEV_MODE      = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

// ==========================================
// ─── FACTORY ───
// ==========================================

export function makeSet(s = '', w = null, r = null, n = '') {
  return { s, w, r, n };
}

// Receives the workouts array as a parameter to avoid circular imports.
export function makeDefaultExercises(workouts) {
  const result = {};
  (workouts || []).forEach(session =>
    (session.blocks || []).forEach(block =>
      (block.exercises || []).forEach(ex => {
        result[ex.id] = Array.from({ length: ex.sets }, () => makeSet());
      })
    )
  );
  return result;
}

export function createDefaultState(workouts) {
  return {
    version: STATE_VERSION,
    sessions: JSON.parse(JSON.stringify(workouts || [])),
    sessionsPerWeek: 3,
    activeSessionId: workouts && workouts[0] ? workouts[0].id : null,
    exercises: makeDefaultExercises(workouts),
    exerciseSubstitutions: {},
    exerciseOverrides: {},
    history: [],
    sessionStarted: null,     // ms timestamp — set when first set is logged
    isDeloadActive: false,    // user-toggled: suppresses fatigue warnings & stamps history entries
    fatigueStatus: {          // populated by analyzeFatigueTrends() after FINISH_WORKOUT
      level: 'normal',        // 'normal' | 'warning'
      indicators: [],         // human-readable strings describing active flags
      timestamp: 0            // ms epoch of last analysis run
    }
  };
}