/**
 * exerciseEvents.js
 * ─────────────────────────────────────────────────────────
 * Domain: exercise-level interactions
 *   - Inline edit panel open / cancel / save
 *   - Exercise header tap → history modal
 *   - Cardio field changes (warm-up, finisher, notes)
 *   - Keyboard accessibility for exercise header
 * ─────────────────────────────────────────────────────────
 */

import { state } from '../../core/state/store.js';
import { dispatch } from '../../core/logic/reducer.js';
import { skipRestTimer, extendRestTimer } from '../../core/utils/restTimer.js';
import { editingExId, setEditingExId, render } from '../workout/rendering.js';
import { openHistoryModal } from '../modals/index.js';

export function setupExerciseEvents() {
  document.addEventListener('click', e => {
    // ── Rest timer controls ──────────────────────────────
    if (e.target.closest('#rest-timer-skip'))   { skipRestTimer();     return; }
    if (e.target.closest('#rest-timer-extend')) { extendRestTimer(30); return; }

    // ── Edit panel: open / toggle ────────────────────────
    const editBtn = e.target.closest('.ex-edit-btn');
    if (editBtn) {
      const exId = editBtn.dataset.exId;
      setEditingExId(editingExId === exId ? null : exId);
      render(state);
      return;
    }

    // ── Edit panel: cancel ───────────────────────────────
    const cancelBtn = e.target.closest('.ex-edit-btn-cancel');
    if (cancelBtn) {
      setEditingExId(null);
      render(state);
      return;
    }

    // ── Edit panel: save ─────────────────────────────────
    const saveBtn = e.target.closest('.ex-edit-btn-save');
    if (saveBtn) {
      const exId  = saveBtn.dataset.exId;

      // Working weight — single scalar, no range modes
      const wVal = document.getElementById(`edit-weight-${exId}`)?.value.trim() ?? '';
      const workingWeight = wVal !== '' ? parseFloat(wVal) : null;

      const rMin  = document.getElementById(`edit-repmin-${exId}`)?.value.trim() ?? '';
      const rMax  = document.getElementById(`edit-repmax-${exId}`)?.value.trim() ?? '';
      const notes = document.getElementById(`edit-notes-${exId}`)?.value.trim() ?? '';

      let reps = null;
      if (rMin !== '' || rMax !== '') {
        const min = rMin !== '' ? parseInt(rMin, 10) : 0;
        const max = rMax !== '' ? parseInt(rMax, 10) : min;
        reps = { min, max };
      }

      dispatch('UPDATE_EXERCISE_OVERRIDE', {
        exId,
        fields: { workingWeight, reps, notes: notes !== '' ? notes : null }
      });
      setEditingExId(null);
      return;
    }

    // ── Exercise history button tap → history modal ──────
    const historyBtn = e.target.closest('.ex-history-hint');
    if (historyBtn) {
      const exHeader = historyBtn.closest('.exercise-header[data-ex-id]');
      if (exHeader) {
        openHistoryModal(exHeader.dataset.exId);
      }
      return;
    }
  });

  // ── Keyboard: history button accessibility ───────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const historyBtn = e.target.closest('.ex-history-hint');
      if (historyBtn) {
        const exHeader = historyBtn.closest('.exercise-header[data-ex-id]');
        if (exHeader) {
          e.preventDefault();
          openHistoryModal(exHeader.dataset.exId);
        }
      }
    }
  });

  // ── Cardio field changes ─────────────────────────────
  document.addEventListener('change', e => {
    if (!e.target.closest('[data-cardio-field]')) return;

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
