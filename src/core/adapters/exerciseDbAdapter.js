/**
 * ══════════════════════════════════════════════════════
 *  ExerciseDB Adapter
 *  src/core/adapters/exerciseDbAdapter.js
 * ══════════════════════════════════════════════════════
 *
 * Translates external exercise database payloads (ExerciseDB API format)
 * into the internal stimulus model used by volumeTracker and stimulusWeights.
 *
 * ## Mapping rules (per TODO §4.3)
 *   target muscle  → 1.0 (primary)
 *   secondaryMuscles[] → 0.5 each
 *
 * ## Merge behavior
 *   External data is merged INTO local config.
 *   Local config (STIMULUS_COEFFICIENTS) ALWAYS wins on key conflict.
 *   This guarantees external data never silently overrides manually tuned values.
 *
 * ## What this does NOT do
 *   - No network requests (pure transformation)
 *   - No mutation of STIMULUS_COEFFICIENTS
 *   - No fallback inference for unmapped muscles
 */

import { MUSCLE_GROUPS } from '../constants/stimulusWeights.js';

// ── Internal muscle name normalizer ──────────────────────────────────────────

/**
 * Maps ExerciseDB muscle names to internal MuscleGroup labels.
 * ExerciseDB uses lowercase with spaces; internal model uses uppercase single words.
 *
 * Only muscles tracked by the internal model are mapped.
 * Unknown external muscles are silently dropped (no inference).
 *
 * @type {Record<string, string>}
 */
const EXTERNAL_TO_INTERNAL_MUSCLE = {
  // Chest
  'pectorals':               'CHEST',
  'pectoralis major':        'CHEST',

  // Back
  'lats':                    'BACK',
  'upper back':              'BACK',
  'middle back':             'BACK',
  'traps':                   'BACK',
  'rhomboids':               'BACK',

  // Legs
  'quads':                   'QUADRICEPS',
  'quadriceps':              'QUADRICEPS',
  'hamstrings':              'HAMSTRINGS',
  'glutes':                  'GLUTES',
  'calves':                  'CALVES',

  // Shoulders
  'delts':                   'SHOULDERS',
  'shoulders':               'SHOULDERS',
  'anterior deltoid':        'SHOULDERS',
  'medial deltoid':          'SHOULDERS',
  'posterior deltoid':       'SHOULDERS',

  // Arms
  'biceps':                  'BICEPS',
  'biceps brachii':          'BICEPS',
  'triceps':                 'TRICEPS',
  'triceps brachii':         'TRICEPS',

  // Core
  'abs':                     'ABS',
  'abdominals':              'ABS',
  'core':                    'ABS'
};

/**
 * Normalize an external muscle name to an internal MuscleGroup label.
 * Returns null if the muscle is not tracked by this system.
 *
 * @param {string} externalName
 * @returns {string|null}
 */
function normalizeMuscleName(externalName) {
  if (!externalName || typeof externalName !== 'string') return null;
  const key = externalName.toLowerCase().trim();
  return EXTERNAL_TO_INTERNAL_MUSCLE[key] ?? null;
}

// ── Core Adapter ─────────────────────────────────────────────────────────────

/**
 * Maps an ExerciseDB exercise payload to an internal stimulus weight map.
 *
 * ExerciseDB payload shape (relevant fields):
 * {
 *   id:               string,
 *   name:             string,
 *   target:           string,         // primary muscle
 *   secondaryMuscles: string[],       // secondary muscles
 * }
 *
 * Output shape (internal stimulus model):
 * {
 *   [MuscleGroup]: number   // coefficient: 1.0 primary, 0.5 secondary
 * }
 *
 * @param {object} exerciseDbPayload - Single exercise object from ExerciseDB
 * @returns {Partial<Record<string, number>>} Internal stimulus weight map
 */
export function mapExerciseDbToStimulus(exerciseDbPayload) {
  if (!exerciseDbPayload || typeof exerciseDbPayload !== 'object') return {};

  const result = {};

  // Primary muscle → 1.0
  const primaryInternal = normalizeMuscleName(exerciseDbPayload.target);
  if (primaryInternal) {
    result[primaryInternal] = 1.0;
  }

  // Secondary muscles → 0.5 (only if not already set as primary)
  for (const secondary of (exerciseDbPayload.secondaryMuscles || [])) {
    const internalName = normalizeMuscleName(secondary);
    if (internalName && !(internalName in result)) {
      result[internalName] = 0.5;
    }
  }

  return result;
}

/**
 * Merges an ExerciseDB payload into a local stimulus config map.
 *
 * Merge behavior:
 * - External data provides the base
 * - localConfig entries ALWAYS win on conflict (local overrides external)
 * - Result is a new object; neither input is mutated
 *
 * Typical use: enrich STIMULUS_COEFFICIENTS with external data for exercises
 * not manually configured, while preserving hand-tuned local values.
 *
 * @param {string} exerciseId             - Internal exercise ID (key in STIMULUS_COEFFICIENTS)
 * @param {object} exerciseDbPayload      - Raw ExerciseDB exercise object
 * @param {object} [localConfig={}]       - Existing local stimulus entry for this exercise
 * @returns {Partial<Record<string, number>>} Merged stimulus map
 */
export function mergeWithLocalConfig(exerciseId, exerciseDbPayload, localConfig = {}) {
  const external = mapExerciseDbToStimulus(exerciseDbPayload);
  // Local wins: spread external first, then local overwrites
  return { ...external, ...localConfig };
}
