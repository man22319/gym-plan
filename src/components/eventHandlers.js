import { state, EXERCISE_INDEX } from '../core/workouts.js';
import { dispatch } from '../core/reducer.js';
import { skipRestTimer, extendRestTimer } from '../core/restTimer.js';
import { editingExId, setEditingExId, render } from './rendering.js';
import { openTemplateEditor } from './templateEditor.js';
import {
  openHistoryModal,
  openLogModal,
} from './modals.js';
import {
  importData,
  exportData,
  copyWorkout
} from './fileActions.js';

const pressTimers = new Map();

let lastPressWasLong = false;

const LONG_PRESS_MS = 480;

export function setupEvents() {
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
    if (lastPressWasLong) {
      lastPressWasLong = false;
      return;
    }

    const tab = e.target.closest('.tab');
    if (tab) {
      dispatch('SET_ACTIVE_SESSION', { sessionId: tab.dataset.sessionId });
      return;
    }

    const finishBtn = e.target.closest('.finish-workout-btn');
    if (finishBtn) {
      dispatch('FINISH_WORKOUT', { sessionId: finishBtn.dataset.sessionId });
      return;
    }

    if (e.target.closest('#rest-timer-skip'))   { skipRestTimer();      return; }
    if (e.target.closest('#rest-timer-extend')) { extendRestTimer(30);  return; }

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
      const wVal  = document.getElementById(`edit-weight-${exId}`)?.value.trim() ?? '';
      const rMin  = document.getElementById(`edit-repmin-${exId}`)?.value.trim() ?? '';
      const rMax  = document.getElementById(`edit-repmax-${exId}`)?.value.trim() ?? '';
      const notes = document.getElementById(`edit-notes-${exId}`)?.value.trim() ?? '';

      const weight = wVal !== '' ? { value: parseFloat(wVal), unit: 'lbs' } : null;

      let reps = null;
      if (rMin !== '' || rMax !== '') {
        const min = rMin !== '' ? parseInt(rMin, 10) : 0;
        const max = rMax !== '' ? parseInt(rMax, 10) : min;
        reps = { min, max };
      }

      dispatch('UPDATE_EXERCISE_OVERRIDE', {
        exId,
        fields: { weight, reps, notes: notes !== '' ? notes : null }
      });
      setEditingExId(null);
      return;
    }

    const exHeader = e.target.closest('.exercise-header[data-ex-id]');
    if (exHeader && !e.target.closest('.set-dot') && !e.target.closest('.ex-edit-btn')) {
      openHistoryModal(exHeader.dataset.exId);
      return;
    }

    if (e.target.closest('#template-editor-btn')) { openTemplateEditor(); return; }
    if (e.target.closest('#import-data-btn'))     { importData();  return; }
    if (e.target.closest('#export-data-btn'))     { exportData();  return; }
    if (e.target.closest('#copy-btn'))            { copyWorkout(e.target.closest('#copy-btn')); return; }

    if (e.target.closest('#reset-btn')) {
      if (confirm('Reset current session? This will clear your set inputs and cardio. Your workout history and progression data will be kept.')) {
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
      if (exHeader && !e.target.closest('.ex-edit-btn')) {
        e.preventDefault();
        openHistoryModal(exHeader.dataset.exId);
      }
    }
  });

  document.addEventListener('change', e => {
    const isCardioField = e.target.closest('[data-cardio-field]');
    if (!isCardioField) return;

    const warmupEl   = document.querySelector('[data-cardio-field="warmupDone"]');
    const finisherEl = document.querySelector('[data-cardio-field="finisherDone"]');
    const notesEl    = document.getElementById('cardio-notes');

    dispatch('UPDATE_CARDIO', {
      cardio: {
        warmupDone:   warmupEl?.checked   ?? false,
        finisherDone: finisherEl?.checked ?? false,
        notes:        notesEl?.value.trim() ?? ''
      }
    });
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
