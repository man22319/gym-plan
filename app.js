// ==========================================
// ─── WORKOUT DEFINITIONS (static config) ───
// ==========================================

const workouts = [
  {
    id: 'session_thu',
    dayLabel: 'THU',
    sessionLabel: 'Session 1',
    warmup: 'Incline treadmill · 8 min · 3.0 mph · 2% incline',
    finisher: 'Incline treadmill · 8 min · 3.3 mph · 2.5% incline',
    blocks: [
      {
        label: 'Superset 1 — Pull / Push',
        exercises: [
          { id: 'thu_row', letter: 'A', name: 'Seated Row Machine', sets: 4, reps: '6-8', weight: '60 lbs' },
          { id: 'thu_bench', letter: 'B', name: 'Dumbbell Bench Press', sets: 4, reps: '8', weight: '22.5-25 lbs' }
        ]
      },
      {
        label: 'Superset 2 — Legs',
        exercises: [
          { id: 'thu_leg_curl', letter: 'A', name: 'Seated Leg Curl', sets: 4, reps: '10-15', weight: '60 lbs' },
          { id: 'thu_leg_ext', letter: 'B', name: 'Seated Leg Extension', sets: 4, reps: '10-15', weight: '60-70 lbs' }
        ]
      },
      {
        label: 'Superset 3 — Your Moves',
        exercises: [
          { id: 'thu_leg_press', letter: 'A', name: 'Modified Leg Press (Glute Biased)', sets: 4, reps: '10-12', weight: '140-160 lbs' },
          { id: 'thu_lat_pull', letter: 'B', name: 'Lat Pulldown', sets: 3, reps: '8-10', weight: '70 lbs' }
        ]
      },
      {
        label: 'Superset 4 — Shoulders / Arms',
        exercises: [
          { id: 'thu_lat_raise', letter: 'A', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: '10-15 lbs' },
          { id: 'thu_tri_press', letter: 'B', name: 'Triceps Press Machine', sets: 3, reps: '8-10', weight: '70-80 lbs' }
        ]
      }
    ]
  },

  {
    id: 'session_sat',
    dayLabel: 'SAT',
    sessionLabel: 'Session 2',
    warmup: 'Incline treadmill · 8 min · 3.0 mph · 2% incline',
    finisher: 'Incline treadmill · 8 min · 3.3 mph · 2.5% incline',
    blocks: [
      {
        label: 'Superset 1 — Pull / Shoulders',
        exercises: [
          { id: 'sat_row', letter: 'A', name: 'Supported Single-Arm Row', sets: 3, reps: '8-10', weight: '30 lbs' },
          { id: 'sat_arnold_press', letter: 'B', name: 'Arnold Press', sets: 3, reps: '8-10', weight: '25-30 lbs' }
        ]
      },
      {
        label: 'Superset 2 — Legs',
        exercises: [
          { id: 'sat_leg_press', letter: 'A', name: 'Leg Press', sets: 4, reps: '10-12', weight: '140-160 lbs' },
          { id: 'sat_leg_curl', letter: 'B', name: 'Seated Leg Curl', sets: 3, reps: '10-12', weight: '60 lbs' }
        ]
      },
      {
        label: 'Superset 3 — Arms / Shoulders',
        exercises: [
          { id: 'sat_lat_raise', letter: 'A', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: '10-15 lbs' },
          { id: 'sat_tri_press', letter: 'B', name: 'Triceps Press Machine', sets: 3, reps: '8-10', weight: '70-80 lbs' },
          { id: 'sat_hammer', letter: 'C', name: 'Hammer Curl', sets: 3, reps: '10-12', weight: '15 lbs' }
        ]
      }
    ]
  },

  {
    id: 'session_mon',
    dayLabel: 'MON',
    sessionLabel: 'Session 3',
    warmup: 'Incline treadmill · 8 min · 3.0 mph · 2% incline',
    finisher: 'Incline treadmill · 8 min · 3.3 mph · 2.5% incline',
    blocks: [
      {
        label: 'Superset 1 — Pull / Push',
        exercises: [
          { id: 'mon_row', letter: 'A', name: 'Supported Single-Arm Row', sets: 3, reps: '8-10', weight: '30 lbs' },
          { id: 'mon_idbp', letter: 'B', name: 'Incline Dumbbell Bench Press', sets: 3, reps: '8-12', weight: '22.5-25 lbs' }
        ]
      },
      {
        label: 'Superset 2 — Legs',
        exercises: [
          { id: 'mon_leg_press', letter: 'A', name: 'Leg Press', sets: 4, reps: '8-12', weight: '140-160 lbs' },
          { id: 'mon_leg_curl', letter: 'B', name: 'Seated Leg Curl', sets: 3, reps: '10-12', weight: '60 lbs' }
        ]
      },
      {
        label: 'Superset 3 — Arms',
        exercises: [
          { id: 'mon_skull', letter: 'A', name: 'Skull Crushers', sets: 3, reps: '10-12', weight: '15 lbs' },
          { id: 'mon_curl', letter: 'B', name: 'Barbell Curl', sets: 3, reps: '8-12', weight: '40-50 lbs' }
        ]
      },
      {
        label: 'Superset 4 — Shoulders',
        exercises: [
          { id: 'mon_ohp', letter: 'A', name: 'Overhead Press', sets: 3, reps: '6-8', weight: '20-25 lbs' },
          { id: 'mon_lat_raise', letter: 'B', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: '10-15 lbs' }
        ]
      }
    ]
  }
];

