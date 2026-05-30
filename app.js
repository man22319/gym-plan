// ==========================================
// ─── STATE (Data & Initialization) ───
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
        label: 'Superset 1 — Push / Pull',
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
          { id: 'thu_lat_raise', letter: 'A', name: 'Lateral Raise', sets: 3, reps: '12', weight: '10-15 lbs' },
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
        label: 'Superset 1 — Shoulders / Pull',
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
          { id: 'sat_lat_raise', letter: 'A', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: '10 lbs' },
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
        label: 'Superset 1 — Pull / Shoulders',
        exercises: [
          { id: 'mon_row', letter: 'A', name: 'Supported Single-Arm Row', sets: 3, reps: '8', weight: '25-30 lbs' },
          { id: 'mon_ohp', letter: 'B', name: 'Overhead Press', sets: 3, reps: '6-8', weight: '20-25 lbs' }
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
        label: 'Superset 4 — Shoulders / Your Move',
        exercises: [
          { id: 'mon_lat_raise', letter: 'A', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: '10-15 lbs' }
        ]
      }
    ]
  }
];

const STORAGE_KEY = 'pf_tracker_v3';
const REST_DURATION = 90;
const CURRENT_STATE_VERSION = 1;
const DEV_MODE = window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

let state = null; // initialized during boot

let restInterval = null;
let restRemaining = 0;
let restTotal = REST_DURATION;
let lastSetClick = { exId: '', idx: -1, timestamp: 0 };

function createDefaultState() {
  const defaultState = {
    version: CURRENT_STATE_VERSION,
    activeSessionId: workouts[0].id,
    exercises: {},
    lastDone: {}
  };
  workouts.forEach(session => {
    session.blocks.forEach(block => {
      block.exercises.forEach(ex => {
        defaultState.exercises[ex.id] = Array(ex.sets).fill('');
      });
    });
  });
  return defaultState;
}

function init() {
  loadState();
  renderAppToDOM(state);
  setupEventDelegation();
}

// ==========================================
// ─── REDUCER (State Transitions ONLY) ───
// ==========================================

const ALLOWED_ACTIONS = {
  SET_ACTIVE_SESSION: ['sessionId'],
  TOGGLE_SET: ['exId', 'idx'],
  RESET_ALL: [],
  IMPORT_STATE: ['data']
};

