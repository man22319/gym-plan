// ==========================================
// ─── RUNTIME SINGLETONS ───
// ==========================================

let state = null;
let restTimerId = null;
let restRemaining = 0;

// Per-element press timers: Map<string key → timeoutId>
// Key format: `${exId}:${setIdx}`
const pressTimers = new Map();
const LONG_PRESS_MS = 480;

// ==========================================
// ─── QUERY LAYER (pure functions, no side effects) ───
// ==========================================

const query = {
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
  }
};

// ==========================================
// ─── RESOLUTION HELPERS ───
// ==========================================

/**
 * Parse a range string like "22.5-25" or "6-8" and return the lower bound.
 * If the value is already a plain number string, returns that number.
 * If parsing fails, returns null.
 */
function parseLowerBound(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).replace(/\s*(lbs?|lb)\s*/gi, '').trim();
  // Range: "22.5-25", "6-8", "10-15"
  const rangeMatch = s.match(/^([\d.]+)\s*[-–]\s*([\d.]+)$/);
  if (rangeMatch) return parseFloat(rangeMatch[1]);
  // Plain number
  const plain = parseFloat(s);
  return isNaN(plain) ? null : plain;
}

/**
 * Resolve weight for a set log:
 *  1. Use user-supplied value if provided (non-null, non-NaN)
 *  2. Fall back to workout definition weight
 *  3. If fallback is a range, pick lower bound
 * Always returns a number or null (should never be null after resolution).
 */
function resolveWeight(userValue, exId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) {
    return userValue;
  }
  const ex = EXERCISE_INDEX[exId];
  if (!ex || !ex.weight) return null;
  return parseLowerBound(ex.weight);
}

/**
 * Resolve reps for a set log — same logic as resolveWeight.
 */
function resolveReps(userValue, exId) {
  if (userValue !== null && userValue !== undefined && !isNaN(userValue)) {
    return userValue;
  }
  const ex = EXERCISE_INDEX[exId];
  if (!ex || !ex.reps) return null;
  return parseLowerBound(ex.reps);
}

// ==========================================
// ─── ACTIONS / REDUCER ───
// ==========================================

const ALLOWED_ACTIONS = {
  SET_ACTIVE_SESSION:  ['sessionId'],
  TOGGLE_SET:          ['exId', 'idx'],
  LOG_AND_MARK_DONE:   ['exId', 'idx', 'weight', 'reps'],
  RESET_SESSION:       [],
  IMPORT_STATE:        ['data']
};

function validateAction(type, payload) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_ACTIONS, type))
    throw new Error(`Unknown action: ${type}`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error(`Payload must be a plain object for action: ${type}`);
  for (const key of ALLOWED_ACTIONS[type]) {
    if (!(key in payload)) throw new Error(`Missing "${key}" in payload for ${type}`);
  }
}

function cycleStatus(s) {
  if (s === '')       return 'done';
  if (s === 'done')   return 'failed';
  return '';
}

function reducer(currentState, action) {
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
      if (nextStatus === 'done') {
        nextW = resolveWeight(existing.w, exId);
        nextR = resolveReps(existing.r, exId);
      } else if (nextStatus === '') {
        nextW = null;
        nextR = null;
      }

      sets[idx] = { ...existing, s: nextStatus, w: nextW, r: nextR };
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

      const sets = [...(currentState.exercises[exId] || [])];
      const existing = sets[idx] || makeSet();
      sets[idx] = { ...existing, s: 'done', w: resolvedWeight, r: resolvedReps };
      return {
        ...currentState,
        exercises: { ...currentState.exercises, [exId]: sets }
      };
    }

    case 'RESET_SESSION': {
      return {
        ...currentState,
        exercises: makeDefaultExercises()
      };
    }

    case 'IMPORT_STATE': {
      return payload.data;
    }

    default:
      throw new Error(`Unhandled action: ${type}`);
  }
}

// ==========================================
// ─── SIDE-EFFECT LAYER (history snapshots) ───
// ==========================================

function applyCompletionSideEffect(prevState, nextState) {
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
      }));
    });

    const entry = {
      sessionId,
      timestamp: Date.now(),
      exercises: exerciseSnapshot
    };

    const history = [...(nextState.history || []), entry]
      .sort((a, b) => a.timestamp - b.timestamp);

    return { ...nextState, history };
  }

  return nextState;
}

