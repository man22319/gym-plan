import { DEV_MODE, REST_DURATION, makeSet, createDefaultState } from '../store/state.js';
import { workouts, EXERCISE_INDEX, state, setState } from './workouts.js';
import { query } from './queries.js';
import { resolveWeight, resolveReps } from './helpers.js';
import { startRestTimer } from './restTimer.js';
import { persist, normalize } from './persistence.js';
import { analyzeFatigueTrends } from './analytics/fatigue.js';

export const ALLOWED_ACTIONS = {
  SET_ACTIVE_SESSION:  ['sessionId'],
  TOGGLE_SET:          ['exId', 'idx'],
  LOG_AND_MARK_DONE:   ['exId', 'idx', 'weight', 'reps', 'note'],
  RESET_SESSION:       [],
  IMPORT_STATE:        ['data'],
  START_SESSION:       [],
  SUBSTITUTE_EXERCISE: ['exId', 'substitution'],
  UPDATE_EXERCISE_OVERRIDE: ['exId', 'fields'],
  IMPORT_TEMPLATE:     ['sessions', 'sessionsPerWeek'],
  IMPORT_HISTORY:      ['history'],
  FINISH_WORKOUT:      ['sessionId'],
  UPDATE_TEMPLATE:     ['sessions', 'sessionsPerWeek'],
  UPDATE_FATIGUE_STATUS: ['fatigueStatus'],
  TOGGLE_DELOAD:       []
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

  switch (type) {

    case 'SET_ACTIVE_SESSION': {
      if (currentState.activeSessionId === payload.sessionId) return currentState;
      return { ...currentState, activeSessionId: payload.sessionId };
    }

    case 'TOGGLE_SET': {
      const { exId, idx } = payload;
      const sets = [...(currentState.exercises[exId] || [])];
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
      const resolvedNote   = payload.note ?? '';

      const sets = [...(currentState.exercises[exId] || [])];
      const existing = sets[idx] || makeSet();
      sets[idx] = { ...existing, s: 'done', w: resolvedWeight, r: resolvedReps, n: resolvedNote };
      return {
        ...currentState,
        exercises: { ...currentState.exercises, [exId]: sets }
      };
    }

    case 'SUBSTITUTE_EXERCISE': {
      const { exId, substitution } = payload;
      const exerciseSubstitutions = { ...(currentState.exerciseSubstitutions || {}) };
      if (substitution === null) {
        delete exerciseSubstitutions[exId];
      } else {
        exerciseSubstitutions[exId] = substitution;
      }
      return {
        ...currentState,
        exerciseSubstitutions
      };
    }

    case 'UPDATE_EXERCISE_OVERRIDE': {
      const { exId, fields } = payload;
      const exerciseOverrides = { ...(currentState.exerciseOverrides || {}) };
      if (fields === null) {
        delete exerciseOverrides[exId];
      } else {
        const current = exerciseOverrides[exId] || {};
        const merged = { ...current };
        if (fields.weight === null) delete merged.weight;
        else if (fields.weight !== undefined) merged.weight = fields.weight;
        if (fields.reps === null) delete merged.reps;
        else if (fields.reps !== undefined) merged.reps = fields.reps;
        if (fields.notes === null) delete merged.notes;
        else if (fields.notes !== undefined) merged.notes = fields.notes;

        if (Object.keys(merged).length === 0) {
          delete exerciseOverrides[exId];
        } else {
          exerciseOverrides[exId] = merged;
        }
      }
      return {
        ...currentState,
        exerciseOverrides
      };
    }

    case 'RESET_SESSION': {
      const defaultState = createDefaultState(currentState.sessions || workouts);
      return {
        ...defaultState,
        sessionsPerWeek: currentState.sessionsPerWeek ?? 3
      };
    }

    case 'IMPORT_STATE': {
      return payload.data;
    }

    case 'IMPORT_TEMPLATE': {
      const { sessions, sessionsPerWeek } = payload;
      return normalize({
        ...currentState,
        sessions: JSON.parse(JSON.stringify(sessions)),
        sessionsPerWeek: sessionsPerWeek ?? 3,
        activeSessionId: sessions[0]?.id || null
      });
    }

    case 'UPDATE_TEMPLATE': {
      const { sessions, sessionsPerWeek } = payload;
      return normalize({
        ...currentState,
        sessions: JSON.parse(JSON.stringify(sessions)),
        sessionsPerWeek,
        activeSessionId: sessions.some(s => s.id === currentState.activeSessionId)
          ? currentState.activeSessionId
          : (sessions[0]?.id || null)
      });
    }

    case 'IMPORT_HISTORY': {
      const importedHistory = payload.history || [];
      const existingHistory = currentState.history || [];
      const merged = [...existingHistory];
      
      importedHistory.forEach(importedEntry => {
        const exists = merged.some(e => {
          if (importedEntry.entryId && e.entryId) {
            return e.entryId === importedEntry.entryId;
          }
          return e.timestamp === importedEntry.timestamp;
        });
        if (!exists) {
          const entryWithId = {
            ...importedEntry,
            entryId: importedEntry.entryId || crypto.randomUUID()
          };
          merged.push(entryWithId);
        }
      });
      
      merged.sort((a, b) => a.timestamp - b.timestamp);
      
      return {
        ...currentState,
        history: merged
      };
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
      session.blocks.flatMap(b => b.exercises).forEach(ex => {
        const sets = currentState.exercises[ex.id] || [];
        exerciseSnapshot[ex.id] = sets.map(s => ({
          ...s,
          w: s.s === 'done' || s.s === 'failed' ? resolveWeight(s.w, ex.id) : s.w,
          r: s.s === 'done' || s.s === 'failed' ? resolveReps(s.r, ex.id)   : s.r,
          n: s.n ?? ''
        }));
      });

      const now = Date.now();
      const today = new Date(now);

      const history = [...(currentState.history || [])];
      const existingIndex = history.findIndex(e => {
        if (e.sessionId !== sessionId) return false;
        const entryDate = new Date(e.timestamp);
        return entryDate.getFullYear() === today.getFullYear() &&
               entryDate.getMonth() === today.getMonth() &&
               entryDate.getDate() === today.getDate();
      });

      if (existingIndex !== -1) {
        history[existingIndex] = {
          ...history[existingIndex],
          timestamp: now,
          startTimestamp: currentState.sessionStarted ?? history[existingIndex].startTimestamp ?? null,
          exercises: exerciseSnapshot,
          isDeload: currentState.isDeloadActive === true ? true : (history[existingIndex].isDeload ?? false)
        };
      } else {
        const entry = {
          entryId: crypto.randomUUID(),
          sessionId,
          timestamp: now,
          startTimestamp: currentState.sessionStarted ?? null,
          exercises: exerciseSnapshot,
          isDeload: currentState.isDeloadActive === true
        };
        history.push(entry);
      }

      history.sort((a, b) => a.timestamp - b.timestamp);

      return {
        ...currentState,
        history,
        sessionStarted: null
      };
    }

    case 'TOGGLE_DELOAD': {
      return {
        ...currentState,
        isDeloadActive: !currentState.isDeloadActive
      };
    }

    case 'UPDATE_FATIGUE_STATUS': {
      return {
        ...currentState,
        fatigueStatus: payload.fatigueStatus
      };
    }

    default:
      throw new Error(`Unhandled action: ${type}`);
  }
}

