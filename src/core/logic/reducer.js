import { DEV_MODE, REST_DURATION, makeSet, makeCardio, createDefaultState, EQUIPMENT_DELTA_W_DEFAULTS } from '../state/state.js';
import { workouts, EXERCISE_INDEX, state, setState, EX_SESSION_INDEX, defaultWorkoutsData } from '../state/store.js';
import { query } from './queries.js';
import { resolveWeight, resolveReps } from '../utils/helpers.js';
import { startRestTimer } from '../utils/restTimer.js';
import { persist, normalize, sanitizeSessions } from '../state/persistence.js';
import { updateProgressionState } from './progression.js';

export const ALLOWED_ACTIONS = {
  SET_ACTIVE_SESSION:        ['sessionId'],
  TOGGLE_SET:                ['exId', 'idx'],
  LOG_AND_MARK_DONE:         ['exId', 'idx', 'weight', 'reps', 'note'],
  RESET_SESSION:             [],
  IMPORT_STATE:              ['data'],
  START_SESSION:             [],
  UPDATE_EXERCISE_OVERRIDE:  ['exId', 'fields'],
  UPDATE_TEMPLATE:           ['sessions', 'sessionsPerWeek'],  // exerciseLibrary is optional
  FINISH_WORKOUT:            ['sessionId'],
  UPDATE_CARDIO:             ['cardio'],
  UPDATE_PROGRESSION_STATE:  ['progressionState'],
};

export function validateAction(type, payload) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_ACTIONS, type))
    throw new Error(`Unknown action: ${type}`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error(`Payload must be a plain object for action: ${type}`);
  for (const key of ALLOWED_ACTIONS[type]) {
    if (!(key in payload)) throw new Error(`Missing "${key}" in payload for ${type}`);
  }
}

export function cycleStatus(s) {
  if (s === '')       return 'done';
  if (s === 'done')   return 'failed';
  return '';
}

