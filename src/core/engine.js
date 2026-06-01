import {
  STORAGE_KEY, REST_DURATION, MAX_REST_DURATION, STATE_VERSION, DEV_MODE,
  makeSet, makeDefaultExercises, createDefaultState
} from '../store/state.js';

// ==========================================
// ─── RUNTIME SINGLETONS ───
// ==========================================

// Workout data — populated at boot via initWorkouts(data). workouts.json stays as JSON.
export let workouts = [];
export let EXERCISE_INDEX = {};
export let EX_SESSION_INDEX = {};

/**
 * Called once at boot with the parsed workouts.json array.
 * Builds O(1) lookup indexes — no DOM access, no async.
 */
export function initWorkouts(data) {
  workouts = data;
  EXERCISE_INDEX = Object.fromEntries(
    data.flatMap(s => s.blocks.flatMap(b => b.exercises)).map(ex => [ex.id, ex])
  );
  EX_SESSION_INDEX = Object.fromEntries(
    data.flatMap(s => s.blocks.flatMap(b => b.exercises.map(ex => [ex.id, s.id])))
  );
}

export let state = null;
export let restTimerId = null;
let restRemaining = 0;
let restDuration = 0;

// ==========================================
// ─── QUERY LAYER (pure functions, no side effects) ───
// ==========================================

