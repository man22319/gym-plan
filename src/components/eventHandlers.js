import { state, EXERCISE_INDEX } from '../core/workouts.js';
import { dispatch } from '../core/reducer.js';
import { getDisplayName } from '../core/helpers.js';
import { skipRestTimer, extendRestTimer } from '../core/restTimer.js';
import { editingExId, setEditingExId, render } from './rendering.js';
import { openTemplateEditor } from './templateEditor.js';
import {
  openHistoryModal,
  openRecoveryDashboard,
  openLogModal,
  openSessionAnalytics,
  openCardioNoteModal
} from './modals.js';
import {
  importTemplate,
  importHistory,
  importBackup,
  exportTemplate,
  exportHistory,
  exportBackup,
  copyWorkout
} from './fileActions.js';

const pressTimers = new Map();
const tabPressTimers = new Map();
const infoPressTimers = new Map();

let lastPressWasLong = false;

const LONG_PRESS_MS = 480;

export function setupEvents() {
  document.addEventListener('pointerdown', e => {
    const dot = e.target.closest('.set-dot');
    const tab = e.target.closest('.tab');
    const info = e.target.closest('.ex-info-group');
    if (dot) {
      const exId = dot.dataset.exId;
      const idx  = parseInt(dot.dataset.setIdx, 10);
      startPress(exId, idx);
    } else if (tab) {
      const sessionId = tab.dataset.sessionId;
      startTabPress(sessionId);
    } else if (info) {
      const exId = info.closest('.exercise-card').dataset.exId;
      startInfoPress(exId);
    }
  });

  document.addEventListener('pointerup', e => {
    const dot = e.target.closest('.set-dot');
    const tab = e.target.closest('.tab');
    const info = e.target.closest('.ex-info-group');
    if (dot) {
      const exId = dot.dataset.exId;
      const idx  = parseInt(dot.dataset.setIdx, 10);
      commitPress(exId, idx);
    } else if (tab) {
      const sessionId = tab.dataset.sessionId;
      commitTabPress(sessionId);
    } else if (info) {
      const exId = info.closest('.exercise-card').dataset.exId;
      commitInfoPress(exId);
    } else {
      for (const [key] of pressTimers) cancelPress(key);
      for (const [key] of tabPressTimers) cancelTabPress(key);
      for (const [key] of infoPressTimers) cancelInfoPress(key);
    }
  });

  document.addEventListener('pointercancel', () => {
    for (const [key] of pressTimers) cancelPress(key);
    for (const [key] of tabPressTimers) cancelTabPress(key);
    for (const [key] of infoPressTimers) cancelInfoPress(key);
  });

  document.addEventListener('pointermove', e => {
    if (e.movementX ** 2 + e.movementY ** 2 > 16) {
      for (const [key] of pressTimers) cancelPress(key);
      for (const [key] of tabPressTimers) cancelTabPress(key);
      for (const [key] of infoPressTimers) cancelInfoPress(key);
    }
  });

  document.addEventListener('click', e => {
    if (lastPressWasLong) {
      lastPressWasLong = false;
      return;
    }

    const finishBtn = e.target.closest('.finish-workout-btn');
    if (finishBtn) {
      const sessionId = finishBtn.dataset.sessionId;
      dispatch('FINISH_WORKOUT', { sessionId });
      return;
    }

    if (e.target.closest('#rest-timer-skip')) {
      skipRestTimer();
      return;
    }
    if (e.target.closest('#rest-timer-extend')) {
      extendRestTimer(30);
      return;
    }

    const editBtn = e.target.closest('.ex-edit-btn');
    if (editBtn) {
      const exId = editBtn.dataset.exId;
      setEditingExId(editingExId === exId ? null : exId);
      render(state);
      return;
    }

    const cancelBtn = e.target.closest('.ex-edit-btn-cancel');
    if (cancelBtn) {
      setEditingExId(null);
      render(state);
      return;
    }

    const saveBtn = e.target.closest('.ex-edit-btn-save');
    if (saveBtn) {
      const exId = saveBtn.dataset.exId;
      const weightInput = document.getElementById(`edit-weight-${exId}`);
      const repminInput = document.getElementById(`edit-repmin-${exId}`);
      const repmaxInput = document.getElementById(`edit-repmax-${exId}`);
      const notesInput  = document.getElementById(`edit-notes-${exId}`);

      const wVal = weightInput?.value.trim() ?? '';
      const rMin = repminInput?.value.trim() ?? '';
      const rMax = repmaxInput?.value.trim() ?? '';
      const notes = notesInput?.value.trim() ?? '';

      const weight = wVal !== '' ? { value: parseFloat(wVal), unit: 'lbs' } : null;
      
      let reps = null;
      if (rMin !== '' || rMax !== '') {
        const min = rMin !== '' ? parseInt(rMin, 10) : 0;
        const max = rMax !== '' ? parseInt(rMax, 10) : min;
        if (min === max) {
          reps = { fixed: min };
        } else {
          reps = { min, max };
        }
      }

      dispatch('UPDATE_EXERCISE_OVERRIDE', {
        exId,
        fields: {
          weight,
          reps,
          notes: notes !== '' ? notes : null
        }
      });
      setEditingExId(null);
      return;
    }

    const altBtn = e.target.closest('.ex-alt');
    if (altBtn) {
      const exId = altBtn.dataset.exId;
      const altName = altBtn.dataset.altName;
      const displayName = getDisplayName(state, exId);
      if (confirm(`Replace "${displayName}" with "${altName}"?`)) {
        const subId = 'sub_' + altName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        dispatch('SUBSTITUTE_EXERCISE', {
          exId,
          substitution: { id: subId, name: altName }
        });
      }
      return;
    }

    const revertLink = e.target.closest('.ex-revert-link');
    if (revertLink) {
      const exId = revertLink.dataset.exId;
      if (confirm(`Revert back to the original exercise?`)) {
        dispatch('SUBSTITUTE_EXERCISE', {
          exId,
          substitution: null
        });
      }
      return;
    }

    const exHeader = e.target.closest('.exercise-header[data-ex-id]');
    if (exHeader && !e.target.closest('.set-dot') && !e.target.closest('.ex-edit-btn') && !e.target.closest('.ex-revert-link')) {
      openHistoryModal(exHeader.dataset.exId);
      return;
    }

    // ── Finisher / Warmup card body tap → open note modal ──────────────────
    const cardioCard = e.target.closest('[data-cardio-type]');
    if (cardioCard) {
      const type = cardioCard.dataset.cardioType;
      // If the click was directly on the checkbox, handle toggle only (let change event do it)
      const isCheckbox = e.target.closest('.finisher-checkbox, .warmup-checkbox');
      if (!isCheckbox) {
        // Tap on card body → open note/history modal
        openCardioNoteModal(type, state);
      }
      return;
    }

    if (e.target.closest('#recovery-btn')) { openRecoveryDashboard(); return; }
    if (e.target.closest('#template-editor-btn')) { openTemplateEditor(); return; }
    if (e.target.closest('#import-template-btn')) { importTemplate(); return; }
    if (e.target.closest('#import-history-btn')) { importHistory(); return; }
    if (e.target.closest('#import-backup-btn')) { importBackup(); return; }
    if (e.target.closest('#export-template-btn')) { exportTemplate(); return; }
    if (e.target.closest('#export-history-btn')) { exportHistory(); return; }
    if (e.target.closest('#export-backup-btn')) { exportBackup(); return; }
    if (e.target.closest('#copy-btn'))   { copyWorkout(e.target.closest('#copy-btn')); return; }

    if (e.target.closest('#deload-toggle-btn')) {
      dispatch('TOGGLE_DELOAD', {});
      return;
    }

    if (e.target.closest('#fatigue-dismiss')) {
      const banner = document.getElementById('fatigue-banner');
      if (banner) {
        banner.style.animation = 'fatigueDismiss 0.25s ease forwards';
        setTimeout(() => dispatch('DISMISS_FATIGUE_WARNING'), 260);
      }
      return;
    }

    if (e.target.closest('#reset-btn')) {
      if (confirm('Reset all tracker data? This will permanently clear all history, current session progress, and imported data.')) {
        skipRestTimer();
        dispatch('RESET_SESSION', {});
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const exHeader = e.target.closest('.exercise-header[data-ex-id]');
      if (exHeader && !e.target.closest('.ex-edit-btn') && !e.target.closest('.ex-revert-link')) {
        e.preventDefault();
        openHistoryModal(exHeader.dataset.exId);
      }
    }
  });

  // ── Cardio inputs ──────────────────────────────────────────────────────────
  // Listens on both the old standalone checkboxes (legacy) and new embedded
  // warmup-checkbox / finisher-checkbox elements inside the session cards.
  // Always reads the currently checked state of all cardio fields.
  document.addEventListener('change', e => {
    // Check if this is a cardio-related checkbox or input
    const isCardioField = e.target.closest('[data-cardio-field]');
    if (!isCardioField) return;

    // Collect current state of all cardio checkboxes on the page
    const warmupEl   = document.querySelector('[data-cardio-field="warmupDone"]');
    const finisherEl = document.querySelector('[data-cardio-field="finisherDone"]');
    const notesEl    = document.getElementById('cardio-notes');

    const cardio = {
      warmupDone:   warmupEl?.checked   ?? false,
      finisherDone: finisherEl?.checked ?? false,
      notes:        notesEl?.value.trim() ?? ''
    };

    dispatch('UPDATE_CARDIO', { cardio });
  });
  // ────────────────────────────────────────────────────────────────────────────
}

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

function startTabPress(sessionId) {
  const key = `tab:${sessionId}`;
  if (tabPressTimers.has(key)) clearTimeout(tabPressTimers.get(key));
  tabPressTimers.set(key, setTimeout(() => {
    tabPressTimers.delete(key);
    openSessionAnalytics(sessionId);
  }, LONG_PRESS_MS));
}

function cancelTabPress(key) {
  if (tabPressTimers.has(key)) {
    clearTimeout(tabPressTimers.get(key));
    tabPressTimers.delete(key);
    return true;
  }
  return false;
}

function commitTabPress(sessionId) {
  const key = `tab:${sessionId}`;
  const wasPending = cancelTabPress(key);
  if (wasPending) {
    dispatch('SET_ACTIVE_SESSION', { sessionId });
  }
}

function startInfoPress(exId) {
  const key = exId;
  cancelInfoPress(key);
  infoPressTimers.set(key, setTimeout(() => {
    infoPressTimers.delete(key);
    lastPressWasLong = true;
    alternateExercise(exId);
  }, LONG_PRESS_MS));
}

function cancelInfoPress(key) {
  if (infoPressTimers.has(key)) {
    clearTimeout(infoPressTimers.get(key));
    infoPressTimers.delete(key);
    return true;
  }
  return false;
}

function commitInfoPress(exId) {
  cancelInfoPress(exId);
}

function alternateExercise(exId) {
  const ex = EXERCISE_INDEX[exId];
  if (!ex) return;

  const rawAlts = ex.alternatives;
  let flatAlts = [];
  if (rawAlts && typeof rawAlts === 'object' && !Array.isArray(rawAlts)) {
    flatAlts = [
      ...(rawAlts.same_pattern || []),
      ...(rawAlts.regression   || []),
      ...(rawAlts.variation    || [])
    ];
  } else if (Array.isArray(rawAlts)) {
    flatAlts = rawAlts;
  }

  if (flatAlts.length === 0) {
    alert(`No alternatives configured for "${ex.name}".`);
    return;
  }

  const currentDisplayName = getDisplayName(state, exId);
  const options = [ex.name, ...flatAlts];
  
  const curIdx = options.indexOf(currentDisplayName);
  const nextIdx = (curIdx + 1) % options.length;
  const nextName = options[nextIdx];

  if (nextName === ex.name) {
    if (confirm(`Revert "${currentDisplayName}" back to the original exercise "${ex.name}"?`)) {
      dispatch('SUBSTITUTE_EXERCISE', {
        exId,
        substitution: null
      });
    }
  } else {
    if (confirm(`Replace "${currentDisplayName}" with "${nextName}"?`)) {
      const subId = 'sub_' + nextName.toLowerCase().replace(/[^a-z0-9]/g, '_');
      dispatch('SUBSTITUTE_EXERCISE', {
        exId,
        substitution: { id: subId, name: nextName }
      });
    }
  }
}
