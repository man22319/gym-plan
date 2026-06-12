import { workouts, programDefaults, EXERCISE_INDEX, EX_SESSION_INDEX, state } from '../../core/state/store.js';
import { query } from '../../core/logic/queries.js';
import { getEffectiveExercise } from '../../core/utils/helpers.js';
import { updateProgressionState } from '../../core/logic/progression.js';
import { calculateETA } from '../../core/utils/eta.js';




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
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
    // ── Tab switch: patch tabs in-place, cross-fade only session content ──
    // Tabs stay visible throughout — only the active class toggles.
    patchTabs(appState);

    // Find or create the session-content wrapper
    let contentEl = el.querySelector('.session-content');
    if (!contentEl) {
      // First render used the old layout — rebuild with the new structure
      el.innerHTML = buildTabsHtml(appState) +
        `<div class="session-content">${buildSessionsHtml(appState)}</div>`;
      updateProgressBar(appState);
      updateWeekSession(appState);
      initScrollObserver(true);
      return;
    }

    // CSS fade-out → swap at opacity 0 → fade-in
    contentEl.classList.remove('is-entering');
    contentEl.classList.add('is-leaving');

    const doSwap = () => {
      contentEl.removeEventListener('transitionend', doSwap);
      contentEl.innerHTML = buildSessionsHtml(appState);
      contentEl.classList.remove('is-leaving');
      contentEl.classList.add('is-entering');
      // Remove is-entering after the last card's animation completes
      // (150ms max delay + 450ms duration = 600ms).  Using a timeout
      // instead of animationend because the event bubbles from child
      // cards and can fire prematurely from the first card, not the last.
      setTimeout(() => contentEl.classList.remove('is-entering'), 620);
      updateProgressBar(appState);
      updateWeekSession(appState);
      initScrollObserver(true);
    };
    contentEl.addEventListener('transitionend', doSwap, { once: true });
  } else {
    // Intra-session full rebuild (non-set-toggle paths like edit save, etc.)
    el.innerHTML = buildTabsHtml(appState) +
      `<div class="session-content">${buildSessionsHtml(appState)}</div>`;
    updateProgressBar(appState);
    updateWeekSession(appState);
    initScrollObserver(true);
  }
}

function updateWeekSession(appState) {
  const { week, session } = getTrainingWeekAndSession(appState);
  const weekSessionEl = document.getElementById('week-session-display');
  if (weekSessionEl) {
    weekSessionEl.textContent = `Week ${week} · Session ${session}`;
  }
}

function updateProgressBar(appState) {
  const progContainer = document.getElementById('global-progress-bar-container');
  if (!progContainer) return;

  const pct = appState.activeSessionId
    ? query.sessionProgress(appState, appState.activeSessionId)
    : 0;

  // Build the scaffold once; update fill width in-place so the CSS transition fires.
  // Recreating innerHTML resets width to 0 every time, killing the transition.
  let fill = progContainer.querySelector('.progress-bar-fill');
  if (!fill) {
    progContainer.innerHTML = `
      <div class="progress-wrap">
        <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:0%"></div></div>
        <div class="progress-pct"></div>
      </div>
      <div class="progress-stats" id="progress-stats">
        <div class="progress-stat" id="stat-elapsed">
          <span class="progress-stat-label">ELAPSED</span>
          <span class="progress-stat-value" id="elapsed-display">—</span>
        </div>
        <div class="progress-stat-divider" id="stat-divider-1"></div>
        <div class="progress-stat" id="stat-eta">
          <span class="progress-stat-label">REMAINING</span>
          <span class="progress-stat-value" id="eta-display">—</span>
        </div>
        <div class="progress-stat-divider" id="stat-divider-2"></div>
        <div class="progress-stat" id="stat-departure">
          <span class="progress-stat-label">EST. DONE</span>
          <span class="progress-stat-value" id="eta-departure-header">—</span>
        </div>
      </div>`;
    fill = progContainer.querySelector('.progress-bar-fill');
  }

  fill.style.width = pct + '%';
  const pctEl = progContainer.querySelector('.progress-pct');
  if (pctEl) {
    pctEl.textContent = pct + '%';
    pctEl.className = 'progress-pct' + (pct === 100 ? ' lit' : '');
  }

  updateETADisplay(appState);
  updateElapsedDisplay(appState);
}