export const query = {
  // All history entries, guaranteed chronological (newest last).
  chronological(appState) {
    return [...(appState.history || [])].sort((a, b) => a.timestamp - b.timestamp);
  },

  // Last N completed sessions for a given sessionId.
  sessionHistory(appState, sessionId, n = Infinity) {
    return this.chronological(appState)
      .filter(e => e.sessionId === sessionId)
      .slice(-n);
  },

  // The single most recent completed entry for a sessionId.
  lastSession(appState, sessionId) {
    const hist = this.sessionHistory(appState, sessionId, 1);
    return hist.length ? hist[0] : null;
  },

  // Last completed sets for a specific exercise.
  // Returns Set[] or null.
  lastExerciseSets(appState, exId) {
    const sessionId = EX_SESSION_INDEX[exId];
    const entry = this.lastSession(appState, sessionId);
    if (!entry) return null;
    return entry.exercises[exId] || null;
  },

  // Last N entries for an exercise (for trend analysis).
  exerciseHistory(appState, exId, n = Infinity) {
    const sessionId = EX_SESSION_INDEX[exId];
    return this.sessionHistory(appState, sessionId, n).map(e => ({
      timestamp: e.timestamp,
      sets: e.exercises[exId] || []
    }));
  },

  // Derived: last completed timestamp for a session (from history, not lastDone).
  lastDoneTimestamp(appState, sessionId) {
    const entry = this.lastSession(appState, sessionId);
    return entry ? entry.timestamp : null;
  },

  // Derived: is the current working session complete?
  // Depends ONLY on state.exercises — never on history.
  isSessionComplete(appState, sessionId) {
    const session = workouts.find(s => s.id === sessionId);
    if (!session) return false;
    const allEx = session.blocks.flatMap(b => b.exercises);
    if (!allEx.length) return false;
    return allEx.every(ex => {
      const sets = appState.exercises[ex.id] || [];
      return sets.length > 0 && sets.every(s => s.s === 'done' || s.s === 'failed');
    });
  },

  isExerciseComplete(appState, exId) {
    const sets = appState.exercises[exId] || [];
    return sets.length > 0 && sets.every(s => s.s === 'done' || s.s === 'failed');
  },

  sessionProgress(appState, sessionId) {
    const session = workouts.find(s => s.id === sessionId);
    if (!session) return 0;
    const allEx = session.blocks.flatMap(b => b.exercises);
    const total = allEx.reduce((n, ex) => n + ex.sets, 0);
    if (!total) return 0;
    const resolved = allEx.reduce((n, ex) => {
      const sets = appState.exercises[ex.id] || [];
      return n + sets.filter(s => s.s === 'done' || s.s === 'failed').length;
    }, 0);
    return Math.round((resolved / total) * 100);
  },

  // ── Derived metrics (NEVER persisted) ──

  // Volume for a set array: Σ(w × r) — skips null/failed
  setVolume(sets) {
    return sets.reduce((sum, s) => {
      if (s.w !== null && s.r !== null && s.s !== 'failed') {
        return sum + s.w * s.r;
      }
      return sum;
    }, 0);
  },

  // Compare two Set[] arrays: returns { weightDelta, repsDelta } using avg of logged sets
  compareSets(prev, curr) {
    const avgW = arr => {
      const logged = arr.filter(s => s.w !== null);
      return logged.length ? logged.reduce((n, s) => n + s.w, 0) / logged.length : null;
    };
    const avgR = arr => {
      const logged = arr.filter(s => s.r !== null);
      return logged.length ? logged.reduce((n, s) => n + s.r, 0) / logged.length : null;
    };
    const prevW = avgW(prev), currW = avgW(curr);
    const prevR = avgR(prev), currR = avgR(curr);
    return {
      weightDelta: (prevW !== null && currW !== null) ? +(currW - prevW).toFixed(1) : null,
      repsDelta:   (prevR !== null && currR !== null) ? +(currR - prevR).toFixed(1) : null
    };
  },

  // ── A: Progression recommendation ──
  // Examines the last 1–2 logged sessions for exId.
  // Returns { action: 'increase'|'maintain'|'reduce'|'watch', suggestedWeight, label } or null.
  progressionRecommendation(appState, exId) {
    const history = this.exerciseHistory(appState, exId, 2);
    if (!history.length) return null;

    const lastEntry = history[history.length - 1];
    const prevEntry = history.length >= 2 ? history[history.length - 2] : null;
    const sets = lastEntry.sets;
    if (!sets || !sets.length) return null;

    const ex = EXERCISE_INDEX[exId];
    const doneSets = sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    if (!doneSets.length) return null;

    const failedSets = sets.filter(s => s.s === 'failed');
    const totalSets = sets.length;
    const repMax = ex?.reps ? (('max' in ex.reps) ? ex.reps.max : (ex.reps.fixed ?? ex.reps.value ?? null)) : null;
    const repMin = ex?.reps ? (('min' in ex.reps) ? ex.reps.min : (ex.reps.fixed ?? ex.reps.value ?? null)) : null;
    const avgW = doneSets.reduce((n, s) => n + s.w, 0) / doneSets.length;
    const reduction = avgW >= 50 ? 5 : 2.5;
    const increment = avgW >= 50 ? 5 : 2.5;

    // ≥25% failed sets → reduce
    if (failedSets.length > 0 && (failedSets.length / totalSets) >= 0.25) {
      const suggestedWeight = Math.max(0, +(avgW - reduction).toFixed(1));
      return { action: 'reduce', suggestedWeight, label: `↓ Reduce to ${suggestedWeight} lbs` };
    }

    // All done sets hit repMax → increase
    const allAtTop = repMax !== null && doneSets.every(s => s.r >= repMax);
    if (allAtTop) {
      const suggestedWeight = +(avgW + increment).toFixed(1);
      return { action: 'increase', suggestedWeight, label: `✓ Increase to ${suggestedWeight} lbs` };
    }

    // Below rep min: check consecutive sessions
    const anyBelowMin = repMin !== null && doneSets.some(s => s.r < repMin);
    if (anyBelowMin) {
      // Check if previous session was also below min
      let prevAlsoBelowMin = false;
      if (prevEntry && prevEntry.sets) {
        const prevDone = prevEntry.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
        prevAlsoBelowMin = repMin !== null && prevDone.length > 0 && prevDone.some(s => s.r < repMin);
      }

      if (prevAlsoBelowMin) {
        // 2 consecutive sessions below min → reduce
        const suggestedWeight = Math.max(0, +(avgW - reduction).toFixed(1));
        return { action: 'reduce', suggestedWeight, label: `↓ Reduce to ${suggestedWeight} lbs` };
      } else {
        // Single session below min → watch
        return { action: 'watch', suggestedWeight: avgW, label: `⚠ Watch — below range` };
      }
    }

    // Within range → maintain
    return { action: 'maintain', suggestedWeight: avgW, label: `→ Maintain ${avgW} lbs` };
  },

  // ── D: Personal Records ──
  // Returns { heaviestSet, highestVolume, mostReps } for an exercise across all history.
  // Each record: { w, r, date (timestamp), volume }
  personalRecords(appState, exId) {
    const history = this.exerciseHistory(appState, exId);
    let heaviestSet = null;
    let highestVolume = null;
    let mostReps = null;

    for (const entry of history) {
      const doneSets = entry.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
      const volume = doneSets.reduce((n, s) => n + s.w * s.r, 0);

      for (const s of doneSets) {
        // Heaviest weight
        if (!heaviestSet || s.w > heaviestSet.w || (s.w === heaviestSet.w && s.r > heaviestSet.r)) {
          heaviestSet = { w: s.w, r: s.r, date: entry.timestamp };
        }
        // Most reps at any weight
        if (!mostReps || s.r > mostReps.r || (s.r === mostReps.r && s.w > mostReps.w)) {
          mostReps = { w: s.w, r: s.r, date: entry.timestamp };
        }
      }
      // Highest session volume
      if (volume > 0 && (!highestVolume || volume > highestVolume.volume)) {
        highestVolume = { volume, date: entry.timestamp };
      }
    }
    return { heaviestSet, highestVolume, mostReps };
  },

  // Check whether the current live sets for exId set any PRs vs historical records.
  // Returns array of PR type strings: 'weight', 'reps', 'volume'
  currentSetPRs(appState, exId) {
    const currentSets = appState.exercises[exId] || [];
    const doneSets = currentSets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    if (!doneSets.length) return [];

    // Get records WITHOUT the current (in-progress) session — compare against history only
    const sessionId = EX_SESSION_INDEX[exId];
    const histEntries = this.sessionHistory(appState, sessionId).filter(e => {
      // Exclude the most recent entry if it matches the live exercise state
      // (it might be a just-completed session that was auto-added)
      return true;
    });

    let prWeight = null, prReps = null, prVolume = null;
    for (const entry of histEntries) {
      const sets = (entry.exercises[exId] || []).filter(s => s.s === 'done' && s.w !== null && s.r !== null);
      for (const s of sets) {
        if (prWeight === null || s.w > prWeight) prWeight = s.w;
        if (prReps   === null || s.r > prReps)   prReps   = s.r;
      }
      const vol = sets.reduce((n, s) => n + s.w * s.r, 0);
      if (vol > 0 && (prVolume === null || vol > prVolume)) prVolume = vol;
    }

    if (prWeight === null && prReps === null) return []; // no history to compare against

    const prs = [];
    const currMaxW = Math.max(...doneSets.map(s => s.w));
    const currMaxR = Math.max(...doneSets.map(s => s.r));
    const currVol  = doneSets.reduce((n, s) => n + s.w * s.r, 0);

    if (prWeight !== null && currMaxW > prWeight) prs.push('weight');
    if (prReps   !== null && currMaxR > prReps)   prs.push('reps');
    if (prVolume !== null && currVol  > prVolume) prs.push('volume');
    return prs;
  },

  // ── C: Session PRs from a completed history entry ──
  // Returns map of exId → array of PR types ('weight', 'reps', 'volume')
  sessionPRsFromEntry(appState, entry) {
    const result = {};
    const session = workouts.find(s => s.id === entry.sessionId);
    if (!session) return result;

    // History excluding this entry
    const priorHistory = (appState.history || []).filter(e => e.timestamp < entry.timestamp);
    const priorState = { ...appState, history: priorHistory };

    for (const block of session.blocks) {
      for (const ex of block.exercises) {
        const exId = ex.id;
        const entrySets = (entry.exercises[exId] || []).filter(s => s.s === 'done' && s.w !== null && s.r !== null);
        if (!entrySets.length) continue;

        const prior = query.exerciseHistory(priorState, exId);
        let prWeight = null, prReps = null, prVolume = null;
        for (const h of prior) {
          const sets = h.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
          for (const s of sets) {
            if (prWeight === null || s.w > prWeight) prWeight = s.w;
            if (prReps   === null || s.r > prReps)   prReps   = s.r;
          }
          const vol = sets.reduce((n, s) => n + s.w * s.r, 0);
          if (vol > 0 && (prVolume === null || vol > prVolume)) prVolume = vol;
        }

        const prs = [];
        if (prWeight === null && prReps === null) continue; // no prior history
        const currMaxW = Math.max(...entrySets.map(s => s.w));
        const currMaxR = Math.max(...entrySets.map(s => s.r));
        const currVol  = entrySets.reduce((n, s) => n + s.w * s.r, 0);
        if (prWeight !== null && currMaxW > prWeight) prs.push('weight');
        if (prReps   !== null && currMaxR > prReps)   prs.push('reps');
        if (prVolume !== null && currVol  > prVolume) prs.push('volume');
        if (prs.length) result[exId] = prs;
      }
    }
    return result;
  },

  sessionAnalytics(appState, sessionId) {
    const history = this.sessionHistory(appState, sessionId, 2);
    if (!history.length) return null;

    const lastEntry = history[history.length - 1];
    const prevEntry = history.length >= 2 ? history[history.length - 2] : null;

    let volume = 0;
    let totalSets = 0;
    let completedSets = 0;
    Object.values(lastEntry.exercises).forEach(sets => {
      totalSets += sets.length;
      sets.forEach(s => {
        if (s.s === 'done' || s.s === 'failed') completedSets++;
        if (s.s === 'done' && s.w !== null && s.r !== null) {
          volume += s.w * s.r;
        }
      });
    });

    let prevVolume = 0;
    let prevTotalSets = 0;
    let prevCompletedSets = 0;
    if (prevEntry) {
      Object.values(prevEntry.exercises).forEach(sets => {
        prevTotalSets += sets.length;
        sets.forEach(s => {
          if (s.s === 'done' || s.s === 'failed') prevCompletedSets++;
          if (s.s === 'done' && s.w !== null && s.r !== null) {
            prevVolume += s.w * s.r;
          }
        });
      });
    }

    const durationMs = lastEntry.startTimestamp ? lastEntry.timestamp - lastEntry.startTimestamp : null;
    const prs = this.sessionPRsFromEntry(appState, lastEntry);

    return {
      timestamp: lastEntry.timestamp,
      volume,
      prevVolume,
      totalSets,
      completedSets,
      prevTotalSets,
      prevCompletedSets,
      durationMs,
      prs
    };
  },

  recoveryDashboard(appState) {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * oneDay;
    const fourteenDaysAgo = now - 14 * oneDay;
    const thirtyDaysAgo = now - 30 * oneDay;

    const entryVolume = entry => {
      let vol = 0;
      Object.values(entry.exercises || {}).forEach(sets => {
        sets.forEach(s => {
          if (s.s === 'done' && s.w !== null && s.r !== null) {
            vol += s.w * s.r;
          }
        });
      });
      return vol;
    };

    const entryDuration = entry => {
      if (entry.startTimestamp && entry.timestamp > entry.startTimestamp) {
        return entry.timestamp - entry.startTimestamp;
      }
      return null;
    };

    const history = appState.history || [];

    const last7DaysEntries = history.filter(e => e.timestamp >= sevenDaysAgo);
    const workoutsLast7Days = last7DaysEntries.length;

    const vol7 = last7DaysEntries.reduce((sum, e) => sum + entryVolume(e), 0);
    const prev7DaysEntries = history.filter(e => e.timestamp >= fourteenDaysAgo && e.timestamp < sevenDaysAgo);
    const volPrev7 = prev7DaysEntries.reduce((sum, e) => sum + entryVolume(e), 0);

    let volumeTrend = null;
    if (volPrev7 > 0) {
      volumeTrend = +(((vol7 - volPrev7) / volPrev7) * 100).toFixed(1);
    }

    const last30DaysEntries = history.filter(e => e.timestamp >= thirtyDaysAgo);
    const durations = last30DaysEntries.map(entryDuration).filter(d => d !== null);
    const avgDurationMs = durations.length ? (durations.reduce((sum, d) => sum + d, 0) / durations.length) : null;

    let daysSinceLastWorkout = null;
    if (history.length > 0) {
      const lastWorkoutTs = Math.max(...history.map(e => e.timestamp));
      daysSinceLastWorkout = +((now - lastWorkoutTs) / oneDay).toFixed(1);
    }

    return {
      workoutsLast7Days,
      volumeLast7Days: vol7,
      volumePrev7Days: volPrev7,
      volumeTrend,
      avgDurationMs,
      daysSinceLastWorkout
    };
  }
};

