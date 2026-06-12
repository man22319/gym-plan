import { state } from '../core/workouts.js';
import { dispatch } from '../core/reducer.js';

let draftSessions = [];
let draftSessionsPerWeek = 3;
let selectedSessionId = null;
let expandedExerciseIds = new Set();
let overlayEl = null;

function generateId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`;
}

// Deep clone templates and randomize IDs for duplicate copies
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function cloneExerciseForDuplication(ex) {
  const newEx = deepClone(ex);
  newEx.id = generateId('ex');
  newEx.name = `${newEx.name} (Copy)`;
  return newEx;
}

export function openTemplateEditor() {
  if (overlayEl) return;

  // Load from current application state
  draftSessions = state.sessions ? deepClone(state.sessions) : [];
  draftSessionsPerWeek = state.sessionsPerWeek ?? 3;
  selectedSessionId = draftSessions[0]?.id || null;
  expandedExerciseIds.clear();

  overlayEl = document.createElement('div');
  overlayEl.className = 'template-editor-overlay';
  overlayEl.innerHTML = `
    <div class="template-editor-modal" role="dialog" aria-modal="true" aria-label="Template Editor">
      <div class="te-header">
        <div class="te-header-title">Template Editor</div>
        <button class="te-close-btn" id="te-close-btn" aria-label="Close">✕</button>
      </div>
      <div class="te-body">
        <div class="te-sidebar" id="te-sidebar"></div>
        <div class="te-main" id="te-main"></div>
      </div>
      <div class="te-footer">
        <button class="te-btn te-btn-cancel" id="te-cancel-btn">Cancel</button>
        <button class="te-btn te-btn-save" id="te-save-btn">Save Template</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlayEl);
  setupEditorEvents();
  renderContents();
}

function closeTemplateEditor() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

function renderContents() {
  if (!overlayEl) return;
  renderSidebar();
  renderMain();
}

