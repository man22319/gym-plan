import { STORAGE_KEY, STATE_VERSION, makeSet, makeCardio, createDefaultState } from '../store/state.js';
import { defaultWorkouts, workouts, state, setState, EXERCISE_INDEX, completedSessionsBase as _base } from './workouts.js';

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

  const sessions = (raw.sessions
    ? JSON.parse(JSON.stringify(raw.sessions))
    : JSON.parse(JSON.stringify(defaultWorkouts))).map(session => ({
      ...session,
      blocks: (session.blocks || []).map(block => ({
        ...block,
        exercises: (block.exercises || []).map(entry => {
          if (typeof entry === 'string') {
            const resolved = EXERCISE_INDEX[entry] || defaultWorkouts.flatMap(s => s.blocks.flatMap(b => b.exercises)).find(e => e.id === entry);
            if (!resolved) {
              console.warn(`[migrate] missing exercise metadata for "${entry}"`);
              return { id: entry, name: entry, sets: 0, reps: null, load: null, equipmentType: 'other', deltaW: 2.5, manualDeltaWOverride: false };
            }
            return JSON.parse(JSON.stringify(resolved));
          }
          return entry;
        })
      }))
    }));

  const sessionsPerWeek = raw.sessionsPerWeek ?? 3;

  const exercises = {};
  for (const [id, arr] of Object.entries(raw.exercises || {})) {
    if (!Array.isArray(arr)) continue;
    exercises[id] = arr.map(item => {
      if (typeof item === 'string') return makeSet(item);
      const _s   = item.s ?? '';
      const _w   = (item.w === 0 && _s === '') ? null : (item.w ?? null);
      const _r   = (item.r === 0 && _s === '') ? null : (item.r ?? null);
      const _n   = item.n ?? '';
      const _rir = (item.rir !== undefined && item.rir !== null && item.rir >= 0) ? item.rir : null;
      const _rom = item.rom !== undefined ? item.rom : true;  // default full ROM
      return { s: _s, w: _w, r: _r, n: _n, rir: _rir, rom: _rom };
    });
  }

  // ── Migrate history entries ────────────────────────────────────────────────
  const history = (raw.history || []).map(entry => {
    let ts = entry.timestamp;
    if (typeof ts === 'string') {
      ts = Date.parse(ts);
      if (isNaN(ts)) ts = Date.now();
    }
    let startTs = entry.startTimestamp;
    if (typeof startTs === 'string') {
      startTs = Date.parse(startTs);
      if (isNaN(startTs)) startTs = null;
    }
    return {
      entryId:        entry.entryId ?? crypto.randomUUID(),
      sessionId:      entry.sessionId,
      timestamp:      ts,
      startTimestamp: startTs ?? null,
      isDeload:       entry.isDeload ?? false,
      // Migrate old cardio schema { type, durationMinutes, distanceMiles, perceivedExertion }
      // to new binary schema { warmupDone, finisherDone, notes } per §8
      cardio: migrateCardio(entry.cardio),
      exercises: Object.fromEntries(
        Object.entries(entry.exercises || {}).map(([id, sets]) => [
          id,
          (Array.isArray(sets) ? sets : []).map(s =>
            typeof s === 'string' ? makeSet(s) : (() => {
              const _s   = s.s ?? '';
              const _w   = (s.w === 0 && _s === '') ? null : (s.w ?? null);
              const _r   = (s.r === 0 && _s === '') ? null : (s.r ?? null);
              const _n   = s.n ?? '';
              const _rir = (s.rir !== undefined && s.rir !== null && s.rir >= 0) ? s.rir : null;
              const _rom = s.rom !== undefined ? s.rom : true;
              return { s: _s, w: _w, r: _r, n: _n, rir: _rir, rom: _rom };
            })()
          )
        ])
      )
    };
  });

  // ── Derive completedWorkouts ───────────────────────────────────────────────
  // If present in raw (v9+), use it directly.
  // Otherwise derive from history.length + completedSessionsBase (backwards compat with v8).
  const completedWorkouts = typeof raw.completedWorkouts === 'number'
    ? raw.completedWorkouts
    : (history.length + (_base ?? 0));

  const fatigueStatus = raw.fatigueStatus
    ? {
        level:      raw.fatigueStatus.level ?? 'normal',
        indicators: raw.fatigueStatus.indicators ?? [],
        timestamp:  raw.fatigueStatus.timestamp ?? 0,
        dismissed:  raw.fatigueStatus.dismissed ?? false
      }
    : { level: 'normal', indicators: [], timestamp: 0, dismissed: false };

  return {
    version:          STATE_VERSION,
    sessions,
    sessionsPerWeek,
    activeSessionId:  raw.activeSessionId ?? sessions[0]?.id ?? null,
    sessionStarted:   raw.sessionStarted ?? null,
    exerciseSubstitutions: raw.exerciseSubstitutions ?? {},
    exerciseOverrides: raw.exerciseOverrides ?? {},
    fatigueStatus,
    isDeloadActive:   raw.isDeloadActive ?? false,
    // cardio: transient staging field — never persisted between sessions; cleared on load
    cardio:           null,
    // Canonical progression counters (§1/§3)
    completedWorkouts,
    // Latent progression state (§21)
    progressionState: raw.progressionState ?? {},
    history,
    exercises
  };
}