export function buildApp(appState) {
  return buildTabs(appState) +
    workouts.map(s => buildSession(s, appState)).join('');
}

// Split helpers — used by the new render() to separate tabs from session content
function buildTabsHtml(appState) {
  return buildTabs(appState);
}

function buildSessionsHtml(appState) {
  return workouts.map(s => buildSession(s, appState)).join('');
}

/**
 * Patch tabs in-place by toggling the .active class on existing DOM nodes.
 * This avoids destroying and recreating the tab bar during session switches,
 * keeping it visually stable while the session content cross-fades.
 */
function patchTabs(appState) {
  const tabEls = document.querySelectorAll('.tab[data-session-id]');
  tabEls.forEach(tab => {
    const isActive = tab.dataset.sessionId === appState.activeSessionId;
    tab.classList.toggle('active', isActive);
    // Update the day-label styling that depends on .active
    const dayLabel = tab.querySelector('.day-label');
    if (dayLabel) {
      dayLabel.style.color = ''; // let CSS handle it via .tab.active .day-label
    }
  });
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
    const active = session.id === appState.activeSessionId ? 'active' : '';
    const finished = query.isSessionFinishedInCurrentWeek(appState, session.id);
    const ts = query.lastDoneTimestamp(appState, session.id);

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

    const isSuggested = !finished && session.id === suggestedId;
    // Completed-this-week badge takes priority over "due"
    const badgeHtml = finished
      ? `<span class="completed-tab-badge">✓</span>`
      : (isSuggested ? `<span class="suggested-badge">due</span>` : '');
    const dateLabel = ts ? formatDate(ts) : 'never';

    return `<div class="tab ${active} ${finished ? 'tab-finished' : ''}" data-session-id="${session.id}">
      ${badgeHtml}
      ${session.dayLabel}
      <span class="day-label">${session.sessionLabel}</span>
      <span class="last-done">${dateLabel} · <span class="recency">${recency}</span></span>
    </div>`;
  }).join('');
  return `<div class="tabs">${tabs}</div>`;
}