export function reducer(currentState, action) {
  const { type, payload } = action;

  // Guard against modifying a session that is already finished in the current week
  if (type === 'TOGGLE_SET' || type === 'LOG_AND_MARK_DONE' || type === 'UPDATE_EXERCISE_OVERRIDE') {
    const { exId } = payload;
    const sessionId = EX_SESSION_INDEX[exId];
    if (sessionId && query.isSessionFinishedInCurrentWeek(currentState, sessionId)) {
      console.warn(`[reducer] Rejected ${type} on ${exId} — session already finished.`);
      return currentState;
    }
  }

  if (type === 'UPDATE_CARDIO') {
    if (currentState.activeSessionId && query.isSessionFinishedInCurrentWeek(currentState, currentState.activeSessionId)) {
      console.warn(`[reducer] Rejected UPDATE_CARDIO — session already finished.`);
      return currentState;
    }
  }

  if (type === 'FINISH_WORKOUT') {
    const { sessionId } = payload;
    if (sessionId && query.isSessionFinishedInCurrentWeek(currentState, sessionId)) {
      console.warn(`[reducer] Rejected FINISH_WORKOUT — session already finished.`);
      return currentState;
    }
  }

  switch (type) {

    case 'SET_ACTIVE_SESSION': {
      if (currentState.activeSessionId === payload.sessionId) return currentState;
      return { ...currentState, activeSessionId: payload.sessionId, sessionStarted: null };
    }

    case 'TOGGLE_SET': {
      const { exId, idx } = payload;
      const sets    = [...(currentState.exercises[exId] || [])];
      const existing = sets[idx] || makeSet();
      const nextStatus = cycleStatus(existing.s);

      let nextW = existing.w;
      let nextR = existing.r;
      let nextN = existing.n ?? '';
      if (nextStatus === 'done') {
        nextW = resolveWeight(existing.w, exId);
        nextR = resolveReps(existing.r, exId);
      } else if (nextStatus === '') {
        nextW = null;
        nextR = null;
        nextN = '';
      }

      sets[idx] = { ...existing, s: nextStatus, w: nextW, r: nextR, n: nextN };
      return {
        ...currentState,
        exercises: { ...currentState.exercises, [exId]: sets }
      };
    }

    case 'LOG_AND_MARK_DONE': {
      const { exId, idx } = payload;

      const resolvedWeight = resolveWeight(payload.weight, exId);
      const resolvedReps   = resolveReps(payload.reps, exId);
      const resolvedNote   = payload.note  ?? '';
      const resolvedRIR    = (payload.rir !== undefined && payload.rir !== null && payload.rir >= 0)
                               ? payload.rir : null;

      const sets    = [...(currentState.exercises[exId] || [])];
      const existing = sets[idx] || makeSet();
      sets[idx] = {
        ...existing,
        s:   'done',
        w:   resolvedWeight,
        r:   resolvedReps,
        n:   resolvedNote,
        rir: resolvedRIR,
        rom: 'full'
      };
      return {
        ...currentState,
        exercises: { ...currentState.exercises, [exId]: sets }
      };
    }

    case 'UPDATE_EXERCISE_OVERRIDE': {
      const { exId, fields } = payload;
      const runtimeOverrides = { ...(currentState.runtimeOverrides || {}) };
      if (fields === null) {
        delete runtimeOverrides[exId];
      } else {
        const current = runtimeOverrides[exId] || {};
        const merged  = { ...current };
        // UI passes fields.weight; stored as .load to match library field name
        if (fields.weight === null) delete merged.load;
        else if (fields.weight !== undefined) merged.load = fields.weight;
        if (fields.reps   === null) delete merged.reps;
        else if (fields.reps   !== undefined) merged.reps   = fields.reps;
        if (fields.notes  === null) delete merged.notes;
        else if (fields.notes  !== undefined) merged.notes  = fields.notes;

        if (fields.manualDeltaWOverride !== undefined) merged.manualDeltaWOverride = fields.manualDeltaWOverride;
        if (fields.deltaW !== undefined)               merged.deltaW               = fields.deltaW;

        if (fields.equipmentType !== undefined) {
          merged.equipmentType = fields.equipmentType;
          const isManual = merged.manualDeltaWOverride
            ?? EXERCISE_INDEX[exId]?.manualDeltaWOverride
            ?? false;
          if (!isManual) {
            const typeDw = EQUIPMENT_DELTA_W_DEFAULTS[fields.equipmentType];
            if (typeDw !== undefined) merged.deltaW = typeDw;
            else console.warn(`[reducer] Unknown equipmentType '${fields.equipmentType}' for ${exId}; deltaW preserved.`);
          }
        }

        if (Object.keys(merged).length === 0) {
          delete runtimeOverrides[exId];
        } else {
          runtimeOverrides[exId] = merged;
        }
      }
      return { ...currentState, runtimeOverrides };
    }

    case 'RESET_SESSION': {
      const defaultState = createDefaultState(defaultWorkoutsData ?? { sessions: workouts });
      return {
        ...defaultState,
        exerciseLibrary:   currentState.exerciseLibrary  ?? defaultState.exerciseLibrary,
        programDefaults:   currentState.programDefaults  ?? defaultState.programDefaults,
        sessions:          currentState.sessions         ?? defaultState.sessions,
        sessionsPerWeek:   currentState.sessionsPerWeek  ?? 3,
        history:           currentState.history          ?? [],
        completedWorkouts: currentState.completedWorkouts ?? 0,
        progressionState:  currentState.progressionState ?? {},
      };
    }

    case 'IMPORT_STATE': {
      const count = (payload.data.history || []).length;
      const msg = `Import complete — ${count} session record${count !== 1 ? 's' : ''} loaded.`;
      console.log(msg);
      alert(msg);
      return rebuildAllProgressions(payload.data);
    }

    case 'UPDATE_TEMPLATE': {
      const { sessions, sessionsPerWeek, exerciseLibrary: newLib } = payload;
      const updatedLib = newLib ? JSON.parse(JSON.stringify(newLib)) : currentState.exerciseLibrary;
      const updated = sanitizeSessions(normalize({
        ...currentState,
        sessions:        JSON.parse(JSON.stringify(sessions)),
        exerciseLibrary: updatedLib,
        sessionsPerWeek,
        activeSessionId: sessions.some(s => s.id === currentState.activeSessionId)
          ? currentState.activeSessionId
          : (sessions[0]?.id || null)
      }));
      return updated;
    }

    case 'START_SESSION': {
      if (currentState.sessionStarted !== null) return currentState;
      return { ...currentState, sessionStarted: Date.now() };
    }

    case 'FINISH_WORKOUT': {
      const { sessionId } = payload;
      const session = workouts.find(s => s.id === sessionId);
      if (!session) return currentState;

      const exerciseSnapshot = {};
      const exerciseRefs     = {};
      session.blocks.flatMap(b => b.exercises).forEach(inst => {
        // instanceId is the key; exerciseRef recorded for cross-session queries
        const instanceId = inst.instanceId;
        const sets = currentState.exercises[instanceId] || [];
        exerciseSnapshot[instanceId] = sets.map(s => ({
          ...s,
          w:   s.s === 'done' || s.s === 'failed' ? resolveWeight(s.w, instanceId) : s.w,
          r:   s.s === 'done' || s.s === 'failed' ? resolveReps(s.r, instanceId)   : s.r,
          n:   s.n ?? '',
          rir: s.rir ?? null,
          rom: s.rom ?? 'full'
        }));
        exerciseRefs[instanceId] = inst.exerciseRef;
      });

      const now = Date.now();
      const history = [...(currentState.history || [])];
      history.push({
        entryId:        crypto.randomUUID(),
        sessionId,
        timestamp:      now,
        startTimestamp: currentState.sessionStarted ?? null,
        exercises:      exerciseSnapshot,
        exerciseRefs,   // enables cross-session exerciseRef queries
        cardio:         currentState.cardio ?? null
      });
      history.sort((a, b) => a.timestamp - b.timestamp);

      const nextCompleted = (currentState.completedWorkouts ?? 0) + 1;

      let nextState = {
        ...currentState,
        history,
        cardio:            null,
        sessionStarted:    null,
        completedWorkouts: nextCompleted
      };

      const spw = currentState.sessionsPerWeek ?? 3;
      if (nextCompleted > 0 && nextCompleted % spw === 0) {
        nextState = reducer(nextState, { type: 'RESET_SESSION', payload: {} });
      }

      return nextState;
    }

    case 'UPDATE_CARDIO': {
      return { ...currentState, cardio: { ...makeCardio(), ...payload.cardio } };
    }

    case 'UPDATE_PROGRESSION_STATE': {
      return { ...currentState, progressionState: payload.progressionState };
    }

    default:
      throw new Error(`Unhandled action: ${type}`);
  }
}

