// ==========================================
// ─── WORKOUTS MODULE ───
// ==========================================
// Manages the session/exercise data and indexes.
//
// SINGLE SOURCE OF TRUTH: state.exerciseLibrary and state.programDefaults
// Module-level exerciseLibrary and programDefaults are read-through caches,
// rebuilt on every setState call. Do not write to them directly.
//
// Key identity model:
//   exerciseRef  — definition identity (key in exerciseLibrary)
//   instanceId   — placement identity (key in all runtime state)
//                  computed as dayLabel.toLowerCase() + '_' + exerciseRef
//
// Four-layer resolution (resolveInstance handles layers 1–3):
//   programDefaults → exerciseLibrary[ref] → instance overrides → runtimeOverrides
// ==========================================

// ── Module-level caches (rebuilt from state on every setState) ──────────────

export let defaultWorkoutsData = null; // full parsed exercises.json + sessions.json — for createDefaultState fallback
export let workouts            = [];   // sessions array (mirrors state.sessions)
export let exerciseLibrary     = {};   // canonical exercise definitions (mirrors state.exerciseLibrary)
export let programDefaults     = {};   // global fallbacks (mirrors state.programDefaults)

export let EXERCISE_INDEX    = {}; // instanceId → resolved exercise object (layers 1–3 merged)
export let EX_SESSION_INDEX  = {}; // instanceId → sessionId

export let state = null;

// ── Overridable instance fields (layer 3) ───────────────────────────────────

const INSTANCE_OVERRIDE_KEYS = ['sets', 'reps', 'load', 'restBetweenSets', 'restBetweenExercises'];

// ── Core resolution function ─────────────────────────────────────────────────

/**
 * Resolve a session exercise instance into a fully merged exercise object.
 *
 * Merge order (more specific wins):
 *   defaults (layer 1) < library[exerciseRef] (layer 2) < instance overrides (layer 3)
 *
 * @param {object} instance   — session exercise: { instanceId, exerciseRef, letter?, sets?, ... }
 * @param {object} library    — exerciseLibrary keyed by exerciseRef
 * @param {object} defaults   — programDefaults (restBetweenSets, restBetweenExercises, etc.)
 * @returns {object}          — fully resolved exercise
 */
export function resolveInstance(instance, library, defaults = {}) {
  const base = library[instance.exerciseRef] ?? {};
  const instanceOverrides = {};
  for (const k of INSTANCE_OVERRIDE_KEYS) {
    if (instance[k] !== undefined) instanceOverrides[k] = instance[k];
  }
  return {
    ...defaults,           // layer 1: program fallbacks
    ...base,               // layer 2: exercise-specific values
    ...instanceOverrides,  // layer 3: placement-specific overrides
    instanceId:  instance.instanceId,
    exerciseRef: instance.exerciseRef,
    letter:      instance.letter ?? '',
  };
}

// ── Index management ─────────────────────────────────────────────────────────

/**
 * Rebuild EXERCISE_INDEX and EX_SESSION_INDEX from sessions and library.
 * Called on initWorkouts and on every setState.
 *
 * @param {Array}  sessions — sessions array
 * @param {object} library  — exerciseLibrary
 * @param {object} defaults — programDefaults
 */
export function rebuildIndexes(sessions, library, defaults) {
  workouts         = sessions || [];
  EXERCISE_INDEX   = {};
  EX_SESSION_INDEX = {};
  for (const s of workouts) {
    for (const b of s.blocks ?? []) {
      for (const inst of b.exercises ?? []) {
        EXERCISE_INDEX[inst.instanceId]   = resolveInstance(inst, library, defaults);
        EX_SESSION_INDEX[inst.instanceId] = s.id;
      }
    }
  }
}

// ── State sync ───────────────────────────────────────────────────────────────

/**
 * Sync module-level caches with the canonical state.
 * Called by the reducer after every state update.
 */
export function setState(val) {
  state = val;
  if (!state) return;
  // Update caches from state (state is the source of truth)
  exerciseLibrary = state.exerciseLibrary ?? {};
  programDefaults = state.programDefaults ?? {};
  if (state.sessions) {
    rebuildIndexes(state.sessions, exerciseLibrary, programDefaults);
  }
}

// ── Instance ID hydration ────────────────────────────────────────────────────

/**
 * Compute instanceId for every exercise placement in sessions.
 * Formula: dayLabel.toLowerCase() + '_' + exerciseRef
 *
 * Mutates sessions in-place so downstream code always sees instanceId.
 *
 * @param {Array} sessions — sessions array (from sessions.json or state)
 */
export function hydrateInstanceIds(sessions) {
  for (const s of sessions) {
    const prefix = (s.dayLabel || '').toLowerCase();
    for (const b of s.blocks ?? []) {
      for (const inst of b.exercises ?? []) {
        if (!inst.instanceId && inst.exerciseRef) {
          inst.instanceId = prefix + '_' + inst.exerciseRef;
        }
      }
    }
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

/**
 * Initialize workouts from the parsed exercises.json + sessions.json data.
 * Seeds module-level caches for the pre-state boot window.
 * Once loadState() runs and calls setState(), these are overwritten by state values.
 *
 * @param {object} data — { exercises: {}, defaults: {}, sessions: [] }
 */
export function initWorkouts(data) {
  hydrateInstanceIds(data.sessions ?? []);
  defaultWorkoutsData = data;
  exerciseLibrary = data.exercises ?? {};
  programDefaults = data.defaults  ?? {};
  workouts        = data.sessions  ?? [];
  // All three passed explicitly — no module-scope timing risk
  rebuildIndexes(workouts, exerciseLibrary, programDefaults);
}