function validateAction(type, payload) {
  if (!ALLOWED_ACTIONS.hasOwnProperty(type)) {
    throw new Error(`Invalid action type: ${type}`);
  }
  if (payload === undefined) {
    throw new Error(`Payload must not be undefined for action: ${type}`);
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Payload must be a plain object for action: ${type}`);
  }
  const requiredKeys = ALLOWED_ACTIONS[type];
  for (const key of requiredKeys) {
    if (!(key in payload)) {
      throw new Error(`Missing required key: "${key}" in payload for action: ${type}`);
    }
  }
  
  if (type === 'IMPORT_STATE') {
    const { data } = payload;
    if (!data || typeof data !== 'object') {
      throw new Error('Imported data must be an object');
    }
  }
}

function cycle(status) {
  if (status === '') return 'done';
  if (status === 'done') return 'failed';
  return '';
}

function reducer(currentState, action) {
  switch (action.type) {
    case 'SET_ACTIVE_SESSION': {
      const { sessionId } = action.payload;
      if (currentState.activeSessionId === sessionId) {
        return currentState;
      }
      return {
        ...currentState,
        activeSessionId: sessionId
      };
    }
    case 'TOGGLE_SET': {
      const { exId, idx } = action.payload;
      
      const currentSets = currentState.exercises[exId] || [];
      const updatedExerciseArray = [...currentSets];
      updatedExerciseArray[idx] = cycle(updatedExerciseArray[idx] || '');
      
      return {
        ...currentState,
        exercises: {
          ...currentState.exercises,
          [exId]: updatedExerciseArray
        }
      };
    }
    case 'RESET_ALL': {
      return createDefaultState();
    }
    case 'IMPORT_STATE': {
      const { data } = action.payload;
      return data;
    }
    default:
      throw new Error(`Unhandled action type in reducer: ${action.type}`);
  }
}

function migrateState(targetState) {
  if (!targetState || typeof targetState !== 'object') {
    return createDefaultState();
  }
  const migrated = {
    activeSessionId: targetState.activeSessionId || workouts[0].id,
    exercises: targetState.exercises || {},
    lastDone: targetState.lastDone || {},
    ...targetState
  };
  migrated.version = CURRENT_STATE_VERSION;
  return migrated;
}

// ==========================================
// ─── DERIVED (Selectors API) ───
// ==========================================

const selectors = {
  getSession(sessionId) {
    return workouts.find(s => s.id === sessionId);
  },
  getActiveSessionId(state) {
    return state.activeSessionId;
  },
  getLastDone(state, sessionId) {
    return state.lastDone[sessionId];
  },
  getExerciseSets(state, exId) {
    return state.exercises[exId] || [];
  },
  getResolvedSetsCount(state, sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return 0;
    const allExercises = session.blocks.flatMap(b => b.exercises);
    let count = 0;
    allExercises.forEach(ex => {
      const arr = state.exercises[ex.id] || [];
      count += arr.filter(s => s === 'done' || s === 'failed').length;
    });
    return count;
  },
  getSessionProgress(state, sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return 0;
    const allExercises = session.blocks.flatMap(b => b.exercises);
    const totalSets = allExercises.reduce((sum, ex) => sum + ex.sets, 0);
    if (totalSets === 0) return 0;
    const resolved = this.getResolvedSetsCount(state, sessionId);
    return Math.round((resolved / totalSets) * 100);
  },
  isSessionComplete(state, sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return false;
    const allExercises = session.blocks.flatMap(b => b.exercises);
    if (allExercises.length === 0) return false;
    return allExercises.every(ex => {
      const arr = state.exercises[ex.id] || [];
      return arr.length > 0 && arr.every(s => s === 'done' || s === 'failed');
    });
  },
  isExerciseComplete(state, exId) {
    const arr = state.exercises[exId] || [];
    return arr.length > 0 && arr.every(s => s === 'done' || s === 'failed');
  }
};

// ==========================================
// ─── RENDER (Pure UI Generation) ───
// ==========================================

function renderTabs(appState) {
  const tabsHtml = workouts.map(session => {
    const isActive = session.id === selectors.getActiveSessionId(appState) ? 'active' : '';
    const lastDoneTs = selectors.getLastDone(appState, session.id);
    let lastDoneText = '';
    if (lastDoneTs) {
      const d = new Date(lastDoneTs);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      lastDoneText = `${months[d.getMonth()]} ${d.getDate()}`;
    }
    
    return `
      <div class="tab ${isActive}" data-session-id="${session.id}">
        ${session.dayLabel}
        <span class="day-label">${session.sessionLabel}</span>
        <span class="last-done">${lastDoneText}</span>
      </div>
    `;
  }).join('');
  
  return `<div class="tabs">${tabsHtml}</div>`;
}

function renderCard(ex, appState) {
  const setStates = selectors.getExerciseSets(appState, ex.id);
  const isCompleted = selectors.isExerciseComplete(appState, ex.id);
  const detail = `${ex.sets} &times; ${ex.reps}${ex.weight ? `<br/>${ex.weight}` : ''}`;
  
  const setDotsHtml = setStates.map((s, idx) => {
    let cssClass = 'set-dot';
    let content = idx + 1;
    if (s === 'done') {
      cssClass += ' done';
      content = '&#10003;';
    } else if (s === 'failed') {
      cssClass += ' failed';
      content = '&#10005;';
    }
    return `<button class="${cssClass}" data-ex-id="${ex.id}" data-set-idx="${idx}">${content}</button>`;
  }).join('');
  
  return `
    <div class="exercise-card ${isCompleted ? 'completed' : ''}" data-ex-id="${ex.id}">
      <div class="exercise-header">
        <div class="ex-letter">${ex.letter}</div>
        <div class="ex-name">${ex.name}</div>
        <div class="ex-detail">${detail}</div>
      </div>
      <div class="set-row">
        ${setDotsHtml}
      </div>
    </div>
  `;
}

function renderBlock(block, appState) {
  return `
    <div class="superset-label">${block.label}</div>
    ${block.exercises.map(ex => renderCard(ex, appState)).join('')}
  `;
}

function renderSession(session, appState) {
  const isActive = session.id === selectors.getActiveSessionId(appState) ? 'active' : '';
  const progressPct = selectors.getSessionProgress(appState, session.id);
  const sessionComplete = selectors.isSessionComplete(appState, session.id);

  return `
    <div class="session ${isActive}" id="${session.id}">
      <div class="progress-wrap">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${progressPct}%"></div>
        </div>
        <div class="progress-pct ${progressPct === 100 ? 'lit' : ''}">${progressPct}%</div>
      </div>
      
      <div class="warmup-bar"><strong>WARM-UP</strong><span> &middot; ${session.warmup.replace('Warm-up: ', '')}</span></div>
      
      ${session.blocks.map(block => renderBlock(block, appState)).join('')}
      
      <div class="finisher-card">
        <div class="finisher-label">Finisher</div>
        <div class="finisher-text">${session.finisher.replace('Finisher: ', '')}</div>
      </div>
      
      <div class="complete-banner ${sessionComplete ? 'visible' : ''}">
        SESSION COMPLETE
        <small>Rest up. You earned it.</small>
      </div>
    </div>
  `;
}

function renderApp(appState) {
  return `
    ${renderTabs(appState)}
    ${workouts.map(session => renderSession(session, appState)).join('')}
  `;
}

function updateSessionCompletion(prevState, nextState) {
  const activeSessionId = nextState.activeSessionId;
  const wasComplete = prevState ? selectors.isSessionComplete(prevState, activeSessionId) : false;
  const isComplete = selectors.isSessionComplete(nextState, activeSessionId);

  if (wasComplete === isComplete) {
    return nextState;
  }

  const nextLastDone = { ...nextState.lastDone };
  if (isComplete) {
    nextLastDone[activeSessionId] = Date.now();
  } else {
    delete nextLastDone[activeSessionId];
  }

  return {
    ...nextState,
    lastDone: nextLastDone
  };
}

function normalizeState(state) {
  if (!state || typeof state !== 'object') {
    state = {};
  }
  const normalized = {
    activeSessionId: state.activeSessionId || workouts[0].id,
    lastDone: state.lastDone || {},
    ...state,
    exercises: { ...(state.exercises || {}) }
  };

  workouts.forEach(session => {
    session.blocks.forEach(block => {
      block.exercises.forEach(ex => {
        const arr = normalized.exercises[ex.id];

        if (!arr || !Array.isArray(arr)) {
          normalized.exercises[ex.id] = Array(ex.sets).fill('');
          return;
        }

        const copy = [...arr];
        if (copy.length > ex.sets) copy.length = ex.sets;
        while (copy.length < ex.sets) copy.push('');

        normalized.exercises[ex.id] = copy;
      });
    });
  });

  return normalized;
}

function commitStateChange(type, payload = {}) {
  try {
    validateAction(type, payload);

    if (type === 'TOGGLE_SET') {
      const now = Date.now();
      const { exId, idx } = payload;
      if (lastSetClick.exId === exId && lastSetClick.idx === idx && (now - lastSetClick.timestamp) < 300) {
        return;
      }
      lastSetClick = { exId, idx, timestamp: now };
    }

    const prevState = state;
    let nextState = reducer(state, { type, payload });

    // Derive completion metadata outside of the reducer
    nextState = updateSessionCompletion(prevState, nextState);

    // Check set done status directly from the action payload without tree-walking
    let isSetDone = false;
    if (type === 'TOGGLE_SET') {
      const { exId, idx } = payload;
      const prevVal = (prevState && prevState.exercises[exId] || [])[idx] || '';
      const nextVal = (nextState.exercises[exId] || [])[idx] || '';
      if (nextVal === 'done' && prevVal !== 'done') {
        isSetDone = true;
      }
    }

    const prevComplete = prevState ? selectors.isSessionComplete(prevState, nextState.activeSessionId) : false;
    const nextComplete = selectors.isSessionComplete(nextState, nextState.activeSessionId);

    if (DEV_MODE) {
      console.log(`[ACTION] ${type}`, payload);
      console.log('[NEXT STATE]', nextState);
    }

    state = nextState;
    saveState();
    renderAppToDOM(state);

    // Trigger non-critical, explicit UI side-effects
    if (isSetDone) {
      startRestTimer();
    }
    if (nextComplete && !prevComplete) {
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }
  } catch (e) {
    console.error(`State commit rejected for action [${type}]:`, e);
  }
}

function renderAppToDOM(appState) {
  const appEl = document.getElementById('app');
  if (appEl && appState) {
    appEl.innerHTML = renderApp(appState);
  }
}

function startRestTimer() {
  clearInterval(restInterval);
  restRemaining = REST_DURATION;
  restTotal = REST_DURATION;
  
  const bar = document.getElementById('rest-timer-bar');
  const fill = document.getElementById('rest-timer-fill');
  const count = document.getElementById('rest-timer-count');
  
  if (bar && fill && count) {
    bar.classList.remove('hidden', 'done-state');
    count.textContent = restRemaining;
    fill.style.width = '100%';
    fill.style.transition = 'none';
    
    // Reflow
    void fill.offsetWidth;
    fill.style.transition = '';
    
    restInterval = setInterval(() => {
      restRemaining--;
      const pct = Math.max(0, (restRemaining / restTotal) * 100);
      fill.style.width = pct + '%';
      count.textContent = restRemaining > 0 ? restRemaining : 'GO';
      
      if (restRemaining <= 0) {
        clearInterval(restInterval);
        bar.classList.add('done-state');
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        setTimeout(() => {
          bar.classList.add('hidden');
          bar.classList.remove('done-state');
        }, 4000);
      }
    }, 1000);
  }
}

function handleSetClick(exId, setIdx) {
  commitStateChange('TOGGLE_SET', { exId, idx: setIdx });
}

function exportState() {
  try {
    const jsonString = JSON.stringify(state, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gym-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Failed to export backup: ' + e.message);
  }
}

function triggerImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const migrated = migrateState(parsed);
        const normalized = normalizeState(migrated);
        
        if (!isValidStateSchema(normalized)) {
          throw new Error('Imported data does not match a valid state schema');
        }
        
        commitStateChange('IMPORT_STATE', { data: normalized });
      } catch (err) {
        alert('Failed to parse or validate backup JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function copyWorkout(btn, appState) {
  const lines = [];
  lines.push('PLANET FITNESS — STRENGTH PLAN');
  lines.push('3525 Washington St');
  lines.push('');
  
  workouts.forEach(session => {
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`${session.dayLabel} — ${session.sessionLabel}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`Warm-up: ${session.warmup.replace('Warm-up: ', '')}`);
    lines.push('');
    
    session.blocks.forEach(block => {
      lines.push(block.label);
      lines.push('');
      block.exercises.forEach(ex => {
        lines.push(`  ${ex.letter}  ${ex.name}`);
        const detail = `${ex.sets} × ${ex.reps}${ex.weight ? `  ${ex.weight}` : ''}`;
        lines.push(`     ${detail}`);
      });
      lines.push('');
    });
    
    lines.push(`Finisher: ${session.finisher.replace('Finisher: ', '')}`);
    lines.push('');
  });
  
  const text = lines.join('\n');
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => flashCopied(btn));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
    flashCopied(btn);
  }
}

