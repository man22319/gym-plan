import { workouts, programDefaults, EXERCISE_INDEX, EX_SESSION_INDEX, state, defaultWorkoutsData } from '../../core/state/store.js';
import { REST_DURATION } from '../../core/state/state.js';
import { query } from '../../core/logic/queries.js';
import { getEffectiveExercise, getWorkingWeight, getDeltaW } from '../../core/utils/helpers.js';
import { updateProgressionState } from '../../core/logic/progression.js';
import { calculateETA } from '../../core/utils/eta.js';




export let editingExId = null;
export function setEditingExId(val) { editingExId = val; }

export function formatReps(reps) {
  if (!reps || typeof reps !== 'object') return '—';
  if (reps.min === reps.max) return String(reps.min);
  return `${reps.min}–${reps.max}`;
}

export function formatWeight(w) {
  if (w == null) return '';
  return `${w} lbs`;
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
  // Canonical implementation lives in queries.js (state query, not a render helper).
  // This re-export keeps existing callers (buildTabs) unchanged.
  return query.getSuggestedSessionId(appState);
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
      ? `<span class="completed-tab-badge">DONE</span>`
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
  const complete = query.isSessionComplete(appState, session.id) && !finished && query.activeSessionStartTime(appState) !== null;
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
        <div class="finished-banner-icon">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <div class="finished-banner-body">
          <span class="finished-banner-title">SESSION COMPLETED</span>
          <small>Logged ${timeLabel} · View only</small>
          <button class="export-inline-btn" id="export-inline-btn">Export Data</button>
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

  // warmup and finisher: always from exercises.json defaults (never changes)
  const bootDefaults = defaultWorkoutsData?.defaults ?? {};
  const warmupText = bootDefaults.warmup ?? '';
  const finisherText = bootDefaults.finisher ?? '';

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
  const workingWeight = getWorkingWeight(appState, instanceId);
  const isOverridden = !!appState?.runtimeOverrides?.[instanceId]?.workingWeight;

  const wStr = formatWeight(workingWeight);
  const stepVal = getDeltaW(effEx?.deltaW, workingWeight);
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
  const overrideIndicator = isOverridden ? ' <span class="ex-override-indicator" title="Working weight override active">●</span>' : '';

  // In completed sessions: show a LOGGED badge instead of the edit button; header is non-interactive
  const loggedBadgeHtml = readOnly ? `<span class="ex-logged-badge">LOGGED</span>` : '';
  const editBtnHtml = readOnly ? '' : `<button class="ex-edit-btn" data-ex-id="${instanceId}" aria-label="Edit targets" title="Edit targets"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  const editPanelHtml = (editingExId === instanceId && !readOnly) ? buildEditPanel(ex, appState) : '';

  // In completed sessions the card should appear fully lit (not faded) since all sets are done
  const cardClass = readOnly ? 'session-done-card' : (complete ? 'completed' : '');

  // Layer B: live progression row (active) or review row (finished)
  const progressionRowHtml = buildProgressionRow(instanceId, appState, readOnly);

  // Tolerance for dot feedback (per-exercise or default 10%)
  const tolerance = effEx?.tolerance ?? 0.1;

  return `<div class="exercise-card ${cardClass}" data-ex-id="${instanceId}">
    <div class="exercise-header" data-ex-id="${instanceId}">
      <div class="ex-letter">${ex.letter || ''}</div>
      <div class="ex-title-group">
        <div class="ex-name">
          <span class="ex-name-text">${displayName}</span>
          ${hasPR ? `<span class="pr-badge" title="Personal Record!">PR</span>` : ''}
        </div>
        <div class="ex-info-group ex-metadata-row-sub">
          <span class="ex-metadata-sets-reps">${effEx?.sets ?? '?'} × ${formatReps(effEx?.reps)}</span>
          ${wStr ? `<span class="ex-metadata-weight-tag ${isOverriddenClass}">${wStr}${overrideIndicator}</span>` : ''}
          ${stepVal !== undefined ? `<span class="ex-metadata-type-badge">ΔW = ${stepVal}</span>` : ''}
          ${effEx?.equipmentType ? `<span class="ex-metadata-type-badge">${effEx.equipmentType}</span>` : ''}
        </div>
      </div>
      <div class="ex-header-right-actions">
        ${loggedBadgeHtml}
        <div class="ex-history-hint" role="button" tabindex="0" aria-label="View history for ${displayName}" ${readOnly ? 'style="display:none;"' : ''}>HISTORY</div>
        ${editBtnHtml}
      </div>
    </div>
    ${editPanelHtml}
    ${buildNotesRow(ex, appState)}
    ${progressionRowHtml}
    ${buildPrevRow(prevSets, sets)}
    ${currentNotesHtml}
    ${readOnly ? '' : `<div class="set-row">
      ${sets.map((s, i) => buildDot(instanceId, i, s, readOnly, workingWeight, tolerance)).join('')}
    </div>`}
  </div>`;
}

export function buildEditPanel(ex, appState) {
  const instanceId = ex.instanceId;
  const effEx = getEffectiveExercise(appState, instanceId);
  const currentWW = getWorkingWeight(appState, instanceId);

  const repMin = effEx?.reps?.min ?? '';
  const repMax = effEx?.reps?.max ?? '';

  const notesVal = effEx?.notes ?? '';

  const stepVal = getDeltaW(effEx?.deltaW, currentWW);
  const stepAttr = stepVal !== undefined ? `step="${stepVal}"` : 'step="any"';

  // Single working weight input — no range modes
  const loadFieldsHtml = `
    <div class="ex-edit-field">
      <label for="edit-weight-${instanceId}">Working Weight</label>
      <div class="ex-edit-input-wrap">
        <input type="number" class="ex-edit-input" id="edit-weight-${instanceId}" ${stepAttr} min="0" value="${currentWW ?? ''}" placeholder="Auto from progression" />
        <span class="ex-edit-unit">lbs</span>
      </div>
    </div>`;

  return `
    <div class="ex-edit-panel" data-ex-id="${instanceId}">
      <div class="ex-edit-fields">
        ${loadFieldsHtml}
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
    const fail = s.s === 'failed' ? ' <span class="prev-x">X</span>' : '';
    const rir = (s.rir !== null && s.rir !== undefined) ? `<span class="prev-rir">(r${s.rir})</span>` : '';
    const deload = s.deload ? ' <span class="prev-deload" style="font-size:0.5rem; color:var(--muted); background:rgba(255,255,255,0.1); padding:1px 3px; border-radius:2px; margin-left:2px;" title="Deload set">DL</span>' : '';
    return `<span class="prev-set">S${i + 1} <span class="prev-nums">${w}&times;${r}</span>${rir}${fail}${deload}</span>`;
  }).join('');

  const deltaHtml = buildDelta(weightDelta, repsDelta);

  return `<div class="prev-data">
    <span class="prev-label">LAST</span>${setChips}${deltaHtml}
  </div>`;
}

