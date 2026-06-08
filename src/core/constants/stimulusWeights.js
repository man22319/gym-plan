/**
 * ══════════════════════════════════════════════════════
 *  Stimulus Coefficient Registry
 *  src/core/constants/stimulusWeights.js
 * ══════════════════════════════════════════════════════
 *
 * Single source of truth for per-exercise muscle stimulus weights.
 *
 * Coefficient meaning:
 *   1.0  → primary muscle (main mechanical driver)
 *   0.5  → secondary involvement (significant but not primary)
 *   0.25 → minor stabilizer work
 *
 * These coefficients convert a raw "set count" into an "effective set"
 * contribution per muscle group. The volume tracker applies them
 * deterministically — no inference, no defaults.
 *
 * Source priority:
 *   1. This file (local config) — always wins
 *   2. ExerciseDB adapter output — merged in, local wins on conflict
 *
 * Note: exercise IDs match the keys in exercise_library in workouts.json.
 * If an exercise is NOT listed here, getExerciseWeights() returns a safe
 * zero-contribution fallback — the system never crashes on unknown exercises.
 */

/** @typedef {'CHEST'|'BACK'|'QUADRICEPS'|'HAMSTRINGS'|'GLUTES'|'SHOULDERS'|'BICEPS'|'TRICEPS'|'ABS'|'CALVES'} MuscleGroup */

/**
 * Canonical muscle groups tracked by the volume system.
 * @type {MuscleGroup[]}
 */
export const MUSCLE_GROUPS = [
  'CHEST', 'BACK', 'QUADRICEPS', 'HAMSTRINGS', 'GLUTES',
  'SHOULDERS', 'BICEPS', 'TRICEPS', 'ABS', 'CALVES'
];

/**
 * Per-exercise stimulus coefficients.
 * Keys must match exercise IDs in workouts.json > exercise_library.
 *
 * @type {Record<string, Partial<Record<MuscleGroup, number>>>}
 */
export const STIMULUS_COEFFICIENTS = {
  // ── Thursday — Session 1 ──────────────────────────────────────────────────
  thu_row: {
    BACK:    1.0,
    BICEPS:  0.3
  },
  thu_bench: {
    CHEST:     0.85,
    TRICEPS:   0.25,
    SHOULDERS: 0.15
  },
  thu_leg_curl: {
    HAMSTRINGS: 1.0
  },
  thu_back_ext: {
    BACK:   0.4,
    GLUTES: 0.6
  },
  thu_glute_kickback: {
    GLUTES:     1.0,
    HAMSTRINGS: 0.2
  },
  thu_lat_pull: {
    BACK:   1.0,
    BICEPS: 0.3
  },
  thu_lat_raise: {
    SHOULDERS: 1.0
  },
  thu_tri_press: {
    TRICEPS: 1.0
  },

  // ── Saturday — Session 2 ──────────────────────────────────────────────────
  sat_row: {
    BACK:   1.0,
    BICEPS: 0.3
  },
  sat_arnold_press: {
    SHOULDERS: 0.85,
    TRICEPS:   0.3
  },
  sat_leg_press: {
    QUADRICEPS: 0.7,
    GLUTES:     0.5,
    HAMSTRINGS: 0.2
  },
  sat_leg_curl: {
    HAMSTRINGS: 1.0
  },
  sat_lat_raise: {
    SHOULDERS: 1.0
  },
  sat_tri_press: {
    TRICEPS: 1.0
  },
  sat_hammer: {
    BICEPS: 1.0
  },

  // ── Monday — Session 3 ───────────────────────────────────────────────────
  mon_row: {
    BACK:   1.0,
    BICEPS: 0.3
  },
  mon_idbp: {
    CHEST:     0.8,
    SHOULDERS: 0.25,
    TRICEPS:   0.2
  },
  mon_leg_press: {
    QUADRICEPS: 0.7,
    GLUTES:     0.5,
    HAMSTRINGS: 0.2
  },
  mon_leg_curl: {
    HAMSTRINGS: 1.0
  },
  mon_skull: {
    TRICEPS: 1.0
  },
  mon_curl: {
    BICEPS: 1.0
  },
  mon_ohp: {
    SHOULDERS: 0.9,
    TRICEPS:   0.25
  },
  mon_lat_raise: {
    SHOULDERS: 1.0
  }
};

/**
 * Returns the stimulus weight map for a given exercise ID.
 *
 * If the exercise is not in STIMULUS_COEFFICIENTS (unknown or external),
 * returns a safe empty object — contributing zero effective sets to all
 * muscle groups. This prevents crashes and silent data corruption.
 *
 * @param {string} exerciseId
 * @returns {Partial<Record<MuscleGroup, number>>}
 */
export function getExerciseWeights(exerciseId) {
  if (!exerciseId || typeof exerciseId !== 'string') return {};
  return STIMULUS_COEFFICIENTS[exerciseId] ?? {};
}