// Flat exercise index for O(1) lookup: exId → exercise config
const EXERCISE_INDEX = Object.fromEntries(
  workouts.flatMap(s => s.blocks.flatMap(b => b.exercises)).map(ex => [ex.id, ex])
);

// Session index: exId → sessionId
const EX_SESSION_INDEX = Object.fromEntries(
  workouts.flatMap(s => s.blocks.flatMap(b => b.exercises.map(ex => [ex.id, s.id])))
);

// ==========================================
// ─── CONSTANTS ───
// ==========================================

const STORAGE_KEY      = 'pf_tracker_v5';
const REST_DURATION    = 90; // seconds
const STATE_VERSION    = 5;
const DEV_MODE         = ['localhost','127.0.0.1',''].includes(window.location.hostname);

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
// ─── FACTORY ───
// ==========================================

function makeSet(s = '', w = null, r = null) {
  return { s, w, r };
}

function makeDefaultExercises() {
  const result = {};
  workouts.forEach(session =>
    session.blocks.forEach(block =>
      block.exercises.forEach(ex => {
        result[ex.id] = Array.from({ length: ex.sets }, makeSet);
      })
    )
  );
  return result;
}

function createDefaultState() {
  return {
    version: STATE_VERSION,
    activeSessionId: workouts[0].id,
    exercises: makeDefaultExercises(),
    history: []  // lastDone is DERIVED — never stored separately anymore
  };
}

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

  // Volume for a set array: Σ(w × r) — skips null values
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
// ─── ACTIONS / REDUCER ───
// ==========================================

