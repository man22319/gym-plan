import { DEV_MODE, REST_DURATION, makeSet, makeCardio, createDefaultState } from '../store/state.js';
import { workouts, EXERCISE_INDEX, state, setState } from './workouts.js';
import { query } from './queries.js';
import { resolveWeight, resolveReps } from './helpers.js';
import { startRestTimer } from './restTimer.js';
import { persist, normalize } from './persistence.js';
import { analyzeFatigueTrends } from './analytics/fatigue.js';
import { updateProgressionState } from './progression.js';

// §28.3: Default deltaW per equipmentType (used when manualDeltaWOverride = false).
// Applied on exercise creation and on equipmentType change (§28.4).
export const EQUIPMENT_DELTA_W_DEFAULTS = {
  machine:    5,
  dumbbell:   5,
  barbell:    5,
  cable:      5,
  bodyweight: 0,
  other:      2.5,
};

export const ALLOWED_ACTIONS = {
  SET_ACTIVE_SESSION:        ['sessionId'],
  TOGGLE_SET:                ['exId', 'idx'],
  LOG_AND_MARK_DONE:         ['exId', 'idx', 'weight', 'reps', 'note'],
  RESET_SESSION:             [],
  IMPORT_STATE:              ['data'],
  START_SESSION:             [],
  SUBSTITUTE_EXERCISE:       ['exId', 'substitution'],
  UPDATE_EXERCISE_OVERRIDE:  ['exId', 'fields'],
  IMPORT_TEMPLATE:           ['sessions', 'sessionsPerWeek'],
  IMPORT_HISTORY:            ['history'],
  FINISH_WORKOUT:            ['sessionId'],
  UPDATE_TEMPLATE:           ['sessions', 'sessionsPerWeek'],
  UPDATE_FATIGUE_STATUS:     ['fatigueStatus'],
  TOGGLE_DELOAD:             [],
  // Cardio — writes transient state.cardio (binary per §8); committed into history on FINISH_WORKOUT
  UPDATE_CARDIO:             ['cardio'],
  // Progression state — written after FINISH_WORKOUT pipeline
  UPDATE_PROGRESSION_STATE:  ['progressionState'],
  // UI offset — display-only shift (§19)
  SET_UI_OFFSET:             ['uiOffset'],
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
      const resolvedROM    = payload.rom !== undefined ? payload.rom : true;

      const sets    = [...(currentState.exercises[exId] || [])];
      const existing = sets[idx] || makeSet();
      sets[idx] = {
        ...existing,
        s:   'done',
        w:   resolvedWeight,
        r:   resolvedReps,
        n:   resolvedNote,
        rir: resolvedRIR,
        rom: resolvedROM
      };
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
      return { ...currentState, exerciseSubstitutions };
    }

    case 'UPDATE_EXERCISE_OVERRIDE': {
      const { exId, fields } = payload;
      const exerciseOverrides = { ...(currentState.exerciseOverrides || {}) };
      if (fields === null) {
        delete exerciseOverrides[exId];
      } else {
        const current = exerciseOverrides[exId] || {};
        const merged  = { ...current };
        if (fields.weight === null) delete merged.weight;
        else if (fields.weight !== undefined) merged.weight = fields.weight;
        if (fields.reps   === null) delete merged.reps;
        else if (fields.reps   !== undefined) merged.reps   = fields.reps;
        if (fields.notes  === null) delete merged.notes;
        else if (fields.notes  !== undefined) merged.notes  = fields.notes;

        // §28.2 / §28.4: Handle equipmentType, deltaW, manualDeltaWOverride fields.
        if (fields.manualDeltaWOverride !== undefined) merged.manualDeltaWOverride = fields.manualDeltaWOverride;
        if (fields.deltaW !== undefined)               merged.deltaW               = fields.deltaW;

        if (fields.equipmentType !== undefined) {
          merged.equipmentType = fields.equipmentType;
          // §28.4: On equipmentType change, re-init deltaW from defaults
          // ONLY when manualDeltaWOverride is false (or unset).
          const isManual = merged.manualDeltaWOverride
            ?? EXERCISE_INDEX[exId]?.manualDeltaWOverride
            ?? false;
          if (!isManual) {
            const typeDw = EQUIPMENT_DELTA_W_DEFAULTS[fields.equipmentType];
            if (typeDw !== undefined) merged.deltaW = typeDw;
            // else: unknown type — preserve existing deltaW and log mismatch
            else console.warn(`[reducer] Unknown equipmentType '${fields.equipmentType}' for ${exId}; deltaW preserved.`);
          }
          // If isManual: deltaW preserved exactly (§28.4), mismatch noted above.
        }

        if (Object.keys(merged).length === 0) {
          delete exerciseOverrides[exId];
        } else {
          exerciseOverrides[exId] = merged;
        }
      }
      return { ...currentState, exerciseOverrides };
    }

    case 'RESET_SESSION': {
      const defaultState = createDefaultState(currentState.sessions || workouts);
      return {
        ...defaultState,
        sessionsPerWeek:  currentState.sessionsPerWeek  ?? 3,
        // Preserve canonical counters + history on reset (§4)
        history:          currentState.history          ?? [],
        completedWorkouts: currentState.completedWorkouts ?? 0,
        uiOffset:         currentState.uiOffset         ?? 0,
        progressionState: currentState.progressionState ?? {}
      };
    }

    case 'IMPORT_STATE': {
      return payload.data;
    }

    case 'IMPORT_TEMPLATE': {
      const { sessions, sessionsPerWeek } = payload;
      return normalize({
        ...currentState,
        sessions:        JSON.parse(JSON.stringify(sessions)),
        sessionsPerWeek: sessionsPerWeek ?? 3,
        activeSessionId: sessions[0]?.id || null
      });
    }

    case 'UPDATE_TEMPLATE': {
      const { sessions, sessionsPerWeek } = payload;
      return normalize({
        ...currentState,
        sessions:        JSON.parse(JSON.stringify(sessions)),
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
          if (importedEntry.entryId && e.entryId) return e.entryId === importedEntry.entryId;
          return e.timestamp === importedEntry.timestamp;
        });
        if (!exists) {
          merged.push({
            ...importedEntry,
            entryId: importedEntry.entryId || crypto.randomUUID()
          });
        }
      });

      merged.sort((a, b) => a.timestamp - b.timestamp);

      // Update completedWorkouts to match new history length if import grew it
      const newCompleted = Math.max(currentState.completedWorkouts ?? 0, merged.length);

      return {
        ...currentState,
        history: merged,
        completedWorkouts: newCompleted
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
          w:   s.s === 'done' || s.s === 'failed' ? resolveWeight(s.w, ex.id) : s.w,
          r:   s.s === 'done' || s.s === 'failed' ? resolveReps(s.r, ex.id)   : s.r,
          n:   s.n ?? '',
          rir: s.rir ?? null,
          rom: s.rom !== undefined ? s.rom : true
        }));
      });

      const now   = Date.now();
      const today = new Date(now);

      const history = [...(currentState.history || [])];
      const existingIndex = history.findIndex(e => {
        if (e.sessionId !== sessionId) return false;
        const entryDate = new Date(e.timestamp);
        return entryDate.getFullYear() === today.getFullYear() &&
               entryDate.getMonth()    === today.getMonth()    &&
               entryDate.getDate()     === today.getDate();
      });

      if (existingIndex !== -1) {
        history[existingIndex] = {
          ...history[existingIndex],
          timestamp:      now,
          startTimestamp: currentState.sessionStarted ?? history[existingIndex].startTimestamp ?? null,
          exercises:      exerciseSnapshot,
          cardio:         currentState.cardio ?? history[existingIndex].cardio ?? null,
          isDeload:       currentState.isDeloadActive === true ? true : (history[existingIndex].isDeload ?? false)
        };
      } else {
        history.push({
          entryId:        crypto.randomUUID(),
          sessionId,
          timestamp:      now,
          startTimestamp: currentState.sessionStarted ?? null,
          exercises:      exerciseSnapshot,
          cardio:         currentState.cardio ?? null,
          isDeload:       currentState.isDeloadActive === true
        });
      }

      history.sort((a, b) => a.timestamp - b.timestamp);

      const nextCompleted = (currentState.completedWorkouts ?? 0) + 1;

      let nextState = {
        ...currentState,
        history,
        cardio:           null,   // clear transient cardio — committed above
        sessionStarted:   null,
        // §2/§3: increment completedWorkouts by +1 on each FINISH_WORKOUT
        completedWorkouts: nextCompleted
      };

      const spw = currentState.sessionsPerWeek ?? 3;
      if (nextCompleted > 0 && nextCompleted % spw === 0) {
        // §4: Week Completion & UI Reset
        // Trigger implicit RESET_SESSION which clears inputs but preserves canonical state
        nextState = reducer(nextState, { type: 'RESET_SESSION', payload: {} });
      }

      return nextState;
    }

    case 'TOGGLE_DELOAD': {
      return { ...currentState, isDeloadActive: !currentState.isDeloadActive };
    }

    case 'UPDATE_FATIGUE_STATUS': {
      return { ...currentState, fatigueStatus: payload.fatigueStatus };
    }

    case 'UPDATE_CARDIO': {
      // Binary schema per §8: { warmupDone, finisherDone, notes }
      // Writes to transient state.cardio; committed into history on FINISH_WORKOUT.
      return { ...currentState, cardio: { ...makeCardio(), ...payload.cardio } };
    }

    case 'UPDATE_PROGRESSION_STATE': {
      return { ...currentState, progressionState: payload.progressionState };
    }

    case 'SET_UI_OFFSET': {
      const clamped = Math.max(-100, Math.min(100, Math.round(payload.uiOffset)));
      return { ...currentState, uiOffset: clamped };
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

    const nextState = reducer(state, { type, payload });

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
        const prev = (state.exercises[payload.exId] || [])[payload.idx]?.s ?? '';
        return prev !== 'done' && (nextState.exercises[payload.exId] || [])[payload.idx]?.s === 'done';
      }
      return false;
    })();

    if (isDoneTransition) {
      let restDuration = REST_DURATION;
      const { exId, idx } = payload;
      const ex = EXERCISE_INDEX[exId];
      if (ex) {
        const isLastSet = idx >= ex.sets - 1;
        restDuration = isLastSet
          ? (ex.rest_between_exercises ?? REST_DURATION)
          : (ex.rest_between_sets      ?? REST_DURATION);
      }
      startRestTimer(restDuration);
    }

    if (type === 'FINISH_WORKOUT') {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      const sessionEntries = query.sessionHistory(nextState, payload.sessionId);
      const completedEntry = sessionEntries[sessionEntries.length - 1];
      if (completedEntry) _sessionCompleteFn?.(completedEntry, nextState);
    }

    // ── Fatigue pipeline ─────────────────────────────────────────────────────
    const recomputeFatigue = (
      type === 'FINISH_WORKOUT' ||
      type === 'TOGGLE_DELOAD'  ||
      type === 'RESET_SESSION'  ||
      type === 'IMPORT_STATE'   ||
      type === 'IMPORT_HISTORY'
    );

    if (recomputeFatigue) {
      let fatigueStatus = analyzeFatigueTrends(state.history ?? []);
      if (state.isDeloadActive) {
        fatigueStatus = { level: 'normal', indicators: [], timestamp: Date.now(), debug: fatigueStatus.debug };
      }
      const withFatigue = reducer(state, { type: 'UPDATE_FATIGUE_STATUS', payload: { fatigueStatus } });
      setState(withFatigue);
      persist();
      _renderFn?.(state);
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Progression pipeline (§21) ───────────────────────────────────────────
    // Run after FINISH_WORKOUT: update T/F/Δw for each exercise in the session.
    if (type === 'FINISH_WORKOUT') {
      const session = workouts.find(s => s.id === payload.sessionId);
      if (session) {
        const allExercises = session.blocks.flatMap(b => b.exercises);
        const newProgState = { ...(state.progressionState || {}) };
        const lastEntry = query.sessionHistory(state, payload.sessionId).slice(-1)[0];

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

        for (const ex of allExercises) {
          const sets    = lastEntry?.exercises[ex.id] || [];
          const prev    = newProgState[ex.id] || {};
          const updated = updateProgressionState(prev, sets, {
            density,
            riskMultiplier: ex.riskMultiplier ?? 1.0,
            // §28.5 HARD RULE: pass the authoritative stored deltaW from the exercise template.
            // Resolver priority: session template ex.deltaW → exerciseOverrides[].deltaW → prev.dw
            deltaW: currentState.exerciseOverrides?.[ex.id]?.deltaW ?? ex.deltaW
          });
          newProgState[ex.id] = {
            T:   updated.T,
            F:   updated.F,
            dw:  updated.dw,
            // Store last suggestion for display — not authoritative
            lastSuggested: updated.suggestedWeight,
            lastRisk:      updated.riskScore,
            lastSuppressed: updated.suppressed
          };
        }

        const withProg = reducer(state, {
          type:    'UPDATE_PROGRESSION_STATE',
          payload: { progressionState: newProgState }
        });
        setState(withProg);
        persist();
        _renderFn?.(state);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

  } catch (err) {
    console.error(`[dispatch] ${type} rejected:`, err);
  }
}
