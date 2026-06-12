import { workouts, programDefaults } from '../core/workouts.js';
import { query } from '../core/queries.js';
import { getEffectiveExercise } from '../core/helpers.js';



export let editingExId = null;
export function setEditingExId(val) { editingExId = val; }

export function formatReps(reps) {
  if (!reps || typeof reps !== 'object') return '—';
  if (reps.min === reps.max) return String(reps.min);
  return `${reps.min}–${reps.max}`;
}

export function formatWeight(weight) {
  if (!weight || typeof weight !== 'object') return '';
  const unit = weight.unit || '';
  if ('min' in weight && 'max' in weight) {
    if (weight.min === weight.max) return `${weight.min} ${unit}`.trim();
    return `${weight.min}–${weight.max} ${unit}`.trim();
  }
  if ('value' in weight) return `${weight.value} ${unit}`.trim();
  return '';
}

export function formatDuration(ms) {
  if (!ms || ms <= 0) return null;
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return '< 1 min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return `${h}h ${m}m`;
}

export function formatDate(ts) {
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

export function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function getTrainingWeekAndSession(appState) {
  return query.weekAndSession(appState);
}

let lastRenderedSessionId = null;

export function render(appState) {
  const el = document.getElementById('app');
  if (!el) return;

  const sessionIdChanged = lastRenderedSessionId !== appState.activeSessionId;
  lastRenderedSessionId = appState.activeSessionId;

  if (sessionIdChanged) {
    el.classList.add('animate-entrance');
  } else {
    el.classList.remove('animate-entrance');
  }

  el.innerHTML = buildApp(appState);

  const { week, session } = getTrainingWeekAndSession(appState);
  const weekSessionEl = document.getElementById('week-session-display');
  if (weekSessionEl) {
    weekSessionEl.textContent = `Week ${week} · Session ${session}`;
  }

  const progContainer = document.getElementById('global-progress-bar-container');
  if (progContainer) {
    const activeSessionId = appState.activeSessionId;
    const pct = activeSessionId ? query.sessionProgress(appState, activeSessionId) : 0;
    progContainer.innerHTML = `
      <div class="progress-wrap">
        <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
        <div class="progress-pct ${pct === 100 ? 'lit' : ''}">${pct}%</div>
      </div>
    `;
  }
  
  initScrollObserver();
}

export function buildApp(appState) {
  return buildTabs(appState) +
    workouts.map(s => buildSession(s, appState)).join('');
}

export function getSuggestedSessionId(appState) {
  const history = query.chronological(appState);
  if (!history.length) {
    return workouts[0]?.id || null;
  }
  const lastEntry = history[history.length - 1];
  const lastSessionId = lastEntry.sessionId;
  const lastIndex = workouts.findIndex(s => s.id === lastSessionId);
  if (lastIndex === -1) {
    return workouts[0]?.id || null;
  }
  const nextIndex = (lastIndex + 1) % workouts.length;
  return workouts[nextIndex]?.id || null;
}

export function buildTabs(appState) {
  const suggestedId = getSuggestedSessionId(appState);

  const tabs = workouts.map(session => {
    const active    = session.id === appState.activeSessionId ? 'active' : '';
    const ts        = query.lastDoneTimestamp(appState, session.id);

    let recency = '';
    if (ts) {
      const today = new Date();
      const doneDate = new Date(ts);
      const d1 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const d2 = new Date(doneDate.getFullYear(), doneDate.getMonth(), doneDate.getDate());
      const diffDays = Math.round((d1 - d2) / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        recency = 'today';
      } else if (diffDays === 1) {
        recency = 'yesterday';
      } else {
        recency = `${diffDays}d ago`;
      }
    } else {
      recency = 'never';
    }

    const isSuggested = session.id === suggestedId;
    const badgeHtml = isSuggested ? `<span class="suggested-badge">due</span>` : '';
    const dateLabel = ts ? formatDate(ts) : 'never';

    return `<div class="tab ${active}" data-session-id="${session.id}">
      ${badgeHtml}
      ${session.dayLabel}
      <span class="day-label">${session.sessionLabel}</span>
      <span class="last-done">${dateLabel} · <span class="recency">${recency}</span></span>
    </div>`;
  }).join('');
  return `<div class="tabs">${tabs}</div>`;
}

export function buildSession(session, appState) {
  const active    = session.id === appState.activeSessionId ? 'active' : '';
  const finished  = query.isSessionFinishedInCurrentWeek(appState, session.id);
  const complete  = query.isSessionComplete(appState, session.id) && !finished && appState.sessionStarted !== null;
  const c = appState?.cardio || {};
  const warmupDone   = c.warmupDone   === true;
  const finisherDone = c.finisherDone === true;

  let bannerHtml = '';
  if (finished) {
    bannerHtml = `
      <div class="complete-banner visible finished-banner">
        SESSION LOGGED<small>This workout has been saved to your history.</small>
      </div>`;
  } else {
    bannerHtml = `
      <div class="complete-banner ${complete ? 'visible' : ''}">
        SESSION COMPLETE<small>Rest up. You earned it.</small>
        <button class="finish-workout-btn" data-session-id="${session.id}">Finish Workout</button>
      </div>`;
  }

  // warmup and finisher: read from session first, fall back to programDefaults
  const warmupText   = session.warmup   ?? appState.programDefaults?.warmup   ?? programDefaults.warmup   ?? '';
  const finisherText = session.finisher ?? appState.programDefaults?.finisher ?? programDefaults.finisher ?? '';

  return `<div class="session ${active}" id="${session.id}">
    <div class="warmup-bar ${warmupDone ? 'warmup-done' : ''}">
      <div style="flex:1; min-width:0;">
        <span><strong>WARM-UP</strong> <span>· ${warmupText}</span></span>
      </div>
      <input
        type="checkbox"
        class="warmup-checkbox"
        data-cardio-field="warmupDone"
        id="cardio-warmup-${session.id}"
        ${warmupDone ? 'checked' : ''}
        ${finished ? 'disabled' : ''}
        aria-label="Warmup done"
      />
    </div>
    ${session.blocks.map(b => buildBlock(b, appState, finished)).join('')}
    <div class="finisher-card ${finisherDone ? 'finisher-done' : ''}">
      <div class="finisher-card-body">
        <div class="finisher-label">Finisher</div>
        <div class="finisher-text">${finisherText}</div>
      </div>
      <input
        type="checkbox"
        class="finisher-checkbox"
        data-cardio-field="finisherDone"
        id="cardio-finisher-${session.id}"
        ${finisherDone ? 'checked' : ''}
        ${finished ? 'disabled' : ''}
        aria-label="Finisher done"
      />
    </div>
    ${bannerHtml}
  </div>`;
}

/**
 * Renders the cardio input form for the current session.
 *
 * Design contract (per TODO §3 + user architecture):
 * - Cardio is an execution artifact: inputs stage into state.cardio (transient)
 * - On FINISH_WORKOUT the reducer commits state.cardio → history[].cardio, then clears it
 * - This form NEVER writes to sessions[] or any permanent structure
 *
 * Pre-fills from appState.cardio if already entered in this session.
 *
 * @param {object} appState
 * @returns {string} HTML string
 */


export function buildBlock(block, appState, readOnly = false) {
  return `<section class="superset-section" data-block-id="${block.label}">
    <div class="superset-label">${block.label}</div>
    ${block.exercises.map(ex => buildCard(ex, appState, readOnly)).join('')}
  </section>`;
}

export function buildCard(ex, appState, readOnly = false) {
  const instanceId = ex.instanceId;
  const sets      = appState.exercises[instanceId] || [];
  const complete  = query.isExerciseComplete(appState, instanceId);
  const prevSets  = query.lastExerciseSets(appState, instanceId);
  
  const effEx     = getEffectiveExercise(appState, instanceId);
  const displayName = effEx?.name ?? ex.name ?? instanceId;
  const isOverridden = !!appState?.runtimeOverrides?.[instanceId];
  
  const wStr      = formatWeight(effEx?.load);
  const prs       = query.currentSetPRs(appState, instanceId);
  const hasPR     = prs.length > 0;

  const currentSetsWithNotes = sets.filter(s => s.n && s.n.trim());
  let currentNotesHtml = '';
  if (currentSetsWithNotes.length > 0) {
    currentNotesHtml = `<div class="live-notes-row">
      ${currentSetsWithNotes.map(s => `<span class="live-note-chip">S${sets.indexOf(s) + 1}: ${s.n}</span>`).join('')}
    </div>`;
  }


  const isOverriddenClass = isOverridden ? 'overridden' : '';
  const overrideIndicator = isOverridden ? ' <span class="ex-override-indicator" title="Custom targets active">●</span>' : '';

  const editBtnHtml = readOnly ? '' : `<button class="ex-edit-btn" data-ex-id="${instanceId}" aria-label="Edit targets" title="Edit targets">✎</button>`;
  const editPanelHtml = (editingExId === instanceId && !readOnly) ? buildEditPanel(ex, appState) : '';

  return `<div class="exercise-card ${complete ? 'completed' : ''}" data-ex-id="${instanceId}">
    <div class="exercise-header" data-ex-id="${instanceId}" role="button" aria-label="View history for ${displayName}" tabindex="0" ${readOnly ? 'style="cursor: default;"' : ''}>
      <div class="ex-letter">${ex.letter || ''}</div>
      <div class="ex-title-group">
        <div class="ex-name">
          <span class="ex-name-text">${displayName}</span>
          ${hasPR ? `<span class="pr-badge" title="Personal Record!">🏆</span>` : ''}
        </div>
        <div class="ex-info-group ex-metadata-row-sub">
          <span class="ex-metadata-sets-reps">${effEx?.sets ?? '?'} × ${formatReps(effEx?.reps)}</span>
          ${wStr ? `<span class="ex-metadata-weight-tag ${isOverriddenClass}">${wStr}${overrideIndicator}</span>` : ''}
          ${effEx?.equipmentType ? `<span class="ex-metadata-type-badge">${effEx.equipmentType}</span>` : ''}
        </div>
      </div>
      <div class="ex-header-right-actions">
        <div class="ex-history-hint">HISTORY</div>
        ${editBtnHtml}
      </div>
    </div>
    ${editPanelHtml}
    ${buildNotesRow(ex, appState)}
    ${buildPrevRow(prevSets, sets)}
    ${currentNotesHtml}
    <div class="set-row">
      ${sets.map((s, i) => buildDot(instanceId, i, s, readOnly)).join('')}
    </div>
  </div>`;
}

export function buildEditPanel(ex, appState) {
  const instanceId = ex.instanceId;
  const effEx = getEffectiveExercise(appState, instanceId);

  // Use .load only — no .weight alias
  const weightObj = effEx?.load;
  let weightVal = '';
  if (weightObj) {
    weightVal = weightObj.value ?? weightObj.min ?? '';
  }

  const repMin = effEx?.reps?.min ?? '';
  const repMax = effEx?.reps?.max ?? '';

  const notesVal = effEx?.notes ?? '';

  return `
    <div class="ex-edit-panel" data-ex-id="${instanceId}">
      <div class="ex-edit-fields">
        <div class="ex-edit-field">
          <label for="edit-weight-${instanceId}">Target Weight</label>
          <div class="ex-edit-input-wrap">
            <input type="number" class="ex-edit-input" id="edit-weight-${instanceId}" step="2.5" min="0" value="${weightVal}" placeholder="Prescribed weight" />
            <span class="ex-edit-unit">lbs</span>
          </div>
        </div>
        <div class="ex-edit-field">
          <label>Reps (Min / Max)</label>
          <div class="ex-edit-reps-wrap">
            <input type="number" class="ex-edit-input" id="edit-repmin-${instanceId}" min="0" value="${repMin}" placeholder="Min" />
            <span class="ex-edit-reps-dash">—</span>
            <input type="number" class="ex-edit-input" id="edit-repmax-${instanceId}" min="0" value="${repMax}" placeholder="Max" />
          </div>
        </div>
        <div class="ex-edit-field" style="grid-column: span 2;">
          <label for="edit-notes-${instanceId}">Exercise Notes</label>
          <div class="ex-edit-input-wrap">
            <textarea class="ex-edit-textarea" id="edit-notes-${instanceId}" placeholder="e.g. seat height 4, focus on squeeze" rows="2">${notesVal}</textarea>
          </div>
        </div>
      </div>
      <div class="ex-edit-actions">
        <button class="ex-edit-btn-cancel" data-ex-id="${instanceId}">Cancel</button>
        <button class="ex-edit-btn-save" data-ex-id="${instanceId}">Save</button>
      </div>
    </div>
  `;
}

export function buildNotesRow(ex, appState) {
  const instanceId = ex.instanceId;
  const effEx = getEffectiveExercise(appState, instanceId);
  const hasNotes = effEx?.notes && effEx.notes.trim();

  if (!hasNotes) return '';

  return `<div class="ex-meta-row">
    <span class="ex-notes">${effEx.notes}</span>
  </div>`;
}





export function buildPrevRow(prevSets, currSets) {
  if (!prevSets) return '';
  const logged = prevSets.filter(s => s.w !== null || s.r !== null);
  if (!logged.length) return '';

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

export function buildDelta(weightDelta, repsDelta) {
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

export function buildDot(exId, idx, setObj, readOnly = false) {
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
    ${readOnly ? 'disabled style="pointer-events: none; opacity: 0.8;"' : ''}
    aria-label="Set ${idx + 1}: tap to toggle, hold to log">${inner}</button>`;
}

export function initScrollObserver() {
  if (typeof IntersectionObserver === 'undefined') return;
  const options = {
    root: null,
    rootMargin: '-30% 0px -30% 0px',
    threshold: 0.1
  };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-focus');
        entry.target.classList.remove('out-of-focus');
      } else {
        entry.target.classList.remove('in-focus');
        entry.target.classList.add('out-of-focus');
      }
    });
  }, options);
  document.querySelectorAll('.superset-section').forEach(sec => {
    observer.observe(sec);
  });
}
