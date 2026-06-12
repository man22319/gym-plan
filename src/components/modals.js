import { workouts, EXERCISE_INDEX, state } from '../core/workouts.js';
import { query } from '../core/queries.js';
import { dispatch, registerStartWorkoutModal } from '../core/reducer.js';
import { makeSet } from '../store/state.js';
import { lowerBound, resolveWeight } from '../core/helpers.js';
import { formatDate, formatTime } from './rendering.js';


export let activeHistoryModal = null;

export function buildSparkline(volumes) {
  if (volumes.length < 2) return '';

  const points = volumes.slice(-10);
  const width = 280;
  const height = 40;
  const padding = 4;

  const maxVal = Math.max(...points);
  const minVal = Math.min(...points);
  const range = maxVal - minVal;

  const xStep = (width - padding * 2) / (points.length - 1);

  const coords = points.map((val, idx) => {
    const x = padding + idx * xStep;
    const y = range === 0
      ? height / 2
      : height - padding - ((val - minVal) / range) * (height - padding * 2);
    return { x, y, val };
  });

  const pathData = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');

  const areaPathData = `
    ${pathData}
    L ${coords[coords.length - 1].x.toFixed(1)} ${height}
    L ${coords[0].x.toFixed(1)} ${height}
    Z
  `;

  const lastCoord = coords[coords.length - 1];
  const delta = points[points.length - 1] - points[0];
  const isUp = delta >= 0;

  return `
    <div class="sparkline-container">
      <div class="sparkline-header">
        <span class="sparkline-title">Volume Trend (Last ${points.length} Sessions)</span>
        <span class="sparkline-delta ${isUp ? 'up' : 'down'}">
          ${isUp ? '▲' : '▼'} ${Math.abs(delta).toLocaleString()} lbs
        </span>
      </div>
      <div class="sparkline-svg-wrap">
        <svg class="sparkline-svg" width="100%" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
          <defs>
            <linearGradient id="sparkline-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--blue)" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="var(--blue)" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <path d="${areaPathData}" fill="url(#sparkline-gradient)" />
          <path d="${pathData}" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="${lastCoord.x.toFixed(1)}" cy="${lastCoord.y.toFixed(1)}" r="3.5" fill="var(--white)" />
          <circle cx="${lastCoord.x.toFixed(1)}" cy="${lastCoord.y.toFixed(1)}" r="7" fill="var(--blue)" fill-opacity="0.4" />
        </svg>
      </div>
    </div>
  `;
}