// ==========================================
// ─── RESOLUTION HELPERS ───
// ==========================================

/**
 * Returns the lower (or fixed) numeric value from a structured reps/weight object.
 * Structured objects take one of three forms:
 *   { fixed: N }              — single prescribed value
 *   { value: N, unit }        — single prescribed value with unit
 *   { min: N, max: M, unit? } — range; returns the lower bound
 * Returns null for any unrecognised input.
 */
export function lowerBound(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if ('fixed' in obj) return obj.fixed;
  if ('value' in obj) return obj.value;
  if ('min'   in obj) return obj.min;
  return null;
}

export function getDisplayName(appState, exId) {
  const sub = appState?.exerciseSubstitutions?.[exId];
  if (sub) return sub.name;
  return EXERCISE_INDEX[exId]?.name ?? exId;
}

export function getEffectiveExercise(appState, exId) {
  const base = EXERCISE_INDEX[exId];
  if (!base) return null;
  const overrides = appState?.exerciseOverrides?.[exId];
  if (!overrides) return base;

  const result = { ...base };
  if (overrides.weight) result.weight = overrides.weight;
  if (overrides.reps) result.reps = overrides.reps;
  if (overrides.notes) result.notes = overrides.notes;
  return result;
}

/**
 * Resolve weight for a set log:
 *  1. Use user-supplied value if provided (non-null, non-NaN)
 *  2. Fall back to the workout definition weight (lower bound of range)
 * Always returns a number or null.
 */