export function buildSession(session, appState) {
  const active = session.id === appState.activeSessionId ? 'active' : '';
  const finished = query.isSessionFinishedInCurrentWeek(appState, session.id);
  const complete = query.isSessionComplete(appState, session.id) && !finished && appState.sessionStarted !== null;
  const c = appState?.cardio || {};
  const warmupDone = c.warmupDone === true;
  const finisherDone = c.finisherDone === true;

  let bannerHtml = '';
  if (finished) {
    // Derive a friendly timestamp from the last history entry for this session
    const lastEntry = query.lastSession(appState, session.id);
    const finishedAtStr = lastEntry?.timestamp ? formatTime(lastEntry.timestamp) : null;
    const finishedOnStr = lastEntry?.timestamp ? formatDate(lastEntry.timestamp) : null;
    const timeLabel = (finishedAtStr && finishedOnStr) ? `${finishedOnStr} at ${finishedAtStr}` : 'this week';
    bannerHtml = `
      <div class="complete-banner visible finished-banner">
        <div class="finished-banner-icon">✓</div>
        <div class="finished-banner-body">
          <span class="finished-banner-title">SESSION COMPLETED</span>
          <small>Logged ${timeLabel} · View only</small>
        </div>
      </div>`;
  } else {
    bannerHtml = `
      <div class="complete-banner ${complete ? 'visible' : ''}">
        SESSION COMPLETE<small>Rest up. You earned it.</small>
        <div class="eta-departure" id="eta-departure"></div>
        <button class="finish-workout-btn" data-session-id="${session.id}">Finish Workout</button>
      </div>`;
  }

  // warmup and finisher: read from session first, fall back to programDefaults
  const warmupText = session.warmup ?? appState.programDefaults?.warmup ?? programDefaults.warmup ?? '';
  const finisherText = session.finisher ?? appState.programDefaults?.finisher ?? programDefaults.finisher ?? '';

  return `<div class="session ${active} ${finished ? 'session-completed' : ''}" id="${session.id}">
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
      <div style="flex:1; min-width:0;">
        <span><strong>FINISHER</strong> <span>· ${finisherText}</span></span>
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
  const sets = appState.exercises[instanceId] || [];
  const complete = query.isExerciseComplete(appState, instanceId);
  const prevSets = query.lastExerciseSets(appState, instanceId);

  const effEx = getEffectiveExercise(appState, instanceId);
  const displayName = effEx?.name ?? ex.name ?? instanceId;
  const isOverridden = !!appState?.runtimeOverrides?.[instanceId];

  const wStr = formatWeight(effEx?.load);
  const prs = query.currentSetPRs(appState, instanceId);
  const hasPR = prs.length > 0;

  const currentSetsWithNotes = sets.filter(s => s.n && s.n.trim());
  let currentNotesHtml = '';
  if (currentSetsWithNotes.length > 0) {
    currentNotesHtml = `<div class="live-notes-row">
      ${currentSetsWithNotes.map(s => `<span class="live-note-chip">S${sets.indexOf(s) + 1}: ${s.n}</span>`).join('')}
    </div>`;
  }

  const isOverriddenClass = isOverridden ? 'overridden' : '';
  const overrideIndicator = isOverridden ? ' <span class="ex-override-indicator" title="Custom targets active">●</span>' : '';

  // In completed sessions: show a LOGGED badge instead of the edit button; header is non-interactive
  const loggedBadgeHtml = readOnly ? `<span class="ex-logged-badge">LOGGED</span>` : '';
  const editBtnHtml = readOnly ? '' : `<button class="ex-edit-btn" data-ex-id="${instanceId}" aria-label="Edit targets" title="Edit targets">✎</button>`;
  const editPanelHtml = (editingExId === instanceId && !readOnly) ? buildEditPanel(ex, appState) : '';

  // In completed sessions the card should appear fully lit (not faded) since all sets are done
  const cardClass = readOnly ? 'session-done-card' : (complete ? 'completed' : '');

  // Layer B: live progression row (active) or review row (finished)
  const progressionRowHtml = buildProgressionRow(instanceId, appState, readOnly);

  return `<div class="exercise-card ${cardClass}" data-ex-id="${instanceId}">
    <div class="exercise-header" data-ex-id="${instanceId}" role="button" aria-label="View history for ${displayName}" tabindex="0" ${readOnly ? 'style="cursor: default; pointer-events: none;"' : ''}>
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
        ${loggedBadgeHtml}
        <div class="ex-history-hint" ${readOnly ? 'style="display:none;"' : ''}>HISTORY</div>
        ${editBtnHtml}
      </div>
    </div>
    ${editPanelHtml}
    ${buildNotesRow(ex, appState)}
    ${progressionRowHtml}
    ${buildPrevRow(prevSets, sets)}
    ${currentNotesHtml}
    <div class="set-row">
      ${sets.map((s, i) => buildDot(instanceId, i, s, readOnly, effEx)).join('')}
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
    return `<span class="prev-set">S${i + 1} <span class="prev-nums">${w}&times;${r}</span>${fail}</span>`;
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

// ── Model confidence helper ───────────────────────────────────────────────────

/**
 * Compute model confidence as EMA convergence fraction.
 *
 * The strength estimator T is an EMA with learning rate η = 0.2.
 * After n sessions it has absorbed (1 - (1-η)^n) of the true signal.
 * This is a principled, parameter-free confidence metric that matches
 * exactly the uncertainty in T itself.
 *
 * @param {number} n  — number of completed sessions for this exercise
 * @returns {{ pct: number, label: string, level: 'low'|'med'|'high' }}
 */
function modelConfidence(n) {
  const ETA = 0.2; // must match DEFAULTS.η in progression.js
  const pct = Math.round((1 - Math.pow(1 - ETA, n)) * 100);
  const level = pct < 40 ? 'low' : pct < 75 ? 'med' : 'high';
  const label = level === 'high' ? 'HIGH' : level === 'med' ? 'MED' : 'LOW';
  return { pct, label, level };
}

// ── Layer B: Live Progression Row ─────────────────────────────────────────────

/**
 * Compute and render the coaching row for an exercise card.
 *
 * Active session (readOnly = false):
 *   Calls updateProgressionState() live against current sets — pure computation,
 *   no dispatch, no persistence. Updates after every set via the normal render cycle.
 *
 * Finished session (readOnly = true):
 *   Reads from committed progressionState[exId] — evaluation/review mode.
 *
 * Confidence: derived from EMA convergence (1 - (1-η)^n), shown on every
 * weight suggestion chip. Low/Med/High classification with colour coding.
 *
 * Returns '' for invariant exercises or exercises with no usable data.
 */
export function buildProgressionRow(instanceId, appState, readOnly = false) {
  const ex = EXERCISE_INDEX[instanceId];
  if (ex?.invariant) return '';


  // n = number of history entries that contain data for this exercise
  const historyN = query.exerciseHistory(appState, instanceId).length;
  const conf = modelConfidence(historyN);

  const chips = [];

  if (readOnly) {
    // ── Layer C output: read committed progressionState ──
    const ps = appState?.progressionState?.[instanceId];
    if (!ps || ps.T === null) return '';

    const suggested = ps.lastSuggested;
    const fatigue = ps.F ?? 0;
    const risk = ps.lastRisk ?? 0;
    const suppressed = ps.lastSuppressed ?? false;

    if (suggested !== null && suggested !== undefined) {
      chips.push(
        `<span class="prog-chip prog-chip-review"
           title="Recommended weight for your next session · Model confidence: ${conf.pct}% (${historyN} session${historyN !== 1 ? 's' : ''})">
          NEXT SESSION: <strong>${suggested} lbs</strong>
          <span class="prog-conf prog-conf-${conf.level}">${conf.label} ${conf.pct}%</span>
        </span>`
      );
    }

    if (fatigue > 0.6) {
      chips.push(
        `<span class="prog-chip prog-chip-warn" title="Fatigue index: ${fatigue.toFixed(2)}">
          ⚠  FATIGUE: ${fatigue.toFixed(2)}
        </span>`
      );
    }

    if (risk > 0.65) {
      chips.push(
        `<span class="prog-chip prog-chip-danger" title="Risk score: ${risk.toFixed(2)}">
          ⚠ RISK: ${risk.toFixed(2)}
        </span>`
      );
    }

    if (suppressed) {
      chips.push(
        `<span class="prog-chip prog-chip-suppressed" title="Progression held back due to risk">SUPPRESSED</span>`
      );
    }

  } else {
    // ── Layer B: live computation during active session ──
    const currentSets = appState.exercises[instanceId] || [];
    const hasDoneSet = currentSets.some(s => s.s === 'done' || s.s === 'failed');

    // Retrieve stored progression state as baseline
    const prevPs = appState?.progressionState?.[instanceId] ?? {};
    const deltaW = appState?.runtimeOverrides?.[instanceId]?.deltaW ?? ex?.deltaW;

    // Center-of-range rep anchor for working target
    const targetReps = (ex?.reps?.min && ex?.reps?.max)
      ? (ex.reps.min + ex.reps.max) / 2
      : ex?.reps?.min ?? ex?.reps?.max ?? ex?.reps ?? 8;

    // Hours since last session (from stored timestamp)
    const prevTimestamp = prevPs.lastSessionTimestamp ?? null;
    const hoursElapsed = prevTimestamp
      ? Math.max(0, (Date.now() - prevTimestamp) / 3_600_000)
      : 24;  // bootstrapped prior

    if (hasDoneSet) {
      // At least one set done — compute live update
      const result = updateProgressionState(prevPs, currentSets, {
        deltaW,
        riskMultiplier: ex?.riskMultiplier ?? 1.0,
        density: null,  // density unknown mid-session (no finish timestamp yet)
        targetReps,
        hoursElapsed,
      });

      if (result.suggestedWeight !== null) {
        // Live confidence uses historyN + 1 because the current session is in progress
        const liveConf = modelConfidence(historyN + 1);
        chips.push(
          `<span class="prog-chip"
             title="Live suggested weight from current session · Model confidence: ${liveConf.pct}% (${historyN + 1} session${historyN + 1 !== 1 ? 's' : ''})">
            TARGET: <strong>${result.suggestedWeight} lbs</strong>
            <span class="prog-conf prog-conf-${liveConf.level}">${liveConf.label} ${liveConf.pct}%</span>
          </span>`
        );
      }

      if (result.F > 0.6) {
        chips.push(
          `<span class="prog-chip prog-chip-warn" title="Estimated fatigue: ${result.F.toFixed(2)}">
            ⚠  FATIGUE: ${result.F.toFixed(2)}
          </span>`
        );
      }

      if (result.riskScore > 0.65) {
        chips.push(
          `<span class="prog-chip prog-chip-danger" title="Risk score: ${result.riskScore.toFixed(2)}">
            ⚠ RISK: ${result.riskScore.toFixed(2)}
          </span>`
        );
      }

      if (result.suppressed) {
        chips.push(
          `<span class="prog-chip prog-chip-suppressed" title="Hold steady — progression risk-gated">HOLD WEIGHT</span>`
        );
      }

    } else if (prevPs.lastSuggested !== null && prevPs.lastSuggested !== undefined) {
      // No sets logged yet — show last committed suggestion as a warmup target
      chips.push(
        `<span class="prog-chip prog-chip-preview"
           title="Suggested target from last session · Model confidence: ${conf.pct}% (${historyN} session${historyN !== 1 ? 's' : ''})">
          START: <strong>${prevPs.lastSuggested} lbs</strong>
          <span class="prog-conf prog-conf-${conf.level}">${conf.label} ${conf.pct}%</span>
        </span>`
      );
      if (prevPs.F > 0.6) {
        chips.push(
          `<span class="prog-chip prog-chip-warn" title="Carrying fatigue from last session">
            ⚠  FATIGUE: ${(prevPs.F ?? 0).toFixed(2)}
          </span>`
        );
      }
    }
  }

  if (!chips.length) return '';

  return `<div class="prog-row">${chips.join('')}</div>`;
}


// ── Layer A: Set-level dot feedback ──────────────────────────────────────────

/**
 * Returns a feedback label for a completed/failed set based on how the logged
 * weight compares to the prescribed range in the exercise definition.
 *
 * @param {object} setObj   — { s, w, r }
 * @param {object} effEx    — resolved exercise with .load
 * @returns {string}        — 'light' | 'heavy' | 'on-target' | '' | 'failed'
 */
function getSetFeedback(setObj, effEx) {
  if (setObj.s === 'failed') return 'failed';
  if (setObj.s !== 'done' || setObj.w === null) return '';

  const load = effEx?.load;
  if (!load) return '';

  const w = setObj.w;
  const min = load.min ?? load.value ?? null;
  const max = load.max ?? load.value ?? null;

  if (min === null && max === null) return '';
  if (max !== null && w > max * 1.1) return 'heavy';   // >10% above target max
  if (min !== null && w < min * 0.9) return 'light';   // >10% below target min
  return 'on-target';
}

export function buildDot(exId, idx, setObj, readOnly = false, effEx = null) {
  const { s, w, r } = setObj;
  let cls = 'set-dot';
  let inner = '';

  const hasData = w !== null || r !== null;

  // Layer A: set-level feedback (active sessions only) — label removed; dot colour conveys state
  const feedback = (!readOnly && effEx) ? getSetFeedback(setObj, effEx) : '';

  if (s === 'done') {
    cls += ' done';
    if (feedback === 'light') cls += ' dot-light';
    if (feedback === 'heavy') cls += ' dot-heavy';
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

  if (readOnly) {
    // Completed session: allow long-press to open log modal (view/edit from backup),
    // but mark visually as read-only. Tap-to-toggle is blocked by the reducer guard.
    cls += ' dot-completed-session';
    return `<button class="${cls}"
      data-ex-id="${exId}"
      data-set-idx="${idx}"
      aria-label="Set ${idx + 1}: hold to view log">${inner}</button>`;
  }

  return `<span class="dot-wrap">
    <button class="${cls}"
      data-ex-id="${exId}"
      data-set-idx="${idx}"
      aria-label="Set ${idx + 1}: tap to toggle, hold to log">${inner}</button>
  </span>`;
}

// ── Singleton IntersectionObserver ─────────────────────────────────────────
// Kept as a module-level singleton to avoid re-creating observers on every
// render cycle.  disconnect() is called before re-observing fresh DOM nodes
// to prevent ghost callbacks on stale elements.
let _scrollObserver = null;

export function initScrollObserver(forceRebind = false) {
  if (typeof IntersectionObserver === 'undefined') return;

  // Create the observer once
  if (!_scrollObserver) {
    _scrollObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-focus');
          entry.target.classList.remove('out-of-focus');
        } else {
          entry.target.classList.remove('in-focus');
          entry.target.classList.add('out-of-focus');
        }
      });
    }, {
      root: null,
      rootMargin: '-30% 0px -30% 0px',
      threshold: 0.1
    });
  }

  // On full rebuild the old nodes are gone — disconnect and re-observe
  if (forceRebind) {
    _scrollObserver.disconnect();
    document.querySelectorAll('.superset-section').forEach(sec => {
      _scrollObserver.observe(sec);
    });
  }
}