export function openHistoryModal(exId) {
  closeHistoryModal();

  const ex = EXERCISE_INDEX[exId];
  if (!ex) return;

  const history = query.exerciseHistory(state, exId);

  function est1RM(w, r) {
    if (!w || !r) return null;
    return +(w * (1 + r / 30)).toFixed(1);
  }

  const hasHistory = history.length > 0;

  const rows = [...history].reverse().map(entry => {
    const doneSets = entry.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    const volume = doneSets.reduce((n, s) => n + s.w * s.r, 0);
    const maxRM   = doneSets.length ? Math.max(...doneSets.map(s => est1RM(s.w, s.r) ?? 0)) : null;

    const setCells = entry.sets.map((s, i) => {
      if (s.w === null && s.r === null) return `<span class="hist-set-empty">—</span>`;
      const cls = s.s === 'failed' ? 'hist-set-fail' : 'hist-set-done';
      
      const titleParts = [];
      if (s.n) titleParts.push(s.n);
      if (s.rir !== null && s.rir !== undefined) titleParts.push(`RIR: ${s.rir}`);
      const titleAttr = titleParts.length ? ` title="${titleParts.join(' | ').replace(/"/g, '&quot;')}"` : '';
      
      const noteIndicator = s.n ? `<span class="hist-set-note-indicator">📝</span>` : '';
      const rirIndicator = (s.rir !== null && s.rir !== undefined) ? `<span class="hist-set-rir-indicator" style="font-size:0.5rem; opacity:0.8; margin-left:1px;">(r${s.rir})</span>` : '';
      
      return `<span class="${cls}" style="display: inline-flex; align-items: center; gap: 2px;"${titleAttr}>${s.w ?? '?'}×${s.r ?? '?'}${noteIndicator}${rirIndicator}</span>`;
    }).join('');

    return `<tr>
      <td class="hist-date">${formatDate(entry.timestamp)}</td>
      <td class="hist-sets">${setCells}</td>
      <td class="hist-vol">${volume > 0 ? volume.toLocaleString() : '—'}</td>
      <td class="hist-1rm">${maxRM !== null ? maxRM : '—'}</td>
    </tr>`;
  }).join('');

  const pr = query.personalRecords(state, exId);
  let prHtml = '';
  if (pr.heaviestSet || pr.highestVolume) {
    const prItems = [];
    if (pr.heaviestSet) prItems.push(`<div class="pr-item"><span class="pr-icon">🏆</span><div><div class="pr-item-label">Heaviest Set</div><div class="pr-item-val">${pr.heaviestSet.w} lbs × ${pr.heaviestSet.r} reps <span class="pr-item-date">${formatDate(pr.heaviestSet.date)}</span></div></div></div>`);
    if (pr.highestVolume) prItems.push(`<div class="pr-item"><span class="pr-icon">∑</span><div><div class="pr-item-label">Best Volume</div><div class="pr-item-val">${pr.highestVolume.volume.toLocaleString()} lbs <span class="pr-item-date">${formatDate(pr.highestVolume.date)}</span></div></div></div>`);
    if (pr.mostReps) prItems.push(`<div class="pr-item"><span class="pr-icon">▲</span><div><div class="pr-item-label">Most Reps</div><div class="pr-item-val">${pr.mostReps.r} reps @ ${pr.mostReps.w} lbs <span class="pr-item-date">${formatDate(pr.mostReps.date)}</span></div></div></div>`);
    prHtml = `<div class="hist-pr-section"><div class="hist-section-label">PERSONAL RECORDS</div><div class="hist-pr-list">${prItems.join('')}</div></div>`;
  }

  const volumes = history.map(entry => {
    const doneSets = entry.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    return doneSets.reduce((sum, s) => sum + s.w * s.r, 0);
  });
  const sparklineHtml = buildSparkline(volumes);

  let volumeTrendHtml = '';
  if (volumes.length >= 2) {
    const first = volumes[0];
    const last = volumes[volumes.length - 1];
    if (first > 0) {
      const pctChange = (((last - first) / first) * 100).toFixed(1);
      const isUp = last >= first;
      volumeTrendHtml = `<div style="padding: 0 20px 8px; font-family: 'IBM Plex Mono', monospace; font-size: 0.55rem; color: var(--dim);">
        Volume: <span style="color: ${isUp ? 'var(--green)' : 'var(--red)'}; font-weight: 500;">${isUp ? '+' : ''}${pctChange}%</span> over ${volumes.length} sessions
      </div>`;
    }
  }

  const notesHistoryHtml = buildNotesHistory(history);

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
      ${sparklineHtml}
      ${volumeTrendHtml}
      ${hasHistory ? `<div class="hist-section-label" style="padding: 0 20px 8px;">SESSION LOG</div>` : ''}
      ${tableHtml}
      ${notesHistoryHtml}
    </div>`;

  document.body.appendChild(overlay);
  activeHistoryModal = overlay;

  overlay.addEventListener('click', e => { if (e.target === overlay) closeHistoryModal(); });
  overlay.querySelector('#hist-close').addEventListener('click', closeHistoryModal);
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeHistoryModal(); });
}

export function closeHistoryModal() {
  if (activeHistoryModal) { activeHistoryModal.remove(); activeHistoryModal = null; }
}

export function buildNotesHistory(history) {
  const notes = [];
  history.forEach(entry => {
    (entry.sets || []).forEach((s, idx) => {
      if (s.n && s.n.trim()) {
        notes.push({
          date: formatDate(entry.timestamp),
          note: s.n.trim(),
          setNum: idx + 1
        });
      }
    });
  });

  if (notes.length === 0) return '';

  const recentNotes = notes.slice(-10);

  const itemsHtml = recentNotes.map(item => `
    <div class="hist-note-item">
      <span class="hist-note-date">${item.date} (Set ${item.setNum})</span>
      <span class="hist-note-text">${item.note}</span>
    </div>
  `).join('');

  return `
    <div class="hist-notes-section">
      <div class="hist-section-label" style="padding: 0 20px 8px;">RECENT NOTES</div>
      <div class="hist-notes-list" style="padding: 0 20px 16px; display: flex; flex-direction: column; gap: 6px;">
        ${itemsHtml}
      </div>
    </div>
  `;
}

export let activeSummaryModal = null;

export function openSessionSummaryModal(entry, appState) {
  closeSessionSummaryModal();

  const session = workouts.find(s => s.id === entry.sessionId);
  if (!session) return;

  const allEx = session.blocks.flatMap(b => b.exercises);

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

  const durationMs = entry.startTimestamp ? entry.timestamp - entry.startTimestamp : null;
  const durationStr = durationMs ? formatDuration(durationMs) : null;

  const sessionPRs = query.sessionPRsFromEntry(appState, entry);
  const prExIds = Object.keys(sessionPRs);

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

export function closeSessionSummaryModal() {
  if (activeSummaryModal) { activeSummaryModal.remove(); activeSummaryModal = null; }
}

export let activeModal = null;

export function openLogModal(exId, setIdx) {
  closeLogModal();
  const savedScrollY = window.scrollY;

  const ex       = EXERCISE_INDEX[exId];
  const setObj   = (state.exercises[exId] || [])[setIdx] || makeSet();
  const prevSets = query.lastExerciseSets(state, exId);
  const prevSet  = prevSets ? prevSets[setIdx] : null;

  const prefillW = setObj.w !== null ? setObj.w : '';
  const prefillR = setObj.r !== null ? setObj.r : '';
  const prefillN = setObj.n !== null ? setObj.n : '';

  const defaultW = resolveWeight(null, exId);
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

        <div class="log-field">
          <label class="log-label" for="log-rir">RIR</label>
          <div class="log-input-wrap">
            <input class="log-input" id="log-rir" type="number"
              inputmode="numeric" min="0" max="10" step="1"
              placeholder="0-1" value="${setObj.rir !== null ? setObj.rir : ''}"/>
            <span class="log-unit">RIR</span>
          </div>
        </div>

        <div class="log-field log-field-note">
          <label class="log-label" for="log-note">SET NOTE</label>
          <div class="log-input-wrap">
            <input class="log-input" id="log-note" type="text"
              placeholder="e.g. felt easy, tweaked shoulder" value="${prefillN}"
              style="font-size: 0.95rem; padding: 12px; font-family: inherit;"/>
          </div>
        </div>
      </div>
      <div class="log-modal-actions">
        <button class="log-btn log-btn-cancel" id="log-cancel">Cancel</button>
        <button class="log-btn log-btn-save" id="log-save">Save &amp; Done</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  activeModal = { el: overlay, exId, setIdx, scrollY: savedScrollY };

  const weightInput = overlay.querySelector('#log-weight');
  const repsInput   = overlay.querySelector('#log-reps');
  const noteInput   = overlay.querySelector('#log-note');
  const rirInput    = overlay.querySelector('#log-rir');

  setTimeout(() => weightInput?.focus(), 60);

  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      const restoreY = activeModal?.scrollY ?? 0;
      closeLogModal();
      requestAnimationFrame(() => window.scrollTo(0, restoreY));
    }
  });
  overlay.querySelector('#log-cancel').addEventListener('click', () => {
    const restoreY = activeModal?.scrollY ?? 0;
    closeLogModal();
    requestAnimationFrame(() => window.scrollTo(0, restoreY));
  });

  overlay.querySelector('#log-save').addEventListener('click', () => {
    const w = weightInput.value !== '' ? parseFloat(weightInput.value) : null;
    const r = repsInput.value   !== '' ? parseInt(repsInput.value, 10) : null;
    const n = noteInput.value.trim();
    const rir = rirInput.value !== '' ? parseInt(rirInput.value, 10) : null;
    const restoreY = activeModal?.scrollY ?? 0;
    closeLogModal();
    dispatch('LOG_AND_MARK_DONE', { exId, idx: setIdx, weight: w, reps: r, note: n, rir });
    requestAnimationFrame(() => window.scrollTo(0, restoreY));
  });

  overlay.addEventListener('keydown', e => {
    if (e.key === 'Enter') overlay.querySelector('#log-save').click();
    if (e.key === 'Escape') {
      const restoreY = activeModal?.scrollY ?? 0;
      closeLogModal();
      requestAnimationFrame(() => window.scrollTo(0, restoreY));
    }
  });
}

export function closeLogModal() {
  if (activeModal) { activeModal.el.remove(); activeModal = null; }
}

export function showStartWorkoutModal(onConfirm, onCancel) {
  if (document.querySelector('.start-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'start-modal-overlay';
  overlay.innerHTML = `
    <div class="start-modal" role="dialog" aria-modal="true" aria-label="Start workout?">
      <div class="start-modal-title">Start workout?</div>
      <div class="start-modal-text">This will begin tracking your session.</div>
      <div class="start-modal-actions">
        <button class="start-modal-btn start-modal-btn-confirm" id="start-confirm">Start</button>
        <button class="start-modal-btn start-modal-btn-cancel" id="start-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const doConfirm = () => {
    overlay.remove();
    onConfirm?.();
  };

  const doCancel = () => {
    overlay.remove();
    onCancel?.();
  };

  overlay.querySelector('#start-confirm').addEventListener('click', doConfirm);
  overlay.querySelector('#start-cancel').addEventListener('click', doCancel);

  const escHandler = e => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', escHandler);
      doCancel();
    }
  };
  document.addEventListener('keydown', escHandler);
}

registerStartWorkoutModal(showStartWorkoutModal);
