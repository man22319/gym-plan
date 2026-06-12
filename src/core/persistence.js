import { STORAGE_KEY, STATE_VERSION, makeSet, makeCardio, createDefaultState, EQUIPMENT_DELTA_W_DEFAULTS } from '../store/state.js';
import { defaultWorkouts, workouts, state, setState, EXERCISE_INDEX } from './workouts.js';

const KEYS = { primary: STORAGE_KEY, backup: STORAGE_KEY + '_bk', lkg: STORAGE_KEY + '_lkg' };

let writeCount = 0;

export function persist() {
  try {
    const json = JSON.stringify(state);
    localStorage.setItem(KEYS.backup, localStorage.getItem(KEYS.primary) ?? '');
    localStorage.setItem(KEYS.primary, json);
    if (++writeCount >= 2) localStorage.setItem(KEYS.lkg, json);
  } catch (e) { console.error('persist() failed:', e); }
}

export function loadState() {
  for (const key of [KEYS.primary, KEYS.backup, KEYS.lkg]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const normal = normalize(parsed);
      if (validate(normal)) {
        setState(normal);
        return;
      }
    } catch (_) {}
  }
  setState(createDefaultState(defaultWorkouts));
}

export function normalize(appState) {
  const exercises = { ...appState.exercises };
  const currentSessions = appState.sessions || workouts;
  currentSessions.forEach(session =>
    (session.blocks || []).forEach(block =>
      (block.exercises || []).forEach(ex => {
        const arr = exercises[ex.id];
        if (!Array.isArray(arr)) {
          exercises[ex.id] = Array.from({ length: ex.sets }, () => makeSet());
          return;
        }
        const copy = arr.slice(0, ex.sets).map(s => ({
          s:   s.s   ?? '',
          w:   s.w   ?? null,
          r:   s.r   ?? null,
          n:   s.n   ?? '',
          rir: (s.rir !== undefined && s.rir !== null && s.rir >= 0) ? s.rir : null,
          rom: s.rom ?? 'full'
        }));
        while (copy.length < ex.sets) copy.push(makeSet());
        exercises[ex.id] = copy;
      })
    )
  );
  return {
    ...appState,
    exercises,
    exerciseOverrides:     appState.exerciseOverrides     ?? {},
    cardio:                null,
    completedWorkouts:     appState.completedWorkouts     ?? 0,
    progressionState:      appState.progressionState      ?? {},
    version:               STATE_VERSION
  };
}

export function validate(appState) {
  if (!appState || typeof appState !== 'object')              return false;
  if (typeof appState.version !== 'number')                   return false;
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
  if (appState.exerciseOverrides && typeof appState.exerciseOverrides !== 'object') return false;
  if (!Array.isArray(appState.sessions))                      return false;
  if (typeof appState.sessionsPerWeek !== 'number')           return false;
  if (typeof appState.completedWorkouts !== 'number')         return false;

  for (const session of appState.sessions) {
    for (const block of (session.blocks || [])) {
      for (const ex of (block.exercises || [])) {
        if (ex.equipmentType      === undefined ||
            ex.deltaW             === undefined ||
            ex.manualDeltaWOverride === undefined) return false;
        if (typeof ex.deltaW !== 'number' || ex.deltaW < 0) return false;
      }
    }
  }

  return true;
}
