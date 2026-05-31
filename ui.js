// ==========================================
// ─── DISPLAY HELPERS ───
// ==========================================

/**
 * Format a structured reps object for display.
 *   { fixed: 8 }         → "8"
 *   { min: 6, max: 8 }   → "6–8"
 */
function formatReps(reps) {
  if (!reps || typeof reps !== 'object') return '—';
  if ('fixed' in reps) return String(reps.fixed);
  return `${reps.min}–${reps.max}`;
}

/**
 * Format a structured weight object for display.
 *   { value: 60, unit: 'lbs' }          → "60 lbs"
 *   { min: 22.5, max: 25, unit: 'lbs' } → "22.5–25 lbs"
 */
function formatWeight(weight) {
  if (!weight || typeof weight !== 'object') return '';
  if ('value' in weight) return `${weight.value} ${weight.unit}`;
  return `${weight.min}–${weight.max} ${weight.unit}`;
}

/**
 * Format a duration in milliseconds into "Xh Ym" or "Ym" string.
 */
function formatDuration(ms) {
  if (!ms || ms <= 0) return null;
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return '< 1 min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return `${h}h ${m}m`;
}

/**
 * Format timestamp into short date string: "May 23"
 */
function formatDate(ts) {
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

/**
 * Format timestamp into "5:12 PM"
 */
function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  const wStr      = formatWeight(ex.weight);
  const detail    = `${ex.sets} × ${formatReps(ex.reps)}${wStr ? `<br>${wStr}` : ''}`;
  const prs       = query.currentSetPRs(appState, ex.id);
  const hasPR     = prs.length > 0;

  return `<div class="exercise-card ${complete ? 'completed' : ''}" data-ex-id="${ex.id}">
    <div class="exercise-header" data-ex-id="${ex.id}" role="button" aria-label="View history for ${ex.name}" tabindex="0">
      <div class="ex-letter">${ex.letter}</div>
      <div class="ex-name">${ex.name}${hasPR ? `<span class="pr-badge" title="Personal Record!">🏆</span>` : ''}</div>
      <div class="ex-info-group">
        <div class="ex-detail">${detail}</div>
        <div class="ex-history-hint">TAP FOR HISTORY</div>
      </div>
    </div>
    ${buildNotesRow(ex)}
    ${buildProgressionChip(appState, ex)}
    ${buildPrevRow(prevSets, sets)}
    <div class="set-row">
      ${sets.map((s, i) => buildDot(ex.id, i, s)).join('')}
    </div>
  </div>`;
}

// Display-only: notes and alternatives from workout definition.
// Has no effect on logging, analytics, or calculations.
function buildNotesRow(ex) {
  const hasNotes = ex.notes && ex.notes.trim();
  const hasAlts  = ex.alternatives && ex.alternatives.length;
  if (!hasNotes && !hasAlts) return '';

  const notesHtml = hasNotes
    ? `<span class="ex-notes">${ex.notes}</span>`
    : '';

  const altsHtml = hasAlts
    ? `<span class="ex-alts-label">ALT:</span> ${ex.alternatives.map(a =>
        `<span class="ex-alt">${a}</span>`
      ).join('')}`
    : '';

  return `<div class="ex-meta-row">
    ${notesHtml}
    ${hasAlts ? `<div class="ex-alts">${altsHtml}</div>` : ''}
  </div>`;
}

// ── A: Progression recommendation chip ──
function buildProgressionChip(appState, ex) {
  const rec = query.progressionRecommendation(appState, ex.id);
  if (!rec) return '';

  const cls = rec.action === 'increase' ? 'prog-increase'
            : rec.action === 'reduce'   ? 'prog-reduce'
            : 'prog-maintain';

  return `<div class="progression-chip ${cls}">
    <span class="prog-label">NEXT SESSION</span>
    <span class="prog-text">${rec.label}</span>
  </div>`;
}

