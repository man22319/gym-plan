// ─── Data: Static Workout Definition ─────────────────────────────
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
          { id: 'thu_row', letter: 'A', name: 'Seated Row Machine', sets: 4, reps: '6-8', weight: '25-30 lbs' },
          { id: 'thu_bench', letter: 'B', name: 'Dumbbell Bench Press', sets: 4, reps: '8', weight: '20-25 lbs' }
        ]
      },
      {
        label: 'Superset 2 — Legs',
        exercises: [
          { id: 'thu_leg_curl', letter: 'A', name: 'Seated Leg Curl', sets: 4, reps: '10-15', weight: '40-60 lbs' },
          { id: 'thu_leg_ext', letter: 'B', name: 'Seated Leg Extension', sets: 4, reps: '10-15', weight: '50-70 lbs' }
        ]
      },
      {
        label: 'Superset 3 — Your Moves',
        exercises: [
          { id: 'thu_leg_press', letter: 'A', name: 'Modified Leg Press (Glute Biased)', sets: 4, reps: '10-12', weight: '90-140 lbs' },
          { id: 'thu_lat_pull', letter: 'B', name: 'Lat Pulldown', sets: 3, reps: '8-10', weight: '60-70 lbs' }
        ]
      },
      {
        label: 'Superset 4 — Shoulders / Arms',
        exercises: [
          { id: 'thu_lat_raise', letter: 'A', name: 'Lateral Raise', sets: 3, reps: '12', weight: '10 lbs' },
          { id: 'thu_tri_push', letter: 'B', name: 'Triceps Pushdown', sets: 3, reps: '10', weight: '40-50 lbs' }
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
          { id: 'sat_row_1', letter: 'A', name: 'Supported Single-Arm Row', sets: 3, reps: '8-10', weight: '25-30 lbs' },
          { id: 'sat_row_2', letter: 'B', name: 'Supported Single-Arm Row', sets: 3, reps: '8-10', weight: '25-30 lbs' }
        ]
      },
      {
        label: 'Superset 2 — Legs',
        exercises: [
          { id: 'sat_leg_press', letter: 'A', name: 'Leg Press', sets: 4, reps: '10-12', weight: '100-140 lbs' },
          { id: 'sat_leg_curl', letter: 'B', name: 'Seated Leg Curl', sets: 3, reps: '10-12', weight: '40-60 lbs' }
        ]
      },
      {
        label: 'Superset 3 — Arms / Shoulders',
        exercises: [
          { id: 'sat_lat_raise', letter: 'A', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: '10 lbs' },
          { id: 'sat_tri_push', letter: 'B', name: 'Triceps Pushdown', sets: 3, reps: '10-12', weight: '40-60 lbs' },
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
          { id: 'mon_leg_press', letter: 'A', name: 'Leg Press', sets: 4, reps: '8-12', weight: '140-200 lbs' },
          { id: 'mon_leg_curl', letter: 'B', name: 'Seated Leg Curl', sets: 3, reps: '10-12', weight: '40-60 lbs' }
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
          { id: 'mon_lat_raise', letter: 'A', name: 'Lateral Raise', sets: 3, reps: '12-15', weight: '10 lbs' }
        ]
      }
    ]
  }
];

// ─── State: Dynamic User Progress ────────────────────────────────
const STORAGE_KEY = 'pf_tracker_v3';
const REST_DURATION = 90;

let state = {
  version: 1,
  activeSessionId: 'session_thu',
  exercises: {}, // e.g. { 'thu_row': ['done', 'failed', '', ''] }
  lastDone: {}   // e.g. { 'session_thu': 168434343 }
};

let restInterval = null;
let restRemaining = 0;
let restTotal = REST_DURATION;

// ─── Initialization & Persistence ────────────────────────────────
function init() {
  loadState();
  if (!state.activeSessionId) state.activeSessionId = workouts[0].id;
  
  // ensure exercise state array exists for all exercises
  workouts.forEach(session => {
    session.blocks.forEach(block => {
      block.exercises.forEach(ex => {
        if (!state.exercises[ex.id]) {
          state.exercises[ex.id] = Array(ex.sets).fill('');
        } else if (state.exercises[ex.id].length !== ex.sets) {
          // Adjust length if user changed data sets definition
          const arr = state.exercises[ex.id];
          if (arr.length > ex.sets) arr.length = ex.sets;
          while(arr.length < ex.sets) arr.push('');
        }
      });
    });
  });
  
  renderApp();
  setupEventDelegation();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === state.version) {
        state = { ...state, ...parsed };
      }
    }
  } catch (e) {
    console.error('Failed to load state', e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state', e);
  }
}

// ─── Render Functions ────────────────────────────────────────────

function renderApp() {
  const appEl = document.getElementById('app');
  if (!appEl) return;
  
  const html = `
    ${renderTabs()}
    ${workouts.map(session => renderSession(session)).join('')}
  `;
  appEl.innerHTML = html;
}