export function resolveWeight(userValue, exId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) return userValue;
  const overrides = state?.exerciseOverrides?.[exId];
  const weightObj = overrides?.weight ?? EXERCISE_INDEX[exId]?.weight;
  return weightObj ? lowerBound(weightObj) : null;
}

/**
 * Resolve reps for a set log — same logic as resolveWeight.
 */
export function resolveReps(userValue, exId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) return userValue;
  const overrides = state?.exerciseOverrides?.[exId];
  const repsObj = overrides?.reps ?? EXERCISE_INDEX[exId]?.reps;
  return repsObj ? lowerBound(repsObj) : null;
}

// ==========================================
// ─── ACTIONS / REDUCER ───
// ==========================================

export const ALLOWED_ACTIONS = {
  SET_ACTIVE_SESSION:  ['sessionId'],
  TOGGLE_SET:          ['exId', 'idx'],
  LOG_AND_MARK_DONE:   ['exId', 'idx', 'weight', 'reps', 'note'],
  RESET_SESSION:       [],
  IMPORT_STATE:        ['data'],
  START_SESSION:       [],
  SUBSTITUTE_EXERCISE: ['exId', 'substitution'],
  UPDATE_EXERCISE_OVERRIDE: ['exId', 'fields'],
  IMPORT_TEMPLATE:     ['sessions'],
  IMPORT_HISTORY:      ['history']
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

      // When transitioning to 'done' via a simple tap, auto-fill defaults
      // so the dot always displays a real value (never '?×?').
      // If the set already has user-supplied values, preserve them.
      // When cycling back to '' (reset), clear w/r so it returns to pristine state.
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

    // Atomic: resolve weight/reps to numeric values at dispatch time, then write.
    // Blank inputs fall back to workout definition values (lower bound if range).
    // Guarantees all stored sets contain only numbers — never strings, ranges, or null.
    case 'LOG_AND_MARK_DONE': {
      const { exId, idx } = payload;

      // Resolution happens HERE — the single authoritative point.
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
      return createDefaultState(workouts);
    }

    case 'IMPORT_STATE': {
      return payload.data;
    }

    case 'IMPORT_TEMPLATE': {
      const { sessions } = payload;
      initWorkouts(sessions);
      return normalize({
        ...currentState,
        activeSessionId: sessions[0]?.id || currentState.activeSessionId
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

    // Records when the user begins logging the first set of a session.
    case 'START_SESSION': {
      if (currentState.sessionStarted !== null) return currentState;
      return { ...currentState, sessionStarted: Date.now() };
    }

    default:
      throw new Error(`Unhandled action: ${type}`);
  }
}

// ==========================================
// ─── SIDE-EFFECT LAYER (history snapshots) ───
// ==========================================

export function applyCompletionSideEffect(prevState, nextState) {
  const sessionId = nextState.activeSessionId;
  const wasComplete = query.isSessionComplete(prevState, sessionId);
  const isComplete  = query.isSessionComplete(nextState, sessionId);

  if (wasComplete === isComplete) return nextState;

  if (isComplete) {
    const session = workouts.find(s => s.id === sessionId);
    const exerciseSnapshot = {};
    session.blocks.flatMap(b => b.exercises).forEach(ex => {
      exerciseSnapshot[ex.id] = nextState.exercises[ex.id].map(s => ({
        ...s,
        // Guarantee numeric-only values in history — no range strings, no nulls on done sets.
        w: s.s === 'done' || s.s === 'failed' ? resolveWeight(s.w, ex.id) : s.w,
        r: s.s === 'done' || s.s === 'failed' ? resolveReps(s.r, ex.id)   : s.r,
        n: s.n ?? ''
      }));
    });

    const entry = {
      entryId: crypto.randomUUID(),
      sessionId,
      timestamp: Date.now(),
      startTimestamp: nextState.sessionStarted ?? null,
      exercises: exerciseSnapshot
    };

    const history = [...(nextState.history || []), entry]
      .sort((a, b) => a.timestamp - b.timestamp);

    // Clear sessionStarted after capturing it into the entry
    return { ...nextState, history, sessionStarted: null };
  }

  return nextState;
}

// ==========================================
// ─── STATE COMMIT (the single dispatch path) ───
// ==========================================

// Registered by main.js after both engine and ui are imported.
// Keeps engine DOM-free and prevents circular imports.
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

    // Auto-start session timer on first set action
    if ((type === 'TOGGLE_SET' || type === 'LOG_AND_MARK_DONE') && state.sessionStarted === null) {
      // Check that the session isn't already complete (e.g. re-tapping after done)
      if (!query.isSessionComplete(state, state.activeSessionId)) {
        const withStart = reducer(state, { type: 'START_SESSION', payload: {} });
        state = withStart;
        // Don't persist yet — will persist after main action
      }
    }

    const prevState = state;
    let nextState = reducer(state, { type, payload });
    nextState = applyCompletionSideEffect(prevState, nextState);

    if (DEV_MODE) {
      console.log(`▶ ${type}`, payload);
      console.log('  state →', nextState);
    }

    state = nextState;
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
      // Determine which rest duration to use based on exercise context.
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

    const justFinished =
      !query.isSessionComplete(prevState, nextState.activeSessionId) &&
      query.isSessionComplete(nextState, nextState.activeSessionId);
    if (justFinished) {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      // Notify UI layer via registered callback — engine stays DOM-free.
      const sessionEntries = query.sessionHistory(nextState, nextState.activeSessionId);
      const completedEntry = sessionEntries[sessionEntries.length - 1];
      if (completedEntry) {
        _sessionCompleteFn?.(completedEntry, nextState);
      }
    }

  } catch (err) {
    console.error(`[dispatch] ${type} rejected:`, err);
  }
}