export function buildDelta(weightDelta, repsDelta) {
  const parts = [];
  if (weightDelta !== null && weightDelta !== 0) {
    const rounded = Math.round(weightDelta * 2) / 2; // snap to 0.5 lb
    if (rounded !== 0) {
      const cls = rounded > 0 ? 'delta-up' : 'delta-down';
      const sign = rounded > 0 ? '+' : '';
      parts.push(`<span class="delta ${cls}">${sign}${rounded}lb</span>`);
    }
  }
  if (repsDelta !== null && repsDelta !== 0) {
    const rounded = Math.round(repsDelta); // snap to whole reps
    if (rounded !== 0) {
      const cls = rounded > 0 ? 'delta-up' : 'delta-down';
      const sign = rounded > 0 ? '+' : '';
      parts.push(`<span class="delta ${cls}">${sign}${rounded}rep</span>`);
    }
  }
  return parts.length ? `<span class="delta-group">${parts.join('')}</span>` : '';
}

// ── ROM / RIR trend helpers (rendering-layer only) ────────────────────────────
// Mirror the logic from progression.js without importing private functions.
// These are used in buildProgressionRow to derive trend labels from persisted
// windows for the review-mode chips (the active-mode chips read directly from
// the updateProgressionState() result which already includes romTrend/rirTrend).

