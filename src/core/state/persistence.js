import { STORAGE_KEY, makeSet, createDefaultState } from './state.js';
import { defaultWorkoutsData, workouts, state, setState } from './store.js';
import { compactExport, expandImport } from '../../io/compactFormat.js';

const KEYS = { primary: STORAGE_KEY, backup: STORAGE_KEY + '_bk', lkg: STORAGE_KEY + '_lkg' };
let writeCount = 0;

export function persist() {
  try {
    const json = JSON.stringify(compactExport(state));
    localStorage.setItem(KEYS.backup, localStorage.getItem(KEYS.primary) ?? '');
    localStorage.setItem(KEYS.primary, json);
    if (++writeCount >= 2) localStorage.setItem(KEYS.lkg, json);
  } catch (e) { console.error('persist() failed:', e); }
}

// ── Load ─────────────────────────────────────────────────────────────────────

export function loadState() {
  for (const key of [KEYS.primary, KEYS.backup, KEYS.lkg]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = expandImport(JSON.parse(raw));
      const normal = normalize(parsed);
      const clean  = sanitizeSessions(normal); // surgical repair — history untouched
      if (validate(clean)) {
        setState(clean);
        return;
      }
    } catch (_) {}
  }
  // All slots failed — start fresh
  setState(createDefaultState(defaultWorkoutsData));
}

// ── Normalize ────────────────────────────────────────────────────────────────

/**
 * Ensure exercises set-tracking map has correct shape for current sessions.
 * Adds missing rows, trims extra rows, re-shapes individual set objects.
 * Uses instanceId as the key.
 */
export function normalize(appState) {
  const exercises = { ...appState.exercises };
  const currentSessions = appState.sessions || workouts;

  // Resolve the number of sets for an instance: instance override > library > default 3
  const lib = appState.exerciseLibrary ?? {};
  currentSessions.forEach(session =>
    (session.blocks || []).forEach(block =>
      (block.exercises || []).forEach(ex => {
        const key  = ex.instanceId;  // instanceId is required in v1
        if (!key) return;            // skip malformed instances (sanitizeSessions handles them)
        const sets = ex.sets ?? lib[ex.exerciseRef]?.sets ?? 3;
        const arr  = exercises[key];
        if (!Array.isArray(arr)) {
          exercises[key] = Array.from({ length: sets }, () => makeSet());
          return;
        }
        const copy = arr.slice(0, sets).map(s => ({
          s:   s.s   ?? '',
          w:   s.w   ?? null,
          r:   s.r   ?? null,
          n:   s.n   ?? '',
          rir: (s.rir !== undefined && s.rir !== null && s.rir >= 0) ? s.rir : null,
          rom: s.rom ?? 'full',
          completedAt: s.completedAt ?? null
        }));
        while (copy.length < sets) copy.push(makeSet());
        exercises[key] = copy;
      })
    )
  );

  const progressionState = appState.progressionState ?? {};

  return {
    ...appState,
    exercises,
    runtimeOverrides:  appState.runtimeOverrides  ?? {},
    exerciseLibrary:   appState.exerciseLibrary   ?? {},
    programDefaults:   appState.programDefaults   ?? {},
    cardio:            appState.cardio ?? null,           // preserve in-progress cardio across reloads
    sessionStarted:    appState.sessionStarted ?? null,   // preserve active session timestamp
    completedWorkouts: appState.completedWorkouts ?? 0,
    progressionState,
  };
}

// ── Sanitize sessions ────────────────────────────────────────────────────────

/**
 * Surgically remove session exercise instances with missing or dangling
 * exerciseRef values. Leaves history, progression, and all other state intact.
 * Logs each removal.
 *
 * This runs BEFORE validate() so a bad template reference never causes a
 * full state wipe.
 */
export function sanitizeSessions(appState) {
  const lib = appState.exerciseLibrary ?? {};
  let dirty = false;
  const sessions = (appState.sessions ?? []).map(session => {
    const blocks = (session.blocks ?? []).map(block => {
      const exercises = (block.exercises ?? []).filter(inst => {
        if (!inst.instanceId || !inst.exerciseRef) {
          console.warn(`[sanitize] Dropped instance missing instanceId/exerciseRef in session "${session.id}"`);
          dirty = true;
          return false;
        }
        if (!Object.prototype.hasOwnProperty.call(lib, inst.exerciseRef)) {
          console.warn(`[sanitize] Dropped "${inst.instanceId}" — exerciseRef "${inst.exerciseRef}" not in library`);
          dirty = true;
          return false;
        }
        return true;
      });
      return { ...block, exercises };
    });
    return { ...session, blocks };
  });
  return dirty ? { ...appState, sessions } : appState;
}

// ── Validate ─────────────────────────────────────────────────────────────────

/**
 * Structural validation. Returns false only for genuinely broken state
 * (wrong types, missing required fields). Dangling refs are handled by
 * sanitizeSessions() before this is called.
 */
export function validate(appState) {
  if (!appState || typeof appState !== 'object')              return false;
  if (appState.activeSessionId !== null && typeof appState.activeSessionId !== 'string') return false;
  if (!Array.isArray(appState.history))                       return false;
  if (typeof appState.exercises !== 'object')                 return false;
  for (const sets of Object.values(appState.exercises)) {
    if (!Array.isArray(sets)) return false;
    for (const s of sets) {
      if (!s || typeof s !== 'object')            return false;
      if (!['', 'done', 'failed'].includes(s.s)) return false;
    }
  }
  if (appState.runtimeOverrides && typeof appState.runtimeOverrides !== 'object') return false;
  if (!Array.isArray(appState.sessions))                      return false;
  if (typeof appState.sessionsPerWeek !== 'number')           return false;
  if (typeof appState.completedWorkouts !== 'number')         return false;
  // Session instances are validated structurally (type checks only).
  // Dangling ref check was already done by sanitizeSessions().
  for (const session of appState.sessions) {
    for (const block of (session.blocks || [])) {
      for (const inst of (block.exercises || [])) {
        if (typeof inst.instanceId  !== 'string' || !inst.instanceId)  return false;
        if (typeof inst.exerciseRef !== 'string' || !inst.exerciseRef) return false;
      }
    }
  }
  return true;
}
