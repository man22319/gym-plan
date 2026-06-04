import { workouts, completedSessionsBase } from '../core/workouts.js';
import { query } from '../core/queries.js';
import { getEffectiveExercise, getDisplayName } from '../core/helpers.js';
import { detectPlateaus } from '../core/analytics/plateaus.js';



export let editingExId = null;
export function setEditingExId(val) { editingExId = val; }

export function formatReps(reps) {
  if (!reps || typeof reps !== 'object') return '—';
  if ('fixed' in reps) return String(reps.fixed);
  return `${reps.min}–${reps.max}`;
}

export function formatWeight(weight) {
  if (!weight || typeof weight !== 'object') return '';
  if ('value' in weight) return `${weight.value} ${weight.unit}`;
  return `${weight.min}–${weight.max} ${weight.unit}`;
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
  // completedSessionsBase comes from workouts.json metadata (e.g. 24)
  // history.length is the count of sessions logged inside this app.
  // Together they form the true running total, avoiding hardcoded offsets.
  const base = completedSessionsBase ?? 0;
  const liveCompleted = appState?.history
    ? appState.history.filter(e => e && e.sessionId && e.timestamp).length
    : 0;
  const totalCompleted = base + liveCompleted;

  const sessionsPerWeek = Math.max(1, appState?.sessionsPerWeek || 3);
  const week    = Math.floor(totalCompleted / sessionsPerWeek) + 1;
  const session = (totalCompleted % sessionsPerWeek) + 1;

  return { week, session };
}

export function render(appState) {
  const el = document.getElementById('app');
  if (el) el.innerHTML = buildApp(appState);

  const { week, session } = getTrainingWeekAndSession(appState);
  const weekSessionEl = document.getElementById('week-session-display');
  if (weekSessionEl) {
    weekSessionEl.textContent = `Week ${week} · Session ${session}`;
  }
}

export function buildApp(appState) {
  return buildFatigueBanner(appState) +
    buildTabs(appState) +
    workouts.map(s => buildSession(s, appState)).join('') +
    buildDeloadStrip(appState);
}

/**
 * Renders the global fatigue warning banner if state.fatigueStatus.level === 'warning'.
 * Displays a compact, non-intrusive amber toast above the session tabs.
 * Each indicator bullet is listed inline.
 *
 * @param {object} appState
 * @returns {string} HTML string
 */
export function buildFatigueBanner(appState) {
  const fs = appState?.fatigueStatus;
  if (!fs || fs.level !== 'warning' || !fs.indicators?.length) return '';

  const bullets = fs.indicators
    .map(i => `<li class="fatigue-indicator">${i}</li>`)
    .join('');

  return `
    <div class="fatigue-banner" role="alert" aria-label="Fatigue warning" id="fatigue-banner">
      <div class="fatigue-banner-inner">
        <span class="fatigue-icon" aria-hidden="true">⚠️</span>
        <div class="fatigue-body">
          <div class="fatigue-title">Recovery Focus Recommended</div>
          <ul class="fatigue-indicators">${bullets}</ul>
        </div>
        <button class="fatigue-dismiss" id="fatigue-dismiss" aria-label="Dismiss fatigue warning" title="Dismiss">✕</button>
      </div>
    </div>`;
}

/**
 * Renders a persistent deload mode strip just above the session tabs.
 * Always visible — shows current state and lets the user toggle deload on/off.
 *
 * @param {object} appState
 * @returns {string} HTML string
 */
export function buildDeloadStrip(appState) {
  const active = appState?.isDeloadActive === true;
  const cls    = active ? 'deload-strip deload-strip--on' : 'deload-strip';
  const label  = active ? 'Deload Active' : 'Deload Mode';
  const desc   = active
    ? 'Fatigue warnings suppressed · workouts flagged as planned recovery'
    : 'Toggle to suppress fatigue warnings during a planned deload week';

  return `
    <div class="${cls}">
      <div class="deload-strip-left">
        <span class="deload-strip-icon" aria-hidden="true">${active ? '🔵' : '○'}</span>
        <div class="deload-strip-text">
          <span class="deload-strip-label">${label}</span>
          <span class="deload-strip-desc">${desc}</span>
        </div>
      </div>
      <button
        id="deload-toggle-btn"
        class="deload-toggle-btn ${active ? 'on' : ''}"
        aria-pressed="${active}"
        aria-label="${active ? 'Deactivate deload mode' : 'Activate deload mode'}"
      >${active ? 'ON' : 'OFF'}</button>
    </div>`;
}

export function getSuggestedSessionId(appState) {
  let suggestedId = null;
  let oldestTs = Infinity;

  for (const session of workouts) {
    const ts = query.lastDoneTimestamp(appState, session.id);
    if (ts === null) {
      return session.id;
    }
    if (ts < oldestTs) {
      oldestTs = ts;
      suggestedId = session.id;
    }
  }
  return suggestedId;
}