const _ROM_TREND_THRESHOLD = 2;
const _RIR_TREND_THRESHOLD = 2;

/**
 * Derive ROM trend from a persisted recentRomSummaries window.
 * Mirrors analyzeRomTrend() in progression.js.
 *
 * @param {string[]} recentRomSummaries
 * @returns {'consistent-degradation'|'sustained-partial'|'stable'}
 */
function _deriveRomTrend(recentRomSummaries) {
  if (!Array.isArray(recentRomSummaries) || recentRomSummaries.length === 0) return 'stable';
  const degradingCount = recentRomSummaries.filter(p => p === 'degrading').length;
  const partialCount   = recentRomSummaries.filter(p => p === 'consistent-partial').length;
  if (degradingCount >= _ROM_TREND_THRESHOLD) return 'consistent-degradation';
  if (partialCount   >= _ROM_TREND_THRESHOLD) return 'sustained-partial';
  return 'stable';
}

/**
 * Derive RIR trend from a persisted recentZeroRir window.
 * Mirrors analyzeRirTrend() in progression.js.
 *
 * @param {number[]} recentZeroRir
 * @returns {'repeated-zero-rir'|'normal'}
 */
function _deriveRirTrend(recentZeroRir) {
  if (!Array.isArray(recentZeroRir) || recentZeroRir.length === 0) return 'normal';
  const zeroCount = recentZeroRir.filter(c => c > 0).length;
  return zeroCount >= _RIR_TREND_THRESHOLD ? 'repeated-zero-rir' : 'normal';
}

// ── Layer B: Live Progression Row ─────────────────────────────────────────────

/**
 * Build compact chips showing controller distance to progression/regression.
 *
 * Renders one or two small chips:
 *   '1Q → ↑'  — 1 qualifying session until progression
 *   '1F → ↓'  — 1 more failing session until regression
 *
 * These are exact controller-state arithmetic, not probability
 * estimates.  See computeControllerDistance() in progression.js.
 *
 * Suppressed when the distance is at its default (no useful signal)
 * or when progression/regression has already been decided.
 *
 * @param {{ qualifyingNeeded: number, failingCapacity: number }} dist
 * @returns {string[]} Array of HTML chip strings (0-2 elements)
 */
function buildDistanceChips(dist) {
  if (!dist) return [];
  const chips = [];
  const { qualifyingNeeded = 0, failingCapacity = 0 } = dist;

  // Show progress distance until progression is triggered
  if (qualifyingNeeded > 0) {
    const label = `${qualifyingNeeded} TO ↑`;
    chips.push(
      `<span class="prog-chip prog-chip-distance prog-chip-dist-progress"
         title="${qualifyingNeeded} more qualifying session${qualifyingNeeded !== 1 ? 's' : ''} to trigger progression">
        ${label}
      </span>`
    );
  }

  // Show regress distance when it's getting tight (1 failure away)
  if (failingCapacity > 0 && failingCapacity <= 1) {
    const label = `${failingCapacity} TO ↓`;
    chips.push(
      `<span class="prog-chip prog-chip-distance prog-chip-dist-regress"
         title="${failingCapacity} more failing session${failingCapacity !== 1 ? 's' : ''} before regression triggers">
        ${label}
      </span>`
    );
  }

  return chips;
}