// ==========================================
// ─── REST TIMER ───
// ==========================================

export function startRestTimer(duration = REST_DURATION) {
  clearInterval(restTimerId);
  restDuration = Math.min(duration, MAX_REST_DURATION);
  restRemaining = restDuration;

  const bar   = document.getElementById('rest-timer-bar');
  const fill  = document.getElementById('rest-timer-fill');
  const count = document.getElementById('rest-timer-count');
  if (!bar || !fill || !count) return;

  bar.classList.remove('hidden', 'done-state');
  count.textContent = restRemaining;
  fill.style.transition = 'none';
  fill.style.width = '100%';
  void fill.offsetWidth;
  fill.style.transition = '';

  updateExtendButton();
  startRestTimerLoop();
}

export function startRestTimerLoop() {
  const bar   = document.getElementById('rest-timer-bar');
  const fill  = document.getElementById('rest-timer-fill');
  const count = document.getElementById('rest-timer-count');
  if (!bar || !fill || !count) return;

  restTimerId = setInterval(() => {
    restRemaining--;
    fill.style.width = Math.max(0, (restRemaining / restDuration) * 100) + '%';
    count.textContent = restRemaining > 0 ? restRemaining : 'GO';
    if (restRemaining <= 0) {
      clearInterval(restTimerId);
      bar.classList.add('done-state');
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      setTimeout(() => {
        if (restRemaining <= 0) {
          bar.classList.add('hidden');
          bar.classList.remove('done-state');
        }
      }, 4000);
    }
  }, 1000);
}