// Single atomic action: marks a set done AND logs w/r in one transition.
// Replaces the old LOG_SET + TOGGLE_SET coupling bug.
const ALLOWED_ACTIONS = {
  SET_ACTIVE_SESSION:  ['sessionId'],
  TOGGLE_SET:          ['exId', 'idx'],          // tap: cycle status only
  LOG_AND_MARK_DONE:   ['exId', 'idx', 'weight', 'reps'], // long-press modal: atomic
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
      sets[idx] = { ...existing, s: cycleStatus(existing.s) };
      return {
        ...currentState,
        exercises: { ...currentState.exercises, [exId]: sets }
      };
    }

    // Atomic: write w+r AND set status to 'done' in one transition.
    // No secondary action needed — fixes the double-dispatch bug.
    case 'LOG_AND_MARK_DONE': {
      const { exId, idx, weight, reps } = payload;
      const sets = [...(currentState.exercises[exId] || [])];
      const existing = sets[idx] || makeSet();
      sets[idx] = { ...existing, s: 'done', w: weight, r: reps };
      return {
        ...currentState,
        exercises: { ...currentState.exercises, [exId]: sets }
      };
    }

    case 'RESET_SESSION': {
      // Clear current working sets; preserve history.
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

// Called after every reducer transition.
// If a session just became complete, snapshot it into history.
// History entries are IMMUTABLE once written — we never mutate past entries.
function applyCompletionSideEffect(prevState, nextState) {
  const sessionId = nextState.activeSessionId;
  const wasComplete = query.isSessionComplete(prevState, sessionId);
  const isComplete  = query.isSessionComplete(nextState, sessionId);

  // No change in completion status → nothing to do
  if (wasComplete === isComplete) return nextState;

  if (isComplete) {
    // Take a deep snapshot of current working state for this session's exercises
    const session = workouts.find(s => s.id === sessionId);
    const exerciseSnapshot = {};
    session.blocks.flatMap(b => b.exercises).forEach(ex => {
      exerciseSnapshot[ex.id] = nextState.exercises[ex.id].map(s => ({ ...s }));
    });

    const entry = {
      sessionId,
      timestamp: Date.now(),
      exercises: exerciseSnapshot
    };

    // Append and keep sorted (should already be sorted, but enforce it)
    const history = [...(nextState.history || []), entry]
      .sort((a, b) => a.timestamp - b.timestamp);

    return { ...nextState, history };
  }

  // If session became incomplete (user toggled something back), don't touch history.
  // The existing snapshot stays as ground truth of what was achieved.
  return nextState;
}

// ==========================================
// ─── STATE COMMIT (the single dispatch path) ───
// ==========================================

// Debounce guard for rapid taps on the same dot
let lastTap = { key: '', ts: 0 };

function dispatch(type, payload = {}) {
  try {
    validateAction(type, payload);

    // Debounce identical rapid taps (not applicable to LOG_AND_MARK_DONE)
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

    // Timer fires when a set is marked done (either path)
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
// ─── RENDER ───
// ==========================================

function render(appState) {
  const el = document.getElementById('app');
  if (el) el.innerHTML = buildApp(appState);
}

function buildApp(appState) {
  return buildTabs(appState) +
    workouts.map(s => buildSession(s, appState)).join('');
}

function buildTabs(appState) {
  const tabs = workouts.map(session => {
    const active    = session.id === appState.activeSessionId ? 'active' : '';
    const ts        = query.lastDoneTimestamp(appState, session.id);
    const dateLabel = ts ? formatDate(ts) : '';
    return `<div class="tab ${active}" data-session-id="${session.id}">
      ${session.dayLabel}
      <span class="day-label">${session.sessionLabel}</span>
      <span class="last-done">${dateLabel}</span>
    </div>`;
  }).join('');
  return `<div class="tabs">${tabs}</div>`;
}

function buildSession(session, appState) {
  const active    = session.id === appState.activeSessionId ? 'active' : '';
  const pct       = query.sessionProgress(appState, session.id);
  const complete  = query.isSessionComplete(appState, session.id);

  return `<div class="session ${active}" id="${session.id}">
    <div class="progress-wrap">
      <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
      <div class="progress-pct ${pct === 100 ? 'lit' : ''}">${pct}%</div>
    </div>
    <div class="warmup-bar"><strong>WARM-UP</strong> <span>&middot; ${session.warmup}</span></div>
    ${session.blocks.map(b => buildBlock(b, appState)).join('')}
    <div class="finisher-card">
      <div class="finisher-label">Finisher</div>
      <div class="finisher-text">${session.finisher}</div>
    </div>
    <div class="complete-banner ${complete ? 'visible' : ''}">
      SESSION COMPLETE<small>Rest up. You earned it.</small>
    </div>
  </div>`;
}

function buildBlock(block, appState) {
  return `<div class="superset-label">${block.label}</div>
    ${block.exercises.map(ex => buildCard(ex, appState)).join('')}`;
}

function buildCard(ex, appState) {
  const sets      = appState.exercises[ex.id] || [];
  const complete  = query.isExerciseComplete(appState, ex.id);
  const prevSets  = query.lastExerciseSets(appState, ex.id);
  const detail    = `${ex.sets} &times; ${ex.reps}${ex.weight ? `<br>${ex.weight}` : ''}`;

  return `<div class="exercise-card ${complete ? 'completed' : ''}" data-ex-id="${ex.id}">
    <div class="exercise-header">
      <div class="ex-letter">${ex.letter}</div>
      <div class="ex-name">${ex.name}</div>
      <div class="ex-detail">${detail}</div>
    </div>
    ${buildPrevRow(prevSets, sets)}
    <div class="set-row">
      ${sets.map((s, i) => buildDot(ex.id, i, s)).join('')}
    </div>
  </div>`;
}

function buildPrevRow(prevSets, currSets) {
  if (!prevSets) return '';
  const logged = prevSets.filter(s => s.w !== null || s.r !== null);
  if (!logged.length) return '';

  // Delta: compare avg weight of previous vs current (only logged curr sets)
  const { weightDelta, repsDelta } = query.compareSets(
    prevSets,
    currSets.filter(s => s.w !== null || s.r !== null)
  );

  const setChips = logged.map((s, i) => {
    const w = s.w !== null ? s.w : '—';
    const r = s.r !== null ? s.r : '—';
    const fail = s.s === 'failed' ? ' <span class="prev-x">✗</span>' : '';
    return `<span class="prev-set">S${i+1} <span class="prev-nums">${w}&times;${r}</span>${fail}</span>`;
  }).join('');

  const deltaHtml = buildDelta(weightDelta, repsDelta);

  return `<div class="prev-data">
    <span class="prev-label">LAST</span>${setChips}${deltaHtml}
  </div>`;
}

function buildDelta(weightDelta, repsDelta) {
  const parts = [];
  if (weightDelta !== null && weightDelta !== 0) {
    const cls = weightDelta > 0 ? 'delta-up' : 'delta-down';
    const sign = weightDelta > 0 ? '+' : '';
    parts.push(`<span class="delta ${cls}">${sign}${weightDelta}lb</span>`);
  }
  if (repsDelta !== null && repsDelta !== 0) {
    const cls = repsDelta > 0 ? 'delta-up' : 'delta-down';
    const sign = repsDelta > 0 ? '+' : '';
    parts.push(`<span class="delta ${cls}">${sign}${repsDelta}rep</span>`);
  }
  return parts.length ? `<span class="delta-group">${parts.join('')}</span>` : '';
}

function buildDot(exId, idx, setObj) {
  const { s, w, r } = setObj;
  let cls = 'set-dot';
  let inner = '';

  const hasData = w !== null || r !== null;

  if (s === 'done') {
    cls += ' done';
    inner = hasData
      ? `<span class="dot-data"><span class="dot-w">${w ?? '?'}</span><span class="dot-x">×</span><span class="dot-r">${r ?? '?'}</span></span>`
      : '&#10003;';
  } else if (s === 'failed') {
    cls += ' failed';
    inner = hasData
      ? `<span class="dot-data"><span class="dot-w">${w ?? '?'}</span><span class="dot-x">×</span><span class="dot-r">${r ?? '?'}</span></span>`
      : '&#10005;';
  } else {
    inner = `<span class="dot-num">${idx + 1}</span>`;
  }

  return `<button class="${cls}"
    data-ex-id="${exId}"
    data-set-idx="${idx}"
    aria-label="Set ${idx + 1}: tap to toggle, hold to log">${inner}</button>`;
}

function formatDate(ts) {
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ==========================================
// ─── LOG MODAL ───
// ==========================================

let activeModal = null;

function openLogModal(exId, setIdx) {
  closeLogModal();

  const ex       = EXERCISE_INDEX[exId];
  const setObj   = (state.exercises[exId] || [])[setIdx] || makeSet();
  const prevSets = query.lastExerciseSets(state, exId);
  const prevSet  = prevSets ? prevSets[setIdx] : null;

  // Pre-fill: current values first, then fall back to previous session values
  const prefillW = setObj.w ?? prevSet?.w ?? '';
  const prefillR = setObj.r ?? prevSet?.r ?? '';

  const overlay = document.createElement('div');
  overlay.className = 'log-modal-overlay';
  overlay.innerHTML = `
    <div class="log-modal" role="dialog" aria-modal="true" aria-label="Log Set ${setIdx + 1}">
      <div class="log-modal-title">${ex?.name ?? exId}</div>
      <div class="log-modal-sub">SET ${setIdx + 1} ${prevSet && (prevSet.w !== null || prevSet.r !== null)
        ? `<span class="log-modal-prev">· Last: ${prevSet.w ?? '?'}×${prevSet.r ?? '?'}</span>`
        : ''}</div>
      <div class="log-fields">
        <div class="log-field">
          <label class="log-label" for="log-weight">WEIGHT</label>
          <div class="log-input-wrap">
            <input class="log-input" id="log-weight" type="number"
              inputmode="decimal" min="0" step="2.5"
              placeholder="${prevSet?.w ?? '—'}" value="${prefillW}"/>
            <span class="log-unit">lbs</span>
          </div>
        </div>
        <div class="log-field">
          <label class="log-label" for="log-reps">REPS</label>
          <div class="log-input-wrap">
            <input class="log-input" id="log-reps" type="number"
              inputmode="numeric" min="0" step="1"
              placeholder="${prevSet?.r ?? '—'}" value="${prefillR}"/>
            <span class="log-unit">reps</span>
          </div>
        </div>
      </div>
      <div class="log-modal-actions">
        <button class="log-btn log-btn-cancel" id="log-cancel">Cancel</button>
        <button class="log-btn log-btn-save" id="log-save">Save &amp; Done</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  activeModal = { el: overlay, exId, setIdx };

  const weightInput = overlay.querySelector('#log-weight');
  const repsInput   = overlay.querySelector('#log-reps');

  setTimeout(() => weightInput?.focus(), 60);

  overlay.addEventListener('click', e => { if (e.target === overlay) closeLogModal(); });
  overlay.querySelector('#log-cancel').addEventListener('click', closeLogModal);

  overlay.querySelector('#log-save').addEventListener('click', () => {
    const w = weightInput.value !== '' ? parseFloat(weightInput.value) : null;
    const r = repsInput.value   !== '' ? parseInt(repsInput.value, 10) : null;
    closeLogModal();
    // Single atomic dispatch — no double-action bug
    dispatch('LOG_AND_MARK_DONE', { exId, idx: setIdx, weight: w, reps: r });
  });

  overlay.addEventListener('keydown', e => {
    if (e.key === 'Enter')  overlay.querySelector('#log-save').click();
    if (e.key === 'Escape') closeLogModal();
  });
}

function closeLogModal() {
  if (activeModal) { activeModal.el.remove(); activeModal = null; }
}

// ==========================================
// ─── POINTER EVENT HANDLING ───
// ==========================================
// Per-element timers keyed by `${exId}:${idx}` to avoid race conditions.

function pressKey(exId, idx) { return `${exId}:${idx}`; }

function startPress(exId, idx) {
  const key = pressKey(exId, idx);
  cancelPress(key);
  pressTimers.set(key, setTimeout(() => {
    pressTimers.delete(key);
    openLogModal(exId, idx);
  }, LONG_PRESS_MS));
}

function cancelPress(key) {
  if (pressTimers.has(key)) {
    clearTimeout(pressTimers.get(key));
    pressTimers.delete(key);
  }
}

function commitPress(exId, idx) {
  const key = pressKey(exId, idx);
  // If timer is still running, this was a short tap
  if (pressTimers.has(key)) {
    cancelPress(key);
    dispatch('TOGGLE_SET', { exId, idx });
  }
  // If timer already fired (long press), modal opened — do nothing
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

// ── Migration: handle v3 (strings) and v4 (objects) → v5
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultState();

  const exercises = {};
  for (const [id, arr] of Object.entries(raw.exercises || {})) {
    if (!Array.isArray(arr)) continue;
    exercises[id] = arr.map(item => {
      if (typeof item === 'string') return makeSet(item);
      return { s: item.s ?? '', w: item.w ?? null, r: item.r ?? null };
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
            typeof s === 'string' ? makeSet(s) : { s: s.s ?? '', w: s.w ?? null, r: s.r ?? null }
          )
        ])
      )
    })),
    exercises
  };
}

// ── Normalize: ensure all declared exercises exist with correct length
function normalize(appState) {
  const exercises = { ...appState.exercises };
  workouts.forEach(session =>
    session.blocks.forEach(block =>
      block.exercises.forEach(ex => {
        const arr = exercises[ex.id];
        if (!Array.isArray(arr)) {
          exercises[ex.id] = Array.from({ length: ex.sets }, makeSet);
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

// ── Validate: minimum schema check
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

// ==========================================
// ─── UTILITY ACTIONS ───
// ==========================================

function exportState() {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `gym-backup-${new Date().toISOString().slice(0,10)}.json`
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) { alert('Export failed: ' + e.message); }
}

function importState() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const parsed   = JSON.parse(evt.target.result);
        const migrated = migrate(parsed);
        const normal   = normalize(migrated);
        if (!validate(normal)) throw new Error('Schema mismatch');
        dispatch('IMPORT_STATE', { data: normal });
      } catch (err) { alert('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
  };
  input.click();
}

function copyWorkout(btn) {
  const lines = ['PLANET FITNESS — STRENGTH PLAN', '3525 Washington St', ''];
  workouts.forEach(session => {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`${session.dayLabel} — ${session.sessionLabel}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`Warm-up: ${session.warmup}`);
    lines.push('');
    session.blocks.forEach(block => {
      lines.push(block.label);
      block.exercises.forEach(ex => {
        lines.push(`  ${ex.letter}  ${ex.name}`);
        lines.push(`     ${ex.sets} × ${ex.reps}  ${ex.weight}`);
      });
      lines.push('');
    });
    lines.push(`Finisher: ${session.finisher}`);
    lines.push('');
  });
  const text = lines.join('\n');
  const done = () => {
    btn.innerHTML = '&#10003; Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = '<span>⎘</span> Copy Workout'; btn.classList.remove('copied'); }, 2500);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done);
  } else {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    Object.assign(ta.style, { position: 'fixed', opacity: '0' });
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch(_) {}
    document.body.removeChild(ta);
  }
}

// ==========================================
// ─── EVENT DELEGATION ───
// ==========================================

function setupEvents() {
  // ── Pointer: long-press detection per element
  document.addEventListener('pointerdown', e => {
    const dot = e.target.closest('.set-dot');
    if (dot) {
      const exId = dot.dataset.exId;
      const idx  = parseInt(dot.dataset.setIdx, 10);
      startPress(exId, idx);
    }
  });

  document.addEventListener('pointerup', e => {
    const dot = e.target.closest('.set-dot');
    if (dot) {
      const exId = dot.dataset.exId;
      const idx  = parseInt(dot.dataset.setIdx, 10);
      commitPress(exId, idx);
    } else {
      // Cancel all pending presses if released elsewhere
      for (const [key] of pressTimers) cancelPress(key);
    }
  });

  document.addEventListener('pointercancel', () => {
    for (const [key] of pressTimers) cancelPress(key);
  });

  // Cancel long press if pointer moves significantly
  document.addEventListener('pointermove', e => {
    if (e.movementX ** 2 + e.movementY ** 2 > 16) {
      for (const [key] of pressTimers) cancelPress(key);
    }
  });

  // ── Click delegation for non-dot elements
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab?.dataset.sessionId) {
      dispatch('SET_ACTIVE_SESSION', { sessionId: tab.dataset.sessionId });
      return;
    }

    if (e.target.closest('#export-btn')) { exportState(); return; }
    if (e.target.closest('#import-btn')) { importState(); return; }
    if (e.target.closest('#copy-btn'))   { copyWorkout(e.target.closest('#copy-btn')); return; }

    if (e.target.closest('#reset-btn')) {
      if (confirm('Reset current session progress? History is preserved.')) {
        clearInterval(restTimerId);
        document.getElementById('rest-timer-bar')?.classList.add('hidden');
        dispatch('RESET_SESSION', {});
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
  });
}

// ==========================================
// ─── BOOT ───
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  render(state);
  setupEvents();
});