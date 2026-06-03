import { state } from '../core/workouts.js';
import { dispatch } from '../core/reducer.js';
import { getDisplayName } from '../core/helpers.js';
import { skipRestTimer, extendRestTimer } from '../core/restTimer.js';
import { editingExId, setEditingExId, render } from './rendering.js';
import {
  openHistoryModal,
  openRecoveryDashboard,
  openLogModal,
  openSessionAnalytics
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

const LONG_PRESS_MS = 480;

export function setupEvents() {
  document.addEventListener('pointerdown', e => {
    const dot = e.target.closest('.set-dot');
    const tab = e.target.closest('.tab');
    if (dot) {
      const exId = dot.dataset.exId;
      const idx  = parseInt(dot.dataset.setIdx, 10);
      startPress(exId, idx);
    } else if (tab) {
      const sessionId = tab.dataset.sessionId;
      startTabPress(sessionId);
    }
  });

  document.addEventListener('pointerup', e => {
    const dot = e.target.closest('.set-dot');
    const tab = e.target.closest('.tab');
    if (dot) {
      const exId = dot.dataset.exId;
      const idx  = parseInt(dot.dataset.setIdx, 10);
      commitPress(exId, idx);
    } else if (tab) {
      const sessionId = tab.dataset.sessionId;
      commitTabPress(sessionId);
    } else {
      for (const [key] of pressTimers) cancelPress(key);
      for (const [key] of tabPressTimers) cancelTabPress(key);
    }
  });

  document.addEventListener('pointercancel', () => {
    for (const [key] of pressTimers) cancelPress(key);
    for (const [key] of tabPressTimers) cancelTabPress(key);
  });

  document.addEventListener('pointermove', e => {
    if (e.movementX ** 2 + e.movementY ** 2 > 16) {
      for (const [key] of pressTimers) cancelPress(key);
      for (const [key] of tabPressTimers) cancelTabPress(key);
    }
  });

  document.addEventListener('click', e => {
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

    if (e.target.closest('#recovery-btn')) { openRecoveryDashboard(); return; }
    if (e.target.closest('#import-template-btn')) { importTemplate(); return; }
    if (e.target.closest('#import-history-btn')) { importHistory(); return; }
    if (e.target.closest('#import-backup-btn')) { importBackup(); return; }
    if (e.target.closest('#export-template-btn')) { exportTemplate(); return; }
    if (e.target.closest('#export-history-btn')) { exportHistory(); return; }
    if (e.target.closest('#export-backup-btn')) { exportBackup(); return; }
    if (e.target.closest('#copy-btn'))   { copyWorkout(e.target.closest('#copy-btn')); return; }

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