let _renderFn = null;
let _sessionCompleteFn = null;
let _startWorkoutModalFn = null;

export function onRender(fn) { _renderFn = fn; }
export function onSessionComplete(fn) { _sessionCompleteFn = fn; }
export function registerStartWorkoutModal(fn) { _startWorkoutModalFn = fn; }

let lastTap = { key: '', ts: 0 };

export function dispatch(type, payload = {}) {
  try {
    validateAction(type, payload);

    if (type === 'TOGGLE_SET') {
      const key = `${payload.exId}:${payload.idx}`;
      const now = Date.now();
      if (lastTap.key === key && now - lastTap.ts < 300) return;
      lastTap = { key, ts: now };
    }

    const isWorkoutInteraction = type === 'TOGGLE_SET' || type === 'LOG_AND_MARK_DONE' || type === 'UPDATE_CARDIO';
    if (isWorkoutInteraction && state.sessionStarted === null) {
      if (_startWorkoutModalFn) {
        _startWorkoutModalFn(() => {
          const withStart = reducer(state, { type: 'START_SESSION', payload: {} });
          setState(withStart);
          persist();
          dispatch(type, payload);
        }, () => {
          _renderFn?.(state);
        });
        return;
      }
    }

    const isDoneTransition = (() => {
      if (type === 'LOG_AND_MARK_DONE') return true;
      if (type === 'TOGGLE_SET') {
        const prev = (state.exercises[payload.exId] || [])[payload.idx]?.s ?? '';
        const tempNextState = reducer(state, { type, payload });
        return prev !== 'done' && (tempNextState.exercises[payload.exId] || [])[payload.idx]?.s === 'done';
      }
      return false;
    })();

    let nextState = reducer(state, { type, payload });

    if (DEV_MODE) {
      console.log(`▶ ${type}`, payload);
      console.log('  state →', nextState);
    }

    setState(nextState);
    persist();
    _renderFn?.(state);

    if (isDoneTransition) {
      let restDuration = REST_DURATION;
      const { exId, idx } = payload;
      const ex = EXERCISE_INDEX[exId];
      if (ex) {
        const isLastSet = idx >= ex.sets - 1;
        // camelCase fields only (restBetweenSets / restBetweenExercises) from resolved exercise
        restDuration = isLastSet
          ? (ex.restBetweenExercises ?? REST_DURATION)
          : (ex.restBetweenSets      ?? REST_DURATION);
      }
      startRestTimer(restDuration);
    }

    if (type === 'FINISH_WORKOUT') {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      const sessionEntries = query.sessionHistory(nextState, payload.sessionId);
      const completedEntry = sessionEntries[sessionEntries.length - 1];
      if (completedEntry) _sessionCompleteFn?.(completedEntry, nextState);
      persist();
      _renderFn?.(state);
    }

    // ── Progression pipeline (§21) ───────────────────────────────────────────
    if (type === 'FINISH_WORKOUT') {
      const session = workouts.find(s => s.id === payload.sessionId);
      if (session) {
        const allExercises = session.blocks.flatMap(b => b.exercises);
        const newProgState = { ...(nextState.progressionState || {}) };
        const lastEntry = query.sessionHistory(nextState, payload.sessionId).slice(-1)[0];

        const durationMs = (lastEntry && lastEntry.startTimestamp) ? lastEntry.timestamp - lastEntry.startTimestamp : 0;
        const durationMin = durationMs > 0 ? durationMs / 60000 : null;

        let sessionVolume = 0;
        if (lastEntry && lastEntry.exercises) {
          Object.values(lastEntry.exercises).forEach(sets => {
            sets.forEach(s => {
              if (s.s === 'done' && s.w !== null && s.r !== null) sessionVolume += s.w * s.r;
            });
          });
        }
        const density = durationMin ? sessionVolume / durationMin : null;

        for (const inst of allExercises) {
          if (inst.invariant) continue;
          const instanceId = inst.instanceId;
          const ex   = EXERCISE_INDEX[instanceId] ?? inst;
          const sets = lastEntry?.exercises[instanceId] || [];
          const prev = newProgState[instanceId] || {};
          const updated = updateProgressionState(prev, sets, {
            density,
            riskMultiplier: ex.riskMultiplier ?? 1.0,
            deltaW: nextState.runtimeOverrides?.[instanceId]?.deltaW ?? ex.deltaW
          });
          newProgState[instanceId] = {
            T:   updated.T,
            F:   updated.F,
            dw:  updated.dw,
            lastSuggested:  updated.suggestedWeight,
            lastRisk:       updated.riskScore,
            lastSuppressed: updated.suppressed
          };
        }

        nextState = reducer(nextState, {
          type:    'UPDATE_PROGRESSION_STATE',
          payload: { progressionState: newProgState }
        });
        setState(nextState);
        persist();
        _renderFn?.(state);
      }
    }

  } catch (err) {
    console.error(`[dispatch] ${type} rejected:`, err);
  }
}