let _renderFn = null;
let _sessionCompleteFn = null;

export function onRender(fn) { _renderFn = fn; }
export function onSessionComplete(fn) { _sessionCompleteFn = fn; }

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

    if ((type === 'TOGGLE_SET' || type === 'LOG_AND_MARK_DONE') && state.sessionStarted === null) {
      if (!query.isSessionComplete(state, state.activeSessionId)) {
        const withStart = reducer(state, { type: 'START_SESSION', payload: {} });
        setState(withStart);
      }
    }

    const prevState = state;
    let nextState = reducer(state, { type, payload });

    if (DEV_MODE) {
      console.log(`▶ ${type}`, payload);
      console.log('  state →', nextState);
    }

    setState(nextState);
    persist();
    _renderFn?.(state);

    const isDoneTransition = (() => {
      if (type === 'LOG_AND_MARK_DONE') return true;
      if (type === 'TOGGLE_SET') {
        const { exId, idx } = payload;
        const prev = (prevState.exercises[exId] || [])[idx]?.s ?? '';
        const next = (nextState.exercises[exId] || [])[idx]?.s ?? '';
        return next === 'done' && prev !== 'done';
      }
      return false;
    })();

    if (isDoneTransition) {
      let restDuration = REST_DURATION;
      if (type === 'LOG_AND_MARK_DONE' || type === 'TOGGLE_SET') {
        const { exId, idx } = payload;
        const ex = EXERCISE_INDEX[exId];
        if (ex) {
          const completedSets = (nextState.exercises[exId] || []);
          const isLastSet = idx >= ex.sets - 1;
          if (isLastSet) {
            restDuration = ex.rest_between_exercises ?? REST_DURATION;
          } else {
            restDuration = ex.rest_between_sets ?? REST_DURATION;
          }
        }
      }
      startRestTimer(restDuration);
    }

    if (type === 'FINISH_WORKOUT') {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      const sessionEntries = query.sessionHistory(nextState, payload.sessionId);
      const completedEntry = sessionEntries[sessionEntries.length - 1];
      if (completedEntry) {
        _sessionCompleteFn?.(completedEntry, nextState);
      }
    }

    const recomputeFatigue = (
      type === 'FINISH_WORKOUT' ||
      type === 'TOGGLE_DELOAD' ||
      type === 'RESET_SESSION' ||
      type === 'IMPORT_STATE' ||
      type === 'IMPORT_HISTORY'
    );

    if (recomputeFatigue) {
      // ── Fatigue pipeline ─────────────────────────────────────────────
      // Run analysis on the updated history and apply the result atomically.
      let fatigueStatus = analyzeFatigueTrends(nextState.history ?? []);
      if (nextState.isDeloadActive) {
        fatigueStatus = {
          level: 'normal',
          indicators: [],
          timestamp: Date.now(),
          debug: fatigueStatus.debug
        };
      }
      const withFatigue = reducer(nextState, {
        type: 'UPDATE_FATIGUE_STATUS',
        payload: { fatigueStatus }
      });
      setState(withFatigue);
      persist();
      _renderFn?.(state);
      // ─────────────────────────────────────────────────────────────────
    }

  } catch (err) {
    console.error(`[dispatch] ${type} rejected:`, err);
  }
}