function buildPrevRow(prevSets, currSets) {
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

// ==========================================
// ─── B: EXERCISE HISTORY MODAL ───
// ==========================================

let activeHistoryModal = null;

function openHistoryModal(exId) {
  closeHistoryModal();

  const ex = EXERCISE_INDEX[exId];
  if (!ex) return;

  const history = query.exerciseHistory(state, exId);

  // Estimated 1RM: Epley formula w * (1 + r/30)
  function est1RM(w, r) {
    if (!w || !r) return null;
    return +(w * (1 + r / 30)).toFixed(1);
  }

  const hasHistory = history.length > 0;

  // Build table rows — newest first
  const rows = [...history].reverse().map(entry => {
    const doneSets = entry.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    const volume = doneSets.reduce((n, s) => n + s.w * s.r, 0);
    const maxRM   = doneSets.length ? Math.max(...doneSets.map(s => est1RM(s.w, s.r) ?? 0)) : null;

    const setCells = entry.sets.map((s, i) => {
      if (s.w === null && s.r === null) return `<span class="hist-set-empty">—</span>`;
      const cls = s.s === 'failed' ? 'hist-set-fail' : 'hist-set-done';
      return `<span class="${cls}">${s.w ?? '?'}×${s.r ?? '?'}</span>`;
    }).join('');

    return `<tr>
      <td class="hist-date">${formatDate(entry.timestamp)}</td>
      <td class="hist-sets">${setCells}</td>
      <td class="hist-vol">${volume > 0 ? volume.toLocaleString() : '—'}</td>
      <td class="hist-1rm">${maxRM !== null ? maxRM : '—'}</td>
    </tr>`;
  }).join('');

  // Personal records section
  const pr = query.personalRecords(state, exId);
  let prHtml = '';
  if (pr.heaviestSet || pr.highestVolume) {
    const prItems = [];
    if (pr.heaviestSet) prItems.push(`<div class="pr-item"><span class="pr-icon">🏆</span><div><div class="pr-item-label">Heaviest Set</div><div class="pr-item-val">${pr.heaviestSet.w} lbs × ${pr.heaviestSet.r} reps <span class="pr-item-date">${formatDate(pr.heaviestSet.date)}</span></div></div></div>`);
    if (pr.highestVolume) prItems.push(`<div class="pr-item"><span class="pr-icon">📊</span><div><div class="pr-item-label">Best Volume</div><div class="pr-item-val">${pr.highestVolume.volume.toLocaleString()} lbs <span class="pr-item-date">${formatDate(pr.highestVolume.date)}</span></div></div></div>`);
    if (pr.mostReps) prItems.push(`<div class="pr-item"><span class="pr-icon">🔁</span><div><div class="pr-item-label">Most Reps</div><div class="pr-item-val">${pr.mostReps.r} reps @ ${pr.mostReps.w} lbs <span class="pr-item-date">${formatDate(pr.mostReps.date)}</span></div></div></div>`);
    prHtml = `<div class="hist-pr-section"><div class="hist-section-label">PERSONAL RECORDS</div><div class="hist-pr-list">${prItems.join('')}</div></div>`;
  }

  const tableHtml = hasHistory ? `
    <div class="hist-table-wrap">
      <table class="hist-table">
        <thead>
          <tr>
            <th>DATE</th>
            <th>SETS</th>
            <th>VOL (lbs)</th>
            <th>EST 1RM</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  ` : `<div class="hist-empty">No history yet.<br>Complete a session to see trends.</div>`;

  const overlay = document.createElement('div');
  overlay.className = 'history-modal-overlay';
  overlay.innerHTML = `
    <div class="history-modal" role="dialog" aria-modal="true" aria-label="History for ${ex.name}">
      <div class="hist-header">
        <div>
          <div class="hist-title">${ex.name}</div>
          <div class="hist-subtitle">${ex.sets} × ${formatReps(ex.reps)}${ex.weight ? ' · ' + formatWeight(ex.weight) : ''}</div>
        </div>
        <button class="hist-close" id="hist-close" aria-label="Close">✕</button>
      </div>
      ${prHtml}
      ${hasHistory ? `<div class="hist-section-label" style="padding: 0 20px 8px;">SESSION LOG</div>` : ''}
      ${tableHtml}
    </div>`;

  document.body.appendChild(overlay);
  activeHistoryModal = overlay;

  overlay.addEventListener('click', e => { if (e.target === overlay) closeHistoryModal(); });
  overlay.querySelector('#hist-close').addEventListener('click', closeHistoryModal);
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeHistoryModal(); });
}

function closeHistoryModal() {
  if (activeHistoryModal) { activeHistoryModal.remove(); activeHistoryModal = null; }
}

// ==========================================
// ─── C: SESSION SUMMARY MODAL ───
// ==========================================

let activeSummaryModal = null;

