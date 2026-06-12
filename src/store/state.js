// ==========================================
// ─── CONSTANTS ───
// ==========================================

export const STORAGE_KEY   = 'pf_tracker_v9';
export const REST_DURATION = 90; // seconds
export const MAX_REST_DURATION = 300; // 5 minutes — hard cap
export const STATE_VERSION = 10;
export const DEV_MODE      = typeof window !== 'undefined' ? ['localhost', '127.0.0.1', ''].includes(window.location.hostname) : true;

export const EQUIPMENT_DELTA_W_DEFAULTS = {
  machine:    5,
  dumbbell:   5,
  barbell:    5,
  cable:      5,
  bodyweight: 0,
  other:      2.5,
};

// ==========================================
// ─── FACTORY ───
// ==========================================

/**
 * A single logged set.
 * s:   status  '' | 'done' | 'failed'
 * w:   weight  (lbs, number | null)
 * r:   reps    (number | null)
 * n:   note    (string)
 * rir: Reps In Reserve  ∈ {0,1,2,…} | null (optional per §10/§20)
 * rom: full Range of Motion flag (boolean, default true per §10)
 */
export function makeSet(s = '', w = null, r = null, n = '', rir = null) {
  return { s, w, r, n, rir, rom: 'full' };
}

/**
 * Binary cardio record per §8/§25.
 * warmupDone   — boolean: was warmup completed this session?
 * finisherDone — boolean: was finisher completed this session?
 * notes        — optional free-text, stored in history, excluded from metrics.
 *
 * Stored transiently in state.cardio during a session;
 * committed into history[].cardio on FINISH_WORKOUT then cleared.
 */
export function makeCardio() {
  return {
    warmupDone:   false,
    finisherDone: false,
    notes:        ''
  };
}

/**
 * Build the default exercises set-tracking map from sessions.
 * Keyed by instanceId. Value: array of makeSet() rows, one per set.
 *
 * @param {Array} sessions — sessions array from workoutsData
 */
export function makeDefaultExercises(sessions) {
  const result = {};
  (sessions || []).forEach(session =>
    (session.blocks || []).forEach(block =>
      (block.exercises || []).forEach(ex => {
        const key  = ex.instanceId;
        const sets = ex.sets ?? 3;
        if (key) result[key] = Array.from({ length: sets }, () => makeSet());
      })
    )
  );
  return result;
}

/**
 * Create a clean default application state from the full workoutsData object.
 *
 * @param {object} workoutsData — full parsed workouts.json:
 *   { exercises: {}, defaults: {}, sessions: [] }
 */
export function createDefaultState(workoutsData) {
  const sessions = workoutsData?.sessions ?? [];
  return {
    version:         STATE_VERSION,
    exerciseLibrary: workoutsData?.exercises ?? {},
    programDefaults: workoutsData?.defaults  ?? {},
    sessions:        JSON.parse(JSON.stringify(sessions)),
    sessionsPerWeek: 3,
    activeSessionId: sessions[0]?.id ?? null,
    exercises:       makeDefaultExercises(sessions),
    runtimeOverrides: {},
    history:          [],
    completedWorkouts: 0,
    sessionStarted:   null,
    cardio: null,
    progressionState: {}
  };
}