/**
 * Compute and render the coaching row for an exercise card.
 *
 * Active session (readOnly = false):
 *   Calls updateProgressionState() live against current sets — pure computation,
 *   no dispatch, no persistence. Updates after every set via the normal render cycle.
 *   Shows live session classification: ON TRACK / KEEP PUSHING / FALLING SHORT.
 *
 * Finished session (readOnly = true):
 *   Reads from committed progressionState[exId] — evaluation/review mode.
 *   Shows decision chips: PROGRESS / HOLD / REGRESS.
 *
 * Returns '' for invariant exercises or exercises with no usable data.
 */
export function buildProgressionRow(instanceId, appState, readOnly = false) {
  const ex = EXERCISE_INDEX[instanceId];
  if (ex?.invariant) return '';

  const historyN = query.exerciseHistory(appState, instanceId).length;
  const chips = [];

  if (readOnly) {
    // ── Review mode: read committed progressionState ──
    const ps = appState?.progressionState?.[instanceId];
    if (!ps || ps.currentWeight === null || ps.currentWeight === undefined) return '';

    const suggested = ps.lastSuggested;
    const decision = ps.lastDecision ?? 'hold';
    const classification = ps.lastClassification;
    const restInflationFactor = ps.restInflationFactor ?? 0;

    // Decision chip
    if (suggested !== null && suggested !== undefined) {
      let decisionClass, decisionIcon, decisionLabel;
      if (decision === 'progress') {
        decisionClass = 'prog-chip-progress';
        decisionIcon = '↑';
        decisionLabel = `PROGRESS → ${suggested} lbs`;
      } else if (decision === 'regress') {
        decisionClass = 'prog-chip-regress';
        decisionIcon = '↓';
        decisionLabel = `REGRESS → ${suggested} lbs`;
      } else {
        decisionClass = 'prog-chip-hold';
        decisionIcon = '→';
        decisionLabel = `HOLD · ${suggested} lbs`;
      }

      const sessionLabel = `${historyN} session${historyN !== 1 ? 's' : ''}`;
      chips.push(
        `<span class="prog-chip ${decisionClass}"
           title="Next session target · ${sessionLabel} of data">
          ${decisionIcon} <strong>${decisionLabel}</strong>
        </span>`
      );
    }

    // Classification chip
    if (classification) {
      const classMap = {
        qualifying: { cls: 'prog-chip-qualifying', label: 'QUALIFYING' },
        adequate:   { cls: 'prog-chip-adequate',   label: 'ADEQUATE' },
        failing:    { cls: 'prog-chip-failing',     label: 'FAILING' },
      };
      const c = classMap[classification] ?? { cls: '', label: classification.toUpperCase() };
      chips.push(
        `<span class="prog-chip ${c.cls}" title="Session classification: ${classification}">${c.label}</span>`
      );
    }

    // Controller distance chips (review mode)
    if (ps.controllerDistance) {
      chips.push(...buildDistanceChips(ps.controllerDistance));
    }

    // ROM quality chips (review mode)
    // Derive ROM/RIR trend fresh from persisted windows (not persisted themselves).
    if (ps.recentRomSummaries || ps.romPattern) {
      const recentRomSummaries = ps.recentRomSummaries ?? [];
      const prevWindow = recentRomSummaries.slice(0, -1);  // exclude current session entry
      const romPattern = ps.romPattern ?? 'mixed';
      const romTrend   = _deriveRomTrend(recentRomSummaries);
      const hasRomWarning =
        romTrend === 'consistent-degradation' ||
        (romPattern === 'degrading' && prevWindow.some(p => p === 'degrading'));

      if (hasRomWarning) {
        chips.push(
          `<span class="prog-chip prog-chip-warn" title="ROM is consistently decreasing across sets or sessions. Review your technique, maintain controlled ROM throughout each set, and consider reducing load if the weight is causing repeated ROM loss.">ROM DEGRADATION</span>`
        );
      } else if (romPattern === 'degrading') {
        chips.push(
          `<span class="prog-chip prog-chip-info" title="ROM decreased across sets this session. Watch for a recurring pattern.">ROM ↓</span>`
        );
      }
    }

    // RIR trend chip (review mode)
    if (ps.recentZeroRir) {
      const rirTrend = _deriveRirTrend(ps.recentZeroRir);
      if (rirTrend === 'repeated-zero-rir') {
        chips.push(
          `<span class="prog-chip prog-chip-info" title="Repeatedly reaching 0 RIR may indicate the current weight is near your limit for this rep range, insufficient recovery, or that this exercise has a higher difficulty profile. Interpret alongside ROM quality, failure patterns, and progression history.">0 RIR TREND</span>`
        );
      }
    }

  } else {
    // ── Active session: live computation ──
    const currentSets = appState.exercises[instanceId] || [];
    const hasDoneSet = currentSets.some(s => s.s === 'done' || s.s === 'failed');

    const prevPs = appState?.progressionState?.[instanceId] ?? {};
    const deltaW = appState?.runtimeOverrides?.[instanceId]?.deltaW ?? ex?.deltaW;

    // Rep range from exercise definition
    const repRange = {
      min: ex?.reps?.min ?? ex?.reps ?? 8,
      max: ex?.reps?.max ?? ex?.reps?.min ?? ex?.reps ?? 8,
    };

    // Prescribed rest for rest-influence detection
    const prescribedRestSec = ex?.restBetweenSets ?? REST_DURATION;

    if (hasDoneSet) {
      // At least one set done — compute live classification
      const result = updateProgressionState(prevPs, currentSets, {
        repRange,
        deltaW,
        prescribedRestSec,
        prescribedWeight: ex?.baseWeight ?? null,
        maxW: ex?.maxW ?? null,
      });

      // Live classification chip
      if (result.sessionClassification) {
        const classMap = {
          qualifying: { cls: 'prog-chip-qualifying', label: 'ON TRACK', title: 'All working sets hitting rep ceiling' },
          adequate:   { cls: 'prog-chip-adequate',   label: 'KEEP PUSHING', title: 'Working sets in range but not at ceiling' },
          failing:    { cls: 'prog-chip-failing',     label: 'FALLING SHORT', title: 'Some working sets below rep minimum' },
        };
        const c = classMap[result.sessionClassification] ?? { cls: '', label: result.sessionClassification.toUpperCase(), title: '' };
        chips.push(
          `<span class="prog-chip ${c.cls}" title="${c.title}">${c.label}</span>`
        );
      }

      // Suggested weight chip
      if (result.suggestedWeight !== null) {
        let decisionClass, decisionPrefix;
        if (result.decision === 'progress') {
          decisionClass = 'prog-chip-progress';
          decisionPrefix = 'NEXT ↑';
        } else if (result.decision === 'regress') {
          decisionClass = 'prog-chip-regress';
          decisionPrefix = 'NEXT ↓';
        } else {
          decisionClass = 'prog-chip-hold';
          decisionPrefix = 'NEXT →';
        }
        chips.push(
          `<span class="prog-chip ${decisionClass}"
             title="Projected next-session weight based on current performance">
            ${decisionPrefix} <strong>${result.suggestedWeight} lbs</strong>
          </span>`
        );
      }

      // Controller distance chips (live)
      if (result.controllerDistance) {
        chips.push(...buildDistanceChips(result.controllerDistance));
      }

      if (result.isDeload) {
        chips.push(
          `<span class="prog-chip prog-chip-info" title="Deload sets are excluded from progression evidence">DELOAD</span>`
        );
      }

      // ROM quality chips (live session)
      // result.romWarning is a non-null string only when pattern is degrading
      // AND there is prior degradation in the cross-session window.
      if (result.romWarning) {
        chips.push(
          `<span class="prog-chip prog-chip-warn" title="${result.romWarning}">ROM DEGRADATION</span>`
        );
      } else if (result.romPattern === 'degrading') {
        // Single degrading session — informational chip only
        chips.push(
          `<span class="prog-chip prog-chip-info" title="ROM decreased across sets this session. Watch for a recurring pattern.">ROM ↓</span>`
        );
      }

      // RIR trend chip (live session)
      if (result.rirWarning) {
        chips.push(
          `<span class="prog-chip prog-chip-info" title="${result.rirWarning}">0 RIR TREND</span>`
        );
      }

    } else if (prevPs.lastSuggested !== null && prevPs.lastSuggested !== undefined) {
      // No sets logged yet — show last committed suggestion as a target
      chips.push(
        `<span class="prog-chip prog-chip-preview"
           title="Target weight from last session">
          START: <strong>${prevPs.lastSuggested} lbs</strong>
        </span>`
      );

      // Show last decision context
      const lastDecision = prevPs.lastDecision;
      if (lastDecision === 'progress') {
        chips.push(
          `<span class="prog-chip prog-chip-progress" title="Weight increased from last cycle">↑ PROGRESSED</span>`
        );
      } else if (lastDecision === 'regress') {
        chips.push(
          `<span class="prog-chip prog-chip-regress" title="Weight reduced from last cycle">↓ REGRESSED</span>`
        );
      }

      // Controller distance chips (pre-session, from persisted state)
      if (prevPs.controllerDistance) {
        chips.push(...buildDistanceChips(prevPs.controllerDistance));
      }
    }
  }

  if (!chips.length) return '';

  return `<div class="prog-row">${chips.join('')}</div>`;
}