function openSessionSummaryModal(entry, appState) {
  closeSessionSummaryModal();

  const session = workouts.find(s => s.id === entry.sessionId);
  if (!session) return;

  const allEx = session.blocks.flatMap(b => b.exercises);

  // Compute stats
  let totalVolume = 0, completedEx = 0, failedSets = 0, totalSets = 0;
  for (const ex of allEx) {
    const sets = entry.exercises[ex.id] || [];
    const done = sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    const failed = sets.filter(s => s.s === 'failed');
    const exComplete = sets.length > 0 && sets.every(s => s.s === 'done' || s.s === 'failed');
    if (exComplete) completedEx++;
    done.forEach(s => { totalVolume += s.w * s.r; });
    failedSets += failed.length;
    totalSets  += sets.length;
  }

  // Duration
  const durationMs = entry.startTimestamp ? entry.timestamp - entry.startTimestamp : null;
  const durationStr = durationMs ? formatDuration(durationMs) : null;

  // PRs set this session
  const sessionPRs = query.sessionPRsFromEntry(appState, entry);
  const prExIds = Object.keys(sessionPRs);

  // Build stats grid
  const stats = [];
  if (durationStr) {
    stats.push({ label: 'Duration', value: durationStr, icon: '⏱' });
  }
  stats.push({ label: 'Total Volume', value: `${totalVolume.toLocaleString()} lbs`, icon: '📦' });
  stats.push({ label: 'Exercises', value: `${completedEx}/${allEx.length}`, icon: '✓' });
  if (failedSets > 0) {
    stats.push({ label: 'Failed Sets', value: String(failedSets), icon: '✗', warn: true });
  }

  const statsHtml = stats.map(s =>
    `<div class="summary-stat ${s.warn ? 'summary-stat-warn' : ''}">
      <div class="summary-stat-icon">${s.icon}</div>
      <div class="summary-stat-val">${s.value}</div>
      <div class="summary-stat-label">${s.label}</div>
    </div>`
  ).join('');

  // PR list
  let prHtml = '';
  if (prExIds.length > 0) {
    const prItems = prExIds.map(exId => {
      const ex = EXERCISE_INDEX[exId];
      const types = sessionPRs[exId].map(t => t === 'weight' ? 'Heaviest' : t === 'reps' ? 'Most Reps' : 'Best Volume').join(', ');
      return `<div class="summary-pr-item">🏆 <strong>${ex?.name ?? exId}</strong> — ${types}</div>`;
    }).join('');
    prHtml = `<div class="summary-pr-section">
      <div class="summary-section-label">PERSONAL RECORDS SET</div>
      ${prItems}
    </div>`;
  }

  // Time info
  const timeHtml = entry.startTimestamp
    ? `<div class="summary-time-row">
        <span>${formatTime(entry.startTimestamp)}</span>
        <span class="summary-time-arrow">→</span>
        <span>${formatTime(entry.timestamp)}</span>
      </div>`
    : '';

  const overlay = document.createElement('div');
  overlay.className = 'summary-modal-overlay';
  overlay.innerHTML = `
    <div class="summary-modal" role="dialog" aria-modal="true" aria-label="Session Summary">
      <div class="summary-header">
        <div class="summary-title">SESSION COMPLETE</div>
        <div class="summary-subtitle">${session.dayLabel} · ${session.sessionLabel}</div>
        ${timeHtml}
      </div>
      <div class="summary-stats">${statsHtml}</div>
      ${prHtml}
      <button class="summary-close-btn" id="summary-close">CLOSE</button>
    </div>`;

  document.body.appendChild(overlay);
  activeSummaryModal = overlay;

  overlay.addEventListener('click', e => { if (e.target === overlay) closeSessionSummaryModal(); });
  overlay.querySelector('#summary-close').addEventListener('click', closeSessionSummaryModal);
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeSessionSummaryModal(); });
}

function closeSessionSummaryModal() {
  if (activeSummaryModal) { activeSummaryModal.remove(); activeSummaryModal = null; }
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

  // Pre-fill only from the current session's already-logged value.
  // Never pre-fill from previous sessions — those belong in the placeholder.
  const prefillW = setObj.w !== null ? setObj.w : '';
  const prefillR = setObj.r !== null ? setObj.r : '';

  // Placeholder: last session's value, then prescribed value as fallback.
  const defaultW = lowerBound(ex?.weight);
  const defaultR = lowerBound(ex?.reps);
  const placeholderW = prevSet?.w ?? (defaultW !== null ? defaultW : '—');
  const placeholderR = prevSet?.r ?? (defaultR !== null ? defaultR : '—');

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
              placeholder="${placeholderW}" value="${prefillW}"/>
            <span class="log-unit">lbs</span>
          </div>
        </div>
        <div class="log-field">
          <label class="log-label" for="log-reps">REPS</label>
          <div class="log-input-wrap">
            <input class="log-input" id="log-reps" type="number"
              inputmode="numeric" min="0" step="1"
              placeholder="${placeholderR}" value="${prefillR}"/>
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
  if (pressTimers.has(key)) {
    cancelPress(key);
    dispatch('TOGGLE_SET', { exId, idx });
  }
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
        lines.push(`     ${ex.sets} × ${formatReps(ex.reps)}  ${formatWeight(ex.weight)}`);
        if (ex.notes) lines.push(`     Note: ${ex.notes}`);
        if (ex.alternatives?.length) lines.push(`     Alt: ${ex.alternatives.join(', ')}`);
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
      for (const [key] of pressTimers) cancelPress(key);
    }
  });

  document.addEventListener('pointercancel', () => {
    for (const [key] of pressTimers) cancelPress(key);
  });

  document.addEventListener('pointermove', e => {
    if (e.movementX ** 2 + e.movementY ** 2 > 16) {
      for (const [key] of pressTimers) cancelPress(key);
    }
  });

  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab?.dataset.sessionId) {
      dispatch('SET_ACTIVE_SESSION', { sessionId: tab.dataset.sessionId });
      return;
    }

    // Exercise header → open history modal (B)
    const exHeader = e.target.closest('.exercise-header[data-ex-id]');
    if (exHeader && !e.target.closest('.set-dot')) {
      openHistoryModal(exHeader.dataset.exId);
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

  // Keyboard accessibility for exercise header
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const exHeader = e.target.closest('.exercise-header[data-ex-id]');
      if (exHeader) {
        e.preventDefault();
        openHistoryModal(exHeader.dataset.exId);
      }
    }
  });
}