export function extendRestTimer(amount = 30) {
  const bar = document.getElementById('rest-timer-bar');
  if (!bar || bar.classList.contains('hidden')) return;

  // Already at or above max — no-op
  if (restRemaining >= MAX_REST_DURATION) return;

  const wasFinished = restRemaining <= 0;
  clearInterval(restTimerId);

  if (wasFinished) {
    restRemaining = Math.min(amount, MAX_REST_DURATION);
    restDuration = restRemaining;
    bar.classList.remove('done-state');
  } else {
    restRemaining = Math.min(restRemaining + amount, MAX_REST_DURATION);
    restDuration = Math.min(restDuration + amount, MAX_REST_DURATION);
  }

  const fill  = document.getElementById('rest-timer-fill');
  const count = document.getElementById('rest-timer-count');
  if (count) count.textContent = restRemaining;
  if (fill) fill.style.width = Math.max(0, (restRemaining / restDuration) * 100) + '%';

  // Update +30s button state
  updateExtendButton();

  startRestTimerLoop();
}

export function getRestState() {
  return {
    remaining: restRemaining,
    duration: restDuration,
    isMaxed: restRemaining >= MAX_REST_DURATION
  };
}

function updateExtendButton() {
  const btn = document.getElementById('rest-timer-extend');
  if (!btn) return;
  if (restRemaining >= MAX_REST_DURATION) {
    btn.classList.add('disabled');
    btn.textContent = 'MAX';
  } else {
    btn.classList.remove('disabled');
    btn.textContent = '+30s';
  }
}

export function skipRestTimer() {
  clearInterval(restTimerId);
  restRemaining = 0;
  const bar = document.getElementById('rest-timer-bar');
  if (bar) {
    bar.classList.add('hidden');
    bar.classList.remove('done-state');
  }
}

// ==========================================
// ─── PERSISTENCE ───
// ==========================================

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
      if (validate(normal)) { state = normal; return; }
    } catch (_) {}
  }
  state = createDefaultState(workouts);
}

export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultState(workouts);

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
    activeSessionId: raw.activeSessionId ?? workouts[0]?.id,
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
  workouts.forEach(session =>
    session.blocks.forEach(block =>
      block.exercises.forEach(ex => {
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
  if (typeof appState.activeSessionId !== 'string') return false;
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
  return true;
}