// ── Targeted DOM-patch path ───────────────────────────────────────────────
// Instead of rebuilding the whole #app innerHTML, replace only the exercise
// card(s) that actually changed.  This preserves IntersectionObserver state,
// CSS transition continuity, and avoids flashing static elements.

/**
 * Replace a single exercise card in the DOM without touching its siblings,
 * the superset labels, or any other part of the tree.
 *
 * @param {object}  appState   — current app state
 * @param {string}  exId       — instanceId of the exercise to patch
 * @param {boolean} readOnly   — whether the session is finished
 */
function patchExerciseCard(appState, exId, readOnly) {
  const existing = document.querySelector(`.exercise-card[data-ex-id="${exId}"]`);
  if (!existing) return;

  // Find the exercise instance from the workouts data
  let exerciseInst = null;
  for (const s of workouts) {
    for (const b of s.blocks) {
      for (const ex of b.exercises) {
        if (ex.instanceId === exId) { exerciseInst = ex; break; }
      }
      if (exerciseInst) break;
    }
    if (exerciseInst) break;
  }
  if (!exerciseInst) return;

  // Build the new card HTML
  const newHtml = buildCard(exerciseInst, appState, readOnly);

  // Parse into a real DOM node
  const template = document.createElement('template');
  template.innerHTML = newHtml.trim();
  const newNode = template.content.firstElementChild;
  if (!newNode) return;

  // Swap in-place — siblings, parent section, and IntersectionObserver are untouched
  existing.replaceWith(newNode);
}

