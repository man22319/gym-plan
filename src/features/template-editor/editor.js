// ==========================================
// ─── TEMPLATE EDITOR ───
// ==========================================
// Dual-panel editor: Exercise Library + Session Builder.
//
// Key invariants:
//   - exerciseRef keys are stable and read-only in the UI
//   - Canonical edits propagate to all sessions referencing the exerciseRef
//   - Session instances store only: instanceId, exerciseRef, letter, + optional overrides
//   - Name change resets notes to ""

//   - `load` is used everywhere (not `weight`)
// ==========================================

import { state } from '../../core/state/store.js';
import { dispatch } from '../../core/logic/reducer.js';

// ── Constants ────────────────────────────────────────────────────────────────

const EQUIPMENT_TYPES = [
  { value: 'machine',       label: 'Machine' },
  { value: 'dumbbell',      label: 'Dumbbell' },
  { value: 'barbell',       label: 'Barbell' },
  { value: 'cable',         label: 'Cable' },
  { value: 'bodyweight',    label: 'Bodyweight' },
  { value: 'smith_machine', label: 'Smith Machine' },
  { value: 'other',         label: 'Other' },
];

// Instance-level override fields (subset of canonical fields)
const INSTANCE_OVERRIDE_KEYS = ['sets', 'reps', 'load'];

// ── Editor state ─────────────────────────────────────────────────────────────

let draftLibrary = {};
let draftSessions = [];
let draftSessionsPerWeek = 3;
let selectedSessionId = null;
let expandedExerciseRefs = new Set();
let expandedInstanceIds = new Set();
let activeTab = 'library'; // 'library' | 'sessions'
let overlayEl = null;
let exercisePickerState = null; // { blockIdx, callback }
let librarySearchQuery = '';
let pickerSearchQuery = '';

// ── Helpers ──────────────────────────────────────────────────────────────────

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function generateId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}



/** Format load for display */
function formatLoad(load) {
  if (!load) return 'BW';
  if ('value' in load) return `${load.value} ${load.unit || 'lbs'}`;
  if ('min' in load) return `${load.min}–${load.max} ${load.unit || 'lbs'}`;
  return 'BW';
}

/** Format reps for display */
function formatReps(reps) {
  if (!reps) return '—';
  if (reps.min === reps.max) return `${reps.min}`;
  return `${reps.min}–${reps.max}`;
}

/** SVG icons */
const ICON = {
  close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  override: '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>',
};

// ══════════════════════════════════════════
// ─── PUBLIC API ───
// ══════════════════════════════════════════