function flashCopied(btn) {
  btn.innerHTML = '&#10003; Copied to clipboard';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.innerHTML = '<span>&#x2398;</span> Copy Workout';
    btn.classList.remove('copied');
  }, 2500);
}

function setupEventDelegation() {
  document.addEventListener('click', (e) => {
    const tabEl = e.target.closest('.tab');
    if (tabEl) {
      const sessionId = tabEl.getAttribute('data-session-id');
      if (sessionId) {
        commitStateChange('SET_ACTIVE_SESSION', { sessionId });
      }
      return;
    }
    
    const dotEl = e.target.closest('.set-dot');
    if (dotEl) {
      const exId = dotEl.getAttribute('data-ex-id');
      const setIdx = parseInt(dotEl.getAttribute('data-set-idx'), 10);
      handleSetClick(exId, setIdx);
      return;
    }
    
    if (e.target.closest('#export-btn')) {
      exportState();
      return;
    }
    
    if (e.target.closest('#import-btn')) {
      triggerImport();
      return;
    }
    
    if (e.target.closest('#reset-btn')) {
      if (confirm('Reset all progress?')) {
        clearInterval(restInterval);
        const timerBar = document.getElementById('rest-timer-bar');
        if (timerBar) timerBar.classList.add('hidden');
        commitStateChange('RESET_ALL', {});
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
    
    if (e.target.closest('#copy-btn')) {
      copyWorkout(e.target.closest('#copy-btn'), state);
      return;
    }
  });
}

// ==========================================
// ─── PERSISTENCE (Storage IO) ───
// ==========================================

function loadState() {
  const sources = [
    STORAGE_KEY,
    STORAGE_KEY + '_backup',
    STORAGE_KEY + '_lkg'
  ];

  for (const key of sources) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const migrated = migrateState(parsed);
      const normalized = normalizeState(migrated);
      if (isValidStateSchema(normalized)) {
        state = normalized;
        return;
      }
    } catch (e) {
      // JSON parse error, ignore and check next key
    }
  }

  // Fallback to default state if all recovery options fail
  state = createDefaultState();
}