// ── Layer A: Set-level dot feedback ──────────────────────────────────────────

/**
 * Returns a feedback label for a completed/failed set based on how the logged
 * weight compares to the working weight.
 *
 * @param {object} setObj        — { s, w, r }
 * @param {number|null} workingWeight — resolved working weight
 * @param {number} tolerance     — fractional tolerance (default 0.1 = ±10%)
 * @returns {string}             — 'light' | 'heavy' | 'on-target' | '' | 'failed'
 */
function getSetFeedback(setObj, workingWeight, tolerance = 0.1) {
  if (setObj.s === 'failed') return 'failed';
  if (setObj.s !== 'done' || setObj.w === null || workingWeight == null) return '';
  if (setObj.w > workingWeight * (1 + tolerance)) return 'heavy';
  if (setObj.w < workingWeight * (1 - tolerance)) return 'light';
  return 'on-target';
}

export function buildDot(exId, idx, setObj, readOnly = false, workingWeight = null, tolerance = 0.1) {
  const { s, w, r } = setObj;
  let cls = 'set-dot';
  let inner = '';

  const hasData = w !== null || r !== null;

  // Layer A: set-level feedback (active sessions only) — dot colour conveys state
  const feedback = (!readOnly && workingWeight != null) ? getSetFeedback(setObj, workingWeight, tolerance) : '';

  // Build RIR/ROM metadata line for logged sets
  const rirVal = setObj.rir;
  const romVal = setObj.rom;
  let metaHtml = '';
  // Show RIR and partial-ROM metadata on done/failed sets in BOTH active and review modes.
  // Previously only shown in readOnly. Extended to active sessions so the user
  // gets immediate per-set ROM feedback as they log.
  if (hasData && (s === 'done' || s === 'failed')) {
    const parts = [];
    if (rirVal !== null && rirVal !== undefined) parts.push(`r${rirVal}`);
    if (romVal && romVal !== 'full') parts.push(romVal);
    if (parts.length) metaHtml = `<span class="dot-meta">${parts.join(' ')}</span>`;
  }

  if (s === 'done') {
    cls += ' done';
    if (feedback === 'light') cls += ' dot-light';
    if (feedback === 'heavy') cls += ' dot-heavy';
    inner = hasData
      ? `<span class="dot-data"><span class="dot-w">${w ?? '?'}</span><span class="dot-x">×</span><span class="dot-r">${r ?? '?'}</span></span>${metaHtml}`
      : '&#10003;';
  } else if (s === 'failed') {
    cls += ' failed';
    inner = hasData
      ? `<span class="dot-data"><span class="dot-w">${w ?? '?'}</span><span class="dot-x">×</span><span class="dot-r">${r ?? '?'}</span></span>${metaHtml}`
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
  const banner = document.querySelector(`#${CSS.escape(sessionId)} .complete-banner:not(.finished-banner)`);
  if (banner && !finished) {
    const isStarted = query.activeSessionStartTime(appState) !== null;
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

  // Also update the session-complete banner: the Finish Workout button should
  // appear as soon as all exercise sets are done, regardless of warm-up/finisher.
  // This catches cases where the banner was not revealed during renderSetUpdate.
  const sessionId = appState.activeSessionId;
  if (sessionId) {
    const finished = query.isSessionFinishedInCurrentWeek(appState, sessionId);
    const banner = document.querySelector(`#${CSS.escape(sessionId)} .complete-banner:not(.finished-banner)`);
    if (banner && !finished) {
      const isComplete = query.isSessionComplete(appState, sessionId);
      const isStarted = query.activeSessionStartTime(appState) !== null;
      if (isComplete && isStarted) {
        banner.classList.add('visible');
      }
    }
  }
}

// ── ETA Display ───────────────────────────────────────────────────────────────

// Cache: the model recomputes totalRemainingMs from (remaining_sets × interval),
// which is constant between set completions. To make the "~18 min" display tick
// down in real-time while the user rests, we cache the departure timestamp when
// a set is completed and derive the countdown from the cache on each 1s tick.
let _cachedDepartureMs = null;
let _cachedWorkoutEtaMs = null;
let _cachedCompletedSets = 0;
let _cachedConfidence = null;
let _cachedIntervalMs = null;
let _cachedLastCompletionTs = null;
let _cachedOverheadMs = 0;
let _cachedSessionStart = null;

/**
 * Update the ETA display elements in the DOM.
 *
 * On set completion (completedSets changes): recompute from model, cache departure.
 * On idle ticks: derive remaining time from cached departure timestamp.
 * This gives a live countdown that ticks down every second.
 *
 * @param {object} appState
 */
function updateETADisplay(appState) {
  const sessionDef = workouts.find(s => s.id === appState.activeSessionId);
  const eta = sessionDef ? calculateETA(appState, sessionDef) : null;

  const hasETA = eta && eta.completedSets > 0;

  if (hasETA) {
    // Refresh the cached departure timestamp when set count changes
    // (i.e. model has new information to incorporate)
    if (eta.completedSets !== _cachedCompletedSets) {
      _cachedDepartureMs = eta.etaMs;
      _cachedWorkoutEtaMs = eta.workoutEtaMs;
      _cachedCompletedSets = eta.completedSets;
      _cachedConfidence = eta.confidence;
      _cachedIntervalMs = eta.sessionIntervalMs;
      _cachedLastCompletionTs = eta.lastCompletionTs;
      _cachedOverheadMs = eta.overheadMs || 0;
      _cachedSessionStart = eta.sessionStart;
    }
  } else {
    _cachedDepartureMs = null;
    _cachedWorkoutEtaMs = null;
    _cachedCompletedSets = 0;
    _cachedConfidence = null;
    _cachedIntervalMs = null;
    _cachedLastCompletionTs = null;
    _cachedOverheadMs = 0;
    _cachedSessionStart = null;
  }

  // Derive live countdown from cached departure, with overshoot adjustment.
  // If the user rests longer than the expected interval, the departure time
  // slides forward in real-time — the countdown freezes (no progress being
  // made) and EST. DONE drifts later, giving honest real-time feedback.
  const now = Date.now();

  let overshootMs = 0;
  if (_cachedWorkoutEtaMs && _cachedIntervalMs && _cachedLastCompletionTs) {
    const sinceLast = now - _cachedLastCompletionTs;
    if (sinceLast > _cachedIntervalMs) {
      overshootMs = sinceLast - _cachedIntervalMs;
    }
  }

  // Remaining countdown uses workout ETA (no overhead) so the countdown
  // tracks pure workout time. Departure uses full ETA (includes overhead).
  const adjustedWorkoutEtaMs = _cachedWorkoutEtaMs ? _cachedWorkoutEtaMs + overshootMs : null;
  const adjustedDepartureMs = _cachedDepartureMs ? _cachedDepartureMs + overshootMs : null;
  const liveRemainingMs = adjustedWorkoutEtaMs ? Math.max(0, adjustedWorkoutEtaMs - now) : 0;
  const liveRemainingLabel = formatRemainingTime(liveRemainingMs);

  const confLevel = _cachedConfidence?.level ?? 'low';

  // Departure label from adjusted timestamp
  const liveDepartureLabel = adjustedDepartureMs
    ? new Date(adjustedDepartureMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;

  // Header stats — remaining time ("~18 min") — now ticks down live
  const headerEl = document.getElementById('eta-display');
  if (headerEl) {
    if (adjustedDepartureMs) {
      headerEl.textContent = liveRemainingLabel;
      headerEl.classList.add('has-value');
      headerEl.classList.toggle('conf-low', confLevel === 'low');
    } else {
      headerEl.textContent = '—';
      headerEl.classList.remove('has-value', 'conf-low');
    }
  }

  // Departure time in header stats
  const departureHeaderEl = document.getElementById('eta-departure-header');
  if (departureHeaderEl) {
    if (liveDepartureLabel) {
      departureHeaderEl.textContent = liveDepartureLabel;
      departureHeaderEl.classList.add('has-value');
      departureHeaderEl.classList.toggle('conf-low', confLevel === 'low');
      // Show overhead info as tooltip
      if (_cachedOverheadMs > 0) {
        const overheadMin = Math.round(_cachedOverheadMs / 60_000);
        departureHeaderEl.title = `Includes ~${overheadMin} min post-workout overhead`;
      } else {
        departureHeaderEl.title = '';
      }
    } else {
      departureHeaderEl.textContent = '—';
      departureHeaderEl.classList.remove('has-value', 'conf-low');
      departureHeaderEl.title = '';
    }
  }

  // Show/hide stats row and dividers based on session state
  const statsRow = document.getElementById('progress-stats');
  if (statsRow) {
    const hasSession = !!appState.sessionStarted || !!query.activeSessionStartTime(appState);
    statsRow.classList.toggle('has-session', hasSession);
  }

  // Departure display in the completion banner
  const departureEl = document.getElementById('eta-departure');
  if (departureEl) {
    if (liveDepartureLabel) {
      departureEl.textContent = `Est. departure: ${liveDepartureLabel}`;
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
 * Format remaining milliseconds as M:SS or H:MM:SS.
 * Unlike formatElapsed, clamps to 0:00 when ms ≤ 0.
 *
 * @param {number} ms
 * @returns {string}
 */
function formatRemainingTime(ms) {
  if (!ms || ms <= 0) return '0:00';
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

  // Use derived session start — handles corrupted/lost sessionStarted
  const startTime = query.activeSessionStartTime(appState);

  if (startTime) {
    const elapsed = Date.now() - startTime;
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

      // Safety net: ensure the Finish Workout banner is visible whenever all
      // exercise sets are complete.  This catches any edge case where the
      // targeted renderSetUpdate missed showing the banner (e.g., timing
      // issues, state restore after sleep, etc.).
      const sessionId = state.activeSessionId;
      if (sessionId) {
        const banner = document.querySelector(`#${CSS.escape(sessionId)} .complete-banner:not(.finished-banner)`);
        if (banner && !banner.classList.contains('visible')) {
          const finished = query.isSessionFinishedInCurrentWeek(state, sessionId);
          if (!finished) {
            const isComplete = query.isSessionComplete(state, sessionId);
            const isStarted = query.activeSessionStartTime(state) !== null;
            if (isComplete && isStarted) {
              banner.classList.add('visible');
            }
          }
        }
      }
    }
  }, 1_000);
}