function renderSidebar() {
  const sidebar = overlayEl.querySelector('#te-sidebar');
  if (!sidebar) return;

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
          <button class="te-tab-action-btn te-delete-session" data-idx="${idx}" title="Delete">🗑</button>
        </div>
      </div>
    `;
  }).join('');

  sidebar.innerHTML = `
    <div class="te-sidebar-section">
      <label class="te-label" for="te-sessions-per-week">Sessions Per Week</label>
      <input type="number" id="te-sessions-per-week" class="te-input" min="1" max="7" value="${draftSessionsPerWeek}" />
    </div>
    <div class="te-sidebar-section-header">
      <span>WORKOUT SESSIONS</span>
      <button class="te-add-btn" id="te-add-session-btn">+ Add</button>
    </div>
    <div class="te-sidebar-tabs">
      ${sessionTabsHtml || '<div class="te-sidebar-empty">No sessions created yet.</div>'}
    </div>
  `;
}

function renderMain() {
  const main = overlayEl.querySelector('#te-main');
  if (!main) return;

  const currentSession = draftSessions.find(s => s.id === selectedSessionId);
  if (!currentSession) {
    main.innerHTML = `
      <div class="te-main-empty">
        <div class="te-main-empty-icon">🏋️‍♂️</div>
        <div class="te-main-empty-text">Select a workout session from the sidebar or click "+ Add" to create a new one.</div>
      </div>
    `;
    return;
  }

  // Generate blocks HTML
  const blocksHtml = (currentSession.blocks || []).map((block, blockIdx) => {
    const exercisesHtml = (block.exercises || []).map((ex, exIdx) => {
      const isExpanded = expandedExerciseIds.has(ex.id);
      const expandIcon = isExpanded ? '▼' : '▶';
      const bodyClass = isExpanded ? 'visible' : 'hidden';

      // Reps configuration inputs
      let repsHtml = '';
      const minR = ex.reps?.min ?? 8;
      const maxR = ex.reps?.max ?? 12;
      repsHtml = `
        <div class="te-subfield">
          <label class="te-field-label">Min Reps</label>
          <input type="number" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="reps.min" value="${minR}" />
        </div>
        <div class="te-subfield">
          <label class="te-field-label">Max Reps</label>
          <input type="number" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="reps.max" value="${maxR}" />
        </div>
      `;

      // Weight configuration inputs
      let weightHtml = '';
      const isWeightNone = !ex.weight;
      const isWeightRange = !!ex.weight;

      if (isWeightNone) {
        weightHtml = `<span class="te-weight-notes-label">Bodyweight / No prescheduled weight</span>`;
      } else {
        const minW = ex.weight?.min ?? ex.weight?.value ?? 0;
        const maxW = ex.weight?.max ?? ex.weight?.value ?? 0;
        weightHtml = `
          <div class="te-subfield">
            <label class="te-field-label">Min Weight</label>
            <input type="number" step="any" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="weight.min" value="${minW}" />
          </div>
          <div class="te-subfield">
            <label class="te-field-label">Max Weight</label>
            <input type="number" step="any" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="weight.max" value="${maxW}" />
          </div>
        `;
      }

      return `
        <div class="te-exercise-card ${isExpanded ? 'expanded' : ''}" data-ex-id="${ex.id}">
          <div class="te-ex-header" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}">
            <div class="te-ex-header-title">
              <span class="te-ex-toggle-icon">${expandIcon}</span>
              <span class="te-ex-letter">${ex.letter || 'A'}</span>
              <span class="te-ex-name-label">${ex.name || 'Unnamed Exercise'}</span>
              <span class="te-ex-sets-label">(${ex.sets || 3} sets)</span>
            </div>
            <div class="te-ex-header-actions">
              <button class="te-ex-action-btn te-move-ex-up" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" title="Move Up" ${exIdx === 0 ? 'disabled' : ''}>▲</button>
              <button class="te-ex-action-btn te-move-ex-down" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" title="Move Down" ${exIdx === block.exercises.length - 1 ? 'disabled' : ''}>▼</button>
              <button class="te-ex-action-btn te-duplicate-ex" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" title="Duplicate">⧉</button>
              <button class="te-ex-action-btn te-delete-ex" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" title="Delete">🗑</button>
            </div>
          </div>
          <div class="te-ex-body ${bodyClass}">
            <div class="te-fields-grid">
              <div class="te-field">
                <label class="te-field-label">Exercise Name</label>
                <input type="text" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="name" value="${ex.name || ''}" />
              </div>
              <div class="te-field">
                <label class="te-field-label">Letter Tag (e.g. A, B)</label>
                <input type="text" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="letter" value="${ex.letter || ''}" />
              </div>
              <div class="te-field">
                <label class="te-field-label">Sets</label>
                <input type="number" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="sets" value="${ex.sets ?? 3}" min="1" max="10" />
              </div>
              
              <div class="te-field">
                <label class="te-field-label">Reps (Min / Max)</label>
                <div class="te-field-group">
                  ${repsHtml}
                </div>
              </div>

              <div class="te-field">
                <label class="te-field-label">Weight Mode</label>
                <select class="te-select te-weight-mode-select" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}">
                  <option value="none" ${isWeightNone ? 'selected' : ''}>None (Bodyweight / Custom)</option>
                  <option value="range" ${isWeightRange ? 'selected' : ''}>Weight Range</option>
                </select>
              </div>

              <div class="te-field-group">
                ${weightHtml}
                ${!isWeightNone ? `
                  <div class="te-subfield">
                    <label class="te-field-label">Unit</label>
                    <input type="text" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="weight.unit" value="${ex.weight?.unit || 'lbs'}" />
                  </div>
                ` : ''}
              </div>

              <div class="te-field">
                <label class="te-field-label">Rest Between Sets (sec)</label>
                <input type="number" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="rest_between_sets" value="${ex.rest_between_sets ?? 90}" />
              </div>
              <div class="te-field">
                <label class="te-field-label">Rest Between Exercises (sec)</label>
                <input type="number" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="rest_between_exercises" value="${ex.rest_between_exercises ?? 60}" />
              </div>

              <div class="te-field" style="grid-column: span 2;">
                <label class="te-field-label">Alternatives (comma-separated)</label>
                <input type="text" class="te-input te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="alternatives" value="${(ex.alternatives || []).join(', ')}" placeholder="e.g. Cable Curl, Rope Curl" />
              </div>

              <div class="te-field" style="grid-column: span 2;">
                <label class="te-field-label">Prescribed Notes / Instructions</label>
                <textarea class="te-textarea te-ex-field" data-block-idx="${blockIdx}" data-ex-idx="${exIdx}" data-field="notes" rows="2">${ex.notes || ''}</textarea>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="te-block-card">
        <div class="te-block-header">
          <input type="text" class="te-block-label-input" data-block-idx="${blockIdx}" value="${block.label || ''}" placeholder="e.g. Superset 1 — Pull / Push" />
          <div class="te-block-actions">
            <button class="te-block-action-btn te-move-block-up" data-block-idx="${blockIdx}" title="Move Up" ${blockIdx === 0 ? 'disabled' : ''}>▲</button>
            <button class="te-block-action-btn te-move-block-down" data-block-idx="${blockIdx}" title="Move Down" ${blockIdx === currentSession.blocks.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="te-block-action-btn te-delete-block" data-block-idx="${blockIdx}" title="Delete">🗑</button>
          </div>
        </div>
        <div class="te-block-exercises">
          ${exercisesHtml || '<div class="te-block-empty">No exercises in this block. Click "+ Add Exercise" below.</div>'}
        </div>
        <button class="te-add-exercise-btn" data-block-idx="${blockIdx}">+ Add Exercise</button>
      </div>
    `;
  }).join('');

  main.innerHTML = `
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
          <label class="te-field-label" for="te-session-label">Session Name (e.g. Session 1)</label>
          <input type="text" id="te-session-label" class="te-input te-session-field" data-field="sessionLabel" value="${currentSession.sessionLabel || ''}" />
        </div>
        <div class="te-field" style="grid-column: span 2;">
          <label class="te-field-label" for="te-session-warmup">Warm-up Plan</label>
          <input type="text" id="te-session-warmup" class="te-input te-session-field" data-field="warmup" value="${currentSession.warmup || ''}" placeholder="e.g. Treadmill · 8 min · 3.0 mph" />
        </div>
        <div class="te-field" style="grid-column: span 2;">
          <label class="te-field-label" for="te-session-finisher">Finisher Plan</label>
          <input type="text" id="te-session-finisher" class="te-input te-session-field" data-field="finisher" value="${currentSession.finisher || ''}" placeholder="e.g. Treadmill · 8 min" />
        </div>
      </div>
    </div>

    <div class="te-section-title-with-btn">
      <span>Exercise Blocks</span>
      <button class="te-add-btn te-add-block-btn">+ Add Block</button>
    </div>

    <div class="te-blocks-list">
      ${blocksHtml || '<div class="te-main-empty-text">No exercise blocks created. Click "+ Add Block" above to start.</div>'}
    </div>
  `;
}

function setupEditorEvents() {
  if (!overlayEl) return;

  // Real-time changes of inputs to avoid losing cursor focus (we don't trigger re-render on text input)
  overlayEl.addEventListener('input', e => {
    const currentSession = draftSessions.find(s => s.id === selectedSessionId);
    if (!currentSession) return;

    // Sessions per week change
    if (e.target.id === 'te-sessions-per-week') {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 1) {
        draftSessionsPerWeek = val;
      }
      return;
    }

    // Session settings changes
    if (e.target.classList.contains('te-session-field')) {
      const field = e.target.dataset.field;
      currentSession[field] = e.target.value;
      if (field === 'dayLabel' || field === 'sessionLabel') {
        // Debounce or render sidebar list quickly? Let's just update the specific text in the sidebar without re-render to avoid losing focus!
        const tabEl = overlayEl.querySelector(`.te-sidebar-tab[data-session-id="${selectedSessionId}"]`);
        if (tabEl) {
          const daySpan = tabEl.querySelector('.te-sidebar-day');
          const labelSpan = tabEl.querySelector('.te-sidebar-label');
          if (field === 'dayLabel' && daySpan) daySpan.textContent = e.target.value || '???';
          if (field === 'sessionLabel' && labelSpan) labelSpan.textContent = e.target.value || '???';
        }
      }
      return;
    }

    // Block label changes
    if (e.target.classList.contains('te-block-label-input')) {
      const blockIdx = parseInt(e.target.dataset.blockIdx, 10);
      if (currentSession.blocks && currentSession.blocks[blockIdx]) {
        currentSession.blocks[blockIdx].label = e.target.value;
      }
      return;
    }

    // Exercise details changes
    if (e.target.classList.contains('te-ex-field')) {
      const blockIdx = parseInt(e.target.dataset.blockIdx, 10);
      const exIdx = parseInt(e.target.dataset.exIdx, 10);
      const fieldPath = e.target.dataset.field;

      const block = currentSession.blocks?.[blockIdx];
      const ex = block?.exercises?.[exIdx];
      if (!ex) return;

      const value = e.target.value;

      if (fieldPath === 'name') {
        ex.name = value;
        // Update header label dynamically
        const cardEl = e.target.closest(`.te-exercise-card[data-ex-id="${ex.id}"]`);
        const nameLabel = cardEl?.querySelector('.te-ex-name-label');
        if (nameLabel) nameLabel.textContent = value || 'Unnamed Exercise';
      } else if (fieldPath === 'letter') {
        ex.letter = value;
        const cardEl = e.target.closest(`.te-exercise-card[data-ex-id="${ex.id}"]`);
        const letterLabel = cardEl?.querySelector('.te-ex-letter');
        if (letterLabel) letterLabel.textContent = value || 'A';
      } else if (fieldPath === 'sets') {
        const num = parseInt(value, 10) || 3;
        ex.sets = num;
        const cardEl = e.target.closest(`.te-exercise-card[data-ex-id="${ex.id}"]`);
        const setsLabel = cardEl?.querySelector('.te-ex-sets-label');
        if (setsLabel) setsLabel.textContent = `(${num} sets)`;
      } else if (fieldPath === 'notes') {
        ex.notes = value;
      } else if (fieldPath === 'alternatives') {
        ex.alternatives = value.split(',').map(s => s.trim()).filter(Boolean);
      } else if (fieldPath === 'rest_between_sets') {
        ex.rest_between_sets = parseInt(value, 10) || 90;
      } else if (fieldPath === 'rest_between_exercises') {
        ex.rest_between_exercises = parseInt(value, 10) || 60;
      } else if (fieldPath.startsWith('reps.')) {
        if (!ex.reps) ex.reps = {};
        const sub = fieldPath.split('.')[1];
        ex.reps[sub] = parseInt(value, 10) || 0;
      } else if (fieldPath.startsWith('weight.')) {
        if (!ex.weight) ex.weight = {};
        const sub = fieldPath.split('.')[1];
        if (sub === 'unit') {
          ex.weight.unit = value;
        } else {
          ex.weight[sub] = parseFloat(value) || 0;
        }
      }
    }
  });

  // Tap/click events
  overlayEl.addEventListener('click', e => {
    const currentSession = draftSessions.find(s => s.id === selectedSessionId);

    // Sidebar tab selection
    const tab = e.target.closest('.te-sidebar-tab');
    if (tab && !e.target.closest('.te-tab-action-btn')) {
      selectedSessionId = tab.dataset.sessionId;
      // Toggle class for mobile layout view
      overlayEl.querySelector('.template-editor-modal').classList.add('session-selected-view');
      renderContents();
      return;
    }

    // Mobile back button
    if (e.target.id === 'te-mobile-back-btn') {
      selectedSessionId = null;
      overlayEl.querySelector('.template-editor-modal').classList.remove('session-selected-view');
      renderContents();
      return;
    }

    // Add Session
    if (e.target.id === 'te-add-session-btn') {
      const newId = generateId('session');
      draftSessions.push({
        id: newId,
        dayLabel: 'NEW',
        sessionLabel: `Session ${draftSessions.length + 1}`,
        warmup: 'Treadmill · 8 min · 3.0 mph · 2%',
        finisher: 'Treadmill · 8 min · 3.3 mph · 2.5%',
        blocks: []
      });
      selectedSessionId = newId;
      overlayEl.querySelector('.template-editor-modal').classList.add('session-selected-view');
      renderContents();
      return;
    }

    // Move Session Up
    const moveSessionUp = e.target.closest('.te-move-session-up');
    if (moveSessionUp) {
      const idx = parseInt(moveSessionUp.dataset.idx, 10);
      if (idx > 0) {
        const temp = draftSessions[idx];
        draftSessions[idx] = draftSessions[idx - 1];
        draftSessions[idx - 1] = temp;
        renderContents();
      }
      return;
    }

    // Move Session Down
    const moveSessionDown = e.target.closest('.te-move-session-down');
    if (moveSessionDown) {
      const idx = parseInt(moveSessionDown.dataset.idx, 10);
      if (idx < draftSessions.length - 1) {
        const temp = draftSessions[idx];
        draftSessions[idx] = draftSessions[idx + 1];
        draftSessions[idx + 1] = temp;
        renderContents();
      }
      return;
    }

    // Delete Session
    const deleteSessionBtn = e.target.closest('.te-delete-session');
    if (deleteSessionBtn) {
      const idx = parseInt(deleteSessionBtn.dataset.idx, 10);
      if (confirm(`Are you sure you want to delete this workout session?`)) {
        const deletedId = draftSessions[idx].id;
        draftSessions.splice(idx, 1);
        if (selectedSessionId === deletedId) {
          selectedSessionId = draftSessions[0]?.id || null;
        }
        renderContents();
      }
      return;
    }

    // Add Block
    const addBlockBtn = e.target.closest('.te-add-block-btn');
    if (addBlockBtn && currentSession) {
      if (!currentSession.blocks) currentSession.blocks = [];
      currentSession.blocks.push({
        label: `Superset ${currentSession.blocks.length + 1}`,
        exercises: []
      });
      renderContents();
      return;
    }

    // Move Block Up
    const moveBlockUp = e.target.closest('.te-move-block-up');
    if (moveBlockUp && currentSession) {
      const idx = parseInt(moveBlockUp.dataset.blockIdx, 10);
      if (idx > 0) {
        const temp = currentSession.blocks[idx];
        currentSession.blocks[idx] = currentSession.blocks[idx - 1];
        currentSession.blocks[idx - 1] = temp;
        renderContents();
      }
      return;
    }

    // Move Block Down
    const moveBlockDown = e.target.closest('.te-move-block-down');
    if (moveBlockDown && currentSession) {
      const idx = parseInt(moveBlockDown.dataset.blockIdx, 10);
      if (idx < currentSession.blocks.length - 1) {
        const temp = currentSession.blocks[idx];
        currentSession.blocks[idx] = currentSession.blocks[idx + 1];
        currentSession.blocks[idx + 1] = temp;
        renderContents();
      }
      return;
    }

    // Delete Block
    const deleteBlockBtn = e.target.closest('.te-delete-block');
    if (deleteBlockBtn && currentSession) {
      const idx = parseInt(deleteBlockBtn.dataset.blockIdx, 10);
      if (confirm(`Delete this superset block and all its exercises?`)) {
        currentSession.blocks.splice(idx, 1);
        renderContents();
      }
      return;
    }

    // Add Exercise
    const addExerciseBtn = e.target.closest('.te-add-exercise-btn');
    if (addExerciseBtn && currentSession) {
      const blockIdx = parseInt(addExerciseBtn.dataset.blockIdx, 10);
      const block = currentSession.blocks[blockIdx];
      if (block) {
        if (!block.exercises) block.exercises = [];
        const nextLetter = String.fromCharCode(65 + block.exercises.length); // A, B, C, etc.
        const exId = generateId('ex');
        block.exercises.push({
          id: exId,
          letter: nextLetter,
          name: 'New Exercise',
          sets: 3,
          reps: { min: 8, max: 12 },
          weight: { min: 50, max: 70, unit: 'lbs' },
          rest_between_sets: 90,
          rest_between_exercises: 60,
          notes: '',
          alternatives: []
        });
        expandedExerciseIds.add(exId); // Auto-expand new exercise
        renderContents();
      }
      return;
    }

    // Collapsible exercise header tap (expand/collapse)
    const exHeader = e.target.closest('.te-ex-header');
    if (exHeader && !e.target.closest('.te-ex-action-btn')) {
      const blockIdx = parseInt(exHeader.dataset.blockIdx, 10);
      const exIdx = parseInt(exHeader.dataset.exIdx, 10);
      const ex = currentSession.blocks[blockIdx]?.exercises[exIdx];
      if (ex) {
        if (expandedExerciseIds.has(ex.id)) {
          expandedExerciseIds.delete(ex.id);
        } else {
          expandedExerciseIds.add(ex.id);
        }
        renderContents();
      }
      return;
    }

    // Move Exercise Up
    const moveExUp = e.target.closest('.te-move-ex-up');
    if (moveExUp && currentSession) {
      const blockIdx = parseInt(moveExUp.dataset.blockIdx, 10);
      const exIdx = parseInt(moveExUp.dataset.exIdx, 10);
      const block = currentSession.blocks[blockIdx];
      if (block && exIdx > 0) {
        const temp = block.exercises[exIdx];
        block.exercises[exIdx] = block.exercises[exIdx - 1];
        block.exercises[exIdx - 1] = temp;
        // Fix exercise letter tags automatically
        block.exercises[exIdx].letter = String.fromCharCode(65 + exIdx);
        block.exercises[exIdx - 1].letter = String.fromCharCode(65 + exIdx - 1);
        renderContents();
      }
      return;
    }

    // Move Exercise Down
    const moveExDown = e.target.closest('.te-move-ex-down');
    if (moveExDown && currentSession) {
      const blockIdx = parseInt(moveExDown.dataset.blockIdx, 10);
      const exIdx = parseInt(moveExDown.dataset.exIdx, 10);
      const block = currentSession.blocks[blockIdx];
      if (block && exIdx < block.exercises.length - 1) {
        const temp = block.exercises[exIdx];
        block.exercises[exIdx] = block.exercises[exIdx + 1];
        block.exercises[exIdx + 1] = temp;
        // Fix exercise letter tags automatically
        block.exercises[exIdx].letter = String.fromCharCode(65 + exIdx);
        block.exercises[exIdx + 1].letter = String.fromCharCode(65 + exIdx + 1);
        renderContents();
      }
      return;
    }

    // Duplicate Exercise
    const duplicateExBtn = e.target.closest('.te-duplicate-ex');
    if (duplicateExBtn && currentSession) {
      const blockIdx = parseInt(duplicateExBtn.dataset.blockIdx, 10);
      const exIdx = parseInt(duplicateExBtn.dataset.exIdx, 10);
      const block = currentSession.blocks[blockIdx];
      if (block && block.exercises[exIdx]) {
        const cloned = cloneExerciseForDuplication(block.exercises[exIdx]);
        block.exercises.splice(exIdx + 1, 0, cloned);
        // Recalculate letters
        block.exercises.forEach((ex, i) => {
          ex.letter = String.fromCharCode(65 + i);
        });
        expandedExerciseIds.add(cloned.id);
        renderContents();
      }
      return;
    }

    // Delete Exercise
    const deleteExBtn = e.target.closest('.te-delete-ex');
    if (deleteExBtn && currentSession) {
      const blockIdx = parseInt(deleteExBtn.dataset.blockIdx, 10);
      const exIdx = parseInt(deleteExBtn.dataset.exIdx, 10);
      const block = currentSession.blocks[blockIdx];
      if (block && confirm(`Delete this exercise?`)) {
        const exId = block.exercises[exIdx].id;
        block.exercises.splice(exIdx, 1);
        expandedExerciseIds.delete(exId);
        // Recalculate letters
        block.exercises.forEach((ex, i) => {
          ex.letter = String.fromCharCode(65 + i);
        });
        renderContents();
      }
      return;
    }

    // Close button
    if (e.target.id === 'te-close-btn' || e.target.id === 'te-cancel-btn') {
      if (confirm('Discard any changes made to the workout template?')) {
        closeTemplateEditor();
      }
      return;
    }

    // Save Template
    if (e.target.id === 'te-save-btn') {
      if (validateDraftTemplate()) {
        dispatch('UPDATE_TEMPLATE', {
          sessions: draftSessions,
          sessionsPerWeek: draftSessionsPerWeek
        });
        closeTemplateEditor();
      }
      return;
    }
  });

  // Handle select dropdowns change events (reps/weight modes)
  overlayEl.addEventListener('change', e => {
    const currentSession = draftSessions.find(s => s.id === selectedSessionId);
    if (!currentSession) return;

    if (e.target.classList.contains('te-reps-mode-select')) {
      const blockIdx = parseInt(e.target.dataset.blockIdx, 10);
      const exIdx = parseInt(e.target.dataset.exIdx, 10);
      const ex = currentSession.blocks[blockIdx]?.exercises[exIdx];
      if (!ex) return;
      ex.reps = { min: 8, max: 12 };
      renderContents();
      return;
    }

    if (e.target.classList.contains('te-weight-mode-select')) {
      const blockIdx = parseInt(e.target.dataset.blockIdx, 10);
      const exIdx = parseInt(e.target.dataset.exIdx, 10);
      const ex = currentSession.blocks[blockIdx]?.exercises[exIdx];
      if (!ex) return;

      const mode = e.target.value;
      if (mode === 'none') {
        ex.weight = null;
      } else {
        ex.weight = { min: 50, max: 70, unit: 'lbs' };
      }
      renderContents();
      return;
    }
  });
}

function validateDraftTemplate() {
  if (draftSessionsPerWeek < 1 || draftSessionsPerWeek > 7) {
    alert('Sessions per week must be between 1 and 7.');
    return false;
  }

  for (let sIdx = 0; sIdx < draftSessions.length; sIdx++) {
    const session = draftSessions[sIdx];
    if (!session.dayLabel?.trim()) {
      alert(`Session ${sIdx + 1} has an empty Day Code.`);
      selectedSessionId = session.id;
      renderContents();
      return false;
    }
    if (!session.sessionLabel?.trim()) {
      alert(`Session ${sIdx + 1} has an empty Session Name.`);
      selectedSessionId = session.id;
      renderContents();
      return false;
    }

    for (let bIdx = 0; bIdx < (session.blocks || []).length; bIdx++) {
      const block = session.blocks[bIdx];
      if (!block.label?.trim()) {
        alert(`Session "${session.dayLabel}" has a block with an empty label.`);
        selectedSessionId = session.id;
        renderContents();
        return false;
      }

      for (let eIdx = 0; eIdx < (block.exercises || []).length; eIdx++) {
        const ex = block.exercises[eIdx];
        if (!ex.name?.trim()) {
          alert(`Session "${session.dayLabel}", block "${block.label}" has an exercise with an empty name.`);
          selectedSessionId = session.id;
          expandedExerciseIds.add(ex.id);
          renderContents();
          return false;
        }
        if (isNaN(ex.sets) || ex.sets < 1) {
          alert(`Exercise "${ex.name}" must have at least 1 set.`);
          selectedSessionId = session.id;
          expandedExerciseIds.add(ex.id);
          renderContents();
          return false;
        }
      }
    }
  }

  return true;
}