let writeCounter = 0;
function incrementWriteCounter() {
  writeCounter++;
}
function getWriteCounter() {
  return writeCounter;
}

function saveState() {
  const primary = STORAGE_KEY;
  const backup = STORAGE_KEY + '_backup';
  const lkg = STORAGE_KEY + '_lkg';

  if (DEV_MODE) {
    console.assert(isValidStateSchema(state), 'State schema is invalid!', state);
  }

  try {
    const serialized = JSON.stringify(state);

    localStorage.setItem(backup, localStorage.getItem(primary));
    localStorage.setItem(primary, serialized);

    incrementWriteCounter();
    if (getWriteCounter() >= 2) {
      localStorage.setItem(lkg, serialized);
    }
  } catch (e) {
    console.error('Save failed', e);
  }
}

function isValidStateSchema(appState) {
  if (!appState || typeof appState !== 'object') return false;
  if (typeof appState.version !== 'number') return false;
  if (typeof appState.activeSessionId !== 'string') return false;
  if (!appState.exercises || typeof appState.exercises !== 'object') return false;
  if (!appState.lastDone || typeof appState.lastDone !== 'object') return false;
  
  for (const exId in appState.exercises) {
    const arr = appState.exercises[exId];
    if (!Array.isArray(arr)) return false;
    for (const val of arr) {
      if (val !== '' && val !== 'done' && val !== 'failed') return false;
    }
  }
  return true;
}

// ==========================================
// ─── BOOT ───
// ==========================================

document.addEventListener('DOMContentLoaded', init);