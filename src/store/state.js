// ==========================================
// ─── CONSTANTS ───
// ==========================================

export const STORAGE_KEY   = 'pf_tracker_v7';
export const REST_DURATION = 90; // seconds
export const MAX_REST_DURATION = 300; // 5 minutes — hard cap
export const STATE_VERSION = 9;
export const DEV_MODE      = ['localhost', '127.0.0.1', ''].includes(window.location.hostname);

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
export function makeSet(s = '', w = null, r = null, n = '', rir = null, rom = true) {
  return { s, w, r, n, rir, rom };
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
    notes:        '',
    warmupNote:   '',
    finisherNote: ''
  };
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
    version:          STATE_VERSION,
    sessions:         JSON.parse(JSON.stringify(workouts || [])),
    sessionsPerWeek:  3,
    activeSessionId:  workouts && workouts[0] ? workouts[0].id : null,
    exercises:        makeDefaultExercises(workouts),
    exerciseSubstitutions: {},
    exerciseOverrides: {},
    history:          [],

    // ── Canonical progression counters (§3/§19) ──────────────────────────────
    // completedWorkouts: authoritative count of finished sessions (§16).
    //   Increments by +1 on each FINISH_WORKOUT.
    //   Never derived from history.length at runtime — it IS the counter.
    completedWorkouts: 0,

    sessionStarted:   null,     // ms timestamp — set when first set is logged

    isDeloadActive:   false,    // user-toggled: suppresses fatigue warnings
    fatigueStatus: {            // populated by analyzeFatigueTrends() after FINISH_WORKOUT
      level:      'normal',     // 'normal' | 'warning'
      indicators: [],           // human-readable strings
      timestamp:  0             // ms epoch of last analysis run
    },

    cardio: null,               // transient: pending cardio for current session; committed to history on FINISH_WORKOUT

    // ── Latent Progression State (§1/§21) ────────────────────────────────────
    // Per-exercise EMA strength (T), fatigue (F), and progression step (Δw).
    // Updated after each FINISH_WORKOUT. Never derived — always persisted.
    progressionState: {}
  };
}