export function openTemplateEditor() {
  if (overlayEl) return;

  // Deep clone from current application state
  draftLibrary = deepClone(state.exerciseLibrary ?? {});
  draftSessions = deepClone(state.sessions ?? []);
  draftSessionsPerWeek = state.sessionsPerWeek ?? 3;
  selectedSessionId = draftSessions[0]?.id || null;
  expandedExerciseRefs.clear();
  expandedInstanceIds.clear();
  activeTab = 'library';
  exercisePickerState = null;
  librarySearchQuery = '';
  pickerSearchQuery = '';

  overlayEl = document.createElement('div');
  overlayEl.className = 'te-overlay';
  overlayEl.innerHTML = `
    <div class="te-modal" role="dialog" aria-modal="true" aria-label="Template Editor">
      <div class="te-header">
        <div class="te-header-title">Template Editor</div>
        <button class="te-close-btn" id="te-close-btn" aria-label="Close">${ICON.close}</button>
      </div>
      <div class="te-tabs">
        <button class="te-tab active" data-tab="library">Exercise Library</button>
        <button class="te-tab" data-tab="sessions">Session Builder</button>
      </div>
      <div class="te-body" id="te-body"></div>
      <div class="te-footer">
        <button class="te-btn te-btn-cancel" id="te-cancel-btn">Cancel</button>
        <button class="te-btn te-btn-save" id="te-save-btn">Save Template</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlayEl);
  setupEditorEvents();
  renderBody();
}

function closeTemplateEditor() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

// ══════════════════════════════════════════
// ─── RENDER: BODY DISPATCH ───
// ══════════════════════════════════════════

function renderBody() {
  if (!overlayEl) return;
  const body = overlayEl.querySelector('#te-body');
  if (!body) return;

  // Update tab active states
  overlayEl.querySelectorAll('.te-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === activeTab);
  });

  if (activeTab === 'library') {
    renderLibraryPanel(body);
  } else {
    renderSessionsPanel(body);
  }
}

// ══════════════════════════════════════════
// ─── RENDER: EXERCISE LIBRARY PANEL ───
// ══════════════════════════════════════════

function renderLibraryPanel(container) {
  const refs = Object.keys(draftLibrary);
  const filtered = librarySearchQuery
    ? refs.filter(ref => {
        const ex = draftLibrary[ref];
        const q = librarySearchQuery.toLowerCase();
        return ref.toLowerCase().includes(q) || (ex.name || '').toLowerCase().includes(q);
      })
    : refs;

  const exerciseCardsHtml = filtered.map(ref => {
    const ex = draftLibrary[ref];
    const isExpanded = expandedExerciseRefs.has(ref);

    // Count sessions referencing this exerciseRef
    let usageCount = 0;
    draftSessions.forEach(s =>
      (s.blocks || []).forEach(b =>
        (b.exercises || []).forEach(inst => {
          if (inst.exerciseRef === ref) usageCount++;
        })
      )
    );

    return `
      <div class="te-lib-card ${isExpanded ? 'expanded' : ''}" data-ref="${ref}">
        <div class="te-lib-card-header" data-ref="${ref}">
          <div class="te-lib-card-header-left">
            <span class="te-lib-toggle">${isExpanded ? '▾' : '▸'}</span>
            <span class="te-lib-card-name">${ex.name || 'Unnamed'}</span>
            <span class="te-ref-badge">${ref}</span>
          </div>
          <div class="te-lib-card-header-right">
            <span class="te-lib-usage-badge" title="Used in ${usageCount} session placement(s)">${usageCount}×</span>
            <span class="te-lib-card-meta">${ex.sets || 3}×${formatReps(ex.reps)} · ${formatLoad(ex.load)}</span>
          </div>
        </div>
        ${isExpanded ? renderLibraryCardBody(ref, ex) : ''}
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="te-lib-panel">
      <div class="te-lib-toolbar">
        <div class="te-search-wrap">
          ${ICON.search}
          <input type="text" class="te-search-input" id="te-lib-search" placeholder="Search exercises…" value="${librarySearchQuery}" />
        </div>
        <button class="te-add-btn" id="te-add-exercise-lib">+ New Exercise</button>
      </div>
      <div class="te-lib-list">
        ${exerciseCardsHtml || '<div class="te-empty-msg">No exercises in library.</div>'}
      </div>
    </div>
  `;
}

function renderLibraryCardBody(ref, ex) {
  const eqOptions = EQUIPMENT_TYPES.map(t =>
    `<option value="${t.value}" ${ex.equipmentType === t.value ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  // Load mode: 'single' if load.value exists, 'range' if load.min/max, 'none' otherwise
  let loadMode = 'none';
  if (ex.load) {
    loadMode = ('min' in ex.load) ? 'range' : 'single';
  }

  let loadFieldsHtml = '';
  if (loadMode === 'single') {
    loadFieldsHtml = `
      <div class="te-field-row">
        <div class="te-field-sm">
          <label class="te-field-label">Load Value</label>
          <input type="number" step="any" class="te-input te-lib-field" data-ref="${ref}" data-field="load.value" value="${ex.load?.value ?? 0}" />
        </div>
        <div class="te-field-sm">
          <label class="te-field-label">Unit</label>
          <input type="text" class="te-input te-lib-field" data-ref="${ref}" data-field="load.unit" value="${ex.load?.unit || 'lbs'}" />
        </div>
      </div>
    `;
  } else if (loadMode === 'range') {
    loadFieldsHtml = `
      <div class="te-field-row">
        <div class="te-field-sm">
          <label class="te-field-label">Load Min</label>
          <input type="number" step="any" class="te-input te-lib-field" data-ref="${ref}" data-field="load.min" value="${ex.load?.min ?? 0}" />
        </div>
        <div class="te-field-sm">
          <label class="te-field-label">Load Max</label>
          <input type="number" step="any" class="te-input te-lib-field" data-ref="${ref}" data-field="load.max" value="${ex.load?.max ?? 0}" />
        </div>
        <div class="te-field-sm">
          <label class="te-field-label">Unit</label>
          <input type="text" class="te-input te-lib-field" data-ref="${ref}" data-field="load.unit" value="${ex.load?.unit || 'lbs'}" />
        </div>
      </div>
    `;
  }

  return `
    <div class="te-lib-card-body">
      <div class="te-fields-grid">
        <div class="te-field">
          <label class="te-field-label">Exercise Name</label>
          <input type="text" class="te-input te-lib-field" data-ref="${ref}" data-field="name" value="${ex.name || ''}" />
        </div>
        <div class="te-field">
          <label class="te-field-label">Equipment Type</label>
          <select class="te-select te-lib-field" data-ref="${ref}" data-field="equipmentType">
            ${eqOptions}
          </select>
        </div>
        <div class="te-field">
          <label class="te-field-label">Sets</label>
          <input type="number" class="te-input te-lib-field" data-ref="${ref}" data-field="sets" value="${ex.sets ?? 3}" min="1" max="10" />
        </div>
        <div class="te-field">
          <label class="te-field-label">Reps</label>
          <div class="te-field-row">
            <div class="te-field-sm">
              <label class="te-field-label">Min</label>
              <input type="number" class="te-input te-lib-field" data-ref="${ref}" data-field="reps.min" value="${ex.reps?.min ?? 8}" />
            </div>
            <div class="te-field-sm">
              <label class="te-field-label">Max</label>
              <input type="number" class="te-input te-lib-field" data-ref="${ref}" data-field="reps.max" value="${ex.reps?.max ?? 12}" />
            </div>
          </div>
        </div>
      </div>

      <div class="te-fields-grid">
        <div class="te-field te-field-wide">
          <label class="te-field-label">Load Mode</label>
          <select class="te-select te-lib-load-mode" data-ref="${ref}">
            <option value="none" ${loadMode === 'none' ? 'selected' : ''}>None (Bodyweight)</option>
            <option value="single" ${loadMode === 'single' ? 'selected' : ''}>Fixed Value</option>
            <option value="range" ${loadMode === 'range' ? 'selected' : ''}>Min / Max Range</option>
          </select>
        </div>
        ${loadFieldsHtml}
      </div>

      <div class="te-fields-grid">
        <div class="te-field">
          <label class="te-field-label">ΔW (Progression Step)</label>
          <input type="number" step="any" class="te-input te-lib-field" data-ref="${ref}" data-field="deltaW" value="${ex.deltaW ?? 5}" />
        </div>
        <div class="te-field">
          <label class="te-field-label">Manual ΔW Override</label>
          <label class="te-toggle-wrap">
            <input type="checkbox" class="te-checkbox te-lib-field" data-ref="${ref}" data-field="manualDeltaWOverride" ${ex.manualDeltaWOverride ? 'checked' : ''} />
            <span class="te-toggle-label">${ex.manualDeltaWOverride ? 'Manual' : 'Auto'}</span>
          </label>
        </div>
        <div class="te-field">
          <label class="te-field-label">Rest Between Sets (s)</label>
          <input type="number" class="te-input te-lib-field" data-ref="${ref}" data-field="restBetweenSets" value="${ex.restBetweenSets ?? 90}" />
        </div>
        <div class="te-field">
          <label class="te-field-label">Rest Between Exercises (s)</label>
          <input type="number" class="te-input te-lib-field" data-ref="${ref}" data-field="restBetweenExercises" value="${ex.restBetweenExercises ?? 60}" />
        </div>
      </div>

      <div class="te-field te-field-wide">
        <label class="te-field-label">Notes / Cues</label>
        <textarea class="te-textarea te-lib-field" data-ref="${ref}" data-field="notes" rows="2">${ex.notes || ''}</textarea>
      </div>

      <div class="te-lib-card-actions">
        <button class="te-btn te-btn-danger te-delete-lib-exercise" data-ref="${ref}">Delete Exercise</button>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════
// ─── RENDER: SESSION BUILDER PANEL ───
// ══════════════════════════════════════════

function renderSessionsPanel(container) {
  // Sidebar + main split
  const sidebarHtml = renderSessionSidebar();
  const mainHtml = renderSessionMain();

  container.innerHTML = `
    <div class="te-sessions-layout">
      <div class="te-sidebar" id="te-sidebar">${sidebarHtml}</div>
      <div class="te-main" id="te-main">${mainHtml}</div>
    </div>
    ${exercisePickerState ? renderExercisePicker() : ''}
  `;
}

function renderSessionSidebar() {
  const sessionTabsHtml = draftSessions.map((s, idx) => {
    const activeClass = s.id === selectedSessionId ? 'active' : '';
    return `
      <div class="te-sidebar-tab ${activeClass}" data-session-id="${s.id}">
        <div class="te-sidebar-tab-title">
          <span class="te-sidebar-day">${s.dayLabel || '???'}</span>
          <span class="te-sidebar-label">${s.sessionLabel || '???'}</span>
        </div>
        <div class="te-sidebar-tab-actions">
          <button class="te-tab-action-btn te-move-session-up" data-idx="${idx}" title="Move Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="te-tab-action-btn te-move-session-down" data-idx="${idx}" title="Move Down" ${idx === draftSessions.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="te-tab-action-btn te-delete-session" data-idx="${idx}" title="Delete">${ICON.trash}</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="te-sidebar-section">
      <label class="te-label" for="te-sessions-per-week">Sessions Per Week</label>
      <input type="number" id="te-sessions-per-week" class="te-input" min="1" max="7" value="${draftSessionsPerWeek}" />
    </div>
    <div class="te-sidebar-section-header">
      <span>WORKOUT SESSIONS</span>
      <button class="te-add-btn" id="te-add-session-btn">+ Add</button>
    </div>
    <div class="te-sidebar-tabs">
      ${sessionTabsHtml || '<div class="te-empty-msg">No sessions created yet.</div>'}
    </div>
  `;
}

function renderSessionMain() {
  const currentSession = draftSessions.find(s => s.id === selectedSessionId);
  if (!currentSession) {
    return `
      <div class="te-empty-state">
        <div class="te-empty-state-title">No Session Selected</div>
        <div class="te-empty-state-text">Select a workout session from the sidebar or click "+ Add" to create a new one.</div>
      </div>
    `;
  }

  const blocksHtml = (currentSession.blocks || []).map((block, blockIdx) => {
    const exercisesHtml = (block.exercises || []).map((inst, exIdx) => {
      return renderSessionExerciseCard(inst, blockIdx, exIdx, block, currentSession);
    }).join('');

    return `
      <div class="te-block-card">
        <div class="te-block-header">
          <input type="text" class="te-block-label-input" data-block-idx="${blockIdx}" value="${block.label || ''}" placeholder="e.g. Superset 1 — Pull / Push" />
          <div class="te-block-actions">
            <button class="te-block-action-btn te-move-block-up" data-block-idx="${blockIdx}" title="Move Up" ${blockIdx === 0 ? 'disabled' : ''}>▲</button>
            <button class="te-block-action-btn te-move-block-down" data-block-idx="${blockIdx}" title="Move Down" ${blockIdx === currentSession.blocks.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="te-block-action-btn te-delete-block" data-block-idx="${blockIdx}" title="Delete">${ICON.trash}</button>
          </div>
        </div>
        <div class="te-block-exercises">
          ${exercisesHtml || '<div class="te-empty-msg">No exercises. Click "+ Add Exercise" below.</div>'}
        </div>
        <button class="te-add-exercise-btn" data-block-idx="${blockIdx}">+ Add Exercise</button>
      </div>
    `;
  }).join('');

  return `
    <div class="te-session-detail-mobile-back">
      <button class="te-mobile-back-btn" id="te-mobile-back-btn">← Back to Sessions</button>
    </div>
    <div class="te-section-title">Session Configuration</div>
    <div class="te-session-settings">
      <div class="te-fields-grid">
        <div class="te-field">
          <label class="te-field-label" for="te-session-day">Day Code (e.g. MON, TUE)</label>
          <input type="text" id="te-session-day" class="te-input te-session-field" data-field="dayLabel" value="${currentSession.dayLabel || ''}" />
        </div>
        <div class="te-field">
          <label class="te-field-label" for="te-session-label">Session Name</label>
          <input type="text" id="te-session-label" class="te-input te-session-field" data-field="sessionLabel" value="${currentSession.sessionLabel || ''}" />
        </div>
      </div>
    </div>

    <div class="te-section-title-with-btn">
      <span>Exercise Blocks</span>
      <button class="te-add-btn te-add-block-btn">+ Add Block</button>
    </div>

    <div class="te-blocks-list">
      ${blocksHtml || '<div class="te-empty-msg">No exercise blocks. Click "+ Add Block" above to start.</div>'}
    </div>
  `;
}

function renderSessionExerciseCard(inst, blockIdx, exIdx, block, session) {
  const canonicalEx = draftLibrary[inst.exerciseRef] || {};
  const instanceId = inst.instanceId;
  const isExpanded = expandedInstanceIds.has(instanceId);

  // Resolved values (canonical + overrides)
  const resolvedSets = inst.sets ?? canonicalEx.sets ?? 3;
  const resolvedReps = inst.reps ?? canonicalEx.reps ?? { min: 8, max: 12 };
  const resolvedLoad = inst.load ?? canonicalEx.load;

  // Check which fields are overridden
  const hasSetOverride = inst.sets !== undefined;
  const hasRepOverride = inst.reps !== undefined;
  const hasLoadOverride = inst.load !== undefined;

  const overrideBadges = [
    hasSetOverride ? '<span class="te-override-badge" title="Sets overridden">sets</span>' : '',
    hasRepOverride ? '<span class="te-override-badge" title="Reps overridden">reps</span>' : '',
    hasLoadOverride ? '<span class="te-override-badge" title="Load overridden">load</span>' : '',
  ].filter(Boolean).join('');

  let expandedHtml = '';
  if (isExpanded) {
    expandedHtml = `
      <div class="te-inst-body">
        <div class="te-inst-info-row">
          <span class="te-ref-badge">${inst.exerciseRef}</span>
          <span class="te-inst-id-badge">ID: ${instanceId}</span>
        </div>

        <div class="te-inst-section-label">Instance Overrides <span class="te-inst-section-hint">(leave blank to inherit from library)</span></div>

        <div class="te-fields-grid">
          <div class="te-field">
            <label class="te-field-label">
              Sets
              ${hasSetOverride ? '<span class="te-override-dot" title="Overridden">●</span>' : ''}
            </label>
            <div class="te-override-input-group">
              <input type="number" class="te-input te-inst-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="sets" value="${inst.sets ?? ''}" placeholder="${canonicalEx.sets ?? 3}" min="1" max="10" />
              ${hasSetOverride ? `<button class="te-clear-override-btn" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="sets" title="Clear override">✕</button>` : ''}
            </div>
          </div>
          <div class="te-field">
            <label class="te-field-label">
              Reps
              ${hasRepOverride ? '<span class="te-override-dot" title="Overridden">●</span>' : ''}
            </label>
            <div class="te-field-row">
              <div class="te-field-sm">
                <label class="te-field-label">Min</label>
                <input type="number" class="te-input te-inst-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="reps.min" value="${inst.reps?.min ?? ''}" placeholder="${canonicalEx.reps?.min ?? 8}" />
              </div>
              <div class="te-field-sm">
                <label class="te-field-label">Max</label>
                <input type="number" class="te-input te-inst-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="reps.max" value="${inst.reps?.max ?? ''}" placeholder="${canonicalEx.reps?.max ?? 12}" />
              </div>
            </div>
            ${hasRepOverride ? `<button class="te-clear-override-btn" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="reps" title="Clear override">✕ Clear reps override</button>` : ''}
          </div>
          <div class="te-field te-field-wide">
            <label class="te-field-label">
              Load
              ${hasLoadOverride ? '<span class="te-override-dot" title="Overridden">●</span>' : ''}
            </label>
            <div class="te-field-row">
              ${renderInstanceLoadFields(inst, blockIdx, exIdx, canonicalEx)}
            </div>
            ${hasLoadOverride ? `<button class="te-clear-override-btn" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="load" title="Clear override">✕ Clear load override</button>` : ''}
          </div>
        </div>

        <div class="te-field">
          <label class="te-field-label">Letter Tag</label>
          <input type="text" class="te-input te-inst-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="letter" value="${inst.letter || ''}" maxlength="2" style="width:60px;" />
        </div>
      </div>
    `;
  }

  return `
    <div class="te-inst-card ${isExpanded ? 'expanded' : ''}" data-instance-id="${instanceId}">
      <div class="te-inst-header" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}">
        <div class="te-inst-header-left">
          <span class="te-inst-toggle">${isExpanded ? '▾' : '▸'}</span>
          <span class="te-inst-letter">${inst.letter || '?'}</span>
          <span class="te-inst-name">${canonicalEx.name || inst.exerciseRef || 'Unknown'}</span>
          <span class="te-inst-meta">${resolvedSets}×${formatReps(resolvedReps)}</span>
          ${overrideBadges}
        </div>
        <div class="te-inst-header-actions">
          <button class="te-ex-action-btn te-move-ex-up" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" title="Move Up" ${exIdx === 0 ? 'disabled' : ''}>▲</button>
          <button class="te-ex-action-btn te-move-ex-down" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" title="Move Down" ${exIdx === block.exercises.length - 1 ? 'disabled' : ''}>▼</button>
          <button class="te-ex-action-btn te-delete-inst" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" title="Delete">${ICON.trash}</button>
        </div>
      </div>
      ${expandedHtml}
    </div>
  `;
}

function renderInstanceLoadFields(inst, blockIdx, exIdx, canonicalEx) {
  const canonicalLoad = canonicalEx.load;
  const instLoad = inst.load;

  if (!canonicalLoad && !instLoad) {
    return '<span class="te-field-hint">Library: Bodyweight (no load)</span>';
  }

  // Determine if canonical uses single value or range
  const isCanoRange = canonicalLoad && ('min' in canonicalLoad);

  if (isCanoRange) {
    return `
      <div class="te-field-sm">
        <label class="te-field-label">Min</label>
        <input type="number" step="any" class="te-input te-inst-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="load.min" value="${instLoad?.min ?? ''}" placeholder="${canonicalLoad?.min ?? ''}" />
      </div>
      <div class="te-field-sm">
        <label class="te-field-label">Max</label>
        <input type="number" step="any" class="te-input te-inst-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="load.max" value="${instLoad?.max ?? ''}" placeholder="${canonicalLoad?.max ?? ''}" />
      </div>
      <div class="te-field-sm">
        <label class="te-field-label">Unit</label>
        <input type="text" class="te-input te-inst-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="load.unit" value="${instLoad?.unit ?? ''}" placeholder="${canonicalLoad?.unit || 'lbs'}" />
      </div>
    `;
  }

  return `
    <div class="te-field-sm">
      <label class="te-field-label">Value</label>
      <input type="number" step="any" class="te-input te-inst-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="load.value" value="${instLoad?.value ?? ''}" placeholder="${canonicalLoad?.value ?? ''}" />
    </div>
    <div class="te-field-sm">
      <label class="te-field-label">Unit</label>
      <input type="text" class="te-input te-inst-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="load.unit" value="${instLoad?.unit ?? ''}" placeholder="${canonicalLoad?.unit || 'lbs'}" />
    </div>
  `;
}

// ══════════════════════════════════════════
// ─── RENDER: EXERCISE PICKER MODAL ───
// ══════════════════════════════════════════

function renderExercisePicker() {
  const refs = Object.keys(draftLibrary);
  const filtered = pickerSearchQuery
    ? refs.filter(ref => {
        const ex = draftLibrary[ref];
        const q = pickerSearchQuery.toLowerCase();
        return ref.toLowerCase().includes(q) || (ex.name || '').toLowerCase().includes(q);
      })
    : refs;

  const itemsHtml = filtered.map(ref => {
    const ex = draftLibrary[ref];
    return `
      <div class="te-picker-item" data-ref="${ref}">
        <div class="te-picker-item-name">${ex.name || ref}</div>
        <div class="te-picker-item-meta">
          <span class="te-ref-badge">${ref}</span>
          <span>${ex.sets || 3}×${formatReps(ex.reps)} · ${formatLoad(ex.load)} · ${ex.equipmentType || '?'}</span>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="te-picker-overlay" id="te-picker-overlay">
      <div class="te-picker-modal">
        <div class="te-picker-header">
          <span class="te-picker-title">Select Exercise</span>
          <button class="te-close-btn te-picker-close" id="te-picker-close">${ICON.close}</button>
        </div>
        <div class="te-search-wrap">
          ${ICON.search}
          <input type="text" class="te-search-input" id="te-picker-search" placeholder="Search library…" value="${pickerSearchQuery}" autofocus />
        </div>
        <div class="te-picker-list">
          ${itemsHtml || '<div class="te-empty-msg">No exercises match your search.</div>'}
        </div>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════
// ─── EVENT HANDLING ───
// ══════════════════════════════════════════

function setupEditorEvents() {
  if (!overlayEl) return;

  // ── Input events (live editing, no re-render) ──────────────────────────────

  overlayEl.addEventListener('input', e => {
    // Library search
    if (e.target.id === 'te-lib-search') {
      librarySearchQuery = e.target.value;
      renderBody();
      return;
    }

    // Picker search
    if (e.target.id === 'te-picker-search') {
      pickerSearchQuery = e.target.value;
      renderBody();
      return;
    }

    // Sessions per week
    if (e.target.id === 'te-sessions-per-week') {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 1) draftSessionsPerWeek = val;
      return;
    }

    // Session fields (dayLabel, sessionLabel)
    if (e.target.classList.contains('te-session-field')) {
      const currentSession = draftSessions.find(s => s.id === selectedSessionId);
      if (!currentSession) return;
      const field = e.target.dataset.field;
      currentSession[field] = e.target.value;
      // Update sidebar text without full re-render
      const tabEl = overlayEl.querySelector(`.te-sidebar-tab[data-session-id="${selectedSessionId}"]`);
      if (tabEl) {
        const daySpan = tabEl.querySelector('.te-sidebar-day');
        const labelSpan = tabEl.querySelector('.te-sidebar-label');
        if (field === 'dayLabel' && daySpan) daySpan.textContent = e.target.value || '???';
        if (field === 'sessionLabel' && labelSpan) labelSpan.textContent = e.target.value || '???';
      }
      return;
    }

    // Block label
    if (e.target.classList.contains('te-block-label-input')) {
      const currentSession = draftSessions.find(s => s.id === selectedSessionId);
      if (!currentSession) return;
      const blockIdx = parseInt(e.target.dataset.blockIdx, 10);
      if (currentSession.blocks?.[blockIdx]) {
        currentSession.blocks[blockIdx].label = e.target.value;
      }
      return;
    }

    // ── Library field editing ─────────────────────────────────────────────────

    if (e.target.classList.contains('te-lib-field')) {
      const ref = e.target.dataset.ref;
      const fieldPath = e.target.dataset.field;
      if (!ref || !draftLibrary[ref]) return;
      const ex = draftLibrary[ref];

      if (fieldPath === 'name') {
        const oldName = ex.name;
        ex.name = e.target.value;
        // Name-change invariant: reset notes
        if (ex.name !== oldName) {
          ex.notes = '';
          // Update the notes textarea if visible
          const notesEl = overlayEl.querySelector(`.te-lib-field[data-ref="${ref}"][data-field="notes"]`);
          if (notesEl) notesEl.value = '';
        }
        // Update card header name
        const cardHeader = overlayEl.querySelector(`.te-lib-card[data-ref="${ref}"] .te-lib-card-name`);
        if (cardHeader) cardHeader.textContent = ex.name || 'Unnamed';
      } else if (fieldPath === 'equipmentType') {
        ex.equipmentType = e.target.value;
      } else if (fieldPath === 'sets') {
        ex.sets = parseInt(e.target.value, 10) || 3;
      } else if (fieldPath === 'deltaW') {
        ex.deltaW = parseFloat(e.target.value) || 0;
      } else if (fieldPath === 'manualDeltaWOverride') {
        ex.manualDeltaWOverride = e.target.checked;
        // Update toggle label
        const toggleLabel = e.target.parentElement?.querySelector('.te-toggle-label');
        if (toggleLabel) toggleLabel.textContent = e.target.checked ? 'Manual' : 'Auto';
      } else if (fieldPath === 'restBetweenSets') {
        ex.restBetweenSets = parseInt(e.target.value, 10) || 90;
      } else if (fieldPath === 'restBetweenExercises') {
        ex.restBetweenExercises = parseInt(e.target.value, 10) || 60;
      } else if (fieldPath === 'notes') {
        ex.notes = e.target.value;
      } else if (fieldPath.startsWith('reps.')) {
        if (!ex.reps) ex.reps = {};
        const sub = fieldPath.split('.')[1];
        ex.reps[sub] = parseInt(e.target.value, 10) || 0;
      } else if (fieldPath.startsWith('load.')) {
        if (!ex.load) ex.load = {};
        const sub = fieldPath.split('.')[1];
        if (sub === 'unit') {
          ex.load.unit = e.target.value;
        } else {
          ex.load[sub] = parseFloat(e.target.value) || 0;
        }
      }
      return;
    }

    // ── Instance field editing ─────────────────────────────────────────────────

    if (e.target.classList.contains('te-inst-field')) {
      const currentSession = draftSessions.find(s => s.id === selectedSessionId);
      if (!currentSession) return;
      const blockIdx = parseInt(e.target.dataset.blockIdx, 10);
      const exIdx = parseInt(e.target.dataset.exIdx, 10);
      const fieldPath = e.target.dataset.field;
      const inst = currentSession.blocks?.[blockIdx]?.exercises?.[exIdx];
      if (!inst) return;

      const value = e.target.value;

      if (fieldPath === 'letter') {
        inst.letter = value.toUpperCase();
      } else if (fieldPath === 'sets') {
        if (value === '') {
          delete inst.sets;
        } else {
          inst.sets = parseInt(value, 10) || undefined;
          if (!inst.sets) delete inst.sets;
        }
      } else if (fieldPath.startsWith('reps.')) {
        const sub = fieldPath.split('.')[1];
        if (value === '' && inst.reps) {
          // If both min and max are empty, clear the override
          delete inst.reps[sub];
          if (Object.keys(inst.reps).length === 0) delete inst.reps;
        } else if (value !== '') {
          if (!inst.reps) inst.reps = {};
          inst.reps[sub] = parseInt(value, 10) || 0;
        }
      } else if (fieldPath.startsWith('load.')) {
        const sub = fieldPath.split('.')[1];
        if (value === '' && inst.load) {
          delete inst.load[sub];
          // Keep unit if other fields exist
          const remaining = Object.keys(inst.load).filter(k => k !== 'unit');
          if (remaining.length === 0) delete inst.load;
        } else if (value !== '') {
          if (!inst.load) inst.load = {};
          if (sub === 'unit') {
            inst.load.unit = value;
          } else {
            inst.load[sub] = parseFloat(value) || 0;
          }
        }
      }
      return;
    }
  });

  // ── Change events (select dropdowns) ────────────────────────────────────────

  overlayEl.addEventListener('change', e => {
    // Library load mode change
    if (e.target.classList.contains('te-lib-load-mode')) {
      const ref = e.target.dataset.ref;
      if (!ref || !draftLibrary[ref]) return;
      const mode = e.target.value;
      const ex = draftLibrary[ref];
      if (mode === 'none') {
        delete ex.load;
      } else if (mode === 'single') {
        ex.load = { value: 0, unit: ex.load?.unit || 'lbs' };
      } else if (mode === 'range') {
        ex.load = { min: 0, max: 0, unit: ex.load?.unit || 'lbs' };
      }
      renderBody();
      return;
    }

    // Library equipmentType dropdown
    if (e.target.classList.contains('te-lib-field') && e.target.dataset.field === 'equipmentType') {
      const ref = e.target.dataset.ref;
      if (ref && draftLibrary[ref]) {
        draftLibrary[ref].equipmentType = e.target.value;
      }
      return;
    }

    // Library manualDeltaWOverride checkbox
    if (e.target.classList.contains('te-lib-field') && e.target.dataset.field === 'manualDeltaWOverride') {
      const ref = e.target.dataset.ref;
      if (ref && draftLibrary[ref]) {
        draftLibrary[ref].manualDeltaWOverride = e.target.checked;
        const toggleLabel = e.target.parentElement?.querySelector('.te-toggle-label');
        if (toggleLabel) toggleLabel.textContent = e.target.checked ? 'Manual' : 'Auto';
      }
      return;
    }
  });

  // ── Click events ────────────────────────────────────────────────────────────

  overlayEl.addEventListener('click', e => {
    const currentSession = draftSessions.find(s => s.id === selectedSessionId);

    // ── Tab switching ──────────────────────────────────────────────────────
    const tabBtn = e.target.closest('.te-tab');
    if (tabBtn && tabBtn.dataset.tab) {
      activeTab = tabBtn.dataset.tab;
      renderBody();
      return;
    }

    // ── Close / Cancel ─────────────────────────────────────────────────────
    if (e.target.closest('#te-close-btn') || e.target.closest('#te-cancel-btn')) {
      closeTemplateEditor();
      return;
    }

    // ── Save ────────────────────────────────────────────────────────────────
    if (e.target.id === 'te-save-btn') {
      if (validateDraft()) {
        dispatch('UPDATE_TEMPLATE', {
          sessions: draftSessions,
          sessionsPerWeek: draftSessionsPerWeek,
          exerciseLibrary: draftLibrary,
        });
        closeTemplateEditor();
      }
      return;
    }

    // ══════════════════════════════════════════
    // ─── LIBRARY PANEL ACTIONS ───
    // ══════════════════════════════════════════

    // Toggle library card expand/collapse
    const libHeader = e.target.closest('.te-lib-card-header');
    if (libHeader && !e.target.closest('button')) {
      const ref = libHeader.dataset.ref;
      if (expandedExerciseRefs.has(ref)) {
        expandedExerciseRefs.delete(ref);
      } else {
        expandedExerciseRefs.add(ref);
      }
      renderBody();
      return;
    }

    // Add new exercise to library
    if (e.target.id === 'te-add-exercise-lib') {
      const newRef = generateId('ex');
      draftLibrary[newRef] = {
        name: 'New Exercise',
        equipmentType: 'machine',
        sets: 3,
        reps: { min: 8, max: 12 },
        load: { value: 0, unit: 'lbs' },
        deltaW: 5,
        manualDeltaWOverride: false,
        restBetweenSets: 90,
        restBetweenExercises: 60,
        notes: '',
      };
      expandedExerciseRefs.add(newRef);
      renderBody();
      // Scroll to new exercise
      setTimeout(() => {
        const newCard = overlayEl?.querySelector(`.te-lib-card[data-ref="${newRef}"]`);
        newCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
      return;
    }

    // Delete exercise from library
    const deleteLibBtn = e.target.closest('.te-delete-lib-exercise');
    if (deleteLibBtn) {
      const ref = deleteLibBtn.dataset.ref;
      // Check if any sessions reference this exercise
      let usageCount = 0;
      draftSessions.forEach(s =>
        (s.blocks || []).forEach(b =>
          (b.exercises || []).forEach(inst => {
            if (inst.exerciseRef === ref) usageCount++;
          })
        )
      );
      const msg = usageCount > 0
        ? `This exercise is used in ${usageCount} session placement(s). Deleting it will remove those references too. Continue?`
        : 'Delete this exercise from the library?';
      if (confirm(msg)) {
        delete draftLibrary[ref];
        expandedExerciseRefs.delete(ref);
        // Remove from sessions
        draftSessions.forEach(s =>
          (s.blocks || []).forEach(b => {
            b.exercises = (b.exercises || []).filter(inst => inst.exerciseRef !== ref);
          })
        );
        renderBody();
      }
      return;
    }

    // ══════════════════════════════════════════
    // ─── SESSION PANEL ACTIONS ───
    // ══════════════════════════════════════════

    // Sidebar tab selection
    const tab = e.target.closest('.te-sidebar-tab');
    if (tab && !e.target.closest('.te-tab-action-btn')) {
      selectedSessionId = tab.dataset.sessionId;
      overlayEl.querySelector('.te-modal')?.classList.add('session-selected-view');
      renderBody();
      return;
    }

    // Mobile back
    if (e.target.id === 'te-mobile-back-btn') {
      selectedSessionId = null;
      overlayEl.querySelector('.te-modal')?.classList.remove('session-selected-view');
      renderBody();
      return;
    }

    // Add session
    if (e.target.id === 'te-add-session-btn') {
      const newId = generateId('session');
      draftSessions.push({
        id: newId,
        dayLabel: 'NEW',
        sessionLabel: `Session ${draftSessions.length + 1}`,
        blocks: [],
      });
      selectedSessionId = newId;
      overlayEl.querySelector('.te-modal')?.classList.add('session-selected-view');
      renderBody();
      return;
    }

    // Move session up
    const moveSessionUp = e.target.closest('.te-move-session-up');
    if (moveSessionUp) {
      const idx = parseInt(moveSessionUp.dataset.idx, 10);
      if (idx > 0) {
        [draftSessions[idx], draftSessions[idx - 1]] = [draftSessions[idx - 1], draftSessions[idx]];
        renderBody();
      }
      return;
    }

    // Move session down
    const moveSessionDown = e.target.closest('.te-move-session-down');
    if (moveSessionDown) {
      const idx = parseInt(moveSessionDown.dataset.idx, 10);
      if (idx < draftSessions.length - 1) {
        [draftSessions[idx], draftSessions[idx + 1]] = [draftSessions[idx + 1], draftSessions[idx]];
        renderBody();
      }
      return;
    }

    // Delete session
    const deleteSessionBtn = e.target.closest('.te-delete-session');
    if (deleteSessionBtn) {
      const idx = parseInt(deleteSessionBtn.dataset.idx, 10);
      if (confirm('Delete this workout session?')) {
        const deletedId = draftSessions[idx].id;
        draftSessions.splice(idx, 1);
        if (selectedSessionId === deletedId) {
          selectedSessionId = draftSessions[0]?.id || null;
        }
        renderBody();
      }
      return;
    }

    // Add block
    const addBlockBtn = e.target.closest('.te-add-block-btn');
    if (addBlockBtn && currentSession) {
      if (!currentSession.blocks) currentSession.blocks = [];
      currentSession.blocks.push({
        label: `Superset ${currentSession.blocks.length + 1}`,
        exercises: [],
      });
      renderBody();
      return;
    }

    // Move block up
    const moveBlockUp = e.target.closest('.te-move-block-up');
    if (moveBlockUp && currentSession) {
      const idx = parseInt(moveBlockUp.dataset.blockIdx, 10);
      if (idx > 0) {
        [currentSession.blocks[idx], currentSession.blocks[idx - 1]] = [currentSession.blocks[idx - 1], currentSession.blocks[idx]];
        renderBody();
      }
      return;
    }

    // Move block down
    const moveBlockDown = e.target.closest('.te-move-block-down');
    if (moveBlockDown && currentSession) {
      const idx = parseInt(moveBlockDown.dataset.blockIdx, 10);
      if (idx < currentSession.blocks.length - 1) {
        [currentSession.blocks[idx], currentSession.blocks[idx + 1]] = [currentSession.blocks[idx + 1], currentSession.blocks[idx]];
        renderBody();
      }
      return;
    }

    // Delete block
    const deleteBlockBtn = e.target.closest('.te-delete-block');
    if (deleteBlockBtn && currentSession) {
      const idx = parseInt(deleteBlockBtn.dataset.blockIdx, 10);
      if (confirm('Delete this block and all its exercises?')) {
        currentSession.blocks.splice(idx, 1);
        renderBody();
      }
      return;
    }

    // Add exercise (open picker)
    const addExBtn = e.target.closest('.te-add-exercise-btn');
    if (addExBtn && currentSession) {
      const blockIdx = parseInt(addExBtn.dataset.blockIdx, 10);
      exercisePickerState = { blockIdx };
      pickerSearchQuery = '';
      renderBody();
      // Focus search after render
      setTimeout(() => {
        overlayEl?.querySelector('#te-picker-search')?.focus();
      }, 50);
      return;
    }

    // Picker: select exercise
    const pickerItem = e.target.closest('.te-picker-item');
    if (pickerItem && exercisePickerState) {
      const ref = pickerItem.dataset.ref;
      const blockIdx = exercisePickerState.blockIdx;
      const block = currentSession?.blocks?.[blockIdx];
      if (block && ref) {
        const nextLetter = String.fromCharCode(65 + (block.exercises?.length || 0));
        const instanceId = generateId(`${currentSession.id}_${ref}`);
        if (!block.exercises) block.exercises = [];
        block.exercises.push({
          instanceId,
          exerciseRef: ref,
          letter: nextLetter,
        });
        expandedInstanceIds.add(instanceId);
      }
      exercisePickerState = null;
      pickerSearchQuery = '';
      renderBody();
      return;
    }

    // Picker: close
    if (e.target.closest('#te-picker-close') || e.target.id === 'te-picker-overlay') {
      exercisePickerState = null;
      pickerSearchQuery = '';
      renderBody();
      return;
    }

    // Toggle instance card expand/collapse
    const instHeader = e.target.closest('.te-inst-header');
    if (instHeader && !e.target.closest('.te-ex-action-btn')) {
      const blockIdx = parseInt(instHeader.dataset.blockIdx, 10);
      const exIdx = parseInt(instHeader.dataset.exIdx, 10);
      const inst = currentSession?.blocks?.[blockIdx]?.exercises?.[exIdx];
      if (inst) {
        if (expandedInstanceIds.has(inst.instanceId)) {
          expandedInstanceIds.delete(inst.instanceId);
        } else {
          expandedInstanceIds.add(inst.instanceId);
        }
        renderBody();
      }
      return;
    }

    // Move exercise up
    const moveExUp = e.target.closest('.te-move-ex-up');
    if (moveExUp && currentSession) {
      const blockIdx = parseInt(moveExUp.dataset.blockIdx, 10);
      const exIdx = parseInt(moveExUp.dataset.exIdx, 10);
      const block = currentSession.blocks[blockIdx];
      if (block && exIdx > 0) {
        [block.exercises[exIdx], block.exercises[exIdx - 1]] = [block.exercises[exIdx - 1], block.exercises[exIdx]];
        block.exercises[exIdx].letter = String.fromCharCode(65 + exIdx);
        block.exercises[exIdx - 1].letter = String.fromCharCode(65 + exIdx - 1);
        renderBody();
      }
      return;
    }

    // Move exercise down
    const moveExDown = e.target.closest('.te-move-ex-down');
    if (moveExDown && currentSession) {
      const blockIdx = parseInt(moveExDown.dataset.blockIdx, 10);
      const exIdx = parseInt(moveExDown.dataset.exIdx, 10);
      const block = currentSession.blocks[blockIdx];
      if (block && exIdx < block.exercises.length - 1) {
        [block.exercises[exIdx], block.exercises[exIdx + 1]] = [block.exercises[exIdx + 1], block.exercises[exIdx]];
        block.exercises[exIdx].letter = String.fromCharCode(65 + exIdx);
        block.exercises[exIdx + 1].letter = String.fromCharCode(65 + exIdx + 1);
        renderBody();
      }
      return;
    }

    // Delete exercise instance
    const deleteInstBtn = e.target.closest('.te-delete-inst');
    if (deleteInstBtn && currentSession) {
      const blockIdx = parseInt(deleteInstBtn.dataset.blockIdx, 10);
      const exIdx = parseInt(deleteInstBtn.dataset.exIdx, 10);
      const block = currentSession.blocks[blockIdx];
      if (block && confirm('Remove this exercise from the session?')) {
        const instId = block.exercises[exIdx]?.instanceId;
        block.exercises.splice(exIdx, 1);
        expandedInstanceIds.delete(instId);
        // Re-letter
        block.exercises.forEach((ex, i) => {
          ex.letter = String.fromCharCode(65 + i);
        });
        renderBody();
      }
      return;
    }

    // Clear instance override
    const clearOverrideBtn = e.target.closest('.te-clear-override-btn');
    if (clearOverrideBtn && currentSession) {
      const blockIdx = parseInt(clearOverrideBtn.dataset.blockIdx, 10);
      const exIdx = parseInt(clearOverrideBtn.dataset.exIdx, 10);
      const field = clearOverrideBtn.dataset.field;
      const inst = currentSession.blocks?.[blockIdx]?.exercises?.[exIdx];
      if (inst) {
        delete inst[field];
        renderBody();
      }
      return;
    }
  });
}

// ══════════════════════════════════════════
// ─── VALIDATION ───
// ══════════════════════════════════════════

function validateDraft() {
  if (draftSessionsPerWeek < 1 || draftSessionsPerWeek > 7) {
    alert('Sessions per week must be between 1 and 7.');
    return false;
  }

  // Validate library
  for (const [ref, ex] of Object.entries(draftLibrary)) {
    if (!ex.name?.trim()) {
      alert(`Exercise "${ref}" has an empty name.`);
      activeTab = 'library';
      expandedExerciseRefs.add(ref);
      renderBody();
      return false;
    }
  }

  // Validate sessions
  for (let sIdx = 0; sIdx < draftSessions.length; sIdx++) {
    const session = draftSessions[sIdx];
    if (!session.dayLabel?.trim()) {
      alert(`Session ${sIdx + 1} has an empty Day Code.`);
      activeTab = 'sessions';
      selectedSessionId = session.id;
      renderBody();
      return false;
    }
    if (!session.sessionLabel?.trim()) {
      alert(`Session ${sIdx + 1} has an empty Session Name.`);
      activeTab = 'sessions';
      selectedSessionId = session.id;
      renderBody();
      return false;
    }

    for (const block of (session.blocks || [])) {
      if (!block.label?.trim()) {
        alert(`Session "${session.dayLabel}" has a block with an empty label.`);
        activeTab = 'sessions';
        selectedSessionId = session.id;
        renderBody();
        return false;
      }

      for (const inst of (block.exercises || [])) {
        if (!inst.exerciseRef || !draftLibrary[inst.exerciseRef]) {
          alert(`Session "${session.dayLabel}", block "${block.label}" has an exercise with invalid reference "${inst.exerciseRef}".`);
          activeTab = 'sessions';
          selectedSessionId = session.id;
          renderBody();
          return false;
        }
      }
    }
  }

  return true;
}