export function buildTabs(appState) {
  const suggestedId = getSuggestedSessionId(appState);

  const tabs = workouts.map(session => {
    const active    = session.id === appState.activeSessionId ? 'active' : '';
    const ts        = query.lastDoneTimestamp(appState, session.id);

    let recency = '';
    if (ts) {
      const diffMs = Date.now() - ts;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) {
        const today = new Date();
        const doneDate = new Date(ts);
        if (today.toDateString() === doneDate.toDateString()) {
          recency = 'today';
        } else {
          recency = 'yesterday';
        }
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
      <button class="finish-workout-btn" data-session-id="${session.id}">Finish Workout</button>
    </div>
  </div>`;
}

export function buildBlock(block, appState) {
  return `<div class="superset-label">${block.label}</div>
    ${block.exercises.map(ex => buildCard(ex, appState)).join('')}`;
}

export function buildCard(ex, appState) {
  const sets      = appState.exercises[ex.id] || [];
  const complete  = query.isExerciseComplete(appState, ex.id);
  const prevSets  = query.lastExerciseSets(appState, ex.id);
  
  const effEx     = getEffectiveExercise(appState, ex.id);
  const displayName = getDisplayName(appState, ex.id);
  const isSubstituted = !!appState?.exerciseSubstitutions?.[ex.id];
  const isOverridden = !!appState?.exerciseOverrides?.[ex.id];
  
  const wStr      = formatWeight(effEx.weight);
  const detail    = `${effEx.sets} × ${formatReps(effEx.reps)}${wStr ? `<br>${wStr}` : ''}`;
  const prs       = query.currentSetPRs(appState, ex.id);
  const hasPR     = prs.length > 0;

  const currentSetsWithNotes = sets.filter(s => s.n && s.n.trim());
  let currentNotesHtml = '';
  if (currentSetsWithNotes.length > 0) {
    currentNotesHtml = `<div class="live-notes-row">
      ${currentSetsWithNotes.map(s => `<span class="live-note-chip">S${sets.indexOf(s) + 1}: ${s.n}</span>`).join('')}
    </div>`;
  }

  const revertHtml = isSubstituted
    ? `<span class="ex-revert-link" data-ex-id="${ex.id}" role="button" aria-label="Revert exercise swap">↩ revert</span>`
    : '';

  const detailHtml = isOverridden
    ? `<div class="ex-detail overridden" title="Custom targets active">${detail} <span class="ex-override-indicator">●</span></div>`
    : `<div class="ex-detail">${detail}</div>`;

  const editBtnHtml = `<button class="ex-edit-btn" data-ex-id="${ex.id}" aria-label="Edit targets" title="Edit targets">✎</button>`;
  const editPanelHtml = (editingExId === ex.id) ? buildEditPanel(ex, appState) : '';

  const plateauBannerHtml = buildPlateauBanner(appState, ex.id);

  return `<div class="exercise-card ${complete ? 'completed' : ''}" data-ex-id="${ex.id}">
    <div class="exercise-header" data-ex-id="${ex.id}" role="button" aria-label="View history for ${displayName}" tabindex="0">
      <div class="ex-letter">${ex.letter}</div>
      <div class="ex-name">
        <span class="ex-name-text">${displayName}</span>
        ${hasPR ? `<span class="pr-badge" title="Personal Record!">🏆</span>` : ''}
        ${revertHtml}
      </div>
      <div class="ex-info-group">
        ${detailHtml}
        <div class="ex-history-hint">TAP FOR HISTORY</div>
      </div>
      ${editBtnHtml}
    </div>
    ${editPanelHtml}
    ${buildNotesRow(ex, appState)}
    ${buildProgressionChip(appState, ex)}
    ${plateauBannerHtml}
    ${buildPrevRow(prevSets, sets)}
    ${currentNotesHtml}
    <div class="set-row">
      ${sets.map((s, i) => buildDot(ex.id, i, s)).join('')}
    </div>
  </div>`;
}

export function buildEditPanel(ex, appState) {
  const effEx = getEffectiveExercise(appState, ex.id);
  
  let weightVal = '';
  if (effEx.weight) {
    if ('value' in effEx.weight) {
      weightVal = effEx.weight.value;
    } else {
      weightVal = effEx.weight.min;
    }
  }

  let repMin = '';
  let repMax = '';
  if (effEx.reps) {
    if ('fixed' in effEx.reps) {
      repMin = effEx.reps.fixed;
      repMax = effEx.reps.fixed;
    } else {
      repMin = effEx.reps.min ?? '';
      repMax = effEx.reps.max ?? '';
    }
  }

  const notesVal = effEx.notes ?? '';

  return `
    <div class="ex-edit-panel" data-ex-id="${ex.id}">
      <div class="ex-edit-fields">
        <div class="ex-edit-field">
          <label for="edit-weight-${ex.id}">Target Weight</label>
          <div class="ex-edit-input-wrap">
            <input type="number" class="ex-edit-input" id="edit-weight-${ex.id}" step="2.5" min="0" value="${weightVal}" placeholder="Prescribed weight" />
            <span class="ex-edit-unit">lbs</span>
          </div>
        </div>
        <div class="ex-edit-field">
          <label>Reps (Min / Max)</label>
          <div class="ex-edit-reps-wrap">
            <input type="number" class="ex-edit-input" id="edit-repmin-${ex.id}" min="0" value="${repMin}" placeholder="Min" />
            <span class="ex-edit-reps-dash">—</span>
            <input type="number" class="ex-edit-input" id="edit-repmax-${ex.id}" min="0" value="${repMax}" placeholder="Max" />
          </div>
        </div>
        <div class="ex-edit-field" style="grid-column: span 2;">
          <label for="edit-notes-${ex.id}">Exercise Notes</label>
          <div class="ex-edit-input-wrap">
            <textarea class="ex-edit-textarea" id="edit-notes-${ex.id}" placeholder="e.g. seat height 4, focus on squeeze" rows="2">${notesVal}</textarea>
          </div>
        </div>
      </div>
      <div class="ex-edit-actions">
        <button class="ex-edit-btn-cancel" data-ex-id="${ex.id}">Cancel</button>
        <button class="ex-edit-btn-save" data-ex-id="${ex.id}">Save</button>
      </div>
    </div>
  `;
}

export function buildNotesRow(ex, appState) {
  const effEx = getEffectiveExercise(appState, ex.id);
  const sub = appState?.exerciseSubstitutions?.[ex.id];

  const hasNotes = effEx?.notes && effEx.notes.trim();
  
  let alts = ex.alternatives || [];
  if (sub) {
    alts = [ex.name, ...alts].filter(a => a !== sub.name);
  }
  const hasAlts = alts.length > 0;

  if (!hasNotes && !hasAlts) return '';

  const notesHtml = hasNotes
    ? `<span class="ex-notes">${effEx.notes}</span>`
    : '';

  const altsHtml = hasAlts
    ? `<span class="ex-alts-label">ALT:</span> ${alts.map(a =>
        `<button class="ex-alt" data-ex-id="${ex.id}" data-alt-name="${a.replace(/"/g, '&quot;')}">${a}</button>`
      ).join('')}`
    : '';

  return `<div class="ex-meta-row">
    ${notesHtml}
    ${hasAlts ? `<div class="ex-alts">${altsHtml}</div>` : ''}
  </div>`;
}

export function buildProgressionChip(appState, ex) {
  const rec = query.progressionRecommendation(appState, ex.id);
  if (!rec) return '';

  const cls = rec.action === 'increase' ? 'prog-increase'
            : rec.action === 'reduce'   ? 'prog-reduce'
            : rec.action === 'watch'    ? 'prog-watch'
            : 'prog-maintain';

  return `<div class="progression-chip ${cls}">
    <span class="prog-label">NEXT SESSION</span>
    <span class="prog-text">${rec.label}</span>
  </div>`;
}

/**
 * Builds the plateau warning banner for a single exercise card.
 * Returns an empty string if no stagnation is detected or if
 * there is insufficient history to make a determination.
 *
 * @param {object} appState
 * @param {string} exId
 * @returns {string} HTML string
 */
export function buildPlateauBanner(appState, exId) {
  const sessions  = appState.sessions || [];
  const history   = appState.history  || [];
  const activeId  = appState.activeSessionId;

  if (!activeId || !history.length || !sessions.length) return '';

  // detectPlateaus scans all exercises in the active session;
  // we only care about the one matching this card's exId.
  const plateaus = detectPlateaus(history, activeId, sessions, 3);
  const info     = plateaus.find(p => p.exerciseId === exId);
  if (!info) return '';

  const icon        = info.currentTrend === 'down' ? '📉' : '➡️';
  const trendLabel  = info.currentTrend === 'down' ? 'Declining' : 'Flat';
  const trendCls    = info.currentTrend === 'down' ? 'plateau-down' : 'plateau-flat';

  // Format the E1RM trace as a compact string, e.g. "84.3 → 83.1 → 82.5"
  const metricsStr  = info.metrics.map(m => m.toFixed(1)).join(' → ');

  return `
    <div class="plateau-banner ${trendCls}" role="alert" aria-label="Plateau warning: ${trendLabel} trend detected">
      <span class="plateau-icon" aria-hidden="true">${icon}</span>
      <div class="plateau-body">
        <div class="plateau-header">
          <span class="plateau-label">Plateau · ${info.consecutiveSessions} sessions</span>
          <span class="plateau-trend-badge">${trendLabel}</span>
        </div>
        <div class="plateau-metrics">E1RM: ${metricsStr}</div>
        <div class="plateau-intervention">${info.suggestedIntervention}</div>
      </div>
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

export function buildDot(exId, idx, setObj) {
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