export function rebuildAllProgressions(appState) {
  if (!appState.history || appState.history.length === 0) return appState;

  const history = [...appState.history].sort((a, b) => a.timestamp - b.timestamp);
  let newProgState = {};

  for (const entry of history) {
    const session = (appState.sessions || []).find(s => s.id === entry.sessionId)
      ?? workouts.find(s => s.id === entry.sessionId);
    if (!session) continue;

    const allExercises = session.blocks.flatMap(b => b.exercises);

    const durationMs  = entry.startTimestamp ? entry.timestamp - entry.startTimestamp : 0;
    const durationMin = durationMs > 0 ? durationMs / 60000 : null;

    let sessionVolume = 0;
    if (entry.exercises) {
      Object.values(entry.exercises).forEach(sets => {
        sets.forEach(s => {
          if (s.s === 'done' && s.w !== null && s.r !== null) sessionVolume += s.w * s.r;
        });
      });
    }
    const density = durationMin ? sessionVolume / durationMin : null;

    for (const inst of allExercises) {
      if (inst.invariant) continue;
      const instanceId = inst.instanceId;
      const ex   = EXERCISE_INDEX[instanceId] ?? inst;
      const sets = entry.exercises[instanceId] || [];
      const prev = newProgState[instanceId] || {};
      const updated = updateProgressionState(prev, sets, {
        density,
        riskMultiplier: ex.riskMultiplier ?? 1.0,
        deltaW: appState.runtimeOverrides?.[instanceId]?.deltaW ?? ex.deltaW
      });
      newProgState[instanceId] = {
        T:   updated.T,
        F:   updated.F,
        dw:  updated.dw,
        lastSuggested:  updated.suggestedWeight,
        lastRisk:       updated.riskScore,
        lastSuppressed: updated.suppressed
      };
    }
  }

  return { ...appState, progressionState: newProgState };
}
