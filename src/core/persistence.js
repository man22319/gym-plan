import { STORAGE_KEY, STATE_VERSION, makeSet, createDefaultState } from '../store/state.js';
import { defaultWorkouts, workouts, state, setState } from './workouts.js';

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
      const parsed   = JSON.parse(raw);
      const migrated = migrate(parsed);
      const normal   = normalize(migrated);
      if (validate(normal)) {
        setState(normal);
        return;
      }
    } catch (_) {}
  }
  setState(createDefaultState(defaultWorkouts));
}

export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultState(defaultWorkouts);

  const sessions = raw.sessions
    ? JSON.parse(JSON.stringify(raw.sessions))
    : JSON.parse(JSON.stringify(defaultWorkouts));

  const sessionsPerWeek = raw.sessionsPerWeek ?? 3;

  const exercises = {};
  for (const [id, arr] of Object.entries(raw.exercises || {})) {
    if (!Array.isArray(arr)) continue;
    exercises[id] = arr.map(item => {
      if (typeof item === 'string') return makeSet(item);
      const _s = item.s ?? '';
      const _w = (item.w === 0 && _s === '') ? null : (item.w ?? null);
      const _r = (item.r === 0 && _s === '') ? null : (item.r ?? null);
      const _n = item.n ?? '';
      return { s: _s, w: _w, r: _r, n: _n };
    });
  }

  return {
    version:         STATE_VERSION,
    sessions,
    sessionsPerWeek,
    activeSessionId: raw.activeSessionId ?? sessions[0]?.id ?? null,
    sessionStarted:  raw.sessionStarted ?? null,
    exerciseSubstitutions: raw.exerciseSubstitutions ?? {},
    exerciseOverrides: raw.exerciseOverrides ?? {},
    history:         (raw.history || []).map(entry => ({
      entryId:        entry.entryId ?? crypto.randomUUID(), // Guarantee entryId exists in history
      sessionId:      entry.sessionId,
      timestamp:      entry.timestamp,
      startTimestamp: entry.startTimestamp ?? null,  // v6→v7: add startTimestamp
      exercises:      Object.fromEntries(
        Object.entries(entry.exercises || {}).map(([id, sets]) => [
          id,
          (Array.isArray(sets) ? sets : []).map(s =>
            typeof s === 'string' ? makeSet(s) : (() => {
              const _s = s.s ?? '';
              const _w = (s.w === 0 && _s === '') ? null : (s.w ?? null);
              const _r = (s.r === 0 && _s === '') ? null : (s.r ?? null);
              const _n = s.n ?? '';
              return { s: _s, w: _w, r: _r, n: _n };
            })()
          )
        ])
      )
    })),
    exercises
  };
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
        const copy = arr.slice(0, ex.sets).map(s => ({ s: s.s ?? '', w: s.w ?? null, r: s.r ?? null, n: s.n ?? '' }));
        while (copy.length < ex.sets) copy.push(makeSet());
        exercises[ex.id] = copy;
      })
    )
  );
  return {
    ...appState,
    exercises,
    exerciseSubstitutions: appState.exerciseSubstitutions ?? {},
    exerciseOverrides: appState.exerciseOverrides ?? {},
    version: STATE_VERSION
  };
}

export function validate(appState) {
  if (!appState || typeof appState !== 'object') return false;
  if (typeof appState.version !== 'number')       return false;
  if (appState.activeSessionId !== null && typeof appState.activeSessionId !== 'string') return false;
  if (!Array.isArray(appState.history))           return false;
  if (typeof appState.exercises !== 'object')     return false;
  for (const sets of Object.values(appState.exercises)) {
    if (!Array.isArray(sets)) return false;
    for (const s of sets) {
      if (!s || typeof s !== 'object') return false;
      if (!['', 'done', 'failed'].includes(s.s)) return false;
    }
  }
  if (appState.exerciseSubstitutions && typeof appState.exerciseSubstitutions !== 'object') return false;
  if (appState.exerciseOverrides && typeof appState.exerciseOverrides !== 'object') return false;
  if (!Array.isArray(appState.sessions)) return false;
  if (typeof appState.sessionsPerWeek !== 'number') return false;
  return true;
}