/**
 * Migrate an old or null cardio object to the new binary schema (§8).
 * Old schema: { type, durationMinutes, distanceMiles, perceivedExertion }
 * New schema: { warmupDone, finisherDone, notes }
 */
function migrateCardio(cardio) {
  if (!cardio) return null;
  // Already new schema
  if ('warmupDone' in cardio || 'finisherDone' in cardio) {
    return {
      warmupDone:   cardio.warmupDone   ?? false,
      finisherDone: cardio.finisherDone ?? false,
      notes:        cardio.notes        ?? ''
    };
  }
  // Old schema — convert. We can't know if warmup was done from old data,
  // so default both to false and move any type string to notes.
  const oldNotes = cardio.type ? `Legacy: ${cardio.type}` : '';
  return { warmupDone: false, finisherDone: false, notes: oldNotes };
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
          rom: s.rom !== undefined ? s.rom : true
        }));
        while (copy.length < ex.sets) copy.push(makeSet());
        exercises[ex.id] = copy;
      })
    )
  );
  return {
    ...appState,
    exercises,
    exerciseSubstitutions: appState.exerciseSubstitutions ?? {},
    exerciseOverrides:     appState.exerciseOverrides     ?? {},
    fatigueStatus:         appState.fatigueStatus         ?? { level: 'normal', indicators: [], timestamp: 0, dismissed: false },
    isDeloadActive:        appState.isDeloadActive        ?? false,
    cardio:                null,       // always clear transient cardio on normalize
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
      if (!s || typeof s !== 'object')                        return false;
      if (!['', 'done', 'failed'].includes(s.s))             return false;
    }
  }
  if (appState.exerciseSubstitutions && typeof appState.exerciseSubstitutions !== 'object') return false;
  if (appState.exerciseOverrides     && typeof appState.exerciseOverrides     !== 'object') return false;
  if (!Array.isArray(appState.sessions))                      return false;
  if (typeof appState.sessionsPerWeek !== 'number')           return false;
  if (typeof appState.completedWorkouts !== 'number')         return false;

  // §28.6 Validation Invariant: every exercise in session templates MUST carry
  // all three §28 fields. Missing any → fail fast (no implicit defaults allowed).
  for (const session of appState.sessions) {
    for (const block of (session.blocks || [])) {
      for (const ex of (block.exercises || [])) {
        if (ex.equipmentType      === undefined ||
            ex.deltaW             === undefined ||
            ex.manualDeltaWOverride === undefined) {
          console.error(
            `[validate] §28 schema violation on exercise "${ex.id ?? ex.name}": ` +
            `missing equipmentType/deltaW/manualDeltaWOverride. Triggering repair migration.`
          );
          return false;
        }
        if (typeof ex.deltaW !== 'number' || ex.deltaW < 0) {
          console.error(`[validate] §28 schema violation on exercise "${ex.id}": deltaW must be a non-negative number.`);
          return false;
        }
      }
    }
  }

  return true;
}