/**
 * Targeted render for TOGGLE_SET / LOG_AND_MARK_DONE actions.
 *
 * Patches only the affected exercise card (and any siblings whose visual
 * completion state changed) then updates the progress bar.  Everything
 * else — superset headers, other cards, IntersectionObserver — is left alone.
 *
 * @param {object} appState  — current app state (already committed via setState)
 * @param {string} exId      — instanceId of the exercise that was toggled
 */
export function renderSetUpdate(appState, exId) {
  const sessionId = EX_SESSION_INDEX[exId];
  if (!sessionId || sessionId !== appState.activeSessionId) {
    // Shouldn't happen, but fall back to full render
    render(appState);
    return;
  }

  const finished = query.isSessionFinishedInCurrentWeek(appState, sessionId);

  // 1. Patch the toggled exercise card
  patchExerciseCard(appState, exId, finished);

  // 2. Patch any sibling exercises whose completion class might have changed.
  //    This handles the case where completing the last set of exercise A
  //    visually dims the card (opacity 0.32), while the next exercise's
  //    visual state is unaffected (it's driven by its own sets, not A's).
  const session = workouts.find(s => s.id === sessionId);
  if (session) {
    const allExIds = session.blocks.flatMap(b => b.exercises.map(e => e.instanceId));
    for (const siblingId of allExIds) {
      if (siblingId === exId) continue;
      const siblingCard = document.querySelector(`.exercise-card[data-ex-id="${siblingId}"]`);
      if (!siblingCard) continue;

      // Check if the DOM completion class is stale
      const wasComplete = siblingCard.classList.contains('completed');
      const isComplete  = query.isExerciseComplete(appState, siblingId);
      if (wasComplete !== isComplete) {
        patchExerciseCard(appState, siblingId, finished);
      }
    }
  }

  // 3. Update the session-complete banner if needed
  const isComplete = query.isSessionComplete(appState, sessionId);
  const banner = document.querySelector('.complete-banner');
  if (banner && !finished) {
    const isStarted = appState.sessionStarted !== null;
    if (isComplete && isStarted) {
      banner.classList.add('visible');
    } else {
      banner.classList.remove('visible');
    }
  }

  // 4. Update progress bar (already has in-place logic)
  updateProgressBar(appState);
}

