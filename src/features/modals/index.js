import { workouts, EXERCISE_INDEX, state } from '../../core/state/store.js';
import { query } from '../../core/logic/queries.js';
import { dispatch, registerStartWorkoutModal } from '../../core/logic/reducer.js';
import { makeSet } from '../../core/state/state.js';
import { lowerBound, resolveWeight, getDeltaW } from '../../core/utils/helpers.js';
import { formatDate, formatTime, formatDuration, formatWeight, formatReps } from '../workout/rendering.js';


export let activeHistoryModal = null;

export function buildSparkline(volumes, limit = 3) {
  if (volumes.length < 2) return '';

  const points = limit === 'all' ? volumes : volumes.slice(-limit);
  const validPoints = points.length < 2 ? volumes.slice(-2) : points;

  const pointSpacing = 50;
  const computedWidth = validPoints.length * pointSpacing;
  const width = limit === 'all' && computedWidth > 320 ? computedWidth : 320;
  const height = 64;
  const padding = 6;

  const maxVal = Math.max(...validPoints);
  const minVal = Math.min(...validPoints);
  const range = maxVal - minVal;

  const xStep = (width - padding * 2) / (validPoints.length - 1);

  const coords = validPoints.map((val, idx) => {
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
  const delta = validPoints[validPoints.length - 1] - validPoints[0];
  const isUp = delta >= 0;

  return `
    <div class="sparkline-container" style="padding: 12px 20px;">
      <div class="sparkline-header" style="text-align: center; margin-bottom: 12px; display: flex; flex-direction: column; align-items: center; gap: 6px;">
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
          <span class="sparkline-title" style="font-size: 0.85rem; font-weight: 500; color: var(--white);">Volume Trend</span>
          <select class="sparkline-limit-select" style="background: rgba(255,255,255,0.08); border: 1px solid var(--border); color: var(--white); font-family: inherit; font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; cursor: pointer; outline: none;">
            <option value="3" ${limit === 3 ? 'selected' : ''}>Last 3</option>
            <option value="all" ${limit === 'all' ? 'selected' : ''}>All</option>
          </select>
        </div>
        <span class="sparkline-delta" style="font-family: 'IBM Plex Mono', monospace; font-size: 0.65rem; font-weight: 500; color: ${isUp ? 'var(--green)' : 'var(--red)'};">
          ${isUp ? '▲' : '▼'} ${Math.abs(delta).toLocaleString()} lbs
        </span>
      </div>
      <div class="sparkline-svg-wrap" style="overflow-x: auto; overflow-y: hidden; text-align: center; padding-bottom: 4px;">
        <svg class="sparkline-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="display: inline-block;">
          <defs>
            <linearGradient id="sparkline-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.1"/>
              <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <path d="${areaPathData}" fill="url(#sparkline-gradient)" />
          <path d="${pathData}" fill="none" stroke="rgba(255, 255, 255, 0.3)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx="${lastCoord.x.toFixed(1)}" cy="${lastCoord.y.toFixed(1)}" r="3" fill="rgba(255, 255, 255, 0.6)" />
          <circle cx="${lastCoord.x.toFixed(1)}" cy="${lastCoord.y.toFixed(1)}" r="6" fill="rgba(255, 255, 255, 0.15)" />
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
      
      const noteIndicator = s.n ? `<span class="hist-set-note-indicator" title="Has note">*</span>` : '';
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
    if (pr.heaviestSet) prItems.push(`<div class="pr-item"><span class="pr-icon">PR</span><div><div class="pr-item-label">Heaviest Set</div><div class="pr-item-val">${pr.heaviestSet.w} lbs × ${pr.heaviestSet.r} reps <span class="pr-item-date">${formatDate(pr.heaviestSet.date)}</span></div></div></div>`);
    if (pr.highestVolume) prItems.push(`<div class="pr-item"><span class="pr-icon">∑</span><div><div class="pr-item-label">Best Volume</div><div class="pr-item-val">${pr.highestVolume.volume.toLocaleString()} lbs <span class="pr-item-date">${formatDate(pr.highestVolume.date)}</span></div></div></div>`);
    if (pr.mostReps) prItems.push(`<div class="pr-item"><span class="pr-icon">▲</span><div><div class="pr-item-label">Most Reps</div><div class="pr-item-val">${pr.mostReps.r} reps @ ${pr.mostReps.w} lbs <span class="pr-item-date">${formatDate(pr.mostReps.date)}</span></div></div></div>`);
    prHtml = `<div class="hist-pr-section"><div class="hist-section-label">PERSONAL RECORDS</div><div class="hist-pr-list">${prItems.join('')}</div></div>`;
  }

  const volumes = history.map(entry => {
    const doneSets = entry.sets.filter(s => s.s === 'done' && s.w !== null && s.r !== null);
    return doneSets.reduce((sum, s) => sum + s.w * s.r, 0);
  });
  let currentLimit = 3;

  function renderTrendSection() {
    const sparklineHtml = buildSparkline(volumes, currentLimit);
    
    let volumeTrendHtml = '';
    const validVolumes = currentLimit === 'all' ? volumes : volumes.slice(-currentLimit);
    const useVolumes = validVolumes.length >= 2 ? validVolumes : volumes.slice(-2);
    
    if (useVolumes.length >= 2) {
      const first = useVolumes[0];
      const last = useVolumes[useVolumes.length - 1];
      if (first > 0) {
        const pctChange = (((last - first) / first) * 100).toFixed(1);
        const isUp = last >= first;
        volumeTrendHtml = `<div style="padding: 0 20px 24px; text-align: center; font-family: 'IBM Plex Mono', monospace; font-size: 0.55rem; color: var(--muted);">
          Volume: <span style="color: ${isUp ? 'var(--green)' : 'var(--red)'}; font-weight: 500;">${isUp ? '+' : ''}${pctChange}%</span> over ${useVolumes.length} sessions
        </div>`;
      }
    }
    return sparklineHtml + volumeTrendHtml;
  }

  const trendHtml = `<div id="trend-section-wrapper">${renderTrendSection()}</div>`;

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
      <div class="modal-drag-handle" style="margin: 12px auto 4px;"></div>
      <div class="hist-header">
        <div>
          <div class="hist-title">${ex.name}</div>
          <div class="hist-subtitle">${ex.sets} × ${formatReps(ex.reps)}${ex.weight ? ' · ' + formatWeight(ex.weight) : ''}</div>
        </div>
        <button class="hist-close" id="hist-close" aria-label="Close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      ${prHtml}
      ${trendHtml}
      ${hasHistory ? `<div class="hist-section-label" style="padding: 24px 20px 12px;">SESSION LOG</div>` : ''}
      ${tableHtml}
      ${notesHistoryHtml}
    </div>`;

  document.body.appendChild(overlay);
  activeHistoryModal = overlay;

  overlay.addEventListener('click', e => { if (e.target === overlay) closeHistoryModal(); });
  overlay.querySelector('#hist-close').addEventListener('click', closeHistoryModal);
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeHistoryModal(); });

  const modal = overlay.querySelector('.history-modal');
  const handle = overlay.querySelector('.modal-drag-handle');
  if (modal && handle) {
    enableDragToDismiss(modal, handle, closeHistoryModal);
  }

  overlay.addEventListener('change', e => {
    if (e.target.classList.contains('sparkline-limit-select')) {
      currentLimit = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
      const wrapper = overlay.querySelector('#trend-section-wrapper');
      if (wrapper) wrapper.innerHTML = renderTrendSection();
    }
  });
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

export function openSessionSummaryModal(entry, appState, isCycleComplete = false) {
  closeSessionSummaryModal();

  const session = workouts.find(s => s.id === entry.sessionId);
  if (!session) return;

  const allEx = session.blocks.flatMap(b => b.exercises);

  let totalVolume = 0, completedEx = 0, failedSets = 0, totalSets = 0;
  for (const ex of allEx) {
    const instanceId = ex.instanceId;
    const sets = entry.exercises[instanceId] || [];
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

  // Workout time: start → last set (pure training time, excludes post-workout overhead)
  const workoutDurationMs = entry.startTimestamp && entry.lastSetTimestamp
    ? entry.lastSetTimestamp - entry.startTimestamp
    : null;
  const workoutDurationStr = workoutDurationMs ? formatDuration(workoutDurationMs) : null;

  // Show separate workout/session times if they differ by more than 1 minute
  const showBothDurations = workoutDurationStr && durationStr
    && durationMs && workoutDurationMs
    && (durationMs - workoutDurationMs) > 60_000;

  const sessionPRs = query.sessionPRsFromEntry(appState, entry);
  const prExIds = Object.keys(sessionPRs);

  const stats = [];
  if (showBothDurations) {
    stats.push({ label: 'Workout', value: workoutDurationStr, icon: '' });
    stats.push({ label: 'Session', value: durationStr, icon: '' });
  } else if (durationStr) {
    stats.push({ label: 'Duration', value: durationStr, icon: '' });
  }
  stats.push({ label: 'Total Volume', value: `${totalVolume.toLocaleString()} lbs`, icon: '' });
  stats.push({ label: 'Exercises', value: `${completedEx}/${allEx.length}`, icon: '' });
  if (failedSets > 0) {
    stats.push({ label: 'Failed Sets', value: String(failedSets), icon: '', warn: true });
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
      return `<div class="summary-pr-item">PR: <strong>${ex?.name ?? exId}</strong> — ${types}</div>`;
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

  const cycleCompleteHtml = isCycleComplete ? `
    <div class="summary-cycle-banner">
      <div class="summary-cycle-icon">CYCLE</div>
      <div class="summary-cycle-body">
        <div class="summary-cycle-title">WEEKLY CYCLE COMPLETE</div>
        <div class="summary-cycle-sub">All sessions done · Next cycle ready</div>
      </div>
    </div>` : '';

  const overlay = document.createElement('div');
  overlay.className = 'summary-modal-overlay';
  overlay.innerHTML = `
    <div class="summary-modal" role="dialog" aria-modal="true" aria-label="Session Summary">
      <div class="modal-drag-handle"></div>
      ${cycleCompleteHtml}
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

  const modal = overlay.querySelector('.summary-modal');
  const handle = overlay.querySelector('.modal-drag-handle');
  if (modal && handle) {
    enableDragToDismiss(modal, handle, closeSessionSummaryModal);
  }
}

export function closeSessionSummaryModal() {
  if (activeSummaryModal) { activeSummaryModal.remove(); activeSummaryModal = null; }
}

export let activeModal = null;

export function openLogModal(exId, setIdx) {
  closeLogModal();
  const savedScrollY = window.scrollY;

  const ex       = EXERCISE_INDEX[exId];
  const sets     = state.exercises[exId] || [];
  const setObj   = sets[setIdx] || makeSet();
  const prevSets = query.lastExerciseSets(state, exId);
  const prevSet  = prevSets ? prevSets[setIdx] : null;

  // ── Intra-session carry-forward ──────────────────────────────────
  // If an earlier set in THIS session was already logged, use its
  // weight/reps/rir as the default.  This saves re-typing the same
  // numbers across sets 2, 3, 4…
  let carryW = null, carryR = null, carryRIR = null;
  for (let i = setIdx - 1; i >= 0; i--) {
    const prev = sets[i];
    if (prev && (prev.s === 'done' || prev.s === 'failed')) {
      if (carryW === null && prev.w !== null) carryW = prev.w;
      if (carryR === null && prev.r !== null) carryR = prev.r;
      if (carryRIR === null && prev.rir !== null && prev.rir !== undefined) carryRIR = prev.rir;
      if (carryW !== null && carryR !== null) break;
    }
  }

  // Priority: already-logged value on THIS set > carry-forward from earlier set > last session > prescribed
  const defaultW = resolveWeight(null, exId);
  const defaultR = lowerBound(ex?.reps);

  const prefillW = setObj.w !== null ? setObj.w
                 : carryW  !== null ? carryW
                 : prevSet?.w       ?? (defaultW !== null ? defaultW : '');
  const prefillR = setObj.r !== null ? setObj.r
                 : carryR  !== null ? carryR
                 : prevSet?.r       ?? (defaultR !== null ? defaultR : '');
  const prefillN = setObj.n !== null ? setObj.n : '';
  const prefillRIR = setObj.rir !== null && setObj.rir !== undefined ? setObj.rir
                   : carryRIR !== null ? carryRIR : '';

  // ── ROM carry-forward ─────────────────────────────────────────────
  let carryROM = null;
  for (let i = setIdx - 1; i >= 0; i--) {
    const prev = sets[i];
    if (prev && (prev.s === 'done' || prev.s === 'failed') && prev.rom) {
      carryROM = prev.rom;
      break;
    }
  }
  const prefillROM = setObj.rom ?? carryROM ?? 'full';

  const placeholderW = prefillW !== '' ? prefillW : '—';
  const placeholderR = prefillR !== '' ? prefillR : '—';

  const stepVal = getDeltaW(ex?.deltaW, prefillW !== '' ? parseFloat(prefillW) : null);
  const stepAttr = stepVal !== undefined ? `step="${stepVal}"` : 'step="any"';

  const overlay = document.createElement('div');
  overlay.className = 'log-modal-overlay';
  overlay.innerHTML = `
    <div class="log-modal" role="dialog" aria-modal="true" aria-label="Log Set ${setIdx + 1}">
      <div class="modal-drag-handle"></div>
      <div class="log-modal-title">${ex?.name ?? exId}</div>
      <div class="log-modal-sub">SET ${setIdx + 1} ${prevSet && (prevSet.w !== null || prevSet.r !== null)
        ? `<span class="log-modal-prev">· Last: ${prevSet.w ?? '?'}×${prevSet.r ?? '?'}</span>`
        : ''}</div>
      <div class="log-fields">
        <div class="log-field">
          <label class="log-label" for="log-weight">WEIGHT</label>
          <div class="log-input-wrap">
            <input class="log-input" id="log-weight" type="number"
              inputmode="decimal" min="0" ${stepAttr}
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
              placeholder="0-1" value="${prefillRIR}"/>
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
        <div class="log-field log-field-rom">
          <label class="log-label">ROM</label>
          <div class="segmented-control segmented-control-rom" id="log-rom">
            <button type="button" class="segment-btn${prefillROM === 'full' ? ' active' : ''}" data-rom="full">Full</button>
            <button type="button" class="segment-btn${prefillROM === 'partial' ? ' active' : ''}" data-rom="partial">Partial</button>
            <button type="button" class="segment-btn${prefillROM === 'none' ? ' active' : ''}" data-rom="none">None</button>
          </div>
        </div>
        <div class="log-field log-field-deload" style="align-items: center; flex-direction: row; justify-content: space-between; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);">
          <label class="log-label" for="log-deload" style="margin-bottom: 0; color: var(--muted); display: flex; align-items: center; gap: 6px;">
            <span>DELOAD SET</span>
            <span style="font-size: 0.55rem; background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px;">Exclude from progression</span>
          </label>
          <div class="log-input-wrap" style="width: auto;">
            <input type="checkbox" id="log-deload" style="width: 20px; height: 20px; accent-color: var(--primary);" ${setObj.deload ? 'checked' : ''}/>
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
  const romControl  = overlay.querySelector('#log-rom');
  const deloadCheck = overlay.querySelector('#log-deload');

  // ROM segmented control interaction
  let selectedROM = prefillROM;
  romControl.addEventListener('click', e => {
    const btn = e.target.closest('[data-rom]');
    if (!btn) return;
    selectedROM = btn.dataset.rom;
    romControl.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  setTimeout(() => weightInput?.focus(), 60);

  const closeCallback = () => {
    const restoreY = activeModal?.scrollY ?? 0;
    closeLogModal();
    requestAnimationFrame(() => window.scrollTo(0, restoreY));
  };

  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      closeCallback();
    }
  });
  overlay.querySelector('#log-cancel').addEventListener('click', () => {
    closeCallback();
  });

  overlay.querySelector('#log-save').addEventListener('click', () => {
    const w = weightInput.value !== '' ? parseFloat(weightInput.value) : null;
    const r = repsInput.value   !== '' ? parseInt(repsInput.value, 10) : null;
    const n = noteInput.value.trim();
    const rir = rirInput.value !== '' ? parseInt(rirInput.value, 10) : null;
    const rom = selectedROM;
    const deload = deloadCheck ? deloadCheck.checked : false;
    closeCallback();
    dispatch('LOG_AND_MARK_DONE', { exId, idx: setIdx, weight: w, reps: r, note: n, rir, rom, deload });
  });

  overlay.addEventListener('keydown', e => {
    if (e.key === 'Enter') overlay.querySelector('#log-save').click();
    if (e.key === 'Escape') {
      closeCallback();
    }
  });

  const modal = overlay.querySelector('.log-modal');
  const handle = overlay.querySelector('.modal-drag-handle');
  if (modal && handle) {
    enableDragToDismiss(modal, handle, closeCallback);
  }
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

// ── Confirm Modal (destructive-action guard) ────────────────────────────────
// opts: { dangerous: bool, confirmLabel: string, cancelLabel: string }

export function showConfirmModal(title, body, onConfirm, opts = {}) {
  const existing = document.querySelector('.confirm-modal-overlay');
  if (existing) return;

  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';

  const dangerous     = opts.dangerous    ?? false;
  const confirmLabel  = opts.confirmLabel ?? 'Confirm';
  const cancelLabel   = opts.cancelLabel  ?? 'Cancel';

  overlay.innerHTML = `
    <div class="confirm-modal" role="dialog" aria-modal="true">
      <div class="confirm-modal-title">${title}</div>
      <div class="confirm-modal-body">${body}</div>
      <div class="confirm-modal-actions">
        <button class="confirm-modal-btn confirm-modal-btn-cancel" id="confirm-cancel">${cancelLabel}</button>
        <button class="confirm-modal-btn confirm-modal-btn-confirm ${dangerous ? 'danger' : ''}" id="confirm-ok">${confirmLabel}</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();

  const doConfirm = () => { close(); onConfirm?.(); };
  const doCancel  = () => close();

  overlay.querySelector('#confirm-ok').addEventListener('click', doConfirm);
  overlay.querySelector('#confirm-cancel').addEventListener('click', doCancel);
  overlay.addEventListener('click', e => { if (e.target === overlay) doCancel(); });

  const escHandler = e => {
    if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); doCancel(); }
  };
  document.addEventListener('keydown', escHandler);
}

function enableDragToDismiss(modalEl, handleEl, onClose) {
  let startY = 0;
  let currentY = 0;
  let startTime = 0;
  let isDragging = false;
  let dragOffset = 0;
  let activePointerId = null;

  handleEl.addEventListener('pointerdown', onPointerDown);

  function onPointerDown(e) {
    if (e.button !== 0) return;
    startY = e.clientY;
    startTime = Date.now();
    isDragging = true;
    activePointerId = e.pointerId;
    handleEl.setPointerCapture(activePointerId);
    
    modalEl.style.transition = 'none';
    modalEl.style.willChange = 'transform';
    const overlayEl = modalEl.parentElement;
    if (overlayEl) overlayEl.style.transition = 'none';

    handleEl.addEventListener('pointermove', onPointerMove);
    handleEl.addEventListener('pointerup', onPointerUp);
    handleEl.addEventListener('pointercancel', onPointerCancel);
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    currentY = e.clientY;
    dragOffset = currentY - startY;

    if (dragOffset > 0) {
      modalEl.style.transform = `translateY(${dragOffset}px)`;
      const overlayEl = modalEl.parentElement;
      if (overlayEl) {
        const maxDrag = modalEl.offsetHeight || 400;
        const ratio = Math.max(0, 1 - (dragOffset / maxDrag));
        overlayEl.style.opacity = ratio;
      }
    } else {
      const resist = dragOffset * 0.15;
      modalEl.style.transform = `translateY(${resist}px)`;
    }
  }

  function onPointerUp(e) {
    if (!isDragging) return;

    const dragDuration = (Date.now() - startTime) / 1000; // in seconds
    const velocity = dragDuration > 0 ? dragOffset / dragDuration : 0;
    const threshold = (modalEl.offsetHeight || 300) * 0.5;
    const overlayEl = modalEl.parentElement;
    
    cleanup();

    if (dragOffset > threshold || velocity > 800) {
      modalEl.style.transition = 'transform 0.25s ease-out';
      modalEl.style.transform = 'translateY(100%)';
      if (overlayEl) {
        overlayEl.style.pointerEvents = 'none';
        overlayEl.style.transition = 'opacity 0.25s ease-out';
        overlayEl.style.opacity = '0';
      }
      setTimeout(() => {
        onClose();
      }, 250);
    } else {
      modalEl.style.transition = 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)';
      modalEl.style.transform = 'translateY(0)';
      if (overlayEl) {
        overlayEl.style.transition = 'opacity 0.2s ease';
        overlayEl.style.opacity = '1';
        setTimeout(() => {
          overlayEl.style.removeProperty('opacity');
          overlayEl.style.transition = '';
        }, 200);
      }
      setTimeout(() => {
        modalEl.style.transition = '';
        modalEl.style.removeProperty('will-change');
      }, 200);
    }
  }

  function onPointerCancel(e) {
    if (!isDragging) return;
    cleanup();
    modalEl.style.transition = 'transform 0.2s ease-out';
    modalEl.style.transform = 'translateY(0)';
    const overlayEl = modalEl.parentElement;
    if (overlayEl) {
      overlayEl.style.opacity = '';
      overlayEl.style.transition = '';
    }
    setTimeout(() => {
      modalEl.style.removeProperty('will-change');
    }, 200);
  }

  function cleanup() {
    isDragging = false;
    if (activePointerId !== null) {
      try { handleEl.releasePointerCapture(activePointerId); } catch (e) {}
      activePointerId = null;
    }
    handleEl.removeEventListener('pointermove', onPointerMove);
    handleEl.removeEventListener('pointerup', onPointerUp);
    handleEl.removeEventListener('pointercancel', onPointerCancel);
  }
}

