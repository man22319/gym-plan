// ── State Format ─────────────────────────────────────────────────────────────
// Encode/decode gym-plan state for smaller export files & localStorage.
//
// Omitted on export (always sourced from workouts.json at boot):
//   - programDefaults
//   - sessionsPerWeek
//
// Encoding rules:
//   1. Sets with all-default values (status '', no data) → omit entire exercise key
//   2. Set objects: strip fields matching defaults (n:"", rir:null, rom:"full",
//      completedAt:null).  Rename completedAt → t for brevity.
//
// Decoding:
//   • Always expands abbreviated set fields back to full shape.
//   • The normalize() / sanitizeSessions() pipeline handles any missing rows.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is every field in this set object equal to the default?
 */
function isEmptySet(s) {
  return (s.s === '' || s.s === undefined)
    && (s.w === null || s.w === undefined)
    && (s.r === null || s.r === undefined);
}

/**
 * Compress a single set object — strip default-valued fields, rename completedAt → t.
 */
function compactSet(s) {
  const out = {};
  // Always include status ('' is meaningful — means not attempted)
  out.s = s.s ?? '';
  if (s.w !== null && s.w !== undefined)              out.w = s.w;
  if (s.r !== null && s.r !== undefined)              out.r = s.r;
  if (s.n !== null && s.n !== undefined && s.n !== '') out.n = s.n;
  if (s.rir !== null && s.rir !== undefined)           out.rir = s.rir;
  if (s.rom !== undefined && s.rom !== 'full')         out.rom = s.rom;
  if (s.completedAt !== null && s.completedAt !== undefined) out.t = s.completedAt;
  return out;
}

/**
 * Expand a compact set object back to full shape.
 */
function expandSet(s) {
  return {
    s:           s.s   ?? '',
    w:           s.w   ?? null,
    r:           s.r   ?? null,
    n:           s.n   ?? '',
    rir:         s.rir  ?? null,
    rom:         s.rom  ?? 'full',
    completedAt: s.t    ?? s.completedAt ?? null,
  };
}

/**
 * Compress an exercises map (keyed by instanceId → array of set objects).
 * Omits keys where every set is empty.
 */
function compactExercises(exercises) {
  const out = {};
  for (const [key, sets] of Object.entries(exercises)) {
    if (!Array.isArray(sets)) continue;
    // Skip entirely-empty exercise rows
    if (sets.every(isEmptySet)) continue;
    out[key] = sets.map(compactSet);
  }
  return out;
}

/**
 * Expand a compact exercises map back to full shape.
 * Missing keys are handled later by normalize().
 */
function expandExercises(exercises) {
  if (!exercises || typeof exercises !== 'object') return exercises;
  const out = {};
  for (const [key, sets] of Object.entries(exercises)) {
    if (!Array.isArray(sets)) { out[key] = sets; continue; }
    out[key] = sets.map(expandSet);
  }
  return out;
}

/**
 * Compress full application state for export / localStorage.
 * Returns a new plain object (does not mutate input).
 */
export function compactExport(appState) {
  const out = { ...appState };

  // Strip fields that are always sourced from workouts.json at boot
  delete out.programDefaults;
  delete out.sessionsPerWeek;

  // Compact live exercise tracking
  out.exercises = compactExercises(appState.exercises ?? {});

  // Compact history entries
  if (Array.isArray(appState.history)) {
    out.history = appState.history.map(entry => ({
      ...entry,
      exercises: compactExercises(entry.exercises ?? {}),
    }));
  }

  return out;
}

/**
 * Expand a state object back to full shape.
 */
export function expandImport(data) {
  if (!data) return data;

  const out = { ...data };

  // Re-inject defaults stripped on export (normalize() also handles these via ?? {})
  if (!out.programDefaults) out.programDefaults = {};
  if (typeof out.sessionsPerWeek !== 'number') out.sessionsPerWeek = 3;

  // Expand live exercises
  out.exercises = expandExercises(data.exercises ?? {});

  // Expand history entries
  if (Array.isArray(data.history)) {
    out.history = data.history.map(entry => ({
      ...entry,
      exercises: expandExercises(entry.exercises ?? {}),
    }));
  }

  return out;
}