/**
 * Targeted render for UPDATE_CARDIO actions (warm-up / finisher toggles).
 *
 * Only toggles the CSS class on the warmup bar and finisher card — no
 * innerHTML rebuild, no observer re-init, no card reconstruction.
 *
 * @param {object} appState — current app state (already committed via setState)
 */
export function renderCardioUpdate(appState) {
  const c = appState?.cardio || {};

  // Warmup bar: toggle .warmup-done class
  const warmupBar = document.querySelector('.warmup-bar');
  if (warmupBar) {
    warmupBar.classList.toggle('warmup-done', c.warmupDone === true);
    // Sync the checkbox state (the DOM checkbox may already be correct from
    // the user click, but keep it consistent with state)
    const warmupCb = warmupBar.querySelector('.warmup-checkbox');
    if (warmupCb) warmupCb.checked = c.warmupDone === true;
  }

  // Finisher card: toggle .finisher-done class
  const finisherCard = document.querySelector('.finisher-card');
  if (finisherCard) {
    finisherCard.classList.toggle('finisher-done', c.finisherDone === true);
    const finisherCb = finisherCard.querySelector('.finisher-checkbox');
    if (finisherCb) finisherCb.checked = c.finisherDone === true;
  }
}

// ── ETA Display ───────────────────────────────────────────────────────────────

