import { DEV_MODE, REST_DURATION, makeSet, makeCardio, createDefaultState, STORAGE_KEY } from '../state/state.js';
import { workouts, EXERCISE_INDEX, state, setState, EX_SESSION_INDEX, defaultWorkoutsData } from '../state/store.js';
import { query } from './queries.js';
import { resolveWeight, resolveReps } from '../utils/helpers.js';
import { startRestTimer } from '../utils/restTimer.js';
import { persist, normalize, sanitizeSessions, loadState } from '../state/persistence.js';
import { updateProgressionState } from './progression.js';
import { expandImport } from '../../io/compactFormat.js';

export const ALLOWED_ACTIONS = {
  SET_ACTIVE_SESSION:        ['sessionId'],
  TOGGLE_SET:                ['exId', 'idx'],
  LOG_AND_MARK_DONE:         ['exId', 'idx', 'weight', 'reps', 'note'],
  RESET_SESSION:             [],
  RELOAD_IMPORTED_DATA:      [],
  FACTORY_RESET:             [],
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
      // Preserve sessionStarted — session lifecycle is independent of tab selection.
      // sessionStarted is cleared only by FINISH_WORKOUT or RESET_SESSION.
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

      sets[idx] = { ...existing, s: nextStatus, w: nextW, r: nextR, n: nextN,
                     completedAt: nextStatus === 'done' ? Date.now() : null };
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
        rom: payload.rom ?? 'full',
        completedAt: Date.now()
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

        if (fields.deltaW !== undefined) merged.deltaW = fields.deltaW;

        if (fields.equipmentType !== undefined) {
          merged.equipmentType = fields.equipmentType;
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
      const imported = sanitizeSessions(normalize({
        ...payload.data,
        sessionsPerWeek: payload.data.sessionsPerWeek ?? 3,
        activeSessionId: payload.data.activeSessionId ?? payload.data.sessions?.[0]?.id ?? null,
      }));
      return rebuildAllProgressions(imported);
    }

    case 'RELOAD_IMPORTED_DATA': {
      // Pull the most recent backup slot from localStorage (primary → backup → lkg)
      const KEYS = {
        primary: STORAGE_KEY,
        backup:  STORAGE_KEY + '_bk',
        lkg:     STORAGE_KEY + '_lkg'
      };
      let reloaded = null;
      for (const key of [KEYS.backup, KEYS.lkg, KEYS.primary]) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = expandImport(JSON.parse(raw));
          if (parsed && Array.isArray(parsed.history) && Array.isArray(parsed.sessions)) {
            reloaded = parsed;
            break;
          }
        } catch (_) {}
      }
      if (!reloaded) {
        alert('No importable backup found in storage. Use "Import Data" to load a file first.');
        return currentState;
      }
      const msg2 = `Data reloaded — ${(reloaded.history || []).length} session record(s) restored.`;
      console.log('[RELOAD_IMPORTED_DATA]', msg2);
      alert(msg2);
      return rebuildAllProgressions(reloaded);
    }

    case 'FACTORY_RESET': {
      // Wipe all localStorage slots then return a clean default state
      const FKEYS = [STORAGE_KEY, STORAGE_KEY + '_bk', STORAGE_KEY + '_lkg'];
      FKEYS.forEach(k => localStorage.removeItem(k));
      console.log('[FACTORY_RESET] All storage cleared.');
      return createDefaultState(defaultWorkoutsData ?? { sessions: workouts });
    }

    case 'UPDATE_TEMPLATE': {
      const { sessions, sessionsPerWeek, exerciseLibrary: newLib } = payload;
      const updatedLib = newLib ? JSON.parse(JSON.stringify(newLib)) : { ...currentState.exerciseLibrary };
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
      return { ...currentState, sessionStarted: Date.now(), cardio: currentState.cardio ?? null };
    }

    case 'FINISH_WORKOUT': {
      const { sessionId } = payload;
      const session = workouts.find(s => s.id === sessionId);
      if (!session) return currentState;

      const exerciseSnapshot = {};
      const exerciseRefs     = {};
      let lastSetTs = 0; // track the latest completedAt across all exercises

      session.blocks.flatMap(b => b.exercises).forEach(inst => {
        // instanceId is the key; exerciseRef recorded for cross-session queries
        const instanceId = inst.instanceId;
        const sets = currentState.exercises[instanceId] || [];
        exerciseSnapshot[instanceId] = sets.map(s => {
          if (s.completedAt && s.completedAt > lastSetTs) lastSetTs = s.completedAt;
          return {
            ...s,
            w:   s.s === 'done' || s.s === 'failed' ? resolveWeight(s.w, instanceId) : s.w,
            r:   s.s === 'done' || s.s === 'failed' ? resolveReps(s.r, instanceId)   : s.r,
            n:   s.n ?? '',
            rir: s.rir ?? null,
            rom: s.rom ?? 'full'
          };
        });
        exerciseRefs[instanceId] = inst.exerciseRef;
      });

      const now = Date.now();

      // Derive startTimestamp robustly: persisted sessionStarted, or earliest
      // completedAt across all exercises (handles corrupted/missing sessionStarted)
      let startTs = currentState.sessionStarted;
      if (!startTs) {
        let earliest = Infinity;
        for (const sets of Object.values(exerciseSnapshot)) {
          for (const s of sets) {
            if (s.completedAt && s.completedAt < earliest) earliest = s.completedAt;
          }
        }
        startTs = earliest === Infinity ? null : earliest;
      }

      const history = [...(currentState.history || [])];
      history.push({
        entryId:          crypto.randomUUID(),
        sessionId,
        timestamp:        now,
        startTimestamp:   startTs,
        lastSetTimestamp: lastSetTs || null,  // latest completedAt for accurate workout duration
        exercises:        exerciseSnapshot,
        exerciseRefs,     // enables cross-session exerciseRef queries
        cardio:           currentState.cardio ?? null
      });
      history.sort((a, b) => a.timestamp - b.timestamp);

      const nextCompleted = (currentState.completedWorkouts ?? 0) + 1;

      let nextState = {
        ...currentState,
        exercises:         {},   // clear live scratch pad — data is now in history
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
let _patchRenderFn = null;
let _cardioRenderFn = null;
let _sessionCompleteFn = null;
let _startWorkoutModalFn = null;

export function onRender(fn) { _renderFn = fn; }
export function onPatchRender(fn) { _patchRenderFn = fn; }
export function onCardioRender(fn) { _cardioRenderFn = fn; }
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
      // Auto-resume: if sets have already been completed in this session,
      // recover sessionStarted from the earliest completedAt instead of
      // prompting the user again. This handles corrupted/lost state.
      const activeSession = workouts.find(s => s.id === state.activeSessionId);
      if (activeSession) {
        let earliestTs = Infinity;
        for (const block of activeSession.blocks) {
          for (const inst of block.exercises) {
            for (const s of (state.exercises[inst.instanceId] || [])) {
              if (s.completedAt && s.completedAt < earliestTs) earliestTs = s.completedAt;
            }
          }
        }
        if (earliestTs !== Infinity) {
          // Silently restore session — user already has work in progress
          const restored = { ...state, sessionStarted: earliestTs };
          setState(restored);
          persist();
          // Continue with the original action — no modal needed
        } else if (_startWorkoutModalFn) {
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
      } else if (_startWorkoutModalFn) {
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

    // Use targeted patch for set-level actions; full render for everything else.
    const isSetAction = type === 'TOGGLE_SET' || type === 'LOG_AND_MARK_DONE';
    if (isSetAction && _patchRenderFn) {
      _patchRenderFn(state, payload.exId);
    } else if (type === 'UPDATE_CARDIO' && _cardioRenderFn) {
      _cardioRenderFn(state);
    } else {
      _renderFn?.(state);
    }

    // Import: persist the imported state, then reload from storage (identical to
    // page refresh) so all caches, indexes, and session arrays are rebuilt cleanly.
    if (type === 'IMPORT_STATE') {
      const count = (nextState.history || []).length;
      // loadState() re-reads from localStorage and calls setState + rebuildIndexes,
      // matching the exact boot path. This fixes stale DUE/DONE labels.
      loadState();
      _renderFn?.(state);
      // Double-rAF ensures the browser has painted the new DOM before the blocking alert
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          alert(`Import complete — ${count} session record${count !== 1 ? 's' : ''} loaded.`);
        });
      });
    }

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
      // Detect cycle boundary BEFORE the reset fires (nextCompleted is pre-reset state's count)
      const completedCount = nextState.completedWorkouts ?? 0;
      const spwCheck = nextState.sessionsPerWeek ?? 3;
      // After FINISH_WORKOUT, if the cycle reset fired, completedCount % spwCheck === 0
      // We read from the nextState BEFORE the nested RESET_SESSION call to capture the boundary
      const isCycleComplete = completedCount > 0 && completedCount % spwCheck === 0;
      if (completedEntry) _sessionCompleteFn?.(completedEntry, nextState, isCycleComplete);
      persist();
      _renderFn?.(state);
    }

    // ── Progression pipeline ───────────────────────────────────────────────
    if (type === 'FINISH_WORKOUT') {
      const session = workouts.find(s => s.id === payload.sessionId);
      if (session) {
        const allExercises = session.blocks.flatMap(b => b.exercises);
        const newProgState = { ...(nextState.progressionState || {}) };
        const lastEntry = query.sessionHistory(nextState, payload.sessionId).slice(-1)[0];
        const currentTimestamp = lastEntry?.timestamp ?? Date.now();

        for (const inst of allExercises) {
          if (inst.invariant) continue;
          const instanceId = inst.instanceId;
          const ex   = EXERCISE_INDEX[instanceId] ?? inst;
          const sets = lastEntry?.exercises[instanceId] || [];
          const prev = newProgState[instanceId] || {};

          // Rep range from exercise definition
          const repRange = {
            min: ex.reps?.min ?? ex.reps ?? 8,
            max: ex.reps?.max ?? ex.reps?.min ?? ex.reps ?? 8,
          };

          // Prescribed rest between sets (seconds) for rest-influence detection
          const prescribedRestSec = ex.restBetweenSets ?? REST_DURATION;

          const updated = updateProgressionState(prev, sets, {
            repRange,
            deltaW: nextState.runtimeOverrides?.[instanceId]?.deltaW ?? ex.deltaW,
            prescribedRestSec,
          });
          newProgState[instanceId] = {
            currentWeight:         updated.currentWeight,
            consecutiveQualifying: updated.consecutiveQualifying,
            recentOutcomes:        updated.recentOutcomes,
            dw:                    updated.dw,
            lastSuggested:         updated.suggestedWeight,
            lastDecision:          updated.decision,
            lastClassification:    updated.sessionClassification,
            lastSessionTimestamp:  currentTimestamp,
            lastTopWeight:         updated.topWeight ?? null,
            restInfluenced:        updated.restInfluenced,
            outcomeDistribution:   updated.outcomeDistribution,
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
    const currentTimestamp = entry.timestamp;

    for (const inst of allExercises) {
      if (inst.invariant) continue;
      const instanceId = inst.instanceId;
      const ex   = EXERCISE_INDEX[instanceId] ?? inst;
      const sets = entry.exercises[instanceId] || [];
      const prev = newProgState[instanceId] || {};

      // Rep range from exercise definition
      const repRange = {
        min: ex.reps?.min ?? ex.reps ?? 8,
        max: ex.reps?.max ?? ex.reps?.min ?? ex.reps ?? 8,
      };

      // Prescribed rest between sets (seconds)
      const prescribedRestSec = ex.restBetweenSets ?? REST_DURATION;

      const updated = updateProgressionState(prev, sets, {
        repRange,
        deltaW: appState.runtimeOverrides?.[instanceId]?.deltaW ?? ex.deltaW,
        prescribedRestSec,
      });
      newProgState[instanceId] = {
        currentWeight:         updated.currentWeight,
        consecutiveQualifying: updated.consecutiveQualifying,
        recentOutcomes:        updated.recentOutcomes,
        dw:                    updated.dw,
        lastSuggested:         updated.suggestedWeight,
        lastDecision:          updated.decision,
        lastClassification:    updated.sessionClassification,
        lastSessionTimestamp:  currentTimestamp,
        lastTopWeight:         updated.topWeight ?? null,
        restInfluenced:        updated.restInfluenced,
        outcomeDistribution:   updated.outcomeDistribution,
      };
    }
  }

  return { ...appState, progressionState: newProgState };
}