function renderTabs() {
  const tabsHtml = workouts.map(session => {
    const isActive = session.id === state.activeSessionId ? 'active' : '';
    const lastDoneTs = state.lastDone[session.id];
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

function renderSession(session) {
  const isActive = session.id === state.activeSessionId ? 'active' : '';
  
  const allExercises = session.blocks.flatMap(b => b.exercises);
  const totalSets = allExercises.reduce((sum, ex) => sum + ex.sets, 0);
  let resolvedSets = 0;
  
  allExercises.forEach(ex => {
    const arr = state.exercises[ex.id] || [];
    resolvedSets += arr.filter(s => s === 'done' || s === 'failed').length;
  });
  
  const progressPct = totalSets > 0 ? Math.round((resolvedSets / totalSets) * 100) : 0;
  
  let cardsDoneCount = 0;
  allExercises.forEach(ex => {
    const arr = state.exercises[ex.id] || [];
    const isCardDone = arr.length > 0 && arr.every(s => s === 'done' || s === 'failed');
    if (isCardDone) cardsDoneCount++;
  });
  
  const sessionComplete = allExercises.length > 0 && cardsDoneCount === allExercises.length;
  
  if (sessionComplete && !state.lastDone[session.id]) {
    state.lastDone[session.id] = Date.now();
    saveState();
    // setTimeout to avoid recursive render in same tick
    setTimeout(renderApp, 0);
  }

  return `
    <div class="session ${isActive}" id="${session.id}">
      <div class="progress-wrap">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${progressPct}%"></div>
        </div>
        <div class="progress-pct ${progressPct === 100 ? 'lit' : ''}">${progressPct}%</div>
      </div>
      
      <div class="warmup-bar"><strong>WARM-UP</strong><span> &middot; ${session.warmup.replace('Warm-up: ', '')}</span></div>
      
      ${session.blocks.map(block => renderBlock(block)).join('')}
      
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

function renderBlock(block) {
  return `
    <div class="superset-label">${block.label}</div>
    ${block.exercises.map(ex => renderCard(ex)).join('')}
  `;
}

function renderCard(ex) {
  const setStates = state.exercises[ex.id] || Array(ex.sets).fill('');
  const isCompleted = setStates.length > 0 && setStates.every(s => s === 'done' || s === 'failed');
  
  const detail = `${ex.sets} &times; ${ex.reps}${ex.weight ? `<br/>${ex.weight}` : ''}`;
  
  return `
    <div class="exercise-card ${isCompleted ? 'completed' : ''}" data-ex-id="${ex.id}">
      <div class="exercise-header">
        <div class="ex-letter">${ex.letter}</div>
        <div class="ex-name">${ex.name}</div>
        <div class="ex-detail">${detail}</div>
      </div>
      <div class="set-row">
        ${setStates.map((s, idx) => {
          let cssClass = 'set-dot';
          let content = idx + 1;
          if (s === 'done') { cssClass += ' done'; content = '&#10003;'; }
          else if (s === 'failed') { cssClass += ' failed'; content = '&#10005;'; }
          return `<button class="${cssClass}" data-ex-id="${ex.id}" data-set-idx="${idx}">${content}</button>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ─── Event Delegation ────────────────────────────────────────────
function setupEventDelegation() {
  document.addEventListener('click', (e) => {
    // Tab clicks
    const tabEl = e.target.closest('.tab');
    if (tabEl) {
      const sessionId = tabEl.getAttribute('data-session-id');
      if (sessionId && state.activeSessionId !== sessionId) {
        state.activeSessionId = sessionId;
        saveState();
        renderApp();
      }
      return;
    }
    
    // Set dot clicks
    const dotEl = e.target.closest('.set-dot');
    if (dotEl) {
      const exId = dotEl.getAttribute('data-ex-id');
      const setIdx = parseInt(dotEl.getAttribute('data-set-idx'), 10);
      handleSetClick(exId, setIdx);
      return;
    }
    
    // Reset button
    if (e.target.closest('#reset-btn')) {
      if (confirm('Reset all progress?')) {
        clearInterval(restInterval);
        document.getElementById('rest-timer-bar').classList.add('hidden');
        
        state.exercises = {};
        workouts.forEach(session => {
          session.blocks.forEach(block => {
            block.exercises.forEach(ex => {
              state.exercises[ex.id] = Array(ex.sets).fill('');
            });
          });
        });
        state.lastDone = {};
        saveState();
        renderApp();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
    
    // Copy button
    if (e.target.closest('#copy-btn')) {
      copyWorkout(e.target.closest('#copy-btn'));
      return;
    }
  });
}

function handleSetClick(exId, setIdx) {
  const currentStatus = state.exercises[exId][setIdx];
  let nextStatus = '';
  
  if (currentStatus === '') {
    nextStatus = 'done';
    startRestTimer();
  } else if (currentStatus === 'done') {
    nextStatus = 'failed';
  } else {
    nextStatus = '';
  }
  
  state.exercises[exId][setIdx] = nextStatus;
  saveState();
  renderApp();
}

// ─── Rest Timer ──────────────────────────────────────────────────
function startRestTimer() {
  clearInterval(restInterval);
  restRemaining = REST_DURATION;
  restTotal = REST_DURATION;
  
  const bar = document.getElementById('rest-timer-bar');
  const fill = document.getElementById('rest-timer-fill');
  const count = document.getElementById('rest-timer-count');
  
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

// ─── Copy Workout ────────────────────────────────────────────────
function copyWorkout(btn) {
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

// ─── Boot ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