// ==========================================
// ─── STATE COMMIT (the single dispatch path) ───
// ==========================================

let lastTap = { key: '', ts: 0 };

function dispatch(type, payload = {}) {
  try {
    validateAction(type, payload);

    if (type === 'TOGGLE_SET') {
      const key = `${payload.exId}:${payload.idx}`;
      const now = Date.now();
      if (lastTap.key === key && now - lastTap.ts < 300) return;
      lastTap = { key, ts: now };
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
    render(state);

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

    if (isDoneTransition) startRestTimer();

    const justFinished =
      !query.isSessionComplete(prevState, nextState.activeSessionId) &&
      query.isSessionComplete(nextState, nextState.activeSessionId);
    if (justFinished && navigator.vibrate) navigator.vibrate([100, 50, 100]);

  } catch (err) {
    console.error(`[dispatch] ${type} rejected:`, err);
  }
}

// ==========================================
// ─── REST TIMER ───
// ==========================================

function startRestTimer() {
  clearInterval(restTimerId);
  restRemaining = REST_DURATION;

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

  restTimerId = setInterval(() => {
    restRemaining--;
    fill.style.width = Math.max(0, (restRemaining / REST_DURATION) * 100) + '%';
    count.textContent = restRemaining > 0 ? restRemaining : 'GO';
    if (restRemaining <= 0) {
      clearInterval(restTimerId);
      bar.classList.add('done-state');
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      setTimeout(() => { bar.classList.add('hidden'); bar.classList.remove('done-state'); }, 4000);
    }
  }, 1000);
}

// ==========================================
// ─── PERSISTENCE ───
// ==========================================

const KEYS = { primary: STORAGE_KEY, backup: STORAGE_KEY + '_bk', lkg: STORAGE_KEY + '_lkg' };
let writeCount = 0;

function persist() {
  try {
    const json = JSON.stringify(state);
    localStorage.setItem(KEYS.backup, localStorage.getItem(KEYS.primary) ?? '');
    localStorage.setItem(KEYS.primary, json);
    if (++writeCount >= 2) localStorage.setItem(KEYS.lkg, json);
  } catch (e) { console.error('persist() failed:', e); }
}

function loadState() {
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
  state = createDefaultState();
}

function migrate(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultState();

  const exercises = {};
  for (const [id, arr] of Object.entries(raw.exercises || {})) {
    if (!Array.isArray(arr)) continue;
    exercises[id] = arr.map(item => {
      if (typeof item === 'string') return makeSet(item);
      const _s = item.s ?? ''; const _w = (item.w === 0 && _s === '') ? null : (item.w ?? null); const _r = (item.r === 0 && _s === '') ? null : (item.r ?? null); return { s: _s, w: _w, r: _r };
    });
  }

  return {
    version:         STATE_VERSION,
    activeSessionId: raw.activeSessionId ?? workouts[0].id,
    history:         (raw.history || []).map(entry => ({
      sessionId:  entry.sessionId,
      timestamp:  entry.timestamp,
      exercises:  Object.fromEntries(
        Object.entries(entry.exercises || {}).map(([id, sets]) => [
          id,
          (Array.isArray(sets) ? sets : []).map(s =>
            typeof s === 'string' ? makeSet(s) : (() => { const _s = s.s ?? ''; const _w = (s.w === 0 && _s === '') ? null : (s.w ?? null); const _r = (s.r === 0 && _s === '') ? null : (s.r ?? null); return { s: _s, w: _w, r: _r }; })()
          )
        ])
      )
    })),
    exercises
  };
}

function normalize(appState) {
  const exercises = { ...appState.exercises };
  workouts.forEach(session =>
    session.blocks.forEach(block =>
      block.exercises.forEach(ex => {
        const arr = exercises[ex.id];
        if (!Array.isArray(arr)) {
          exercises[ex.id] = Array.from({ length: ex.sets }, () => makeSet());
          return;
        }
        const copy = arr.slice(0, ex.sets).map(s => ({ s: s.s ?? '', w: s.w ?? null, r: s.r ?? null }));
        while (copy.length < ex.sets) copy.push(makeSet());
        exercises[ex.id] = copy;
      })
    )
  );
  return { ...appState, exercises, version: STATE_VERSION };
}

function validate(appState) {
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
  return true;
}