/**
 * Update the ETA display elements in the DOM.
 *
 * Two display locations:
 *   1. Header progress bar: "~18 min" next to the percentage
 *   2. Session area: "Est. departure: 4:25 PM" near the finish button
 *
 * @param {object} appState
 */
function updateETADisplay(appState) {
  const sessionDef = workouts.find(s => s.id === appState.activeSessionId);
  const eta = sessionDef ? calculateETA(appState, sessionDef) : null;

  const hasETA = eta && eta.completedSets > 0;

  // Header stats — remaining time ("~18 min")
  const headerEl = document.getElementById('eta-display');
  if (headerEl) {
    if (hasETA) {
      headerEl.textContent = eta.remainingLabel;
      headerEl.classList.add('has-value');
      headerEl.classList.toggle('conf-low', eta.confidence.level === 'low');
    } else {
      headerEl.textContent = '—';
      headerEl.classList.remove('has-value', 'conf-low');
    }
  }

  // Departure time in header stats
  const departureHeaderEl = document.getElementById('eta-departure-header');
  if (departureHeaderEl) {
    if (hasETA) {
      departureHeaderEl.textContent = eta.departureLabel;
      departureHeaderEl.classList.add('has-value');
      departureHeaderEl.classList.toggle('conf-low', eta.confidence.level === 'low');
    } else {
      departureHeaderEl.textContent = '—';
      departureHeaderEl.classList.remove('has-value', 'conf-low');
    }
  }

  // Show/hide stats row and dividers based on session state
  const statsRow = document.getElementById('progress-stats');
  if (statsRow) {
    const hasSession = !!appState.sessionStarted;
    statsRow.classList.toggle('has-session', hasSession);
  }

  // Departure display in the completion banner
  const departureEl = document.getElementById('eta-departure');
  if (departureEl) {
    if (hasETA) {
      departureEl.textContent = `Est. departure: ${eta.departureLabel}`;
      departureEl.classList.add('has-value');
    } else {
      departureEl.textContent = '';
      departureEl.classList.remove('has-value');
    }
  }
}

// ── Elapsed Timer ─────────────────────────────────────────────────────────────

/**
 * Format milliseconds as H:MM:SS (or M:SS if under 10 minutes).
 *
 * @param {number} ms
 * @returns {string}
 */
function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/**
 * Update the elapsed time display in the header.
 *
 * Computes delta from sessionStarted — works correctly after app close/reopen
 * because sessionStarted is a persisted Date.now() timestamp.
 *
 * @param {object} appState
 */
function updateElapsedDisplay(appState) {
  const el = document.getElementById('elapsed-display');
  if (!el) return;

  if (appState.sessionStarted) {
    const elapsed = Date.now() - appState.sessionStarted;
    el.textContent = formatElapsed(elapsed);
    el.classList.add('has-value');
  } else {
    el.textContent = '—';
    el.classList.remove('has-value');
  }
}

/**
 * Initialize the ETA + elapsed display tick.
 *
 * Runs every second to keep the elapsed clock and departure time fresh.
 * No new timer framework — just a simple interval that reads current
 * state and patches the DOM elements.
 */
let _etaIntervalId = null;

export function initETAUI() {
  // Clear any existing interval (safe for hot-reload)
  if (_etaIntervalId) clearInterval(_etaIntervalId);

  _etaIntervalId = setInterval(() => {
    if (state) {
      updateElapsedDisplay(state);
      updateETADisplay(state);
    }
  }, 1_000);
}
